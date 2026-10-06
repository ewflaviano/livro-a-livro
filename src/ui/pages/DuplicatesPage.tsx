import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useLibrary } from '../../app/LibraryProvider';
import { duplicateGroups } from '../../domain/duplicates';
import { formatShelfYear } from '../../domain/library';
import { formatNumber } from '../../i18n/locale';
import { useLocale } from '../../i18n/context';
import { LibraryState } from '../components/LibraryState';

const groupPageSize = 12;
const bookPageSize = 10;
const path = '/duplicatas';

export function DuplicatesPage() {
  const { t, locale } = useLocale();
  const { state, retry, duplicatesView, setDuplicatesView, positions } = useLibrary();
  const groups = useMemo(() => duplicateGroups(state.status === 'ready' ? state.snapshot.books : [], locale), [state, locale]);
  const totalPages = Math.max(1, Math.ceil(groups.length / groupPageSize));
  const page = Math.min(duplicatesView.page, totalPages);
  const visible = groups.slice((page - 1) * groupPageSize, page * groupPageSize);
  const expanded = visible.find(group => group.key === duplicatesView.expanded);
  const bookPages = expanded ? Math.max(1, Math.ceil(expanded.books.length / bookPageSize)) : 1;
  const bookPage = Math.min(duplicatesView.bookPage, bookPages);
  const list = useRef<HTMLOListElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const groupPageNavigation = useRef(false);
  const bookPageNavigation = useRef(false);
  const returnOnEntry = useRef({ bookId: duplicatesView.returnBookId, groupKey: duplicatesView.returnGroupKey });
  const restoredOnEntry = useRef(false);
  const statuses = { read: t('readSingular'), reading: t('reading'), 'want-to-read': t('wantToRead') };
  const reasonLabels = { title_authors: t('duplicatesReasonTitleAuthors'), isbn: t('duplicatesReasonIsbn'), edition: t('duplicatesReasonEdition') };

  useEffect(() => { document.title = `${t('duplicatesTitle')} · ${t('appName')}`; }, [t]);
  useEffect(() => {
    if (duplicatesView.page > totalPages || duplicatesView.bookPage > bookPages) {
      setDuplicatesView(view => ({ ...view, page: Math.min(view.page, totalPages), bookPage: Math.min(view.bookPage, bookPages) }));
    }
  }, [duplicatesView.page, duplicatesView.bookPage, totalPages, bookPages, setDuplicatesView]);
  useLayoutEffect(() => {
    if (groupPageNavigation.current) {
      groupPageNavigation.current = false;
      list.current?.querySelector<HTMLAnchorElement>('.duplicate-book-link')?.focus();
      list.current?.scrollIntoView?.({ block: 'start' });
    } else if (bookPageNavigation.current) {
      bookPageNavigation.current = false;
      list.current?.querySelector<HTMLAnchorElement>('.duplicate-group--expanded .duplicate-book-link')?.focus();
    }
  }, [page, bookPage]);
  useEffect(() => {
    if (state.status !== 'ready' || restoredOnEntry.current) return;
    const { bookId, groupKey } = returnOnEntry.current;
    if (!bookId) { restoredOnEntry.current = true; window.scrollTo(0, 0); return; }
    const index = groups.findIndex(group => group.key === groupKey && group.books.some(book => book.id === bookId));
    const matchIndex = index >= 0 ? index : groups.findIndex(group => group.books.some(book => book.id === bookId));
    const targetPage = matchIndex < 0 ? page : Math.floor(matchIndex / groupPageSize) + 1;
    const targetGroup = groups[matchIndex];
    const targetBookIndex = targetGroup?.books.findIndex(book => book.id === bookId) ?? -1;
    const targetBookPage = Math.floor(targetBookIndex / bookPageSize) + 1;
    if (targetPage !== page || (targetBookIndex >= 2 &&
      (duplicatesView.expanded !== targetGroup.key || duplicatesView.bookPage !== targetBookPage))) {
      setDuplicatesView(view => ({ ...view, page: targetPage,
        expanded: targetBookIndex >= 2 ? targetGroup.key : view.expanded,
        bookPage: targetBookIndex >= 2 ? targetBookPage : view.bookPage }));
      return;
    }
    restoredOnEntry.current = true;
    const timer = window.setTimeout(() => {
      const target = [...document.querySelectorAll<HTMLAnchorElement>('.duplicate-book-link')]
        .find(link => link.dataset.bookId === bookId && link.dataset.groupKey === groups[matchIndex]?.key);
      (target ?? heading.current)?.focus({ preventScroll: true });
      window.scrollTo(0, positions.get(path) ?? 0);
      setDuplicatesView(view => ({ ...view, returnBookId: null, returnGroupKey: null }));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [state.status, groups, page, duplicatesView.expanded, duplicatesView.bookPage, positions, setDuplicatesView]);

  return <section className="page-content duplicates-page" aria-labelledby="duplicates-title">
    <Link className="back-link" to="/dados"><ArrowLeft aria-hidden="true" />{t('backToData')}</Link>
    <h1 id="duplicates-title" ref={heading} tabIndex={-1}>{t('duplicatesTitle')}</h1>
    {state.status !== 'ready' ? <LibraryState state={state.status} onRetry={retry} /> : state.snapshot.books.length === 0 ?
      <div className="notice-panel"><h2>{t('duplicatesLibraryEmpty')}</h2><p>{t('duplicatesLibraryEmptyHelp')}</p>
        <Link className="button button-primary" to="/adicionar" state={{ returnTo: '/dados' }}>{t('addBook')}</Link></div> : groups.length === 0 ?
      <div className="notice-panel"><h2>{t('duplicatesNone')}</h2><p>{t('duplicatesNoneHelp')}</p></div> : <>
        <p className="duplicates-intro">{t('duplicatesIntro')}</p>
        <p className="duplicates-count">{t(groups.length === 1 ? 'duplicatesGroupOne' : 'duplicatesGroups', { count: formatNumber(locale, groups.length) })}</p>
        <p className="duplicates-readonly">{t('duplicatesReviewOnly')}</p>
        <ol ref={list} className="duplicate-groups" aria-label={t('duplicatesList')} start={(page - 1) * groupPageSize + 1}>
          {visible.map(group => {
            const open = group.key === duplicatesView.expanded;
            const start = open ? (bookPage - 1) * bookPageSize : 0;
            const books = group.books.slice(start, start + (open ? bookPageSize : 2));
            return <li className={`duplicate-group${open ? ' duplicate-group--expanded' : ''}`} key={group.key}>
              <div className="duplicate-group-heading"><p>{group.reasons.map(reason => reasonLabels[reason]).join(' · ')}</p>
                <span>{formatShelfYear(group.year)}</span></div>
              <p className="duplicate-group-count">{t('duplicatesGroupBooks', { count: formatNumber(locale, group.books.length) })}</p>
              <ol className="duplicate-books" start={start + 1}>
                {books.map((book, index) => <li key={book.id}>
                  <Link className="duplicate-book-link" data-book-id={book.id} data-group-key={group.key}
                    to={`/livro/${book.id}`} state={{ returnTo: path }}
                    aria-label={t('duplicatesOpenBook', { index: formatNumber(locale, start + index + 1), title: book.title, year: formatShelfYear(group.year) })}
                    onClick={() => { positions.set(path, window.scrollY); setDuplicatesView(view => ({ ...view, returnBookId: book.id, returnGroupKey: group.key })); }}>
                    <strong>{book.title}</strong><small>{book.authors.join(', ') || t('authorUnknown')}</small>
                    <small>{statuses[book.status]}</small>
                  </Link>
                </li>)}
              </ol>
              {group.books.length > 2 && <button className="button button-secondary duplicate-expand" type="button"
                aria-expanded={open} onClick={() => setDuplicatesView(view => ({ ...view, expanded: open ? null : group.key, bookPage: 1 }))}>
                {t(open ? 'duplicatesHideGroup' : 'duplicatesShowGroup')}
              </button>}
              {open && bookPages > 1 && <nav className="shelf-pagination" aria-label={t('duplicatesBookPages')}>
                <button className="button button-secondary" type="button" disabled={bookPage === 1}
                  onClick={() => { bookPageNavigation.current = true; setDuplicatesView(view => ({ ...view, bookPage: bookPage - 1 })); }}>{t('previous')}</button>
                <span aria-live="polite">{t('pageOf', { page: bookPage, total: bookPages })}</span>
                <button className="button button-secondary" type="button" disabled={bookPage === bookPages}
                  onClick={() => { bookPageNavigation.current = true; setDuplicatesView(view => ({ ...view, bookPage: bookPage + 1 })); }}>{t('next')}</button>
              </nav>}
            </li>;
          })}
        </ol>
        {totalPages > 1 && <nav className="shelf-pagination" aria-label={t('duplicatesPages')}>
          <button className="button button-secondary" type="button" disabled={page === 1}
            onClick={() => { groupPageNavigation.current = true; setDuplicatesView(view => ({ ...view, page: page - 1, expanded: null, bookPage: 1 })); }}>{t('previous')}</button>
          <span aria-live="polite">{t('pageOf', { page, total: totalPages })}</span>
          <button className="button button-secondary" type="button" disabled={page === totalPages}
            onClick={() => { groupPageNavigation.current = true; setDuplicatesView(view => ({ ...view, page: page + 1, expanded: null, bookPage: 1 })); }}>{t('next')}</button>
        </nav>}
      </>}
  </section>;
}
