import type { Book } from '../domain/book';
import { booksForYear, formatShelfYear } from '../domain/library';
import { statisticsForYear } from '../domain/statistics';

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

const number = new Intl.NumberFormat('pt-BR');
export function shareDescription(share: YearShare): string {
  const metrics = `${number.format(share.books)} livros lidos · ${share.pages === null ? 'páginas não informadas' : `${number.format(share.pages)} páginas informadas`} · ${share.authors === null ? 'autoria não informada' : `${number.format(share.authors)} autores distintos`}`;
  return [`Livro a Livro — ${share.year}`, metrics,
    ...share.titles.map((title) => `Capa tipográfica: ${title}`),
    ...(share.remaining ? [`+ ${number.format(share.remaining)} livros`] : []),
    'Minha história em livros', 'livroalivro.app.br'].join('\n');
}
