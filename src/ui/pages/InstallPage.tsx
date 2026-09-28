import { useEffect, useSyncExternalStore } from 'react';
import { Link } from 'react-router-dom';
import { getInstallState, requestInstall, startInstallObservation, subscribeInstall } from '../../pwa/install';

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
  const title = guide === 'android' ? 'Android com Chrome' : guide === 'ios' ? 'iPhone ou iPad com Safari' : 'Chrome no computador';
  const text = guide === 'android' ? 'Abra o menu do Chrome (três pontos) e escolha “Instalar aplicativo” ou “Adicionar à tela inicial”.' :
    guide === 'ios' ? 'No Safari, abra Menu da Página ou Compartilhar, escolha “Adicionar à Tela de Início” e toque em Adicionar.' :
    'No menu do Chrome, escolha “Instalar Livro a Livro” ou use o ícone de instalação na barra de endereço, se aparecer.';
  return <section className="install-guide">
    {secondary ? <h3>{title}</h3> : <h2>{title}</h2>}
    {switchBrowser && <p>Abra este site {guide === 'ios' ? 'no Safari' : 'no Chrome'} para seguir estes passos.</p>}
    <p>{text}</p>
  </section>;
}
function InstallInstructions({ hint }: { hint: PlatformHint }) {
  if (!hint.guide) return <div className="install-guides">
    <p>Escolha as instruções do seu dispositivo:</p>
    {guideOrder.map(guide => <GuideText key={guide} guide={guide} switchBrowser={false} />)}
  </div>;
  return <div className="install-guides">
    <GuideText guide={hint.guide} switchBrowser={hint.switchBrowser} />
    <details className="install-other"><summary>Outro dispositivo</summary>
      {guideOrder.filter(guide => guide !== hint.guide).map(guide => <GuideText key={guide} guide={guide} switchBrowser={false} secondary />)}
    </details>
  </div>;
}

export function InstallPage() {
  useEffect(() => { document.title = 'Instalar · Livro a Livro'; startInstallObservation(); }, []);
  const state = useSyncExternalStore(subscribeInstall, getInstallState);
  const hint = detectInstallGuide(navigator.userAgent, navigator.platform, navigator.maxTouchPoints);
  const showInstructions = !state.busy && state.outcome !== 'accepted';
  return <section className="page-content install-page" aria-labelledby="install-title">
    <h1 id="install-title">Instalar</h1>
    {state.installed ? <p role="status">Aplicativo instalado neste dispositivo, conforme informado pelo navegador.</p> : <>
      {state.available && <button className="button button-primary" onClick={() => void requestInstall()}>Instalar aplicativo</button>}
      {state.busy && <p role="status">Aguardando sua escolha no navegador…</p>}
      {state.outcome === 'accepted' && <p role="status">Pedido aceito. Aguarde o navegador concluir a instalação.</p>}
      {state.outcome === 'dismissed' && <p role="status">Instalação cancelada. Você pode continuar por aqui.</p>}
      {state.outcome === 'failed' && <p role="status">Não foi possível abrir a instalação. Use as instruções abaixo ou tente novamente pelo navegador.</p>}
      {showInstructions && (state.available ? <details className="install-other"><summary>Instalar pelo navegador</summary><InstallInstructions hint={hint} /></details> : <InstallInstructions hint={hint} />)}
    </>}
    <p className="field-help">Instalar não cria backup; a estante preparada funciona offline.</p>
    <Link className="install-backup-link" to="/dados">Abrir backup local</Link>
  </section>;
}
