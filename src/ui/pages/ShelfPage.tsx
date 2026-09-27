import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Grid2X2, List, BookOpen } from 'lucide-react';
import { useLibrary } from '../../app/LibraryProvider';
import type { ReadingStatus } from '../../domain/book';
import { booksForYear, formatShelfYear } from '../../domain/library';
import { statisticsForYear } from '../../domain/statistics';
import { LibraryState } from '../components/LibraryState';
import { projectYearShare, type YearShare } from '../../sharing/projection';

const YearSharePreview = lazy(() => import('../components/YearSharePreview'));

const labels = { read: 'Lidos', reading: 'Lendo', 'want-to-read': 'Quero ler', all: 'Todos' };
const statusLabels = { read: 'Lido', reading: 'Lendo', 'want-to-read': 'Quero ler' };
const number = new Intl.NumberFormat('pt-BR');

export function ShelfPage({ status }: { status?: ReadingStatus }) {
  const { state, retry, updatePreferences, positions } = useLibrary();
  const location = useLocation();
  const navigate = useNavigate();
  const restored = useRef(false);
  const shareButton = useRef<HTMLButtonElement>(null);
  const [share, setShare] = useState<YearShare | null>(null);
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
  const visible = filter === 'all' ? yearBooks : yearBooks.filter((book) => book.status === filter);
  const metrics = statisticsForYear(yearBooks, year);
  function selectFilter(next: typeof filter) {
    updatePreferences({ filter: next });
    if (status) navigate('/estante');
  }

  return <section className="shelf-page" aria-labelledby="shelf-title">
    <p className="eyebrow">Sua história em livros</p>
    <div className="shelf-heading">
      <h1 id="shelf-title">{status ? `${labels[status]} · ${yearText}` : `Estante ${yearText}`}</h1>
      <label className="year-field">Ano da estante
        <select value={year} onChange={(event) => updatePreferences({ shelfYear: Number(event.target.value) })}>
          {years.map((item) => <option key={item} value={item}>{formatShelfYear(item)}</option>)}
        </select>
      </label>
    </div>
    <p className="page-description">Uma leitura de cada vez. Toda a sua história aqui.</p>
    <dl className="shelf-metrics" aria-label={`Livros lidos em ${yearText}`}>
      <div><dt>Livros</dt><dd aria-label={`${number.format(metrics.books)} livros lidos em ${yearText}`}>{number.format(metrics.books)}</dd></div>
      <div><dt>Páginas</dt><dd aria-label={metrics.pages === null ? 'Páginas não informadas' : `${number.format(metrics.pages)} páginas informadas em livros lidos`}>{metrics.pages === null ? '—' : number.format(metrics.pages)}</dd></div>
      <div><dt>Autores</dt><dd aria-label={metrics.authors === null ? 'Autoria não informada' : `${number.format(metrics.authors)} autores distintos em livros lidos`}>{metrics.authors === null ? '—' : number.format(metrics.authors)}</dd></div>
    </dl>
    {metrics.books > 0 && (metrics.booksWithPages < metrics.books || metrics.booksWithAuthors < metrics.books) &&
      <p className="metric-note">Páginas e autores consideram somente as informações registradas nos livros lidos.</p>}
    <div className="share-entry">
      <button ref={shareButton} className="button button-secondary" disabled={metrics.books === 0}
        aria-describedby={metrics.books === 0 ? 'share-empty' : undefined}
        onClick={() => setShare(projectYearShare(snapshot.books, year, true))}>Compartilhar ano</button>
      {metrics.books === 0 && <p id="share-empty" className="field-help">A imagem fica disponível após marcar um livro como Lido neste ano.</p>}
    </div>
    {share && <Suspense fallback={<p role="status">Preparando a prévia…</p>}>
      <YearSharePreview key={share.year} projection={share} onClose={() => { setShare(null); shareButton.current?.focus(); }} />
    </Suspense>}
    <div className="shelf-tools">
      <div className="segmented-control shelf-filters" role="group" aria-label="Filtrar por estado">
        {(['all', 'read', 'reading', 'want-to-read'] as const).map((value) =>
          <button key={value} aria-pressed={filter === value} onClick={() => selectFilter(value)}>{labels[value]}</button>)}
      </div>
      <div className="segmented-control" role="group" aria-label="Visualização da estante">
        <button aria-pressed={preferences.mode === 'grid'} onClick={() => updatePreferences({ mode: 'grid' })}><Grid2X2 aria-hidden="true" />Grade</button>
        <button aria-pressed={preferences.mode === 'list'} onClick={() => updatePreferences({ mode: 'list' })}><List aria-hidden="true" />Lista</button>
      </div>
    </div>
    {state.preferenceError && <p role="status">Não foi possível guardar sua preferência de visualização. Seus livros continuam salvos.</p>}
    {yearBooks.length === 0 ? <LibraryState state="empty" year={year} returnTo={location.pathname} /> : visible.length === 0 ?
      <div className="notice-panel"><h2>Nenhum livro em {labels[filter]} nesta estante.</h2>
        <button className="button button-secondary" onClick={() => selectFilter('all')}>Limpar filtro</button></div> :
      <ol className={`book-collection book-collection--${preferences.mode}`} aria-label={`Livros da estante de ${yearText}`}>
        {visible.map((book) => <li key={book.id}>
          <Link className="book-entry" to={`/livro/${book.id}`} state={{ returnTo: location.pathname }}
            onClick={() => positions.set(location.pathname, window.scrollY)}>
            <div className="book-cover" aria-hidden="true"><BookOpen /><span>{book.title}</span></div>
            <div className="book-information"><h2>{book.title}</h2><p>{book.authors.length ? book.authors.join(', ') : 'Autoria não informada'}</p>
              <span className={`reading-status reading-status--${book.status}`}>{statusLabels[book.status]}</span>
              {preferences.mode === 'list' && book.rating !== null && <span className="book-rating" aria-label={`Avaliação: ${book.rating} de 5 estrelas`}><span aria-hidden="true">{'★'.repeat(book.rating)}{'☆'.repeat(5 - book.rating)}</span></span>}
            </div>
          </Link>
        </li>)}
      </ol>}
    <p className="local-note">Seus livros ficam neste dispositivo, neste navegador. <Link to="/dados">Seus dados</Link></p>
  </section>;
}
