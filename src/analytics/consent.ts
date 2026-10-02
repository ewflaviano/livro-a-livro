import { openDatabase } from '../adapters/indexeddb/database';
import { newExperimentState, normalizeExperimentState } from '../experiments/store';

export type AnalyticsChoice = 'accepted' | 'rejected' | null;
const KEY = 'usage-consent-v2';
const CHANNEL = 'livro-a-livro-usage-consent';
const LEGACY_CHANNELS = ['livro-a-livro-ga4-consent', 'livro-a-livro-diagnostics-consent'];
const EXPERIMENT_CHANNEL = 'livro-experiments';
export async function openAnalyticsConsentStore(options: { name?: string; channelFactory?: (name: string) => BroadcastChannel | null } = {}) {
  const connection = await openDatabase({ name: options.name });
  const createChannel = options.channelFactory ?? ((name: string) => typeof BroadcastChannel === 'function' ? new BroadcastChannel(name) : null);
  const channel = createChannel(CHANNEL);
  const legacyChannels = LEGACY_CHANNELS.map(createChannel);
  const experimentChannel = createChannel(EXPERIMENT_CHANNEL);
  // Opening the new app revokes consent in tabs still running either old build.
  // The new choice remains undecided until the person explicitly chooses it.
  try {
    connection.ensureOpen();
    const legacy = connection.db.transaction('experimentState', 'readwrite');
    await legacy.store.put('rejected', 'ga4-consent-v1');
    await legacy.store.put('rejected', 'diagnostics-consent-v1');
    await legacy.store.put('rejected', 'usage-consent-v1');
    if (await legacy.store.get(KEY) !== 'accepted') {
      const old = await legacy.store.get('preferences');
      if (old !== undefined) await legacy.store.put({ ...normalizeExperimentState(old), experimentsConsent: false, telemetryConsent: false }, 'preferences');
    }
    await legacy.done;
    if (typeof window !== 'undefined') window.dispatchEvent(new Event('livro-experiments-changed'));
    try { channel?.postMessage('changed'); } catch { /* Focus will recheck. */ }
    try { experimentChannel?.postMessage('changed'); } catch { /* Focus will recheck. */ }
    for (const destination of legacyChannels) {
      try { destination?.postMessage('changed'); } catch { /* Focus will recheck. */ }
    }
  } catch (error) {
    channel?.close(); experimentChannel?.close(); legacyChannels.forEach(legacy => legacy?.close()); connection.close();
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
      const current = await tx.store.get('preferences');
      const state = current === undefined ? newExperimentState() : normalizeExperimentState(current);
      await tx.store.put({ ...state, experimentsConsent: choice === 'accepted', telemetryConsent: choice === 'accepted' }, 'preferences');
      await tx.store.put(choice, KEY);
      await tx.store.put('rejected', 'usage-consent-v1');
      await tx.store.put('rejected', 'ga4-consent-v1');
      await tx.store.put('rejected', 'diagnostics-consent-v1');
      await tx.done;
      if (typeof window !== 'undefined') window.dispatchEvent(new Event('livro-experiments-changed'));
      for (const destination of [channel, experimentChannel, ...legacyChannels]) {
        try { destination?.postMessage('changed'); } catch { /* Commit is durable; a focused tab rereads it. */ }
      }
    },
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    close() { listeners.clear(); channel?.close(); experimentChannel?.close(); legacyChannels.forEach(legacy => legacy?.close()); connection.close(); },
  };
}
