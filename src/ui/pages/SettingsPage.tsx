import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useLibrary } from '../../app/LibraryProvider';
import type { PortablePreferences } from '../../ports/library-repository';
import { formatShelfYear } from '../../domain/library';
import { LibraryState } from '../components/LibraryState';
import { PwaStatus } from '../components/PwaStatus';

export function SettingsPage() {
  const { state, retry, updatePreferences } = useLibrary();
  useEffect(() => { document.title = 'Configurações · Livro a Livro'; }, []);
  const years = state.status === 'ready' ? [...new Set([new Date().getFullYear(), ...(state.preferences.shelfYear === null ? [] : [state.preferences.shelfYear]), ...state.snapshot.books.map(book => book.shelfYear)])].sort((a, b) => b - a) : [];
  return <section className="page-content" aria-labelledby="settings-title">
    <h1 id="settings-title">Configurações</h1>
    <h2>Sua estante</h2>
    <p>As escolhas abaixo também se aplicam à estante. Você pode alterá-las a qualquer momento.</p>
    {state.status !== 'ready' ? <LibraryState state={state.status} onRetry={retry} /> : <div className="settings-preferences">
      <label className="form-field">Ano da estante<select value={state.preferences.shelfYear ?? 'current'} onChange={event => updatePreferences({ shelfYear: event.target.value === 'current' ? null : Number(event.target.value) })}>
        <option value="current">Ano atual (automático)</option>{years.map(year => <option key={year} value={year}>{formatShelfYear(year)}</option>)}
      </select></label>
      <label className="form-field">Visualização inicial<select value={state.preferences.mode} onChange={event => updatePreferences({ mode: event.target.value as PortablePreferences['mode'] })}>
        <option value="grid">Grade</option><option value="list">Lista</option>
      </select></label>
      <label className="form-field">Filtro inicial<select value={state.preferences.filter} onChange={event => updatePreferences({ filter: event.target.value as PortablePreferences['filter'] })}>
        <option value="all">Todos</option><option value="read">Lidos</option><option value="reading">Lendo</option><option value="want-to-read">Quero ler</option>
      </select></label>
      {state.preferenceError && <div role="alert"><p>Não foi possível guardar estas preferências. Elas valem nesta sessão, mas podem se perder ao reabrir o aplicativo.</p><button className="button button-secondary" onClick={() => updatePreferences(state.preferences)}>Tentar salvar preferências</button></div>}
    </div>}
    <h2>Aplicativo</h2>
    <p>Versão {__APP_VERSION__} · build {__BUILD_ID__}{import.meta.env.DEV ? ' · desenvolvimento' : ''}</p>
    <PwaStatus detailed />
    <div className="form-actions"><Link className="button button-secondary" to="/instalar">Como instalar</Link><Link className="button button-secondary" to="/dados">Seus dados e backup</Link></div>
  </section>;
}
