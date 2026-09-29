import { useEffect, useSyncExternalStore } from 'react';
import { Link } from 'react-router-dom';
import { Download, Settings, ShieldCheck } from 'lucide-react';
import { getInstallState, subscribeInstall } from '../../pwa/install';
import { useLocale } from '../../i18n/context';

export function MorePage() {
  const { t } = useLocale();
  useEffect(() => { document.title = `${t('more')} · ${t('appName')}`; }, [t]);
  const installed = useSyncExternalStore(subscribeInstall, getInstallState).installed;
  return <section aria-labelledby="more-title">
    <h1 id="more-title">{t('more')}</h1>
    <nav className="more-navigation" aria-label={t('otherOptions')}>
      <Link className="nav-link" to="/dados"><ShieldCheck aria-hidden="true" /><span>{t('yourData')}</span></Link>
      <Link className="nav-link" to="/configuracoes"><Settings aria-hidden="true" /><span>{t('settings')}</span></Link>
      <Link className="nav-link" to="/instalar" aria-label={installed ? t('installInstalled') : undefined}><Download aria-hidden="true" /><span>{t('install')}</span>{installed && <span className="more-install-state">{t('installed')}</span>}</Link>
    </nav>
  </section>;
}
