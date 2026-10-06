import { describe, expect, it } from 'vitest';
import { createBook, type Book } from './book';
import { duplicateGroups } from './duplicates';

const now = '2026-09-26T12:00:00.000Z';
const id = (number: number) => `00000000-0000-4000-8000-${number.toString(16).padStart(12, '0')}`;
function book(number: number, patch: Partial<Book> = {}): Book {
  const year = patch.shelfYear ?? 2026;
  return createBook({ title: `Livro ${number}`, status: 'read', authors: ['Lia'], shelfYear: year, ...patch },
    { id: id(number), shelfYear: year, now });
}

describe('reviewing possible duplicates', () => {
  it('combines matching title/authors, ISBN and edition for the same records', () => {
    const source = { provider: 'open_library' as const, workId: 'OL1W', editionId: 'OL2M', retrievedAt: now };
    const first = book(1, { title: '  Ｊardim de Vidro ', authors: ['LIA', 'José'], isbn: '9780306406157', source });
    const second = book(2, { title: 'jardim de vidro', authors: ['Jose\u0301', 'lia'], isbn: '9780306406157', source });
    const groups = duplicateGroups([first, second], 'pt-BR');
    expect(groups).toHaveLength(1);
    expect(groups[0].reasons).toEqual(['title_authors', 'isbn', 'edition']);
    expect(groups[0].books.map(item => item.id)).toEqual([first.id, second.id]);
  });

  it('keeps different years and distinct signal memberships separate', () => {
    const first = book(1, { title: 'Mar', isbn: '9780306406157' });
    const second = book(2, { title: 'Mar', isbn: '9780306406157' });
    const third = book(3, { title: 'Mar' });
    const otherYear = book(4, { title: 'Mar', isbn: '9780306406157', shelfYear: 2025 });
    const groups = duplicateGroups([first, second, third, otherYear], 'pt-BR');
    expect(groups).toHaveLength(2);
    expect(groups.find(group => group.books.length === 3)?.reasons).toEqual(['title_authors']);
    expect(groups.find(group => group.books.length === 2)?.reasons).toEqual(['isbn']);
    expect(groups.every(group => group.year === 2026)).toBe(true);
  });

  it('does not equate a work ID alone, or absent ISBNs and edition IDs', () => {
    const source = { provider: 'open_library' as const, workId: 'OL1W', editionId: null, retrievedAt: now };
    expect(duplicateGroups([book(1, { source }), book(2, { source })], 'en')).toEqual([]);
  });

  it('keeps a large matching group as one bounded projection instead of materializing pairs', () => {
    const original = book(1, { title: 'Título sintético' });
    const records = Array.from({ length: 10_000 }, (_, index) => ({ ...original, id: id(index + 1) }));
    const groups = duplicateGroups(records, 'pt-BR');
    expect(groups).toHaveLength(1);
    expect(groups[0].books).toHaveLength(10_000);
  });
});
