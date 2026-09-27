import { MergePreview } from '../components/MergePreview';
import type { ResolutionChoices, ResolutionPreview } from '../../sync/merge';
import { BackupPanel } from '../components/BackupPanel';
import { useEffect, useRef, useState } from 'react';
import { useSync } from '../../app/SyncProvider';
import { serializeBackup } from '../../backup/serialize';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useGlobalSyncControls } from '../components/GlobalSyncControls';
import { authorizationStates, syncLabels as labels } from '../components/sync-presentation';
import type { LibraryExport } from '../../backup/schema';
import { openExperimentStore } from '../../experiments/store';

export function downloadLibrary(data: LibraryExport, suffix: string) {
  const url = URL.createObjectURL(new Blob([serializeBackup(data)], { type: 'application/json;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = `livro-a-livro-${suffix}.json`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
export function DataPage() {
  const { coordinator, state, available, local, initializing } = useSync();
  const controls = useGlobalSyncControls();
  const [confirm, setConfirm] = useState<string | null>(null); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [merge, setMerge] = useState<ResolutionPreview | null>(null);
  const [preparingMerge, setPreparingMerge] = useState(false);
  const [mergeError, setMergeError] = useState(''); const [mergeNotice, setMergeNotice] = useState('');
  const mergeRef = useRef<ResolutionPreview | null>(null); const mergeEpoch = useRef(0); const mergeButton = useRef<HTMLButtonElement>(null); const pageHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => () => { mergeEpoch.current++; if (mergeRef.current) coordinator?.cancelResolution(mergeRef.current.id); }, [coordinator]);
  const [preferences, setPreferences] = useState<{ experiments: boolean; telemetry: boolean } | null>(null);
  useEffect(() => { document.title = 'Seus dados · Livro a Livro'; }, []);
  useEffect(() => {
    let active = true; let close = () => {};
    void openExperimentStore().then(async (store) => {
      close = store.close;
      const current = await store.read();
      if (active) setPreferences({ experiments: current.experimentsConsent, telemetry: current.telemetryConsent });
    }).catch(() => { if (active) setPreferences(null); });
    return () => { active = false; close(); };
  }, []);
  async function changePreference(kind: 'experiments' | 'telemetry', value: boolean) {
    try {
      const store = await openExperimentStore();
      const next = await store.patch(kind === 'experiments' ? { experimentsConsent: value } : { telemetryConsent: value });
      store.close();
      setPreferences({ experiments: next.experimentsConsent, telemetry: next.telemetryConsent });
    } catch { setError('Não foi possível salvar essa escolha neste dispositivo.'); }
  }
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
  async function confirmMerge(choices: ResolutionChoices) {
    if (!merge) return;
    const epoch = mergeEpoch.current; setBusy(true); setMergeError('');
    try {
      const result = await coordinator!.confirmResolution(merge.id, choices);
      if (epoch !== mergeEpoch.current) return;
      mergeRef.current = null; setMerge(null);
      setMergeNotice(result === 'synchronized' ? 'Bibliotecas unidas e cópia confirmada no Drive.' : 'Bibliotecas unidas e salvas neste dispositivo; envio pendente. Sua cópia anterior está preservada.');
      queueMicrotask(() => (mergeButton.current ?? pageHeading.current)?.focus());
    } catch { if (epoch === mergeEpoch.current) setMergeError('Não foi possível concluir esta prévia. Confira os limites de livros e capas; se a biblioteca ou conexão mudou, cancele e prepare uma nova prévia. Consulte o estado da sincronização antes de tentar novamente.'); }
    finally { if (epoch === mergeEpoch.current) setBusy(false); }
  }
  return <section className="page-content"><p className="eyebrow">Sua história em livros</p><h1 ref={pageHeading} tabIndex={-1}>Seus dados</h1>
    {local && <p className="notice-panel" role="status">Modo local de teste: Google e Drive são simulados neste computador. Use somente dados descartáveis.</p>}
    <p className="page-description">Sua biblioteca pertence a você.</p>
    <p>Seus livros ficam neste dispositivo, neste navegador. Limpar os dados do navegador pode remover sua estante. Instalar o aplicativo não cria backup.</p>
    <BackupPanel />
    <h2>Google Drive opcional</h2>
    {state.login?.status === 'signed-in' && <p>Você entrou com Google. O login, sozinho, não envia sua biblioteca.</p>}
    {state.login?.status === 'unavailable' && <p>Não foi possível verificar o login. Sua biblioteca continua disponível. <button className="button button-secondary" onClick={() => void act(() => coordinator!.refreshLogin())}>Verificar conexão</button></p>}
    {state.logoutUnconfirmed && <p role="alert">A saída não foi confirmada pelo serviço. Os envios estão pausados neste dispositivo. Tente sair novamente quando houver conexão.</p>}
    <p>Ao conectar, seus livros, notas e avaliações vão diretamente para uma pasta privada do aplicativo no seu Google Drive. O serviço do Livro a Livro gerencia a autorização, mas não recebe sua biblioteca.</p>
    <p>O envio acontece enquanto o aplicativo está aberto e retoma quando você voltar com conexão. Com o navegador fechado, alterações podem continuar aguardando envio.</p>
    {!available ? <p>O conector está em preparação e será liberado após a configuração do serviço de autorização.</p> : <>
      <p role="status">{state.received ? 'Biblioteca recebida do Drive.' : labels[state.status]} {state.lastSyncedAt && <time dateTime={state.lastSyncedAt}>{new Date(state.lastSyncedAt).toLocaleString('pt-BR')}</time>}</p>
      {state.revocationPending && <div className="notice-panel" role="status">
        <h3>Revogação no Google ainda não confirmada</h3>
        <p>Os envios estão pausados neste dispositivo. Remova o Livro a Livro nas <a href="https://myaccount.google.com/connections" target="_blank" rel="noreferrer">conexões da sua Conta Google</a>. Se a reconexão continuar bloqueada, <a href="mailto:ewanderson.flaviano@gmail.com">fale com o suporte</a> para verificar a autorização. Seus livros locais continuam aqui.</p>
      </div>}
      {initializing ? <p>Preparando conexão…</p> : !coordinator && <p>Não foi possível iniciar o conector. A biblioteca local continua disponível.</p>}
      {state.status === 'authorize-drive' && <p>Sua sessão Google é opcional e permanece neste navegador. Autorizar o Drive é opcional: seus livros, notas, avaliações e capas serão enviados diretamente ao seu Google Drive. O Google pode apresentar sua própria seleção de permissões.</p>}
      <div className="form-actions">
        {(state.revocationPending || ['disabled', 'reconnect', 'identifying', 'authorization-expired', 'authorization-waiting', 'authorization-error'].includes(state.status)) && <button className="button button-primary" disabled={!coordinator || busy || controls.busy || controls.blocked} onClick={() => controls.open('connect')}>Entrar com Google</button>}
        {state.authorizationStage === 'drive' && ['authorization-waiting', 'authorization-error'].includes(state.status) && <button className="button button-secondary" disabled={busy || controls.busy || controls.blocked} onClick={() => controls.open('retry-authorize')}>Tentar autorizar Google Drive novamente</button>}
        {['authorization-waiting', 'authorization-error'].includes(state.status) && <button className="button button-secondary" disabled={busy} onClick={() => void act(() => coordinator!.retryAuthorization())}>Verificar autorização novamente</button>}
        {state.status === 'authorize-drive' && <button className="button button-primary" disabled={!coordinator || busy || controls.busy || controls.blocked} onClick={() => controls.open('authorize')}>Autorizar Google Drive</button>}
        {authorizationStates.includes(state.status) && state.status !== 'authorize-drive' && <button className="button button-secondary" disabled={busy} onClick={() => void act(() => coordinator!.cancelAuthorization())}>Cancelar autorização</button>}
        {!state.revocationPending && state.status === 'paused' && state.login?.driveAuthorized !== false && <button className="button button-primary" disabled={busy} onClick={() => void act(() => coordinator!.resume())}>Retomar sincronização</button>}
        {!authorizationStates.includes(state.status) && !['disabled', 'paused'].includes(state.status) && <button className="button button-secondary" disabled={busy} onClick={() => void act(() => coordinator!.pause())}>Pausar neste dispositivo</button>}
        {!state.revocationPending && ['error', 'quota', 'pending', 'offline'].includes(state.status) && <button className="button button-secondary" disabled={busy} onClick={() => void act(() => coordinator!.resume())}>Tentar novamente</button>}
        {(state.login?.status === 'signed-in' || state.logoutUnconfirmed || !authorizationStates.includes(state.status) && state.status !== 'disabled') && <>
          <button className="button button-secondary" disabled={busy || !state.login?.signInAttemptId && state.login?.status === 'unavailable'} onClick={() => setConfirm('logout')}>Sair deste navegador</button>
          {state.login?.driveAuthorized === true && <button className="button button-secondary" disabled={busy} onClick={() => setConfirm('revoke')}>Desconectar Google Drive</button>}
          <button className="button button-secondary" disabled={busy} onClick={() => void act(async () => { const copy = await coordinator!.recoveryCopy(); if (copy) downloadLibrary(copy.library, 'recuperacao'); else setError('Ainda não há uma cópia anterior preservada neste dispositivo.'); })}>Baixar cópia anterior preservada</button>
        </>}
      </div>
      {state.status === 'conflict' && !merge && <div className="notice-panel"><h3>Escolher uma versão</h3>
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
    {merge && state.accountChanged && <p className="notice-panel">A conta ou autorização mudou. Ao confirmar a união, você escolhe enviar os livros selecionados para esta conexão.</p>}
    {merge && <MergePreview key={merge.id} preview={merge} busy={busy} error={mergeError} onCancel={closeMerge} onConfirm={choices => void confirmMerge(choices)} />}
    {mergeNotice && <p role="status">{mergeNotice}</p>}
    <h2>Experimentos e métricas</h2>
    <p>Essas escolhas não dependem do Google Drive e não mudam sua biblioteca. São desligadas por padrão.</p>
    {preferences ? <fieldset className="privacy-choices">
      <label><input type="checkbox" checked={preferences.experiments}
        onChange={(event) => void changePreference('experiments', event.currentTarget.checked)} />
        Participar de pequenos experimentos de interface</label>
      <p>Experimentos só podem alterar fluxos reversíveis. Você pode sair quando quiser.</p>
      <label><input type="checkbox" checked={preferences.telemetry}
        onChange={(event) => void changePreference('telemetry', event.currentTarget.checked)} />
        Enviar métricas técnicas agregadas</label>
      <p>Quando houver métricas, elas registram apenas contadores de eventos pré-definidos — nunca livros, notas, conta ou identificadores.</p>
    </fieldset> : <p>Preparando as escolhas de privacidade neste dispositivo…</p>}
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
