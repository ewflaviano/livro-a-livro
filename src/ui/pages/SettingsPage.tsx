import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAnalytics } from '../../analytics/AnalyticsProvider';
import { useDiagnostics } from '../../diagnostics/DiagnosticsProvider';
import { PwaStatus } from '../components/PwaStatus';

export function SettingsPage() {
  const analytics = useAnalytics();
  const diagnostics = useDiagnostics();
  useEffect(() => { document.title = 'Configurações · Livro a Livro'; }, []);
  return <section className="page-content" aria-labelledby="settings-title">
    <h1 id="settings-title">Configurações</h1>
    <section aria-labelledby="analytics-settings-title">
      <h2 id="analytics-settings-title">Visitas ao site</h2>
      <p>Google Analytics: {analytics.loading ? 'Verificando…' : analytics.error ? 'Não foi possível verificar' : analytics.choice === 'accepted' ? 'Aceito' : analytics.choice === 'rejected' ? 'Recusado' : 'Ainda não escolhida'}.</p>
      <button className="button button-secondary" aria-label="Revisar escolha de Analytics" onClick={analytics.review}>Rever escolha</button>
    </section>
    <section aria-labelledby="diagnostics-settings-title">
      <h2 id="diagnostics-settings-title">Diagnóstico de erros</h2>
      <p>Envio de códigos técnicos: {diagnostics.loading ? 'Verificando…' : diagnostics.error ? 'Indisponível' : diagnostics.choice === 'accepted' ? 'Aceito' : diagnostics.choice === 'rejected' ? 'Recusado' : 'Desligado'}.</p>
      {!diagnostics.loading && (diagnostics.choice === null || diagnostics.reviewing) ? <>
        <p className="field-help">Ajuda a identificar falhas do aplicativo. Não envia seus livros ou detalhes do erro.</p>
        <div className="form-actions">
          <button className="button button-secondary" disabled={diagnostics.saving} onClick={() => void diagnostics.choose('rejected')}>Recusar diagnóstico</button>
          <button className="button button-primary" disabled={diagnostics.saving || diagnostics.error} onClick={() => void diagnostics.choose('accepted')}>Aceitar diagnóstico</button>
          {diagnostics.reviewing && <button className="button button-quiet" onClick={diagnostics.closeReview}>Fechar</button>}
        </div>
      </> : !diagnostics.loading && <button className="button button-secondary" onClick={diagnostics.review}>Rever diagnóstico</button>}
      {diagnostics.error && <p role="alert">Não foi possível verificar sua escolha. O diagnóstico está desligado. <button className="button button-secondary" onClick={diagnostics.retry}>Tentar novamente</button></p>}
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
