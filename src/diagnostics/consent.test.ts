import 'fake-indexeddb/auto';
import { deleteDB } from 'idb';
import { afterEach, expect, it, vi } from 'vitest';
import { openDiagnosticsConsentStore } from './consent';

const names: string[] = []; const stores: { close(): void }[] = [];
afterEach(async () => { stores.splice(0).forEach(store => store.close()); await Promise.all(names.splice(0).map(name => deleteDB(name))); vi.restoreAllMocks(); });
it('starts undecided, persists separately and invalidates another tab without sending the choice', async () => {
  const name = `diagnostics-synthetic-${crypto.randomUUID()}`; names.push(name);
  const channels: BroadcastChannel[] = []; const messages: unknown[] = [];
  const factory = () => {
    const channel = { onmessage: null, close() {}, postMessage(message: unknown) {
      messages.push(message);
      for (const other of channels) if (other !== channel) other.onmessage?.call(other, new MessageEvent('message', { data: message }));
    } } as BroadcastChannel;
    channels.push(channel); return channel;
  };
  const a = await openDiagnosticsConsentStore({ name, channelFactory: factory }); const b = await openDiagnosticsConsentStore({ name, channelFactory: factory }); stores.push(a, b);
  expect(await a.read()).toBeNull(); const changed = vi.fn(); b.subscribe(changed);
  await a.write('accepted'); expect(changed).toHaveBeenCalledOnce(); expect(await b.read()).toBe('accepted');
  await b.write('rejected'); expect(await a.read()).toBe('rejected'); expect(messages).toEqual(['changed', 'changed']);
});
