import { validateMediaCollection } from '../../backup/media';
import { coverMediaSchema } from '../../media/cover';
import type { IDBPTransaction, StoreNames } from 'idb';
import { z } from 'zod';
import { parseBook, shelfYearSchema } from '../../domain/book';
import { DomainError, parseDomain } from '../../domain/errors';
import { LIBRARY_LIMITS, parseLibrary, utf8ByteLength } from '../../domain/library';
import type { LibraryChange, LibraryRepository, LocalRevision } from '../../ports/library-repository';
import { openDatabase } from './database';
import type { DatabaseOptions } from './database';
import { storageError } from './errors';
import { DATABASE_NAME, parseMetadata, preferencesSchema, revisionSchema, sameRevision, versionOf } from './schema';
import type { LibraryDatabase, LibraryMetadata } from './schema';

type RevisionChannel = Pick<BroadcastChannel, 'postMessage' | 'onmessage' | 'close'>;
export type RepositoryOptions = DatabaseOptions & {
  channelFactory?: ((name: string) => RevisionChannel) | null;
  focusTarget?: EventTarget | null;
  onObservationError?: (error: DomainError) => void;
};

const bytes = (value: unknown) => utf8ByteLength(JSON.stringify(value));
const keyOf = (id: string) => parseDomain(z.uuid(), id).toLowerCase();

function prepare(change: LibraryChange): LibraryChange {
  switch (change.kind) {
    case 'put': return { kind: 'put', book: parseBook(change.book) };
    case 'delete': return { kind: 'delete', id: keyOf(change.id) };
    case 'replace': return { kind: 'replace', books: parseLibrary(change.books),
      coverMedia: validateMediaCollection(change.books, change.coverMedia ?? []),
      ...(change.preferences === undefined ? {} : { preferences: parseDomain(
        preferencesSchema.omit({ lastExport: true }), change.preferences, 'InvalidBackup') }) };
    default: throw new DomainError('InvalidLibrary');
  }
}

export async function openLibraryRepository(options: RepositoryOptions = {}): Promise<LibraryRepository> {
  const connection = await openDatabase(options);
  let channel: RevisionChannel | undefined;
  let closed = false;
  let observed: LocalRevision | undefined;
  const listeners = new Set<(version: LocalRevision) => void>();
  const focusTarget = options.focusTarget === undefined
    ? (typeof window === 'undefined' ? null : window) : options.focusTarget;

  async function transaction<Names extends StoreNames<LibraryDatabase>[], Mode extends IDBTransactionMode, Result>(
    names: Names, mode: Mode,
    action: (tx: IDBPTransaction<LibraryDatabase, Names, Mode>) => Promise<Result>,
  ): Promise<Result> {
    let tx: IDBPTransaction<LibraryDatabase, Names, Mode> | undefined;
    try {
      connection.ensureOpen();
      tx = connection.db.transaction(names, mode);
      void tx.done.catch(() => {}); // It may reject before the active request does.
      const result = await action(tx);
      await tx.done;
      return result;
    } catch (error) {
      if (tx) {
        try { tx.abort(); } catch { /* It may already have completed or aborted. */ }
        await tx.done.catch(() => {});
      }
      throw storageError(error);
    }
  }

  function notify(version: LocalRevision) {
    if (closed || (observed && sameRevision(observed, version))) return;
    observed = versionOf(version);
    for (const listener of listeners) {
      try { listener(versionOf(version)); } catch { /* Persistence is already confirmed. */ }
    }
  }

  const repository: LibraryRepository = {
    readBackupSnapshot: () => transaction(['books', 'meta', 'preferences', 'coverMedia'], 'readonly', async (tx) => {
      const [values, rawMeta, rawPreferences, media] = await Promise.all([
        tx.objectStore('books').getAll(), tx.objectStore('meta').get('library'),
        tx.objectStore('preferences').get('ui'), tx.objectStore('coverMedia').getAll(),
      ]);
      const books = parseLibrary(values);
      const meta = parseMetadata(rawMeta);
      if (meta.bookCount !== books.length || meta.serializedBytes !== bytes(books)) throw new DomainError('InvalidLibrary');
      const { shelfYear, mode, filter } = parseDomain(preferencesSchema, rawPreferences, 'InvalidLibrary');
      return { books, version: versionOf(meta), preferences: { shelfYear, mode, filter },
        coverMedia: media.map(value => parseDomain(coverMediaSchema, value, 'InvalidLibrary')) };
    }),
    readAll: () => transaction(['books', 'meta'], 'readonly', async (tx) => {
      const [values, rawMeta, keys] = await Promise.all([
        tx.objectStore('books').getAll(), tx.objectStore('meta').get('library'), tx.objectStore('books').getAllKeys(),
      ]);
      const meta = parseMetadata(rawMeta);
      const books = parseLibrary(values);
      if (meta.bookCount !== books.length || meta.serializedBytes !== bytes(books) ||
        books.some((book, index) => book.id.toLowerCase() !== keys[index])) {
        throw new DomainError('InvalidLibrary');
      }
      return { books, version: versionOf(meta) };
    }),
    readYear: async (year) => {
      parseDomain(shelfYearSchema, year);
      return transaction(['books', 'meta'], 'readonly', async (tx) => {
        const [books, meta] = await Promise.all([
          tx.objectStore('books').index('byShelfYear').getAll(year), tx.objectStore('meta').get('library'),
        ]);
        return { books: parseLibrary(books), version: versionOf(parseMetadata(meta)) };
      });
    },
    readBook: async (id) => {
      const key = keyOf(id);
      return transaction(['books', 'meta'], 'readonly', async (tx) => {
        const [book, meta] = await Promise.all([
          tx.objectStore('books').get(key), tx.objectStore('meta').get('library'),
        ]);
        return { book: book === undefined ? null : parseBook(book), version: versionOf(parseMetadata(meta)) };
      });
    },
    readRevision: () => transaction(['meta'], 'readonly', async (tx) =>
      versionOf(parseMetadata(await tx.objectStore('meta').get('library')))),
    commit: async (change, expected) => {
      // Validation, cloning and full replacement size calculation precede the transaction.
      const prepared = prepare(change);
      const expectedVersion = parseDomain(revisionSchema, expected, 'StaleRevision');
      const replacementBytes = prepared.kind === 'replace' ? bytes(prepared.books) : 0;
      const putBytes = prepared.kind === 'put' ? bytes(prepared.book) : 0;
      const generation = prepared.kind === 'replace' ? globalThis.crypto.randomUUID() : null;
      const version = await transaction(['books', 'meta', 'preferences', 'coverMedia', 'syncOutbox'], 'readwrite', async (tx) => {
        const books = tx.objectStore('books');
        const meta = parseMetadata(await tx.objectStore('meta').get('library'));
        if (!sameRevision(meta, expectedVersion)) throw new DomainError('StaleRevision');
        if (meta.revision === Number.MAX_SAFE_INTEGER) throw new DomainError('UnsupportedVersion');
        let bookCount = meta.bookCount;
        let serializedBytes = meta.serializedBytes;
        if (prepared.kind === 'replace') {
          bookCount = prepared.books.length;
          serializedBytes = replacementBytes;
          await books.clear();
          await tx.objectStore('coverMedia').clear();
          await Promise.all((prepared.coverMedia ?? []).map(value => tx.objectStore('coverMedia').add(value, value.id.toLowerCase())));
          await Promise.all(prepared.books.map(async (book) => books.add(book, book.id.toLowerCase())));
          if (prepared.preferences) {
            await tx.objectStore('preferences').put({ ...prepared.preferences, lastExport: null }, 'ui');
          }
        } else {
          const key = prepared.kind === 'put' ? prepared.book.id.toLowerCase() : prepared.id;
          const previous = await books.get(key);
          if (previous !== undefined) parseBook(previous);
          const previousCount = bookCount;
          if (prepared.kind === 'put') bookCount += previous === undefined ? 1 : 0;
          else bookCount -= previous === undefined ? 0 : 1;
          serializedBytes += putBytes - (previous === undefined ? 0 : bytes(previous))
            + Math.max(0, bookCount - 1) - Math.max(0, previousCount - 1);
          if (bookCount > LIBRARY_LIMITS.books ||
            serializedBytes + LIBRARY_LIMITS.exportEnvelopeBytes > LIBRARY_LIMITS.jsonBytes) {
            throw new DomainError('ImportTooLarge');
          }
          if (prepared.kind === 'put') await books.put(prepared.book, key);
          else await books.delete(key);
        }
        const next: LibraryMetadata = {
          ...meta, generation: generation ?? meta.generation, revision: meta.revision + 1,
          bookCount, serializedBytes,
        };
        await tx.objectStore('meta').put(parseMetadata(next), 'library');
        // Durable intent is atomic with the library, even while disconnected or the app closes.
        // Contains a revision only; credentials never belong in this store.
        await tx.objectStore('syncOutbox').put({ version: versionOf(next) }, 'pending');
        return versionOf(next);
      });
      notify(version);
      // The channel is advisory; it can fail after a successful durable commit.
      try { channel?.postMessage({ type: 'revision-changed' }); } catch { /* Focus will recheck. */ }
      return version;
    },
    readPreferences: () => transaction(['preferences'], 'readonly', async (tx) =>
      parseDomain(preferencesSchema, await tx.objectStore('preferences').get('ui'), 'InvalidLibrary')),
    updatePreferences: async (patch) => {
      const validated = parseDomain(preferencesSchema.partial(), patch, 'InvalidLibrary');
      return transaction(['preferences'], 'readwrite', async (tx) => {
        const store = tx.objectStore('preferences');
        const previous = parseDomain(preferencesSchema, await store.get('ui'), 'InvalidLibrary');
        const preferences = parseDomain(preferencesSchema, { ...previous,
          ...Object.fromEntries(Object.entries(validated).filter(([, value]) => value !== undefined)),
        }, 'InvalidLibrary');
        await store.put(preferences, 'ui');
        return preferences;
      });
    },
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    async checkForChanges() { notify(await repository.readRevision()); },
    close() {
      closed = true;
      listeners.clear();
      focusTarget?.removeEventListener('focus', observe);
      if (channel) {
        channel.onmessage = null;
        try { channel.close(); } catch { /* Closing cannot undo a commit. */ }
      }
      connection.close();
    },
  };

  function observe() {
    void repository.checkForChanges().catch((error: unknown) => {
      try { options.onObservationError?.(storageError(error)); } catch { /* No unhandled callbacks. */ }
    });
  }

  try {
    // Validate the existing library once before exposing a writable repository.
    observed = (await repository.readAll()).version;
    const factory = options.channelFactory === undefined
      ? (typeof BroadcastChannel === 'undefined' ? null : (name: string) => new BroadcastChannel(name))
      : options.channelFactory;
    try { channel = factory?.(`${options.name ?? DATABASE_NAME}:revision`); } catch { /* Optional capability. */ }
    if (channel) channel.onmessage = (event) => {
      if (event.data?.type === 'revision-changed') observe();
    };
    focusTarget?.addEventListener('focus', observe);
    return repository;
  } catch (error) {
    repository.close();
    throw storageError(error);
  }
}
