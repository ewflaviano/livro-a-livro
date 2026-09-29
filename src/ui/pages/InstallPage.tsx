import { useEffect, useSyncExternalStore } from 'react';
import { Link } from 'react-router-dom';
import { getInstallState, requestInstall, startInstallObservation, subscribeInstall } from '../../pwa/install';
import { useLocale } from '../../i18n/context';

type Guide = 'android' | 'ios' | 'desktop';
type PlatformHint = { guide: Guide | null; switchBrowser: boolean };

/** A browser hint for instructions only; native prompt availability comes from the install observer. */
export function detectInstallGuide(userAgent: string, platform = '', maxTouchPoints = 0): PlatformHint {
  const ios = /iPhone|iPad|iPod/i.test(userAgent) || platform === 'MacIntel' && maxTouchPoints > 1;
  if (ios) return { guide: 'ios', switchBrowser: !/Safari\//.test(userAgent) || /CriOS|FxiOS|EdgiOS|OPiOS/i.test(userAgent) };
  if (/Android/i.test(userAgent)) return { guide: 'android', switchBrowser: !/Chrome\//.test(userAgent) || /EdgA|OPR|SamsungBrowser|Firefox|;\s*wv\)|WebView/i.test(userAgent) };
  if (/Chrome\//.test(userAgent) && !/Edg\/|OPR\/|Chromium\//.test(userAgent)) return { guide: 'desktop', switchBrowser: false };
  return { guide: null, switchBrowser: false };
}

const guideOrder: Guide[] = ['android', 'ios', 'desktop'];
function GuideText({ guide, switchBrowser, secondary = false }: { guide: Guide; switchBrowser: boolean; secondary?: boolean }) {
  const { t } = useLocale();
  const title = guide === 'android' ? t('androidChrome') : guide === 'ios' ? t('iosSafari') : t('desktopChrome');
  const text = guide === 'android' ? t('androidGuide') : guide === 'ios' ? t('iosGuide') : t('desktopGuide');
  return <section className="install-guide">
    {secondary ? <h3>{title}</h3> : <h2>{title}</h2>}
    {switchBrowser && <p>{guide === 'ios' ? t('openInSafari') : t('openInChrome')}</p>}
    <p>{text}</p>
  </section>;
}
function InstallInstructions({ hint }: { hint: PlatformHint }) {
  const { t } = useLocale();
  if (!hint.guide) return <div className="install-guides">
    <p>{t('chooseDeviceGuide')}</p>
    {guideOrder.map(guide => <GuideText key={guide} guide={guide} switchBrowser={false} />)}
  </div>;
  return <div className="install-guides">
    <GuideText guide={hint.guide} switchBrowser={hint.switchBrowser} />
    <details className="install-other"><summary>{t('otherDevice')}</summary>
      {guideOrder.filter(guide => guide !== hint.guide).map(guide => <GuideText key={guide} guide={guide} switchBrowser={false} secondary />)}
    </details>
  </div>;
}

export function InstallPage() {
  const { t } = useLocale();
  useEffect(() => { document.title = `${t('install')} · ${t('appName')}`; }, [t]);
  useEffect(() => { startInstallObservation(); }, []);
  const state = useSyncExternalStore(subscribeInstall, getInstallState);
  const hint = detectInstallGuide(navigator.userAgent, navigator.platform, navigator.maxTouchPoints);
  const showInstructions = !state.busy && state.outcome !== 'accepted';
  return <section className="page-content install-page" aria-labelledby="install-title">
    <h1 id="install-title">{t('install')}</h1>
    {state.installed ? <p role="status">{t('appInstalled')}</p> : <>
      {state.available && <button className="button button-primary" onClick={() => void requestInstall()}>{t('installApp')}</button>}
      {state.busy && <p role="status">{t('waitingBrowser')}</p>}
      {state.outcome === 'accepted' && <p role="status">{t('installAccepted')}</p>}
      {state.outcome === 'dismissed' && <p role="status">{t('installDismissed')}</p>}
      {state.outcome === 'failed' && <p role="status">{t('installFailed')}</p>}
      {showInstructions && (state.available ? <details className="install-other"><summary>{t('installViaBrowser')}</summary><InstallInstructions hint={hint} /></details> : <InstallInstructions hint={hint} />)}
    </>}
    <p className="field-help">{t('installPreparedOffline')}</p>
    <Link className="install-backup-link" to="/dados">{t('openLocalBackup')}</Link>
  </section>;
}
