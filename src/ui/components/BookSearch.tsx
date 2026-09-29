import { useEffect, useRef, useState } from 'react';
import { recordDiagnostic } from '../../diagnostics/client';
import { openBookSearch } from '../../app/composition';
import { candidateDraft, SearchError, type BookCandidate, type SearchErrorCode, type SearchPage } from '../../ports/book-search';
import type { NewBook } from '../../domain/book';
import { BookCover } from './BookCover';
import { useLocale } from '../../i18n/context';
import { formatNumber, pluralCategory } from '../../i18n/locale';

const errorKeys = { 'invalid-query': 'searchInvalidQuery', offline: 'searchOffline', timeout: 'searchTimeout',
  cancelled: null, unavailable: 'searchUnavailable', 'invalid-response': 'searchInvalidResponse', cooldown: 'searchCooldown' } as const;
function googleBooksSearchUrl(query: string): string {
  const url = new URL('https://books.google.com/books');
  url.searchParams.set('hl', 'pt-BR');
  const text = query.trim().replace(/\s+/gu, ' ');
  if (text) url.searchParams.set('q', text);
  return url.toString();
}
export function BookSearch({ active, onSelect, onManual }: { active: boolean; onSelect: (draft: NewBook) => void; onManual: () => void }) {
  const { t, locale } = useLocale();
  const [service] = useState(openBookSearch);
  const [query, setQuery] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [result, setResult] = useState<SearchPage | null>(null);
  const [choosing, setChoosing] = useState<string | null>(null);
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<SearchErrorCode | null>(null);
  const sequence = useRef(0);
  const input = useRef<HTMLInputElement>(null);
  const selectedButton = useRef<HTMLButtonElement>(null);
  const wasActive = useRef(active);
  useEffect(() => { input.current?.focus(); return () => { sequence.current++; service.cancel(); }; }, [service]);
  useEffect(() => {
    if (!active) { sequence.current++; service.cancel(); setBusy(false); setChoosing(null); wasActive.current = false; return; }
    if (!wasActive.current) queueMicrotask(() => {
      const target = selectedButton.current?.isConnected ? selectedButton.current : input.current;
      target?.focus();
    });
    wasActive.current = true;
  }, [active, service]);
  async function search(text: string, page = 1) {
    const request = ++sequence.current;
    setBusy(true); setError(null); setResult(null); setDetailsError(null); setChoosing(null); setSubmitted(text);
    try { const next = await service.search(text, page); if (sequence.current === request) setResult(next); }
    catch (failure) { if (sequence.current === request) {
      const code = failure instanceof SearchError ? failure.code : 'unavailable';
      if (code === 'invalid-response' || !(failure instanceof SearchError)) recordDiagnostic({ area: 'search', code: 'search_failed' });
      setError(code === 'cancelled' ? null : code);
    } }
    finally { if (sequence.current === request) setBusy(false); }
  }
  async function choose(candidate: BookCandidate) {
    const request = ++sequence.current;
    setChoosing(candidate.workId); setDetailsError(null);
    try {
      const details = await service.details(candidate);
      if (sequence.current === request) onSelect(candidateDraft(details));
    } catch (failure) {
      if (sequence.current === request && !(failure instanceof SearchError && failure.code === 'cancelled')) {
        if (!(failure instanceof SearchError) || failure.code === 'invalid-response') recordDiagnostic({ area: 'search', code: 'search_failed' });
        setDetailsError(candidate.workId);
      }
    } finally { if (sequence.current === request) setChoosing(null); }
  }
  const errorKey = error ? errorKeys[error] : null;
  return <div className="book-search">
    <form onSubmit={(event) => { event.preventDefault(); void search(query); }}>
      <label className="form-field">{t('titleAuthorIsbn')}<input ref={input} value={query} maxLength={200} onChange={(event) => setQuery(event.target.value)} /></label>
      <div className="form-actions"><button className="button button-primary" type="submit" disabled={busy || Boolean(choosing)}>{t('search')}</button>
        {busy && <button className="button button-secondary" type="button" onClick={() => { sequence.current++; service.cancel(); setBusy(false); }}>{t('cancelSearch')}</button>}
        <button className="button button-quiet" type="button" aria-label={t('googleBooksSearchAccessible')}
          onClick={() => window.open(googleBooksSearchUrl(query), '_blank', 'noopener,noreferrer')}>{t('googleBooksSearch')}</button>
        <button className="button button-quiet" type="button" onClick={(event) => { selectedButton.current = event.currentTarget; onManual(); }}>{t('addManually')}</button></div>
      <p className="field-help">{t('googleBooksExplanation')}</p>
    </form>
    {busy && <p role="status">{t('searchingOpenLibrary')}</p>}
    {errorKey && <div role="alert"><p>{t(errorKey)}</p><button className="button button-secondary" onClick={() => void search(submitted)}>{t('retry')}</button></div>}
    {result && <div aria-label={t('searchResults')}>
      <p role="status">{result.candidates.length ? `${t(pluralCategory(locale, result.candidates.length) === 'one' ? 'resultCountOne' : 'resultCount', { count: formatNumber(locale, result.candidates.length) })}${result.cached ? ` · ${t('savedHere')}` : ''}` : t('noSearchResults')}</p>
      <ul className="search-results">{result.candidates.map((candidate) => <li key={candidate.workId}>
        <BookCover cover={candidate.coverId ? { provider: 'open_library', coverId: candidate.coverId } : null} title={candidate.title} className="search-result-cover" size="S" />
        <div className="search-result-info"><h2>{candidate.title}</h2><p>{candidate.authors.join(', ') || t('authorUnknown')}</p>
          {candidate.firstPublishedYear && <p className="field-help">{t('workYear', { year: candidate.firstPublishedYear })}</p>}
        </div>
        <button className="button button-secondary search-result-select" type="button" disabled={Boolean(choosing)}
          aria-label={`${choosing === candidate.workId ? t('loadingDataOf') : t('select')} ${candidate.title}${candidate.firstPublishedYear ? ` (${candidate.firstPublishedYear})` : ''}`}
          onClick={(event) => { selectedButton.current = event.currentTarget; void choose(candidate); }}>{choosing === candidate.workId ? t('wait') : t('select')}</button>
        {detailsError === candidate.workId && <div className="search-result-error" role="alert">{t('editionUnavailable')}
          <button className="button button-quiet" type="button" onClick={() => void choose(candidate)}>{t('retry')}</button>
          <button className="button button-quiet" type="button" onClick={(event) => { selectedButton.current = event.currentTarget; onSelect(candidateDraft({ candidate, edition: null })); }}>{t('useAsIs')}</button>
        </div>}
      </li>)}</ul>
      <div className="form-actions">{result.page > 1 && <button className="button button-secondary" onClick={() => void search(submitted, result.page - 1)}>{t('previousPage')}</button>}
        {result.hasMore && <button className="button button-secondary" onClick={() => void search(submitted, result.page + 1)}>{t('nextPage')}</button>}</div>
    </div>}
  </div>;
}
