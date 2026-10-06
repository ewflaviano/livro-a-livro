import type { Book } from './book';
import { normalizeName } from './book';
import { orderShelfBooks, type DuplicateReason } from './library';

export type DuplicateGroup = {
  key: string;
  year: number;
  reasons: DuplicateReason[];
  books: Book[];
};

const reasonOrder: DuplicateReason[] = ['title_authors', 'isbn', 'edition'];

/** Read-only groups using the same signals as the save-time warning. */
export function duplicateGroups(books: readonly Book[], locale: string): DuplicateGroup[] {
  const signals = new Map<string, { reason: DuplicateReason; books: Book[] }>();
  function add(key: string, reason: DuplicateReason, book: Book) {
    const group = signals.get(key);
    if (group) group.books.push(book);
    else signals.set(key, { reason, books: [book] });
  }

  for (const book of books) {
    const authors = book.authors.map(normalizeName).sort();
    add(JSON.stringify(['title_authors', book.shelfYear, normalizeName(book.title), authors]), 'title_authors', book);
    if (book.isbn) add(JSON.stringify(['isbn', book.shelfYear, book.isbn]), 'isbn', book);
    if (book.source?.editionId) add(JSON.stringify(['edition', book.shelfYear, book.source.editionId]), 'edition', book);
  }

  const combined = new Map<string, DuplicateGroup>();
  for (const { reason, books: matches } of signals.values()) {
    if (matches.length < 2) continue;
    // IDs are unique in a valid library. Equal memberships share one visual group.
    const ids = matches.map(book => book.id.toLowerCase()).sort();
    const key = JSON.stringify([matches[0].shelfYear, ids]);
    const existing = combined.get(key);
    if (existing) { existing.reasons.push(reason); continue; }
    combined.set(key, {
      key, year: matches[0].shelfYear, reasons: [reason],
      books: orderShelfBooks(matches, 'recent', locale),
    });
  }
  const collator = new Intl.Collator(locale, { sensitivity: 'base', numeric: true });
  return [...combined.values()].map(group => ({ ...group,
    reasons: reasonOrder.filter(reason => group.reasons.includes(reason)),
  })).sort((left, right) => right.year - left.year ||
    collator.compare(left.books[0].title, right.books[0].title) ||
    left.key.localeCompare(right.key));
}
