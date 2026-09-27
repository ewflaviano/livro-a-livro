import { z } from 'zod';
import { parseDomain } from './errors';

export const BOOK_LIMITS = {
  title: 500,
  author: 200,
  authors: 20,
  note: 20_000,
  pageCount: 1_000_000,
} as const;

export const readingStatusSchema = z.enum(['want-to-read', 'reading', 'read']);
export type ReadingStatus = z.infer<typeof readingStatusSchema>;
export const shelfYearSchema = z.number().int().min(1).max(9999);

// Comparison keys only: saved author spelling, spacing and order remain intact.
export function normalizeName(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase();
}

export const civilDateSchema = z.iso.date().refine((value) => !value.startsWith('0000'));
export const instantSchema = z.iso.datetime().refine((value) =>
  !value.startsWith('0000') && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/u.test(value));

// UTC seconds sort lexically; compare fractions at equal precision without rounding.
export function compareInstants(left: string, right: string): number {
  const [leftSeconds, leftFraction = ''] = left.slice(0, -1).split('.');
  const [rightSeconds, rightFraction = ''] = right.slice(0, -1).split('.');
  const precision = Math.max(leftFraction.length, rightFraction.length);
  const a = leftSeconds + leftFraction.padEnd(precision, '0');
  const b = rightSeconds + rightFraction.padEnd(precision, '0');
  return a < b ? -1 : a > b ? 1 : 0;
}

export function normalizeIsbn(value: string): string {
  return value.replace(/[\s-]/gu, '').toUpperCase();
}

function isValidIsbn(value: string): boolean {
  if (/^\d{9}[\dX]$/u.test(value)) {
    return [...value].reduce((sum, digit, index) =>
      sum + (digit === 'X' ? 10 : Number(digit)) * (10 - index), 0) % 11 === 0;
  }
  if (/^97[89]\d{10}$/u.test(value)) {
    return [...value].reduce((sum, digit, index) =>
      sum + Number(digit) * (index % 2 === 0 ? 1 : 3), 0) % 10 === 0;
  }
  return false;
}

export const isbnSchema = z.string().transform(normalizeIsbn).refine(isValidIsbn);

const bookFields = z.strictObject({
  id: z.uuid(),
  title: z.string().trim().min(1).max(BOOK_LIMITS.title),
  authors: z.array(z.string().max(BOOK_LIMITS.author)
    .refine((name) => normalizeName(name).length > 0)).max(BOOK_LIMITS.authors)
    .refine((authors) => new Set(authors.map(normalizeName)).size === authors.length),
  status: readingStatusSchema,
  shelfYear: shelfYearSchema,
  pageCount: z.number().int().positive().max(BOOK_LIMITS.pageCount).nullable(),
  isbn: isbnSchema.nullable(),
  publicationYear: shelfYearSchema.nullable(),
  startedOn: civilDateSchema.nullable(),
  finishedOn: civilDateSchema.nullable(),
  rating: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]).nullable(),
  // Plain text, including literal angle brackets; consumers must never interpret HTML.
  note: z.string().max(BOOK_LIMITS.note),
  cover: z.strictObject({
    provider: z.literal('open_library'),
    coverId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  }).nullable(),
  source: z.strictObject({
    provider: z.literal('open_library'),
    workId: z.string().regex(/^OL[1-9]\d*W$/u).nullable(),
    editionId: z.string().regex(/^OL[1-9]\d*M$/u).nullable(),
    retrievedAt: instantSchema,
  }).nullable(),
  createdAt: instantSchema,
  updatedAt: instantSchema,
});

export const bookSchema = bookFields.superRefine((book, ctx) => {
  const invalid = (field: keyof typeof book) => ctx.addIssue({ code: 'custom', path: [field] });
  if (book.status === 'want-to-read' && book.startedOn !== null) invalid('startedOn');
  if (book.status !== 'read' && book.finishedOn !== null) invalid('finishedOn');
  if (book.startedOn && book.finishedOn && book.startedOn > book.finishedOn) invalid('finishedOn');
  if (book.finishedOn && Number(book.finishedOn.slice(0, 4)) !== book.shelfYear) invalid('shelfYear');
  if (compareInstants(book.updatedAt, book.createdAt) < 0) invalid('updatedAt');
});

export type Book = z.infer<typeof bookSchema>;
const editableFields = bookFields.omit({ id: true, createdAt: true, updatedAt: true });
export const bookPatchSchema = editableFields.partial();
export const newBookSchema = bookPatchSchema.required({ title: true });
export type NewBook = z.input<typeof newBookSchema>;
export type BookPatch = z.input<typeof bookPatchSchema>;

export function parseBook(input: unknown): Book {
  return parseDomain(bookSchema, input);
}

export function createBook(input: unknown, context: { id: string; now: string; shelfYear: number }): Book {
  const draft = parseDomain(newBookSchema, input);
  const year = parseDomain(shelfYearSchema, context.shelfYear);
  return parseBook({
    authors: [], status: 'want-to-read', shelfYear: year, pageCount: null,
    isbn: null, publicationYear: null, startedOn: null, finishedOn: null,
    rating: null, note: '', cover: null, source: null,
    ...Object.fromEntries(Object.entries(draft).filter(([, value]) => value !== undefined)),
    id: context.id, createdAt: context.now, updatedAt: context.now,
  });
}

export function updateBook(previous: Book, input: unknown, now: string): Book {
  const current = parseBook(previous);
  const patch = parseDomain(bookPatchSchema, input);
  const instant = parseDomain(instantSchema, now);
  return parseBook({
    ...current,
    ...Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)),
    updatedAt: compareInstants(instant, current.updatedAt) > 0 ? instant : current.updatedAt,
  });
}
