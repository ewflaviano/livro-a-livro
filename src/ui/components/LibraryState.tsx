import { BookOpen } from 'lucide-react';
import { Link } from 'react-router-dom';

type Props =
  | { state: 'loading' }
  | { state: 'error'; onRetry: () => void }
  | { state: 'empty'; returnTo?: string };

/** Used only after composition determines the actual local storage state. */
export function LibraryState(props: Props) {
  if (props.state === 'loading') {
    return <div className="notice-panel" role="status"><p>Abrindo sua estante neste dispositivo…</p></div>;
  }
  if (props.state === 'error') {
    return (
      <div className="notice-panel">
        <p role="alert">Não foi possível abrir sua estante neste dispositivo.</p>
        <p>Tente novamente. Seus dados não foram apagados.</p>
        <button className="button button-secondary" onClick={props.onRetry}>Tentar novamente</button>
      </div>
    );
  }
  return (
    <div className="notice-panel empty-state">
      <BookOpen aria-hidden="true" />
      <div><h2>Comece sua estante</h2>
        <Link className="button button-primary" to="/adicionar" state={{ returnTo: props.returnTo ?? '/estante' }}>Adicionar livro</Link></div>
    </div>
  );
}
