import { useEffect, useRef } from 'react';
import { useAnalytics } from '../../analytics/AnalyticsProvider';
import { useLocale } from '../../i18n/context';

export function AnalyticsBanner() {
  const { t } = useLocale();
  const state = useAnalytics(); const ref = useRef<HTMLElement>(null);
  useEffect(() => { if (state.reviewing) ref.current?.querySelector<HTMLButtonElement>('button')?.focus(); }, [state.reviewing]);
  if (state.loading || state.choice !== null && !state.reviewing && !state.error && !state.reloadSuggested) return null;
  return <section ref={ref} className="analytics-banner" aria-label={t('analyticsChoice')}>
    <div><p>{t('analyticsExplanation')}</p>
      {state.choice !== null && <p className="field-help">{t('currentChoice', { choice: state.choice === 'accepted' ? t('accepted') : t('rejected') })}</p>}
      {state.error && <p role="alert">{t('analyticsChoiceError')}</p>}
    </div>
    <div className="analytics-actions"><button className="button button-secondary" disabled={state.saving} onClick={() => void state.choose('rejected')}>{t('reject')}</button>
      <button className="button button-primary" disabled={state.saving} onClick={() => void state.choose('accepted')}>{t('accept')}</button>
      <a href="/privacidade.html">{t('learnMore')}</a>
      {state.reloadSuggested && <button className="button button-secondary" disabled={state.saving} onClick={state.reload}>{t('reopenApp')}</button>}
      {state.error && <button className="button button-secondary" disabled={state.saving} onClick={state.retry}>{t('retry')}</button>}
      {state.reviewing && <button className="button button-secondary" disabled={state.saving} onClick={state.closeReview}>{t('close')}</button>}</div>
  </section>;
}
