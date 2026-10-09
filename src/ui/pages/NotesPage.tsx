import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Search } from 'lucide-react';
import { useLibrary } from '../../app/LibraryProvider';
import { booksWithNotes, matchesNote, matchingNoteExcerpt } from '../../domain/notes';
import { formatShelfYear } from '../../domain/library';
import { formatNumber } from '../../i18n/locale';
import { useLocale } from '../../i18n/context';
import { LibraryState } from '../components/LibraryState';

const pageSize = 24;

export function NotesPage() {
  const { t, locale } = useLocale();
  const { state, retry, notesView, setNotesView, positions } = useLibrary();
  const notedBooks = useMemo(() => booksWithNotes(state.status === 'ready' ? state.snapshot.books : [], locale), [state, locale]);
  const matches = useMemo(() => notedBooks.filter(book => matchesNote(book, notesView.query)), [notedBooks, notesView.query]);
  const totalPages = Math.max(1, Math.ceil(matches.length / pageSize));
  const page = Math.min(notesView.page, totalPages);
  const pageBooks = matches.slice((page - 1) * pageSize, page * pageSize);
  const list = useRef<HTMLOListElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const pageNavigation = useRef(false);
  const returnOnEntry = useRef(notesView.returnBookId);
  const restoredOnEntry = useRef(false);
  const statuses = { read: t('readSingular'), reading: t('reading'), 'want-to-read': t('wantToRead') };

  useEffect(() => { document.title = `${t('notesNotebook')} · ${t('appName')}`; }, [t]);
  useEffect(() => {
    if (notesView.page > totalPages) setNotesView(view => ({ ...view, page: totalPages }));
  }, [notesView.page, totalPages, setNotesView]);
  useLayoutEffect(() => {
    if (!pageNavigation.current) return;
    pageNavigation.current = false;
    list.current?.querySelector<HTMLAnchorElement>('.note-book-link')?.focus();
    list.current?.scrollIntoView?.({ block: 'start' });
  }, [page]);
  useEffect(() => {
    if (state.status !== 'ready' || restoredOnEntry.current) return;
    restoredOnEntry.current = true;
    const id = returnOnEntry.current;
    if (!id) { window.scrollTo(0, 0); return; }
    const timer = window.setTimeout(() => {
      const target = [...document.querySelectorAll<HTMLAnchorElement>('.note-book-link')]
        .find(link => link.dataset.bookId === id);
      target?.focus({ preventScroll: true });
      window.scrollTo(0, positions.get('/notas') ?? 0);
      setNotesView(view => ({ ...view, returnBookId: null }));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [state.status, positions, setNotesView]);

  return <section className="page-content notes-page" aria-labelledby="notes-title">
    <Link className="back-link" to="/estante"><ArrowLeft aria-hidden="true" />{t('backToShelf')}</Link>
    <h1 id="notes-title">{t('notesNotebook')}</h1>
    {state.status !== 'ready' ? <LibraryState state={state.status} onRetry={retry} /> : state.snapshot.books.length === 0 ?
      <div className="notice-panel notes-empty"><h2>{t('notesLibraryEmpty')}</h2><p>{t('notesLibraryEmptyHelp')}</p><Link className="button button-primary" to="/adicionar" state={{ returnTo: '/notas', focusNote: true }}>{t('addBook')}</Link></div> : notedBooks.length === 0 ?
      <div className="notice-panel notes-empty"><h2>{t('notesEmpty')}</h2><p>{t('notesEmptyHelp')}</p></div> : <>
        <p className="notes-intro">{t('notesIntro')}</p>
        <label className="notes-search">{t('searchNotes')}
          <span><Search aria-hidden="true" /><input ref={searchInput} type="search" value={notesView.query} maxLength={200}
            onChange={event => setNotesView(view => ({ ...view, query: event.target.value, page: 1, returnBookId: null }))} /></span>
        </label>
        <p className="notes-count">{t(matches.length === 1 ? 'notesResultOne' : 'notesResults', { count: formatNumber(locale, matches.length) })}</p>
        {matches.length === 0 ? <div className="notice-panel"><h2>{t('notesNoMatches')}</h2><p>{t('notesTryAnother')}</p><button className="button button-secondary" onClick={() => { setNotesView(view => ({ ...view, query: '', page: 1 })); searchInput.current?.focus(); }}>{t('clearSearch')}</button></div> : <>
          <ol ref={list} className="note-books" aria-label={t('notesList')} start={(page - 1) * pageSize + 1}>
            {pageBooks.map(book => <li className="note-book" key={book.id}>
              <p className="note-book-meta">{t('authorBookMeta', { year: formatShelfYear(book.shelfYear), status: statuses[book.status] })}</p>
              <h2>{book.title}</h2>
              <p className="note-book-author">{book.authors.join(', ') || t('authorUnknown')}</p>
              <p className={`note-book-excerpt${notesView.query.trim() ? ' note-book-excerpt-search' : ''}`}>{matchingNoteExcerpt(book.note, notesView.query)}</p>
              <Link className="note-book-link" data-book-id={book.id} to={`/livro/${book.id}`} state={{ returnTo: '/notas', focusNote: true }}
                aria-label={t('openBookNoteNamed', { title: book.title, year: formatShelfYear(book.shelfYear) })}
                onClick={() => { positions.set('/notas', window.scrollY); setNotesView(view => ({ ...view, returnBookId: book.id })); }}>
                {t('openBookNote')}
              </Link>
            </li>)}
          </ol>
          {totalPages > 1 && <nav className="shelf-pagination" aria-label={t('notesPages')}>
            <button className="button button-secondary" disabled={page === 1} onClick={() => { pageNavigation.current = true; setNotesView(view => ({ ...view, page: page - 1 })); }}>{t('previous')}</button>
            <span aria-live="polite">{t('pageOf', { page, total: totalPages })}</span>
            <button className="button button-secondary" disabled={page === totalPages} onClick={() => { pageNavigation.current = true; setNotesView(view => ({ ...view, page: page + 1 })); }}>{t('next')}</button>
          </nav>}
        </>}
      </>}
  </section>;
}
