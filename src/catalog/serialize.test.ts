import { describe, expect, it } from 'vitest';
import { createBook } from '../domain/book';
import { projectCatalog, serializeCatalogCsv, serializeCatalogMarkdown, type CatalogLabels } from './serialize';

const labels: CatalogLabels = {
  heading: 'Minha biblioteca', empty: 'Nenhum livro neste grupo.', title: 'Título', authors: 'Autoria',
  shelfYear: 'Ano da estante', status: 'Estado', pages: 'Páginas', isbn: 'ISBN', unknownAuthor: 'Autoria não informada',
  statuses: { read: 'Lidos', reading: 'Lendo', 'want-to-read': 'Quero ler' },
};
const now = '2026-09-30T12:00:00.000Z';
function book(id: string, title: string, year: number, status: 'read' | 'reading' | 'want-to-read' = 'read') {
  return createBook({ title, authors: ['Autora, Exemplo'], shelfYear: year, status, note: 'SEGREDO SINTÉTICO', rating: 5,
    pageCount: 240, isbn: null }, { id, now, shelfYear: year });
}

describe('catalogue serializers', () => {
  it('projects only approved fields and orders two years without mutating books', () => {
    const older = book('00000000-0000-4000-8000-000000000001', 'B Livro', 2024);
    const newer = book('00000000-0000-4000-8000-000000000002', 'A Livro', 2026, 'reading');
    const input = [older, newer];
    const entries = projectCatalog(input, 'pt-BR');
    expect(entries.map(item => item.title)).toEqual(['A Livro', 'B Livro']);
    expect(input.map(item => item.title)).toEqual(['B Livro', 'A Livro']);
    expect(entries[0]).not.toHaveProperty('note');
    expect(entries[0]).not.toHaveProperty('rating');
    expect(entries[0]).not.toHaveProperty('cover');
    const csv = serializeCatalogCsv(entries, labels);
    const markdown = serializeCatalogMarkdown(entries, labels);
    for (const text of [csv, markdown]) expect(text).not.toContain('SEGREDO SINTÉTICO');
    expect(csv).toContain('"A Livro","Autora, Exemplo","2026","Lendo","240",""');
    expect(markdown).toContain('## Lendo\n\n- A Livro — Autora, Exemplo (Ano da estante: 2026)');
  });

  it('quotes CSV and neutralizes formula prefixes after whitespace and line breaks', () => {
    const entries = projectCatalog([
      book('00000000-0000-4000-8000-000000000001', '  =HYPERLINK("x","y")\n+SUM(1,1)', 2026),
      book('00000000-0000-4000-8000-000000000002', 'Texto\n@malicioso', 2026),
      book('00000000-0000-4000-8000-000000000003', 'Vírgula, "aspas"', 2026),
    ], 'pt-BR');
    const csv = serializeCatalogCsv(entries, labels);
    expect(csv.startsWith('\uFEFF"Título","Autoria"')).toBe(true);
    expect(csv).toContain('"\'=HYPERLINK(""x"",""y"")\n+SUM(1,1)"');
    expect(csv).toContain('"\'Texto\n@malicioso"');
    expect(csv).toContain('"Vírgula, ""aspas"""');
  });

  it('keeps Markdown book fields as literal text on one line', () => {
    const source = book('00000000-0000-4000-8000-000000000004', '# [Clique](https://exemplo.invalid)\n- outra linha <b>', 2026);
    const entries = projectCatalog([{ ...source, authors: ['*Autora*'] }], 'pt-BR');
    const markdown = serializeCatalogMarkdown(entries, labels);
    expect(markdown).toContain('\\# \\[Clique\\]\\(https://exemplo\\.invalid\\) \\- outra linha &lt;b&gt; — \\*Autora\\*');
    expect(markdown).not.toContain('\n- outra linha');
    expect(markdown).not.toContain('<b>');
    expect(markdown).toContain('## Lidos\n\n');
    expect(markdown).toContain('## Lendo\n\nNenhum livro neste grupo.');
    expect(markdown).toContain('## Quero ler\n\nNenhum livro neste grupo.');
  });

  it('creates clear empty files without private fields', () => {
    expect(serializeCatalogCsv([], labels)).toBe('\uFEFF"Título","Autoria","Ano da estante","Estado","Páginas","ISBN"\r\n');
    expect(serializeCatalogMarkdown([], labels)).toContain('## Lidos\n\nNenhum livro neste grupo.');
  });
});
