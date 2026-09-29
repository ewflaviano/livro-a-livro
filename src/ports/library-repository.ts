import type { CoverMedia } from '../media/cover';
import type { Book, ReadingStatus } from '../domain/book';

export type LocalRevision = { generation: string; revision: number };
export type Snapshot = { books: Book[]; version: LocalRevision };
export type LibraryChange =
  | { kind: 'put'; book: Book; coverMedia?: CoverMedia }
  | { kind: 'delete'; id: string }
  | { kind: 'replace'; books: Book[]; preferences?: SyncedPreferences; coverMedia?: CoverMedia[] };

export type SyncedPreferences = Pick<LibraryPreferences, 'shelfYear' | 'filter'>;
export type PortablePreferences = Pick<LibraryPreferences, 'shelfYear' | 'mode' | 'filter' | 'sortOrder'>;

export type LibraryPreferences = {
  shelfYear: number | null;
  mode: 'grid' | 'list';
  sortOrder: 'recent' | 'title';
  filter: ReadingStatus | 'all';
  lastExport: { startedAt: string; version: LocalRevision } | null;
};

export interface LibraryRepository {
  readAll(): Promise<Snapshot>;
  readBackupSnapshot(): Promise<Snapshot & { preferences: SyncedPreferences; coverMedia: CoverMedia[] }>;
  readYear(year: number): Promise<Snapshot>;
  readBook(id: string): Promise<{ book: Book | null; version: LocalRevision }>;
  readCover(id: string): Promise<CoverMedia | null>;
  readRevision(): Promise<LocalRevision>;
  commit(change: LibraryChange, expected: LocalRevision, fence?: { syncLeaseOwner: string }): Promise<LocalRevision>;
  readPreferences(): Promise<LibraryPreferences>;
  // Merge only supplied fields. Portable fields advance revision; display mode stays local.
  updatePreferences(patch: Partial<LibraryPreferences>): Promise<LibraryPreferences>;
  subscribe(listener: (version: LocalRevision) => void): () => void;
  subscribeLocalPreferences(listener: () => void): () => void;
  // Also available to hosts with a lifecycle other than window.focus.
  checkForChanges(): Promise<void>;
  close(): void;
}
