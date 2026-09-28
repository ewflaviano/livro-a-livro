import { openDatabase } from '../adapters/indexeddb/database';

export type AnalyticsChoice = 'accepted' | 'rejected' | null;
const KEY = 'usage-consent-v1';
const CHANNEL = 'livro-a-livro-usage-consent';
const LEGACY_CHANNELS = ['livro-a-livro-ga4-consent', 'livro-a-livro-diagnostics-consent'];
export async function openAnalyticsConsentStore(options: { name?: string; channelFactory?: (name: string) => BroadcastChannel | null } = {}) {
  const connection = await openDatabase({ name: options.name });
  const createChannel = options.channelFactory ?? ((name: string) => typeof BroadcastChannel === 'function' ? new BroadcastChannel(name) : null);
  const channel = createChannel(CHANNEL);
  const legacyChannels = LEGACY_CHANNELS.map(createChannel);
  // Opening the new app revokes consent in tabs still running either old build.
  // The new choice remains undecided until the person explicitly chooses it.
  try {
    connection.ensureOpen();
    const legacy = connection.db.transaction('experimentState', 'readwrite');
    await legacy.store.put('rejected', 'ga4-consent-v1');
    await legacy.store.put('rejected', 'diagnostics-consent-v1');
    await legacy.done;
    for (const destination of legacyChannels) {
      try { destination?.postMessage('changed'); } catch { /* Focus will recheck. */ }
    }
  } catch (error) {
    channel?.close(); legacyChannels.forEach(legacy => legacy?.close()); connection.close();
    throw error;
  }
  const listeners = new Set<() => void>();
  if (channel) channel.onmessage = () => { for (const listener of listeners) listener(); };
  return {
    async read(): Promise<AnalyticsChoice> {
      connection.ensureOpen();
      const value = await connection.db.get('experimentState', KEY);
      if (value === undefined) return null;
      if (value === 'accepted' || value === 'rejected') return value;
      throw new Error('InvalidUsageConsent');
    },
    async write(choice: Exclude<AnalyticsChoice, null>) {
      connection.ensureOpen();
      const tx = connection.db.transaction('experimentState', 'readwrite');
      await tx.store.put(choice, KEY);
      await tx.store.put('rejected', 'ga4-consent-v1');
      await tx.store.put('rejected', 'diagnostics-consent-v1');
      await tx.done;
      for (const destination of [channel, ...legacyChannels]) {
        try { destination?.postMessage('changed'); } catch { /* Commit is durable; a focused tab rereads it. */ }
      }
    },
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    close() { listeners.clear(); channel?.close(); legacyChannels.forEach(legacy => legacy?.close()); connection.close(); },
  };
}
