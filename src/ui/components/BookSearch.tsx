import { useEffect, useRef, useState } from 'react';
import { recordDiagnostic } from '../../diagnostics/client';
import { openBookSearch } from '../../app/composition';
import { candidateDraft, SearchError, type BookCandidate, type SearchPage } from '../../ports/book-search';
import type { NewBook } from '../../domain/book';
import { BookCover } from './BookCover';

const messages = {
  'invalid-query': 'Digite de 2 a 200 caracteres para buscar.',
  offline: 'A busca precisa de conexão. Você pode adicionar manualmente.',
  timeout: 'A busca demorou mais que o esperado. Tente novamente ou adicione manualmente.',
  cancelled: '', unavailable: 'A busca está indisponível agora. Tente novamente ou adicione manualmente.',
  'invalid-response': 'Não foi possível ler os resultados. Tente novamente ou adicione manualmente.',
  cooldown: 'A Open Library pediu uma pausa. Aguarde um pouco antes de tentar novamente; o cadastro manual continua disponível.',
};
function googleBooksSearchUrl(query: string): string {
  const url = new URL('https://books.google.com/books');
  url.searchParams.set('hl', 'pt-BR');
  const text = query.trim().replace(/\s+/gu, ' ');
  if (text) url.searchParams.set('q', text);
  return url.toString();
}
export function BookSearch({ active, onSelect, onManual }: { active: boolean; onSelect: (draft: NewBook) => void; onManual: () => void }) {
  const [service] = useState(openBookSearch);
  const [query, setQuery] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [result, setResult] = useState<SearchPage | null>(null);
  const [choosing, setChoosing] = useState<string | null>(null);
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
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
    setBusy(true); setError(''); setResult(null); setDetailsError(null); setChoosing(null); setSubmitted(text);
    try { const next = await service.search(text, page); if (sequence.current === request) setResult(next); }
    catch (failure) { if (sequence.current === request) {
      const code = failure instanceof SearchError ? failure.code : 'unavailable';
      if (code === 'invalid-response' || !(failure instanceof SearchError)) recordDiagnostic({ area: 'search', code: 'search_failed' });
      setError(messages[code]);
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
  return <div className="book-search">
    <form onSubmit={(event) => { event.preventDefault(); void search(query); }}>
      <label className="form-field">Título, autor ou ISBN<input ref={input} value={query} maxLength={200} onChange={(event) => setQuery(event.target.value)} /></label>
      <div className="form-actions"><button className="button button-primary" type="submit" disabled={busy || Boolean(choosing)}>Buscar</button>
        {busy && <button className="button button-secondary" type="button" onClick={() => { sequence.current++; service.cancel(); setBusy(false); }}>Cancelar busca</button>}
        <button className="button button-quiet" type="button" aria-label="Pesquisar no Google Books (abre em outra guia)"
          onClick={() => window.open(googleBooksSearchUrl(query), '_blank', 'noopener,noreferrer')}>Pesquisar no Google Books ↗</button>
        <button className="button button-quiet" type="button" onClick={(event) => { selectedButton.current = event.currentTarget; onManual(); }}>Adicionar manualmente</button></div>
      <p className="field-help">Google Books abre em outra guia e recebe o texto digitado somente quando você clicar no botão.</p>
    </form>
    {busy && <p role="status">Buscando na Open Library…</p>}
    {error && <div role="alert"><p>{error}</p><button className="button button-secondary" onClick={() => void search(submitted)}>Tentar novamente</button></div>}
    {result && <div aria-label="Resultados da busca">
      <p role="status">{result.candidates.length ? `${result.candidates.length} resultados${result.cached ? ' · Salvos neste dispositivo' : ''}` : 'Não encontramos este livro. Tente outro título ou adicione manualmente.'}</p>
      <ul className="search-results">{result.candidates.map((candidate) => <li key={candidate.workId}>
        <BookCover cover={candidate.coverId ? { provider: 'open_library', coverId: candidate.coverId } : null} title={candidate.title} className="search-result-cover" size="S" />
        <div className="search-result-info"><h2>{candidate.title}</h2><p>{candidate.authors.join(', ') || 'Autoria não informada'}</p>
          {candidate.firstPublishedYear && <p className="field-help">Ano da obra: {candidate.firstPublishedYear}</p>}
        </div>
        <button className="button button-secondary search-result-select" type="button" disabled={Boolean(choosing)}
          aria-label={`${choosing === candidate.workId ? 'Carregando dados de' : 'Selecionar'} ${candidate.title}${candidate.firstPublishedYear ? ` (${candidate.firstPublishedYear})` : ''}`}
          onClick={(event) => { selectedButton.current = event.currentTarget; void choose(candidate); }}>{choosing === candidate.workId ? 'Aguarde…' : 'Selecionar'}</button>
        {detailsError === candidate.workId && <div className="search-result-error" role="alert">Dados da edição indisponíveis.
          <button className="button button-quiet" type="button" onClick={() => void choose(candidate)}>Tentar novamente</button>
          <button className="button button-quiet" type="button" onClick={(event) => { selectedButton.current = event.currentTarget; onSelect(candidateDraft({ candidate, edition: null })); }}>Usar assim</button>
        </div>}
      </li>)}</ul>
      <div className="form-actions">{result.page > 1 && <button className="button button-secondary" onClick={() => void search(submitted, result.page - 1)}>Página anterior</button>}
        {result.hasMore && <button className="button button-secondary" onClick={() => void search(submitted, result.page + 1)}>Próxima página</button>}</div>
    </div>}
  </div>;
}
