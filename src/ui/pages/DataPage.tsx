import { useEffect, useState } from 'react';
import { useSync } from '../../app/SyncProvider';
import { serializeBackup } from '../../backup/serialize';
import { ConfirmDialog } from '../components/ConfirmDialog';
import type { LibraryExport } from '../../backup/schema';

const labels = {
  disabled: 'Seus dados estão apenas neste dispositivo.', paused: 'Sincronização pausada neste dispositivo.',
  pending: 'Salvo aqui. Alterações aguardando envio ao Drive.', syncing: 'Sincronizando diretamente com seu Google Drive…',
  synced: 'Cópia confirmada no Google Drive.', offline: 'Salvo aqui. Aguardando conexão para sincronizar.',
  reconnect: 'Reconecte o Google Drive para continuar os envios. Seus dados locais continuam aqui.',
  error: 'Não foi possível sincronizar. Seus dados locais continuam aqui.',
  quota: 'Seu Google Drive está sem espaço. Libere espaço ou exporte uma cópia; seus livros continuam salvos aqui.',
  conflict: 'Há versões diferentes da biblioteca. Confira as cópias antes de escolher.',
};
export function downloadLibrary(data: LibraryExport, suffix: string) {
  const url = URL.createObjectURL(new Blob([serializeBackup(data)], { type: 'application/json;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = `livro-a-livro-${suffix}.json`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
export function DataPage() {
  const { coordinator, state, available, local } = useSync();
  const [confirm, setConfirm] = useState<string | null>(null); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  useEffect(() => { document.title = 'Seus dados · Livro a Livro'; }, []);
  async function act(action: () => Promise<unknown>) {
    setBusy(true); setError('');
    try { await action(); } catch { setError('Não foi possível concluir. Sua biblioteca local foi preservada. Tente novamente.'); }
    finally { setBusy(false); setConfirm(null); }
  }
  return <section className="page-content"><p className="eyebrow">Sua história em livros</p><h1>Seus dados</h1>
    {local && <p className="notice-panel" role="status">Modo local de teste: Google e Drive são simulados neste computador. Use somente dados descartáveis.</p>}
    <p className="page-description">Sua biblioteca pertence a você.</p>
    <p>Seus livros ficam neste dispositivo, neste navegador. Limpar os dados do navegador pode remover sua estante. Instalar o aplicativo não cria backup.</p>
    <h2>Google Drive opcional</h2>
    <p>Ao conectar, seus livros, notas e avaliações vão diretamente para uma pasta privada do aplicativo no seu Google Drive. O serviço do Livro a Livro gerencia a autorização, mas não recebe sua biblioteca.</p>
    <p>O envio acontece enquanto o aplicativo está aberto e retoma quando você voltar com conexão. Com o navegador fechado, alterações podem continuar aguardando envio.</p>
    {!available ? <p>O conector está em preparação e será liberado após a configuração do serviço de autorização.</p> : <>
      <p role="status">{labels[state.status]} {state.lastSyncedAt && <time dateTime={state.lastSyncedAt}>{new Date(state.lastSyncedAt).toLocaleString('pt-BR')}</time>}</p>
      {!coordinator && <p>Não foi possível iniciar o conector. A biblioteca local continua disponível.</p>}
      <div className="form-actions">
        {['disabled', 'reconnect'].includes(state.status) && <button className="button button-primary" disabled={!coordinator || busy} onClick={() => setConfirm('connect')}>{state.status === 'reconnect' ? 'Reconectar Google Drive' : 'Conectar Google Drive'}</button>}
        {state.status === 'paused' && <button className="button button-primary" disabled={busy} onClick={() => void act(() => coordinator!.resume())}>Retomar sincronização</button>}
        {!['disabled', 'paused'].includes(state.status) && <button className="button button-secondary" disabled={busy} onClick={() => void act(() => coordinator!.pause())}>Pausar neste dispositivo</button>}
        {['error', 'quota', 'pending', 'offline'].includes(state.status) && <button className="button button-secondary" disabled={busy} onClick={() => void act(() => coordinator!.resume())}>Tentar novamente</button>}
        {state.status !== 'disabled' && <>
          <button className="button button-secondary" disabled={busy} onClick={() => setConfirm('logout')}>Encerrar sessão neste dispositivo</button>
          <button className="button button-secondary" disabled={busy} onClick={() => setConfirm('revoke')}>Desconectar em todos os dispositivos</button>
          <button className="button button-secondary" disabled={busy} onClick={() => void act(async () => downloadLibrary(await coordinator!.localCopy(), 'local'))}>Baixar biblioteca local</button>
          <button className="button button-secondary" disabled={busy} onClick={() => void act(async () => { const copy = await coordinator!.recoveryCopy(); if (copy) downloadLibrary(copy.library, 'recuperacao'); else setError('Ainda não há uma cópia anterior preservada neste dispositivo.'); })}>Baixar cópia anterior preservada</button>
        </>}
      </div>
      {state.status === 'conflict' && <div className="notice-panel"><h3>Escolher uma versão</h3>
        {state.accountChanged && <p>A conta ou autorização mudou. Os envios anteriores foram suspensos. Escolha explicitamente qual biblioteca usar nesta conexão.</p>}
        <p>Neste dispositivo: {state.localCount} livros. Nenhuma união automática será feita. A versão escolhida será copiada para o Drive e compartilhada com seus dispositivos conectados.</p>
        <button className="button button-secondary" disabled={busy} onClick={() => setConfirm('local')}>Manter biblioteca local</button>
        {state.remote?.map(remote => <div key={remote.snapshotId}><p>Drive: {remote.count} livros · {new Date(remote.createdAt).toLocaleString('pt-BR')}</p>
          <button className="button button-secondary" disabled={busy} onClick={() => void act(async () => downloadLibrary(await coordinator!.downloadRemote(remote.snapshotId), 'drive'))}>Baixar esta versão do Drive</button>
          <button className="button button-secondary" disabled={busy} onClick={() => setConfirm(remote.snapshotId)}>Usar esta versão do Drive</button></div>)}
        <p>Guarde as cópias JSON em um lugar de confiança: elas contêm suas notas e avaliações. As versões do Drive são mantidas; o aplicativo não limpa seu histórico automaticamente.</p>
      </div>}
    </>}
    {error && <p role="alert">{error}</p>}
    {confirm && <ConfirmDialog title={confirm === 'connect' ? 'Conectar Google Drive?' : confirm === 'revoke' ? 'Desconectar em todos os dispositivos?' : confirm === 'logout' ? 'Encerrar esta sessão?' : 'Confirmar a versão escolhida?'}
      confirmLabel="Confirmar" busy={busy} onCancel={() => setConfirm(null)} onConfirm={() => void act(() => {
        if (confirm === 'connect') return coordinator!.connect();
        if (confirm === 'revoke' || confirm === 'logout') return coordinator!.disconnect(confirm === 'revoke');
        return coordinator!.resolve(confirm);
      })}>
      <p>{confirm === 'connect' ? 'Seus livros, notas e avaliações serão enviados diretamente ao seu Google Drive. Você pode pausar quando quiser.' : confirm === 'revoke' || confirm === 'logout' ? 'Sua biblioteca neste dispositivo e os arquivos já existentes no Drive serão preservados. Tokens já emitidos podem continuar válidos até a revogação ou expiração.' : 'A escolha substitui a versão ativa completa. Confira e baixe as duas cópias antes de continuar. Uma cópia local anterior ficará preservada para download.'}</p>
    </ConfirmDialog>}
  </section>;
}
