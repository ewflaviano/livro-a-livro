import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ChevronDown, Search } from 'lucide-react';
import { useLibrary } from '../../app/LibraryProvider';
import { authorSearchText, groupBooksByAuthor } from '../../domain/authors';
import { formatShelfYear } from '../../domain/library';
import { formatNumber } from '../../i18n/locale';
import { useLocale } from '../../i18n/context';
import type { LocalRevision } from '../../ports/library-repository';
import { sameRevision } from '../../services/library-service';
import { LibraryState } from '../components/LibraryState';

const pageSize = 24;

export function AuthorsPage() {
  const { t, locale } = useLocale();
  const { state, retry, books, authorsView, setAuthorsView, positions } = useLibrary();
  const groups = useMemo(() => groupBooksByAuthor(state.status === 'ready' ? state.snapshot.books : [], locale), [state, locale]);
  const query = authorSearchText(authorsView.query);
  const matches = useMemo(() => query ? groups.filter(group => group.searchKey.includes(query)) : groups, [groups, query]);
  const totalPages = Math.max(1, Math.ceil(matches.length / pageSize));
  const page = Math.min(authorsView.page, totalPages);
  const pageGroups = matches.slice((page - 1) * pageSize, page * pageSize);
  const expanded = pageGroups.find(group => group.key === authorsView.expanded);
  const bookPages = expanded ? Math.max(1, Math.ceil(expanded.books.length / pageSize)) : 1;
  const bookPage = Math.min(authorsView.bookPage, bookPages);
  const authorPageNavigation = useRef(false);
  const bookPageNavigation = useRef(false);
  const returnOnEntry = useRef(authorsView.returnBookId);
  const restoredOnEntry = useRef(false);
  const relocatedOnEntry = useRef(false);
  const list = useRef<HTMLOListElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const [listChanged, setListChanged] = useState(false);
  const [returnRevision, setReturnRevision] = useState<LocalRevision | 'failed' | null>(null);
  const statuses = { read: t('readSingular'), reading: t('reading'), 'want-to-read': t('wantToRead') };
  const clearSearch = () => {
    setAuthorsView(view => ({ ...view, query: '', page: 1, expanded: null, bookPage: 1, returnBookId: null }));
    searchInput.current?.focus();
  };

  useEffect(() => { document.title = `${t('authors')} · ${t('appName')}`; }, [t]);
  useEffect(() => {
    if (authorsView.page > totalPages || authorsView.bookPage > bookPages) {
      setAuthorsView(view => ({ ...view, page: Math.min(view.page, totalPages), bookPage: Math.min(view.bookPage, bookPages) }));
    }
  }, [authorsView.page, authorsView.bookPage, totalPages, bookPages, setAuthorsView]);
  useLayoutEffect(() => {
    if (authorPageNavigation.current) {
      authorPageNavigation.current = false;
      list.current?.querySelector<HTMLButtonElement>('.author-group-toggle')?.focus();
      list.current?.scrollIntoView?.({ block: 'start' });
    } else if (bookPageNavigation.current) {
      bookPageNavigation.current = false;
      list.current?.querySelector<HTMLAnchorElement>('.author-book-link')?.focus();
    }
  }, [page, bookPage]);
  useEffect(() => {
    if (!returnOnEntry.current || !books) return;
    let active = true;
    void books.checkForChanges().then(async () => {
      const version = await books.readRevision();
      if (active) setReturnRevision(version);
    }).catch(() => { if (active) setReturnRevision('failed'); });
    return () => { active = false; };
  }, [books]);
  useEffect(() => {
    if (state.status !== 'ready' || !books || returnRevision === null || returnRevision === 'failed' || restoredOnEntry.current) return;
    if (state.snapshot.version.generation === returnRevision.generation &&
      state.snapshot.version.revision >= returnRevision.revision) return;
    void books.checkForChanges().catch(() => setReturnRevision('failed'));
    const timeout = window.setTimeout(() => setReturnRevision('failed'), 2000);
    return () => window.clearTimeout(timeout);
  }, [state, books, returnRevision]);
  useEffect(() => {
    if (state.status !== 'ready' || restoredOnEntry.current) return;
    if (!returnOnEntry.current) { restoredOnEntry.current = true; window.scrollTo(0, 0); return; }
    if (returnRevision === 'failed') {
      restoredOnEntry.current = true;
      setListChanged(true);
      heading.current?.focus({ preventScroll: true });
      window.scrollTo(0, 0);
      setAuthorsView(view => ({ ...view, returnBookId: null }));
      return;
    }
    if (returnRevision === null || state.snapshot.version.generation !== returnRevision.generation ||
      state.snapshot.version.revision < returnRevision.revision) return;
    if (!books) return;
    const id = returnOnEntry.current;
    const group = matches.find(group => group.key === authorsView.expanded && group.books.some(book => book.id === id)) ??
      matches.find(group => group.books.some(book => book.id === id));
    if (group) {
      const groupPage = Math.floor(matches.indexOf(group) / pageSize) + 1;
      const targetBookPage = Math.floor(group.books.findIndex(book => book.id === id) / pageSize) + 1;
      if (page !== groupPage || authorsView.expanded !== group.key || bookPage !== targetBookPage) {
        relocatedOnEntry.current = true;
        setAuthorsView(view => ({ ...view, page: groupPage, expanded: group.key, bookPage: targetBookPage }));
        return;
      }
    }
    let active = true;
    const timer = window.setTimeout(() => {
      void books.readRevision().then(async latest => {
        if (!active) return;
        if (!sameRevision(latest, state.snapshot.version)) {
          await books.checkForChanges();
          if (active) setReturnRevision(latest);
          return;
        }
        restoredOnEntry.current = true;
        const target = [...document.querySelectorAll<HTMLAnchorElement>('.author-book-link')]
          .find(link => link.dataset.bookId === id);
        if (target) {
          target.focus({ preventScroll: true });
          if (relocatedOnEntry.current) target.scrollIntoView?.({ block: 'nearest' });
          else window.scrollTo(0, positions.get('/autores') ?? 0);
        } else {
          setListChanged(true);
          heading.current?.focus({ preventScroll: true });
          window.scrollTo(0, 0);
        }
        setAuthorsView(view => ({ ...view, returnBookId: null }));
      }).catch(() => {
        if (!active) return;
        restoredOnEntry.current = true;
        setListChanged(true);
        heading.current?.focus({ preventScroll: true });
        window.scrollTo(0, 0);
        setAuthorsView(view => ({ ...view, returnBookId: null }));
      });
    }, 0);
    return () => { active = false; window.clearTimeout(timer); };
  }, [state, returnRevision, matches, page, bookPage, authorsView.expanded, positions, books, setAuthorsView]);

  return <section className="page-content authors-page" aria-labelledby="authors-title">
    <Link className="back-link" to="/estante"><ArrowLeft aria-hidden="true" />{t('backToShelf')}</Link>
    <h1 id="authors-title" ref={heading} tabIndex={-1}>{t('authors')}</h1>
    {listChanged && <p className="local-note" role="status">{t('authorIndexUpdated')}</p>}
    {state.status !== 'ready' ? state.status === 'error' ? <LibraryState state="error" onRetry={retry} /> : <LibraryState state="loading" /> : groups.length === 0 ?
      <div className="notice-panel"><h2>{t('authorIndexEmpty')}</h2><p>{t('authorIndexEmptyHelp')}</p></div> : <>
        <p className="authors-intro">{t('authorsIntro')}</p>
        <label className="authors-search">{t('searchAuthors')}
          <span><Search aria-hidden="true" /><input ref={searchInput} type="search" value={authorsView.query} maxLength={200}
            onChange={event => setAuthorsView(view => ({ ...view, query: event.target.value, page: 1, expanded: null, bookPage: 1, returnBookId: null }))} /></span>
        </label>
        <p className="authors-count">{t(matches.length === 1 ? 'authorResultOne' : 'authorResults', { count: formatNumber(locale, matches.length) })}</p>
        {authorsView.query.length > 0 && matches.length > 0 && <div className="authors-clear-search"><button className="button button-secondary" type="button" onClick={clearSearch}>{t('clearSearch')}</button></div>}
        {matches.length === 0 ? <div className="notice-panel"><h2>{t('authorIndexNoMatches')}</h2><p>{t('authorIndexTryAnother')}</p><button className="button button-secondary" type="button" onClick={clearSearch}>{t('clearSearch')}</button></div> : <>
          <ol ref={list} className="author-groups" aria-label={t('authorIndexList')} start={(page - 1) * pageSize + 1}>
            {pageGroups.map((group, index) => {
              const open = group.key === authorsView.expanded;
              const panelId = `author-books-${page}-${index}`;
              const first = (bookPage - 1) * pageSize;
              return <li className="author-group" key={group.key}>
                <button className="author-group-toggle" type="button" aria-expanded={open} aria-controls={panelId}
                  onClick={() => setAuthorsView(view => ({ ...view, expanded: open ? null : group.key, bookPage: 1, returnBookId: null }))}>
                  <span className="author-monogram" aria-hidden="true">{group.name.slice(0, 1).toLocaleUpperCase(locale)}</span>
                  <span className="author-group-label"><strong>{group.name}</strong><small>{t(group.books.length === 1 ? 'authorBookOne' : 'authorBooks', { count: formatNumber(locale, group.books.length) })}</small></span>
                  <ChevronDown className="author-chevron" aria-hidden="true" />
                </button>
                <div id={panelId} className="author-books" hidden={!open}>
                  {open && <><ol aria-label={t('booksByAuthor', { author: group.name })} start={first + 1}>
                    {group.books.slice(first, first + pageSize).map(book => <li key={book.id}>
                      <Link className="author-book-link" data-book-id={book.id} to={`/livro/${book.id}`} state={{ returnTo: '/autores' }}
                        onClick={() => { positions.set('/autores', window.scrollY); setAuthorsView(view => ({ ...view, returnBookId: book.id })); }}>
                        <strong>{book.title}</strong><small>{t('authorBookMeta', { year: formatShelfYear(book.shelfYear), status: statuses[book.status] })}</small>
                      </Link>
                    </li>)}
                  </ol>{bookPages > 1 && <nav className="shelf-pagination" aria-label={t('authorBookPages')}>
                    <button className="button button-secondary" disabled={bookPage === 1} onClick={() => { bookPageNavigation.current = true; setAuthorsView(view => ({ ...view, bookPage: bookPage - 1 })); }}>{t('previous')}</button>
                    <span aria-live="polite">{t('pageOf', { page: bookPage, total: bookPages })}</span>
                    <button className="button button-secondary" disabled={bookPage === bookPages} onClick={() => { bookPageNavigation.current = true; setAuthorsView(view => ({ ...view, bookPage: bookPage + 1 })); }}>{t('next')}</button>
                  </nav>}</>}
                </div>
              </li>;
            })}
          </ol>
          {totalPages > 1 && <nav className="shelf-pagination" aria-label={t('authorPages')}>
            <button className="button button-secondary" disabled={page === 1} onClick={() => { authorPageNavigation.current = true; setAuthorsView(view => ({ ...view, page: page - 1, expanded: null, bookPage: 1 })); }}>{t('previous')}</button>
            <span aria-live="polite">{t('pageOf', { page, total: totalPages })}</span>
            <button className="button button-secondary" disabled={page === totalPages} onClick={() => { authorPageNavigation.current = true; setAuthorsView(view => ({ ...view, page: page + 1, expanded: null, bookPage: 1 })); }}>{t('next')}</button>
          </nav>}</>}
      </>}
  </section>;
}
