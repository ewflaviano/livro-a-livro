import { describe, expect, it, vi } from 'vitest';
import { createBook } from '../domain/book';
import { projectYearShare, shareDescription } from './projection';
import { pngFromCanvas, renderYearShare, SHARE_FORMATS, titleLines } from './render';

const books = Array.from({ length: 8 }, (_, index) => createBook({ title: `Título ${index}`, status: 'read',
  pageCount: 120, authors: ['Autora privada'], note: 'SEGREDO', rating: 4, isbn: '9780306406157',
  startedOn: '2026-01-01', finishedOn: '2026-02-01', cover: { provider: 'open_library', coverId: 321 } },
{ id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`, now: '2026-09-26T12:00:00.000Z', shelfYear: 2026 }));

describe('share allowlist', () => {
  it('copies only aggregate values and six allowed titles, never book objects or references', () => {
    const projection = projectYearShare([...books, { ...books[0], status: 'reading', title: 'Em andamento' },
      { ...books[0], shelfYear: 2025, title: 'Outro ano' }], 2026, true);
    expect(projection).toEqual({ year: '2026', books: 8, pages: 960, authors: 1,
      titles: books.slice(0, 6).map((book) => book.title), remaining: 2 });
    expect(Object.isFrozen(projection)).toBe(true);
    expect(Object.isFrozen(projection.titles)).toBe(true);
    const text = JSON.stringify(projection) + shareDescription(projection);
    for (const privateValue of ['SEGREDO', 'Autora privada', '9780306406157', '2026-01-01', '2026-02-01', '00000000-', 'open_library', 'Em andamento', 'Outro ano']) {
      expect(text).not.toContain(privateValue);
    }
    expect(Object.keys(projection)).toEqual(['year', 'books', 'pages', 'authors', 'titles', 'remaining']);
    expect(shareDescription(projection)).toContain('+ 2 livros');
  });

  it('can omit all titles and distinguishes unknown information from zero', () => {
    const projection = projectYearShare([{ ...books[0], authors: [], pageCount: null }], 2026, false);
    expect(projection).toEqual({ year: '2026', books: 1, pages: null, authors: null, titles: [], remaining: 0 });
    expect(shareDescription(projection)).toContain('páginas não informadas');
    expect(shareDescription(projection)).not.toContain('Título');
    expect(projectYearShare([], 1, true)).toEqual({ year: '0001', books: 0, pages: 0, authors: 0, titles: [], remaining: 0 });
  });
});

describe('local renderer', () => {
  const theme = { background: '#fff', ink: '#222', muted: '#555', accent: '#ddd', covers: ['#eee'] };
  function context() {
    return { fillStyle: '', font: '', textAlign: 'center' as CanvasTextAlign, textBaseline: 'middle' as CanvasTextBaseline,
      fillRect: vi.fn(), fillText: vi.fn(), measureText: vi.fn((text: string) => ({ width: Array.from(text).length * 12 }) as TextMetrics) };
  }
  it.each(['story', 'quadrado'] as const)('draws a deterministic %s image using only allowlisted text, within bounds', (format) => {
    const projection = projectYearShare(books, 2026, true);
    const first = context(); const second = context();
    renderYearShare(first, projection, format, theme); renderYearShare(second, projection, format, theme);
    expect(first.fillText.mock.calls).toEqual(second.fillText.mock.calls);
    const { width, height } = SHARE_FORMATS[format];
    expect(first.fillRect).toHaveBeenCalledWith(0, 0, width, height);
    for (const [, x, y] of first.fillText.mock.calls) {
      expect(x).toBeGreaterThanOrEqual(width * .08); expect(x).toBeLessThanOrEqual(width * .92);
      expect(y).toBeGreaterThanOrEqual(height * (format === 'story' ? .12 : .08));
      expect(y).toBeLessThanOrEqual(height * (format === 'story' ? .88 : .92));
    }
    expect(JSON.stringify(first.fillText.mock.calls)).not.toContain('SEGREDO');
    expect(first.fillText.mock.calls.some(([text]) => text === '+ 2 livros')).toBe(true);
  });
  it('limits a 500-character title without breaking Unicode or overflowing its cover', () => {
    const result = titleLines('🌿'.repeat(250), (text) => Array.from(text).length * 10, 100, 6);
    expect(result).toHaveLength(6);
    expect(result.at(-1)).toBe('🌿'.repeat(9) + '…');
    expect(result.every((line) => Array.from(line).length <= 10)).toBe(true);
    expect(titleLines('  Uma\n leitura  ', (text) => text.length * 10, 200, 6)).toEqual(['Uma leitura']);
  });
  it('rejects failed or unsafe canvas serialization without exposing original errors', async () => {
    await expect(pngFromCanvas({ toBlob: () => { throw new Error('private browser error'); } } as unknown as HTMLCanvasElement)).rejects.toThrow('ShareUnavailable');
    await expect(pngFromCanvas({ toBlob: (callback: BlobCallback) => callback(null) } as HTMLCanvasElement)).rejects.toThrow('ShareUnavailable');
    const blob = new Blob(['png'], { type: 'image/png' });
    await expect(pngFromCanvas({ toBlob: (callback: BlobCallback) => callback(blob) } as HTMLCanvasElement)).resolves.toBe(blob);
  });
});
