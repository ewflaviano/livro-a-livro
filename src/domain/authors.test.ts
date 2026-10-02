import { describe, expect, it } from 'vitest';
import { createBook, type Book } from './book';
import { authorSearchText, groupBooksByAuthor } from './authors';

const book = (index: number, authors: string[], shelfYear = 2026, title = `Livro ${index}`): Book =>
  createBook({ title, authors, shelfYear }, {
    id: `12345678-1234-4234-9234-${String(index).padStart(12, '0')}`,
    now: '2026-09-26T12:00:00.000Z', shelfYear,
  });

describe('local author index', () => {
  it('groups saved labels across years and coauthors without changing books', () => {
    const books = [book(1, ['  ANA   Silva ', 'Bia'], 2025), book(2, ['Ana Silva'], 2026), book(3, ['Bia'], 2026), book(4, [])];
    const original = structuredClone(books);
    const groups = groupBooksByAuthor(books, 'pt-BR');
    expect(groups.map(group => [group.name, group.books.map(item => item.id)])).toEqual([
      ['ANA Silva', [books[1].id, books[0].id]],
      ['Bia', [books[2].id, books[0].id]],
    ]);
    expect(books).toEqual(original);
  });

  it('keeps different names and homonyms distinct only by their saved label', () => {
    const books = [book(1, ['José']), book(2, ['Jose']), book(3, ['José'])];
    const groups = groupBooksByAuthor(books, 'pt-BR');
    expect(groups).toHaveLength(2);
    expect(groups.find(group => group.name === 'José')?.books.map(item => item.id)).toEqual([books[0].id, books[2].id]);
    expect(groups.find(group => group.name === 'Jose')?.books).toEqual([books[1]]);
    expect(authorSearchText('  JOSE  ')).toBe('jose');
    expect(groups.filter(group => authorSearchText(group.name).includes(authorSearchText('Jose')))).toHaveLength(2);
  });

  it('sorts names and books deterministically using the interface locale', () => {
    const books = [book(1, ['Autora 10'], 2026, 'Volume 10'), book(2, ['Autora 2'], 2026, 'Volume 2'),
      book(3, ['Autora 10'], 2026, 'Volume 2'), book(4, ['Autora 10'], 2025, 'Volume 1')];
    for (const locale of ['pt-BR', 'en']) {
      const groups = groupBooksByAuthor(books, locale);
      expect(groups.map(group => group.name)).toEqual(['Autora 2', 'Autora 10']);
      expect(groups[1].books.map(item => item.id)).toEqual([books[2].id, books[0].id, books[3].id]);
    }
  });
});
