import { BookCover } from '../components/BookCover';
import { useEffect, useLayoutEffect, useRef } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ArrowDownAZ, Clock3, Grid2X2, List, Plus, Search, X } from 'lucide-react';
import { useLibrary } from '../../app/LibraryProvider';
import { normalizeIsbn, type ReadingStatus } from '../../domain/book';
import { booksForYear, formatShelfYear, orderShelfBooks } from '../../domain/library';
import { statisticsForYear } from '../../domain/statistics';
import { LibraryState } from '../components/LibraryState';
import { useLocale } from '../../i18n/context';
import { formatNumber, pluralCategory } from '../../i18n/locale';

const searchText = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('pt-BR');
const pageSize = 24;

export function ShelfPage({ status }: { status?: ReadingStatus }) {
  const { t, locale } = useLocale();
  const labels = { read: t('readPlural'), reading: t('reading'), 'want-to-read': t('wantToRead'), all: t('all') };
  const statusLabels = { read: t('readSingular'), reading: t('reading'), 'want-to-read': t('wantToRead') };
  const { state, retry, updatePreferences, positions, shelfPages, setShelfPage,
    shelfQuery, setShelfQuery, shelfSearchScope, setShelfSearchScope } = useLibrary();
  const location = useLocation();
  const navigate = useNavigate();
  const restored = useRef(false);
  const searchInput = useRef<HTMLInputElement>(null);
  const collection = useRef<HTMLOListElement>(null);
  const pageNavigation = useRef(false);
  const title = status ? labels[status] : t('myShelf');
  const currentYear = new Date().getFullYear();
  const year = state.status === 'ready' ? state.preferences.shelfYear ?? currentYear : currentYear;
  const filter = status ?? (state.status === 'ready' ? state.preferences.filter : 'all');
  const yearBooks = state.status === 'ready' ? booksForYear(state.snapshot.books, year) : [];
  const query = searchText(shelfQuery.trim());
  const isbnQuery = normalizeIsbn(shelfQuery.trim());
  const globalSearch = !!query && shelfSearchScope === 'all';
  const booksInScope = globalSearch && state.status === 'ready' ? state.snapshot.books : yearBooks;
  const filtered = filter === 'all' ? booksInScope : booksInScope.filter((book) => book.status === filter);
  const matches = query ? filtered.filter(book =>
    searchText([book.title, ...book.authors].join(' ')).includes(query) || book.isbn === isbnQuery) : filtered;
  const visible = orderShelfBooks(matches, state.status === 'ready' ? state.preferences.sortOrder : 'recent', locale);
  const totalPages = Math.max(1, Math.ceil(visible.length / pageSize));
  const selection = JSON.stringify([year, filter, shelfQuery, globalSearch, state.status === 'ready' ? state.preferences.sortOrder : 'recent']);
  const savedPage = shelfPages.get(location.pathname);
  const page = savedPage?.selection === selection ? Math.min(savedPage.page, totalPages) : 1;
  const pageBooks = visible.slice((page - 1) * pageSize, page * pageSize);
  useEffect(() => { document.title = `${title} · ${t('appName')}`; }, [title, t]);
  useEffect(() => {
    if (state.status !== 'ready') return;
    if (savedPage?.selection !== selection || savedPage.page !== page) setShelfPage(location.pathname, selection, page);
  }, [state.status, savedPage, selection, page, setShelfPage, location.pathname]);
  useLayoutEffect(() => {
    if (state.status === 'ready' && !restored.current) {
      restored.current = true;
      const position = positions.get(location.pathname);
      if (position !== undefined) window.scrollTo(0, position);
    }
  }, [state.status, positions, location.pathname]);
  useLayoutEffect(() => {
    if (!pageNavigation.current) return;
    pageNavigation.current = false;
    collection.current?.querySelector<HTMLAnchorElement>('.book-entry')?.focus();
    collection.current?.scrollIntoView?.({ block: 'start' });
  }, [page]);

  if (state.status !== 'ready') return <section aria-label={title}>
    <h1>{title}</h1><LibraryState state={state.status} onRetry={retry} />
  </section>;
  const { snapshot, preferences } = state;
  const yearText = formatShelfYear(year);
  const years = [...new Set([currentYear, year, ...snapshot.books.map((book) => book.shelfYear)])].sort((a, b) => b - a);
  const metrics = statisticsForYear(yearBooks, year);
  function selectFilter(next: typeof filter) {
    updatePreferences({ filter: next });
    if (status) navigate('/estante');
  }
  function changePage(next: number) {
    pageNavigation.current = true;
    setShelfPage(location.pathname, selection, next);
  }

  return <section className="shelf-page" aria-labelledby="shelf-title">
    <div className="shelf-heading">
      <h1 id="shelf-title">{status ? labels[status] : t('shelf')}</h1>
      <div className="shelf-heading-actions">
        <label className="year-field">{t('shelfYear')}
          <select value={preferences.shelfYear ?? 'current'} onChange={(event) => updatePreferences({ shelfYear: event.target.value === 'current' ? null : Number(event.target.value) })}>
            <option value="current">{t('currentYearAutomatic')}</option>
            {years.map((item) => <option key={item} value={item}>{formatShelfYear(item)}</option>)}
          </select>
        </label>
        {(yearBooks.length > 0 || globalSearch) && <Link className="button button-primary shelf-add" to="/adicionar" state={{ returnTo: location.pathname }}
          onClick={() => positions.set(location.pathname, window.scrollY)}><Plus aria-hidden="true" />{t('addBook')}</Link>}
      </div>
    </div>
    {snapshot.books.length > 0 && <>
      <div className="shelf-toolbar">
        <div className="shelf-search">
          <label className="shelf-search-field"><Search aria-hidden="true" /><span className="visually-hidden">{t('searchShelf')}</span>
            <input ref={searchInput} type="search" value={shelfQuery} maxLength={200}
              placeholder={t('searchBookOrAuthor')} onChange={event => setShelfQuery(event.target.value)} /></label>
          {shelfQuery && <button className="shelf-search-clear" aria-label={t('clearSearch')} onClick={() => { setShelfQuery(''); searchInput.current?.focus(); }}><X aria-hidden="true" /></button>}
        </div>
        {(yearBooks.length > 0 || !!query) && <><button className="shelf-sort" type="button"
          aria-label={preferences.sortOrder === 'recent' ? t('sortByTitle') : t('sortByRecent')}
          title={preferences.sortOrder === 'recent' ? t('sortByTitle') : t('sortByRecent')}
          onClick={() => updatePreferences({ sortOrder: preferences.sortOrder === 'recent' ? 'title' : 'recent' })}>
          {preferences.sortOrder === 'recent' ? <ArrowDownAZ aria-hidden="true" /> : <Clock3 aria-hidden="true" />}
        </button>
        <button className="shelf-mode" aria-label={preferences.mode === 'grid' ? t('listView') : t('gridView')}
          title={preferences.mode === 'grid' ? t('listView') : t('gridView')}
          onClick={() => updatePreferences({ mode: preferences.mode === 'grid' ? 'list' : 'grid' })}>
          {preferences.mode === 'grid' ? <List aria-hidden="true" /> : <Grid2X2 aria-hidden="true" />}
        </button></>}
      </div>
      {!!query && <fieldset className="shelf-search-scope">
        <legend>{t('searchScope')}</legend>
        <label><input type="radio" name="shelf-search-scope" checked={!globalSearch}
          onChange={() => setShelfSearchScope('year')} />{t('searchThisYear')}</label>
        <label><input type="radio" name="shelf-search-scope" checked={globalSearch}
          onChange={() => setShelfSearchScope('all')} />{t('searchAllYears')}</label>
      </fieldset>}
      {(yearBooks.length > 0 || !!query) && <div className="segmented-control shelf-filters" role="group" aria-label={t('filterByStatus')}>
        {(['all', 'read', 'reading', 'want-to-read'] as const).map((value) =>
          <button key={value} aria-pressed={filter === value} onClick={() => selectFilter(value)}>{labels[value]}</button>)}
      </div>}
      {globalSearch && visible.length > 0 && <p className="shelf-search-results">{t(visible.length === 1 ? 'allYearsResultOne' : 'allYearsResults',
        { count: formatNumber(locale, visible.length) })}</p>}
    </>}
    {state.preferenceError && <div role="alert"><p>{t('preferenceSaveError')}</p>
      <button className="button button-secondary" onClick={() => updatePreferences(preferences)}>{t('retrySavePreferences')}</button></div>}
    {snapshot.books.length === 0 ? <LibraryState state="empty" returnTo={location.pathname} /> : visible.length === 0 && query ?
      <div className="notice-panel" role="status"><h2>{t('noBooksFound')}</h2><p>{t(globalSearch ? 'tryAnotherBookAllYears' : 'tryAnotherBook')}</p></div> : yearBooks.length === 0 && !globalSearch ?
      <LibraryState state="empty" returnTo={location.pathname} /> : visible.length === 0 ?
      <div className="notice-panel"><h2>{t('noBooksInFilter', { filter: labels[filter] })}</h2>
        <button className="button button-secondary" onClick={() => selectFilter('all')}>{t('clearFilter')}</button></div> :
      <><ol ref={collection} className={`book-collection book-collection--${preferences.mode}`}
        aria-label={globalSearch ? t('shelfBooksAllYears') : t('shelfBooksYear', { year: yearText })} start={(page - 1) * pageSize + 1}>
        {pageBooks.map((book) => <li key={book.id}>
          <Link className="book-entry" to={`/livro/${book.id}`} state={{ returnTo: location.pathname }}
            onClick={() => positions.set(location.pathname, window.scrollY)}>
            <BookCover cover={book.cover} title={book.title} />
            <div className="book-information"><h2>{book.title}</h2><p>{book.authors.length ? book.authors.join(', ') : t('authorUnknown')}</p>
              {globalSearch && <span className="shelf-result-year">{t('shelfYearResult', { year: formatShelfYear(book.shelfYear) })}</span>}
              <span className={`reading-status reading-status--${book.status}`}>{statusLabels[book.status]}</span>
              {preferences.mode === 'list' && book.rating !== null && <span className="book-rating" aria-label={t('ratingOutOfFive', { rating: book.rating })}><span aria-hidden="true">{'★'.repeat(book.rating)}{'☆'.repeat(5 - book.rating)}</span></span>}
            </div>
          </Link>
        </li>)}
      </ol>
      {totalPages > 1 && <nav className="shelf-pagination" aria-label={t('shelfPages')}>
        <button className="button button-secondary" disabled={page === 1} onClick={() => changePage(page - 1)}>{t('previous')}</button>
        <span aria-live="polite">{t('pageOf', { page, total: totalPages })}</span>
        <button className="button button-secondary" disabled={page === totalPages} onClick={() => changePage(page + 1)}>{t('next')}</button>
      </nav>}</>}
    {yearBooks.length > 0 && !globalSearch && <dl className="shelf-metrics" aria-label={t('booksReadYear', { year: yearText })}>
      <div><dt>{t('readPlural')}</dt><dd aria-label={t(pluralCategory(locale, metrics.books) === 'one' ? 'bookReadCountYearOne' : 'booksReadCountYear', { count: formatNumber(locale, metrics.books), year: yearText })}>{formatNumber(locale, metrics.books)}</dd></div>
      <div><dt>{t('pages')}</dt><dd aria-label={metrics.pages === null ? t('pagesUnknown') : t(pluralCategory(locale, metrics.pages) === 'one' ? 'pageReadCountOne' : 'pagesReadCount', { count: formatNumber(locale, metrics.pages) })}>{metrics.pages === null ? '—' : formatNumber(locale, metrics.pages)}</dd></div>
      <div><dt>{t('authors')}</dt><dd aria-label={metrics.authors === null ? t('authorUnknown') : t(pluralCategory(locale, metrics.authors) === 'one' ? 'authorReadCountOne' : 'authorsReadCount', { count: formatNumber(locale, metrics.authors) })}>{metrics.authors === null ? '—' : formatNumber(locale, metrics.authors)}</dd></div>
    </dl>}
  </section>;
}
