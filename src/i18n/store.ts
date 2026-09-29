import { openDatabase } from '../adapters/indexeddb/database';
import type { Locale } from './locale';

const KEY = 'ui-locale-v1';
export const LOCALE_SESSION_KEY = 'ui-locale-session-v1';
const CHANNEL = 'ui-locale';

export interface LocalePreference {
  choice: Locale | null;
  session: string;
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
      const tx = db.transaction(['experimentState', 'syncState'], 'readwrite');
      void tx.done.catch(() => {});
      const [value, rawSession] = await Promise.all([tx.objectStore('experimentState').get(KEY), tx.objectStore('syncState').get(LOCALE_SESSION_KEY)]);
      const session = rawSession === undefined ? crypto.randomUUID() : rawSession;
      if (typeof session !== 'string') { tx.abort(); throw new Error('InvalidLocaleSession'); }
      if (rawSession === undefined) await tx.objectStore('syncState').put(session, LOCALE_SESSION_KEY);
      await tx.done;
      if (value !== undefined && value !== 'pt-BR' && value !== 'en') throw new Error('InvalidLocalePreference');
      return { choice: value ?? null, session };
    },
    async write(choice: Locale, expectedSession: string): Promise<void> {
      connection.ensureOpen();
      const tx = db.transaction(['experimentState', 'syncState'], 'readwrite');
      void tx.done.catch(() => {});
      try {
        const session = await tx.objectStore('syncState').get(LOCALE_SESSION_KEY);
        if (session !== expectedSession) throw new Error('LocaleSessionChanged');
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
