import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode, type RefObject } from 'react';
import { Cloud, CloudOff, Heart } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useSync } from '../../app/SyncProvider';
import { getPwaState, subscribePwa } from '../../pwa/register';
import { getUiOccupancy, subscribeUiOccupancy } from '../interaction-guard';
import { ConfirmDialog } from './ConfirmDialog';
import { syncLabelKeys } from './sync-presentation';
import type { SyncView } from '../../sync/contracts';
import { useLocale } from '../../i18n/context';
import type { MessageKey } from '../../i18n/messages';

type Action = 'connect' | 'authorize' | 'retry-authorize';
const Context = createContext<{ open: (action: Action) => void; busy: boolean; blocked: boolean; error: string; trigger: RefObject<HTMLButtonElement | null> }>({ open: () => {}, busy: false, blocked: false, error: '', trigger: { current: null } });
export const useGlobalSyncControls = () => useContext(Context);
const shortLabels: Record<SyncView['status'], MessageKey> = {
  disabled: 'signInGoogle', identifying: 'shortIdentifying', 'authorize-drive': 'shortAuthorizeDrive',
  'authorization-expired': 'shortAuthorizationExpired', 'authorization-error': 'shortAuthorizationError', 'authorization-waiting': 'shortAuthorizationWaiting',
  'connected-empty': 'shortConnectedEmpty', paused: 'shortPaused', pending: 'shortPending', syncing: 'shortSyncing', receiving: 'shortReceiving',
  synced: 'shortSynced', offline: 'shortOffline', reconnect: 'shortReconnect', error: 'shortError', quota: 'shortQuota', conflict: 'shortConflict',
};
const attentionStates = ['reconnect', 'error', 'quota', 'conflict', 'authorization-expired', 'authorization-error'];
export function GlobalSyncControls({ children }: { children: ReactNode }) {
  const { t } = useLocale();
  const { coordinator, state, available } = useSync();
  const pwa = useSyncExternalStore(subscribePwa, getPwaState);
  const occupied = useSyncExternalStore(subscribeUiOccupancy, getUiOccupancy);
  const [prompt, setPrompt] = useState<Action | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<MessageKey | null>(null);
  const running = useRef(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const blocked = pwa.blocked || pwa.update === 'applying' || occupied > 0;
  useEffect(() => {
    // Child effects can acquire a guard after this render's snapshot was read.
    const currentlyBlocked = getPwaState().blocked || getPwaState().update === 'applying';
    if (prompt && (currentlyBlocked || getUiOccupancy() > 1)) { setPrompt(null); return; }
    if (state.status !== 'authorize-drive') {
      setDismissed(false);
      setPrompt(current => current === 'authorize' ? null : current);
    } else if (available && coordinator && !blocked && !currentlyBlocked && getUiOccupancy() === 0 && !dismissed && !state.drivePromptDismissed && !prompt && !busy) setPrompt('authorize');
  }, [state.status, available, coordinator, blocked, pwa.blocked, pwa.update, occupied, dismissed, state.drivePromptDismissed, prompt, busy]);
  function open(action: Action) {
    if (!available || !coordinator || running.current || blocked) return;
    setError(null); setPrompt(action);
  }
  function dismiss() { setDismissed(true); setPrompt(null); setError(null); if (state.status === 'authorize-drive') void coordinator?.dismissDrivePrompt().catch(() => {}); }
  async function confirm() {
    if (!coordinator || !prompt || running.current) return;
    if (getPwaState().blocked || getPwaState().update === 'applying' || getUiOccupancy() > 1) {
      setError('finishOperationFirst'); return;
    }
    if (prompt === 'authorize' && state.status !== 'authorize-drive') { dismiss(); return; }
    running.current = true; setBusy(true); setError(null);
    try {
      if (prompt === 'connect') await coordinator.connect();
      else if (prompt === 'authorize') await coordinator.authorizeDrive();
      else await coordinator.retryDriveAuthorization();
      setDismissed(true); setPrompt(null);
    } catch { setError('googleContinueFailed'); }
    finally { running.current = false; setBusy(false); }
  }
  return <Context.Provider value={{ open, busy, blocked, error: prompt || !error ? '' : t(error), trigger }}>{children}
    {prompt && <ConfirmDialog title={prompt === 'connect' ? t('signInQuestion') : t('storeInDriveQuestion')}
      confirmLabel={prompt === 'connect' ? t('signInGoogle') : t('authorizeDrive')} cancelLabel={prompt === 'connect' ? t('cancel') : t('notNow')}
      variant="primary" returnFocus={trigger} busy={busy} onCancel={dismiss} onConfirm={() => void confirm()}>
      <p>{prompt === 'connect' ? t('signInExplanation') : t('authorizeExplanation')}</p>
      {state.revocationPending && <p>{t('revocationBlocksNewSignIn')}</p>}
      {error && <p role="alert">{t(error)}</p>}
    </ConfirmDialog>}
  </Context.Provider>;
}

export function GlobalSyncHeader() {
  const { t } = useLocale();
  const { state, available, coordinator, initializing } = useSync();
  const controls = useGlobalSyncControls();
  const signIn = ['disabled', 'reconnect', 'authorization-expired'].includes(state.status);
  const label = !available ? t('googleUnavailable') : initializing || state.login?.status === 'checking' ? t('preparingConnection') : !coordinator ? t('driveUnavailable') : state.login?.status === 'unavailable' ? t('verifyConnection') : state.revocationPending ? t('revocationPending') : t(shortLabels[state.status]);
  const interactive = available && !initializing && coordinator && !state.revocationPending && (signIn || state.status === 'authorize-drive');
  const mobileLabel = signIn || !available ? t('google') : t('drive');
  return <><nav className="header-tools" aria-label={t('accountOptions')}>
    <Link className="header-option header-support" to="/apoiar"><Heart aria-hidden="true" /><span>{t('support')}</span></Link>
    {interactive ? <button ref={controls.trigger} className="header-option global-sync" aria-label={label} disabled={controls.busy || controls.blocked}
      title={controls.blocked ? t('completeOperationConnect') : undefined}
      onClick={() => controls.open(signIn ? 'connect' : 'authorize')}><Cloud aria-hidden="true" /><span className="sync-label-full" aria-live="polite">{state.login?.status === 'signed-in' && <small className="header-login-state">{t('googleConnected')}</small>}{label}</span><span className="sync-label-mobile" aria-hidden="true">{mobileLabel}</span></button> :
      <Link className={`header-option global-sync${!available ? ' global-sync-unavailable' : ''}`} to="/dados" state={state.status === 'conflict' ? { focus: 'sync-conflict' } : undefined} aria-label={t('viewDetailsSuffix', { label })}>
        {state.status === 'offline' ? <CloudOff aria-hidden="true" /> : <Cloud aria-hidden="true" />}<span className="sync-label-full" aria-live="polite">{state.login?.status === 'signed-in' && <small className="header-login-state">{t('googleConnected')}</small>}{label}</span><span className="sync-label-mobile" aria-hidden="true">{mobileLabel}</span></Link>}
  </nav>{controls.error && <p className="global-action-error" role="alert">{controls.error} {t('openConnectionDetails')}</p>}</>;
}

export function GlobalSyncAttention() {
  const { t } = useLocale();
  const { state, available } = useSync();
  const [dismissed, setDismissed] = useState('');
  const key = `${state.status}:${Boolean(state.revocationPending)}:${Boolean(state.accountChanged)}:${state.status === 'conflict' ? state.remote?.map(remote => remote.snapshotId).sort().join(',') ?? '' : ''}`;
  useEffect(() => { setDismissed(''); }, [key]);
  if (!available || (!attentionStates.includes(state.status) && !state.revocationPending) || dismissed === key) return null;
  return <aside className="global-sync-attention" aria-label={t('driveAttention')}>
    <p role="status">{state.revocationPending ? t('revocationNotConfirmed') : t(syncLabelKeys[state.status])}</p>
    <div><Link to="/dados" state={state.status === 'conflict' ? { focus: 'sync-conflict' } : undefined}>{state.status === 'conflict' ? t('compareVersions') : t('viewDetails')}</Link>
      <button type="button" onClick={() => setDismissed(key)}>{t('decideLater')}</button></div>
  </aside>;
}
