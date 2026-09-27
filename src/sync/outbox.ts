import { z } from 'zod';
import { openDatabase } from '../adapters/indexeddb/database';
import type { DatabaseOptions } from '../adapters/indexeddb/database';
import { revisionSchema, sameRevision } from '../adapters/indexeddb/schema';
import { bindingSchema, defaultSyncRecord, pendingSchema, syncStateSchema, SyncError, type Operation, type SyncRecord } from './contracts';
import { parseSnapshot } from './snapshot';
import type { LocalRevision } from '../ports/library-repository';

export async function openSyncStore(options: DatabaseOptions = {}) {
  const connection = await openDatabase(options); const db = connection.db;
  return {
    async read(): Promise<SyncRecord> {
      const value = await db.get('syncState', 'control');
      return value === undefined ? { ...defaultSyncRecord } : syncStateSchema.parse(value);
    },
    async write(value: SyncRecord) { await db.put('syncState', syncStateSchema.parse(value), 'control'); },
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
      const value = await db.get('syncOutbox', 'operation');
      if (value === undefined) return null;
      const parsed = z.strictObject({ binding: bindingSchema, version: revisionSchema, snapshot: z.unknown() }).parse(value);
      return { ...parsed, snapshot: await parseSnapshot(parsed.snapshot) };
    },
    async saveOperation(operation: Operation) { await db.put('syncOutbox', operation, 'operation'); },
    async clearOperation() { await db.delete('syncOutbox', 'operation'); },
    // Original local copies survive automatic downloads and explicit resolution; never deleted by sync.
    async preserve(snapshot: Operation['snapshot']) { await db.put('syncState', snapshot, 'recovery'); },
    async recovery() { const raw = await db.get('syncState', 'recovery'); return raw ? parseSnapshot(raw) : null; },
    /** Lease fallback for browsers without Web Locks; renew and verify before every effect. */
    async lease(owner: string, release = false) {
      const tx = db.transaction('syncState', 'readwrite');
      const raw = await tx.store.get('lease');
      const previous = raw === undefined ? null : z.strictObject({ owner: z.string(), until: z.number() }).parse(raw);
      const available = !previous || previous.owner === owner || previous.until <= Date.now();
      if (release) { if (previous?.owner === owner) await tx.store.delete('lease'); }
      else if (available) await tx.store.put({ owner, until: Date.now() + 45_000 }, 'lease');
      await tx.done; return available;
    },
    async assertLease(owner: string) {
      const value = await db.get('syncState', 'lease') as { owner: string; until: number } | undefined;
      if (value?.owner !== owner || value.until <= Date.now()) throw new SyncError('cancelled');
    },
    close() { connection.close(); },
  };
}
export type SyncStore = Awaited<ReturnType<typeof openSyncStore>>;
