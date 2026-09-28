import { useEffect, useRef, useState } from 'react';
import { useLibrary } from '../../app/LibraryProvider';
import { DomainError } from '../../domain/errors';
import type { BackupFile, ImportPreview } from '../../services/backup-service';
import { blockPwaUpdate } from '../../pwa/register';
import { ConfirmDialog } from './ConfirmDialog';

function importMessage(error: unknown): string {
  const code = error instanceof DomainError ? error.code : '';
  if (code === 'StaleRevision') return 'Sua biblioteca mudou desde a prévia. Selecione o arquivo novamente para conferir a versão atual. Nenhum dado foi substituído.';
  if (code === 'QuotaExceeded') return 'O dispositivo está sem espaço para restaurar. Libere espaço e selecione o arquivo novamente. Sua biblioteca foi preservada.';
  if (code === 'UnsupportedVersion') return 'Este backup usa uma versão não compatível com este aplicativo. Sua biblioteca não foi alterada.';
  if (code === 'ImportTooLarge') return 'O arquivo excede os limites de tamanho, livros ou capas do aplicativo. Sua biblioteca não foi alterada.';
  if (code === 'InvalidBackup') return 'O arquivo não é um backup válido do Livro a Livro ou contém capas inválidas. Sua biblioteca não foi alterada.';
  return 'Não foi possível restaurar neste dispositivo. Sua biblioteca foi preservada. Selecione o arquivo novamente para tentar.';
}
const bookCount = (count: number) => `${count} ${count === 1 ? 'livro' : 'livros'}`;
const years = (values: readonly number[]) => values.length ? values.join(', ') : 'nenhum';

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
  const { backup, state, retry } = useLibrary();
  const [busy, setBusy] = useState<'prepare' | 'export' | 'restore' | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
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
      if (inFlight.current === 'restore' || !window.confirm('Descartar a operação de backup em andamento e sair?')) {
        event.preventDefault(); event.stopPropagation();
      }
    };
    window.addEventListener('beforeunload', unload); document.addEventListener('click', navigation, true);
    return () => { window.removeEventListener('beforeunload', unload); document.removeEventListener('click', navigation, true); };
  }, [protectedOperation]);
  function clearSelection() {
    backup?.cancelImport(); setPreview(null); setConfirm(false);
    if (input.current) input.current.value = '';
  }
  function cancel() {
    ++operation.current; inFlight.current = null; setBusy(null); clearSelection(); setError(''); setMessage('Importação cancelada. Sua biblioteca não foi alterada.');
    input.current?.focus();
  }
  async function select(file: BackupFile) {
    if (!backup || inFlight.current === 'restore' || inFlight.current === 'export') return;
    const selected = ++operation.current;
    clearSelection(); inFlight.current = 'prepare'; setBusy('prepare'); setError(''); setMessage('');
    try {
      const next = await backup.prepareImport(file);
      if (active.current && selected === operation.current) setPreview(next);
    } catch (failure) {
      if (active.current && selected === operation.current) { setError(importMessage(failure)); if (input.current) input.current.value = ''; }
    } finally {
      if (active.current && selected === operation.current) { inFlight.current = null; setBusy(null); }
    }
  }
  async function exportCurrent() {
    if (!backup || inFlight.current) return;
    const selected = ++operation.current;
    inFlight.current = 'export'; setBusy('export'); setError(''); setMessage('');
    try {
      const exported = await backup.exportBackup(new Date().toISOString());
      if (!active.current || selected !== operation.current) return;
      startDownload(exported.blob, exported.filename);
      try {
        await backup.recordDownloadStarted(new Date().toISOString(), exported.version);
        if (active.current && selected === operation.current) setMessage('Arquivo JSON gerado. Download iniciado; confira se ele foi salvo e guarde-o em um lugar de confiança.');
      } catch {
        if (active.current && selected === operation.current) setMessage('Download iniciado, mas não foi possível registrar a data neste dispositivo. Confira se o arquivo foi salvo.');
      }
    } catch {
      if (active.current && selected === operation.current) setError('Não foi possível iniciar a exportação. Seus registros continuam aqui. Tente novamente.');
    } finally {
      if (active.current && selected === operation.current) { inFlight.current = null; setBusy(null); }
    }
  }
  async function restore() {
    if (!backup || !preview || inFlight.current) return;
    const selected = ++operation.current; const count = preview.incoming.count;
    inFlight.current = 'restore'; setBusy('restore'); setError(''); setMessage('');
    try {
      await backup.confirmImport(preview);
      if (active.current && selected === operation.current) setMessage(`${count} ${count === 1 ? 'livro importado' : 'livros importados'} neste dispositivo.`);
    } catch (failure) {
      if (active.current && selected === operation.current) setError(importMessage(failure));
    } finally {
      if (active.current && selected === operation.current) { returnFocus.current = true; clearSelection(); inFlight.current = null; setBusy(null); }
    }
  }
  const unavailable = !backup || state.status !== 'ready';
  return <section aria-labelledby="local-backup-title" aria-busy={Boolean(busy)}>
    <h2 id="local-backup-title">Backup local</h2>
    <p>Faça ou restaure uma cópia de todos os anos, mesmo sem conexão.</p>
    {unavailable && <p role="status">{state.status === 'error' ? 'Não foi possível abrir a biblioteca neste dispositivo.' : 'Abrindo a biblioteca para preparar seu backup…'}</p>}
    {state.status === 'error' && <button className="button button-secondary" onClick={retry}>Tentar abrir a biblioteca</button>}
    <div className="form-actions"><button className="button button-primary" disabled={unavailable || Boolean(busy)} onClick={() => void exportCurrent()}>
      {busy === 'export' ? 'Preparando arquivo…' : 'Fazer backup'}</button>
      <button className="button button-secondary" disabled={unavailable || busy === 'restore' || busy === 'export'} onClick={() => { setRestoreOpen(true); if (restoreOpen) input.current?.focus(); }}>Restaurar backup</button></div>
    <p className="field-help">O arquivo JSON contém notas e capas privadas. Guarde-o em um lugar seguro.</p>
    {restoreOpen && <><label className="form-field">Importar JSON<input ref={input} type="file" accept=".json,application/json" disabled={unavailable || busy === 'restore' || busy === 'export'}
      onChange={event => { const file = event.currentTarget.files?.[0]; if (file) void select(file); }} /></label>
    <p className="field-help">Até 50 MiB. A restauração substitui toda a biblioteca após sua confirmação.</p></>}
    {busy === 'prepare' && <p role="status">Validando o arquivo e as capas neste dispositivo…</p>}
    {(preview || busy === 'prepare') && <div className="notice-panel">
      {preview && <>
        <h3>Conferir restauração</h3>
        <p>No arquivo: {bookCount(preview.incoming.count)}. Anos: {years(preview.incoming.years)}.</p>
        <p>Neste dispositivo: {bookCount(preview.current.count)}. Anos: {years(preview.current.years)}.</p>
        <p>Todos os livros, notas, avaliações, capas, ano e filtro da estante serão substituídos. Você pode exportar a biblioteca atual antes de continuar.</p>
        <div className="form-actions"><button className="button button-secondary" disabled={Boolean(busy)} onClick={() => void exportCurrent()}>Exportar biblioteca atual</button>
          <button className="button button-danger" disabled={Boolean(busy)} onClick={() => setConfirm(true)}>Substituir por {bookCount(preview.incoming.count)}</button></div>
      </>}
      <button className="button button-secondary" disabled={busy === 'restore' || busy === 'export'} onClick={cancel}>Cancelar importação</button>
    </div>}
    {message && <p role="status" className="local-note">{message}</p>}
    {error && <p role="alert" className="form-error">{error}</p>}
    {confirm && preview && <ConfirmDialog title="Substituir toda a biblioteca?" confirmLabel={`Substituir por ${bookCount(preview.incoming.count)}`}
      busy={busy === 'restore'} onCancel={() => setConfirm(false)} onConfirm={() => void restore()}>
      <p>A biblioteca atual ({bookCount(preview.current.count)}) será substituída pelo arquivo ({bookCount(preview.incoming.count)}), de todos os anos informados. Esta ação também substitui notas, avaliações, capas, ano e filtro da estante.</p>
      <p>Exporte a biblioteca atual antes de confirmar se quiser guardar uma cópia.</p>
    </ConfirmDialog>}
  </section>;
}
