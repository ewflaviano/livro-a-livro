import { useEffect, useRef } from 'react';
import { useAnalytics } from '../../analytics/AnalyticsProvider';

export function AnalyticsBanner() {
  const state = useAnalytics(); const ref = useRef<HTMLElement>(null);
  useEffect(() => { if (state.reviewing) ref.current?.querySelector<HTMLButtonElement>('button')?.focus(); }, [state.reviewing]);
  if (state.loading || state.choice !== null && !state.reviewing && !state.error && !state.reloadSuggested) return null;
  return <section ref={ref} className="analytics-banner" aria-label="Escolha sobre uso do aplicativo">
    <div><p>Este site usa o Google Analytics pra contar visitas e envia dados técnicos de erros para melhorar o app. Não mostra anúncios e não segue você por outros sites. Tudo bem?</p>
      {state.choice !== null && <p className="field-help">Escolha atual: {state.choice === 'accepted' ? 'Aceito' : 'Recusado'}.</p>}
      {state.error && <p role="alert">Não foi possível guardar ou verificar sua escolha. A medição está desligada. Tente novamente.</p>}
    </div>
    <div className="analytics-actions"><button className="button button-secondary" disabled={state.saving} onClick={() => void state.choose('rejected')}>Recusar</button>
      <button className="button button-primary" disabled={state.saving} onClick={() => void state.choose('accepted')}>Aceitar</button>
      <a href="/privacidade.html">Saiba mais</a>
      {state.reloadSuggested && <button className="button button-secondary" disabled={state.saving} onClick={state.reload}>Reabrir aplicativo</button>}
      {state.error && <button className="button button-secondary" disabled={state.saving} onClick={state.retry}>Tentar novamente</button>}
      {state.reviewing && <button className="button button-secondary" disabled={state.saving} onClick={state.closeReview}>Fechar</button>}</div>
  </section>;
}
