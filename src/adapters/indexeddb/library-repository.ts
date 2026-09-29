import { applyLibraryChange, prepareLibraryChange } from './library-commit';
import { referencedMedia } from '../../backup/media';
import { coverMediaSchema } from '../../media/cover';
import type { IDBPTransaction, StoreNames } from 'idb';
import { z } from 'zod';
import { parseBook, shelfYearSchema } from '../../domain/book';
import { DomainError, parseDomain } from '../../domain/errors';
import { parseLibrary, utf8ByteLength } from '../../domain/library';
import type { LibraryRepository, LocalRevision } from '../../ports/library-repository';
import { openDatabase } from './database';
import type { DatabaseOptions } from './database';
import { storageError } from './errors';
import { DATABASE_NAME, parseMetadata, preferencesSchema, revisionSchema, sameRevision, versionOf } from './schema';
import type { LibraryDatabase } from './schema';

type RevisionChannel = Pick<BroadcastChannel, 'postMessage' | 'onmessage' | 'close'>;
export type RepositoryOptions = DatabaseOptions & {
  channelFactory?: ((name: string) => RevisionChannel) | null;
  focusTarget?: EventTarget | null;
  onObservationError?: (error: DomainError) => void;
};

const bytes = (value: unknown) => utf8ByteLength(JSON.stringify(value));
const keyOf = (id: string) => parseDomain(z.uuid(), id).toLowerCase();


export async function openLibraryRepository(options: RepositoryOptions = {}): Promise<LibraryRepository> {
  const connection = await openDatabase(options);
  let channel: RevisionChannel | undefined;
  let closed = false;
  let observed: LocalRevision | undefined;
  let observedDisplay: { mode: 'grid' | 'list'; sortOrder: 'recent' | 'title' } | undefined;
  const listeners = new Set<(version: LocalRevision) => void>();
  const localPreferenceListeners = new Set<() => void>();
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
  function notifyLocalPreferences(display: { mode: 'grid' | 'list'; sortOrder: 'recent' | 'title' }) {
    if (closed || (observedDisplay?.mode === display.mode && observedDisplay.sortOrder === display.sortOrder)) return;
    observedDisplay = display;
    for (const listener of localPreferenceListeners) {
      try { listener(); } catch { /* Persistence is already confirmed. */ }
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
      const { shelfYear, filter } = parseDomain(preferencesSchema, rawPreferences, 'InvalidLibrary');
      return { books, version: versionOf(meta), preferences: { shelfYear, filter },
        coverMedia: referencedMedia(books, media.map(value => parseDomain(coverMediaSchema, value, 'InvalidLibrary'))) };
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
    readCover: (id) => transaction(['coverMedia'], 'readonly', async tx => {
      const value = await tx.objectStore('coverMedia').get(keyOf(id));
      return value === undefined ? null : parseDomain(coverMediaSchema, value, 'InvalidLibrary');
    }),
    readRevision: () => transaction(['meta'], 'readonly', async (tx) =>
      versionOf(parseMetadata(await tx.objectStore('meta').get('library')))),
    commit: async (change, expected, fence) => {
      // Validation, cloning and full replacement size calculation precede the transaction.
      const prepared = prepareLibraryChange(change);
      const expectedVersion = parseDomain(revisionSchema, expected, 'StaleRevision');
      const generation = prepared.kind === 'replace' ? globalThis.crypto.randomUUID() : null;
      const version = await transaction(['books', 'meta', 'preferences', 'coverMedia', 'syncOutbox', 'syncState'], 'readwrite', async (tx) => {
        // Serialize remote replacement with pause/logout in the same database transaction.
        if (fence) {
          const state = tx.objectStore('syncState');
          const control = await state.get('control') as { enabled?: boolean } | undefined;
          const lease = await state.get('lease') as { owner?: string; until?: number } | undefined;
          if (control?.enabled !== true || lease?.owner !== fence.syncLeaseOwner ||
            typeof lease.until !== 'number' || lease.until <= Date.now()) throw new DomainError('StaleRevision');
        }
        return applyLibraryChange(tx, prepared, expectedVersion, generation);
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
      let changed: LocalRevision | undefined;
      const result = await transaction(['preferences', 'meta', 'syncOutbox'], 'readwrite', async (tx) => {
        const store = tx.objectStore('preferences');
        const previous = parseDomain(preferencesSchema, await store.get('ui'), 'InvalidLibrary');
        const preferences = parseDomain(preferencesSchema, { ...previous,
          ...Object.fromEntries(Object.entries(validated).filter(([, value]) => value !== undefined)),
        }, 'InvalidLibrary');
        if (previous.shelfYear !== preferences.shelfYear || previous.filter !== preferences.filter) {
          const meta = parseMetadata(await tx.objectStore('meta').get('library'));
          if (meta.revision === Number.MAX_SAFE_INTEGER) throw new DomainError('UnsupportedVersion');
          const next = { ...meta, revision: meta.revision + 1 };
          await tx.objectStore('meta').put(parseMetadata(next), 'library');
          changed = versionOf(next);
          await tx.objectStore('syncOutbox').put({ version: changed }, 'pending');
        }
        await store.put(preferences, 'ui');
        return preferences;
      });
      if (changed) { notify(changed); try { channel?.postMessage({ type: 'revision-changed' }); } catch { /* Advisory. */ } }
      else if (validated.mode !== undefined || validated.sortOrder !== undefined) {
        notifyLocalPreferences({ mode: result.mode, sortOrder: result.sortOrder });
        try { channel?.postMessage({ type: 'local-preferences-changed' }); } catch { /* Focus will recheck. */ }
      }
      if (changed) observedDisplay = { mode: result.mode, sortOrder: result.sortOrder };
      return result;
    },
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    subscribeLocalPreferences(listener) { localPreferenceListeners.add(listener); return () => { localPreferenceListeners.delete(listener); }; },
    async checkForChanges() {
      const [revision, display] = await transaction(['meta', 'preferences'], 'readonly', async tx => {
        const [meta, preferences] = await Promise.all([tx.objectStore('meta').get('library'), tx.objectStore('preferences').get('ui')]);
        const { mode, sortOrder } = parseDomain(preferencesSchema, preferences, 'InvalidLibrary');
        return [versionOf(parseMetadata(meta)), { mode, sortOrder }] as const;
      });
      notify(revision); notifyLocalPreferences(display);
    },
    close() {
      closed = true;
      listeners.clear();
      localPreferenceListeners.clear();
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
    const { mode, sortOrder } = await repository.readPreferences();
    observedDisplay = { mode, sortOrder };
    const factory = options.channelFactory === undefined
      ? (typeof BroadcastChannel === 'undefined' ? null : (name: string) => new BroadcastChannel(name))
      : options.channelFactory;
    try { channel = factory?.(`${options.name ?? DATABASE_NAME}:revision`); } catch { /* Optional capability. */ }
    if (channel) channel.onmessage = (event) => {
      if (event.data?.type === 'revision-changed' || event.data?.type === 'local-preferences-changed') observe();
    };
    focusTarget?.addEventListener('focus', observe);
    return repository;
  } catch (error) {
    repository.close();
    throw storageError(error);
  }
}
