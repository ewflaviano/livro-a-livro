import { expect, it } from 'vitest';
import { createBook } from './book';
import { booksWithNotes, matchesNote, matchingNoteExcerpt, noteExcerpt } from './notes';

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

it('shows a late matching passage with accent and whitespace folding', () => {
  const note = `${'😀 início '.repeat(35)}Coração\n revisitado <b>literal</b> fim`;
  const excerpt = matchingNoteExcerpt(note, 'coracao revisitado');
  expect(excerpt.startsWith('…')).toBe(true);
  expect(excerpt).toContain('Coração\n revisitado');
  expect(excerpt).toContain('<b>literal</b>');
  expect(Array.from(excerpt).length).toBeLessThanOrEqual(222);
});

it('keeps the initial excerpt when the note does not contain the search term', () => {
  const note = `${'início '.repeat(40)}fim`;
  expect(matchingNoteExcerpt(note, 'título')).toBe(noteExcerpt(note));
  expect(matchingNoteExcerpt(note, '')).toBe(noteExcerpt(note));
});

it('uses whole-string lowercasing for context-sensitive letters', () => {
  const note = `${'início '.repeat(40)}ΟΔΟΣ final`;
  expect(matchingNoteExcerpt(note, 'οδος')).toContain('ΟΔΟΣ');
});

it('keeps grapheme clusters intact at both excerpt boundaries', () => {
  const accented = matchingNoteExcerpt(`${'e\u0301'.repeat(250)} alvo`, 'alvo');
  const emoji = matchingNoteExcerpt(`${'👩‍💻'.repeat(250)} alvo`, 'alvo');
  expect(accented.slice(1, 3)).toBe('e\u0301');
  expect(emoji.slice(1, 6)).toBe('👩‍💻');
  expect(emoji).toContain('alvo');
});

it('shows both ends of a match separated by a long whitespace run', () => {
  const note = `a${' '.repeat(300)}b${'x'.repeat(100)}`;
  expect(matchesNote(book('Exemplo', 2026, note), 'a b')).toBe(true);
  expect(matchingNoteExcerpt(note, 'a b')).toContain('a…b');
});
