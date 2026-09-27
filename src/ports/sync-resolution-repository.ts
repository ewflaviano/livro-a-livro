import type { LibraryExport } from '../backup/schema';
import type { CoverMedia } from '../media/cover';
import type { LocalRevision } from './library-repository';
import type { Binding, SnapshotHeader, SyncSnapshotV2 } from '../sync/protocol';
export type SyncCommitFence = {
  expectedRevision: LocalRevision; expectedAuthRevision: number; expectedBinding: Binding | null;
  expectedOperation: { binding: Binding; version: LocalRevision; header: SnapshotHeader } | null;
  expectedPending: LocalRevision | null; leaseOwner: string;
};
export type PreparedSyncCommit = {
  fence: SyncCommitFence; library: LibraryExport; media: CoverMedia[]; recovery: SyncSnapshotV2;
  effect: { kind: 'resolution'; binding: Binding; snapshot: SyncSnapshotV2 } |
    { kind: 'receive'; binding: Binding; head: SnapshotHeader; comparisonHashV2: string };
};
export interface SyncResolutionRepository { commit(input: PreparedSyncCommit, assertReady: () => void): Promise<LocalRevision>; close(): void }
