import type { Locale } from '../i18n/locale';
import type { LibraryRepository } from '../ports/library-repository';
import { projectCatalog, serializeCatalogCsv, serializeCatalogMarkdown, type CatalogLabels } from '../catalog/serialize';

export type CatalogFormat = 'csv' | 'markdown';

export function createCatalogService(repository: LibraryRepository) {
  return {
    async exportCatalog(format: CatalogFormat, locale: Locale, labels: CatalogLabels, exportedAt: string) {
      const { books } = await repository.readAll();
      const entries = projectCatalog(books, locale);
      const text = format === 'csv' ? serializeCatalogCsv(entries, labels) : serializeCatalogMarkdown(entries, labels);
      const extension = format === 'csv' ? 'csv' : 'md';
      const type = format === 'csv' ? 'text/csv;charset=utf-8' : 'text/markdown;charset=utf-8';
      return { blob: new Blob([text], { type }), filename: `livro-a-livro-catalogo-${exportedAt.slice(0, 10)}.${extension}`,
        count: entries.length };
    },
  };
}

export type CatalogService = ReturnType<typeof createCatalogService>;
