import { MergePreview } from '../components/MergePreview';
import type { ResolutionPreview } from '../../sync/merge';
import { BackupPanel } from '../components/BackupPanel';
import { CatalogPanel } from '../components/CatalogPanel';
import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useSync } from '../../app/SyncProvider';
import { serializeBackup } from '../../backup/serialize';
import { referencedExport } from '../../sync/snapshot';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useGlobalSyncControls } from '../components/GlobalSyncControls';
import { authorizationStates, syncLabelKeys } from '../components/sync-presentation';
import type { LibraryExport } from '../../backup/schema';
import { useLocale } from '../../i18n/context';
import { formatDate, formatNumber, pluralCategory } from '../../i18n/locale';
import type { MessageKey } from '../../i18n/messages';
import { useAnalytics } from '../../analytics/AnalyticsProvider';

export function downloadLibrary(data: LibraryExport, suffix: string) {
  const url = URL.createObjectURL(new Blob([serializeBackup(referencedExport(data))], { type: 'application/json;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = `livro-a-livro-${suffix}.json`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
export function DataPage() {
  const { t, locale } = useLocale();
  const analytics = useAnalytics();
  const countBooks = (count: number) => t(pluralCategory(locale, count) === 'one' ? 'backupBookOne' : 'backupBooks', { count: formatNumber(locale, count) });
  const dateTime = (value: string) => formatDate(locale, new Date(value), { dateStyle: 'short', timeStyle: 'short' });
  const location = useLocation();
  const { coordinator, state, available, local, initializing } = useSync();
  const controls = useGlobalSyncControls();
  const [confirm, setConfirm] = useState<string | null>(null); const [busy, setBusy] = useState(false); const [error, setError] = useState<MessageKey | null>(null);
  const [merge, setMerge] = useState<ResolutionPreview | null>(null);
  const [preparingMerge, setPreparingMerge] = useState(false);
  const [mergeError, setMergeError] = useState<MessageKey | null>(null); const [mergeNotice, setMergeNotice] = useState<MessageKey | null>(null);
  const mergeRef = useRef<ResolutionPreview | null>(null); const mergeEpoch = useRef(0); const mergeButton = useRef<HTMLButtonElement>(null); const pageHeading = useRef<HTMLHeadingElement>(null);
  const content = useRef<HTMLElement>(null); const conflictHeading = useRef<HTMLHeadingElement>(null); const driveHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (location.state?.focus !== 'sync-conflict') return;
    let active = true;
    // Run after the shell's route focus, including repeated clicks on this route.
    queueMicrotask(() => {
      if (!active || document.querySelector('[aria-modal="true"]')) return;
      const target = content.current?.querySelector<HTMLElement>('#merge-title') ?? conflictHeading.current ?? driveHeading.current;
      target?.focus({ preventScroll: true });
      target?.scrollIntoView({ block: 'start', behavior: 'instant' });
    });
    return () => { active = false; };
  }, [location.key, location.state?.focus]);
  useEffect(() => () => { mergeEpoch.current++; if (mergeRef.current) coordinator?.cancelResolution(mergeRef.current.id); }, [coordinator]);
  useEffect(() => { document.title = `${t('yourData')} · ${t('appName')}`; }, [t]);
  async function act(action: () => Promise<unknown>) {
    setBusy(true); setError(null);
    try { await action(); } catch { setError('dataActionFailed'); }
    finally { setBusy(false); setConfirm(null); }
  }
  function closeMerge() {
    mergeEpoch.current++;
    if (mergeRef.current) coordinator?.cancelResolution(mergeRef.current.id);
    mergeRef.current = null; setMerge(null); setMergeError(null); setPreparingMerge(false); setBusy(false);
    queueMicrotask(() => (mergeButton.current ?? pageHeading.current)?.focus());
  }
  async function prepareMergePreview() {
    const epoch = ++mergeEpoch.current; setBusy(true); setPreparingMerge(true); setError(null); setMergeError(null); setMergeNotice(null);
    try {
      const preview = await coordinator!.prepareResolution();
      if (epoch !== mergeEpoch.current) { coordinator?.cancelResolution(preview.id); return; }
      mergeRef.current = preview; setMerge(preview);
    } catch { if (epoch === mergeEpoch.current) setError('mergePrepareFailed'); }
    finally { if (epoch === mergeEpoch.current) { setBusy(false); setPreparingMerge(false); } }
  }
  async function confirmMerge() {
    if (!merge) return;
    const epoch = mergeEpoch.current; setBusy(true); setMergeError(null);
    try {
      const result = await coordinator!.confirmResolution(merge.id);
      if (epoch !== mergeEpoch.current) return;
      mergeRef.current = null; setMerge(null);
      setMergeNotice(result === 'synchronized' ? 'mergeSynced' : 'mergePending');
      queueMicrotask(() => (mergeButton.current ?? pageHeading.current)?.focus());
    } catch { if (epoch === mergeEpoch.current) setMergeError('mergeConfirmFailed'); }
    finally { if (epoch === mergeEpoch.current) setBusy(false); }
  }
  return <section ref={content} className="page-content"><h1 ref={pageHeading} tabIndex={-1}>{t('yourData')}</h1>
    {local && <p className="notice-panel" role="status">{t('localTestData')}</p>}
    <BackupPanel />
    <CatalogPanel />
    <section className="duplicates-entry" aria-labelledby="duplicates-entry-title">
      <h2 id="duplicates-entry-title">{t('duplicatesTitle')}</h2>
      <p>{t('duplicatesIntro')}</p>
      <Link className="button button-secondary" to="/duplicatas">{t('duplicatesEntry')}</Link>
    </section>
    <section aria-labelledby="experiment-data-title">
      <h2 id="experiment-data-title">{t('experimentDataTitle')}</h2>
      <p>{t('experimentDataExplanation')}</p>
      <p>{t('experimentDataStatus', { choice: analytics.loading ? t('checking') : analytics.error ? t('checkFailed') : analytics.choice === 'accepted' ? t('accepted') : analytics.choice === 'rejected' ? t('rejected') : t('undecided') })}</p>
      <button className="button button-secondary" onClick={analytics.review}>{t('reviewChoice')}</button>
    </section>
    <h2 ref={driveHeading} className="sync-resolution-heading" tabIndex={-1}>{t('optionalGoogleDrive')}</h2>
    {state.login?.status === 'unavailable' && <p>{t('loginCheckFailed')} <button className="button button-secondary" onClick={() => void act(() => coordinator!.refreshLogin())}>{t('verifyConnection')}</button></p>}
    {state.logoutUnconfirmed && <p role="alert">{t('logoutUnconfirmed')}</p>}
    {state.localEraseFailed && <p role="alert">{t('localEraseFailed')}</p>}
    {state.status === 'disabled' || state.status === 'authorize-drive' ? <p>{t('driveDataDisclosure')}</p> : null}
    {!available ? <p>{t('connectorPreparing')}</p> : <>
      <p role="status">{state.received ? t('libraryReceived') : t(syncLabelKeys[state.status])} {state.lastSyncedAt && <time dateTime={state.lastSyncedAt}>{dateTime(state.lastSyncedAt)}</time>}</p>
      {state.revocationPending && <div className="notice-panel" role="status">
        <h3>{t('revocationHeading')}</h3>
        <p>{t('revocationStart')} <a href="https://myaccount.google.com/connections" target="_blank" rel="noreferrer">{t('googleAccountConnections')}</a>{t('revocationMiddle')} <a href="mailto:ewanderson.flaviano@gmail.com">{t('contactSupport')}</a> {t('revocationEnd')}</p>
      </div>}
      {initializing ? <p>{t('preparingConnection')}</p> : !coordinator && <p>{t('connectorStartFailed')}</p>}
      {state.status === 'authorize-drive' && <p>{t('chooseDriveSync')}</p>}
      <div className="form-actions">
        {(state.revocationPending || ['disabled', 'reconnect', 'identifying', 'authorization-expired'].includes(state.status)) && <button className="button button-primary" disabled={!coordinator || busy || controls.busy || controls.blocked} onClick={() => controls.open('connect')}>{t('signInGoogle')}</button>}
        {['authorization-waiting', 'authorization-error'].includes(state.status) && <button className="button button-primary" disabled={busy} onClick={() => void act(() => coordinator!.retryAuthorization())}>{t('checkAuthorizationAgain')}</button>}
        {state.status === 'authorize-drive' && <button className="button button-primary" disabled={!coordinator || busy || controls.busy || controls.blocked} onClick={() => controls.open('authorize')}>{t('authorizeGoogleDrive')}</button>}
        {!state.revocationPending && state.status === 'paused' && state.login?.driveAuthorized !== false && <button className="button button-primary" disabled={busy} onClick={() => void act(() => coordinator!.resume())}>{t('resumeSync')}</button>}
        {!state.revocationPending && ['error', 'quota', 'pending', 'offline'].includes(state.status) && <button className="button button-primary" disabled={busy} onClick={() => void act(() => coordinator!.resume())}>{t('retry')}</button>}
      </div>
      {(authorizationStates.includes(state.status) || state.login?.status === 'signed-in' || state.logoutUnconfirmed || state.localEraseFailed || state.status !== 'disabled') && <details className="data-management">
        <summary>{t('manageConnection')}</summary>
        <div className="form-actions">
        {state.authorizationStage === 'drive' && ['authorization-waiting', 'authorization-error'].includes(state.status) && <button className="button button-secondary" disabled={busy || controls.busy || controls.blocked} onClick={() => controls.open('retry-authorize')}>{t('retryAuthorizeDrive')}</button>}
        {authorizationStates.includes(state.status) && state.status !== 'authorize-drive' && <button className="button button-secondary" disabled={busy} onClick={() => void act(() => coordinator!.cancelAuthorization())}>{t('cancelAuthorization')}</button>}
        {!authorizationStates.includes(state.status) && !['disabled', 'paused'].includes(state.status) && <button className="button button-secondary" disabled={busy} onClick={() => void act(() => coordinator!.pause())}>{t('pauseHere')}</button>}
        {(state.login?.status === 'signed-in' || state.logoutUnconfirmed || state.localEraseFailed || !authorizationStates.includes(state.status) && state.status !== 'disabled') && <>
          <button className="button button-secondary" disabled={busy || controls.blocked || !state.login?.signInAttemptId && state.login?.status === 'unavailable'} onClick={() => setConfirm('logout')}>{state.localEraseFailed ? t('retryErase') : t('signOutErase')}</button>
          {state.login?.driveAuthorized === true && <button className="button button-secondary" disabled={busy} onClick={() => setConfirm('revoke')}>{t('disconnectDrive')}</button>}
          <button className="button button-secondary" disabled={busy} onClick={() => void act(async () => { const copy = await coordinator!.recoveryCopy(); if (copy) downloadLibrary(copy.library, 'recuperacao'); else setError('noRecoveryCopy'); })}>{t('downloadRecoveryCopy')}</button>
        </>}
        </div>
      </details>}
      {state.status === 'conflict' && !merge && <div className="notice-panel"><h3 ref={conflictHeading} className="sync-resolution-heading" tabIndex={-1}>{t('chooseVersion')}</h3>
        {state.accountChanged && <p>{t('accountChanged')}</p>}
        <p>{t('localVersionCount', { books: countBooks(state.localCount ?? 0) })}</p>
        <button ref={mergeButton} className="button button-primary" disabled={busy || !!merge || controls.blocked} onClick={() => void prepareMergePreview()}>{t('mergeLibraries')}</button>
        <button className="button button-secondary" disabled={busy || !!merge} onClick={() => setConfirm('local')}>{t('keepLocalLibrary')}</button>
        {state.remote?.map(remote => <div key={remote.snapshotId}><p>{t('remoteVersion', { books: countBooks(remote.count), date: dateTime(remote.createdAt) })}</p>
          <button className="button button-secondary" disabled={busy} onClick={() => void act(async () => downloadLibrary(await coordinator!.downloadRemote(remote.snapshotId), 'drive'))}>{t('downloadDriveVersion')}</button>
          <button className="button button-secondary" disabled={busy || !!merge} onClick={() => setConfirm(remote.snapshotId)}>{t('useDriveVersion')}</button></div>)}
        <p>{t('keepJsonCopies')}</p>
      </div>}
    </>}
    {preparingMerge && <p role="status">{t('preparingVersions')} <button className="button button-secondary" onClick={closeMerge}>{t('cancelPreparation')}</button></p>}
    {merge && <MergePreview key={merge.id} preview={merge} busy={busy} error={mergeError ? t(mergeError) : ''} accountChanged={state.accountChanged} onCancel={closeMerge} onConfirm={() => void confirmMerge()} />}
    {mergeNotice && <p role="status">{t(mergeNotice)}</p>}
    {error && <p role="alert">{t(error)}</p>}
    {confirm && <ConfirmDialog title={confirm === 'revoke' ? t('disconnectDriveQuestion') : confirm === 'logout' ? t('signOutQuestion') : t('confirmVersionQuestion')}
      confirmLabel={t('confirm')} busy={busy} onCancel={() => setConfirm(null)} onConfirm={() => void act(async () => {
        if (confirm === 'revoke') return coordinator!.disconnect(true);
        if (confirm === 'logout') { await coordinator!.disconnect(false); window.location.reload(); return; }
        return coordinator!.resolve(confirm);
      })}>
      <p>{confirm === 'revoke' || confirm === 'logout' ? confirm === 'logout' ? t('signOutConsequences') : t('disconnectConsequences') : t('chooseVersionConsequences')}</p>
    </ConfirmDialog>}
  </section>;
}
