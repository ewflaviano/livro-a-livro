import { MergePreview } from '../components/MergePreview';
import type { ResolutionPreview } from '../../sync/merge';
import { BackupPanel } from '../components/BackupPanel';
import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useSync } from '../../app/SyncProvider';
import { serializeBackup } from '../../backup/serialize';
import { referencedExport } from '../../sync/snapshot';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useGlobalSyncControls } from '../components/GlobalSyncControls';
import { authorizationStates, syncLabels as labels } from '../components/sync-presentation';
import type { LibraryExport } from '../../backup/schema';

export function downloadLibrary(data: LibraryExport, suffix: string) {
  const url = URL.createObjectURL(new Blob([serializeBackup(referencedExport(data))], { type: 'application/json;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = `livro-a-livro-${suffix}.json`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
export function DataPage() {
  const location = useLocation();
  const { coordinator, state, available, local, initializing } = useSync();
  const controls = useGlobalSyncControls();
  const [confirm, setConfirm] = useState<string | null>(null); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [merge, setMerge] = useState<ResolutionPreview | null>(null);
  const [preparingMerge, setPreparingMerge] = useState(false);
  const [mergeError, setMergeError] = useState(''); const [mergeNotice, setMergeNotice] = useState('');
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
  useEffect(() => { document.title = 'Seus dados · Livro a Livro'; }, []);
  async function act(action: () => Promise<unknown>) {
    setBusy(true); setError('');
    try { await action(); } catch { setError('Não foi possível concluir. Sua biblioteca local foi preservada. Tente novamente.'); }
    finally { setBusy(false); setConfirm(null); }
  }
  function closeMerge() {
    mergeEpoch.current++;
    if (mergeRef.current) coordinator?.cancelResolution(mergeRef.current.id);
    mergeRef.current = null; setMerge(null); setMergeError(''); setPreparingMerge(false); setBusy(false);
    queueMicrotask(() => (mergeButton.current ?? pageHeading.current)?.focus());
  }
  async function prepareMergePreview() {
    const epoch = ++mergeEpoch.current; setBusy(true); setPreparingMerge(true); setError(''); setMergeError(''); setMergeNotice('');
    try {
      const preview = await coordinator!.prepareResolution();
      if (epoch !== mergeEpoch.current) { coordinator?.cancelResolution(preview.id); return; }
      mergeRef.current = preview; setMerge(preview);
    } catch { if (epoch === mergeEpoch.current) setError('Não foi possível preparar a união. Confira a conexão e os limites de 100 MiB de fontes. Você ainda pode baixar cópias ou escolher uma biblioteca inteira.'); }
    finally { if (epoch === mergeEpoch.current) { setBusy(false); setPreparingMerge(false); } }
  }
  async function confirmMerge() {
    if (!merge) return;
    const epoch = mergeEpoch.current; setBusy(true); setMergeError('');
    try {
      const result = await coordinator!.confirmResolution(merge.id);
      if (epoch !== mergeEpoch.current) return;
      mergeRef.current = null; setMerge(null);
      setMergeNotice(result === 'synchronized' ? 'Bibliotecas unidas e cópia confirmada no Drive.' : 'Bibliotecas unidas e salvas neste dispositivo; envio pendente. Sua cópia anterior está preservada.');
      queueMicrotask(() => (mergeButton.current ?? pageHeading.current)?.focus());
    } catch { if (epoch === mergeEpoch.current) setMergeError('Não foi possível concluir esta prévia. Confira os limites de livros e capas; se a biblioteca ou conexão mudou, cancele e prepare uma nova prévia. Consulte o estado da sincronização antes de tentar novamente.'); }
    finally { if (epoch === mergeEpoch.current) setBusy(false); }
  }
  return <section ref={content} className="page-content"><h1 ref={pageHeading} tabIndex={-1}>Seus dados</h1>
    {local && <p className="notice-panel" role="status">Modo local de teste: Google e Drive são simulados neste computador. Use somente dados descartáveis.</p>}
    <BackupPanel />
    <h2 ref={driveHeading} className="sync-resolution-heading" tabIndex={-1}>Google Drive opcional</h2>
    {state.login?.status === 'unavailable' && <p>Não foi possível verificar o login. Sua biblioteca continua disponível. <button className="button button-secondary" onClick={() => void act(() => coordinator!.refreshLogin())}>Verificar conexão</button></p>}
    {state.logoutUnconfirmed && <p role="alert">A saída não foi confirmada pelo serviço. Os envios estão pausados neste dispositivo. Tente sair novamente quando houver conexão.</p>}
    {state.status === 'disabled' || state.status === 'authorize-drive' ? <p>Ao autorizar o Drive, livros, notas, avaliações e capas vão direto deste dispositivo ao seu Google Drive.</p> : null}
    {!available ? <p>O conector está em preparação e será liberado após a configuração do serviço de autorização.</p> : <>
      <p role="status">{state.received ? 'Biblioteca recebida do Drive.' : labels[state.status]} {state.lastSyncedAt && <time dateTime={state.lastSyncedAt}>{new Date(state.lastSyncedAt).toLocaleString('pt-BR')}</time>}</p>
      {state.revocationPending && <div className="notice-panel" role="status">
        <h3>Revogação no Google ainda não confirmada</h3>
        <p>Os envios estão pausados neste dispositivo. Remova o Livro a Livro nas <a href="https://myaccount.google.com/connections" target="_blank" rel="noreferrer">conexões da sua Conta Google</a>. Se a reconexão continuar bloqueada, <a href="mailto:ewanderson.flaviano@gmail.com">fale com o suporte</a> para verificar a autorização. Seus livros locais continuam aqui.</p>
      </div>}
      {initializing ? <p>Preparando conexão…</p> : !coordinator && <p>Não foi possível iniciar o conector. A biblioteca local continua disponível.</p>}
      {state.status === 'authorize-drive' && <p>Você escolhe se quer sincronizar sua biblioteca com o Drive.</p>}
      <div className="form-actions">
        {(state.revocationPending || ['disabled', 'reconnect', 'identifying', 'authorization-expired'].includes(state.status)) && <button className="button button-primary" disabled={!coordinator || busy || controls.busy || controls.blocked} onClick={() => controls.open('connect')}>Entrar com Google</button>}
        {['authorization-waiting', 'authorization-error'].includes(state.status) && <button className="button button-primary" disabled={busy} onClick={() => void act(() => coordinator!.retryAuthorization())}>Verificar autorização novamente</button>}
        {state.status === 'authorize-drive' && <button className="button button-primary" disabled={!coordinator || busy || controls.busy || controls.blocked} onClick={() => controls.open('authorize')}>Autorizar Google Drive</button>}
        {!state.revocationPending && state.status === 'paused' && state.login?.driveAuthorized !== false && <button className="button button-primary" disabled={busy} onClick={() => void act(() => coordinator!.resume())}>Retomar sincronização</button>}
        {!state.revocationPending && ['error', 'quota', 'pending', 'offline'].includes(state.status) && <button className="button button-primary" disabled={busy} onClick={() => void act(() => coordinator!.resume())}>Tentar novamente</button>}
      </div>
      {(authorizationStates.includes(state.status) || state.login?.status === 'signed-in' || state.logoutUnconfirmed || state.status !== 'disabled') && <details className="data-management">
        <summary>Gerenciar conexão</summary>
        <div className="form-actions">
        {state.authorizationStage === 'drive' && ['authorization-waiting', 'authorization-error'].includes(state.status) && <button className="button button-secondary" disabled={busy || controls.busy || controls.blocked} onClick={() => controls.open('retry-authorize')}>Tentar autorizar Google Drive novamente</button>}
        {authorizationStates.includes(state.status) && state.status !== 'authorize-drive' && <button className="button button-secondary" disabled={busy} onClick={() => void act(() => coordinator!.cancelAuthorization())}>Cancelar autorização</button>}
        {!authorizationStates.includes(state.status) && !['disabled', 'paused'].includes(state.status) && <button className="button button-secondary" disabled={busy} onClick={() => void act(() => coordinator!.pause())}>Pausar neste dispositivo</button>}
        {(state.login?.status === 'signed-in' || state.logoutUnconfirmed || !authorizationStates.includes(state.status) && state.status !== 'disabled') && <>
          <button className="button button-secondary" disabled={busy || !state.login?.signInAttemptId && state.login?.status === 'unavailable'} onClick={() => setConfirm('logout')}>Sair deste navegador</button>
          {state.login?.driveAuthorized === true && <button className="button button-secondary" disabled={busy} onClick={() => setConfirm('revoke')}>Desconectar Google Drive</button>}
          <button className="button button-secondary" disabled={busy} onClick={() => void act(async () => { const copy = await coordinator!.recoveryCopy(); if (copy) downloadLibrary(copy.library, 'recuperacao'); else setError('Ainda não há uma cópia anterior preservada neste dispositivo.'); })}>Baixar cópia anterior preservada</button>
        </>}
        </div>
      </details>}
      {state.status === 'conflict' && !merge && <div className="notice-panel"><h3 ref={conflictHeading} className="sync-resolution-heading" tabIndex={-1}>Escolher uma versão</h3>
        {state.accountChanged && <p>A conta ou autorização mudou. Os envios anteriores foram suspensos. Escolha explicitamente qual biblioteca usar nesta conexão.</p>}
        <p>Neste dispositivo: {state.localCount} livros. Nenhuma união automática será feita. A versão escolhida será copiada para o Drive e compartilhada com seus dispositivos conectados.</p>
        <button ref={mergeButton} className="button button-primary" disabled={busy || !!merge || controls.blocked} onClick={() => void prepareMergePreview()}>Juntar bibliotecas</button>
        <button className="button button-secondary" disabled={busy || !!merge} onClick={() => setConfirm('local')}>Manter biblioteca local</button>
        {state.remote?.map(remote => <div key={remote.snapshotId}><p>Drive: {remote.count} livros · {new Date(remote.createdAt).toLocaleString('pt-BR')}</p>
          <button className="button button-secondary" disabled={busy} onClick={() => void act(async () => downloadLibrary(await coordinator!.downloadRemote(remote.snapshotId), 'drive'))}>Baixar esta versão do Drive</button>
          <button className="button button-secondary" disabled={busy || !!merge} onClick={() => setConfirm(remote.snapshotId)}>Usar esta versão do Drive</button></div>)}
        <p>Guarde as cópias JSON em um lugar de confiança: elas contêm suas notas e avaliações. As versões do Drive são mantidas; o aplicativo não limpa seu histórico automaticamente.</p>
      </div>}
    </>}
    {preparingMerge && <p role="status">Preparando as versões… <button className="button button-secondary" onClick={closeMerge}>Cancelar preparação</button></p>}
    {merge && <MergePreview key={merge.id} preview={merge} busy={busy} error={mergeError} accountChanged={state.accountChanged} onCancel={closeMerge} onConfirm={() => void confirmMerge()} />}
    {mergeNotice && <p role="status">{mergeNotice}</p>}
    {error && <p role="alert">{error}</p>}
    {confirm && <ConfirmDialog title={confirm === 'revoke' ? 'Desconectar Google Drive?' : confirm === 'logout' ? 'Sair deste navegador?' : 'Confirmar a versão escolhida?'}
      confirmLabel="Confirmar" busy={busy} onCancel={() => setConfirm(null)} onConfirm={() => void act(() => {
        if (confirm === 'revoke' || confirm === 'logout') return coordinator!.disconnect(confirm === 'revoke');
        return coordinator!.resolve(confirm);
      })}>
      <p>{confirm === 'revoke' || confirm === 'logout' ? confirm === 'logout' ? 'O login e a sincronização deste navegador serão encerrados. Sua biblioteca local e os arquivos do Drive serão preservados. Outros dispositivos continuam conectados.' : 'O acesso ao Google Drive será revogado em todos os dispositivos. Seu login neste aplicativo será mantido. A biblioteca local e os arquivos existentes serão preservados; tokens já emitidos podem continuar válidos até a revogação ou expiração.' : 'A escolha substitui a versão ativa completa. Confira e baixe as duas cópias antes de continuar. Uma cópia local anterior ficará preservada para download.'}</p>
    </ConfirmDialog>}
  </section>;
}
