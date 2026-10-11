import { expect, it } from 'vitest';
import { createBook, type Book } from './book';
import { booksMissingDetail } from './review-details';

const now = '2026-09-26T12:00:00.000Z';
const book = (id: number, title: string, year: number, patch: Partial<Book> = {}) =>
  createBook({ title, shelfYear: year, status: 'read', authors: ['Autora'], pageCount: 10,
    isbn: '9780306406157', ...patch },
  { id: `00000000-0000-4000-8000-${id.toString().padStart(12, '0')}`, shelfYear: year, now });

it('selects each optional missing detail independently and orders by year, title, then ID', () => {
  const a = book(1, 'Zeta', 2026, { authors: [], pageCount: null });
  const b = book(2, 'Árvore', 2026, { authors: [], isbn: null });
  const c = book(3, 'Árvore', 2026, { authors: [] });
  const d = book(4, 'Antigo', 2024, { authors: [], pageCount: null, isbn: null });
  const source = [d, c, a, b];
  expect(booksMissingDetail(source, 'authors', 'pt-BR').map(item => item.id))
    .toEqual([b.id, c.id, a.id, d.id]);
  expect(booksMissingDetail(source, 'pages', 'pt-BR').map(item => item.id)).toEqual([a.id, d.id]);
  expect(booksMissingDetail(source, 'isbn', 'pt-BR').map(item => item.id)).toEqual([b.id, d.id]);
  expect(source).toEqual([d, c, a, b]);
});
