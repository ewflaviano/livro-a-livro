import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useLocale } from '../../i18n/context';
export function NotFoundPage() {
  const { t } = useLocale();
  useEffect(() => { document.title = `${t('notFound')} · ${t('appName')}`; }, [t]);
  return <section><h1>{t('notFound')}</h1><p>{t('notFoundExplanation')}</p><div className="form-actions"><Link className="button button-primary" to="/estante">{t('backToShelf')}</Link><Link className="button button-secondary" to="/dados">{t('dataAndBackup')}</Link></div></section>;
}
