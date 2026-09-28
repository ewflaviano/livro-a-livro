import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAnalytics } from '../../analytics/AnalyticsProvider';
import { PwaStatus } from '../components/PwaStatus';

export function SettingsPage() {
  const analytics = useAnalytics();
  useEffect(() => { document.title = 'Configurações · Livro a Livro'; }, []);
  return <section className="page-content" aria-labelledby="settings-title">
    <h1 id="settings-title">Configurações</h1>
    <section aria-labelledby="analytics-settings-title">
      <h2 id="analytics-settings-title">Visitas ao site</h2>
      <p>Google Analytics: {analytics.loading ? 'Verificando…' : analytics.error ? 'Não foi possível verificar' : analytics.choice === 'accepted' ? 'Aceito' : analytics.choice === 'rejected' ? 'Recusado' : 'Ainda não escolhida'}.</p>
      <button className="button button-secondary" aria-label="Revisar escolha de Analytics" onClick={analytics.review}>Rever escolha</button>
    </section>
    <section aria-labelledby="app-settings-title">
      <h2 id="app-settings-title">Aplicativo</h2>
      <p className="settings-version">Versão {__APP_VERSION__} · commit {__BUILD_ID__}{import.meta.env.DEV ? ' · desenvolvimento' : ''}</p>
      <PwaStatus showUnsupported />
      <p><Link to="/dados">Seus dados e backup</Link></p>
      <details className="settings-options"><summary>Instalação e atualização</summary>
        <PwaStatus detailed showStatus={false} />
        <Link to="/instalar">Como instalar</Link>
      </details>
    </section>
  </section>;
}
