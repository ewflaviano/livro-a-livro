import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useLibrary } from '../../app/LibraryProvider';
import { booksMissingDetail, type MissingDetail } from '../../domain/review-details';
import { formatShelfYear } from '../../domain/library';
import { formatNumber } from '../../i18n/locale';
import { useLocale } from '../../i18n/context';
import type { LocalRevision } from '../../ports/library-repository';
import { sameRevision } from '../../services/library-service';
import { LibraryState } from '../components/LibraryState';

const path = '/revisar-fichas';
const pageSize = 24;
const details: MissingDetail[] = ['authors', 'pages', 'isbn'];

export function ReviewDetailsPage() {
  const { t, locale } = useLocale();
  const { state, retry, books, reviewDetailsView, setReviewDetailsView, positions } = useLibrary();
  const matches = useMemo(() => booksMissingDetail(
    state.status === 'ready' ? state.snapshot.books : [], reviewDetailsView.detail, locale,
  ), [state, reviewDetailsView.detail, locale]);
  const counts = useMemo(() => {
    const result: Record<MissingDetail, number> = { authors: 0, pages: 0, isbn: 0 };
    if (state.status === 'ready') for (const book of state.snapshot.books) {
      if (book.authors.length === 0) result.authors += 1;
      if (book.pageCount === null) result.pages += 1;
      if (book.isbn === null) result.isbn += 1;
    }
    return result;
  }, [state]);
  const totalPages = Math.max(1, Math.ceil(matches.length / pageSize));
  const page = Math.min(reviewDetailsView.page, totalPages);
  const visible = matches.slice((page - 1) * pageSize, page * pageSize);
  const fieldKeys = { authors: 'reviewDetailsAuthors', pages: 'reviewDetailsPages', isbn: 'reviewDetailsIsbn' } as const;
  const statuses = { read: t('readSingular'), reading: t('reading'), 'want-to-read': t('wantToRead') };
  const list = useRef<HTMLOListElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const pageNavigation = useRef(false);
  const returnOnEntry = useRef(reviewDetailsView.returnBookId);
  const restoredOnEntry = useRef(false);
  const relocatedOnEntry = useRef(false);
  const [listChanged, setListChanged] = useState(false);
  const [returnUnverified, setReturnUnverified] = useState(false);
  const [returnRevision, setReturnRevision] = useState<LocalRevision | 'failed' | null>(null);

  useEffect(() => { document.title = `${t('reviewDetailsTitle')} · ${t('appName')}`; }, [t]);
  useEffect(() => {
    if (reviewDetailsView.page > totalPages) setReviewDetailsView(view => ({ ...view, page: totalPages }));
  }, [reviewDetailsView.page, totalPages, setReviewDetailsView]);
  useLayoutEffect(() => {
    if (!pageNavigation.current) return;
    pageNavigation.current = false;
    list.current?.querySelector<HTMLAnchorElement>('.review-details-link')?.focus();
    list.current?.scrollIntoView?.({ block: 'start' });
  }, [page]);
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
    if (!returnOnEntry.current) return;
    const timeout = window.setTimeout(() => {
      if (!restoredOnEntry.current) setReturnRevision('failed');
    }, 2000);
    return () => window.clearTimeout(timeout);
  }, []);
  useEffect(() => {
    if (state.status !== 'ready' || !books || returnRevision === null || returnRevision === 'failed' || restoredOnEntry.current) return;
    if (state.snapshot.version.generation === returnRevision.generation &&
      state.snapshot.version.revision >= returnRevision.revision) return;
    void books.checkForChanges().catch(() => setReturnRevision('failed'));
    const timeout = window.setTimeout(() => setReturnRevision('failed'), 2000);
    return () => window.clearTimeout(timeout);
  }, [state, books, returnRevision]);
  useEffect(() => {
    if (restoredOnEntry.current) return;
    const id = returnOnEntry.current;
    if (!id) { if (state.status === 'ready') { restoredOnEntry.current = true; window.scrollTo(0, 0); } return; }
    if (returnRevision === 'failed' || state.status === 'error') {
      restoredOnEntry.current = true;
      setReturnUnverified(true);
      heading.current?.focus({ preventScroll: true });
      window.scrollTo(0, 0);
      setReviewDetailsView(view => ({ ...view, returnBookId: null }));
      return;
    }
    if (state.status !== 'ready') return;
    if (returnRevision === null || state.snapshot.version.generation !== returnRevision.generation ||
      state.snapshot.version.revision < returnRevision.revision || !books) return;
    const index = matches.findIndex(book => book.id === id);
    const targetPage = index < 0 ? page : Math.floor(index / pageSize) + 1;
    if (targetPage !== page) {
      relocatedOnEntry.current = true;
      setReviewDetailsView(view => ({ ...view, page: targetPage }));
      return;
    }
    let active = true;
    const timer = window.setTimeout(() => {
      const fallback = (unverified = false) => {
        if (unverified) setReturnUnverified(true);
        else setListChanged(true);
        heading.current?.focus({ preventScroll: true });
        window.scrollTo(0, 0);
        setReviewDetailsView(view => ({ ...view, returnBookId: null }));
      };
      void books.readRevision().then(async latest => {
        if (!active) return;
        if (!sameRevision(latest, state.snapshot.version)) {
          await books.checkForChanges();
          if (active) setReturnRevision(latest);
          return;
        }
        restoredOnEntry.current = true;
        const target = [...(list.current?.querySelectorAll<HTMLAnchorElement>('.review-details-link') ?? [])]
          .find(link => link.dataset.bookId === id);
        if (target) {
          target.focus({ preventScroll: true });
          if (relocatedOnEntry.current) target.scrollIntoView?.({ block: 'nearest' });
          else window.scrollTo(0, positions.get(path) ?? 0);
          setReviewDetailsView(view => ({ ...view, returnBookId: null }));
        } else fallback();
      }).catch(() => { if (active) { restoredOnEntry.current = true; fallback(true); } });
    }, 0);
    return () => { active = false; window.clearTimeout(timer); };
  }, [state, returnRevision, matches, page, positions, books, setReviewDetailsView]);

  return <section className="page-content review-details-page" aria-labelledby="review-details-title">
    <Link className="back-link" to="/dados"><ArrowLeft aria-hidden="true" />{t('backToData')}</Link>
    <h1 id="review-details-title" ref={heading} tabIndex={-1}>{t('reviewDetailsTitle')}</h1>
    <p className={listChanged || returnUnverified ? 'local-note' : 'visually-hidden'} role="status" aria-atomic="true">
      {returnUnverified ? t('reviewDetailsReturnUnverified') : listChanged ? t('reviewDetailsUpdated') : ''}
    </p>
    {state.status !== 'ready' ? <LibraryState state={state.status} onRetry={retry} /> : <>
        <p className="review-details-intro">{t('reviewDetailsIntro')}</p>
        <fieldset className="review-details-filter"><legend>{t('reviewDetailsFilter')}</legend>
          <div className="segmented-control">{details.map(detail =>
            <button key={detail} type="button" aria-pressed={reviewDetailsView.detail === detail}
              onClick={() => { setListChanged(false); setReviewDetailsView({ detail, page: 1, returnBookId: null }); }}>
              {t(fieldKeys[detail])} <span>({formatNumber(locale, counts[detail])})</span>
            </button>)}</div>
        </fieldset>
        {state.snapshot.books.length === 0 ?
          <div className="notice-panel"><h2>{t('reviewDetailsLibraryEmpty')}</h2><p>{t('reviewDetailsLibraryEmptyHelp')}</p>
            <Link className="button button-primary" to="/adicionar" state={{ returnTo: path }}>{t('addBook')}</Link></div> : <>
        <p className="review-details-count" aria-live="polite">{t(matches.length === 1 ? 'reviewDetailsCountOne' : 'reviewDetailsCount',
          { count: formatNumber(locale, matches.length), field: reviewDetailsView.detail === 'isbn' ? 'ISBN' :
            t(fieldKeys[reviewDetailsView.detail]).toLocaleLowerCase(locale) })}</p>
        {matches.length === 0 ? <div className="notice-panel"><h2>{t('reviewDetailsNone')}</h2><p>{t('reviewDetailsNoneHelp')}</p></div> : <>
          <ol ref={list} className="review-details-list" aria-label={t('reviewDetailsList')} start={(page - 1) * pageSize + 1}>
            {visible.map(book => <li className="review-details-card" key={book.id}>
              <h2>{book.title}</h2>
              <p>{t('authorBookMeta', { year: formatShelfYear(book.shelfYear), status: statuses[book.status] })}</p>
              <Link className="review-details-link" data-book-id={book.id} to={`/livro/${book.id}`}
                state={{ returnTo: path }} aria-label={t('reviewDetailsOpenBookNamed', { title: book.title, year: formatShelfYear(book.shelfYear) })}
                onClick={() => { positions.set(path, window.scrollY); setReviewDetailsView(view => ({ ...view, returnBookId: book.id })); }}>
                {t('reviewDetailsOpenBook')}
              </Link>
            </li>)}
          </ol>
          {totalPages > 1 && <nav className="shelf-pagination" aria-label={t('reviewDetailsPageNavigation')}>
            <button className="button button-secondary" disabled={page === 1} onClick={() => {
              pageNavigation.current = true; setReviewDetailsView(view => ({ ...view, page: page - 1 }));
            }}>{t('previous')}</button>
            <span aria-live="polite">{t('pageOf', { page, total: totalPages })}</span>
            <button className="button button-secondary" disabled={page === totalPages} onClick={() => {
              pageNavigation.current = true; setReviewDetailsView(view => ({ ...view, page: page + 1 }));
            }}>{t('next')}</button>
          </nav>}
        </>}
        <p className="review-details-local">{t('reviewDetailsLocal')}</p>
        </>}
      </>}
  </section>;
}
