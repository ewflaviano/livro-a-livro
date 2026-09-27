import { useEffect, useRef, useState, type FormEvent } from 'react';
import { BOOK_LIMITS, type Book, type NewBook, type ReadingStatus } from '../../domain/book';
import { DomainError } from '../../domain/errors';
import type { LocalRevision } from '../../ports/library-repository';
import type { LibraryService } from '../../services/library-service';
import { ConfirmDialog } from './ConfirmDialog';
import { blockPwaUpdate } from '../../pwa/register';
import { prepareCover, type CoverMedia } from '../../media/cover';

const messages: Record<string, string> = {
  title: 'Informe um título com até 500 caracteres.',
  authors: 'Informe até 20 autores distintos, um por linha, com até 200 caracteres cada.',
  shelfYear: 'Use um ano de 1 a 9999, igual ao ano da data de término quando informada.',
  pageCount: 'Informe um número inteiro de páginas entre 1 e 1.000.000.',
  isbn: 'Confira o ISBN de 10 ou 13 caracteres, ou deixe o campo vazio.',
  publicationYear: 'Informe um ano de publicação de 1 a 9999, ou deixe vazio.',
  startedOn: 'Confira a data de início. Quero ler não pode ter datas.',
  finishedOn: 'Confira a data de término: apenas Lido, após o início e no ano da estante.',
  note: 'A nota pode ter até 20.000 caracteres.',
};

export function storageMessage(error: unknown): string {
  if (error instanceof DomainError) {
    if (error.code === 'StaleRevision') return 'Sua biblioteca mudou em outra aba ou operação. Seu rascunho continua aqui. Recarregue a versão salva para revisar antes de tentar novamente.';
    if (error.code === 'QuotaExceeded') return 'O dispositivo está sem espaço para salvar. Seu rascunho continua aqui. Libere espaço e tente novamente.';
    if (error.code === 'ImportTooLarge') return 'Esta biblioteca atingiu o limite de armazenamento do aplicativo. Seu rascunho continua aqui.';
  }
  return 'Não foi possível salvar neste dispositivo. Seu rascunho continua aqui. Tente novamente.';
}

function makeDraft(book: NewBook | undefined, year: number) {
  return { title: book?.title ?? '', authors: book?.authors?.join('\n') ?? '',
    status: book?.status ?? 'want-to-read' as ReadingStatus, shelfYear: String(book?.shelfYear ?? year),
    pageCount: book?.pageCount?.toString() ?? '', isbn: book?.isbn ?? '',
    publicationYear: book?.publicationYear?.toString() ?? '', startedOn: book?.startedOn ?? '',
    finishedOn: book?.finishedOn ?? '', rating: book?.rating?.toString() ?? '', note: book?.note ?? '' };
}

export function BookForm({ book, initialDraft, year, version, service, onSaved, onCancel, onReload }: {
  book?: Book; initialDraft?: NewBook; year: number; version: LocalRevision; service: LibraryService;
  onSaved: (book: Book, version: LocalRevision) => void; onCancel: () => void; onReload: () => void;
}) {
  const [initial] = useState(() => makeDraft(book ?? initialDraft, year));
  const [draft, setDraft] = useState(initial);
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const [error, setError] = useState('');
  const [invalid, setInvalid] = useState<string[]>([]);
  const [duplicates, setDuplicates] = useState(0);
  const [dialog, setDialog] = useState<'cancel' | 'reload' | null>(null);
  const [conflict, setConflict] = useState(false);
  const [localCover, setLocalCover] = useState<CoverMedia | null>(null);
  const [coverPreparing, setCoverPreparing] = useState(false);
  const coverSelection = useRef(0);
  useEffect(() => () => { coverSelection.current++; }, []);
  const form = useRef<HTMLFormElement>(null);
  const dirty = coverPreparing || localCover !== null || JSON.stringify(initial) !== JSON.stringify(draft);
  useEffect(() => { if (dirty || busy) return blockPwaUpdate(); }, [dirty, busy]);
  useEffect(() => { form.current?.querySelector('input')?.focus(); }, []);
  useEffect(() => {
    if (busy || invalid.length === 0) return;
    if (invalid.some((field) => ['pageCount', 'isbn', 'publicationYear', 'note', 'rating'].includes(field))) {
      const details = form.current?.querySelector('details');
      if (details) details.open = true;
    }
    const first = form.current?.querySelector<HTMLElement>(`[name="${invalid[0]}"]`);
    if (first instanceof HTMLElement) first.focus();
  }, [invalid, busy]);
  useEffect(() => {
    if (!dirty) return;
    const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    const guardLink = (event: MouseEvent) => {
      const link = (event.target as Element).closest('a');
      if (!link || link.classList.contains('skip-link') || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      if (saving.current) { event.preventDefault(); event.stopPropagation(); return; }
      if (!window.confirm('Descartar as alterações não salvas e sair?')) { event.preventDefault(); event.stopPropagation(); }
    };
    window.addEventListener('beforeunload', guard);
    document.addEventListener('click', guardLink, true);
    return () => { window.removeEventListener('beforeunload', guard); document.removeEventListener('click', guardLink, true); };
  }, [dirty]);
  const change = (name: keyof typeof draft, value: string) => {
    setDraft((previous) => ({ ...previous, [name]: value }));
    setDuplicates(0); setInvalid([]); setError('');
  };
  async function save(allowDuplicate = false) {
    if (saving.current || coverPreparing) return;
    saving.current = true; setBusy(true); setError(''); setInvalid([]);
    const numberOrNull = (value: string) => value === '' ? null : Number(value);
    const input: NewBook = { title: draft.title, authors: draft.authors.split('\n').filter((author) => author.trim().length > 0),
      status: draft.status, shelfYear: Number(draft.shelfYear), pageCount: numberOrNull(draft.pageCount),
      isbn: draft.isbn || null, publicationYear: numberOrNull(draft.publicationYear),
      startedOn: draft.startedOn || null, finishedOn: draft.finishedOn || null,
      rating: numberOrNull(draft.rating) as Book['rating'], note: draft.note,
      ...(initialDraft ? { cover: initialDraft.cover, source: initialDraft.source } : book ? { cover: book.cover, source: book.source } : {}) };
    try {
      if (localCover) {
        input.cover = { provider: 'local', mediaId: localCover.id };
      }
      const result = await service.save({ draft: input, id: book?.id, year, expected: version, allowDuplicate, coverMedia: localCover ?? undefined });
      if (result.kind === 'duplicate') setDuplicates(result.count);
      else onSaved(result.book, result.version);
    } catch (failure) {
      if (failure instanceof DomainError && failure.code === 'InvalidBook') {
        const fields = [...new Set(failure.issues.map((issue) => String(issue.path[0])))];
        setInvalid(fields); setError('Revise os campos indicados. Nenhuma alteração foi salva.');
      } else { setError(storageMessage(failure)); setConflict(failure instanceof DomainError && failure.code === 'StaleRevision'); }
    } finally { saving.current = false; setBusy(false); }
  }
  // Referenced by aria-describedby; excluded from the enclosing label's name.
  const fieldError = (name: string) => invalid.includes(name) ? <span className="field-error" aria-hidden="true" id={`${name}-error`}>{messages[name]}</span> : null;
  const attributes = (name: string) => ({ name, id: `book-${name}`, 'aria-invalid': invalid.includes(name),
    'aria-describedby': invalid.includes(name) ? `${name}-error` : undefined });
  const numberField = (name: 'shelfYear' | 'pageCount' | 'publicationYear', label: string, required = false) =>
    <label className="form-field">{label}<input {...attributes(name)} type="number" min="1" max={name === 'pageCount' ? BOOK_LIMITS.pageCount : 9999}
      step="1" required={required} value={draft[name]} onChange={(event) => change(name, event.target.value)} />{fieldError(name)}</label>;
  return <>
    <form className="book-form" ref={form} noValidate onSubmit={(event: FormEvent) => { event.preventDefault(); void save(); }} aria-busy={busy || coverPreparing}>
      <p className="local-note" role="status">{coverPreparing ? 'Preparando capa…' : busy ? 'Salvando…' : dirty ? 'Alterações não salvas' : book ? 'Salvo neste dispositivo' : 'Somente o título é obrigatório; estado e ano já estão preenchidos.'}</p>
      <fieldset disabled={busy}>
        <legend className="visually-hidden">Registro do livro</legend>
        <label className="form-field">Título (obrigatório)<input {...attributes('title')} required maxLength={BOOK_LIMITS.title} value={draft.title} onChange={(event) => change('title', event.target.value)} />{fieldError('title')}</label>
        <label className="form-field">Autores (opcional, um por linha)<textarea {...attributes('authors')} rows={2} value={draft.authors} onChange={(event) => change('authors', event.target.value)} />{fieldError('authors')}</label>
        <label className="form-field">Capa (opcional)<input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => {
          const element = event.currentTarget; const file = element.files?.[0]; if (!file) return;
          const selected = ++coverSelection.current; setCoverPreparing(true); setError('');
          void prepareCover(file, new Date().toISOString()).then(value => {
            if (selected !== coverSelection.current) return;
            setLocalCover(value); setDuplicates(0);
          }).catch(() => {
            if (selected !== coverSelection.current) return;
            setError('Use uma imagem JPEG, PNG ou WebP de até 2 MB e 2400 × 3600 pixels.'); element.value = '';
          }).finally(() => { if (selected === coverSelection.current) setCoverPreparing(false); });
        }} /><span className="field-help">A imagem fica neste dispositivo. Ao sincronizar, vai diretamente ao seu Google Drive.</span>{localCover && <span className="field-help">Capa pronta para salvar: {localCover.width} × {localCover.height} pixels.</span>}</label>
        <div className="form-columns">
          <label className="form-field">Estado<select name="status" value={draft.status} onChange={(event) => change('status', event.target.value)}>
            <option value="want-to-read">Quero ler</option><option value="reading">Lendo</option><option value="read">Lido</option>
          </select></label>{numberField('shelfYear', 'Ano da estante', true)}
        </div>
        {(draft.status !== 'want-to-read' || draft.startedOn || draft.finishedOn) && <div className="form-columns">
          <label className="form-field">Comecei em (opcional)<input {...attributes('startedOn')} type="date" value={draft.startedOn} onChange={(event) => change('startedOn', event.target.value)} />{fieldError('startedOn')}</label>
          {(draft.status === 'read' || draft.finishedOn) && <label className="form-field">Terminei em (opcional)<input {...attributes('finishedOn')} type="date" value={draft.finishedOn} onChange={(event) => change('finishedOn', event.target.value)} />{fieldError('finishedOn')}</label>}
        </div>}
        {(draft.startedOn && draft.status === 'want-to-read' || draft.finishedOn && draft.status !== 'read') &&
          <p className="field-error">O novo estado não permite essas datas. Revise os campos e apague as datas incompatíveis para continuar.</p>}
        {draft.finishedOn && <p className="field-help">O término deve estar no ano da estante. Você pode ajustar o ano acima ou corrigir a data.</p>}
        <details open={Boolean(book)}><summary>Mais detalhes (opcional)</summary>
          <div className="form-columns">{numberField('pageCount', 'Páginas')}{numberField('publicationYear', 'Ano de publicação')}</div>
          <label className="form-field">ISBN<input {...attributes('isbn')} value={draft.isbn} onChange={(event) => change('isbn', event.target.value)} />{fieldError('isbn')}</label>
          <fieldset className="rating-field"><legend>Minha avaliação</legend><div className="rating-options">
            <label><input type="radio" name="rating" value="" checked={draft.rating === ''} onChange={() => change('rating', '')} />Sem avaliação</label>
            {[1, 2, 3, 4, 5].map((rating) => <label key={rating}><input type="radio" name="rating" value={rating} checked={draft.rating === String(rating)} onChange={() => change('rating', String(rating))} />
              <span aria-hidden="true">{'★'.repeat(rating)}</span><span className="visually-hidden">{rating} de 5 estrelas</span></label>)}
          </div></fieldset>
          <label className="form-field">Sua nota privada<textarea {...attributes('note')} aria-describedby={invalid.includes('note') ? 'note-help note-error' : 'note-help'} rows={6} maxLength={BOOK_LIMITS.note} value={draft.note} onChange={(event) => change('note', event.target.value)} />{fieldError('note')}</label>
          <p className="field-help" id="note-help">Sua nota é privada e acompanha o backup. Não entra na imagem compartilhada.</p>
        </details>
      </fieldset>
      {error && <p className="form-error" role="alert">{error}</p>}
      {conflict && <button type="button" className="button button-secondary" disabled={busy} onClick={() => setDialog('reload')}>Recarregar versão salva</button>}
      {duplicates > 0 && <div className="notice-panel" role="status"><p>Já existe um registro parecido nesta estante. Pode ser uma releitura; você pode revisar ou salvar mesmo assim.</p>
        <button type="button" className="button button-secondary" disabled={busy || coverPreparing} onClick={() => void save(true)}>Salvar mesmo assim</button></div>}
      <div className="form-actions"><button className="button button-primary" type="submit" disabled={busy || coverPreparing}>{busy ? 'Salvando…' : book ? 'Salvar alterações' : 'Salvar livro'}</button>
        <button className="button button-secondary" type="button" disabled={busy} onClick={() => dirty ? setDialog('cancel') : onCancel()}>Cancelar</button></div>
    </form>
    {dialog && <ConfirmDialog title={dialog === 'reload' ? 'Recarregar a versão salva?' : 'Descartar as alterações?'}
      confirmLabel={dialog === 'reload' ? 'Descartar rascunho e recarregar' : 'Descartar alterações'} onCancel={() => setDialog(null)}
      onConfirm={() => { if (dialog === 'reload') onReload(); else onCancel(); }}>
      <p>Seu rascunho não salvo será descartado. Os registros já salvos continuam no dispositivo.</p>
    </ConfirmDialog>}
  </>;
}
