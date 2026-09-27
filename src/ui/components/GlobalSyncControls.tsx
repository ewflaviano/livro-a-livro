import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode, type RefObject } from 'react';
import { Cloud, CloudOff, Heart, Settings } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useSync } from '../../app/SyncProvider';
import { getPwaState, subscribePwa } from '../../pwa/register';
import { getUiOccupancy, subscribeUiOccupancy } from '../interaction-guard';
import { ConfirmDialog } from './ConfirmDialog';
import { syncLabels } from './sync-presentation';
import type { SyncView } from '../../sync/contracts';

type Action = 'connect' | 'authorize' | 'retry-authorize';
const Context = createContext<{ open: (action: Action) => void; busy: boolean; blocked: boolean; error: string; trigger: RefObject<HTMLButtonElement | null> }>({ open: () => {}, busy: false, blocked: false, error: '', trigger: { current: null } });
export const useGlobalSyncControls = () => useContext(Context);
const shortLabels: Record<SyncView['status'], string> = {
  disabled: 'Entrar com Google', identifying: 'Identificação pendente', 'authorize-drive': 'Autorizar Drive',
  'authorization-expired': 'Entrar novamente', 'authorization-error': 'Verificar autorização', 'authorization-waiting': 'Autorização pendente',
  'connected-empty': 'Drive conectado',
  paused: 'Drive pausado', pending: 'Envio pendente', syncing: 'Enviando…', receiving: 'Recebendo…', synced: 'Drive atualizado', offline: 'Drive offline',
  reconnect: 'Reconectar Google', error: 'Falha no Drive', quota: 'Drive sem espaço', conflict: 'Versões diferentes',
};
const attentionStates = ['reconnect', 'error', 'quota', 'conflict', 'authorization-expired', 'authorization-error'];
export function GlobalSyncControls({ children }: { children: ReactNode }) {
  const { coordinator, state, available } = useSync();
  const pwa = useSyncExternalStore(subscribePwa, getPwaState);
  const occupied = useSyncExternalStore(subscribeUiOccupancy, getUiOccupancy);
  const [prompt, setPrompt] = useState<Action | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
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
    setError(''); setPrompt(action);
  }
  function dismiss() { setDismissed(true); setPrompt(null); setError(''); if (state.status === 'authorize-drive') void coordinator?.dismissDrivePrompt().catch(() => {}); }
  async function confirm() {
    if (!coordinator || !prompt || running.current) return;
    if (getPwaState().blocked || getPwaState().update === 'applying' || getUiOccupancy() > 1) {
      setError('Conclua ou cancele a operação em andamento antes de continuar.'); return;
    }
    if (prompt === 'authorize' && state.status !== 'authorize-drive') { dismiss(); return; }
    running.current = true; setBusy(true); setError('');
    try {
      if (prompt === 'connect') await coordinator.connect();
      else if (prompt === 'authorize') await coordinator.authorizeDrive();
      else await coordinator.retryDriveAuthorization();
      setDismissed(true); setPrompt(null);
    } catch { setError('Não foi possível continuar com Google. Sua biblioteca local foi preservada. Tente novamente.'); }
    finally { running.current = false; setBusy(false); }
  }
  return <Context.Provider value={{ open, busy, blocked, error: prompt ? '' : error, trigger }}>{children}
    {prompt && <ConfirmDialog title={prompt === 'connect' ? 'Entrar com Google?' : 'Guardar sua biblioteca no Drive?'}
      confirmLabel={prompt === 'connect' ? 'Entrar com Google' : 'Autorizar Drive'} cancelLabel={prompt === 'connect' ? 'Cancelar' : 'Agora não'}
      variant="primary" returnFocus={trigger} busy={busy} onCancel={dismiss} onConfirm={() => void confirm()}>
      <p>{prompt === 'connect' ? 'Entre com Google agora. Depois você decide se quer conectar o Drive; sua biblioteca não será enviada nesta etapa.' : 'Autorizar o Drive sincroniza livros, notas, avaliações e capas diretamente com sua conta Google. Você pode continuar usando a estante sem autorizar.'}</p>
      {state.revocationPending && <p>A revogação anterior ainda não foi confirmada. Entrar novamente não remove esse bloqueio; consulte os detalhes em Seus dados.</p>}
      {error && <p role="alert">{error}</p>}
    </ConfirmDialog>}
  </Context.Provider>;
}

export function GlobalSyncHeader() {
  const { state, available, coordinator, initializing } = useSync();
  const controls = useGlobalSyncControls();
  const signIn = ['disabled', 'reconnect', 'authorization-expired'].includes(state.status);
  const label = !available ? 'Google indisponível' : initializing || state.login?.status === 'checking' ? 'Preparando conexão…' : !coordinator ? 'Drive indisponível' : state.login?.status === 'unavailable' ? 'Verificar conexão' : state.revocationPending ? 'Revogação pendente' : shortLabels[state.status];
  const interactive = available && !initializing && coordinator && !state.revocationPending && (signIn || state.status === 'authorize-drive');
  return <><nav className="header-tools" aria-label="Conta e opções">
    <Link className="header-option" to="/apoiar"><Heart aria-hidden="true" /><span>Apoiar</span></Link>
    {interactive ? <button ref={controls.trigger} className="header-option global-sync" disabled={controls.busy || controls.blocked}
      title={controls.blocked ? 'Conclua ou saia do formulário ou operação em andamento antes de conectar.' : undefined}
      onClick={() => controls.open(signIn ? 'connect' : 'authorize')}><Cloud aria-hidden="true" /><span aria-live="polite">{state.login?.status === 'signed-in' && <small className="header-login-state">Google conectado</small>}{label}</span></button> :
      <Link className="header-option global-sync" to="/dados" state={state.status === 'conflict' ? { focus: 'sync-conflict' } : undefined} aria-label={`${label} — ver detalhes`}>
        {state.status === 'offline' ? <CloudOff aria-hidden="true" /> : <Cloud aria-hidden="true" />}<span aria-live="polite">{state.login?.status === 'signed-in' && <small className="header-login-state">Google conectado</small>}{label}</span></Link>}
    <Link className="header-option header-settings" to="/configuracoes" aria-label="Abrir configurações" title="Configurações"><Settings aria-hidden="true" /></Link>
  </nav>{controls.error && <p className="global-action-error" role="alert">{controls.error} Abra os detalhes da conexão para tentar novamente ou cancelar.</p>}</>;
}

export function GlobalSyncAttention() {
  const { state, available } = useSync();
  const [dismissed, setDismissed] = useState('');
  const key = `${state.status}:${Boolean(state.revocationPending)}:${Boolean(state.accountChanged)}:${state.status === 'conflict' ? state.remote?.map(remote => remote.snapshotId).sort().join(',') ?? '' : ''}`;
  useEffect(() => { setDismissed(''); }, [key]);
  if (!available || (!attentionStates.includes(state.status) && !state.revocationPending) || dismissed === key) return null;
  return <aside className="global-sync-attention" aria-label="Atenção ao Google Drive">
    <p role="status">{state.revocationPending ? 'A revogação no Google ainda não foi confirmada. Os envios estão pausados.' : syncLabels[state.status]}</p>
    <div><Link to="/dados" state={state.status === 'conflict' ? { focus: 'sync-conflict' } : undefined}>{state.status === 'conflict' ? 'Conferir versões' : 'Ver detalhes'}</Link>
      <button type="button" onClick={() => setDismissed(key)}>Decidir depois</button></div>
  </aside>;
}
