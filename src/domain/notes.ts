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

/** Keep the matching passage visible without changing or storing the private note. */
export function matchingNoteExcerpt(note: string, query: string, maxCharacters = 220): string {
  const needle = Array.from(noteSearchText(query));
  if (!('Segmenter' in Intl)) return noteExcerpt(note, maxCharacters);
  const characters = Array.from(new Intl.Segmenter('pt-BR', { granularity: 'grapheme' }).segment(note.trim()),
    segment => segment.segment);
  if (!needle.length) return noteExcerpt(note, maxCharacters);
  if (characters.length <= maxCharacters) return characters.join('');

  const unfolded: string[] = [];
  const positions: number[] = [];
  for (const [index, character] of characters.entries()) {
    const withoutMarks = character.normalize('NFD').replace(/\p{M}/gu, '');
    for (const part of Array.from(withoutMarks)) {
      if (/\s/u.test(part)) {
        if (unfolded.length && unfolded.at(-1) !== ' ') {
          unfolded.push(' ');
          positions.push(index);
        }
      } else {
        unfolded.push(part);
        positions.push(index);
      }
    }
  }
  const normalized = Array.from(unfolded.join('').toLocaleLowerCase('pt-BR'));
  if (normalized.length !== positions.length) return noteExcerpt(note, maxCharacters);
  if (normalized.join('') !== noteSearchText(note)) return noteExcerpt(note, maxCharacters);

  const match = normalized.findIndex((_, index) =>
    needle.every((part, offset) => normalized[index + offset] === part));
  if (match < 0) return noteExcerpt(note, maxCharacters);

  const first = positions[match];
  const last = positions[match + needle.length - 1] + 1;
  const span = last - first;
  if (span > maxCharacters) {
    const side = Math.max(1, Math.floor(maxCharacters / 4));
    const firstStart = Math.max(0, first - side);
    const firstEnd = Math.min(characters.length, first + side);
    const lastStart = Math.max(firstEnd, last - side);
    const lastEnd = Math.min(characters.length, last + side);
    return `${firstStart ? '…' : ''}${characters.slice(firstStart, firstEnd).join('').trimEnd()}…${characters.slice(lastStart, lastEnd).join('').trimStart()}${lastEnd < characters.length ? '…' : ''}`;
  }
  let start = Math.max(0, first - Math.floor((maxCharacters - Math.min(span, maxCharacters)) / 2));
  let end = Math.min(characters.length, start + maxCharacters);
  start = Math.max(0, end - maxCharacters);
  if (last > end) {
    end = Math.min(characters.length, last);
    start = Math.max(0, end - maxCharacters);
  }
  return `${start ? '…' : ''}${characters.slice(start, end).join('').trim()}${end < characters.length ? '…' : ''}`;
}
