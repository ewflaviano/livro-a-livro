import { BookOpen } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useLocale } from '../../i18n/context';

type Props =
  | { state: 'loading' }
  | { state: 'error'; onRetry: () => void }
  | { state: 'empty'; returnTo?: string };

/** Used only after composition determines the actual local storage state. */
export function LibraryState(props: Props) {
  const { t } = useLocale();
  if (props.state === 'loading') {
    return <div className="notice-panel" role="status"><p>{t('openingShelf')}</p></div>;
  }
  if (props.state === 'error') {
    return (
      <div className="notice-panel">
        <p role="alert">{t('cannotOpenShelf')}</p>
        <p>{t('dataNotDeleted')}</p>
        <button className="button button-secondary" onClick={props.onRetry}>{t('retry')}</button>
      </div>
    );
  }
  return (
    <div className="notice-panel empty-state">
      <BookOpen aria-hidden="true" />
      <div><h2>{t('startShelf')}</h2>
        <Link className="button button-primary" to="/adicionar" state={{ returnTo: props.returnTo ?? '/estante' }}>{t('addBook')}</Link></div>
    </div>
  );
}
