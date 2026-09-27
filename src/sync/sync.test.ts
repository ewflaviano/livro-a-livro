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
import { defaultSyncRecord, syncStateSchema, DRIVE_SCOPE, SyncError, type AuthClient, type Binding, type DriveClient, type DriveFile, type SyncSnapshot } from './contracts';
import type { LibraryExport } from '../backup/schema';
import { assertAuthorizationNavigationSafe } from '../app/authorization-navigation';
import { blockPwaUpdate } from '../pwa/register';
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
  let signInAttemptId = crypto.randomUUID();
  const auth: AuthClient = { session: vi.fn(async () => binding), token: vi.fn(async () => 'synthetic-token'), invalidate: vi.fn(), startSignIn: vi.fn(async (id: string) => { signInAttemptId = id as `${string}-${string}-${string}-${string}-${string}`; return 'https://accounts.google.com/o/oauth2/v2/auth'; }), login: vi.fn(async () => ({ connectionId: binding.connectionId, signInAttemptId, expiresAt: Date.now() / 1000 + 30 * 86400, absoluteExpiresAt: Date.now() / 1000 + 180 * 86400, csrfToken: 'login-csrf' })), startDrive: vi.fn(async () => 'https://accounts.google.com/o/oauth2/v2/auth'), cancelAuthorization: vi.fn(async () => {}), logout: vi.fn(async () => {}), disconnect: vi.fn(async () => false) };
  const drive: DriveClient = { list: vi.fn(async () => snapshots.map(file)), download: vi.fn(async head => snapshots.find(item => item.snapshotId === head.header.snapshotId)!), upload: vi.fn(async value => { snapshots.push(value); }) };
  const options = { repository, media, store, auth, drive: () => drive, online: () => true, visible: () => true, hasDraft: () => false, navigate: vi.fn() };
  const coordinator = createSyncCoordinator(options);
  close.push(() => { coordinator.close(); repository.close(); media.close(); store.close(); });
  await store.write({ ...defaultSyncRecord, enabled: true });
  return { ...options, name, options, coordinator, snapshots, remote: drive };
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
  it('restores login without enabling Drive, preserves dismissal on reload and offers a new login again', async () => {
    const s = await setup(); await s.store.update({ enabled: false });
    await s.coordinator.refreshLogin();
    expect(s.coordinator.getSnapshot().login?.status).toBe('signed-in');
    expect(s.remote.list).not.toHaveBeenCalled(); expect((await s.store.read()).enabled).toBe(false);
    await s.coordinator.dismissDrivePrompt();
    const other = createSyncCoordinator(s.options); close.push(() => other.close());
    await other.refreshLogin(); expect(other.getSnapshot().drivePromptDismissed).toBe(true);
    await other.connect(); await other.runNow();
    expect(other.getSnapshot().drivePromptDismissed).toBe(false);
    expect((await s.store.read()).enabled).toBe(false); expect(s.auth.startDrive).not.toHaveBeenCalled();
  });
  it('shares the Drive invitation dismissal across two open stores without granting permission', async () => {
    const s = await setup(); await s.store.update({ enabled: false });
    vi.mocked(s.auth.session).mockRejectedValue(new SyncError('reconnect'));
    const store = await openSyncStore({ name: s.name });
    const other = createSyncCoordinator({ ...s.options, store }); close.push(() => { other.close(); store.close(); });
    await s.coordinator.refreshLogin(); await other.refreshLogin();
    expect(other.getSnapshot()).toMatchObject({ status: 'authorize-drive', login: { status: 'signed-in', driveAuthorized: false } });
    await s.coordinator.dismissDrivePrompt();
    await vi.waitFor(() => expect(other.getSnapshot().drivePromptDismissed).toBe(true));
    expect((await store.read()).enabled).toBe(false); expect(s.remote.list).not.toHaveBeenCalled();
  });
  it('treats Drive status network failure as unknown, not missing permission', async () => {
    const s = await setup(); await s.store.update({ enabled: false });
    vi.mocked(s.auth.session).mockRejectedValue(new SyncError('retry'));
    await s.coordinator.refreshLogin();
    expect(s.coordinator.getSnapshot()).toMatchObject({ status: 'error', login: { status: 'signed-in' } });
    expect(s.coordinator.getSnapshot().login?.driveAuthorized).toBeUndefined();
    expect(s.remote.list).not.toHaveBeenCalled();
  });
  it.each(['same', 'newer'] as const)('cancels a completed sign-in after attempt expiry while preserving a %s login correctly', async kind => {
    const s = await setup(); const attemptId = crypto.randomUUID();
    const loginId = kind === 'same' ? attemptId : crypto.randomUUID(); let alive = true;
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith('/authorization') || !alive) return new Response('{}', { status: 401 });
      if (path === '/v1/login' && init?.method === 'DELETE') { alive = false; return new Response(null, { status: 204 }); }
      if (path === '/v1/login') return new Response(JSON.stringify({ connectionId: binding.connectionId, signInAttemptId: loginId, expiresAt: Date.now() / 1000 + 30 * 86400, absoluteExpiresAt: Date.now() / 1000 + 180 * 86400, csrfToken: 'captured-login' }));
      return new Response('{}', { status: 401 });
    });
    const other = createSyncCoordinator({ ...s.options, auth: createAuthClient(fetcher) }); close.push(() => other.close());
    await s.store.update({ enabled: false, authorization: { id: attemptId, stage: 'signin' } });
    if (kind === 'same') await other.cancelAuthorization();
    else await expect(other.cancelAuthorization()).rejects.toMatchObject({ code: 'cancelled' });
    expect(alive).toBe(kind === 'newer');
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'DELETE')).toHaveLength(kind === 'same' ? 1 : 0);
    expect(await s.store.read()).toMatchObject({ enabled: false, authorization: null });
  });
  it('does not publish a completed sign-in after another coordinator logs out during the final control read', async () => {
    const s = await setup(); await s.coordinator.connect();
    const read = s.store.read.bind(s.store); const compare = s.store.compareAuthorization.bind(s.store);
    let completed = false;
    let entered!: () => void; const ready = new Promise<void>(resolve => { entered = resolve; });
    let release!: () => void; const waiting = new Promise<void>(resolve => { release = resolve; });
    vi.spyOn(s.store, 'compareAuthorization').mockImplementation(async (intent, patch) => {
      const result = await compare(intent, patch);
      if (intent.stage === 'signin' && patch.authorization === null) completed = true;
      return result;
    });
    vi.spyOn(s.store, 'read').mockImplementation(async () => {
      if (completed) { completed = false; entered(); await waiting; }
      return read();
    });
    const other = createSyncCoordinator({ ...s.options, store: { ...s.store, read } }); close.push(() => other.close());
    const inspection = s.coordinator.runNow(); await ready;
    vi.mocked(s.auth.logout).mockImplementationOnce(async () => { vi.mocked(s.auth.login).mockRejectedValue(new SyncError('reconnect')); });
    await other.disconnect(false);
    release(); await inspection;
    expect(s.coordinator.getSnapshot().login?.status).not.toBe('signed-in');
    expect(s.coordinator.getSnapshot().status).not.toBe('authorize-drive');
    expect(await read()).toMatchObject({ enabled: false, authorization: null });
    expect(s.remote.list).not.toHaveBeenCalled();
  });
  it('reports login renewal rejection as unavailable and does not start anonymous OAuth', async () => {
    const s = await setup(); await s.store.update({ enabled: false });
    const fetcher = vi.fn<typeof fetch>(async input => String(input).endsWith('/renew')
      ? new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 })
      : new Response(JSON.stringify({ connectionId: binding.connectionId, signInAttemptId: crypto.randomUUID(), expiresAt: Date.now() / 1000 + 60, absoluteExpiresAt: Date.now() / 1000 + 180 * 86400, csrfToken: 'login-only' })));
    const auth = createAuthClient(fetcher);
    const other = createSyncCoordinator({ ...s.options, auth }); close.push(() => other.close());
    await other.refreshLogin();
    expect(other.getSnapshot().login?.status).toBe('unavailable');
    await expect(auth.startSignIn(crypto.randomUUID())).rejects.toMatchObject({ code: 'invalid' });
    expect(fetcher.mock.calls.some(([url]) => String(url).endsWith('/auth/google/start'))).toBe(false);
    expect((await s.store.read()).enabled).toBe(false); expect(s.remote.list).not.toHaveBeenCalled();
  });
  it('does not accept a login callback belonging to another sign-in attempt', async () => {
    const s = await setup(); await s.coordinator.connect();
    const login = await s.auth.login();
    vi.mocked(s.auth.login).mockResolvedValue({ ...login, signInAttemptId: crypto.randomUUID() });
    await s.coordinator.runNow();
    expect(s.coordinator.getSnapshot().status).toBe('authorization-error');
    expect((await s.store.read()).enabled).toBe(false); expect(s.remote.list).not.toHaveBeenCalled();
  });
  it('keeps an honest unavailable login offline without modifying saved sync permission', async () => {
    const s = await setup(); await s.store.update({ enabled: false }); s.options.online = () => false;
    await s.coordinator.refreshLogin();
    expect(s.coordinator.getSnapshot().login?.status).toBe('unavailable');
    expect(s.auth.login).not.toHaveBeenCalled(); expect((await s.store.read()).enabled).toBe(false);
  });
  it('reports unconfirmed logout on network failure and never resumes automatically on reload', async () => {
    const s = await setup(); await s.coordinator.refreshLogin();
    vi.mocked(s.auth.logout).mockRejectedValue(new SyncError('retry'));
    await expect(s.coordinator.disconnect(false)).rejects.toMatchObject({ code: 'retry' });
    expect(s.coordinator.getSnapshot()).toMatchObject({ logoutUnconfirmed: true, login: { status: 'signed-in' } });
    const other = createSyncCoordinator(s.options); close.push(() => other.close());
    await other.refreshLogin(); await other.runNow();
    expect(other.getSnapshot().login?.status).toBe('signed-in'); expect((await s.store.read()).enabled).toBe(false);
    expect(s.remote.list).not.toHaveBeenCalled();
  });
  it('retains the known login for an explicit logout retry after a failed focus check', async () => {
    const s = await setup(); await s.coordinator.refreshLogin(); const id = s.coordinator.getSnapshot().login?.signInAttemptId;
    vi.mocked(s.auth.login).mockRejectedValueOnce(new SyncError('retry'));
    await s.coordinator.refreshLogin();
    expect(s.coordinator.getSnapshot().login).toMatchObject({ status: 'unavailable', signInAttemptId: id });
    await s.coordinator.disconnect(false); expect(s.auth.logout).toHaveBeenCalledWith(id);
  });
  it('fences a login read started in another tab while logout was pending', async () => {
    const s = await setup(); await s.coordinator.refreshLogin();
    const login = await s.auth.login();
    let entered!: () => void; const ready = new Promise<void>(resolve => { entered = resolve; });
    let finish!: () => void; const waiting = new Promise<void>(resolve => { finish = resolve; });
    vi.mocked(s.auth.logout).mockImplementationOnce(async () => { entered(); await waiting; });
    const logout = s.coordinator.disconnect(false); await ready;
    let readEntered!: () => void; const readReady = new Promise<void>(resolve => { readEntered = resolve; });
    let release!: () => void; const delayed = new Promise<void>(resolve => { release = resolve; });
    vi.mocked(s.auth.login).mockImplementationOnce(async () => { readEntered(); await delayed; return login; });
    const other = createSyncCoordinator(s.options); close.push(() => other.close());
    const checking = other.refreshLogin(); await readReady;
    finish(); await logout; release(); await checking;
    expect(other.getSnapshot().login?.status).not.toBe('signed-in');
    expect(s.coordinator.getSnapshot().login?.status).toBe('signed-out');
    expect((await s.store.read()).enabled).toBe(false);
  });
  it('cancels the captured pending sign-in during logout even without a login session', async () => {
    const s = await setup(); await s.coordinator.connect(); const intent = (await s.store.read()).authorization;
    await s.coordinator.disconnect(false);
    expect(s.auth.cancelAuthorization).toHaveBeenCalledWith(intent?.id);
    expect(s.coordinator.getSnapshot().login?.status).toBe('signed-out');
  });

  it.each(['connect', 'authorizeDrive'] as const)('preserves a new draft when %s finishes its request late', async action => {
    const s = await setup();
    if (action === 'authorizeDrive') await s.coordinator.connect();
    const navigation = vi.fn();
    s.navigate.mockImplementation(() => { assertAuthorizationNavigationSafe(); navigation(); });
    let entered!: () => void; const ready = new Promise<void>(resolve => { entered = resolve; });
    let finish!: () => void; const wait = new Promise<void>(resolve => { finish = resolve; });
    vi.mocked(s.auth[action === 'connect' ? 'startSignIn' : 'startDrive']).mockImplementationOnce(async () => {
      entered(); await wait; return 'https://accounts.google.com/o/oauth2/v2/auth';
    });
    const request = s.coordinator[action]();
    const rejected = expect(request).rejects.toMatchObject({ code: 'cancelled' });
    await ready;
    const release = blockPwaUpdate();
    try {
      finish(); await rejected;
      expect(navigation).not.toHaveBeenCalled();
      expect((await s.store.read()).enabled).toBe(false);
      await s.coordinator.cancelAuthorization();
      expect((await s.store.read()).authorization).toBeNull();
    } finally { release(); }
  });
  it('does not inspect an older identity while the new sign-in start request is pending', async () => {
    const s = await setup();
    let entered!: () => void; const ready = new Promise<void>(resolve => { entered = resolve; });
    let release!: () => void; const wait = new Promise<void>(resolve => { release = resolve; });
    vi.mocked(s.auth.startSignIn).mockImplementationOnce(async () => { entered(); await wait; return 'https://accounts.google.com/o/oauth2/v2/auth'; });
    vi.mocked(s.auth.login).mockResolvedValue({ connectionId: 'older-account', signInAttemptId: crypto.randomUUID(), absoluteExpiresAt: Date.now() / 1000 + 180 * 86400, expiresAt: Date.now() / 1000 + 600, csrfToken: 'older-csrf' });
    const connecting = s.coordinator.connect(); const outcome = connecting.catch(() => {}); await ready;
    const other = createSyncCoordinator(s.options); close.push(() => other.close());
    const intent = (await s.store.read()).authorization;
    expect(intent?.stage).toBe('signin-starting');
    await other.runNow(); await other.runNow();
    expect(other.getSnapshot().status).toBe('identifying');
    expect((await s.store.read()).authorization).toEqual(intent);
    expect(s.auth.login).not.toHaveBeenCalled(); expect(s.auth.session).not.toHaveBeenCalled();
    expect(s.remote.list).not.toHaveBeenCalled(); expect(s.navigate).not.toHaveBeenCalled();
    await expect(other.authorizeDrive()).rejects.toMatchObject({ code: 'cancelled' });
    await other.pause(); release(); await outcome;
    expect(await s.store.read()).toMatchObject({ enabled: false, authorization: null });
    expect(s.navigate).not.toHaveBeenCalled();
  });
  it('returns to an explicit second step without reusing an existing Drive session', async () => {
    const s = await setup();
    await s.coordinator.connect();
    expect(await s.store.read()).toMatchObject({ enabled: false, authorization: { stage: 'signin' } });
    await s.coordinator.runNow();
    expect(s.coordinator.getSnapshot().status).toBe('authorize-drive');
    expect(s.auth.session).not.toHaveBeenCalled(); expect(s.remote.list).not.toHaveBeenCalled();
    expect(s.navigate).toHaveBeenCalledTimes(1);
    await s.coordinator.authorizeDrive();
    expect(await s.store.read()).toMatchObject({ enabled: false, authorization: { stage: 'drive', expectedConnection: binding.connectionId } });
    expect(s.navigate).toHaveBeenCalledTimes(2);
    await s.coordinator.runNow();
    expect(await s.store.read()).toMatchObject({ enabled: true, authorization: null });
    expect(s.remote.list).toHaveBeenCalledTimes(1);
  });
  it('refuses a complete session for a different account and offers only explicit retry', async () => {
    const s = await setup(); await s.coordinator.connect(); await s.coordinator.authorizeDrive();
    vi.mocked(s.auth.session).mockResolvedValue({ connectionId: 'different', generation: 1 });
    await s.coordinator.runNow();
    expect((await s.store.read()).enabled).toBe(false); expect(s.remote.list).not.toHaveBeenCalled();
    expect(s.coordinator.getSnapshot().status).toBe('authorization-error');
    expect(s.navigate).toHaveBeenCalledTimes(2);
  });
  it('does not reset or redirect a Drive intent while another tab is still awaiting consent', async () => {
    const s = await setup(); await s.coordinator.connect(); await s.coordinator.authorizeDrive();
    const intent = (await s.store.read()).authorization;
    vi.mocked(s.auth.session).mockRejectedValue(new SyncError('reconnect'));
    vi.mocked(s.auth.login).mockClear();
    const other = createSyncCoordinator(s.options); close.push(() => other.close());
    await other.runNow(); await other.runNow();
    expect((await s.store.read()).authorization).toEqual(intent);
    expect(s.auth.login).toHaveBeenCalledTimes(2); expect(s.navigate).toHaveBeenCalledTimes(2);
    expect(other.getSnapshot()).toMatchObject({ status: 'authorization-waiting', authorizationStage: 'drive' });
    await other.retryDriveAuthorization();
    expect((await s.store.read()).authorization?.id).not.toBe(intent?.id);
    expect((await s.store.read()).enabled).toBe(false);
    expect(s.navigate).toHaveBeenCalledTimes(3); expect(s.remote.list).not.toHaveBeenCalled();
  });
  it('preserves the incomplete intent offline and does not label temporary network failure as expiry', async () => {
    const s = await setup(); await s.coordinator.connect();
    s.options.online = () => false; await s.coordinator.runNow();
    expect(s.coordinator.getSnapshot().status).toBe('authorization-waiting'); expect(s.auth.login).not.toHaveBeenCalled();
    s.options.online = () => true; vi.mocked(s.auth.login).mockRejectedValue(new SyncError('retry'));
    await s.coordinator.runNow(); expect(s.coordinator.getSnapshot().status).toBe('authorization-waiting');
    expect((await s.store.read()).enabled).toBe(false); expect(s.remote.list).not.toHaveBeenCalled();
  });
  it.each(['startSignIn', 'login', 'startDrive', 'session'] as const)('fences late %s after pause, logout or a new attempt in another tab', async boundary => {
    for (const action of ['pause', 'logout', 'new-attempt'] as const) {
      const s = await setup();
      if (boundary !== 'startSignIn') await s.coordinator.connect();
      if (boundary === 'session') await s.coordinator.authorizeDrive();
      vi.mocked(s.navigate).mockClear();
      let entered!: () => void; const ready = new Promise<void>(resolve => { entered = resolve; });
      let release!: () => void; const wait = new Promise<void>(resolve => { release = resolve; });
      if (boundary === 'startSignIn' || boundary === 'startDrive') vi.mocked(s.auth[boundary]).mockImplementationOnce(async () => { entered(); await wait; return 'https://accounts.google.com/o/oauth2/v2/auth'; });
      else if (boundary === 'login') vi.mocked(s.auth.login).mockImplementationOnce(async () => { entered(); await wait; return { connectionId: binding.connectionId, signInAttemptId: crypto.randomUUID(), absoluteExpiresAt: Date.now() / 1000 + 180 * 86400, expiresAt: Date.now() / 1000 + 600, csrfToken: 'synthetic' }; });
      else vi.mocked(s.auth.session).mockImplementationOnce(async () => { entered(); await wait; return binding; });
      const operation = boundary === 'startSignIn' ? s.coordinator.connect() : boundary === 'startDrive' ? s.coordinator.authorizeDrive() : s.coordinator.runNow();
      const outcome = operation.catch(() => {}); await ready;
      const other = createSyncCoordinator(s.options); close.push(() => other.close());
      if (action === 'pause') await other.pause(); else if (action === 'logout') await other.disconnect(false); else await other.connect();
      const expected = (await s.store.read()).authorization;
      release(); await outcome;
      expect(await s.store.read()).toMatchObject({ enabled: false, authorization: expected });
      expect(s.navigate).toHaveBeenCalledTimes(action === 'new-attempt' ? 1 : 0);
      expect(s.remote.list).not.toHaveBeenCalled(); expect(s.remote.upload).not.toHaveBeenCalled();
    }
  });
  it('parses earlier control records without clearing bindings, base or outbox state', () => {
    const { authorization: _, ...previous } = { ...defaultSyncRecord, enabled: true, binding };
    expect(syncStateSchema.parse(previous)).toEqual({ ...previous, authorization: null });
  });
  it('cancels the first authorization into the optional disconnected state', async () => {
    const s = await setup(); await s.coordinator.connect(); vi.mocked(s.auth.login).mockRejectedValue(new SyncError('reconnect')); await s.coordinator.cancelAuthorization();
    expect(s.coordinator.getSnapshot().status).toBe('disabled');
    expect(await s.store.read()).toMatchObject({ enabled: false, authorization: null });
  });
  it('rejects resume against an incomplete intent atomically', async () => {
    const s = await setup(); await s.coordinator.connect();
    await expect(s.store.update({ enabled: true })).rejects.toMatchObject({ code: 'cancelled' });
    expect((await s.store.read()).enabled).toBe(false);
  });

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
    vi.mocked(s.auth.startSignIn).mockRejectedValueOnce(new SyncError('retry'));
    await expect(reopened.connect()).rejects.toMatchObject({ code: 'retry' });
    expect(await s.store.read()).toMatchObject({ enabled: false, revocationPending: true });
    await reopened.connect();
    expect(await s.store.read()).toMatchObject({ enabled: false, revocationPending: true, authorization: { stage: 'signin' } });
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
    expect(s.coordinator.getSnapshot().status).toBe(action === 'disconnect' ? 'disabled' : 'paused');
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
  it('uses login CSRF for Drive and cancels only the captured authorization attempt', async () => {
    const id = crypto.randomUUID(); let current = id;
    const fetcher = vi.fn<typeof fetch>(async (url, init) => {
      if (init?.method === 'DELETE') return new Response(null, { status: 204 });
      const path = new URL(String(url)).pathname;
      return new Response(JSON.stringify(path === '/v1/login' ? { connectionId: binding.connectionId, signInAttemptId: id, expiresAt: Date.now() / 1000 + 30 * 86400, absoluteExpiresAt: Date.now() / 1000 + 180 * 86400, csrfToken: 'login-only' } : path.endsWith('/authorization') ? { attemptId: current, purpose: 'drive', expiresAt: Date.now() / 1000 + 600, csrfToken: 'cancel-only' } : { authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth' }));
    });
    const auth = createAuthClient(fetcher);
    await auth.login(); await auth.startDrive(id); await auth.cancelAuthorization(id);
    const calls = fetcher.mock.calls;
    expect(calls.every(([, init]) => init?.body === undefined && init?.credentials === 'include')).toBe(true);
    expect(calls[1][1]?.headers).toMatchObject({ 'x-lal-csrf': 'login-only', 'x-lal-attempt': id });
    expect(calls[3][1]).toMatchObject({ method: 'DELETE', headers: { 'x-lal-csrf': 'cancel-only', 'x-lal-attempt': id } });
    current = crypto.randomUUID(); await auth.cancelAuthorization(id);
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'DELETE')).toHaveLength(1);
  });
  it.each([403, 500])('does not confirm logout when DELETE login returns %s, and never renews to log out', async status => {
    const id = crypto.randomUUID();
    const fetcher = vi.fn<typeof fetch>(async (_, init) => new Response(JSON.stringify(init?.method === 'DELETE' ? { error: 'forbidden' } : { connectionId: binding.connectionId, signInAttemptId: id, expiresAt: Date.now() / 1000 + 60, absoluteExpiresAt: Date.now() / 1000 + 86400, csrfToken: 'synthetic' }), { status: init?.method === 'DELETE' ? status : 200 }));
    await expect(createAuthClient(fetcher).logout(id)).rejects.toBeInstanceOf(SyncError);
    expect(fetcher.mock.calls.map(([url]) => new URL(String(url)).pathname)).toEqual(['/v1/login', '/v1/login']);
  });
  it('refuses to delete a new login discovered by a delayed logout', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ connectionId: binding.connectionId, signInAttemptId: crypto.randomUUID(), expiresAt: Date.now() / 1000 + 86400, absoluteExpiresAt: Date.now() / 1000 + 180 * 86400, csrfToken: 'new-login' })));
    await expect(createAuthClient(fetcher).logout(crypto.randomUUID())).rejects.toMatchObject({ code: 'cancelled' });
    expect(fetcher).toHaveBeenCalledOnce(); expect(fetcher.mock.calls[0][1]?.method).toBe('GET');
  });
  it('checks the local attempt again after login discovery and before a sign-in start POST', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response('{}', { status: 401 }));
    const guard = vi.fn(async () => { throw new SyncError('cancelled'); });
    await expect(createAuthClient(fetcher).startSignIn(crypto.randomUUID(), guard)).rejects.toMatchObject({ code: 'cancelled' });
    expect(fetcher).toHaveBeenCalledOnce(); expect(fetcher.mock.calls[0][1]?.method).toBe('GET');
  });
  it('renews login before expiry with login-only CSRF and preserves the absolute deadline', async () => {
    const id = crypto.randomUUID(); const now = Date.now() / 1000; const absolute = now + 180 * 86400;
    const fetcher = vi.fn<typeof fetch>(async url => new Response(JSON.stringify(String(url).endsWith('/renew') ? { expiresAt: now + 30 * 86400, absoluteExpiresAt: absolute, csrfToken: 'renewed' } : { connectionId: binding.connectionId, signInAttemptId: id, expiresAt: now + 60, absoluteExpiresAt: absolute, csrfToken: 'login-only' })));
    const login = await createAuthClient(fetcher).login();
    expect(login.signInAttemptId).toBe(id); expect(login.absoluteExpiresAt).toBe(absolute);
    expect(fetcher.mock.calls[1][1]).toMatchObject({ method: 'POST', headers: { 'x-lal-csrf': 'login-only' } });
    expect(fetcher.mock.calls.every(([url]) => !String(url).includes('/session'))).toBe(true);
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
