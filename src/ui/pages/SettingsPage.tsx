import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAnalytics } from '../../analytics/AnalyticsProvider';
import { PwaStatus } from '../components/PwaStatus';
import { useLocale } from '../../i18n/context';

export function SettingsPage() {
  const { t } = useLocale();
  const analytics = useAnalytics();
  useEffect(() => { document.title = `${t('settings')} · ${t('appName')}`; }, [t]);
  return <section className="page-content" aria-labelledby="settings-title">
    <h1 id="settings-title">{t('settings')}</h1>
    <section aria-labelledby="analytics-settings-title">
      <h2 id="analytics-settings-title">{t('appUsage')}</h2>
      <p>{t('visitsDiagnostics', { choice: analytics.loading ? t('checking') : analytics.error ? t('checkFailed') : analytics.choice === 'accepted' ? t('accepted') : analytics.choice === 'rejected' ? t('rejected') : t('undecided') })}</p>
      {analytics.analyticsUnavailable && <p role="status">{t('analyticsUnavailable')}</p>}
      <button className="button button-secondary" aria-label={t('reviewUsageChoice')} onClick={analytics.review}>{t('reviewChoice')}</button>
    </section>
    <section aria-labelledby="app-settings-title">
      <h2 id="app-settings-title">{t('application')}</h2>
      <p className="settings-version">{t('versionCommit', { version: __APP_VERSION__, commit: __BUILD_ID__ })}{import.meta.env.DEV ? t('development') : ''}</p>
      <PwaStatus showUnsupported />
      <p><Link to="/dados">{t('dataAndBackup')}</Link></p>
      <details className="settings-options"><summary>{t('installUpdate')}</summary>
        <PwaStatus detailed showStatus={false} />
        <Link to="/instalar">{t('howToInstall')}</Link>
      </details>
    </section>
  </section>;
}
