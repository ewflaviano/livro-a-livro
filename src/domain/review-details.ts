import type { Book } from './book';

export type MissingDetail = 'authors' | 'pages' | 'isbn';

/** A read-only view of optional book details across every shelf year. */
export function booksMissingDetail(books: readonly Book[], detail: MissingDetail, locale: string): Book[] {
  const collator = new Intl.Collator(locale, { sensitivity: 'base', numeric: true });
  return books.filter(book => detail === 'authors' ? book.authors.length === 0 :
    detail === 'pages' ? book.pageCount === null : book.isbn === null)
    .sort((left, right) => right.shelfYear - left.shelfYear ||
      collator.compare(left.title, right.title) || left.id.localeCompare(right.id));
}
