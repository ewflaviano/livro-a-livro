import { z } from 'zod';
import { instantSchema } from '../domain/book';
import { revisionSchema } from '../adapters/indexeddb/schema';

export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
export class SyncError extends Error {
  constructor(public readonly code: 'reconnect' | 'retry' | 'quota' | 'invalid' | 'conflict' | 'cancelled' | 'drive-required' | 'merge-budget', public readonly retryAfter = 0) { super(code); }
}
import { bindingSchema, hashSchema } from './protocol';
import type { Binding, SnapshotHeader, SyncSnapshot } from './protocol';
export * from './protocol';
export type DriveFile = { id: string; size: number; header: SnapshotHeader; resolution?: boolean };
export interface DriveClient {
  list(signal: AbortSignal): Promise<DriveFile[]>;
  download(file: DriveFile, signal: AbortSignal): Promise<SyncSnapshot>;
  upload(snapshot: SyncSnapshot, signal: AbortSignal): Promise<void>;
}
export interface AuthClient {
  session(signal?: AbortSignal, renew?: boolean): Promise<Binding>;
  token(binding: Binding, signal?: AbortSignal): Promise<string>;
  invalidate(): void;
  login(signal?: AbortSignal): Promise<LoginSession>;
  startSignIn(attemptId: string, guard?: () => Promise<void>): Promise<string>;
  startDrive(attemptId: string): Promise<string>;
  cancelAuthorization(attemptId: string): Promise<void>;
  logout(expectedSignInAttemptId?: string): Promise<void>;
  disconnect(all: boolean): Promise<boolean>;
}
export type LoginSession = { connectionId: string; signInAttemptId: string; expiresAt: number; absoluteExpiresAt: number; csrfToken: string };
export type LoginView = { status: 'checking' | 'signed-out' | 'signed-in' | 'unavailable'; signInAttemptId?: string; connectionId?: string; driveAuthorized?: boolean };
export const authorizationSchema = z.discriminatedUnion('stage', [
  z.strictObject({ id: z.uuid(), stage: z.literal('signin-starting') }),
  z.strictObject({ id: z.uuid(), stage: z.literal('signin') }),
  z.strictObject({ id: z.uuid(), stage: z.literal('identity-starting') }),
  z.strictObject({ id: z.uuid(), stage: z.literal('identity') }),
  z.strictObject({ id: z.uuid(), stage: z.literal('drive-starting'), expectedConnection: z.string().min(1).max(200) }),
  z.strictObject({ id: z.uuid(), stage: z.literal('drive'), expectedConnection: z.string().min(1).max(200) }),
]);
export type AuthorizationIntent = z.infer<typeof authorizationSchema>;
export const syncStateSchema = z.strictObject({
  enabled: z.boolean(), binding: bindingSchema.nullable(),
  base: z.strictObject({ snapshotId: z.uuid(), hash: hashSchema, protocolVersion: z.union([z.literal(1), z.literal(2), z.literal(3)]).default(1), comparisonHashV2: hashSchema.optional(), comparisonHashV3: hashSchema.optional() }).nullable(),
  nextAttempt: z.number().nonnegative(), attempts: z.number().int().nonnegative(),
  lastSyncedAt: instantSchema.nullable(),
  revocationPending: z.boolean().default(false),
  authorization: authorizationSchema.nullable().default(null),
  authRevision: z.number().int().nonnegative().default(0),
  drivePromptDismissedForSignIn: z.uuid().nullable().default(null),
});
export type SyncRecord = z.infer<typeof syncStateSchema>;
export const defaultSyncRecord: SyncRecord = { enabled: false, binding: null, base: null, nextAttempt: 0, attempts: 0, lastSyncedAt: null, revocationPending: false, authorization: null, authRevision: 0, drivePromptDismissedForSignIn: null };
export const pendingSchema = z.strictObject({ version: revisionSchema });
export type Operation = { binding: Binding; version: z.infer<typeof revisionSchema>; snapshot: SyncSnapshot };
export type SyncView = { login?: LoginView; drivePromptDismissed?: boolean; logoutUnconfirmed?: boolean; status: 'connected-empty' | 'receiving' | 'identifying' | 'authorize-drive' | 'authorization-expired' | 'authorization-error' | 'authorization-waiting' | 'disabled' | 'paused' | 'pending' | 'syncing' | 'synced' | 'offline' | 'reconnect' | 'error' | 'quota' | 'conflict'; received?: boolean; revocationPending?: boolean; authorizationStage?: 'identity' | 'drive'; lastSyncedAt?: string; remote?: { snapshotId: string; count: number; createdAt: string }[]; localCount?: number; accountChanged?: boolean };

export type { ResolutionPreview, ResolutionChoices } from './merge';
