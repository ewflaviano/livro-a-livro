import { openDB } from 'idb';
import type { IDBPDatabase } from 'idb';
import { DomainError } from '../../domain/errors';
import { migrateDatabase } from './migrations';
import { storageError } from './errors';
import { DATABASE_NAME, DATABASE_VERSION, parseMetadata } from './schema';
import type { LibraryDatabase } from './schema';

export type DatabaseEvent = 'blocked' | 'versionchange' | 'terminated';
export type DatabaseOptions = {
  name?: string;
  onDatabaseEvent?: (event: DatabaseEvent) => void;
};

export async function openDatabase(options: DatabaseOptions = {}) {
  let db: IDBPDatabase<LibraryDatabase> | undefined;
  let closed = false;
  let abandoned = false;
  let migrationError: unknown;
  const notify = (event: DatabaseEvent) => {
    try { options.onDatabaseEvent?.(event); } catch { /* Host callbacks cannot affect storage. */ }
  };
  try {
    if (!globalThis.indexedDB) throw new DomainError('StorageUnavailable');
    const generation = globalThis.crypto.randomUUID();
    db = await new Promise<IDBPDatabase<LibraryDatabase>>((resolve, reject) => {
      const opening = openDB<LibraryDatabase>(options.name ?? DATABASE_NAME, DATABASE_VERSION, {
        upgrade(connection, oldVersion, _newVersion, transaction) {
          // idb creates a separate completion promise for upgrade transactions.
          // Observe it even when aborting before any requests have been queued.
          void transaction.done.catch((error: unknown) => { migrationError ??= error; });
          if (abandoned) { transaction.abort(); return; }
          try { migrateDatabase(connection, transaction, oldVersion, generation); }
          catch (error) { migrationError = error; transaction.abort(); }
        },
        blocked() {
          abandoned = true;
          notify('blocked');
          reject(new DomainError('StorageUnavailable'));
        },
        blocking() {
          closed = true;
          db?.close();
          notify('versionchange');
        },
        terminated() { closed = true; notify('terminated'); },
      });
      void opening.then((connection) => {
        if (abandoned) connection.close();
        else resolve(connection);
      }, (error: unknown) => reject(storageError(migrationError ?? error)));
    });
    // Never repair missing/invalid metadata by silently starting an empty library.
    parseMetadata(await db.get('meta', 'library'));
    const connection = db;
    return {
      db: connection,
      ensureOpen() {
        if (closed) throw new DomainError('StorageUnavailable');
      },
      close() { closed = true; connection.close(); },
    };
  } catch (error) {
    db?.close();
    throw storageError(error);
  }
}
