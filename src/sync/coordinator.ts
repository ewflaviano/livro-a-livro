import { prepareBackupMedia } from '../backup/media';
import type { LibraryRepository, LocalRevision } from '../ports/library-repository';
import { sameRevision } from '../adapters/indexeddb/schema';
import { SyncError, sameBinding, type AuthClient, type Binding, type DriveClient, type DriveFile, type SyncRecord, type SyncSnapshot, type SyncView } from './contracts';
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
  let view: SyncView = { status: 'disabled' }; let conflict: Conflict | null = null;
  let closed = false; let running = false; let controller: AbortController | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined; let polling: ReturnType<typeof setTimeout> | undefined;
  let firstEdit = 0; let lastPoll = 0;
  const publish = (next: SyncView) => { if (!closed) { view = next; listeners.forEach(listener => listener()); } };
  const guard = async () => { if (closed || controller?.signal.aborted || !(await store.read()).enabled) throw new SyncError('cancelled'); await store.assertLease(owner); };
  async function library(): Promise<{ library: LibraryExport; version: LocalRevision }> {
    const snapshot = await repository.readBackupSnapshot();
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
  async function accepted(record: SyncRecord, head: DriveFile, version: LocalRevision) {
    await guard();
    conflict = null;
    await store.write({ ...record, base: { snapshotId: head.header.snapshotId, hash: head.header.hash }, attempts: 0, nextAttempt: 0, lastSyncedAt: new Date().toISOString() });
    await store.acknowledge(version);
    await store.clearOperation();
    const current = await repository.readRevision();
    publish(sameRevision(current, version) ? { status: 'synced', lastSyncedAt: new Date().toISOString() } : { status: 'pending' });
    if (!sameRevision(current, version)) schedule(1500);
  }
  async function transfer(record: SyncRecord, binding: Binding, drive: DriveClient, heads: DriveFile[], local: Awaited<ReturnType<typeof library>>, signal: AbortSignal) {
    let operation = await store.operation();
    if (operation && !sameBinding(operation.binding, binding)) throw new SyncError('conflict');
    if (!operation) {
      operation = { binding, version: local.version, snapshot: await snapshot(local.library, heads[0]?.header.snapshotId ?? null) };
      await guard(); await store.saveOperation(operation);
    }
    if (operation.snapshot.parentSnapshotId !== (heads[0]?.header.snapshotId ?? null) && !operation.snapshot.resolvedSnapshotIds.length) {
      await showConflict(binding, heads, local.version); return;
    }
    await guard(); await drive.upload(operation.snapshot, signal);
    await guard(); const confirmed = remoteHeads(await drive.list(signal));
    if (confirmed.length !== 1 || confirmed[0].header.snapshotId !== operation.snapshot.snapshotId || confirmed[0].header.hash !== operation.snapshot.hash) {
      await showConflict(binding, confirmed, local.version); return;
    }
    await accepted(record, confirmed[0], operation.version);
  }
  async function cycle(signal: AbortSignal) {
    let record = await store.read();
    if (!record.enabled) { publish({ status: record.binding ? 'paused' : 'disabled' }); return; }
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
    if (!record.binding) { record = { ...record, binding }; await guard(); await store.write(record); }
    const operation = await store.operation();
    if (operation && sameBinding(operation.binding, binding)) {
      const found = files.find(file => file.header.operationId === operation.snapshot.operationId);
      if (found && (found.header.hash !== operation.snapshot.hash || found.header.snapshotId !== operation.snapshot.snapshotId)) throw new SyncError('invalid');
      if (found && heads.length === 1 && heads[0].header.snapshotId === found.header.snapshotId) { await accepted(record, found, operation.version); return; }
      if (!record.base && operation.snapshot.resolvedSnapshotIds.length &&
        ids(heads) === [...operation.snapshot.resolvedSnapshotIds].sort().join(',')) {
        await transfer(record, binding, drive, heads, local, signal); return;
      }
    }
    if (heads.length > 1) { await showConflict(binding, heads, local.version); return; }
    const hash = await libraryHash(local.library); const remote = heads[0];
    if (remote?.header.hash === hash) { await accepted(record, remote, local.version); return; }
    if (!remote) {
      if (record.base) { await showConflict(binding, heads, local.version); return; }
      if (local.library.books.length) await transfer(record, binding, drive, heads, local, signal);
      else publish({ status: 'synced' });
      return;
    }
    if (!record.base) { await showConflict(binding, heads, local.version); return; }
    if (remote.header.snapshotId === record.base.snapshotId) { await transfer(record, binding, drive, heads, local, signal); return; }
    // The remote may advance only through a known ancestor, never via timestamps.
    const byId = new Map(files.map(file => [file.header.snapshotId, file]));
    const ancestors = new Set<string>(); const queue = [remote.header.snapshotId];
    while (queue.length) { const id = queue.pop()!; if (ancestors.has(id)) continue; ancestors.add(id);
      const h = byId.get(id)?.header; if (h) queue.push(...[h.parentSnapshotId, ...h.resolvedSnapshotIds].filter((x): x is string => x !== null)); }
    if (hash !== record.base.hash || !ancestors.has(record.base.snapshotId) || options.hasDraft()) { await showConflict(binding, heads, local.version); return; }
    const incoming = await drive.download(remote, signal);
    const recovery = await snapshot(local.library, record.base.snapshotId);
    await guard(); if (options.hasDraft()) { await showConflict(binding, heads, local.version); return; }
    await store.preserve(recovery);
    const coverMedia = await prepareBackupMedia(incoming.library);
    await guard();
    if (options.hasDraft()) { await showConflict(binding, heads, local.version); return; }
    const version = await repository.commit({ kind: 'replace', books: incoming.library.books, preferences: incoming.library.preferences, coverMedia }, local.version);
    await accepted(record, remote, version);
  }
  async function locked(action: (signal: AbortSignal) => Promise<void>) {
    if (closed || running) return;
    running = true; controller = new AbortController();
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    try {
      if (!await store.lease(owner)) return;
      heartbeat = setInterval(() => { void store.lease(owner).then(ok => { if (!ok) controller?.abort(); }).catch(() => controller?.abort()); }, 10_000);
      await action(controller.signal);
    } catch (error) {
      const failure = error instanceof SyncError ? error : new SyncError('invalid');
      if (failure.code === 'cancelled' || closed) return;
      if (failure.code === 'retry') {
        const record = await store.read(); const attempts = record.attempts + 1;
        const delay = Math.max(failure.retryAfter, Math.min(60_000, 1000 * 2 ** Math.min(attempts, 6)) * (0.8 + Math.random() * 0.2));
        await store.write({ ...record, attempts, nextAttempt: Date.now() + delay });
        publish({ status: 'pending' }); if (attempts < 5) schedule(delay);
      } else publish({ status: failure.code === 'reconnect' ? 'reconnect' : failure.code === 'quota' ? 'quota' : 'error' });
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
  return {
    getSnapshot: () => view,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    async start() { const record = await store.read(); if (record.attempts >= 5) await store.write({ ...record, attempts: 0 }); publish({ status: record.enabled ? 'pending' : record.binding ? 'paused' : 'disabled' }); schedule(); poll(); },
    async wake() {
      if (closed || !options.visible()) return;
      const record = await store.read();
      // User/lifecycle retry starts a new bounded cycle, but respects Retry-After.
      if (record.attempts >= 5) await store.write({ ...record, attempts: 0 });
      if (!conflict && Date.now() - lastPoll >= 60_000) { lastPoll = Date.now(); schedule(); }
    },
    async connect() {
      const record = await store.read(); await store.write({ ...record, enabled: true, attempts: 0, nextAttempt: 0 });
      options.navigate(await auth.start());
    },
    async pause() { controller?.abort(); clearTimeout(timer); const record = await store.read(); await store.write({ ...record, enabled: false }); auth.invalidate(); publish({ status: 'paused' }); },
    async resume() { const record = await store.read(); await store.write({ ...record, enabled: true, attempts: 0 }); conflict = null; schedule(Math.max(0, record.nextAttempt - Date.now())); },
    async disconnect(all: boolean) {
      controller?.abort(); clearTimeout(timer); const record = await store.read(); await store.write({ ...record, enabled: false }); auth.invalidate();
      try { await auth.disconnect(all); publish({ status: 'paused' }); }
      catch { publish({ status: 'error' }); throw new SyncError('reconnect'); }
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
        await guard(); await store.preserve(await snapshot(local.library, null));
        if (choice !== 'local') {
          if (options.hasDraft()) throw new SyncError('conflict');
          const coverMedia = await prepareBackupMedia(data);
          await guard();
          if (options.hasDraft()) throw new SyncError('conflict');
          version = await repository.commit({ kind: 'replace', books: data.books, preferences: data.preferences, coverMedia }, local.version);
        }
        const next = await snapshot(data, heads[0]?.header.snapshotId ?? null, heads.map(head => head.header.snapshotId));
        const record = { ...await store.read(), binding, base: null, enabled: true };
        await guard(); await store.saveOperation({ binding, version, snapshot: next }); await store.write(record);
        conflict = null; publish({ status: 'syncing' });
        await transfer(record, binding, drive, heads, { library: data, version }, signal);
      });
    },
    async runNow() { await locked(cycle); },
    close() { closed = true; controller?.abort(); clearTimeout(timer); clearTimeout(polling); unsubscribe(); listeners.clear(); auth.invalidate(); },
  };
}
export type SyncCoordinator = ReturnType<typeof createSyncCoordinator>;
