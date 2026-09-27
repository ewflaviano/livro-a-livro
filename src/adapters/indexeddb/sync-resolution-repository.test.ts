import 'fake-indexeddb/auto';
import { openDB } from 'idb';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { encodedCover, stubImageDecoder, syntheticCover } from '../../../test/fixtures/covers/helpers';
import { createBook } from '../../domain/book';
import { prepareBackupMedia } from '../../backup/media';
import type { LibraryExport } from '../../backup/schema';
import type { PreparedSyncCommit } from '../../ports/sync-resolution-repository';
import { defaultSyncRecord } from '../../sync/contracts';
import { headerOf, type SyncSnapshotV2 } from '../../sync/protocol';
import { libraryHashV2 } from '../../sync/snapshot';
import { openSyncStore } from '../../sync/outbox';
import { openLibraryRepository } from './library-repository';
import { openSyncResolutionRepository } from './sync-resolution-repository';
import { encodeCover } from './cover-media';
const now = '2026-09-26T12:00:00Z';
const binding = { connectionId: 'synthetic-connection', generation: 1 };
const close: (() => void)[] = [];
beforeEach(stubImageDecoder);
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); close.splice(0).forEach(fn => fn()); });
const snapshot = async (library: LibraryExport): Promise<SyncSnapshotV2> => ({ format: 'livro-a-livro-sync', protocolVersion: 2, snapshotId: crypto.randomUUID(), operationId: crypto.randomUUID(), parentSnapshotId: null, resolvedSnapshotIds: [], createdAt: now, hash: await libraryHashV2(library), library });
async function setup(kind: 'resolution' | 'receive' = 'resolution') {
  const name = `sync-commit-${crypto.randomUUID()}`;
  const repository = await openLibraryRepository({ name, channelFactory: null, focusTarget: null });
  const store = await openSyncStore({ name }); const adapter = await openSyncResolutionRepository(repository, { name }); const db = await openDB(name);
  close.push(() => { adapter.close(); repository.close(); store.close(); db.close(); });
  const book = createBook({ title: 'Sintético anterior', cover: { provider: 'local', mediaId: encodedCover().id } }, { id: crypto.randomUUID(), now, shelfYear: 2026 });
  await repository.commit({ kind: 'put', book, coverMedia: syntheticCover() }, await repository.readRevision());
  await store.write({ ...defaultSyncRecord, binding, enabled: true }); await store.lease('owner');
  const local = await repository.readBackupSnapshot();
  const library: LibraryExport = { format: 'livro-a-livro', schemaVersion: 1, exportedAt: now, books: local.books, preferences: local.preferences, coverMedia: await Promise.all(local.coverMedia.map(encodeCover)) };
  const recovery = await snapshot(library); const next = await snapshot({ ...library, books: [{ ...book, title: 'Sintético recebido' }], preferences: { shelfYear: 2025, mode: 'list', filter: 'read' } });
  const input: PreparedSyncCommit = { fence: { expectedRevision: local.version, expectedAuthRevision: 0, expectedBinding: binding, expectedOperation: null, expectedPending: local.version, leaseOwner: 'owner' }, library: next.library, media: await prepareBackupMedia(next.library), recovery,
    effect: kind === 'resolution' ? { kind, binding, snapshot: next } : { kind, binding, head: headerOf(next), comparisonHashV2: next.hash } };
  const capture = async () => ({ library: await repository.readBackupSnapshot(), control: await db.getAll('syncState'), outbox: await db.getAll('syncOutbox'), meta: await db.getAll('meta'), preferences: await repository.readPreferences() });
  return { input, adapter, repository, store, db, capture };
}
it.each(['resolution','receive'] as const)('atomically commits result/recovery/%s and retains real image bytes', async kind => {
  const s = await setup(kind); const version = await s.adapter.commit(s.input, () => {});
  expect((await s.repository.readAll()).books[0].title).toBe('Sintético recebido');
  expect(await (await s.repository.readCover(encodedCover().id))!.bytes.arrayBuffer()).toEqual(await syntheticCover().bytes.arrayBuffer());
  expect((await s.store.recovery())?.library).toEqual(s.input.recovery.library);
  if (kind === 'resolution') { expect((await s.store.operation())?.version).toEqual(version); expect(await s.store.pending()).toEqual(version); expect((await s.store.read()).base).toBeNull(); }
  else { expect(await s.store.operation()).toBeNull(); expect(await s.store.pending()).toBeNull(); expect((await s.store.read()).base?.comparisonHashV2).toBe(s.input.effect.kind === 'receive' && s.input.effect.comparisonHashV2); }
});
for (const kind of ['resolution','receive'] as const) it.each(Array.from({length: kind === 'resolution' ? 10 : 11}, (_,i) => i))(`rolls back every store if write %i fails during ${kind}`, async failAt => {
  const s = await setup(kind); const before = await s.capture(); let writes = 0;
  for (const method of ['put','add','clear','delete'] as const) {
    const original = IDBObjectStore.prototype[method];
    vi.spyOn(IDBObjectStore.prototype, method).mockImplementation(function (this: IDBObjectStore, ...args: unknown[]) {
      if (writes++ === failAt) throw new DOMException('Synthetic quota', 'QuotaExceededError');
      return Reflect.apply(original, this, args);
    } as never);
  }
  await expect(s.adapter.commit(s.input, () => {})).rejects.toMatchObject({ code: 'QuotaExceeded' });
  vi.restoreAllMocks(); expect(writes).toBeGreaterThan(failAt); expect(await s.capture()).toEqual(before);
});
it.each(['revision','preferences','auth','binding','operation','pending','lease','draft'] as const)('refuses stale %s without replacing any captured data', async change => {
  const s = await setup();
  if (change === 'revision') await s.repository.commit({ kind: 'delete', id: s.input.library.books[0].id }, await s.repository.readRevision());
  if (change === 'preferences') await s.repository.updatePreferences({ mode: 'list' });
  if (change === 'auth') await s.store.update({ enabled: false }, undefined, true);
  if (change === 'binding') await s.store.update({ binding: { ...binding, generation: 2 } });
  if (change === 'operation') await s.store.saveOperation({ binding, version: s.input.fence.expectedRevision, snapshot: await snapshot(s.input.recovery.library) });
  if (change === 'pending') await s.db.delete('syncOutbox','pending');
  if (change === 'lease') await s.store.lease('owner',true);
  if (change === 'draft') await s.store.update({ authorization: { id: crypto.randomUUID(), stage: 'signin' } });
  const before = await s.capture(); await expect(s.adapter.commit(s.input, () => {})).rejects.toBeDefined(); expect(await s.capture()).toEqual(before);
});
it('rejects a recovery that does not describe the captured local library', async () => {
  const s = await setup(); s.input.recovery = await snapshot(s.input.library);
  const before = await s.capture(); await expect(s.adapter.commit(s.input, () => {})).rejects.toMatchObject({ code: 'invalid' }); expect(await s.capture()).toEqual(before);
});
it('rejects a receive base header/hash inconsistent with its content', async () => {
  const s = await setup('receive'); if (s.input.effect.kind === 'receive') s.input.effect.head.hash = '0'.repeat(64);
  const before = await s.capture(); await expect(s.adapter.commit(s.input, () => {})).rejects.toMatchObject({ code: 'invalid' }); expect(await s.capture()).toEqual(before);
});
it.each([0,1,2])('aborts atomically when the ephemeral confirmation guard fails at checkpoint %i', async failAt => {
  const s = await setup(); const before = await s.capture(); let calls = 0;
  await expect(s.adapter.commit(s.input, () => { if (calls++ === failAt) throw new Error('Synthetic cancellation'); })).rejects.toBeDefined();
  expect(calls).toBe(failAt+1); expect(await s.capture()).toEqual(before);
});
