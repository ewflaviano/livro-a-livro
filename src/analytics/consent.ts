import { openDatabase } from '../adapters/indexeddb/database';

export type AnalyticsChoice = 'accepted' | 'rejected' | null;
const KEY = 'ga4-consent-v1';
const CHANNEL = 'livro-a-livro-ga4-consent';
export async function openAnalyticsConsentStore(options: { name?: string; channelFactory?: (name: string) => BroadcastChannel | null } = {}) {
  const connection = await openDatabase({ name: options.name });
  const channel = options.channelFactory ? options.channelFactory(CHANNEL) : typeof BroadcastChannel === 'function' ? new BroadcastChannel(CHANNEL) : null;
  const listeners = new Set<() => void>();
  if (channel) channel.onmessage = () => { for (const listener of listeners) listener(); };
  return {
    async read(): Promise<AnalyticsChoice> {
      connection.ensureOpen();
      const value = await connection.db.get('experimentState', KEY);
      return value === 'accepted' || value === 'rejected' ? value : null;
    },
    async write(choice: Exclude<AnalyticsChoice, null>) {
      connection.ensureOpen();
      const tx = connection.db.transaction('experimentState', 'readwrite');
      await tx.store.put(choice, KEY); await tx.done;
      try { channel?.postMessage('changed'); } catch { /* Commit is durable; a focused tab rereads it. */ }
    },
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    close() { listeners.clear(); channel?.close(); connection.close(); },
  };
}
