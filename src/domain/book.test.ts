import { describe, expect, it } from 'vitest';
import {
  bookSchema, civilDateSchema, compareInstants, createBook, instantSchema,
  isbnSchema, normalizeName, parseBook, readingStatusSchema, updateBook,
} from './book';
import { DomainError, domainErrorCodeSchema } from './errors';

const context = {
  id: 'f4bda493-cacc-4cc1-b362-5625b8ea3917',
  now: '2026-09-26T12:00:00.000Z',
  shelfYear: 2026,
};

describe('Book contract', () => {
  it('creates a minimal manual record with injected identity, instant and year', () => {
    expect(createBook({ title: '  Livro sintético  ' }, context)).toEqual({
      id: context.id, title: 'Livro sintético', authors: [], status: 'want_to_read',
      shelfYear: 2026, pageCount: null, isbn: null, publicationYear: null,
      startedOn: null, finishedOn: null, rating: null, note: '', cover: null,
      source: null, createdAt: context.now, updatedAt: context.now,
    });
    expect(createBook({ title: 'Outro', shelfYear: 1 }, context).shelfYear).toBe(1);
  });

  it('accepts only the three specified statuses', () => {
    expect(readingStatusSchema.options).toEqual(['want_to_read', 'reading', 'read']);
    expect(() => createBook({ title: 'Livro', status: 'abandoned' }, context)).toThrow(DomainError);
  });

  it.each([
    { title: '' }, { title: ' \n ' }, { title: 'a'.repeat(501) },
    { authors: [''] }, { authors: ['\u00a0'] }, { authors: ['A'.repeat(201)] },
    { authors: Array.from({ length: 21 }, (_, i) => `Autoria ${i}`) },
    { authors: ['Ａna  Silva', 'ana silva'] },
    { shelfYear: 0 }, { shelfYear: 10000 }, { shelfYear: 2026.1 }, { shelfYear: '2026' },
    { publicationYear: 0 }, { publicationYear: 10000 }, { publicationYear: 1.5 },
    { pageCount: 0 }, { pageCount: -1 }, { pageCount: 1.2 }, { pageCount: 1000001 },
    { pageCount: Infinity }, { pageCount: NaN }, { pageCount: '200' },
    { rating: 0 }, { rating: 6 }, { rating: 2.5 }, { rating: '3' },
    { note: 'a'.repeat(20001) }, { cover: { provider: 'external', coverId: 1 } },
    { cover: { provider: 'open_library', coverId: 0 } },
    { cover: { provider: 'open_library', coverId: 1.5 } },
    { cover: { provider: 'open_library', coverId: Number.MAX_SAFE_INTEGER + 1 } },
  ])('rejects invalid field values (case %#)', (patch) => {
    expect(() => createBook({ title: 'Livro', ...patch }, context)).toThrow(DomainError);
  });

  it('accepts field limits and optional ratings in every status', () => {
    for (const status of readingStatusSchema.options) {
      const book = createBook({
        title: 'a'.repeat(500), authors: Array.from({ length: 20 }, (_, i) => `${i}`.padEnd(200, 'a')),
        status, pageCount: 1000000, shelfYear: 9999, publicationYear: 1,
        note: 'n'.repeat(20000), rating: 5,
      }, context);
      expect(book.rating).toBe(5);
      expect(book.publicationYear).toBe(1);
      for (const rating of [1, 2, 3, 4, 5, null]) {
        expect(updateBook(book, { rating }, context.now).rating).toBe(rating);
      }
    }
  });

  it('preserves saved plain text, author spelling and civil dates', () => {
    const note = '  linha e\u0301\r\n\t<texto literal> 📚\n';
    const book = createBook({ title: 'Livro', note, authors: ['  AＮa  Silva  '],
      status: 'read', startedOn: '2025-12-31', finishedOn: '2026-01-01' }, context);
    expect(parseBook(JSON.parse(JSON.stringify(book)))).toEqual(book);
    expect(book.note).toBe(note);
    expect(book.authors).toEqual(['  AＮa  Silva  ']);
    expect(normalizeName(book.authors[0])).toBe('ana silva');
    expect(book.startedOn).toBe('2025-12-31');
    expect(book.finishedOn).toBe('2026-01-01');
  });

  it('requires the full persisted contract and rejects unknown fields at every level', () => {
    const book = createBook({ title: 'Livro' }, context);
    const { note: _note, ...missing } = book;
    expect(bookSchema.safeParse(missing).success).toBe(false);
    expect(() => parseBook({ ...book, secret: true })).toThrow(DomainError);
    expect(() => createBook({ title: 'Livro', id: context.id }, context)).toThrow(DomainError);
    expect(() => updateBook(book, { createdAt: context.now }, context.now)).toThrow(DomainError);
    expect(() => createBook({ title: 'Livro', cover: {
      provider: 'open_library', coverId: 1, url: 'https://invalid.test',
    } }, context)).toThrow(DomainError);
  });

  it('accepts OL identifiers as references only', () => {
    const source = { provider: 'open_library', workId: 'OL123W', editionId: 'OL456M', retrievedAt: context.now };
    expect(createBook({ title: 'Livro', source }, context).source).toEqual(source);
    expect(createBook({ title: 'Livro', source: { ...source, workId: null, editionId: null } }, context).source?.workId).toBeNull();
    for (const workId of ['OL123M', '/works/OL123W', 'https://openlibrary.org/works/OL123W', 'OL0W']) {
      expect(() => createBook({ title: 'Livro', source: { ...source, workId } }, context)).toThrow(DomainError);
    }
    expect(() => createBook({ title: 'Livro', source: { ...source, editionId: 'OL123W' } }, context)).toThrow(DomainError);
    expect(() => createBook({ title: 'Livro', source: { ...source, payload: 'extra' } }, context)).toThrow(DomainError);
    expect(() => createBook({ title: 'Livro' }, { ...context, id: 'not-a-uuid' })).toThrow(DomainError);
  });
});

describe('civil dates and status changes', () => {
  it.each(['2000-02-29', '2024-02-29', '0001-01-01', '9999-12-31'])('accepts %s', (date) => {
    expect(civilDateSchema.parse(date)).toBe(date);
  });
  it.each(['1900-02-29', '2026-02-29', '2026-04-31', '0000-01-01', '2026-13-01',
    '2026-01-00', '2026-1-01', '2026-01-01T00:00:00Z', '2026-01-01-03:00'])('rejects %s', (date) => {
    expect(civilDateSchema.safeParse(date).success).toBe(false);
  });
  it('allows unknown dates, same-day readings and starts in earlier years', () => {
    for (const status of readingStatusSchema.options) {
      expect(createBook({ title: 'Livro', status }, context).finishedOn).toBeNull();
    }
    expect(createBook({ title: 'Livro', status: 'reading', startedOn: '2025-01-01' }, context).startedOn).toBe('2025-01-01');
    expect(createBook({ title: 'Livro', status: 'read', startedOn: '2026-01-01', finishedOn: '2026-01-01' }, context).finishedOn).toBe('2026-01-01');
    expect(createBook({ title: 'Livro', status: 'read', finishedOn: '2026-01-01' }, context).startedOn).toBeNull();
  });
  it.each([
    { status: 'want_to_read', startedOn: '2026-01-01' },
    { status: 'want_to_read', finishedOn: '2026-01-01' },
    { status: 'reading', finishedOn: '2026-01-01' },
    { status: 'read', startedOn: '2026-02-01', finishedOn: '2026-01-01' },
    { status: 'read', finishedOn: '2025-12-31' },
  ])('rejects incompatible dates (case %#)', (patch) => {
    expect(() => createBook({ title: 'Livro', ...patch }, context)).toThrow(DomainError);
  });
  it('requires an explicit correction when changing status or year and never mutates the original', () => {
    const book = createBook({ title: 'Livro', status: 'read', startedOn: '2025-12-31', finishedOn: '2026-01-01' }, context);
    const original = structuredClone(book);
    expect(() => updateBook(book, { status: 'reading' }, context.now)).toThrow(DomainError);
    expect(() => updateBook(book, { shelfYear: 2025 }, context.now)).toThrow(DomainError);
    expect(updateBook(book, { status: 'reading', finishedOn: null }, context.now).startedOn).toBe('2025-12-31');
    expect(updateBook(book, { status: 'want_to_read', startedOn: null, finishedOn: null }, context.now).status).toBe('want_to_read');
    expect(book).toEqual(original);
  });
});

describe('ISBN validation', () => {
  it.each([
    ['0-306-40615-2', '0306406152'], ['0 8044 2957 x', '080442957X'],
    ['978-0-306-40615-7', '9780306406157'], ['9791090636071', '9791090636071'],
  ])('normalizes valid ISBN %s', (input, normalized) => {
    expect(isbnSchema.parse(input)).toBe(normalized);
  });
  it.each(['', '0306406153', '0804429570', '9780306406158', '1234567890128', 'X306406152',
    '978030640615', '97803064061570', '978_0306406157'])('rejects %s without repair', (isbn) => {
    expect(isbnSchema.safeParse(isbn).success).toBe(false);
    expect(() => createBook({ title: 'Livro', isbn }, context)).toThrow(DomainError);
  });
});

describe('instants and safe errors', () => {
  it.each(['2026-02-29T12:00:00Z', '2026-09-26', '2026-09-26T12:00:00',
    '2026-09-26T12:00:00-03:00', '2026-09-26T24:00:00Z', '0000-01-01T00:00:00Z'])('rejects %s', (now) => {
    expect(instantSchema.safeParse(now).success).toBe(false);
  });
  it('preserves creation, prevents clock regression and compares unequal fractional precision', () => {
    const book = createBook({ title: 'Livro' }, context);
    const updated = updateBook(book, { note: 'Nova nota' }, '2026-09-27T01:00:00Z');
    expect(updated.createdAt).toBe(context.now);
    expect(updated.updatedAt).toBe('2026-09-27T01:00:00Z');
    expect(updateBook(updated, { title: 'Outro' }, '2020-01-01T00:00:00Z').updatedAt).toBe(updated.updatedAt);
    expect(compareInstants('2026-09-26T12:00:00Z', context.now)).toBe(0);
    expect(compareInstants('2026-09-26T12:00:00.0001Z', context.now)).toBe(1);
    expect(() => parseBook({ ...book, updatedAt: '2026-09-26T11:59:59Z' })).toThrow(DomainError);
    expect(updateBook(book, { note: undefined }, context.now).note).toBe('');
  });
  it('returns only codes and field paths, including for unknown keys containing private text', () => {
    try {
      parseBook({ ...createBook({ title: 'PRIVATE TITLE', note: 'PRIVATE NOTE' }, context),
        status: 'PRIVATE STATUS', 'PRIVATE KEY': true });
      expect.fail('must reject');
    } catch (error) {
      expect(error).toBeInstanceOf(DomainError);
      const domainError = error as DomainError;
      expect(domainError.code).toBe('InvalidBook');
      expect(domainError.issues).toContainEqual({ code: 'invalid_value', path: ['status'] });
      expect(JSON.stringify(domainError)).not.toContain('PRIVATE');
      expect(domainError.message).toBe('InvalidBook');
    }
    for (const code of domainErrorCodeSchema.options) expect(new DomainError(code).code).toBe(code);
  });
});
