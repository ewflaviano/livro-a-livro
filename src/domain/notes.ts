import type { Book } from './book';

/** A read-only view of private notes already present in the library snapshot. */
export function booksWithNotes(books: readonly Book[], locale: string): Book[] {
  const collator = new Intl.Collator(locale, { sensitivity: 'base', numeric: true });
  return books.filter(book => book.note.trim().length > 0).sort((a, b) =>
    b.shelfYear - a.shelfYear || collator.compare(a.title, b.title) ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Search only in memory; saved spelling and line breaks are never changed. */
export function noteSearchText(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '').trim().replace(/\s+/gu, ' ').toLocaleLowerCase('pt-BR');
}

export function matchesNote(book: Book, query: string): boolean {
  const needle = noteSearchText(query);
  return !needle || noteSearchText([book.title, ...book.authors, book.note].join(' ')).includes(needle);
}

export function noteExcerpt(note: string, maxCharacters = 220): string {
  const characters = Array.from(note.trim());
  return characters.length > maxCharacters
    ? `${characters.slice(0, maxCharacters).join('').trimEnd()}…`
    : characters.join('');
}
