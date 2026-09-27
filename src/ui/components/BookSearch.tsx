import { useEffect, useRef, useState } from 'react';
import { openBookSearch } from '../../app/composition';
import { candidateDraft, SearchError, type BookCandidate, type SearchPage } from '../../ports/book-search';
import type { NewBook } from '../../domain/book';

const messages = {
  'invalid-query': 'Digite de 2 a 200 caracteres para buscar.',
  offline: 'A busca precisa de conexão. Você pode adicionar manualmente.',
  timeout: 'A busca demorou mais que o esperado. Tente novamente ou adicione manualmente.',
  cancelled: '', unavailable: 'A busca está indisponível agora. Tente novamente ou adicione manualmente.',
  'invalid-response': 'Não foi possível ler os resultados. Tente novamente ou adicione manualmente.',
  cooldown: 'A Open Library pediu uma pausa. Aguarde um pouco antes de tentar novamente; o cadastro manual continua disponível.',
};
export function BookSearch({ onSelect, onManual }: { onSelect: (draft: NewBook) => void; onManual: () => void }) {
  const [service] = useState(openBookSearch);
  const [query, setQuery] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [result, setResult] = useState<SearchPage | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const sequence = useRef(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); return () => { sequence.current++; service.cancel(); }; }, [service]);
  async function search(text: string, page = 1) {
    const request = ++sequence.current;
    setBusy(true); setError(''); setResult(null); setSubmitted(text);
    try { const next = await service.search(text, page); if (sequence.current === request) setResult(next); }
    catch (failure) { if (sequence.current === request) setError(messages[failure instanceof SearchError ? failure.code : 'unavailable']); }
    finally { if (sequence.current === request) setBusy(false); }
  }
  function select(candidate: BookCandidate) {
    service.cancel();
    onSelect(candidateDraft(candidate));
  }
  return <div className="book-search">
    <form onSubmit={(event) => { event.preventDefault(); void search(query); }}>
      <label className="form-field">Título, autor ou ISBN<input ref={input} value={query} maxLength={200} onChange={(event) => setQuery(event.target.value)} aria-describedby="search-privacy" /></label>
      <p className="field-help" id="search-privacy">A busca consulta a Open Library. Seus livros e notas não são enviados.</p>
      <div className="form-actions"><button className="button button-primary" type="submit" disabled={busy}>Buscar</button>
        {busy && <button className="button button-secondary" type="button" onClick={() => { sequence.current++; service.cancel(); setBusy(false); }}>Cancelar busca</button>}
        <button className="button button-secondary" type="button" onClick={onManual}>Adicionar manualmente</button></div>
    </form>
    {busy && <p role="status">Buscando na Open Library…</p>}
    {error && <div role="alert"><p>{error}</p><button className="button button-secondary" onClick={() => void search(submitted)}>Tentar novamente</button></div>}
    {result && <div aria-label="Resultados da busca">
      <p role="status">{result.candidates.length ? `${result.candidates.length} resultados nesta página${result.cached ? ' · Resultados salvos neste dispositivo' : ''}.` : 'Não encontramos este livro. Tente outro título ou adicione manualmente.'}</p>
      <p className="field-help">Confira os dados da sua edição ao revisar o livro escolhido.</p>
      <ul className="search-results">{result.candidates.map((candidate) => <li key={candidate.workId}>
        <div className="search-result-info"><h2>{candidate.title}</h2><p>{candidate.authors.join(', ') || 'Autoria não informada'}</p>
        <p className="field-help">Obra · Open Library{candidate.firstPublishedYear ? ` · primeira publicação: ${candidate.firstPublishedYear}` : ''}</p></div><button className="button button-secondary" onClick={() => select(candidate)}>Usar este livro<span className="visually-hidden">: {candidate.title}</span></button>
      </li>)}</ul>
      <div className="form-actions">{result.page > 1 && <button className="button button-secondary" onClick={() => void search(submitted, result.page - 1)}>Página anterior</button>}
        {result.hasMore && <button className="button button-secondary" onClick={() => void search(submitted, result.page + 1)}>Próxima página</button>}</div>
    </div>}
  </div>;
}
