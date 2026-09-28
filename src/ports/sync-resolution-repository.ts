import type { LibraryExport, LibraryExportV2 } from '../backup/schema';
import type { CoverMedia } from '../media/cover';
import type { LocalRevision } from './library-repository';
import type { Binding, SnapshotHeader, SyncSnapshotV3 } from '../sync/protocol';
export type SyncCommitFence = {
  expectedRevision: LocalRevision; expectedAuthRevision: number; expectedBinding: Binding | null;
  expectedOperation: { binding: Binding; version: LocalRevision; header: SnapshotHeader } | null;
  expectedPending: LocalRevision | null; leaseOwner: string;
};
export type PreparedSyncCommit = {
  fence: SyncCommitFence; library: LibraryExportV2; media: CoverMedia[]; recovery: SyncSnapshotV3;
  effect: { kind: 'resolution'; binding: Binding; snapshot: SyncSnapshotV3 } |
    { kind: 'receive'; binding: Binding; head: SnapshotHeader; wireLibrary: LibraryExport; comparisonHashV3: string; comparisonHashV2?: string };
};
export interface SyncResolutionRepository { commit(input: PreparedSyncCommit, assertReady: () => void): Promise<LocalRevision>; close(): void }
