import { z } from 'zod';
import { prepareBackupMedia } from '../../backup/media';
import type { LibraryRepository } from '../../ports/library-repository';
import type { PreparedSyncCommit, SyncResolutionRepository } from '../../ports/sync-resolution-repository';
import { canonicalJson, headerSchema, sameBinding } from '../../sync/protocol';
import { bindingSchema, defaultSyncRecord, pendingSchema, syncStateSchema, SyncError } from '../../sync/contracts';
import { libraryHashV1, libraryHashV2, parseSnapshot } from '../../sync/snapshot';
import { openDatabase, type DatabaseOptions } from './database';
import { encodeCover } from './cover-media';
import { applyLibraryChange, prepareLibraryChange } from './library-commit';
import { revisionSchema, sameRevision } from './schema';
import { storageError } from './errors';

const operationIdentity = (raw: unknown) => {
  if (raw === undefined) return null;
  const value = z.strictObject({ binding: bindingSchema, version: revisionSchema, snapshot: z.unknown() }).parse(raw);
  const { library: _, ...header } = value.snapshot as Record<string, unknown>;
  return { binding: value.binding, version: value.version, header: headerSchema.parse(header) };
};
export async function openSyncResolutionRepository(repository: LibraryRepository, options: DatabaseOptions = {}): Promise<SyncResolutionRepository> {
  const connection = await openDatabase(options);
  const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(`${connection.db.name}:revision`);
  return {
    async commit(input: PreparedSyncCommit, assertReady: () => void) {
      input = structuredClone(input);
      // Parsing, hashing and decoding precede the write transaction. No network or image work inside it.
      if (input.fence.expectedPending && !sameRevision(input.fence.expectedPending, input.fence.expectedRevision)) throw new SyncError('conflict');
      const recovery = await parseSnapshot(input.recovery);
      if (recovery.protocolVersion !== 2) throw new SyncError('invalid');
      const decoded = await prepareBackupMedia(input.library);
      const encoded = await Promise.all(input.media.map(encodeCover));
      const sort = <T extends { id: string }>(values: T[]) => [...values].sort((a,b) => a.id.toLowerCase() < b.id.toLowerCase() ? -1 : a.id.toLowerCase() > b.id.toLowerCase() ? 1 : 0);
      if (canonicalJson(sort(encoded)) !== canonicalJson(sort(input.library.coverMedia))) throw new SyncError('invalid');
      const prepared = prepareLibraryChange({ kind: 'replace', books: input.library.books, preferences: input.library.preferences, coverMedia: decoded });
      const local = await repository.readBackupSnapshot();
      if (!sameRevision(local.version, input.fence.expectedRevision)) throw new SyncError('conflict');
      const localMedia = await Promise.all(local.coverMedia.map(encodeCover));
      const content = (books: typeof local.books, preferences: typeof local.preferences, coverMedia: typeof localMedia) => canonicalJson({ books: sort(books), preferences, coverMedia: sort(coverMedia) });
      if (content(local.books, local.preferences, localMedia) !== content(recovery.library.books, recovery.library.preferences, recovery.library.coverMedia)) throw new SyncError('invalid');
      const hash = await libraryHashV2(input.library);
      if (input.effect.kind === 'resolution') {
        const outgoing = await parseSnapshot(input.effect.snapshot);
        if (outgoing.protocolVersion !== 2 || outgoing.hash !== hash || canonicalJson(outgoing.library) !== canonicalJson(input.library)) throw new SyncError('invalid');
      } else {
        const head = headerSchema.parse(input.effect.head);
        if (input.effect.comparisonHashV2 !== hash || head.hash !== await (head.protocolVersion === 1 ? libraryHashV1 : libraryHashV2)(input.library)) throw new SyncError('invalid');
      }
      const generation = crypto.randomUUID();
      assertReady();
      const tx = connection.db.transaction(['books','meta','preferences','coverMedia','syncOutbox','syncState'], 'readwrite');
      void tx.done.catch(() => {});
      try {
        const state = tx.objectStore('syncState'); const outbox = tx.objectStore('syncOutbox');
        const raw = await state.get('control'); const control = raw === undefined ? { ...defaultSyncRecord } : syncStateSchema.parse(raw);
        const lease = await state.get('lease') as { owner: string; until: number } | undefined;
        const pending = await outbox.get('pending'); const operation = await outbox.get('operation');
        if (!control.enabled || control.authorization || control.authRevision !== input.fence.expectedAuthRevision ||
          canonicalJson(control.binding) !== canonicalJson(input.fence.expectedBinding) || lease?.owner !== input.fence.leaseOwner || lease.until <= Date.now() ||
          canonicalJson(operationIdentity(operation)) !== canonicalJson(input.fence.expectedOperation) ||
          canonicalJson(pending === undefined ? null : pendingSchema.parse(pending).version) !== canonicalJson(input.fence.expectedPending)) throw new SyncError('cancelled');
        if (input.effect.kind === 'receive' && control.binding && !sameBinding(control.binding, input.effect.binding)) throw new SyncError('conflict');
        const version = await applyLibraryChange(tx, prepared, input.fence.expectedRevision, generation, assertReady);
        await state.put(recovery, 'recovery');
        const effect = input.effect;
        if (effect.kind === 'resolution') {
          await outbox.put({ binding: effect.binding, version, snapshot: effect.snapshot }, 'operation');
          await state.put(syncStateSchema.parse({ ...control, binding: effect.binding, base: null, attempts: 0, nextAttempt: 0 }), 'control');
        } else {
          await outbox.delete('operation'); await outbox.delete('pending');
          await state.put(syncStateSchema.parse({ ...control, binding: effect.binding, base: { snapshotId: effect.head.snapshotId, hash: effect.head.hash, protocolVersion: effect.head.protocolVersion, comparisonHashV2: effect.comparisonHashV2 }, attempts: 0, nextAttempt: 0, lastSyncedAt: new Date().toISOString() }), 'control');
        }
        assertReady();
        await tx.done;
        await repository.checkForChanges().catch(() => {});
        try { channel?.postMessage({ type: 'revision-changed' }); } catch { /* Advisory only. */ }
        return version;
      } catch (error) {
        try { tx.abort(); } catch { /* Already settled. */ }
        await tx.done.catch(() => {});
        if (error instanceof SyncError) throw error;
        throw storageError(error);
      }
    },
    close() { channel?.close(); connection.close(); },
  };
}
