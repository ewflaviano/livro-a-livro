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
import { BookForm } from '../components/BookForm';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { LibraryState } from '../components/LibraryState';
import { blockPwaUpdate } from '../../pwa/register';
import { useLocale } from '../../i18n/context';
import { formatNumber } from '../../i18n/locale';
import { DomainError } from '../../domain/errors';
import type { MessageKey } from '../../i18n/messages';

export function useReturnTo() {
  const destination = useLocation().state?.returnTo;
  return ['/estante', '/lendo', '/quero-ler', '/autores'].includes(destination) ? destination as string : '/estante';
}
function BackLink({ returnTo }: { returnTo: string }) {
  const { t } = useLocale();
  return <Link className="back-link" to={returnTo}><ArrowLeft aria-hidden="true" />{t(returnTo === '/autores' ? 'backToAuthors' : 'backToShelfBook')}</Link>;
}
type LoadedBook = { book: Book | null; version: LocalRevision };

export function AddBookPage() {
  const { t } = useLocale();
  const { state, books, retry, updatePreferences, setShelfQuery, positions } = useLibrary();
  const [session, setSession] = useState<{ year: number; version: LocalRevision } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [draft, setDraft] = useState<NewBook | null>(null);
  const [draftOrigin, setDraftOrigin] = useState<'search' | 'manual' | null>(null);
  const navigate = useNavigate();
  const returnTo = useReturnTo();
  useEffect(() => { document.title = `${t('addBook')} · ${t('appName')}`; }, [t]);
  useLayoutEffect(() => { if (draft) window.scrollTo(0, 0); }, [draft]);
  useEffect(() => {
    if (!session && state.status === 'ready') setSession({ year: state.preferences.shelfYear ?? new Date().getFullYear(), version: state.snapshot.version });
  }, [state, session]);
  return <section className="page-content"><BackLink returnTo={returnTo} />
    <h1>{t('addBook')}</h1>
    {session && books ? <><div hidden={draft !== null}><BookSearch active={draft === null} onManual={() => { setDraftOrigin('manual'); setDraft({ title: '' }); }}
      onSelect={(selected) => { setDraftOrigin('search'); setDraft(selected); }} /></div>{draft && <>
      {draft.cover && <BookCover cover={draft.cover} title={draft.title} className="selected-cover" />}
      <BookForm key={attempt} initialDraft={draft} year={session.year} version={session.version} service={books} cancelLabel={draftOrigin === 'search' ? t('chooseAnotherBook') : t('cancel')}
      onSaved={(book) => { updatePreferences({ shelfYear: book.shelfYear, filter: 'all' }); setShelfQuery(''); positions.set('/estante', 0); navigate('/estante', { replace: true }); }}
      onCancel={() => { setDraft(null); setDraftOrigin(null); window.scrollTo(0, 0); }} onReload={() => { setSession(null); setAttempt((value) => value + 1); }} /></>}</> :
      <LibraryState state={state.status === 'error' ? 'error' : 'loading'} onRetry={retry} />}
  </section>;
}

export function BookPage() {
  const { id } = useParams();
  return <BookDetail key={id} id={id ?? ''} />;
}
function BookDetail({ id }: { id: string }) {
  const { t, locale } = useLocale();
  const labels = { read: t('readSingular'), reading: t('reading'), 'want-to-read': t('wantToRead') };
  const { books, state, retry } = useLibrary();
  const [loaded, setLoaded] = useState<LoadedBook | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [completion, setCompletion] = useState<{ book: Book; version: LocalRevision } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<MessageKey | null>(null);
  const [saved, setSaved] = useState(Boolean(useLocation().state?.saved));
  const editButton = useRef<HTMLButtonElement>(null);
  const completingWrite = useRef(false);
  useEffect(() => { if (busy || removing || completion) return blockPwaUpdate(); }, [busy, removing, completion]);
  const navigate = useNavigate();
  const returnTo = useReturnTo();
  const observed = state.status === 'ready' ? state.snapshot.version : null;
  const revision = observed ? `${observed.generation}/${observed.revision}` : '';
  useEffect(() => { document.title = `${t('book')} · ${t('appName')}`; }, [t]);
  useEffect(() => {
    if (!books || editing || removing) return;
    let active = true;
    setLoadError(false);
    void books.readBook(id).then((result) => { if (active) setLoaded(result); })
      .catch(() => { if (active) setLoadError(true); });
    return () => { active = false; };
  }, [books, id, editing, removing, attempt, revision]);
  const reload = () => { setEditing(false); setLoaded(null); setError(null); setSaved(false); setAttempt((value) => value + 1); };
  async function remove() {
    if (!books || !loaded || busy) return;
    setBusy(true); setError(null);
    try { await books.remove(id, loaded.version); navigate(returnTo, { replace: true }); }
    catch (failure) { setError(failure instanceof DomainError && failure.code === 'StaleRevision' ? 'removeBookStale' :
      failure instanceof DomainError && failure.code === 'QuotaExceeded' ? 'removeBookQuota' : 'removeBookGeneric'); setRemoving(false); }
    finally { setBusy(false); }
  }
  async function completeReading() {
    if (!books || !completion || completingWrite.current) return;
    completingWrite.current = true; setBusy(true); setError(null);
    try {
      const result = await books.completeReading(completion.book.id, completion.version);
      setLoaded(result); setSaved(true); setCompletion(null);
    } catch (failure) {
      setError(failure instanceof DomainError && failure.code === 'StaleRevision' ? 'completeBookStale' :
        failure instanceof DomainError && failure.code === 'QuotaExceeded' ? 'completeBookQuota' : 'completeBookGeneric');
      setCompletion(null);
    } finally { completingWrite.current = false; setBusy(false); }
  }
  const book = loaded?.book;
  return <section className="page-content"><BackLink returnTo={returnTo} />
    {!loaded || loadError ? <><h1>{t('book')}</h1><LibraryState state={loadError || state.status === 'error' ? 'error' : 'loading'} onRetry={() => { if (!books) retry(); else setAttempt((value) => value + 1); }} /></> :
      !book ? <><h1>{t('bookNotFound')}</h1><p>{t('bookNotFoundExplanation')}</p></> : <>
        <div className="book-detail-heading"><BookCover cover={book.cover} title={book.title} />
          <div><p className="eyebrow">{t('shelfOfYear', { year: formatShelfYear(book.shelfYear) })}</p><h1>{book.title}</h1><p>{book.authors.join(', ') || t('authorUnknown')}</p>
            <span className={`reading-status reading-status--${book.status}`}>{labels[book.status]}</span>
            {!editing && <div className={`book-detail-actions${book.status === 'reading' ? ' book-detail-actions--reading' : ''}`}>
              {book.status === 'reading' && <button className="button button-primary" disabled={busy} onClick={() => {
                setCompletion({ book, version: loaded.version }); setSaved(false); setError(null);
              }}>{t('markAsRead')}</button>}
              <button ref={editButton} className={`button button-${book.status === 'reading' ? 'secondary' : 'primary'}`} disabled={busy}
                onClick={() => { setEditing(true); setSaved(false); setError(null); }}>{t('editBook')}</button>
              <details className="book-options"><summary className="button button-secondary" onKeyDown={(event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return;
                event.preventDefault();
                const menu = event.currentTarget.parentElement as HTMLDetailsElement;
                menu.open = !menu.open;
              }}>{t('bookOptions')}</summary>
                <div className="book-options-menu"><button className="button button-danger" onClick={() => setRemoving(true)}>{t('removeBook')}</button></div>
              </details></div>}
          </div>
        </div>
        {editing && books ? <>
          {observed && !sameRevision(observed, loaded.version) && <p role="status" className="form-error">{t('libraryChangedDraft')}</p>}
          <BookForm book={book} year={book.shelfYear} version={loaded.version} service={books}
            onSaved={(next, version) => { setLoaded({ book: next, version }); setEditing(false); setSaved(true); }} onCancel={() => { setEditing(false); queueMicrotask(() => editButton.current?.focus()); }} onReload={reload} />
        </> : <>
          {saved && <p role="status" className="local-note">{t('bookSavedHere')}</p>}
          {(book.pageCount != null || book.publicationYear || book.isbn || book.rating) && <dl className="book-facts">
            {book.pageCount != null && <div><dt>{t('pages')}</dt><dd>{formatNumber(locale, book.pageCount)}</dd></div>}
            {book.publicationYear && <div><dt>{t('publicationYear')}</dt><dd>{formatShelfYear(book.publicationYear)}</dd></div>}
            {book.isbn && <div><dt>ISBN</dt><dd>{book.isbn}</dd></div>}
            {book.rating && <div><dt>{t('myRating')}</dt><dd><span className="book-rating" aria-label={t('ratingOutOfFive', { rating: book.rating })}><span aria-hidden="true">{'★'.repeat(book.rating)}{'☆'.repeat(5 - book.rating)}</span></span></dd></div>}
          </dl>}
          {book.note?.trim() && <><h2>{t('notes')}</h2><p className="private-note">{book.note}</p></>}
          {error && <div role="alert" className="form-error"><p>{t(error)}</p>
            {error === 'completeBookStale' && <button className="button button-secondary" onClick={reload}>{t('reloadSaved')}</button>}
          </div>}
        </>}
        {completion && <ConfirmDialog title={t('completeBookQuestion', { title: completion.book.title, year: formatShelfYear(completion.book.shelfYear) })}
          confirmLabel={t('markAsRead')} variant="primary" busy={busy} returnFocus={editButton}
          onCancel={() => setCompletion(null)} onConfirm={() => void completeReading()}>
          <p>{t('completeBookExplanation')}</p>
        </ConfirmDialog>}
        {removing && <ConfirmDialog title={t('removeBookQuestion', { title: book.title })} confirmLabel={t('deleteBook')} busy={busy} onCancel={() => setRemoving(false)} onConfirm={() => void remove()}>
          <p>{t('removeBookExplanation')}</p>
        </ConfirmDialog>}
      </>}
  </section>;
}
