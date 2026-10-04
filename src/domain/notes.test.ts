import { expect, it } from 'vitest';
import { createBook } from './book';
import { booksWithNotes, matchesNote, noteExcerpt } from './notes';

function book(title: string, year: number, note: string, authors: string[] = []) {
  return createBook({ title, shelfYear: year, note, authors }, { id: crypto.randomUUID(), shelfYear: year, now: '2026-09-26T12:00:00.000Z' });
}

it('projects only nonempty private notes across years in stable year and title order', () => {
  const books = [book('Zeta', 2024, 'lembrete'), book('Beta', 2026, '\n  '), book('Água', 2026, 'nota'), book('Bola', 2026, 'nota')];
  expect(booksWithNotes(books, 'pt-BR').map(item => item.title)).toEqual(['Água', 'Bola', 'Zeta']);
  expect(books.map(item => item.title)).toEqual(['Zeta', 'Beta', 'Água', 'Bola']);
});

it('finds title, author and note passages without changing the saved text', () => {
  const item = book('Maré', 2025, 'Coração\nrevisitado <b>literal</b>', ['João']);
  expect(matchesNote(item, 'mare')).toBe(true);
  expect(matchesNote(item, 'joao')).toBe(true);
  expect(matchesNote(item, 'coracao revisitado')).toBe(true);
  expect(matchesNote(item, 'outro')).toBe(false);
  expect(item.note).toBe('Coração\nrevisitado <b>literal</b>');
});

it('limits a long excerpt without splitting a Unicode character', () => {
  expect(noteExcerpt('  😀😀😀  ', 2)).toBe('😀😀…');
  expect(noteExcerpt('linha 1\nlinha 2')).toBe('linha 1\nlinha 2');
});
