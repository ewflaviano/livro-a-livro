import { BookCover } from '../components/BookCover';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useLibrary } from '../../app/LibraryProvider';
import type { Book, NewBook } from '../../domain/book';
import { BookSearch } from '../components/BookSearch';
import { formatShelfYear } from '../../domain/library';
import type { LocalRevision } from '../../ports/library-repository';
import { sameRevision } from '../../services/library-service';
import { BookForm, storageMessage } from '../components/BookForm';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { LibraryState } from '../components/LibraryState';
import { blockPwaUpdate } from '../../pwa/register';

export function useReturnTo() {
  const destination = useLocation().state?.returnTo;
  return ['/estante', '/lendo', '/quero-ler'].includes(destination) ? destination as string : '/estante';
}
function BackLink({ returnTo }: { returnTo: string }) {
  return <Link className="back-link" to={returnTo}><ArrowLeft aria-hidden="true" />Voltar para a estante</Link>;
}
type LoadedBook = { book: Book | null; version: LocalRevision };
const labels = { read: 'Lido', reading: 'Lendo', 'want-to-read': 'Quero ler' };

export function AddBookPage() {
  const { state, books, retry, updatePreferences, setShelfQuery, positions } = useLibrary();
  const [session, setSession] = useState<{ year: number; version: LocalRevision } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [draft, setDraft] = useState<NewBook | null>(null);
  const navigate = useNavigate();
  const returnTo = useReturnTo();
  useEffect(() => { document.title = 'Adicionar livro · Livro a Livro'; }, []);
  useLayoutEffect(() => { if (draft) window.scrollTo(0, 0); }, [draft]);
  useEffect(() => {
    if (!session && state.status === 'ready') setSession({ year: state.preferences.shelfYear ?? new Date().getFullYear(), version: state.snapshot.version });
  }, [state, session]);
  return <section className="page-content"><BackLink returnTo={returnTo} />
    <h1>Adicionar livro</h1>
    {session && books ? draft === null ? <BookSearch onManual={() => setDraft({ title: '' })}
      onSelect={setDraft} /> : <>
      {draft.cover && <BookCover cover={draft.cover} title={draft.title} className="selected-cover" />}
      <BookForm key={attempt} initialDraft={draft} year={session.year} version={session.version} service={books}
      onSaved={(book) => { updatePreferences({ shelfYear: book.shelfYear, filter: 'all' }); setShelfQuery(''); positions.set('/estante', 0); navigate('/estante', { replace: true }); }}
      onCancel={() => { setDraft(null); window.scrollTo(0, 0); }} onReload={() => { setSession(null); setAttempt((value) => value + 1); }} /></> :
      <LibraryState state={state.status === 'error' ? 'error' : 'loading'} onRetry={retry} />}
  </section>;
}

export function BookPage() {
  const { id } = useParams();
  return <BookDetail key={id} id={id ?? ''} />;
}
function BookDetail({ id }: { id: string }) {
  const { books, state, retry } = useLibrary();
  const [loaded, setLoaded] = useState<LoadedBook | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(Boolean(useLocation().state?.saved));
  const editButton = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (busy || removing) return blockPwaUpdate(); }, [busy, removing]);
  const navigate = useNavigate();
  const returnTo = useReturnTo();
  const observed = state.status === 'ready' ? state.snapshot.version : null;
  const revision = observed ? `${observed.generation}/${observed.revision}` : '';
  useEffect(() => { document.title = 'Livro · Livro a Livro'; }, []);
  useEffect(() => {
    if (!books || editing || removing) return;
    let active = true;
    setLoadError(false);
    void books.readBook(id).then((result) => { if (active) setLoaded(result); })
      .catch(() => { if (active) setLoadError(true); });
    return () => { active = false; };
  }, [books, id, editing, removing, attempt, revision]);
  const reload = () => { setEditing(false); setLoaded(null); setError(''); setSaved(false); setAttempt((value) => value + 1); };
  async function remove() {
    if (!books || !loaded || busy) return;
    setBusy(true); setError('');
    try { await books.remove(id, loaded.version); navigate(returnTo, { replace: true }); }
    catch (failure) { setError(storageMessage(failure).replace('Seu rascunho continua aqui.', 'O registro não foi excluído.')); setRemoving(false); }
    finally { setBusy(false); }
  }
  const book = loaded?.book;
  return <section className="page-content"><BackLink returnTo={returnTo} />
    {!loaded || loadError ? <><h1>Livro</h1><LibraryState state={loadError || state.status === 'error' ? 'error' : 'loading'} onRetry={() => { if (!books) retry(); else setAttempt((value) => value + 1); }} /></> :
      !book ? <><h1>Livro não encontrado</h1><p>Este registro não está mais nesta biblioteca. Volte à estante para continuar.</p></> : <>
        <div className="book-detail-heading"><BookCover cover={book.cover} title={book.title} />
          <div><p className="eyebrow">Estante {formatShelfYear(book.shelfYear)}</p><h1>{book.title}</h1><p>{book.authors.join(', ') || 'Autoria não informada'}</p>
            <span className={`reading-status reading-status--${book.status}`}>{labels[book.status]}</span>
            {!editing && <div className="book-detail-actions"><button ref={editButton} className="button button-primary" onClick={() => { setEditing(true); setSaved(false); setError(''); }}>Editar livro</button>
              <details className="book-options"><summary className="button button-secondary" onKeyDown={(event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return;
                event.preventDefault();
                const menu = event.currentTarget.parentElement as HTMLDetailsElement;
                menu.open = !menu.open;
              }}>Opções do livro</summary>
                <div className="book-options-menu"><button className="button button-danger" onClick={() => setRemoving(true)}>Remover livro</button></div>
              </details></div>}
          </div>
        </div>
        {editing && books ? <>
          {observed && !sameRevision(observed, loaded.version) && <p role="status" className="form-error">A biblioteca mudou. Seu rascunho foi preservado; ao salvar, será necessário revisar a versão atual.</p>}
          <BookForm book={book} year={book.shelfYear} version={loaded.version} service={books}
            onSaved={(next, version) => { setLoaded({ book: next, version }); setEditing(false); setSaved(true); }} onCancel={() => { setEditing(false); queueMicrotask(() => editButton.current?.focus()); }} onReload={reload} />
        </> : <>
          {saved && <p role="status" className="local-note">Livro salvo neste dispositivo.</p>}
          {(book.pageCount != null || book.publicationYear || book.isbn || book.rating) && <dl className="book-facts">
            {book.pageCount != null && <div><dt>Páginas</dt><dd>{book.pageCount.toLocaleString('pt-BR')}</dd></div>}
            {book.publicationYear && <div><dt>Ano de publicação</dt><dd>{formatShelfYear(book.publicationYear)}</dd></div>}
            {book.isbn && <div><dt>ISBN</dt><dd>{book.isbn}</dd></div>}
            {book.rating && <div><dt>Minha avaliação</dt><dd><span className="book-rating" aria-label={`Avaliação: ${book.rating} de 5 estrelas`}><span aria-hidden="true">{'★'.repeat(book.rating)}{'☆'.repeat(5 - book.rating)}</span></span></dd></div>}
          </dl>}
          {book.note?.trim() && <><h2>Observações</h2><p className="private-note">{book.note}</p></>}
          {error && <p role="alert" className="form-error">{error}</p>}
        </>}
        {removing && <ConfirmDialog title={`Excluir ${book.title} desta estante?`} confirmLabel="Excluir livro" busy={busy} onCancel={() => setRemoving(false)} onConfirm={() => void remove()}>
          <p>O registro, sua avaliação e sua nota serão removidos deste dispositivo. Esta ação não pode ser desfeita pelo aplicativo.</p>
        </ConfirmDialog>}
      </>}
  </section>;
}
