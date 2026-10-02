import { normalizeName, type Book } from './book';

export type AuthorGroup = { key: string; name: string; searchKey: string; books: Book[] };

/** A local view of saved author labels, not a registry of people. */
export function groupBooksByAuthor(books: readonly Book[], locale: string): AuthorGroup[] {
  const groups = new Map<string, AuthorGroup>();
  const collator = new Intl.Collator(locale, { sensitivity: 'base', numeric: true });
  for (const book of books) {
    const seen = new Set<string>();
    for (const name of book.authors) {
      const key = normalizeName(name);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const display = name.trim().replace(/\s+/gu, ' ');
      let group = groups.get(key);
      if (!group) {
        group = { key, name: display, searchKey: authorSearchText(key), books: [] };
        groups.set(key, group);
      } else if (collator.compare(display, group.name) < 0 ||
        (collator.compare(display, group.name) === 0 && display < group.name)) {
        group.name = display;
      }
      group.books.push(book);
    }
  }
  for (const group of groups.values()) {
    group.books.sort((a, b) => b.shelfYear - a.shelfYear ||
      collator.compare(a.title, b.title) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }
  return [...groups.values()].sort((a, b) => collator.compare(a.name, b.name) ||
    (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/** Searching is accent tolerant, while grouping keeps distinct stored names apart. */
export function authorSearchText(value: string): string {
  return normalizeName(value).normalize('NFD').replace(/\p{M}/gu, '');
}
