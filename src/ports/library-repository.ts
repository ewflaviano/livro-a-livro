import type { CoverMedia } from '../media/cover';
import type { Book, ReadingStatus } from '../domain/book';

export type LocalRevision = { generation: string; revision: number };
export type Snapshot = { books: Book[]; version: LocalRevision };
export type LibraryChange =
  | { kind: 'put'; book: Book; coverMedia?: CoverMedia }
  | { kind: 'delete'; id: string }
  | { kind: 'replace'; books: Book[]; preferences?: PortablePreferences; coverMedia?: CoverMedia[] };

export type PortablePreferences = Pick<LibraryPreferences, 'shelfYear' | 'mode' | 'filter'>;

export type LibraryPreferences = {
  shelfYear: number | null;
  mode: 'grid' | 'list';
  filter: ReadingStatus | 'all';
  lastExport: { startedAt: string; version: LocalRevision } | null;
};

export interface LibraryRepository {
  readAll(): Promise<Snapshot>;
  readBackupSnapshot(): Promise<Snapshot & { preferences: PortablePreferences; coverMedia: CoverMedia[] }>;
  readYear(year: number): Promise<Snapshot>;
  readBook(id: string): Promise<{ book: Book | null; version: LocalRevision }>;
  readCover(id: string): Promise<CoverMedia | null>;
  readRevision(): Promise<LocalRevision>;
  commit(change: LibraryChange, expected: LocalRevision, fence?: { syncLeaseOwner: string }): Promise<LocalRevision>;
  readPreferences(): Promise<LibraryPreferences>;
  // Merge only the supplied fields inside a transaction; no library revision change.
  updatePreferences(patch: Partial<LibraryPreferences>): Promise<LibraryPreferences>;
  subscribe(listener: (version: LocalRevision) => void): () => void;
  // Also available to hosts with a lifecycle other than window.focus.
  checkForChanges(): Promise<void>;
  close(): void;
}
