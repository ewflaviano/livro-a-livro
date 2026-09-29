import { openDatabase } from '../adapters/indexeddb/database';
import { defaultSyncRecord, syncStateSchema } from '../sync/contracts';
import type { Locale } from './locale';

const KEY = 'ui-locale-v1';
const CHANNEL = 'ui-locale';

export interface LocalePreference {
  choice: Locale | null;
  authRevision: number;
}

/** UI preference lives only in this browser, outside books, backups and Drive. */
export async function openLocaleStore(options: {
  name?: string;
  channelFactory?: (name: string) => BroadcastChannel | null;
} = {}) {
  const connection = await openDatabase({ name: options.name });
  const db = connection.db;
  const factory = options.channelFactory ?? ((name: string) => typeof BroadcastChannel === 'function' ? new BroadcastChannel(name) : null);
  let channel: BroadcastChannel | null = null;
  try { channel = factory(`${db.name}:${CHANNEL}`); } catch { /* Broadcast is optional; focus rechecks storage. */ }
  const listeners = new Set<() => void>();
  if (channel) channel.onmessage = () => { for (const listener of listeners) listener(); };
  return {
    async read(): Promise<LocalePreference> {
      connection.ensureOpen();
      const tx = db.transaction(['experimentState', 'syncState'], 'readonly');
      const [value, control] = await Promise.all([
        tx.objectStore('experimentState').get(KEY),
        tx.objectStore('syncState').get('control'),
      ]);
      await tx.done;
      if (value !== undefined && value !== 'pt-BR' && value !== 'en') throw new Error('InvalidLocalePreference');
      return { choice: value ?? null, authRevision: control === undefined ? defaultSyncRecord.authRevision : syncStateSchema.parse(control).authRevision };
    },
    async write(choice: Locale, expectedAuthRevision: number): Promise<void> {
      connection.ensureOpen();
      const tx = db.transaction(['experimentState', 'syncState'], 'readwrite');
      void tx.done.catch(() => {});
      try {
        const control = await tx.objectStore('syncState').get('control');
        const authRevision = control === undefined ? defaultSyncRecord.authRevision : syncStateSchema.parse(control).authRevision;
        // Logout increments authRevision and clears the choice in the same transaction.
        // Backup restore/Drive replace may change the library generation alone.
        if (authRevision !== expectedAuthRevision) throw new Error('LocaleSessionChanged');
        await tx.objectStore('experimentState').put(choice, KEY);
        await tx.done;
      } catch (error) {
        try { tx.abort(); } catch { /* Already completed or aborted. */ }
        await tx.done.catch(() => {});
        throw error;
      }
      try { channel?.postMessage('changed'); } catch { /* Focus will recheck. */ }
      for (const listener of listeners) listener();
    },
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    close() { listeners.clear(); channel?.close(); connection.close(); },
  };
}
