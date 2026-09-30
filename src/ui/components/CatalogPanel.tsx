import { useEffect, useRef, useState } from 'react';
import { useLibrary } from '../../app/LibraryProvider';
import type { CatalogLabels } from '../../catalog/serialize';
import type { CatalogFormat } from '../../services/catalog-service';
import { blockPwaUpdate } from '../../pwa/register';
import { useLocale } from '../../i18n/context';
import type { MessageKey } from '../../i18n/messages';

function startDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement('a');
    link.href = url; link.download = filename;
    document.body.append(link);
    try { link.click(); } finally { link.remove(); }
  } finally { setTimeout(() => URL.revokeObjectURL(url), 10_000); }
}

export function CatalogPanel() {
  const { catalog, state, retry } = useLibrary();
  const { locale, t } = useLocale();
  const [busy, setBusy] = useState<CatalogFormat | null>(null);
  const [status, setStatus] = useState<MessageKey | null>(null);
  const [error, setError] = useState<MessageKey | null>(null);
  const inFlight = useRef(false);
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  useEffect(() => { if (busy) return blockPwaUpdate(); }, [busy]);
  const unavailable = !catalog || state.status !== 'ready';

  async function download(format: CatalogFormat) {
    if (unavailable || inFlight.current) return;
    inFlight.current = true; setBusy(format); setStatus(null); setError(null);
    const labels: CatalogLabels = {
      heading: t('catalogHeading'), empty: t('catalogEmptyGroup'), title: t('catalogColumnTitle'),
      authors: t('catalogColumnAuthors'), shelfYear: t('shelfYear'), status: t('catalogColumnStatus'),
      pages: t('pages'), isbn: 'ISBN', unknownAuthor: t('authorUnknown'),
      statuses: { read: t('readPlural'), reading: t('reading'), 'want-to-read': t('wantToRead') },
    };
    let file: Awaited<ReturnType<NonNullable<typeof catalog>['exportCatalog']>>;
    try { file = await catalog!.exportCatalog(format, locale, labels, new Date().toISOString()); }
    catch { if (active.current) setError('catalogReadFailed'); inFlight.current = false; if (active.current) setBusy(null); return; }
    try {
      if (!active.current) return;
      startDownload(file.blob, file.filename);
      setStatus(file.count ? 'catalogDownloadStarted' : 'catalogEmptyDownloadStarted');
    } catch { if (active.current) setError('catalogDownloadFailed'); }
    finally { inFlight.current = false; if (active.current) setBusy(null); }
  }

  return <section className="catalog-panel" aria-labelledby="catalog-export-title" aria-busy={Boolean(busy)}>
    <h2 id="catalog-export-title">{t('catalogExport')}</h2>
    <p>{t('catalogExplanation')}</p>
    <p className="catalog-field-list">{t('catalogCsvFields')}<br />{t('catalogMarkdownFields')}</p>
    <p>{t('catalogPrivacy')}</p>
    <div className="form-actions">
      <button type="button" className="button button-secondary" disabled={unavailable || Boolean(busy)} onClick={() => void download('csv')}>
        {busy === 'csv' ? t('catalogPreparing') : t('catalogDownloadCsv')}</button>
      <button type="button" className="button button-secondary" disabled={unavailable || Boolean(busy)} onClick={() => void download('markdown')}>
        {busy === 'markdown' ? t('catalogPreparing') : t('catalogDownloadMarkdown')}</button>
    </div>
    <p className="field-help">{t('catalogNotBackup')}</p>
    {state.status === 'error' && <button className="button button-secondary" type="button" onClick={retry}>{t('retryOpenLibrary')}</button>}
    {status && <p role="status" className="local-note">{t(status)}</p>}
    {error && <p role="alert" className="form-error">{t(error)}</p>}
  </section>;
}
