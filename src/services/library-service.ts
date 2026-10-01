import type { CoverMedia } from '../media/cover';
import { createBook, updateBook, type Book, type NewBook } from '../domain/book';
import { DomainError } from '../domain/errors';
import { probableDuplicates } from '../domain/library';
import type { LibraryRepository, LocalRevision } from '../ports/library-repository';

export const sameRevision = (a: LocalRevision, b: LocalRevision) =>
  a.generation === b.generation && a.revision === b.revision;

export type SaveBookResult =
  | { kind: 'duplicate'; count: number }
  | { kind: 'saved'; book: Book; version: LocalRevision };

/** All writes use the revision from opening the editor, never a refreshed projection. */
export function createLibraryService(repository: LibraryRepository, dependencies = {
  id: () => crypto.randomUUID(), now: () => new Date().toISOString(),
}) {
  return {
    readBook: (id: string) => repository.readBook(id),
    readCover: (id: string) => repository.readCover(id),
    readRevision: () => repository.readRevision(),
    async save(input: { draft: NewBook; id?: string; year: number; expected: LocalRevision; allowDuplicate?: boolean; coverMedia?: CoverMedia }): Promise<SaveBookResult> {
      const snapshot = await repository.readAll();
      if (!sameRevision(snapshot.version, input.expected)) throw new DomainError('StaleRevision');
      const previous = input.id ? snapshot.books.find((book) => book.id === input.id) : undefined;
      if (input.id && !previous) throw new DomainError('StaleRevision');
      const book = previous ? updateBook(previous, input.draft, dependencies.now()) :
        createBook(input.draft, { id: dependencies.id(), now: dependencies.now(), shelfYear: input.year });
      const duplicates = probableDuplicates(snapshot.books, book);
      if (duplicates.length && !input.allowDuplicate) return { kind: 'duplicate', count: duplicates.length };
      const version = await repository.commit({ kind: 'put', book, coverMedia: input.coverMedia }, input.expected);
      return { kind: 'saved', book, version };
    },
    async completeReading(id: string, expected: LocalRevision): Promise<{ book: Book; version: LocalRevision }> {
      const snapshot = await repository.readBook(id);
      if (!sameRevision(snapshot.version, expected) || snapshot.book?.status !== 'reading') throw new DomainError('StaleRevision');
      const book = updateBook(snapshot.book, { status: 'read' }, dependencies.now());
      const version = await repository.commit({ kind: 'put', book }, expected);
      return { book, version };
    },
    remove: (id: string, expected: LocalRevision) => repository.commit({ kind: 'delete', id }, expected),
  };
}

export type LibraryService = ReturnType<typeof createLibraryService>;
