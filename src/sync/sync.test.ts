import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
afterEach(() => { close.splice(0).forEach(stop => stop()); vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
async function setup() {
  const name = crypto.randomUUID(); const repository = await openLibraryRepository({ name, channelFactory: null, focusTarget: null });
  const media = await openCoverMediaRepository({ name });
  const store = await openSyncStore({ name }); const snapshots: SyncSnapshot[] = [];
  const auth: AuthClient = { session: vi.fn(async () => binding), token: vi.fn(async () => 'synthetic-token'), invalidate: vi.fn(), start: vi.fn(async () => 'https://accounts.google.com/o/oauth2/v2/auth'), disconnect: vi.fn(async () => {}) };
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
  it('moves local cover bytes only inside the direct Drive snapshot', async () => {
    const s = await setup(); const mediaId = 'a5f7ab9f-c2ed-4779-b274-f89ae62716ed';
    await s.media.put({ id: mediaId, mimeType: 'image/png', bytes: new Blob(['cover'], { type: 'image/png' }), width: 320, height: 480, createdAt: time });
    await s.repository.commit({ kind: 'put', book: createBook({ title: 'Com capa', cover: { provider: 'local', mediaId } }, { id: crypto.randomUUID(), now: time, shelfYear: 2026 }) }, await s.repository.readRevision());
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
