import { z } from 'zod';
import { instantSchema } from '../domain/book';
import { revisionSchema } from '../adapters/indexeddb/schema';
import type { LibraryExport } from '../backup/schema';

export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
export class SyncError extends Error {
  constructor(public readonly code: 'reconnect' | 'retry' | 'quota' | 'invalid' | 'conflict' | 'cancelled', public readonly retryAfter = 0) { super(code); }
}
export const bindingSchema = z.strictObject({ connectionId: z.string().min(1).max(200), generation: z.number().int().nonnegative() });
export type Binding = z.infer<typeof bindingSchema>;
export const sameBinding = (a: Binding | null, b: Binding) => a?.connectionId === b.connectionId && a.generation === b.generation;
export const hashSchema = z.string().regex(/^[a-f0-9]{64}$/u);
export const headerSchema = z.strictObject({
  format: z.literal('livro-a-livro-sync'), protocolVersion: z.literal(1), snapshotId: z.uuid(),
  operationId: z.uuid(), parentSnapshotId: z.uuid().nullable(),
  resolvedSnapshotIds: z.array(z.uuid()).max(1000), hash: hashSchema, createdAt: instantSchema,
});
export type SnapshotHeader = z.infer<typeof headerSchema>;
export type SyncSnapshot = SnapshotHeader & { library: LibraryExport };
export type DriveFile = { id: string; size: number; header: SnapshotHeader };
export interface DriveClient {
  list(signal: AbortSignal): Promise<DriveFile[]>;
  download(file: DriveFile, signal: AbortSignal): Promise<SyncSnapshot>;
  upload(snapshot: SyncSnapshot, signal: AbortSignal): Promise<void>;
}
export interface AuthClient {
  session(signal?: AbortSignal): Promise<Binding>;
  token(binding: Binding, signal?: AbortSignal): Promise<string>;
  invalidate(): void;
  start(): Promise<string>;
  disconnect(all: boolean): Promise<boolean>;
}
export const syncStateSchema = z.strictObject({
  enabled: z.boolean(), binding: bindingSchema.nullable(),
  base: z.strictObject({ snapshotId: z.uuid(), hash: hashSchema }).nullable(),
  nextAttempt: z.number().nonnegative(), attempts: z.number().int().nonnegative(),
  lastSyncedAt: instantSchema.nullable(),
  revocationPending: z.boolean().default(false),
});
export type SyncRecord = z.infer<typeof syncStateSchema>;
export const defaultSyncRecord: SyncRecord = { enabled: false, binding: null, base: null, nextAttempt: 0, attempts: 0, lastSyncedAt: null, revocationPending: false };
export const pendingSchema = z.strictObject({ version: revisionSchema });
export type Operation = { binding: Binding; version: z.infer<typeof revisionSchema>; snapshot: SyncSnapshot };
export type SyncView = { status: 'disabled' | 'paused' | 'pending' | 'syncing' | 'synced' | 'offline' | 'reconnect' | 'error' | 'quota' | 'conflict'; revocationPending?: boolean; lastSyncedAt?: string; remote?: { snapshotId: string; count: number; createdAt: string }[]; localCount?: number; accountChanged?: boolean };
