import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, BookOpen } from 'lucide-react';
import { useLibrary } from '../../app/LibraryProvider';
import type { Book, NewBook } from '../../domain/book';
import { BookSearch, SelectedCover } from '../components/BookSearch';
import { formatShelfYear } from '../../domain/library';
import type { LocalRevision } from '../../ports/library-repository';
import { sameRevision } from '../../services/library-service';
import { BookForm, storageMessage } from '../components/BookForm';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { LibraryState } from '../components/LibraryState';

export function useReturnTo() {
  const destination = useLocation().state?.returnTo;
  return ['/estante', '/lendo', '/quero-ler'].includes(destination) ? destination as string : '/estante';
}
function BackLink({ returnTo }: { returnTo: string }) {
  return <Link className="back-link" to={returnTo}><ArrowLeft aria-hidden="true" />Voltar para a estante</Link>;
}
type LoadedBook = { book: Book | null; version: LocalRevision };
const labels = { read: 'Lido', reading: 'Lendo', 'want-to-read': 'Quero ler' };
const date = (value: string) => {
  const [year, month, day] = value.split('-');
  return `${day}/${month}/${year}`;
};

export function AddBookPage() {
  const { state, books, retry } = useLibrary();
  const [session, setSession] = useState<{ year: number; version: LocalRevision } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [draft, setDraft] = useState<NewBook | null>(null);
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const navigate = useNavigate();
  const returnTo = useReturnTo();
  useEffect(() => { document.title = 'Adicionar livro · Livro a Livro'; }, []);
  useEffect(() => {
    if (!session && state.status === 'ready') setSession({ year: state.preferences.shelfYear ?? new Date().getFullYear(), version: state.snapshot.version });
  }, [state, session]);
  return <section className="page-content"><BackLink returnTo={returnTo} />
    <p className="eyebrow">Uma leitura de cada vez</p><h1>Adicionar livro</h1>
    <p className="page-description">Guarde sua leitura. Você pode completar os detalhes depois.</p>
    {session && books ? draft === null ? <BookSearch onManual={() => { setDraft({ title: '' }); setCoverUrl(null); }}
      onSelect={(next, url) => { setDraft(next); setCoverUrl(url); }} /> : <>
      {draft.source && <p className="field-help">Confira os dados da Open Library antes de salvar. Páginas, ISBN e ano da sua edição podem ser preenchidos abaixo.</p>}
      {coverUrl && <SelectedCover key={coverUrl} url={coverUrl} title={draft.title} />}
      <BookForm key={attempt} initialDraft={draft} year={session.year} version={session.version} service={books}
      onSaved={(book) => navigate(`/livro/${book.id}`, { replace: true, state: { returnTo, saved: true } })}
      onCancel={() => { setDraft(null); setCoverUrl(null); }} onReload={() => { setSession(null); setAttempt((value) => value + 1); }} /></> :
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
        <div className="book-detail-heading"><div className="book-cover" aria-hidden="true"><BookOpen /><span>{book.title}</span></div>
          <div><p className="eyebrow">Estante {formatShelfYear(book.shelfYear)}</p><h1>{book.title}</h1><p>{book.authors.join(', ') || 'Autoria não informada'}</p>
            <span className={`reading-status reading-status--${book.status}`}>{labels[book.status]}</span></div>
        </div>
        {editing && books ? <>
          {observed && !sameRevision(observed, loaded.version) && <p role="status" className="form-error">A biblioteca mudou. Seu rascunho foi preservado; ao salvar, será necessário revisar a versão atual.</p>}
          <BookForm book={book} year={book.shelfYear} version={loaded.version} service={books}
            onSaved={(next, version) => { setLoaded({ book: next, version }); setEditing(false); setSaved(true); }} onCancel={() => setEditing(false)} onReload={reload} />
        </> : <>
          {saved && <p role="status" className="local-note">Livro salvo neste dispositivo.</p>}
          <dl className="book-facts">
            <div><dt>Terminei em</dt><dd>{book.finishedOn ? <time dateTime={book.finishedOn}>{date(book.finishedOn)}</time> : 'Data não informada'}</dd></div>
            {book.startedOn && <div><dt>Comecei em</dt><dd><time dateTime={book.startedOn}>{date(book.startedOn)}</time></dd></div>}
            <div><dt>Páginas</dt><dd>{book.pageCount?.toLocaleString('pt-BR') ?? 'Não informadas'}</dd></div>
            {book.publicationYear && <div><dt>Ano de publicação</dt><dd>{formatShelfYear(book.publicationYear)}</dd></div>}
            {book.isbn && <div><dt>ISBN</dt><dd>{book.isbn}</dd></div>}
            <div><dt>Minha avaliação</dt><dd>{book.rating ? <span className="book-rating" aria-label={`Avaliação: ${book.rating} de 5 estrelas`}><span aria-hidden="true">{'★'.repeat(book.rating)}{'☆'.repeat(5 - book.rating)}</span></span> : 'Sem avaliação'}</dd></div>
          </dl>
          <h2>Sua nota privada</h2><p className="private-note">{book.note || 'Nenhuma anotação ainda.'}</p>
          <p className="field-help">Só aparece neste dispositivo. Não entra na imagem compartilhada.</p>
          {error && <p role="alert" className="form-error">{error}</p>}
          <div className="form-actions"><button className="button button-primary" onClick={() => { setEditing(true); setSaved(false); setError(''); }}>Editar livro</button>
            <button className="button button-secondary" onClick={() => setRemoving(true)}>Remover livro</button></div>
        </>}
        {removing && <ConfirmDialog title={`Excluir ${book.title} desta estante?`} confirmLabel="Excluir livro" busy={busy} onCancel={() => setRemoving(false)} onConfirm={() => void remove()}>
          <p>O registro, sua avaliação e sua nota serão removidos deste dispositivo. Esta ação não pode ser desfeita pelo aplicativo.</p>
        </ConfirmDialog>}
      </>}
  </section>;
}
