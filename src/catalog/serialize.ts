import type { Book, ReadingStatus } from '../domain/book';
import type { Locale } from '../i18n/locale';

export type CatalogLabels = {
  heading: string;
  empty: string;
  title: string;
  authors: string;
  shelfYear: string;
  status: string;
  pages: string;
  isbn: string;
  unknownAuthor: string;
  statuses: Record<ReadingStatus, string>;
};

export type CatalogEntry = Pick<Book, 'id' | 'title' | 'authors' | 'shelfYear' | 'status' | 'pageCount' | 'isbn'>;

/** Only fields deliberately approved for the two catalogue formats leave this projection. */
export function projectCatalog(books: readonly Book[], locale: Locale): CatalogEntry[] {
  const collator = new Intl.Collator(locale, { sensitivity: 'base', numeric: true });
  return books.map(({ id, title, authors, shelfYear, status, pageCount, isbn }) =>
    ({ id, title, authors, shelfYear, status, pageCount, isbn }))
    .sort((a, b) => b.shelfYear - a.shelfYear || collator.compare(a.title, b.title) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

function csvCell(value: string): string {
  // Quoting every cell prevents delimiters and line breaks from creating new cells.
  // Spreadsheet software may still execute a formula after leading whitespace or a line break.
  const unsafe = /(?:^|[\r\n])[\s\u0000-\u001f]*[=+\-@]/u.test(value) || /^[\t\r\n]/u.test(value);
  const text = unsafe ? `'${value}` : value;
  return `"${text.replace(/"/gu, '""')}"`;
}

export function serializeCatalogCsv(entries: readonly CatalogEntry[], labels: CatalogLabels): string {
  const header = [labels.title, labels.authors, labels.shelfYear, labels.status, labels.pages, labels.isbn];
  const rows = entries.map(book => [book.title, book.authors.join('; '), String(book.shelfYear),
    labels.statuses[book.status], book.pageCount === null ? '' : String(book.pageCount), book.isbn ?? '']);
  return '\uFEFF' + [header, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

function markdownText(value: string): string {
  // Each field stays on one literal text line: no headings, links, HTML or list items from book data.
  return value.replace(/[\u0000-\u001f\u007f]/gu, ' ').replace(/\s+/gu, ' ').trim()
    .replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;')
    .replace(/([\\`*_{}\[\]()#+.!|~\-])/gu, '\\$1');
}

export function serializeCatalogMarkdown(entries: readonly CatalogEntry[], labels: CatalogLabels): string {
  const sections: string[] = [`# ${labels.heading}`, ''];
  for (const status of ['read', 'reading', 'want-to-read'] as const) {
    sections.push(`## ${labels.statuses[status]}`, '');
    const books = entries.filter(book => book.status === status);
    if (!books.length) sections.push(labels.empty);
    else for (const book of books) {
      const authors = book.authors.length ? book.authors.map(markdownText).join('; ') : markdownText(labels.unknownAuthor);
      sections.push(`- ${markdownText(book.title)} — ${authors} (${labels.shelfYear}: ${book.shelfYear})`);
    }
    sections.push('');
  }
  return sections.join('\n');
}
