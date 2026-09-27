import { coverId, encodedCover, syntheticCover, stubImageDecoder } from '../../test/fixtures/covers/helpers';
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBook } from '../domain/book';
import { openLibraryRepository } from '../adapters/indexeddb/library-repository';
import { openCoverMediaRepository } from '../adapters/indexeddb/cover-media';
import { openSyncStore } from './outbox';
import { createSyncCoordinator } from './coordinator';
import { createAuthClient } from './api';
import { createDriveClient } from './drive-client';
import { libraryHash, parseSnapshot, remoteHeads } from './snapshot';
import { defaultSyncRecord, DRIVE_SCOPE, SyncError, type AuthClient, type Binding, type DriveClient, type DriveFile, type SyncSnapshot } from './contracts';
import type { LibraryExport } from '../backup/schema';
import { localTransport } from './local-client';

const binding: Binding = { connectionId: 'synthetic-connection', generation: 1 };
const time = '2026-09-26T12:00:00.000Z';
const book = (title = 'Livro sintético') => createBook({ title, status: 'read' }, { id: crypto.randomUUID(), now: time, shelfYear: 2026 });
const data = (books: ReturnType<typeof book>[] = []): LibraryExport => ({ format: 'livro-a-livro', schemaVersion: 1, exportedAt: time, books, preferences: { shelfYear: 2026, mode: 'grid', filter: 'all' }, coverMedia: [] });
async function snap(library: LibraryExport, parent: string | null = null, resolved: string[] = []): Promise<SyncSnapshot> {
  return { format: 'livro-a-livro-sync', protocolVersion: 1, snapshotId: crypto.randomUUID(), operationId: crypto.randomUUID(), parentSnapshotId: parent, resolvedSnapshotIds: resolved, hash: await libraryHash(library), createdAt: time, library };
}
function file(snapshot: SyncSnapshot): DriveFile { const { library: _, ...header } = snapshot; return { id: crypto.randomUUID(), size: JSON.stringify(snapshot).length, header }; }
const close: (() => void)[] = [];
beforeEach(stubImageDecoder);
afterEach(() => { vi.restoreAllMocks(); close.splice(0).forEach(stop => stop()); vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
async function setup() {
  const name = crypto.randomUUID(); const repository = await openLibraryRepository({ name, channelFactory: null, focusTarget: null });
  const media = await openCoverMediaRepository({ name });
  const store = await openSyncStore({ name }); const snapshots: SyncSnapshot[] = [];
  const auth: AuthClient = { session: vi.fn(async () => binding), token: vi.fn(async () => 'synthetic-token'), invalidate: vi.fn(), start: vi.fn(async () => 'https://accounts.google.com/o/oauth2/v2/auth'), disconnect: vi.fn(async () => false) };
  const drive: DriveClient = { list: vi.fn(async () => snapshots.map(file)), download: vi.fn(async head => snapshots.find(item => item.snapshotId === head.header.snapshotId)!), upload: vi.fn(async value => { snapshots.push(value); }) };
  const options = { repository, media, store, auth, drive: () => drive, online: () => true, visible: () => true, hasDraft: () => false, navigate: vi.fn() };
  const coordinator = createSyncCoordinator(options);
  close.push(() => { coordinator.close(); repository.close(); media.close(); store.close(); });
  await store.write({ ...defaultSyncRecord, enabled: true });
  return { ...options, options, coordinator, snapshots, remote: drive };
}

describe('private snapshot protocol', () => {
  it('hashes canonical books only; rejects tampering and cycles', async () => {
    const first = book(); const second = book(); const a = data([first, second]);
    expect(await libraryHash(a)).toBe(await libraryHash({ ...a, books: [second, first], exportedAt: '2026-10-01T00:00:00Z' }));
    const snapshot = await snap(a); expect(await parseSnapshot(snapshot)).toEqual(snapshot);
    await expect(parseSnapshot({ ...snapshot, hash: '0'.repeat(64) })).rejects.toMatchObject({ code: 'invalid' });
    const bad = file(snapshot); bad.header.parentSnapshotId = bad.header.snapshotId;
    expect(() => remoteHeads([bad])).toThrow('invalid');
  });
  it('does not choose between sibling heads by timestamp and honors an explicit resolution', async () => {
    const root = await snap(data()); const left = await snap(data([book('A')]), root.snapshotId); const right = await snap(data([book('B')]), root.snapshotId);
    expect(remoteHeads([root, left, right].map(file))).toHaveLength(2);
    const resolved = await snap(left.library, left.snapshotId, [left.snapshotId, right.snapshotId]);
    expect(remoteHeads([root, left, right, resolved].map(file))[0].header.snapshotId).toBe(resolved.snapshotId);
  });
});
describe('durable local first coordinator', () => {
  it.each(['pending', 'failed'] as const)('keeps an honest revocation warning after reload when Google is %s', async result => {
    const s = await setup();
    const before = await s.repository.readAll();
    if (result === 'pending') vi.mocked(s.auth.disconnect).mockResolvedValue(true);
    else vi.mocked(s.auth.disconnect).mockRejectedValue(new SyncError('retry'));
    await s.coordinator.disconnect(true).catch(() => {});
    expect((await s.store.read()).revocationPending).toBe(true);
    expect((await s.store.read()).enabled).toBe(false);
    const reopened = createSyncCoordinator(s.options); close.push(() => reopened.close());
    await reopened.start();
    expect(reopened.getSnapshot()).toMatchObject({ status: 'reconnect', revocationPending: true });
    expect(await s.repository.readAll()).toEqual(before);
    await expect(reopened.resume()).rejects.toMatchObject({ code: 'reconnect' });
    await reopened.runNow();
    expect(s.remote.list).not.toHaveBeenCalled();
    expect((await s.store.read()).revocationPending).toBe(true);
    vi.mocked(s.auth.start).mockRejectedValueOnce(new SyncError('retry'));
    await expect(reopened.connect()).rejects.toMatchObject({ code: 'retry' });
    expect(await s.store.read()).toMatchObject({ enabled: false, revocationPending: true });
    await reopened.connect();
    expect(await s.store.read()).toMatchObject({ enabled: true, revocationPending: false });
    expect(s.navigate).toHaveBeenCalledWith('https://accounts.google.com/o/oauth2/v2/auth');
  });

  it.each(['pause', 'disconnect'] as const)('does not resurrect synchronization when %s races with acceptance', async action => {
    const s = await setup();
    await s.repository.commit({ kind: 'put', book: book() }, await s.repository.readRevision());
    const original = s.store.update.bind(s.store);
    let reached!: () => void; const ready = new Promise<void>(resolve => { reached = resolve; });
    let release!: () => void; const blocked = new Promise<void>(resolve => { release = resolve; });
    vi.spyOn(s.store, 'update').mockImplementation(async (value, owner, revokeLease, acknowledged) => {
      if (value.base) { reached(); await blocked; }
      return original(value, owner, revokeLease, acknowledged);
    });
    const run = s.coordinator.runNow(); await ready;
    if (action === 'pause') await s.coordinator.pause(); else await s.coordinator.disconnect(false);
    release(); await run;
    expect((await s.store.read()).enabled).toBe(false);
    expect(s.coordinator.getSnapshot().status).toBe('paused');
  });

  it('fences a paused cycle even after another tab resumes the shared control', async () => {
    const s = await setup();
    await s.repository.commit({ kind: 'put', book: book() }, await s.repository.readRevision());
    const original = s.store.update.bind(s.store);
    let reached!: () => void; const ready = new Promise<void>(resolve => { reached = resolve; });
    let release!: () => void; const blocked = new Promise<void>(resolve => { release = resolve; });
    vi.spyOn(s.store, 'update').mockImplementation(async (value, owner, revokeLease, acknowledged) => {
      if (value.base) { reached(); await blocked; }
      return original(value, owner, revokeLease, acknowledged);
    });
    const run = s.coordinator.runNow(); await ready;
    const other = createSyncCoordinator(s.options); close.push(() => other.close());
    await other.pause(); s.options.online = () => false; await other.resume(); release(); await run;
    expect(await s.store.operation()).not.toBeNull();
    expect(await s.store.pending()).toEqual(await s.repository.readRevision());
    expect((await s.store.read()).base).toBeNull();
    s.options.online = () => true; await other.runNow();
    await vi.waitFor(() => expect(other.getSnapshot().status).toBe('synced'));
    expect(s.snapshots).toHaveLength(1);
  });
  it.each(['descendant', 'conflict'] as const)('does not apply %s replacement after pause wins before its transaction', async path => {
    const s = await setup(); const local = book('Local');
    await s.repository.commit({ kind: 'put', book: local }, await s.repository.readRevision());
    await s.coordinator.runNow();
    const remote = await snap(data([book('Remote')]), s.snapshots[0].snapshotId);
    s.snapshots.push(remote);
    if (path === 'conflict') {
      await s.repository.commit({ kind: 'put', book: book('Unsynced') }, await s.repository.readRevision());
      await s.coordinator.runNow();
    }
    const before = await s.repository.readBackupSnapshot();
    const original = s.repository.commit.bind(s.repository);
    vi.spyOn(s.repository, 'commit').mockImplementation(async (...args) => {
      await s.coordinator.pause(); return original(...args);
    });
    if (path === 'conflict') await s.coordinator.resolve(remote.snapshotId); else await s.coordinator.runNow();
    expect(await s.repository.readBackupSnapshot()).toEqual(before);
    expect(s.coordinator.getSnapshot().status).toBe('paused');
  });
  it('does not persist an operation after pause wins before its transaction', async () => {
    const s = await setup();
    await s.repository.commit({ kind: 'put', book: book() }, await s.repository.readRevision());
    const original = s.store.saveOperation.bind(s.store);
    vi.spyOn(s.store, 'saveOperation').mockImplementation(async (...args) => {
      await s.coordinator.pause(); return original(...args);
    });
    await s.coordinator.runNow();
    expect(await s.store.operation()).toBeNull();
    expect(s.remote.upload).not.toHaveBeenCalled();
  });

  it.each(['descendant', 'conflict'] as const)('preserves the newer recovery when a paused %s cycle returns late', async path => {
    const s = await setup();
    await s.repository.commit({ kind: 'put', book: book('Cópia anterior sintética') }, await s.repository.readRevision());
    if (path === 'descendant') await s.coordinator.runNow();
    const remote = await snap(data([book('Remoto sintético')]), s.snapshots[0]?.snapshotId ?? null);
    s.snapshots.push(remote);
    if (path === 'conflict') await s.coordinator.runNow();
    const preserve = s.store.preserve.bind(s.store);
    let reached!: () => void; const ready = new Promise<void>(resolve => { reached = resolve; });
    let release!: () => void; const blocked = new Promise<void>(resolve => { release = resolve; });
    let first = true;
    vi.spyOn(s.store, 'preserve').mockImplementation(async (...args) => {
      if (first) { first = false; reached(); await blocked; }
      return preserve(...args);
    });
    const stale = path === 'conflict' ? s.coordinator.resolve(remote.snapshotId) : s.coordinator.runNow();
    await ready;
    await s.coordinator.pause();
    const newer = book('Edição recente sintética');
    await s.repository.commit({ kind: 'put', book: newer }, await s.repository.readRevision());
    await s.store.update({ enabled: true });
    const other = createSyncCoordinator(s.options); close.push(() => other.close());
    await other.runNow(); await other.resolve(remote.snapshotId);
    const recovery = await s.store.recovery();
    expect(recovery?.library.books).toContainEqual(newer);
    release(); await stale;
    expect(await s.store.recovery()).toEqual(recovery);
    expect((await s.repository.readAll()).books).toEqual(remote.library.books);
  });

  it('cannot renew a lease revoked by pause, and patches preserve unrelated control fields', async () => {
    const s = await setup();
    expect(await s.store.lease('old')).toBe(true);
    await s.coordinator.pause();
    expect(await s.store.lease('old', false, true)).toBe(false);
    await s.store.update({ attempts: 2 });
    expect((await s.store.read()).enabled).toBe(false);
    await expect(s.store.update({ base: null }, 'old')).rejects.toMatchObject({ code: 'cancelled' });
  });

  it.each(['descendant', 'conflict'] as const)('restores books and real cover bytes together through %s', async path => {
    const s = await setup(); await s.repository.commit({ kind: 'put', book: book('Base') }, await s.repository.readRevision());
    if (path === 'descendant') await s.coordinator.runNow();
    const incoming = { ...book('Remote'), cover: { provider: 'local' as const, mediaId: coverId } };
    const remote = await snap({ ...data([incoming]), coverMedia: [encodedCover()] }, s.snapshots[0]?.snapshotId ?? null);
    s.snapshots.push(remote); await s.coordinator.runNow();
    if (path === 'conflict') await s.coordinator.resolve(remote.snapshotId);
    expect((await s.repository.readAll()).books).toEqual([incoming]);
    expect(await (await s.media.read(coverId))!.bytes.arrayBuffer()).toEqual(await syntheticCover().bytes.arrayBuffer());
  });

  it.each(['descendant', 'conflict'] as const)('preserves current media when revision becomes stale during %s download', async path => {
    const s = await setup(); const local = { ...book('Base'), cover: { provider: 'local' as const, mediaId: coverId } };
    await s.repository.commit({ kind: 'replace', books: [local], coverMedia: [syntheticCover()] }, await s.repository.readRevision());
    if (path === 'descendant') await s.coordinator.runNow();
    const remote = await snap(data([book('Remote')]), s.snapshots[0]?.snapshotId ?? null); s.snapshots.push(remote);
    if (path === 'conflict') await s.coordinator.runNow();
    vi.mocked(s.remote.download).mockImplementationOnce(async () => {
      await s.repository.commit({ kind: 'put', book: book('Concurrent') }, await s.repository.readRevision());
      return remote;
    });
    if (path === 'conflict') await s.coordinator.resolve(remote.snapshotId); else await s.coordinator.runNow();
    expect((await s.repository.readAll()).books).toHaveLength(2);
    expect(await (await s.media.read(coverId))!.bytes.arrayBuffer()).toEqual(await syntheticCover().bytes.arrayBuffer());
    expect(await s.store.pending()).toEqual(await s.repository.readRevision());
  });

  it('rejects corrupt image bytes in downloaded snapshots before they can reach a preview', async () => {
    const malformed = await snap({ ...data(), coverMedia: [{ ...encodedCover(), bytes: btoa('false PNG') }] });
    await expect(parseSnapshot(malformed)).rejects.toMatchObject({ code: 'invalid' });
  });

  it('moves local cover bytes only inside the direct Drive snapshot', async () => {
    const s = await setup(); const mediaId = 'a5f7ab9f-c2ed-4779-b274-f89ae62716ed';
    await s.repository.commit({ kind: 'put', book: createBook({ title: 'Com capa', cover: { provider: 'local', mediaId } }, { id: crypto.randomUUID(), now: time, shelfYear: 2026 }), coverMedia: syntheticCover() }, await s.repository.readRevision());
    await s.coordinator.runNow();
    expect(s.snapshots[0].library.coverMedia).toHaveLength(1);
    expect(s.snapshots[0].library.coverMedia[0].id).toBe(mediaId);
  });
  it('marks every commit atomically pending and never performs network when disabled/offline', async () => {
    const s = await setup(); const revision = await s.repository.commit({ kind: 'put', book: book() }, await s.repository.readRevision());
    expect(await s.store.pending()).toEqual(revision);
    await s.store.write(defaultSyncRecord); await s.coordinator.runNow(); expect(s.auth.session).not.toHaveBeenCalled();
    await s.store.write({ ...defaultSyncRecord, enabled: true }); s.options.online = () => false;
    await s.coordinator.runNow(); expect(s.auth.session).not.toHaveBeenCalled(); expect(s.coordinator.getSnapshot().status).toBe('offline');
  });
  it('uploads directly and reconciles an uncertain successful upload on next opening without duplication', async () => {
    const s = await setup(); await s.repository.commit({ kind: 'put', book: book() }, await s.repository.readRevision());
    vi.mocked(s.remote.upload).mockImplementationOnce(async value => { s.snapshots.push(value); throw new SyncError('retry'); });
    await s.coordinator.runNow(); expect(await s.store.operation()).not.toBeNull(); expect(await s.store.pending()).not.toBeNull();
    await s.store.write({ ...await s.store.read(), nextAttempt: 0 }); await s.coordinator.runNow();
    expect(s.remote.upload).toHaveBeenCalledTimes(1); expect(await s.store.operation()).toBeNull(); expect(await s.store.pending()).toBeNull();
    expect(s.coordinator.getSnapshot().status).toBe('synced');
  });
  it('keeps a later edit pending when an older revision finishes uploading', async () => {
    const s = await setup(); await s.repository.commit({ kind: 'put', book: book() }, await s.repository.readRevision());
    vi.mocked(s.remote.upload).mockImplementationOnce(async value => { s.snapshots.push(value); await s.repository.commit({ kind: 'put', book: book('Depois') }, await s.repository.readRevision()); });
    await s.coordinator.runNow(); expect(await s.store.pending()).not.toBeNull(); expect(s.coordinator.getSnapshot().status).toBe('pending');
    await s.coordinator.runNow(); expect(s.snapshots).toHaveLength(2); expect(s.snapshots[1].library.books).toHaveLength(2);
  });
  it('requires explicit choice for first connection and preserves both copies through resolution', async () => {
    const s = await setup(); const local = book('Local'); await s.repository.commit({ kind: 'put', book: local }, await s.repository.readRevision());
    const remote = await snap(data([book('Remoto')])); s.snapshots.push(remote);
    await s.coordinator.runNow(); expect(s.coordinator.getSnapshot().status).toBe('conflict'); expect(s.remote.upload).not.toHaveBeenCalled();
    await s.coordinator.resolve(remote.snapshotId);
    expect((await s.repository.readAll()).books[0].title).toBe('Remoto');
    expect((await s.store.recovery())?.library.books[0].title).toBe('Local'); expect(s.snapshots).toHaveLength(2);
    expect(s.snapshots[1].resolvedSnapshotIds).toContain(remote.snapshotId);
  });
  it('downloads a sole descendant only if local is unchanged; a draft blocks replacement', async () => {
    const s = await setup(); await s.repository.commit({ kind: 'put', book: book('Base') }, await s.repository.readRevision()); await s.coordinator.runNow();
    s.snapshots.push(await snap(data([book('Nova')]), s.snapshots[0].snapshotId));
    s.options.hasDraft = () => true; await s.coordinator.runNow(); expect(s.coordinator.getSnapshot().status).toBe('conflict');
    expect((await s.repository.readAll()).books[0].title).toBe('Base');
    s.options.hasDraft = () => false; await s.coordinator.runNow(); expect((await s.repository.readAll()).books[0].title).toBe('Nova');
  });
  it('freezes an old account operation and asks before using another connection', async () => {
    const s = await setup(); await s.repository.commit({ kind: 'put', book: book() }, await s.repository.readRevision()); await s.coordinator.runNow();
    vi.mocked(s.auth.session).mockResolvedValue({ connectionId: 'another-account', generation: 1 });
    await s.coordinator.runNow(); expect(s.coordinator.getSnapshot()).toMatchObject({ status: 'conflict', accountChanged: true }); expect(s.remote.upload).toHaveBeenCalledTimes(1);
    await s.coordinator.disconnect(true); expect((await s.repository.readAll()).books).toHaveLength(1); expect((await s.store.read()).enabled).toBe(false);
  });
  it('rechecks heads and local revision before a selected conflict can overwrite anything', async () => {
    const s = await setup(); await s.repository.commit({ kind: 'put', book: book('Local') }, await s.repository.readRevision());
    const remote = await snap(data([book('Remoto')])); s.snapshots.push(remote); await s.coordinator.runNow();
    await s.repository.commit({ kind: 'put', book: book('Nova edição') }, await s.repository.readRevision());
    await s.coordinator.resolve(remote.snapshotId); expect((await s.repository.readAll()).books).toHaveLength(2); expect(s.remote.upload).not.toHaveBeenCalled();
  });
  it('serializes tabs with durable leases', async () => {
    const s = await setup(); await s.store.lease('another-tab'); await s.coordinator.runNow(); expect(s.auth.session).not.toHaveBeenCalled();
  });
  it('retries a durable explicit resolution of sibling heads after an interrupted upload', async () => {
    const s = await setup(); const root = await snap(data());
    s.snapshots.push(root, await snap(data([book('A')]), root.snapshotId), await snap(data([book('B')]), root.snapshotId));
    await s.coordinator.runNow(); expect(s.coordinator.getSnapshot().status).toBe('conflict');
    vi.mocked(s.remote.upload).mockRejectedValueOnce(new SyncError('retry'));
    await s.coordinator.resolve('local'); expect(await s.store.operation()).not.toBeNull();
    await s.store.write({ ...await s.store.read(), nextAttempt: 0 });
    await s.coordinator.runNow(); expect(s.coordinator.getSnapshot().status).toBe('synced');
    expect(remoteHeads(s.snapshots.map(file))).toHaveLength(1);
  });
  it('stops retry after five attempts and does not erase a local edit on authorization failure', async () => {
    const s = await setup(); await s.repository.commit({ kind: 'put', book: book() }, await s.repository.readRevision());
    await s.store.write({ ...await s.store.read(), attempts: 5 }); await s.coordinator.runNow(); expect(s.auth.session).not.toHaveBeenCalled();
    await s.store.write({ ...await s.store.read(), attempts: 0 }); vi.mocked(s.auth.session).mockRejectedValue(new SyncError('reconnect'));
    await s.coordinator.runNow(); expect(s.coordinator.getSnapshot().status).toBe('reconnect');
    expect((await s.repository.readAll()).books).toHaveLength(1); expect(await s.store.pending()).not.toBeNull();
  });
});
describe('network boundary', () => {
  it('reads pending revocation and rejects malformed success without retaining credentials', async () => {
    let malformed = false;
    const fetcher = vi.fn<typeof fetch>(async url => new Response(JSON.stringify(String(url).endsWith('/v1/session') ?
      { ...binding, csrfToken: 'csrf', expiresAt: Date.now() / 1000 + 86400 * 30, scopes: ['openid', DRIVE_SCOPE] } :
      malformed ? { disconnected: true } : { disconnected: true, revocationPending: true })));
    const auth = createAuthClient(fetcher);
    expect(await auth.disconnect(true)).toBe(true);
    await expect(auth.token(binding)).rejects.toMatchObject({ code: 'reconnect' });
    malformed = true;
    await expect(auth.disconnect(true)).rejects.toBeDefined();
    await expect(auth.token(binding)).rejects.toMatchObject({ code: 'reconnect' });
    expect(fetcher.mock.calls.every(([, init]) => init?.body === undefined)).toBe(true);
  });
  it('rewrites only known services to loopback in development, never arbitrary URLs', async () => {
    vi.stubEnv('DEV', true); vi.stubEnv('VITE_LOCAL_API_URL', 'http://127.0.0.1:8788');
    const fetcher = vi.fn<typeof fetch>(async () => new Response('{}')); vi.stubGlobal('fetch', fetcher);
    const transport = localTransport(); await transport('https://www.googleapis.com/drive/v3/files', { method: 'GET' });
    expect(fetcher.mock.calls[0][0]).toBe('http://127.0.0.1:8788/drive/v3/files');
    await expect(transport('https://evil.example')).rejects.toThrow('LocalHostRefused');
    vi.stubEnv('DEV', false); expect(() => localTransport()).toThrow('LocalModeUnavailable');
  });
  it('sends only empty control requests to auth, retaining access token in memory', async () => {
    const fetcher = vi.fn<typeof fetch>(async url => new Response(JSON.stringify(String(url).endsWith('/v1/session') ?
      { ...binding, csrfToken: 'csrf', expiresAt: Date.now() / 1000 + 86400 * 30, scopes: ['openid', DRIVE_SCOPE] } :
      { accessToken: 'synthetic-token', expiresIn: 3600, scopes: ['openid', DRIVE_SCOPE] }), { status: 200 }));
    const auth = createAuthClient(fetcher); await auth.session(); expect(await auth.token(binding)).toBe('synthetic-token'); await auth.token(binding);
    expect(fetcher).toHaveBeenCalledTimes(2);
    for (const [url, init] of fetcher.mock.calls) { expect(new URL(String(url)).origin).toBe('https://api.livroalivro.app.br'); expect(init?.body).toBeUndefined(); expect(init?.cache).toBe('no-store'); }
  });
  it('never follows an untrusted resumable URL with a bearer token', async () => {
    const auth = { token: vi.fn(async () => 'synthetic-token'), invalidate: vi.fn() } as unknown as AuthClient;
    const fetcher = vi.fn<typeof fetch>(async () => new Response('{}', { status: 200, headers: { Location: 'https://evil.example/upload' } }));
    const drive = createDriveClient(auth, binding, fetcher);
    await expect(drive.upload(await snap(data()), new AbortController().signal)).rejects.toMatchObject({ code: 'invalid' });
    expect(fetcher).toHaveBeenCalledTimes(1); expect(String(fetcher.mock.calls[0][0])).toMatch(/^https:\/\/www.googleapis.com\/upload\/drive/u);
    expect(fetcher.mock.calls[0][1]?.redirect).toBe('error'); expect(fetcher.mock.calls[0][1]?.credentials).toBe('omit');
  });
  it('downloads only bounded content and rejects malformed or unsupported metadata', async () => {
    const auth = { token: vi.fn(async () => 'synthetic-token'), invalidate: vi.fn() } as unknown as AuthClient;
    const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ files: [{ id: 'abc', size: '2', appProperties: { protocolVersion: '999' } }] })));
    await expect(createDriveClient(auth, binding, fetcher).list(new AbortController().signal)).rejects.toMatchObject({ code: 'invalid' });
  });
});
