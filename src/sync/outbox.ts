import { z } from 'zod';
import { openDatabase } from '../adapters/indexeddb/database';
import type { DatabaseOptions } from '../adapters/indexeddb/database';
import { DEFAULT_PREFERENCES, RECORD_VERSION, parseMetadata, versionOf, revisionSchema, sameRevision } from '../adapters/indexeddb/schema';
import { bindingSchema, defaultSyncRecord, pendingSchema, syncStateSchema, SyncError, type Operation, type SyncRecord, type AuthorizationIntent } from './contracts';
import { parseSnapshot } from './snapshot';
import { canonicalJson } from './protocol';
import type { LocalRevision } from '../ports/library-repository';

async function parseOperation(value: unknown): Promise<Operation | null> {
  if (value === undefined) return null;
  const parsed = z.strictObject({ binding: bindingSchema, version: revisionSchema, snapshot: z.unknown() }).parse(value);
  return { ...parsed, snapshot: await parseSnapshot(parsed.snapshot) };
}
export async function openSyncStore(options: DatabaseOptions = {}) {
  const connection = await openDatabase(options); const db = connection.db;
  const listeners = new Set<() => void>();
  const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(`lal-auth:${db.name}`);
  const revisionChannel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(`${db.name}:revision`);
  const consentChannel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('livro-a-livro-usage-consent');
  let localeChannel: BroadcastChannel | null = null;
  try { if (typeof BroadcastChannel !== 'undefined') localeChannel = new BroadcastChannel(`${db.name}:ui-locale`); }
  catch { /* Locale invalidation is optional; focused tabs reread storage. */ }
  const notify = () => listeners.forEach(listener => listener());
  if (channel) channel.onmessage = notify;
  const changed = () => { channel?.postMessage('control'); };
  return {
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    async read(): Promise<SyncRecord> {
      const value = await db.get('syncState', 'control');
      return value === undefined ? { ...defaultSyncRecord } : syncStateSchema.parse(value);
    },
    /** Confirmed logout removes every local user-data store in one transaction. */
    async eraseAfterLogout(expectedAuthRevision: number) {
      const tx = db.transaction(['books', 'meta', 'preferences', 'coverMedia', 'syncState', 'syncOutbox', 'searchCache', 'experimentState'], 'readwrite');
      void tx.done.catch(() => {});
      try {
        const raw = await tx.objectStore('syncState').get('control');
        const current = raw === undefined ? { ...defaultSyncRecord } : syncStateSchema.parse(raw);
        if (current.authRevision !== expectedAuthRevision || current.enabled) throw new SyncError('cancelled');
        await Promise.all([
          tx.objectStore('books').clear(), tx.objectStore('meta').clear(), tx.objectStore('preferences').clear(),
          tx.objectStore('coverMedia').clear(), tx.objectStore('syncState').clear(), tx.objectStore('syncOutbox').clear(),
          tx.objectStore('searchCache').clear(), tx.objectStore('experimentState').clear(),
        ]);
        await tx.objectStore('meta').put({ generation: crypto.randomUUID(), revision: 0, recordVersion: RECORD_VERSION, bookCount: 0, serializedBytes: 2 }, 'library');
        await tx.objectStore('preferences').put(DEFAULT_PREFERENCES, 'ui');
        await tx.objectStore('syncState').put({ ...defaultSyncRecord, authRevision: current.authRevision + 1 }, 'control');
        await tx.done;
      } catch (error) {
        try { tx.abort(); } catch { /* Transaction may already be closed. */ }
        await tx.done.catch(() => {});
        throw error;
      }
      changed();
      try { revisionChannel?.postMessage({ type: 'revision-changed' }); } catch { /* Focus rechecks. */ }
      try { consentChannel?.postMessage('changed'); } catch { /* Focus rechecks. */ }
      try { localeChannel?.postMessage('changed'); } catch { /* Focus rechecks. */ }
    },
    async write(value: SyncRecord) { await db.put('syncState', syncStateSchema.parse(value), 'control'); },
    /** Patch current control and fence cycle writes in the same transaction. */
    async update(patch: Partial<SyncRecord>, owner?: string, revokeLease = false, acknowledged?: LocalRevision, expectedRevision?: number) {
      const tx = db.transaction(['syncState', 'syncOutbox'], 'readwrite');
      const control = tx.objectStore('syncState');
      const raw = await control.get('control');
      const current = raw === undefined ? { ...defaultSyncRecord } : syncStateSchema.parse(raw);
      if (expectedRevision !== undefined && current.authRevision !== expectedRevision) { await tx.done; throw new SyncError('cancelled'); }
      if (patch.enabled === true && current.authorization) { await tx.done; throw new SyncError('cancelled'); }
      if (owner) {
        const lease = await control.get('lease') as { owner: string; until: number } | undefined;
        if (!current.enabled || lease?.owner !== owner || lease.until <= Date.now()) {
          await tx.done; throw new SyncError('cancelled');
        }
      }
      const next = syncStateSchema.parse({ ...current, ...patch, authRevision: current.authRevision + (revokeLease ? 1 : 0) });
      await control.put(next, 'control');
      if (revokeLease) await control.delete('lease');
      if (acknowledged) {
        const outbox = tx.objectStore('syncOutbox');
        const pending = await outbox.get('pending');
        if (pending !== undefined && sameRevision(pendingSchema.parse(pending).version, acknowledged)) await outbox.delete('pending');
        await outbox.delete('operation');
      }
      await tx.done;
      if (revokeLease || patch.drivePromptDismissedForSignIn !== undefined) changed();
      return next;
    },
    /** Authorization responses may commit only while the exact persisted intent still exists. */
    async compareAuthorization(expected: AuthorizationIntent, patch: Partial<SyncRecord>) {
      const tx = db.transaction('syncState', 'readwrite');
      const raw = await tx.store.get('control');
      const current = raw === undefined ? { ...defaultSyncRecord } : syncStateSchema.parse(raw);
      if (JSON.stringify(current.authorization) !== JSON.stringify(expected) || current.enabled) {
        await tx.done; throw new SyncError('cancelled');
      }
      const next = syncStateSchema.parse({ ...current, ...patch });
      await tx.store.put(next, 'control'); await tx.done; return next;
    },
    async pending() {
      const value = await db.get('syncOutbox', 'pending');
      return value === undefined ? null : pendingSchema.parse(value).version;
    },
    async acknowledge(version: LocalRevision) {
      const tx = db.transaction('syncOutbox', 'readwrite'); const value = await tx.store.get('pending');
      if (value !== undefined && sameRevision(pendingSchema.parse(value).version, version)) await tx.store.delete('pending');
      await tx.done;
    },
    async operation(): Promise<Operation | null> {
      return parseOperation(await db.get('syncOutbox', 'operation'));
    },
    async context() {
      const tx = db.transaction(['syncState','syncOutbox','meta'], 'readonly');
      const [control, operation, pending, meta] = await Promise.all([tx.objectStore('syncState').get('control'), tx.objectStore('syncOutbox').get('operation'), tx.objectStore('syncOutbox').get('pending'), tx.objectStore('meta').get('library')]);
      await tx.done;
      return { record: control === undefined ? { ...defaultSyncRecord } : syncStateSchema.parse(control), operation: await parseOperation(operation), pending: pending === undefined ? null : pendingSchema.parse(pending).version, version: versionOf(parseMetadata(meta)) };
    },
    async saveOperation(operation: Operation, owner?: string) {
      const tx = db.transaction(['syncState', 'syncOutbox'], 'readwrite');
      if (owner) {
        const state = tx.objectStore('syncState');
        const control = await state.get('control');
        const lease = await state.get('lease') as { owner: string; until: number } | undefined;
        if (!control || !syncStateSchema.parse(control).enabled || lease?.owner !== owner || lease.until <= Date.now()) {
          await tx.done; throw new SyncError('cancelled');
        }
      }
      const existing = await tx.objectStore('syncOutbox').get('operation');
      if (existing !== undefined && canonicalJson(existing) !== canonicalJson(operation)) { await tx.done; throw new SyncError('conflict'); }
      await tx.objectStore('syncOutbox').put(operation, 'operation');
      await tx.done;
    },
    async clearOperation() { await db.delete('syncOutbox', 'operation'); },
    // Original local copies survive automatic downloads and explicit resolution; never deleted by sync.
    async preserve(snapshot: Operation['snapshot'], owner: string) {
      const tx = db.transaction('syncState', 'readwrite');
      void tx.done.catch(() => {});
      try {
        const control = await tx.store.get('control');
        const rawLease = await tx.store.get('lease');
        const lease = rawLease === undefined ? null : z.strictObject({ owner: z.string(), until: z.number() }).parse(rawLease);
        if (!control || !syncStateSchema.parse(control).enabled || lease?.owner !== owner || lease.until <= Date.now()) {
          throw new SyncError('cancelled');
        }
        await tx.store.put(snapshot, 'recovery');
        await tx.done;
      } catch (error) {
        try { tx.abort(); } catch { /* Already completed or aborted. */ }
        await tx.done.catch(() => {});
        throw error;
      }
    },
    async recovery() { const raw = await db.get('syncState', 'recovery'); return raw ? parseSnapshot(raw) : null; },
    /** Lease fallback for browsers without Web Locks; renew and verify before every effect. */
    async lease(owner: string, release = false, renew = false) {
      const tx = db.transaction('syncState', 'readwrite');
      const raw = await tx.store.get('lease');
      const previous = raw === undefined ? null : z.strictObject({ owner: z.string(), until: z.number() }).parse(raw);
      const available = renew ? previous?.owner === owner && previous.until > Date.now() : !previous || previous.owner === owner || previous.until <= Date.now();
      if (release) { if (previous?.owner === owner) await tx.store.delete('lease'); }
      else if (available) await tx.store.put({ owner, until: Date.now() + 45_000 }, 'lease');
      await tx.done; return available;
    },
    async assertLease(owner: string) {
      const value = await db.get('syncState', 'lease') as { owner: string; until: number } | undefined;
      if (value?.owner !== owner || value.until <= Date.now()) throw new SyncError('cancelled');
    },
    close() { channel?.close(); revisionChannel?.close(); consentChannel?.close(); localeChannel?.close(); listeners.clear(); connection.close(); },
  };
}
export type SyncStore = Awaited<ReturnType<typeof openSyncStore>>;
