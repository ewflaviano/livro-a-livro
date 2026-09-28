import { BookCover } from '../components/BookCover';
import { useEffect, useLayoutEffect, useRef } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Grid2X2, List, Plus, Search, X } from 'lucide-react';
import { useLibrary } from '../../app/LibraryProvider';
import type { ReadingStatus } from '../../domain/book';
import { booksForYear, formatShelfYear } from '../../domain/library';
import { statisticsForYear } from '../../domain/statistics';
import { LibraryState } from '../components/LibraryState';

const labels = { read: 'Lidos', reading: 'Lendo', 'want-to-read': 'Quero ler', all: 'Todos' };
const statusLabels = { read: 'Lido', reading: 'Lendo', 'want-to-read': 'Quero ler' };
const searchText = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('pt-BR');
const number = new Intl.NumberFormat('pt-BR');

export function ShelfPage({ status }: { status?: ReadingStatus }) {
  const { state, retry, updatePreferences, positions, shelfQuery, setShelfQuery } = useLibrary();
  const location = useLocation();
  const navigate = useNavigate();
  const restored = useRef(false);
  const searchInput = useRef<HTMLInputElement>(null);
  const title = status ? labels[status] : 'Minha estante';
  useEffect(() => { document.title = `${title} · Livro a Livro`; }, [title]);
  useLayoutEffect(() => {
    if (state.status === 'ready' && !restored.current) {
      restored.current = true;
      const position = positions.get(location.pathname);
      if (position !== undefined) window.scrollTo(0, position);
    }
  }, [state.status, positions, location.pathname]);

  if (state.status !== 'ready') return <section aria-label={title}>
    <h1>{title}</h1><LibraryState state={state.status} onRetry={retry} />
  </section>;
  const { snapshot, preferences } = state;
  const currentYear = new Date().getFullYear();
  const year = preferences.shelfYear ?? currentYear;
  const yearText = formatShelfYear(year);
  const years = [...new Set([currentYear, year, ...snapshot.books.map((book) => book.shelfYear)])].sort((a, b) => b - a);
  const yearBooks = booksForYear(snapshot.books, year);
  const filter = status ?? preferences.filter;
  const filtered = filter === 'all' ? yearBooks : yearBooks.filter((book) => book.status === filter);
  const query = searchText(shelfQuery.trim());
  const visible = query ? filtered.filter(book => searchText([book.title, ...book.authors].join(' ')).includes(query)) : filtered;
  const metrics = statisticsForYear(yearBooks, year);
  function selectFilter(next: typeof filter) {
    updatePreferences({ filter: next });
    if (status) navigate('/estante');
  }

  return <section className="shelf-page" aria-labelledby="shelf-title">
    <div className="shelf-heading">
      <h1 id="shelf-title">{status ? labels[status] : 'Estante'}</h1>
      <div className="shelf-heading-actions">
        <label className="year-field">Ano da estante
          <select value={preferences.shelfYear ?? 'current'} onChange={(event) => updatePreferences({ shelfYear: event.target.value === 'current' ? null : Number(event.target.value) })}>
            <option value="current">Ano atual (automático)</option>
            {years.map((item) => <option key={item} value={item}>{formatShelfYear(item)}</option>)}
          </select>
        </label>
        {yearBooks.length > 0 && <Link className="button button-primary shelf-add" to="/adicionar" state={{ returnTo: location.pathname }}
          onClick={() => positions.set(location.pathname, window.scrollY)}><Plus aria-hidden="true" />Adicionar livro</Link>}
      </div>
    </div>
    {yearBooks.length > 0 && <>
      <div className="shelf-toolbar">
        <div className="shelf-search">
          <label className="shelf-search-field"><Search aria-hidden="true" /><span className="visually-hidden">Buscar na estante</span>
            <input ref={searchInput} type="search" value={shelfQuery} maxLength={200}
              placeholder="Buscar livro ou autor" onChange={event => setShelfQuery(event.target.value)} /></label>
          {shelfQuery && <button className="shelf-search-clear" aria-label="Limpar busca" onClick={() => { setShelfQuery(''); searchInput.current?.focus(); }}><X aria-hidden="true" /></button>}
        </div>
        <button className="shelf-mode" aria-label={preferences.mode === 'grid' ? 'Ver em lista' : 'Ver em grade'}
          title={preferences.mode === 'grid' ? 'Ver em lista' : 'Ver em grade'}
          onClick={() => updatePreferences({ mode: preferences.mode === 'grid' ? 'list' : 'grid' })}>
          {preferences.mode === 'grid' ? <List aria-hidden="true" /> : <Grid2X2 aria-hidden="true" />}
        </button>
      </div>
      <div className="segmented-control shelf-filters" role="group" aria-label="Filtrar por estado">
        {(['all', 'read', 'reading', 'want-to-read'] as const).map((value) =>
          <button key={value} aria-pressed={filter === value} onClick={() => selectFilter(value)}>{labels[value]}</button>)}
      </div>
    </>}
    {state.preferenceError && <div role="alert"><p>Não foi possível guardar estas preferências. Elas valem nesta sessão, mas podem se perder ao reabrir o aplicativo. Seus livros continuam salvos.</p>
      <button className="button button-secondary" onClick={() => updatePreferences(preferences)}>Tentar salvar preferências</button></div>}
    {yearBooks.length === 0 ? <LibraryState state="empty" returnTo={location.pathname} /> : visible.length === 0 && query ?
      <div className="notice-panel" role="status"><h2>Nenhum livro encontrado.</h2><p>Tente outro título ou autor. A busca considera o ano e o filtro selecionados.</p></div> : visible.length === 0 ?
      <div className="notice-panel"><h2>Nenhum livro em {labels[filter]} nesta estante.</h2>
        <button className="button button-secondary" onClick={() => selectFilter('all')}>Limpar filtro</button></div> :
      <ol className={`book-collection book-collection--${preferences.mode}`} aria-label={`Livros da estante de ${yearText}`}>
        {visible.map((book) => <li key={book.id}>
          <Link className="book-entry" to={`/livro/${book.id}`} state={{ returnTo: location.pathname }}
            onClick={() => positions.set(location.pathname, window.scrollY)}>
            <BookCover cover={book.cover} title={book.title} />
            <div className="book-information"><h2>{book.title}</h2><p>{book.authors.length ? book.authors.join(', ') : 'Autoria não informada'}</p>
              <span className={`reading-status reading-status--${book.status}`}>{statusLabels[book.status]}</span>
              {preferences.mode === 'list' && book.rating !== null && <span className="book-rating" aria-label={`Avaliação: ${book.rating} de 5 estrelas`}><span aria-hidden="true">{'★'.repeat(book.rating)}{'☆'.repeat(5 - book.rating)}</span></span>}
            </div>
          </Link>
        </li>)}
      </ol>}
    {yearBooks.length > 0 && <dl className="shelf-metrics" aria-label={`Livros lidos em ${yearText}`}>
      <div><dt>Lidos</dt><dd aria-label={`${number.format(metrics.books)} livros lidos em ${yearText}`}>{number.format(metrics.books)}</dd></div>
      <div><dt>Páginas</dt><dd aria-label={metrics.pages === null ? 'Páginas não informadas' : `${number.format(metrics.pages)} páginas informadas em livros lidos`}>{metrics.pages === null ? '—' : number.format(metrics.pages)}</dd></div>
      <div><dt>Autores</dt><dd aria-label={metrics.authors === null ? 'Autoria não informada' : `${number.format(metrics.authors)} autores distintos em livros lidos`}>{metrics.authors === null ? '—' : number.format(metrics.authors)}</dd></div>
    </dl>}
  </section>;
}
