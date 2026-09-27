import { z } from 'zod';
import { bookSchema, compareInstants, normalizeName, shelfYearSchema } from './book';
import type { Book, ReadingStatus } from './book';
import { DomainError, parseDomain } from './errors';

export const LIBRARY_LIMITS = {
  books: 10_000,
  jsonBytes: 50 * 1024 * 1024,
  exportEnvelopeBytes: 1024,
} as const;

// JSON.stringify escapes lone surrogates. Count UTF-8 without a browser/Node API.
export function utf8ByteLength(text: string): number {
  let bytes = 0;
  for (const character of text) {
    const code = character.codePointAt(0)!;
    bytes += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4;
  }
  return bytes;
}

export const librarySchema = z.array(bookSchema).max(LIBRARY_LIMITS.books)
  .superRefine((books, ctx) => {
    const ids = new Set<string>();
    books.forEach((book, index) => {
      // UUID text is case insensitive, including imported records.
      const id = book.id.toLowerCase();
      if (ids.has(id)) ctx.addIssue({ code: 'custom', path: [index, 'id'] });
      ids.add(id);
    });
    if (utf8ByteLength(JSON.stringify(books)) + LIBRARY_LIMITS.exportEnvelopeBytes > LIBRARY_LIMITS.jsonBytes) {
      ctx.addIssue({ code: 'custom', params: { limit: 'jsonBytes' } });
    }
  });

export function parseLibrary(input: unknown): Book[] {
  const result = librarySchema.safeParse(input);
  if (result.success) return result.data;
  if (result.error.issues.some((issue) =>
    (issue.code === 'custom' && issue.params?.limit === 'jsonBytes') ||
    (issue.code === 'too_big' && issue.path.length === 0))) {
    throw new DomainError('ImportTooLarge');
  }
  throw new DomainError('InvalidLibrary', result.error.issues.map((issue) => ({
    code: issue.code,
    path: issue.path.filter((part): part is string | number =>
      typeof part === 'string' || typeof part === 'number'),
  })));
}

export function formatShelfYear(year: number): string {
  return String(parseDomain(shelfYearSchema, year)).padStart(4, '0');
}

export function booksForYear(books: readonly Book[], year: number, status?: ReadingStatus): Book[] {
  parseDomain(shelfYearSchema, year);
  return books.filter((book) => book.shelfYear === year && (status === undefined || book.status === status))
    .sort((left, right) => compareInstants(right.createdAt, left.createdAt) ||
      (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
}

export type DuplicateReason = 'title_authors' | 'edition' | 'isbn';
export type DuplicateWarning = { bookId: string; reasons: DuplicateReason[] };

// An advisory projection only; repeated readings and homonyms remain valid records.
export function probableDuplicates(books: readonly Book[], candidate: Book): DuplicateWarning[] {
  const authorKey = (book: Book) => JSON.stringify(book.authors.map(normalizeName).sort());
  const candidateAuthors = authorKey(candidate);
  return books.flatMap((book) => {
    if (book.id.toLowerCase() === candidate.id.toLowerCase() || book.shelfYear !== candidate.shelfYear) return [];
    const reasons: DuplicateReason[] = [];
    if (normalizeName(book.title) === normalizeName(candidate.title) && authorKey(book) === candidateAuthors) {
      reasons.push('title_authors');
    }
    if (book.source?.editionId && book.source.editionId === candidate.source?.editionId) reasons.push('edition');
    if (book.isbn && book.isbn === candidate.isbn) reasons.push('isbn');
    return reasons.length ? [{ bookId: book.id, reasons }] : [];
  });
}
