import type { IDBPDatabase, IDBPTransaction, StoreNames } from 'idb';
import { DEFAULT_PREFERENCES, RECORD_VERSION } from './schema';
import type { LibraryDatabase } from './schema';

// Only the initial schema exists. Future steps must run in this same upgrade
// transaction, preserve old records and recompute metadata after transformations.
export function migrateDatabase(
  db: IDBPDatabase<LibraryDatabase>,
  transaction: IDBPTransaction<LibraryDatabase, StoreNames<LibraryDatabase>[], 'versionchange'>,
  oldVersion: number,
  generation: string,
): void {
  if (oldVersion < 1) {
    const books = db.createObjectStore('books');
    books.createIndex('byShelfYear', 'shelfYear');
    books.createIndex('byYearStatus', ['shelfYear', 'status']);
    db.createObjectStore('meta');
    db.createObjectStore('preferences');
    db.createObjectStore('syncState');
    db.createObjectStore('syncOutbox');
    db.createObjectStore('experimentState');
    db.createObjectStore('searchCache').createIndex('byAccess', 'lastAccessedAt');
    // Requests remain part of the upgrade; failures abort the whole migration.
    void transaction.objectStore('meta').put({ generation, revision: 0,
      recordVersion: RECORD_VERSION, bookCount: 0, serializedBytes: 2 }, 'library').catch(() => {});
    void transaction.objectStore('preferences').put(DEFAULT_PREFERENCES, 'ui').catch(() => {});
  }
}
