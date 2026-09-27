import { assertPortableBudget, referencedMedia, validateMediaCollection } from '../../backup/media';
import { coverMediaSchema } from '../../media/cover';
import type { IDBPTransaction } from 'idb';
import { z } from 'zod';
import { parseBook } from '../../domain/book';
import { DomainError, parseDomain } from '../../domain/errors';
import { LIBRARY_LIMITS, parseLibrary, utf8ByteLength } from '../../domain/library';
import type { LibraryChange, LocalRevision } from '../../ports/library-repository';
import { parseMetadata, preferencesSchema, sameRevision, versionOf } from './schema';
import type { LibraryDatabase, LibraryMetadata } from './schema';

export type LibraryWriteTransaction = IDBPTransaction<LibraryDatabase, ['books', 'meta', 'preferences', 'coverMedia', 'syncOutbox', 'syncState'], 'readwrite'>;
const bytes = (value: unknown) => utf8ByteLength(JSON.stringify(value));
const keyOf = (id: string) => parseDomain(z.uuid(), id).toLowerCase();
export function prepareLibraryChange(change: LibraryChange): LibraryChange {
  switch (change.kind) {
    case 'put': {
      const book = parseBook(change.book);
      const media = change.coverMedia === undefined ? undefined : parseDomain(coverMediaSchema, change.coverMedia, 'InvalidBook');
      if (media && (book.cover?.provider !== 'local' || book.cover.mediaId.toLowerCase() !== media.id.toLowerCase())) throw new DomainError('InvalidBook');
      return { kind: 'put', book, coverMedia: media };
    }
    case 'delete': return { kind: 'delete', id: keyOf(change.id) };
    case 'replace': return { kind: 'replace', books: parseLibrary(change.books),
      coverMedia: validateMediaCollection(change.books, change.coverMedia ?? []),
      ...(change.preferences === undefined ? {} : { preferences: parseDomain(
        preferencesSchema.omit({ lastExport: true }), change.preferences, 'InvalidBackup') }) };
    default: throw new DomainError('InvalidLibrary');
  }
}

export async function applyLibraryChange(tx: LibraryWriteTransaction, prepared: LibraryChange, expectedVersion: LocalRevision, generation: string | null, assertReady: () => void = () => {}) {
  const replacementBytes = prepared.kind === 'replace' ? bytes(prepared.books) : 0;
  const putBytes = prepared.kind === 'put' ? bytes(prepared.book) : 0;
  const books = tx.objectStore('books');
  const meta = parseMetadata(await tx.objectStore('meta').get('library'));
  if (!sameRevision(meta, expectedVersion)) throw new DomainError('StaleRevision');
  if (meta.revision === Number.MAX_SAFE_INTEGER) throw new DomainError('UnsupportedVersion');
  assertReady();
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
    if (prepared.kind === 'put') {
      if (prepared.coverMedia) {
        const media = tx.objectStore('coverMedia');
        if (await media.get(prepared.coverMedia.id.toLowerCase())) throw new DomainError('InvalidBook');
        await media.add(prepared.coverMedia, prepared.coverMedia.id.toLowerCase());
      }
      await books.put(prepared.book, key);
    }
    else await books.delete(key);
  }
  // Validate the final state and collect only unreferenced bytes in this authorized write.
  const finalBooks = await books.getAll();
  const mediaStore = tx.objectStore('coverMedia');
  const storedMedia = (await mediaStore.getAll()).map(value => parseDomain(coverMediaSchema, value, 'InvalidLibrary'));
  const retained = validateMediaCollection(finalBooks, referencedMedia(finalBooks, storedMedia));
  assertPortableBudget(serializedBytes, retained);
  const retainedIds = new Set(retained.map(value => value.id.toLowerCase()));
  await Promise.all(storedMedia.filter(value => !retainedIds.has(value.id.toLowerCase()))
    .map(value => mediaStore.delete(value.id.toLowerCase())));
  const next: LibraryMetadata = {
    ...meta, generation: generation ?? meta.generation, revision: meta.revision + 1,
    bookCount, serializedBytes,
  };
  await tx.objectStore('meta').put(parseMetadata(next), 'library');
  // Durable intent is atomic with the library, even while disconnected or the app closes.
  // Contains a revision only; credentials never belong in this store.
  await tx.objectStore('syncOutbox').put({ version: versionOf(next) }, 'pending');
  return versionOf(next);
}
