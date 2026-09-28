import { openDatabase } from '../adapters/indexeddb/database';

export type DiagnosticsChoice = 'accepted' | 'rejected' | null;
const KEY = 'diagnostics-consent-v1';
const CHANNEL = 'livro-a-livro-diagnostics-consent';
export async function openDiagnosticsConsentStore(options: { name?: string; channelFactory?: (name: string) => BroadcastChannel | null } = {}) {
  const connection = await openDatabase({ name: options.name });
  const channel = options.channelFactory ? options.channelFactory(CHANNEL) : typeof BroadcastChannel === 'function' ? new BroadcastChannel(CHANNEL) : null;
  const listeners = new Set<() => void>();
  if (channel) channel.onmessage = () => { for (const listener of listeners) listener(); };
  return {
    async read(): Promise<DiagnosticsChoice> {
      connection.ensureOpen();
      const value = await connection.db.get('experimentState', KEY);
      if (value === undefined) return null;
      if (value === 'accepted' || value === 'rejected') return value;
      throw new Error('InvalidDiagnosticsConsent');
    },
    async write(choice: Exclude<DiagnosticsChoice, null>) {
      connection.ensureOpen();
      const tx = connection.db.transaction('experimentState', 'readwrite');
      await tx.store.put(choice, KEY); await tx.done;
      try { channel?.postMessage('changed'); } catch { /* Focus will recheck the durable choice. */ }
    },
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    close() { listeners.clear(); channel?.close(); connection.close(); },
  };
}
