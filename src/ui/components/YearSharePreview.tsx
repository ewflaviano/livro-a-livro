import { useEffect, useRef, useState } from 'react';
import type { YearShare } from '../../sharing/projection';
import { shareDescription } from '../../sharing/projection';
import { downloadShare, pngFromCanvas, renderYearShare, SHARE_FORMATS, type ShareFormat } from '../../sharing/render';
import { useLocale } from '../../i18n/context';
import type { MessageKey } from '../../i18n/messages';

export default function YearSharePreview({ projection, onClose }: { projection: YearShare; onClose: () => void }) {
  const { locale, t } = useLocale();
  const [format, setFormat] = useState<ShareFormat>('story');
  const [includeTitles, setIncludeTitles] = useState(true);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<MessageKey | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const alive = useRef(true);
  const share = includeTitles ? projection : { ...projection, titles: [], remaining: 0 };
  const description = shareDescription(share, locale);
  useEffect(() => { heading.current?.focus(); alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    setReady(false); setStatus(null);
    try {
      const context = canvas.current?.getContext('2d');
      if (!context) throw new Error('ShareUnavailable');
      const styles = getComputedStyle(document.documentElement);
      const token = (name: string) => styles.getPropertyValue(name).trim();
      renderYearShare(context, includeTitles ? projection : { ...projection, titles: [], remaining: 0 }, format, {
        background: token('--color-canvas'), ink: token('--color-text'), muted: token('--color-text-secondary'),
        accent: token('--color-accent'), covers: ['plum', 'clay', 'blue', 'sage', 'citron', 'plum'].map((color) => token(`--color-cover-${color}`)),
      }, locale);
      setReady(true);
    } catch { setStatus('sharePrepareFailed'); }
  }, [projection, format, includeTitles, locale]);

  async function download() {
    if (!canvas.current || !ready || busy) return;
    setBusy(true); setStatus(null);
    try {
      const blob = await pngFromCanvas(canvas.current);
      if (!alive.current) return;
      downloadShare(blob, projection.year, format);
      setStatus('shareDownloadStarted');
    } catch { if (alive.current) setStatus('shareDownloadFailed'); }
    finally { if (alive.current) setBusy(false); }
  }

  return <section className="share-preview notice-panel" aria-labelledby="share-title">
    <h2 id="share-title" tabIndex={-1} ref={heading}>{t('shareTitle', { year: projection.year })}</h2>
    <p>{t('shareDisclosure')}</p>
    <p>{t('shareLocal')}</p>
    <label className="share-consent"><input type="checkbox" checked={includeTitles} disabled={busy}
      onChange={(event) => setIncludeTitles(event.target.checked)} />{t('shareIncludeTitles')}</label>
    <div className="segmented-control" role="group" aria-label={t('shareFormat')}>
      <button disabled={busy} aria-pressed={format === 'story'} onClick={() => setFormat('story')}>Story · 9:16</button>
      <button disabled={busy} aria-pressed={format === 'quadrado'} onClick={() => setFormat('quadrado')}>{t('shareSquare')}</button>
    </div>
    <p className="field-help">{t('sharePixels', SHARE_FORMATS[format])}</p>
    <canvas ref={canvas} {...SHARE_FORMATS[format]} className={`share-canvas share-canvas--${format}`}
      role="img" aria-label={t('sharePreview', { year: projection.year })} aria-describedby="share-description">{description}</canvas>
    <label className="form-field">{t('shareDescriptionLabel')}
      <textarea id="share-description" readOnly value={description} rows={5} onFocus={(event) => event.target.select()} />
    </label>
    <div className="form-actions">
      <button className="button button-secondary" onClick={onClose}>{t('shareClose')}</button>
      <button className="button button-primary" disabled={!ready || busy} onClick={() => { void download(); }}>{t(busy ? 'sharePreparing' : 'shareDownload')}</button>
    </div>
    {status && <p role="status">{t(status)}</p>}
  </section>;
}
