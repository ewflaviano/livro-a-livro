import { useEffect, useRef, useState } from 'react';
import { useLibrary } from '../../app/LibraryProvider';
import { DomainError } from '../../domain/errors';
import { recordDiagnostic } from '../../diagnostics/client';
import type { BackupFile, ImportPreview } from '../../services/backup-service';
import { blockPwaUpdate } from '../../pwa/register';
import { ConfirmDialog } from './ConfirmDialog';
import { useLocale } from '../../i18n/context';
import { formatNumber, pluralCategory } from '../../i18n/locale';
import type { MessageKey } from '../../i18n/messages';

function importErrorKey(error: unknown): MessageKey {
  const code = error instanceof DomainError ? error.code : '';
  if (code === 'StaleRevision') return 'backupStale';
  if (code === 'QuotaExceeded') return 'backupQuota';
  if (code === 'UnsupportedVersion') return 'backupVersion';
  if (code === 'ImportTooLarge') return 'backupTooLarge';
  if (code === 'InvalidBackup') return 'backupInvalid';
  return 'backupRestoreFailed';
}
function reportBackupFailure(error: unknown) {
  if (!(error instanceof DomainError) || error.code === 'StorageUnavailable' || error.code === 'QuotaExceeded') {
    recordDiagnostic({ area: 'backup', code: 'backup_failed' });
  }
}
/** Starts a browser download; it cannot observe whether the user saves the file. */
function startDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const revoke = URL.revokeObjectURL.bind(URL);
  try {
    const link = document.createElement('a'); link.href = url; link.download = filename;
    document.body.append(link);
    try { link.click(); } finally { link.remove(); }
  } finally { setTimeout(() => revoke(url), 10_000); }
}

export function BackupPanel() {
  const { t, locale } = useLocale();
  const bookCount = (count: number) => t(pluralCategory(locale, count) === 'one' ? 'backupBookOne' : 'backupBooks', { count: formatNumber(locale, count) });
  const years = (values: readonly number[]) => values.length ? values.join(', ') : t('noYears');
  const { backup, state, retry } = useLibrary();
  const [busy, setBusy] = useState<'prepare' | 'export' | 'restore' | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<MessageKey | null>(null);
  const [status, setStatus] = useState<{ key: MessageKey; count?: number } | null>(null);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const operation = useRef(0);
  const active = useRef(true);
  const returnFocus = useRef(false);
  const inFlight = useRef<'prepare' | 'export' | 'restore' | null>(null);
  const protectedOperation = Boolean(busy || preview);
  useEffect(() => { if (restoreOpen && !preview) input.current?.focus(); }, [restoreOpen, preview]);
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; ++operation.current; backup?.cancelImport(); };
  }, [backup]);
  useEffect(() => {
    if (returnFocus.current && !confirm && !preview) { returnFocus.current = false; input.current?.focus(); }
  }, [confirm, preview]);
  useEffect(() => { if (protectedOperation) return blockPwaUpdate(); }, [protectedOperation]);
  useEffect(() => {
    if (!protectedOperation) return;
    const unload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    const navigation = (event: MouseEvent) => {
      const link = (event.target as Element).closest('a');
      if (!link || link.classList.contains('skip-link') || link.hasAttribute('download') || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      if (inFlight.current === 'restore' || !window.confirm(t('discardBackupLeave'))) {
        event.preventDefault(); event.stopPropagation();
      }
    };
    window.addEventListener('beforeunload', unload); document.addEventListener('click', navigation, true);
    return () => { window.removeEventListener('beforeunload', unload); document.removeEventListener('click', navigation, true); };
  }, [protectedOperation, t]);
  function clearSelection() {
    backup?.cancelImport(); setPreview(null); setConfirm(false);
    if (input.current) input.current.value = '';
  }
  function cancel() {
    ++operation.current; inFlight.current = null; setBusy(null); clearSelection(); setError(null); setStatus({ key: 'importCancelled' });
    input.current?.focus();
  }
  async function select(file: BackupFile) {
    if (!backup || inFlight.current === 'restore' || inFlight.current === 'export') return;
    const selected = ++operation.current;
    clearSelection(); inFlight.current = 'prepare'; setBusy('prepare'); setError(null); setStatus(null);
    try {
      const next = await backup.prepareImport(file);
      if (active.current && selected === operation.current) setPreview(next);
    } catch (failure) {
      reportBackupFailure(failure);
      if (active.current && selected === operation.current) { setError(importErrorKey(failure)); if (input.current) input.current.value = ''; }
    } finally {
      if (active.current && selected === operation.current) { inFlight.current = null; setBusy(null); }
    }
  }
  async function exportCurrent() {
    if (!backup || inFlight.current) return;
    const selected = ++operation.current;
    inFlight.current = 'export'; setBusy('export'); setError(null); setStatus(null);
    try {
      const exported = await backup.exportBackup(new Date().toISOString());
      if (!active.current || selected !== operation.current) return;
      startDownload(exported.blob, exported.filename);
      try {
        await backup.recordDownloadStarted(new Date().toISOString(), exported.version);
        if (active.current && selected === operation.current) setStatus({ key: 'downloadStarted' });
      } catch {
        if (active.current && selected === operation.current) setStatus({ key: 'downloadDateFailed' });
      }
    } catch (failure) {
      reportBackupFailure(failure);
      if (active.current && selected === operation.current) setError('exportFailed');
    } finally {
      if (active.current && selected === operation.current) { inFlight.current = null; setBusy(null); }
    }
  }
  async function restore() {
    if (!backup || !preview || inFlight.current) return;
    const selected = ++operation.current; const count = preview.incoming.count;
    inFlight.current = 'restore'; setBusy('restore'); setError(null); setStatus(null);
    try {
      await backup.confirmImport(preview);
      if (active.current && selected === operation.current) setStatus({ key: count === 1 ? 'importedOne' : 'importedMany', count });
    } catch (failure) {
      reportBackupFailure(failure);
      if (active.current && selected === operation.current) setError(importErrorKey(failure));
    } finally {
      if (active.current && selected === operation.current) { returnFocus.current = true; clearSelection(); inFlight.current = null; setBusy(null); }
    }
  }
  const unavailable = !backup || state.status !== 'ready';
  return <section aria-labelledby="local-backup-title" aria-busy={Boolean(busy)}>
    <h2 id="local-backup-title">{t('localBackup')}</h2>
    <p>{t('backupExplanation')}</p>
    {unavailable && <p role="status">{state.status === 'error' ? t('backupLibraryUnavailable') : t('openingLibraryBackup')}</p>}
    {state.status === 'error' && <button className="button button-secondary" onClick={retry}>{t('retryOpenLibrary')}</button>}
    <div className="form-actions"><button className="button button-primary" disabled={unavailable || Boolean(busy)} onClick={() => void exportCurrent()}>
      {busy === 'export' ? t('preparingFile') : t('makeBackup')}</button>
      <button className="button button-secondary" disabled={unavailable || busy === 'restore' || busy === 'export'} onClick={() => { setRestoreOpen(true); if (restoreOpen) input.current?.focus(); }}>{t('restoreBackup')}</button></div>
    <p className="field-help">{t('backupPrivacy')}</p>
    {restoreOpen && <><label className="form-field">{t('importJson')}<input ref={input} type="file" accept=".json,application/json" disabled={unavailable || busy === 'restore' || busy === 'export'}
      onChange={event => { const file = event.currentTarget.files?.[0]; if (file) void select(file); }} /></label>
    <p className="field-help">{t('backupLimit')}</p></>}
    {busy === 'prepare' && <p role="status">{t('validatingBackup')}</p>}
    {(preview || busy === 'prepare') && <div className="notice-panel">
      {preview && <>
        <h3>{t('reviewRestore')}</h3>
        <p>{t('inFile', { books: bookCount(preview.incoming.count), years: years(preview.incoming.years) })}</p>
        <p>{t('onDevice', { books: bookCount(preview.current.count), years: years(preview.current.years) })}</p>
        <p>{t('restoreImpact')}</p>
        <div className="form-actions"><button className="button button-secondary" disabled={Boolean(busy)} onClick={() => void exportCurrent()}>{t('exportCurrentLibrary')}</button>
          <button className="button button-danger" disabled={Boolean(busy)} onClick={() => setConfirm(true)}>{t('replaceWith', { books: bookCount(preview.incoming.count) })}</button></div>
      </>}
      <button className="button button-secondary" disabled={busy === 'restore' || busy === 'export'} onClick={cancel}>{t('cancelImport')}</button>
    </div>}
    {status && <p role="status" className="local-note">{t(status.key, status.count === undefined ? undefined : { count: formatNumber(locale, status.count) })}</p>}
    {error && <p role="alert" className="form-error">{t(error)}</p>}
    {confirm && preview && <ConfirmDialog title={t('replaceEntireLibrary')} confirmLabel={t('replaceWith', { books: bookCount(preview.incoming.count) })}
      busy={busy === 'restore'} onCancel={() => setConfirm(false)} onConfirm={() => void restore()}>
      <p>{t('restoreConfirmation', { current: bookCount(preview.current.count), incoming: bookCount(preview.incoming.count) })}</p>
      <p>{t('exportBeforeRestore')}</p>
    </ConfirmDialog>}
  </section>;
}
