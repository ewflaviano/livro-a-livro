import type { Book } from '../domain/book';
import { booksForYear, formatShelfYear } from '../domain/library';
import { statisticsForYear } from '../domain/statistics';
import { DEFAULT_LOCALE, formatNumber, pluralCategory, type Locale } from '../i18n/locale';
import { message } from '../i18n/messages';

/** Only this allowlist may cross into the image renderer. No Book spreads/references. */
export type YearShare = Readonly<{
  year: string;
  books: number;
  pages: number | null;
  authors: number | null;
  titles: readonly string[];
  remaining: number;
}>;

export function projectYearShare(books: readonly Book[], year: number, includeTitles: boolean): YearShare {
  const statistics = statisticsForYear(books, year);
  const titles = includeTitles ? booksForYear(books, year, 'read').slice(0, 6).map((book) => book.title) : [];
  return Object.freeze({ year: formatShelfYear(year), books: statistics.books, pages: statistics.pages,
    authors: statistics.authors, titles: Object.freeze(titles),
    remaining: includeTitles ? Math.max(0, statistics.books - titles.length) : 0 });
}

export function shareMetricLabels(share: YearShare, locale: Locale) {
  const books = formatNumber(locale, share.books);
  const pages = share.pages === null ? message(locale, 'sharePagesUnknown') : message(locale,
    pluralCategory(locale, share.pages) === 'one' ? 'sharePageOne' : 'sharePages', { count: formatNumber(locale, share.pages) });
  const authors = share.authors === null ? message(locale, 'shareAuthorsUnknown') : message(locale,
    pluralCategory(locale, share.authors) === 'one' ? 'shareAuthorOne' : 'shareAuthors', { count: formatNumber(locale, share.authors) });
  return {
    books: message(locale, pluralCategory(locale, share.books) === 'one' ? 'shareBookReadOne' : 'shareBooksRead', { count: books }),
    pages, authors,
  };
}

export function shareDescription(share: YearShare, locale: Locale = DEFAULT_LOCALE): string {
  const labels = shareMetricLabels(share, locale);
  const metrics = `${labels.books} · ${labels.pages} · ${labels.authors}`;
  return [`Livro a Livro — ${share.year}`, metrics,
    ...share.titles.map((title) => message(locale, 'shareTypographicCover', { title })),
    ...(share.remaining ? [message(locale, pluralCategory(locale, share.remaining) === 'one' ? 'shareMoreBookOne' : 'shareMoreBooks',
      { count: formatNumber(locale, share.remaining) })] : []),
    message(locale, 'shareTagline'), 'livroalivro.app.br'].join('\n');
}
