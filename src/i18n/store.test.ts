// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { afterEach, expect, it, vi } from 'vitest';
import { deleteDB, openDB } from 'idb';
import type { LibraryDatabase } from '../adapters/indexeddb/schema';
import { openLocaleStore } from './store';
import { openSyncStore } from '../sync/outbox';

const names: string[] = [];
const stores: { close(): void }[] = [];
afterEach(async () => {
  stores.splice(0).forEach(store => store.close());
  for (const name of names.splice(0)) await deleteDB(name);
  vi.unstubAllGlobals();
});

function channels() {
  const all: { name: string; onmessage: (() => void) | null; postMessage: ReturnType<typeof vi.fn>; close(): void }[] = [];
  const factory = (name: string) => {
    const channel = { name, onmessage: null as (() => void) | null, postMessage: vi.fn(() => {
      for (const peer of all) if (peer !== channel && peer.name === name) peer.onmessage?.();
    }), close() {} };
    all.push(channel);
    return channel as unknown as BroadcastChannel;
  };
  return { all, factory };
}

it('stores a choice locally and invalidates another tab without sending the choice', async () => {
  const name = crypto.randomUUID(); names.push(name);
  const bus = channels();
  const first = await openLocaleStore({ name, channelFactory: bus.factory }); stores.push(first);
  const second = await openLocaleStore({ name, channelFactory: bus.factory }); stores.push(second);
  const initial = await first.read();
  expect(initial.choice).toBeNull();
  const changed = vi.fn(); second.subscribe(changed);
  await first.write('en', initial.session);
  expect(await second.read()).toEqual({ ...initial, choice: 'en' });
  expect(changed).toHaveBeenCalledOnce();
  expect(bus.all[0].postMessage).toHaveBeenCalledWith('changed');
});

it('erases locale on logout and fences a stale tab from restoring it', async () => {
  const name = crypto.randomUUID(); names.push(name);
  const bus = channels();
  vi.stubGlobal('BroadcastChannel', class {
    private readonly peer: BroadcastChannel;
    constructor(channelName: string) { this.peer = bus.factory(channelName); }
    get onmessage() { return this.peer.onmessage; }
    set onmessage(listener: BroadcastChannel['onmessage']) { this.peer.onmessage = listener; }
    postMessage(value: unknown) { this.peer.postMessage(value); }
    close() { this.peer.close(); }
  });
  const locale = await openLocaleStore({ name, channelFactory: bus.factory }); stores.push(locale);
  const sync = await openSyncStore({ name }); stores.push(sync);
  const before = await locale.read();
  await locale.write('en', before.session);
  const changed = vi.fn(); locale.subscribe(changed);
  const control = await sync.read();
  await sync.eraseAfterLogout(control.authRevision);
  expect(changed).toHaveBeenCalledOnce();
  const after = await locale.read();
  expect(after.choice).toBeNull();
  expect(after.session).not.toBe(before.session);
  await expect(locale.write('en', before.session)).rejects.toThrow('LocaleSessionChanged');
  expect((await locale.read()).choice).toBeNull();
});

it('allows a local choice after a library replacement changes its generation', async () => {
  const name = crypto.randomUUID(); names.push(name);
  const locale = await openLocaleStore({ name, channelFactory: () => null }); stores.push(locale);
  const before = await locale.read();
  const db = await openDB<LibraryDatabase>(name); stores.push(db);
  const metadata = (await db.get('meta', 'library'))!;
  await db.put('meta', { ...metadata, generation: crypto.randomUUID() }, 'library');
  await locale.write('en', before.session);
  expect((await locale.read()).choice).toBe('en');
});

it('allows a choice after an ordinary authorization revision changes', async () => {
  const name = crypto.randomUUID(); names.push(name);
  const locale = await openLocaleStore({ name, channelFactory: () => null }); stores.push(locale);
  const sync = await openSyncStore({ name }); stores.push(sync);
  const before = await locale.read();
  await sync.update({ enabled: false }, undefined, true);
  expect((await sync.read()).authRevision).toBe(1);
  await locale.write('en', before.session);
  expect((await locale.read()).choice).toBe('en');
});

it('works when BroadcastChannel construction fails', async () => {
  const name = crypto.randomUUID(); names.push(name);
  const locale = await openLocaleStore({ name, channelFactory: () => { throw new Error('disabled'); } }); stores.push(locale);
  const before = await locale.read();
  await locale.write('en', before.session);
  expect((await locale.read()).choice).toBe('en');
});

it('keeps sync available if only the locale broadcast channel is blocked', async () => {
  const name = crypto.randomUUID(); names.push(name);
  vi.stubGlobal('BroadcastChannel', class {
    constructor(channelName: string) { if (channelName.endsWith(':ui-locale')) throw new Error('disabled'); }
    postMessage() {}
    close() {}
  });
  const sync = await openSyncStore({ name }); stores.push(sync);
  expect((await sync.read()).authRevision).toBe(0);
});
