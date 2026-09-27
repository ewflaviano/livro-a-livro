// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { afterEach, expect, it, vi } from 'vitest';
import { deleteDB, openDB } from 'idb';
import type { LibraryDatabase } from '../adapters/indexeddb/schema';
import { openAnalyticsConsentStore } from './consent';
const names: string[] = []; const stores: { close(): void }[] = [];
afterEach(async () => { stores.splice(0).forEach(store => store.close()); for (const name of names.splice(0)) await deleteDB(name); });
it('keeps GA undecided despite legacy experiment and telemetry booleans, then persists explicit choices', async () => {
  const name = crypto.randomUUID(); names.push(name);
  const first = await openAnalyticsConsentStore({ name, channelFactory: () => null }); stores.push(first);
  const db = await openDB<LibraryDatabase>(name); stores.push(db);
  await db.put('experimentState', { seed: 'a'.repeat(64), experimentsConsent: true, telemetryConsent: true, assignments: {} }, 'preferences');
  expect(await first.read()).toBeNull(); await first.write('accepted'); expect(await first.read()).toBe('accepted');
  const second = await openAnalyticsConsentStore({ name, channelFactory: () => null }); stores.push(second);
  expect(await second.read()).toBe('accepted'); await second.write('rejected'); expect(await first.read()).toBe('rejected');
});
it('broadcasts only invalidation, forcing another tab to reread IDB', async () => {
  const name = crypto.randomUUID(); names.push(name);
  const channels: { onmessage: (() => void) | null; postMessage: ReturnType<typeof vi.fn>; close(): void }[] = [];
  const factory = () => {
    const channel = { onmessage: null as (() => void) | null, postMessage: vi.fn(() => { for (const target of channels) if (target !== channel) target.onmessage?.(); }), close() {} };
    channels.push(channel); return channel as unknown as BroadcastChannel;
  };
  const a = await openAnalyticsConsentStore({ name, channelFactory: factory }); stores.push(a);
  const b = await openAnalyticsConsentStore({ name, channelFactory: factory }); stores.push(b);
  const changed = vi.fn(async () => await b.read()); b.subscribe(() => { void changed(); });
  await a.write('accepted'); await vi.waitFor(() => expect(changed).toHaveBeenCalledOnce());
  expect(channels[0].postMessage).toHaveBeenCalledWith('changed'); expect(await changed.mock.results[0].value).toBe('accepted');
});
it('does not announce or accept a failed transaction', async () => {
  const name = crypto.randomUUID(); names.push(name);
  const channel = { onmessage: null, postMessage: vi.fn(), close() {} } as unknown as BroadcastChannel;
  const store = await openAnalyticsConsentStore({ name, channelFactory: () => channel }); stores.push(store);
  const db = await openDB<LibraryDatabase>(name); stores.push(db);
  db.close();
  // Closing the underlying connection makes the next transaction fail without publishing.
  store.close(); await expect(store.write('accepted')).rejects.toBeDefined();
  expect(channel.postMessage).not.toHaveBeenCalled();
});

it('treats a broadcast failure after commit as durable success', async () => {
  const name = crypto.randomUUID(); names.push(name);
  const channel = { onmessage: null, postMessage: () => { throw new Error('closed channel'); }, close() {} } as unknown as BroadcastChannel;
  const store = await openAnalyticsConsentStore({ name, channelFactory: () => channel }); stores.push(store);
  await expect(store.write('accepted')).resolves.toBeUndefined(); expect(await store.read()).toBe('accepted');
});
