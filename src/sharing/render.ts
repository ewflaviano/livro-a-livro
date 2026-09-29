import type { YearShare } from './projection';
import { DEFAULT_LOCALE, formatNumber, pluralCategory, type Locale } from '../i18n/locale';
import { message } from '../i18n/messages';

export const SHARE_FORMATS = {
  story: { width: 1080, height: 1920 },
  quadrado: { width: 1080, height: 1080 },
} as const;
export type ShareFormat = keyof typeof SHARE_FORMATS;
export type ShareTheme = { background: string; ink: string; muted: string; accent: string; covers: string[] };
type Context = Pick<CanvasRenderingContext2D, 'fillStyle' | 'font' | 'textAlign' | 'textBaseline' | 'fillRect' | 'fillText' | 'measureText'>;

/** Bounded, code-point-safe wrapping, including titles without spaces. */
export function titleLines(title: string, measure: (text: string) => number, width: number, count: number): string[] {
  const characters = Array.from(title.replace(/\s+/gu, ' ').trim());
  const lines: string[] = [];
  let offset = 0;
  while (offset < characters.length && lines.length < count) {
    let line = '';
    while (offset < characters.length && measure(line + characters[offset]) <= width) line += characters[offset++];
    if (!line) { offset++; line = '…'; }
    if (lines.length === count - 1 && offset < characters.length) {
      while (line && measure(`${line}…`) > width) line = Array.from(line).slice(0, -1).join('');
      line += '…';
    }
    lines.push(line.trim());
  }
  return lines;
}

/** Draw only text and local geometry; no image/URL input can taint this canvas. */
export function renderYearShare(context: Context, share: YearShare, format: ShareFormat, theme: ShareTheme,
  locale: Locale = DEFAULT_LOCALE): void {
  const { width, height } = SHARE_FORMATS[format];
  const story = format === 'story';
  const text = (value: string, x: number, y: number, size: number, color = theme.ink, editorial = false, maxWidth = 880) => {
    context.fillStyle = color;
    context.font = `${size}px ${editorial ? 'Georgia, serif' : 'system-ui, sans-serif'}`;
    context.fillText(value, x, y, maxWidth);
  };
  context.fillStyle = theme.background;
  context.fillRect(0, 0, width, height);
  context.textAlign = 'center'; context.textBaseline = 'middle';
  const top = story ? 250 : 110;
  text('Livro a Livro', 540, top, 42, theme.ink, true);
  context.fillStyle = theme.accent; context.fillRect(510, top + 46, 60, 8);
  text(share.year, 540, top + 120, 88, theme.ink, true);
  const metricsY = top + 225;
  const values = [formatNumber(locale, share.books), share.pages === null ? '—' : formatNumber(locale, share.pages),
    share.authors === null ? '—' : formatNumber(locale, share.authors)];
  const labels = [
    message(locale, pluralCategory(locale, share.books) === 'one' ? 'shareBookLabelOne' : 'shareBooksLabel'),
    message(locale, share.pages !== null && pluralCategory(locale, share.pages) === 'one' ? 'sharePageLabelOne' : 'sharePagesLabel'),
    message(locale, share.authors !== null && pluralCategory(locale, share.authors) === 'one' ? 'shareAuthorLabelOne' : 'shareAuthorsLabel'),
  ];
  values.forEach((value, index) => {
    text(value, 240 + index * 300, metricsY, 46, theme.ink, false, 260);
    text(labels[index], 240 + index * 300, metricsY + 45, 23, theme.muted, false, 260);
  });
  const coverWidth = story ? 240 : 144;
  const coverHeight = coverWidth * 1.5;
  const gap = story ? 36 : 40;
  const startX = (1080 - (coverWidth * 3 + gap * 2)) / 2;
  const startY = story ? 670 : 440;
  share.titles.slice(0, 6).forEach((title, index) => {
    const x = startX + (index % 3) * (coverWidth + gap);
    const y = startY + Math.floor(index / 3) * (coverHeight + 24);
    context.fillStyle = theme.covers[index % theme.covers.length];
    context.fillRect(x, y, coverWidth, coverHeight);
    context.fillStyle = theme.accent; context.fillRect(x + 15, y + 20, 25, 5);
    context.font = `${story ? 29 : 19}px Georgia, serif`;
    const lines = titleLines(title, (value) => context.measureText(value).width, coverWidth - 36, 6);
    const leading = story ? 37 : 25;
    lines.forEach((line, row) => text(line, x + coverWidth / 2,
      y + coverHeight / 2 + (row - (lines.length - 1) / 2) * leading, story ? 29 : 19, theme.ink, true, coverWidth - 36));
  });
  if (share.remaining) text(message(locale, pluralCategory(locale, share.remaining) === 'one' ? 'shareMoreBookOne' : 'shareMoreBooks',
    { count: formatNumber(locale, share.remaining) }), 540, story ? 1485 : 916, 25, theme.muted);
  text(message(locale, 'shareTagline'), 540, story ? 1610 : 948, 29, theme.ink, true);
  text('livroalivro.app.br', 540, story ? 1660 : 980, 23, theme.muted);
}

export function pngFromCanvas(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    try { canvas.toBlob((blob) => blob?.type === 'image/png' ? resolve(blob) : reject(new Error('ShareUnavailable')), 'image/png'); }
    catch { reject(new Error('ShareUnavailable')); }
  });
}

export function downloadShare(blob: Blob, year: string, format: ShareFormat): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = `livro-a-livro-${year}-${format}.png`;
  try { document.body.append(link); link.click(); }
  finally { link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000); }
}
