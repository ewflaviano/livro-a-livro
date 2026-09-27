import { utf8ByteLength } from '../domain/library';
import { assertPortableBudget, prepareBackupMedia, validateMediaCollection } from '../backup/media';
import type { LibraryRepository, LocalRevision } from '../ports/library-repository';
import { sameRevision } from '../adapters/indexeddb/schema';
import { SyncError, sameBinding, type AuthClient, type Binding, type DriveClient, type DriveFile, type SyncSnapshot, type SyncView, type AuthorizationIntent, type LoginSession } from './contracts';
import { libraryHash, remoteHeads } from './snapshot';
import type { SyncStore } from './outbox';
import type { LibraryExport } from '../backup/schema';
import { encodeCover } from '../adapters/indexeddb/cover-media';

type Options = { repository: LibraryRepository; store: SyncStore; auth: AuthClient; drive: (binding: Binding) => DriveClient;
  online: () => boolean; visible: () => boolean; hasDraft: () => boolean; navigate: (url: string) => void };
type Conflict = { binding: Binding; heads: DriveFile[]; version: LocalRevision; accountChanged: boolean };
const ids = (files: DriveFile[]) => files.map(file => file.header.snapshotId).sort().join(',');

export function createSyncCoordinator(options: Options) {
  const { repository, store, auth } = options;
  const listeners = new Set<() => void>(); const owner = crypto.randomUUID();
  let view: SyncView = { status: 'disabled', login: { status: 'checking' } }; let conflict: Conflict | null = null;
  let closed = false; let running = false; let controller: AbortController | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined; let polling: ReturnType<typeof setTimeout> | undefined;
  let firstEdit = 0; let lastPoll = 0;
  const publish = (next: SyncView) => { if (!closed) { view = { ...next, login: next.login ?? view.login, drivePromptDismissed: next.drivePromptDismissed ?? view.drivePromptDismissed, logoutUnconfirmed: next.logoutUnconfirmed ?? view.logoutUnconfirmed, revocationPending: next.revocationPending ?? view.revocationPending }; listeners.forEach(listener => listener()); } };
  const guard = async () => { if (!(await store.read()).enabled || closed || controller?.signal.aborted) throw new SyncError('cancelled'); await store.assertLease(owner); };
  async function library(): Promise<{ library: LibraryExport; version: LocalRevision }> {
    const snapshot = await repository.readBackupSnapshot();
    validateMediaCollection(snapshot.books, snapshot.coverMedia);
    assertPortableBudget(utf8ByteLength(JSON.stringify(snapshot.books)), snapshot.coverMedia);
    return { version: snapshot.version, library: { format: 'livro-a-livro', schemaVersion: 1, exportedAt: new Date().toISOString(),
      books: snapshot.books, preferences: snapshot.preferences, coverMedia: await Promise.all(snapshot.coverMedia.map(encodeCover)) } };
  }
  async function snapshot(data: LibraryExport, parent: string | null, resolved: string[] = []): Promise<SyncSnapshot> {
    return { format: 'livro-a-livro-sync', protocolVersion: 1, snapshotId: crypto.randomUUID(), operationId: crypto.randomUUID(),
      parentSnapshotId: parent, resolvedSnapshotIds: resolved, hash: await libraryHash(data), createdAt: new Date().toISOString(), library: data };
  }
  async function showConflict(binding: Binding, heads: DriveFile[], version: LocalRevision, accountChanged = false) {
    const drive = options.drive(binding); const remote = [];
    for (const head of heads) {
      const content = await drive.download(head, controller!.signal);
      remote.push({ snapshotId: head.header.snapshotId, count: content.library.books.length, createdAt: head.header.createdAt });
    }
    conflict = { binding, heads, version, accountChanged };
    publish({ status: 'conflict', localCount: (await repository.readAll()).books.length, remote, accountChanged });
  }
  async function accepted(head: DriveFile, version: LocalRevision) {
    await guard();
    conflict = null;
    await store.update({ base: { snapshotId: head.header.snapshotId, hash: head.header.hash }, attempts: 0, nextAttempt: 0, lastSyncedAt: new Date().toISOString() }, owner, false, version);
    const current = await repository.readRevision();
    await guard();
    publish(sameRevision(current, version) ? { status: 'synced', lastSyncedAt: new Date().toISOString() } : { status: 'pending' });
    if (!sameRevision(current, version)) schedule(1500);
  }
  async function transfer(binding: Binding, drive: DriveClient, heads: DriveFile[], local: Awaited<ReturnType<typeof library>>, signal: AbortSignal) {
    let operation = await store.operation();
    if (operation && !sameBinding(operation.binding, binding)) throw new SyncError('conflict');
    if (!operation) {
      operation = { binding, version: local.version, snapshot: await snapshot(local.library, heads[0]?.header.snapshotId ?? null) };
      await guard(); await store.saveOperation(operation, owner);
    }
    if (operation.snapshot.parentSnapshotId !== (heads[0]?.header.snapshotId ?? null) && !operation.snapshot.resolvedSnapshotIds.length) {
      await showConflict(binding, heads, local.version); return;
    }
    await guard(); await drive.upload(operation.snapshot, signal);
    await guard(); const confirmed = remoteHeads(await drive.list(signal));
    if (confirmed.length !== 1 || confirmed[0].header.snapshotId !== operation.snapshot.snapshotId || confirmed[0].header.hash !== operation.snapshot.hash) {
      await showConflict(binding, confirmed, local.version); return;
    }
    await accepted(confirmed[0], operation.version);
  }
  let loginRequest: Promise<void> | null = null; let loginAgain = false;
  const signedIn = (login: LoginSession) => ({ status: 'signed-in' as const, signInAttemptId: login.signInAttemptId, connectionId: login.connectionId });
  async function refreshLogin() {
    if (loginRequest) { loginAgain = true; return loginRequest; }
    loginRequest = (async () => {
      const before = await store.read();
      if (before.authorization) return;
      if (!options.online()) { publish({ ...view, login: { ...view.login, status: 'unavailable' } }); return; }
      try {
        const login = await auth.login();
        let driveAuthorized: boolean | undefined;
        try {
          const session = await auth.session(undefined, false);
          if (session.connectionId !== login.connectionId) throw new SyncError('invalid');
          driveAuthorized = true;
        } catch (error) { if (error instanceof SyncError && error.code === 'reconnect') driveAuthorized = false; }
        const current = await store.read();
        if (closed || current.authRevision !== before.authRevision || current.authorization) return;
        publish({ ...view, login: { ...signedIn(login), driveAuthorized }, drivePromptDismissed: current.drivePromptDismissedForSignIn === login.signInAttemptId,
          status: current.revocationPending ? 'reconnect' : driveAuthorized === false ? 'authorize-drive' : driveAuthorized === undefined ? 'error' : !current.enabled ? 'paused' : view.status });
      } catch (error) {
        const current = await store.read();
        if (closed || current.authRevision !== before.authRevision || current.authorization) return;
        const absent = error instanceof SyncError && error.code === 'reconnect';
        publish({ ...view, login: absent ? { status: 'signed-out' } : { ...view.login, status: 'unavailable' }, status: absent ? current.enabled ? 'reconnect' : 'disabled' : view.status });
      }
    })().finally(() => { loginRequest = null; if (loginAgain && !closed) { loginAgain = false; void refreshLogin(); } });
    return loginRequest;
  }
  async function inspectAuthorization(intent: AuthorizationIntent, signal: AbortSignal) {
    if (intent.stage === 'identity' || intent.stage === 'identity-starting') {
      await store.compareAuthorization(intent, { authorization: null }); publish({ status: 'authorization-expired', login: { status: 'signed-out' } }); return;
    }
    if (intent.stage === 'signin-starting' || intent.stage === 'drive-starting') { publish({ status: 'identifying' }); return; }
    const stage = intent.stage === 'signin' ? 'identity' : 'drive';
    if (!options.online()) { publish({ status: 'authorization-waiting', authorizationStage: stage, login: { ...view.login, status: 'unavailable' } }); return; }
    try {
      const login = await auth.login(signal);
      if (intent.stage === 'signin') {
        if (login.signInAttemptId !== intent.id) throw new SyncError('conflict');
        const completed = await store.compareAuthorization(intent, { authorization: null });
        if (closed || signal.aborted) return;
        const current = await store.read();
        if (closed || signal.aborted || current.authRevision !== completed.authRevision || current.authorization) return;
        publish({ status: 'authorize-drive', login: { ...signedIn(login), driveAuthorized: false }, drivePromptDismissed: current.drivePromptDismissedForSignIn === login.signInAttemptId, logoutUnconfirmed: false });
      } else if ('expectedConnection' in intent) {
        if (login.connectionId !== intent.expectedConnection) throw new SyncError('conflict');
        const session = await auth.session(signal);
        if (session.connectionId !== intent.expectedConnection) throw new SyncError('conflict');
        if (closed || signal.aborted) return;
        await store.compareAuthorization(intent, { authorization: null, enabled: true, revocationPending: false, attempts: 0, nextAttempt: 0 });
        publish({ status: 'pending', login: { ...signedIn(login), driveAuthorized: true }, revocationPending: false });
        await cycle(signal);
      }
    } catch (error) {
      if (closed || signal.aborted || error instanceof SyncError && error.code === 'cancelled') return;
      try { await store.compareAuthorization(intent, {}); } catch { return; }
      if (error instanceof SyncError && (error.code === 'retry' || error.code === 'reconnect' || error.code === 'drive-required')) publish({ status: 'authorization-waiting', authorizationStage: stage });
      else publish({ status: 'authorization-error', authorizationStage: stage });
    }
  }
  async function cycle(signal: AbortSignal) {
    if (closed || signal.aborted) return;
    let record = await store.read();
    if (record.authorization) { await inspectAuthorization(record.authorization, signal); return; }
    if (record.revocationPending) { publish({ status: 'reconnect', revocationPending: true }); return; }
    if (!record.enabled) { publish({ status: record.revocationPending ? 'reconnect' : view.login?.status === 'signed-in' ? view.login.driveAuthorized === false ? 'authorize-drive' : view.login.driveAuthorized === undefined ? 'error' : 'paused' : record.binding ? 'paused' : 'disabled', revocationPending: record.revocationPending }); return; }
    if (!options.online()) { publish({ status: 'offline' }); return; }
    if (!options.visible()) return;
    if (record.attempts >= 5) { publish({ status: 'error' }); return; }
    if (record.nextAttempt > Date.now()) { schedule(record.nextAttempt - Date.now()); return; }
    publish({ status: 'syncing' });
    const binding = await auth.session(signal);
    const drive = options.drive(binding);
    const files = await drive.list(signal); const heads = remoteHeads(files); const local = await library();
    if (record.binding && !sameBinding(record.binding, binding)) {
      await showConflict(binding, heads, local.version, true); return;
    }
    if (!record.binding) { record = { ...record, binding }; await guard(); await store.update({ binding }, owner); }
    const operation = await store.operation();
    if (operation && sameBinding(operation.binding, binding)) {
      const found = files.find(file => file.header.operationId === operation.snapshot.operationId);
      if (found && (found.header.hash !== operation.snapshot.hash || found.header.snapshotId !== operation.snapshot.snapshotId)) throw new SyncError('invalid');
      if (found && heads.length === 1 && heads[0].header.snapshotId === found.header.snapshotId) { await accepted(found, operation.version); return; }
      if (!record.base && operation.snapshot.resolvedSnapshotIds.length &&
        ids(heads) === [...operation.snapshot.resolvedSnapshotIds].sort().join(',')) {
        await transfer(binding, drive, heads, local, signal); return;
      }
    }
    if (heads.length > 1) { await showConflict(binding, heads, local.version); return; }
    const hash = await libraryHash(local.library); const remote = heads[0];
    if (remote?.header.hash === hash) { await accepted(remote, local.version); return; }
    if (!remote) {
      if (record.base) { await showConflict(binding, heads, local.version); return; }
      if (local.library.books.length) await transfer(binding, drive, heads, local, signal);
      else publish({ status: 'synced' });
      return;
    }
    if (!record.base) { await showConflict(binding, heads, local.version); return; }
    if (remote.header.snapshotId === record.base.snapshotId) { await transfer(binding, drive, heads, local, signal); return; }
    // The remote may advance only through a known ancestor, never via timestamps.
    const byId = new Map(files.map(file => [file.header.snapshotId, file]));
    const ancestors = new Set<string>(); const queue = [remote.header.snapshotId];
    while (queue.length) { const id = queue.pop()!; if (ancestors.has(id)) continue; ancestors.add(id);
      const h = byId.get(id)?.header; if (h) queue.push(...[h.parentSnapshotId, ...h.resolvedSnapshotIds].filter((x): x is string => x !== null)); }
    if (hash !== record.base.hash || !ancestors.has(record.base.snapshotId) || options.hasDraft()) { await showConflict(binding, heads, local.version); return; }
    const incoming = await drive.download(remote, signal);
    const recovery = await snapshot(local.library, record.base.snapshotId);
    await guard(); if (options.hasDraft()) { await showConflict(binding, heads, local.version); return; }
    await store.preserve(recovery, owner);
    const coverMedia = await prepareBackupMedia(incoming.library);
    await guard();
    if (options.hasDraft()) { await showConflict(binding, heads, local.version); return; }
    const version = await repository.commit({ kind: 'replace', books: incoming.library.books, preferences: incoming.library.preferences, coverMedia }, local.version, { syncLeaseOwner: owner });
    await accepted(remote, version);
  }
  async function locked(action: (signal: AbortSignal) => Promise<void>) {
    if (closed || running) return;
    running = true; controller = new AbortController();
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    try {
      if (!await store.lease(owner)) return;
      heartbeat = setInterval(() => { void store.lease(owner, false, true).then(ok => { if (!ok) controller?.abort(); }).catch(() => controller?.abort()); }, 10_000);
      await action(controller.signal);
    } catch (error) {
      const failure = error instanceof SyncError ? error : new SyncError('invalid');
      if (failure.code === 'cancelled' || closed || controller?.signal.aborted) return;
      if (failure.code === 'retry') {
        const record = await store.read(); const attempts = record.attempts + 1;
        const delay = Math.max(failure.retryAfter, Math.min(60_000, 1000 * 2 ** Math.min(attempts, 6)) * (0.8 + Math.random() * 0.2));
        try { await store.update({ attempts, nextAttempt: Date.now() + delay }, owner); } catch { return; }
        if (controller?.signal.aborted) return;
        publish({ status: 'pending' }); if (attempts < 5) schedule(delay);
      } else publish({ status: failure.code === 'drive-required' ? 'authorize-drive' : failure.code === 'reconnect' ? 'reconnect' : failure.code === 'quota' ? 'quota' : 'error' });
    } finally {
      if (heartbeat) clearInterval(heartbeat);
      await store.lease(owner, true).catch(() => {}); controller = null; running = false;
    }
  }
  function schedule(delay = 0) {
    if (closed) return;
    clearTimeout(timer); timer = setTimeout(() => { firstEdit = 0; void locked(cycle); }, delay);
  }
  const unsubscribe = repository.subscribe(() => {
    if (closed || conflict) return;
    firstEdit ||= Date.now(); schedule(Math.min(1500, Math.max(0, 10_000 - (Date.now() - firstEdit))));
  });
  function poll() {
    if (closed) return;
    polling = setTimeout(() => {
      if (options.visible() && options.online() && Date.now() - lastPoll >= 60_000 && !conflict) { lastPoll = Date.now(); schedule(); }
      poll();
    }, 60_000 + Math.random() * 10_000);
  }
  async function beginDrive() {
    const current = await store.read();
    if (current.authorization && !['drive', 'signin'].includes(current.authorization.stage)) throw new SyncError('cancelled');
    const login = await auth.login();
    if (closed) throw new SyncError('cancelled');
    if (current.authorization?.stage === 'signin' && login.signInAttemptId !== current.authorization.id) throw new SyncError('conflict');
    const intent: AuthorizationIntent = { id: crypto.randomUUID(), stage: 'drive-starting', expectedConnection: login.connectionId };
    await store.update({ enabled: false, authorization: intent }, undefined, true, undefined, current.authRevision);
    publish({ status: 'identifying', login: signedIn(login) });
    const destination = await auth.startDrive(intent.id);
    await store.compareAuthorization(intent, { authorization: { ...intent, stage: 'drive' } });
    if (!closed) options.navigate(destination);
  }
  async function pauseAuthorization() {
    controller?.abort(); clearTimeout(timer); conflict = null;
    const previous = await store.read();
    const record = await store.update({ enabled: false, authorization: null }, undefined, true);
    auth.invalidate();
    publish({ status: record.revocationPending ? 'reconnect' : record.binding ? 'paused' : 'disabled', revocationPending: record.revocationPending });
    if (previous.authorization) {
      await auth.cancelAuthorization(previous.authorization.id);
      if (['signin', 'signin-starting'].includes(previous.authorization.stage)) await auth.logout(previous.authorization.id);
      await store.update({ enabled: false }, undefined, true, undefined, record.authRevision);
    }
    await refreshLogin();
  }
  const unsubscribeControl = store.subscribe(() => { void refreshLogin(); schedule(); });
  return {
    getSnapshot: () => view,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    async start() { const record = await store.read(); if (record.attempts >= 5) await store.update({ attempts: 0 }); publish({ status: record.authorization ? 'identifying' : record.enabled ? 'pending' : record.revocationPending ? 'reconnect' : record.binding ? 'paused' : 'disabled', revocationPending: record.revocationPending }); await refreshLogin(); schedule(); poll(); },
    async wake() {
      if (closed || !options.visible()) return;
      await refreshLogin();
      const record = await store.read();
      // User/lifecycle retry starts a new bounded cycle, but respects Retry-After.
      if (record.attempts >= 5) await store.update({ attempts: 0 });
      if (!conflict && Date.now() - lastPoll >= 60_000) { lastPoll = Date.now(); schedule(); }
    },
    refreshLogin,
    async dismissDrivePrompt() {
      const id = view.login?.signInAttemptId;
      if (!id) return;
      publish({ ...view, drivePromptDismissed: true });
      const current = await store.read();
      await store.update({ drivePromptDismissedForSignIn: id }, undefined, false, undefined, current.authRevision);
    },
    async connect() {
      controller?.abort(); clearTimeout(timer); conflict = null; auth.invalidate();
      const intent: AuthorizationIntent = { id: crypto.randomUUID(), stage: 'signin-starting' };
      await store.update({ enabled: false, authorization: intent }, undefined, true);
      publish({ status: 'identifying', login: { status: 'checking' }, logoutUnconfirmed: false });
      const destination = await auth.startSignIn(intent.id, async () => { if (closed) throw new SyncError('cancelled'); await store.compareAuthorization(intent, {}); });
      await store.compareAuthorization(intent, { authorization: { id: intent.id, stage: 'signin' } });
      if (!closed) options.navigate(destination);
    },
    async authorizeDrive() { await beginDrive(); },
    async retryDriveAuthorization() { await beginDrive(); },
    async retryAuthorization() { if ((await store.read()).authorization) schedule(); else { await refreshLogin(); schedule(); } },
    async cancelAuthorization() { await pauseAuthorization(); },
    async pause() { await pauseAuthorization(); },
    async resume() {
      const current = await store.read();
      if (current.authorization) { schedule(); return; }
      if (current.revocationPending) throw new SyncError('reconnect');
      const record = await store.update({ enabled: true, attempts: 0 }); conflict = null; schedule(Math.max(0, record.nextAttempt - Date.now()));
    },
    async disconnect(all: boolean) {
      const previous = await store.read();
      const logoutLogin = view.login?.signInAttemptId ?? (previous.authorization && ['signin', 'signin-starting'].includes(previous.authorization.stage) ? previous.authorization.id : undefined);
      controller?.abort(); clearTimeout(timer);
      const record = await store.update({ enabled: false, authorization: null, ...(all ? { revocationPending: true } : {}) }, undefined, true);
      auth.invalidate();
      try {
        if (previous.authorization) await auth.cancelAuthorization(previous.authorization.id);
        if (all) {
          const pending = await auth.disconnect(true);
          const next = await store.update({ revocationPending: pending }, undefined, false, undefined, record.authRevision);
          publish({ status: next.revocationPending ? 'reconnect' : 'paused', revocationPending: next.revocationPending, login: view.login ? { ...view.login, driveAuthorized: false } : undefined });
        } else {
          if ((await store.read()).authRevision !== record.authRevision || closed) throw new SyncError('cancelled');
          await auth.logout(logoutLogin);
          if ((await store.read()).authRevision !== record.authRevision || closed) return;
          await store.update({ enabled: false }, undefined, true, undefined, record.authRevision);
          publish({ status: 'disabled', login: { status: 'signed-out' }, logoutUnconfirmed: false });
        }
      } catch {
        if ((await store.read()).authRevision === record.authRevision) publish({ status: 'paused', revocationPending: record.revocationPending, logoutUnconfirmed: !all });
        throw new SyncError('retry');
      }
    },
    async downloadRemote(id: string) {
      if (!conflict) throw new SyncError('conflict');
      const binding = await auth.session(); if (!sameBinding(conflict.binding, binding)) throw new SyncError('reconnect');
      const file = conflict.heads.find(head => head.header.snapshotId === id); if (!file) throw new SyncError('invalid');
      return (await options.drive(binding).download(file, new AbortController().signal)).library;
    },
    async localCopy() { return (await library()).library; },
    recoveryCopy: () => store.recovery(),
    async resolve(choice: 'local' | string) {
      const selected = conflict; if (!selected) return;
      await locked(async signal => {
        const binding = await auth.session(signal); if (!sameBinding(selected.binding, binding)) throw new SyncError('reconnect');
        const drive = options.drive(binding); const heads = remoteHeads(await drive.list(signal)); const local = await library();
        if (ids(heads) !== ids(selected.heads) || !sameRevision(local.version, selected.version)) { await showConflict(binding, heads, local.version, selected.accountChanged); return; }
        let data = local.library; let version = local.version;
        if (choice !== 'local') {
          const file = heads.find(head => head.header.snapshotId === choice); if (!file) throw new SyncError('invalid');
          data = (await drive.download(file, signal)).library;
        }
        await guard(); await store.preserve(await snapshot(local.library, null), owner);
        if (choice !== 'local') {
          if (options.hasDraft()) throw new SyncError('conflict');
          const coverMedia = await prepareBackupMedia(data);
          await guard();
          if (options.hasDraft()) throw new SyncError('conflict');
          version = await repository.commit({ kind: 'replace', books: data.books, preferences: data.preferences, coverMedia }, local.version, { syncLeaseOwner: owner });
        }
        const next = await snapshot(data, heads[0]?.header.snapshotId ?? null, heads.map(head => head.header.snapshotId));
        await guard(); await store.saveOperation({ binding, version, snapshot: next }, owner); await store.update({ binding, base: null }, owner);
        conflict = null; publish({ status: 'syncing' });
        await transfer(binding, drive, heads, { library: data, version }, signal);
      });
    },
    async runNow() { await locked(cycle); },
    close() { closed = true; controller?.abort(); clearTimeout(timer); clearTimeout(polling); unsubscribe(); unsubscribeControl(); listeners.clear(); auth.invalidate(); },
  };
}
export type SyncCoordinator = ReturnType<typeof createSyncCoordinator>;
