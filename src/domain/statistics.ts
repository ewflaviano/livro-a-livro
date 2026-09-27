import type { Book } from './book';
import { normalizeName, shelfYearSchema } from './book';
import { parseDomain } from './errors';

export type YearStatistics = {
  books: number;
  pages: number | null;
  authors: number | null;
  booksWithPages: number;
  booksWithAuthors: number;
};

// Pass the full library/year before applying any visual status filter.
export function statisticsForYear(books: readonly Book[], year: number): YearStatistics {
  parseDomain(shelfYearSchema, year);
  const read = books.filter((book) => book.status === 'read' && book.shelfYear === year);
  const withPages = read.filter((book) => book.pageCount !== null);
  const withAuthors = read.filter((book) => book.authors.length > 0);
  return {
    books: read.length,
    pages: read.length > 0 && withPages.length === 0 ? null :
      withPages.reduce((sum, book) => sum + book.pageCount!, 0),
    authors: read.length > 0 && withAuthors.length === 0 ? null :
      new Set(withAuthors.flatMap((book) => book.authors.map(normalizeName))).size,
    booksWithPages: withPages.length,
    booksWithAuthors: withAuthors.length,
  };
}
