import { canonicalJson, headerOf, sameHeader, type SyncSnapshotV2 } from './protocol';
import type { SyncCommitFence, SyncResolutionRepository } from '../ports/sync-resolution-repository';
import { prepareMerge, materializeUnion, unionPolicy, type PreparedMerge } from './merge';
import { utf8ByteLength } from '../domain/library';
import { assertPortableBudget, prepareBackupMedia, validateMediaCollection } from '../backup/media';
import type { LibraryRepository, LocalRevision } from '../ports/library-repository';
import { sameRevision } from '../adapters/indexeddb/schema';
import { SyncError, sameBinding, type AuthClient, type Binding, type DriveClient, type DriveFile, type SyncSnapshot, type SyncView, type AuthorizationIntent, type LoginSession } from './contracts';
import { libraryHashV2, parseSnapshot, referencedExport, remoteHeads } from './snapshot';
import type { SyncStore } from './outbox';
import type { LibraryExport } from '../backup/schema';
import { encodeCover } from '../adapters/indexeddb/cover-media';

type Options = { resolutionRepository: SyncResolutionRepository; repository: LibraryRepository; store: SyncStore; auth: AuthClient; drive: (binding: Binding) => DriveClient;
  online: () => boolean; visible: () => boolean; hasDraft: () => boolean; navigate: (url: string) => void; holdReload?: () => (() => void) | null };
type Conflict = { binding: Binding; heads: DriveFile[]; version: LocalRevision; accountChanged: boolean };
const ids = (files: DriveFile[]) => files.map(file => file.header.snapshotId).sort().join(',');
const fingerprint = (files: DriveFile[]) => canonicalJson(files.map(file => file.header).sort((a,b) => a.snapshotId < b.snapshotId ? -1 : 1));
const MAX_RESOLUTION_BYTES = 100 * 1024 * 1024;

export function createSyncCoordinator(options: Options) {
  const { repository, store, auth } = options;
  const acquireReloadHold = () => { const release = options.holdReload?.(); if (release === null) throw new SyncError('cancelled'); return release ?? (() => {}); };
  function held<Args extends unknown[], Result>(action: (...args: Args) => Promise<Result>) {
    return async (...args: Args): Promise<Result> => { const release = acquireReloadHold(); try { return await action(...args); } finally { release(); } };
  }
  const listeners = new Set<() => void>(); const owner = crypto.randomUUID();
  let view: SyncView = { status: 'disabled', login: { status: 'checking' } }; let conflict: Conflict | null = null;
  let preview: { plan: PreparedMerge; context: Awaited<ReturnType<SyncStore['context']>>; binding: Binding; heads: DriveFile[]; local: Awaited<ReturnType<typeof library>> } | null = null;
  let preparationId = 0;
  let confirmationId: string | null = null;
  const ready = (signal: AbortSignal, id?: string) => { if (closed || signal.aborted || options.hasDraft() || id !== undefined && confirmationId !== id) throw new SyncError('cancelled'); };
  let closed = false; let running = false; let controller: AbortController | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined; let polling: ReturnType<typeof setTimeout> | undefined;
  let firstEdit = 0; let lastPoll = 0;
  const publish = (next: SyncView) => { if (!closed) { view = { ...next, login: next.login ?? view.login, drivePromptDismissed: next.drivePromptDismissed ?? view.drivePromptDismissed, logoutUnconfirmed: next.logoutUnconfirmed ?? view.logoutUnconfirmed, revocationPending: next.revocationPending ?? view.revocationPending }; listeners.forEach(listener => listener()); } };
  const guard = async () => { const current = await store.read(); if (!current.enabled || current.authorization || closed || controller?.signal.aborted) throw new SyncError('cancelled'); await store.assertLease(owner); };
  async function library(): Promise<{ library: LibraryExport; version: LocalRevision }> {
    const snapshot = await repository.readBackupSnapshot();
    validateMediaCollection(snapshot.books, snapshot.coverMedia);
    assertPortableBudget(utf8ByteLength(JSON.stringify(snapshot.books)), snapshot.coverMedia);
    return { version: snapshot.version, library: { format: 'livro-a-livro', schemaVersion: 1, exportedAt: new Date().toISOString(),
      books: snapshot.books, preferences: snapshot.preferences, coverMedia: await Promise.all(snapshot.coverMedia.map(encodeCover)) } };
  }
  async function snapshot(data: LibraryExport, parent: string | null, resolved: string[] = []): Promise<SyncSnapshotV2> {
    const portable = referencedExport(data);
    return { format: 'livro-a-livro-sync', protocolVersion: 2, snapshotId: crypto.randomUUID(), operationId: crypto.randomUUID(),
      parentSnapshotId: parent, resolvedSnapshotIds: resolved, hash: await libraryHashV2(portable), createdAt: new Date().toISOString(), library: portable };
  }
  function ancestor(files: DriveFile[], head: string, base: string) {
    const map = new Map(files.map(file => [file.header.snapshotId.toLowerCase(), file.header])); const seen = new Set<string>(); const queue = [head.toLowerCase()];
    while (queue.length) { const id = queue.pop()!; if (id === base.toLowerCase()) return true; if (seen.has(id)) continue; seen.add(id);
      const header = map.get(id); if (!header) throw new SyncError('invalid');
      queue.push(...[header.parentSnapshotId, ...header.resolvedSnapshotIds].filter((id): id is string => id !== null).map(id => id.toLowerCase())); }
    return false;
  }
  function fence(context: Awaited<ReturnType<SyncStore['context']>>): SyncCommitFence {
    return { expectedRevision: context.version, expectedAuthRevision: context.record.authRevision, expectedBinding: context.record.binding,
      expectedOperation: context.operation ? { binding: context.operation.binding, version: context.operation.version, header: headerOf(context.operation.snapshot) } : null,
      expectedPending: context.pending, leaseOwner: owner };
  }
  async function download(drive: DriveClient, file: DriveFile, signal: AbortSignal) {
    const content = await parseSnapshot(await drive.download(file, signal));
    if (!sameHeader(headerOf(content), file.header)) throw new SyncError('invalid');
    return content;
  }
  async function revalidate(binding: Binding, heads: DriveFile[], drive: DriveClient, signal: AbortSignal) {
    await guard(); if (options.hasDraft()) throw new SyncError('conflict');
    if (!sameBinding(binding, await auth.session(signal))) throw new SyncError('conflict');
    if (fingerprint(remoteHeads(await drive.list(signal))) !== fingerprint(heads)) throw new SyncError('conflict');
    await guard(); if (options.hasDraft()) throw new SyncError('conflict');
  }
  async function receive(binding: Binding, heads: DriveFile[], incoming: SyncSnapshot, local: Awaited<ReturnType<typeof library>>, context: Awaited<ReturnType<SyncStore['context']>>, drive: DriveClient, signal: AbortSignal) {
    publish({ status: 'receiving' });
    const media = await prepareBackupMedia(incoming.library); const recovery = await snapshot(local.library, context.record.base?.snapshotId ?? null);
    const comparisonHashV2 = await libraryHashV2(incoming.library);
    await revalidate(binding, heads, drive, signal);
    const version = await options.resolutionRepository.commit({ fence: fence(context), library: incoming.library, media, recovery,
      effect: { kind: 'receive', binding, head: headerOf(incoming), comparisonHashV2 } }, () => ready(signal));
    conflict = null; preview = null;
    const current = await repository.readRevision();
    await guard();
    publish(sameRevision(version, current) ? { status: 'synced', received: true, lastSyncedAt: new Date().toISOString() } : { status: 'pending' });
  }
  async function showConflict(binding: Binding, heads: DriveFile[], version: LocalRevision, accountChanged = false) {
    const drive = options.drive(binding); const remote = [];
    for (const head of heads) {
      const content = await download(drive, head, controller!.signal);
      remote.push({ snapshotId: head.header.snapshotId, count: content.library.books.length, createdAt: head.header.createdAt });
    }
    const localCount = (await repository.readAll()).books.length;
    await guard();
    conflict = { binding, heads, version, accountChanged };
    publish({ status: 'conflict', localCount, remote, accountChanged });
  }
  async function accepted(head: DriveFile, version: LocalRevision, comparisonHashV2: string) {
    await guard();
    conflict = null;
    await store.update({ base: { snapshotId: head.header.snapshotId, hash: head.header.hash, protocolVersion: head.header.protocolVersion, comparisonHashV2 }, attempts: 0, nextAttempt: 0, lastSyncedAt: new Date().toISOString() }, owner, false, version);
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
    await guard(); if (!sameBinding(binding, await auth.session(signal))) throw new SyncError('conflict');
    await guard(); await drive.upload(operation.snapshot, signal);
    await guard(); const confirmed = remoteHeads(await drive.list(signal));
    if (confirmed.length !== 1 || !sameHeader(confirmed[0].header, headerOf(operation.snapshot))) {
      await showConflict(binding, confirmed, local.version); return;
    }
    const persisted = await download(drive, confirmed[0], signal);
    if (await libraryHashV2(persisted.library) !== await libraryHashV2(operation.snapshot.library)) throw new SyncError('invalid');
    await accepted(confirmed[0], operation.version, await libraryHashV2(operation.snapshot.library));
  }
  let loginRequest: Promise<void> | null = null; let loginAgain = false;
  const signedIn = (login: LoginSession) => ({ status: 'signed-in' as const, signInAttemptId: login.signInAttemptId, connectionId: login.connectionId });
  const refreshLogin = held(async () => {
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
    })().finally(() => { loginRequest = null; if (loginAgain && !closed) { loginAgain = false; void refreshLogin().catch(() => {}); } });
    return loginRequest;
  });
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
    const context = await store.context();
    if (!sameRevision(context.version, local.version) || context.record.authRevision !== record.authRevision) throw new SyncError('conflict');
    record = context.record; await guard();
    if (record.binding && !sameBinding(record.binding, binding)) { await showConflict(binding, heads, local.version, true); return; }
    let baseContent: SyncSnapshot | null = null;
    if (record.base) {
      const baseFile = files.find(file => file.header.snapshotId === record.base!.snapshotId);
      if (!baseFile || baseFile.header.hash !== record.base.hash || baseFile.header.protocolVersion !== record.base.protocolVersion) throw new SyncError('invalid');
      baseContent = await download(drive, baseFile, signal);
      if (record.base.comparisonHashV2 && record.base.comparisonHashV2 !== await libraryHashV2(baseContent.library)) throw new SyncError('invalid');
    }
    const operation = context.operation;
    if (operation) {
      if (!sameBinding(operation.binding, binding)) { await showConflict(binding, heads, local.version, true); return; }
      const found = files.find(file => file.header.operationId.toLowerCase() === operation.snapshot.operationId.toLowerCase());
      if (found) {
        if (!sameHeader(found.header, headerOf(operation.snapshot))) throw new SyncError('invalid');
        const content = await download(drive, found, signal);
        if (await libraryHashV2(content.library) !== await libraryHashV2(operation.snapshot.library)) throw new SyncError('invalid');
        if (heads.length === 1 && heads[0].header.snapshotId === found.header.snapshotId) { await accepted(found, operation.version, await libraryHashV2(content.library)); return; }
        await showConflict(binding, heads, local.version); return;
      }
      const consumed = operation.snapshot.resolvedSnapshotIds;
      const retryable = consumed.length ? ids(heads) === [...consumed].sort().join(',') : heads.length <= 1 && operation.snapshot.parentSnapshotId === (heads[0]?.header.snapshotId ?? null);
      if (!retryable) { await showConflict(binding, heads, local.version); return; }
      if (!record.binding) { await guard(); await store.update({ binding }, owner); }
      await transfer(binding, drive, heads, local, signal); return;
    }
    if (heads.length > 1) { await showConflict(binding, heads, local.version); return; }
    const hash = await libraryHashV2(local.library); const remote = heads[0];
    if (!remote) {
      if (record.base) throw new SyncError('invalid');
      if (!record.binding) { await guard(); await store.update({ binding }, owner); }
      if (local.library.books.length || context.pending || local.version.revision > 0) await transfer(binding, drive, heads, local, signal);
      else { await guard(); publish({ status: 'connected-empty' }); }
      return;
    }
    const incoming = await download(drive, remote, signal); const remoteHash = await libraryHashV2(incoming.library);
    if (remoteHash === hash) {
      if (!record.binding) { await guard(); await store.update({ binding }, owner); }
      await accepted(remote, local.version, remoteHash); return;
    }
    const empty = !local.library.books.length && !record.base && !context.pending && local.version.revision === 0 &&
      canonicalJson(local.library.preferences) === canonicalJson({ shelfYear: null, mode: 'grid', filter: 'all' });
    if (empty && !options.hasDraft()) { await receive(binding, heads, incoming, local, context, drive, signal); return; }
    if (!record.base) { await showConflict(binding, heads, local.version); return; }
    if (remote.header.snapshotId === record.base.snapshotId) { await transfer(binding, drive, heads, local, signal); return; }
    if (!baseContent || hash !== await libraryHashV2(baseContent.library) || !ancestor(files, remote.header.snapshotId, record.base.snapshotId) || options.hasDraft()) { await showConflict(binding, heads, local.version); return; }
    await receive(binding, heads, incoming, local, context, drive, signal);
  }

  async function locked<Result>(action: (signal: AbortSignal) => Promise<Result>, rethrow = false): Promise<Result | undefined> {
    if (closed || running) { if (rethrow) throw new SyncError('conflict'); return; }
    let release: () => void;
    try { release = acquireReloadHold(); } catch (error) { if (rethrow) throw error; return; }
    running = true; controller = new AbortController();
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    try {
      if (!await store.lease(owner)) { if (rethrow) throw new SyncError('conflict'); return; }
      heartbeat = setInterval(() => { void store.lease(owner, false, true).then(ok => { if (!ok) controller?.abort(); }).catch(() => controller?.abort()); }, 10_000);
      return await action(controller.signal);
    } catch (error) {
      if (rethrow) throw error;
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
      await store.lease(owner, true).catch(() => {}); controller = null; running = false; release();
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
  const unsubscribeControl = store.subscribe(() => { void refreshLogin().catch(() => {}); schedule(); });
  const coordinator = {
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
    async prepareResolution() {
      const requestId = ++preparationId;
      const selected = conflict; if (!selected || options.hasDraft() || closed) throw new SyncError('conflict');
      const context = await store.context(); const local = await library();
      if (!context.record.enabled || context.record.authorization || !sameRevision(context.version, local.version)) throw new SyncError('conflict');
      const signal = new AbortController().signal; const binding = await auth.session(signal);
      if (!sameBinding(binding, selected.binding)) throw new SyncError('conflict');
      const drive = options.drive(binding); const files = await drive.list(signal); const heads = remoteHeads(files);
      const base = context.record.base && (!context.record.binding || sameBinding(context.record.binding, binding)) ? files.find(file => file.header.snapshotId === context.record.base!.snapshotId) : undefined;
      if (context.record.base && !selected.accountChanged && !base) throw new SyncError('invalid');
      const retained = [...heads]; if (base && !heads.some(file => file.header.snapshotId === base.header.snapshotId)) retained.push(base);
      const localBytes = utf8ByteLength(JSON.stringify(local.library));
      if (localBytes + retained.reduce((sum,file) => sum + file.size,0) > MAX_RESOLUTION_BYTES) throw new SyncError('merge-budget');
      let bytes = localBytes; const contents = new Map<string, SyncSnapshot>();
      for (const file of retained) { const content = await download(drive, file, signal); bytes += utf8ByteLength(JSON.stringify(content));
        if (bytes > MAX_RESOLUTION_BYTES) throw new SyncError('merge-budget'); contents.set(file.header.snapshotId, content); }
      let trusted: LibraryExport | undefined;
      if (base) {
        if (base.header.hash !== context.record.base!.hash || base.header.protocolVersion !== context.record.base!.protocolVersion) throw new SyncError('invalid');
        if (heads.every(head => ancestor(files, head.header.snapshotId, base.header.snapshotId))) trusted = contents.get(base.header.snapshotId)!.library;
      }
      const current = await store.context();
      if (requestId !== preparationId || closed || options.hasDraft() || canonicalJson(fence(current)) !== canonicalJson(fence(context))) throw new SyncError('conflict');
      const plan = prepareMerge({ id: crypto.randomUUID(), sources: [{ id: 'local', label: 'Neste dispositivo', library: local.library }, ...heads.map((head,index) => ({ id: head.header.snapshotId, label: `Drive — versão ${index + 1}`, library: contents.get(head.header.snapshotId)!.library }))], base: trusted, baseSourceId: trusted ? base?.header.snapshotId : undefined });
      conflict = { binding, heads, version: local.version, accountChanged: selected.accountChanged };
      preview = { plan, context, binding, heads, local }; return unionPolicy(plan).preview;
    },
    cancelResolution(id: string) { if (preview?.plan.preview.id === id) preview = null; if (confirmationId === id) confirmationId = null; },
    async confirmResolution(id: string): Promise<'localCommittedPending' | 'synchronized'> {
      const selected = preview;
      if (!selected || selected.plan.preview.id !== id) throw new SyncError('conflict');
      const data = materializeUnion(selected.plan);
      preview = null; confirmationId = id; // A budget failure keeps the summary available; a commit attempt consumes the preview.
      return (await locked(async signal => {
        const context = await store.context();
        if (canonicalJson(fence(context)) !== canonicalJson(fence(selected.context))) throw new SyncError('conflict');
        const drive = options.drive(selected.binding);
        const media = await prepareBackupMedia(referencedExport(data)); const recovery = await snapshot(selected.local.library, selected.context.record.base?.snapshotId ?? null);
        const outgoing = await snapshot(data, selected.heads[0]?.header.snapshotId ?? null, selected.heads.map(head => head.header.snapshotId));
        await revalidate(selected.binding, selected.heads, drive, signal);
        const version = await options.resolutionRepository.commit({ fence: fence(selected.context), library: outgoing.library, media, recovery,
          effect: { kind: 'resolution', binding: selected.binding, snapshot: outgoing } }, () => ready(signal, id));
        confirmationId = null;
        conflict = null; await guard().then(() => publish({ status: 'pending' })).catch(() => {});
        try { await transfer(selected.binding, drive, selected.heads, { library: outgoing.library, version }, signal); }
        catch { await guard().then(() => publish({ status: 'pending' })).catch(() => {}); return 'localCommittedPending' as const; }
        return view.status === 'synced' ? 'synchronized' as const : 'localCommittedPending' as const;
      }, true))!;
    },
    async resolve(choice: 'local' | string) {
      const selected = conflict; if (!selected) throw new SyncError('conflict');
      // Whole-library choices do not materialize every source; they remain available above the merge budget.
      return locked(async signal => {
        const context = await store.context(); const local = await library();
        if (!sameRevision(local.version, selected.version) || !sameRevision(local.version, context.version)) throw new SyncError('conflict');
        const binding = await auth.session(signal); if (!sameBinding(selected.binding, binding)) throw new SyncError('conflict');
        const drive = options.drive(binding); const files = await drive.list(signal); const heads = remoteHeads(files);
        if (fingerprint(heads) !== fingerprint(selected.heads)) throw new SyncError('conflict');
        if (context.record.base && !selected.accountChanged) {
          const base = files.find(file => file.header.snapshotId === context.record.base!.snapshotId);
          if (!base || base.header.hash !== context.record.base.hash || base.header.protocolVersion !== context.record.base.protocolVersion) throw new SyncError('invalid');
          await download(drive, base, signal);
        }
        let data = local.library;
        if (choice !== 'local') { const file = heads.find(head => head.header.snapshotId === choice); if (!file) throw new SyncError('invalid'); data = (await download(drive, file, signal)).library; }
        const media = await prepareBackupMedia(referencedExport(data)); const recovery = await snapshot(local.library, context.record.base?.snapshotId ?? null);
        const outgoing = await snapshot(data, heads[0]?.header.snapshotId ?? null, heads.map(head => head.header.snapshotId));
        await revalidate(binding, heads, drive, signal);
        const version = await options.resolutionRepository.commit({ fence: fence(context), library: outgoing.library, media, recovery, effect: { kind: 'resolution', binding, snapshot: outgoing } }, () => ready(signal));
        conflict = null; preview = null; await guard().then(() => publish({ status: 'pending' })).catch(() => {});
        try { await transfer(binding, drive, heads, { library: outgoing.library, version }, signal); } catch { await guard().then(() => publish({ status: 'pending' })).catch(() => {}); }
      }, true);
    },
    async runNow() { await locked(cycle); },
    close() { closed = true; preview = null; controller?.abort(); clearTimeout(timer); clearTimeout(polling); unsubscribe(); unsubscribeControl(); listeners.clear(); auth.invalidate(); },
  };
  return { ...coordinator,
    start: held(coordinator.start), wake: held(coordinator.wake), dismissDrivePrompt: held(coordinator.dismissDrivePrompt),
    connect: held(coordinator.connect), authorizeDrive: held(coordinator.authorizeDrive), retryDriveAuthorization: held(coordinator.retryDriveAuthorization),
    retryAuthorization: held(coordinator.retryAuthorization), cancelAuthorization: held(coordinator.cancelAuthorization), pause: held(coordinator.pause),
    resume: held(coordinator.resume), disconnect: held(coordinator.disconnect), downloadRemote: held(coordinator.downloadRemote),
    localCopy: held(coordinator.localCopy), prepareResolution: held(coordinator.prepareResolution),
    confirmResolution: held(coordinator.confirmResolution), resolve: held(coordinator.resolve),
  };

}
export type SyncCoordinator = ReturnType<typeof createSyncCoordinator>;
