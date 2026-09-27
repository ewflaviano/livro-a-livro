import { describe, expect, it } from 'vitest';
import { createBook } from './book';
import type { Book, NewBook } from './book';
import { booksForYear, formatShelfYear, LIBRARY_LIMITS, parseLibrary, probableDuplicates, utf8ByteLength } from './library';
import { statisticsForYear } from './statistics';

const now = '2026-09-26T12:00:00.000Z';
function book(index: number, fields: Partial<NewBook> = {}): Book {
  return createBook({ title: `Livro ${index}`, ...fields }, {
    id: `12345678-1234-4234-9234-${String(index).padStart(12, '0')}`,
    shelfYear: 2026, now,
  });
}

describe('annual shelf', () => {
  it('formats and validates the year without consulting a clock', () => {
    expect(formatShelfYear(1)).toBe('0001');
    expect(formatShelfYear(2026)).toBe('2026');
    expect(formatShelfYear(9999)).toBe('9999');
    for (const year of [0, 10000, 1.5, NaN]) {
      expect(() => formatShelfYear(year)).toThrow();
      expect(() => booksForYear([], year)).toThrow();
      expect(() => statisticsForYear([], year)).toThrow();
    }
  });
  it('filters by year/status and sorts newest first with stable UUID ties without mutation', () => {
    const newer = { ...book(3, { status: 'read' }), createdAt: '2026-09-26T12:00:00.1Z', updatedAt: '2026-09-26T12:00:00.1Z' };
    const older = { ...book(4), createdAt: '2025-01-01T00:00:00Z' };
    const books = [book(2, { status: 'reading' }), book(1), newer, book(5, { shelfYear: 2025 }), older];
    const original = structuredClone(books);
    expect(booksForYear(books, 2026).map((b) => b.id)).toEqual([3, 1, 2, 4].map((i) => book(i).id));
    expect(booksForYear(books, 2026, 'reading')).toEqual([books[0]]);
    expect(booksForYear(books, 2024)).toEqual([]);
    expect(books).toEqual(original);
  });
});

describe('duplicate warnings and identity', () => {
  it('uses normalized title and unordered normalized authors in the same shelf year', () => {
    const candidate = book(1, { title: '  Ｌivro  do  mar ', authors: ['ANA Silva', 'José'] });
    const match = book(2, { title: 'livro do mar', authors: ['Jose\u0301', 'ana  silva'] });
    const otherAuthor = book(3, { title: 'livro do mar', authors: ['Outra pessoa'] });
    const otherYear = { ...match, id: book(4).id, shelfYear: 2025 };
    expect(probableDuplicates([candidate, match, otherAuthor, otherYear], candidate)).toEqual([
      { bookId: match.id, reasons: ['title_authors'] },
    ]);
    expect(parseLibrary([candidate, match])).toEqual([candidate, match]);
  });
  it('matches ISBN or edition independently, but never work alone or absent identifiers', () => {
    const source = { provider: 'open_library' as const, workId: 'OL1W', editionId: 'OL2M', retrievedAt: now };
    const candidate = book(1, { isbn: '978-0-306-40615-7', source });
    const isbn = book(2, { isbn: '9780306406157' });
    const edition = book(3, { source });
    const work = book(4, { source: { ...source, editionId: 'OL3M' } });
    expect(probableDuplicates([isbn, edition, work, book(5), { ...isbn, shelfYear: 2025 }], candidate)).toEqual([
      { bookId: isbn.id, reasons: ['isbn'] }, { bookId: edition.id, reasons: ['edition'] },
    ]);
    expect(probableDuplicates([book(6, { title: 'Igual' })], book(7, { title: 'Igual' }))[0].reasons).toEqual(['title_authors']);
  });
  it('rejects repeated UUIDs across years, including differences in case', () => {
    const item = { ...book(1), id: 'f4bda493-cacc-4cc1-b362-5625b8ea3917' };
    expect(() => parseLibrary([item, { ...item, shelfYear: 2025 }])).toThrow('InvalidLibrary');
    expect(() => parseLibrary([item, { ...item, id: item.id.toUpperCase() }])).toThrow('InvalidLibrary');
  });
});

describe('portable library limits', () => {
  it('accepts an empty library and the record-count boundary', () => {
    expect(parseLibrary([])).toEqual([]);
    const records = Array.from({ length: LIBRARY_LIMITS.books }, (_, i) => book(i));
    expect(parseLibrary(records)).toHaveLength(LIBRARY_LIMITS.books);
    expect(() => parseLibrary([...records, book(10001)])).toThrow('ImportTooLarge');
  });
  it('counts UTF-8, including surrogate pairs and JSON escaping', () => {
    expect(utf8ByteLength('abcé中📚')).toBe(12);
    expect(utf8ByteLength(JSON.stringify('\ud800'))).toBe(8);
    expect(utf8ByteLength(JSON.stringify('"\n'))).toBe(6);
  });
  it('reserves space for the export envelope and rejects an oversized Unicode library', () => {
    const item = book(0, { note: 'é'.repeat(20000) });
    const entryBytes = utf8ByteLength(JSON.stringify(item)) + 1;
    const count = Math.floor((LIBRARY_LIMITS.jsonBytes - LIBRARY_LIMITS.exportEnvelopeBytes - 1) / entryBytes);
    const records = Array.from({ length: count }, (_, i) => ({ ...item, id: book(i).id }));
    expect(parseLibrary(records)).toHaveLength(count);
    const envelope = JSON.stringify({ format: 'livro-a-livro', schemaVersion: 1, exportedAt: now, books: records }) + '\n';
    expect(utf8ByteLength(envelope)).toBeLessThanOrEqual(LIBRARY_LIMITS.jsonBytes);
    expect(() => parseLibrary([...records, { ...item, id: book(count).id }])).toThrow('ImportTooLarge');
  });
});

describe('statistics for completed readings in the shelf year', () => {
  it('counts rereadings, reported pages and normalized distinct authors, independently of creation/finish dates', () => {
    const books = [
      book(1, { status: 'read', pageCount: 100, authors: ['Ana  Silva', 'José'] }),
      { ...book(2, { status: 'read', pageCount: 200, authors: ['ＡNA Silva', 'Jose\u0301'] }), createdAt: '2025-01-01T00:00:00Z' },
      book(3, { status: 'read' }),
      book(4, { status: 'reading', pageCount: 900, authors: ['Não contar'] }),
      book(5, { status: 'want-to-read', pageCount: 800, authors: ['Também não'] }),
      book(6, { status: 'read', shelfYear: 2025, pageCount: 700, authors: ['Outro ano'] }),
    ];
    const original = structuredClone(books);
    expect(statisticsForYear(books, 2026)).toEqual({ books: 3, pages: 300, authors: 2, booksWithPages: 2, booksWithAuthors: 2 });
    booksForYear(books, 2026, 'reading');
    expect(statisticsForYear(books, 2026).books).toBe(3);
    expect(books).toEqual(original);
  });
  it('distinguishes an empty year from read books with no known page counts or authors', () => {
    expect(statisticsForYear([book(1)], 2026)).toEqual({ books: 0, pages: 0, authors: 0, booksWithPages: 0, booksWithAuthors: 0 });
    expect(statisticsForYear([book(1, { status: 'read' })], 2026)).toEqual({ books: 1, pages: null, authors: null, booksWithPages: 0, booksWithAuthors: 0 });
    expect(statisticsForYear([book(1, { status: 'read', authors: ['Ana'] })], 2026)).toEqual({ books: 1, pages: null, authors: 1, booksWithPages: 0, booksWithAuthors: 1 });
  });
  it('does not merge accents or different pseudonyms through fuzzy matching', () => {
    expect(statisticsForYear([book(1, { status: 'read', authors: ['Jose', 'José', 'Pseudônimo'] })], 2026).authors).toBe(3);
  });
});
