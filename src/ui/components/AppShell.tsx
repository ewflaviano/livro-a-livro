import { AnalyticsBanner } from './AnalyticsBanner';
import { useEffect, useRef } from 'react';
import { Library, MoreHorizontal, NotebookPen, Plus, Settings, ShieldCheck, UsersRound } from 'lucide-react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useLibrary } from '../../app/LibraryProvider';
import { GlobalSyncControls, GlobalSyncHeader, GlobalSyncAttention } from './GlobalSyncControls';
import { PwaStatus } from './PwaStatus';
import { PwaUpdateBanner } from './PwaUpdateBanner';
import { useLocale, useLocalePreference } from '../../i18n/context';
import { privacyPath } from '../../i18n/locale';
import { FirstVisitLanguageChoice } from './LanguageChoice';

const navigation = [
  { to: '/estante', label: 'shelf', icon: Library },
  { to: '/autores', label: 'authors', icon: UsersRound },
  { to: '/notas', label: 'notesNav', icon: NotebookPen },
  { to: '/dados', label: 'yourData', icon: ShieldCheck },
  { to: '/configuracoes', label: 'settings', icon: Settings },
] as const;

export function AppShell() {
  return <GlobalSyncControls><Shell /></GlobalSyncControls>;
}
function Shell() {
  const { locale, t } = useLocale();
  const languageChoice = useLocalePreference();
  const location = useLocation();
  const main = useRef<HTMLElement>(null);
  const previousPath = useRef(location.pathname);
  const { positions } = useLibrary();
  const returnTo = ['/estante', '/lendo', '/quero-ler', '/autores', '/notas', '/duplicatas'].includes(location.pathname) ? location.pathname : location.state?.returnTo ?? '/estante';
  const showLanguagePrompt = location.pathname !== '/configuracoes' && languageChoice?.suggestChoice === true;

  useEffect(() => {
    if (previousPath.current !== location.pathname) {
      main.current?.focus({ preventScroll: true });
      previousPath.current = location.pathname;
    }
  }, [location.pathname]);

  return (
    <>
      <a className="skip-link" href="#conteudo" onClick={(event) => {
        event.preventDefault();
        main.current?.focus();
      }}>{t('skipToContent')}</a>
      <header className="app-header">
        <Link className="brand" to="/estante" aria-label={`${t('appName')} — ${t('shelf')}`}>
          <span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>
          <span>Livro a Livro</span>
        </Link>
        <GlobalSyncHeader />
      </header>
      <PwaUpdateBanner />
      {showLanguagePrompt && <FirstVisitLanguageChoice />}
      {!showLanguagePrompt && <AnalyticsBanner />}
      <GlobalSyncAttention />
      {import.meta.env.DEV && import.meta.env.VITE_LOCAL_MODE === 'true' && <p className="local-test-notice">{t('localTestNotice')}</p>}
      <div className="app-layout">
        <aside className="sidebar">
          <nav aria-label={t('mainNavigation')}>
            {navigation.map(({ to, label, icon: Icon }) => (
              <NavLink key={to} to={to} className={({ isActive }) => `nav-link${isActive ? ' is-active' : ''}`}>
                <Icon aria-hidden="true" /><span>{t(label)}</span>
              </NavLink>
            ))}
          </nav>
        </aside>
        <main id="conteudo" ref={main} tabIndex={-1}><Outlet /></main>
      </div>
      <nav className="bottom-navigation" aria-label={t('mobileNavigation')}>
        <Link to="/estante" aria-current={['/estante', '/lendo', '/quero-ler'].includes(location.pathname) ? 'page' : undefined}>
          <Library aria-hidden="true" /><span>{t('shelf')}</span>
        </Link>
        <NavLink to="/autores"><UsersRound aria-hidden="true" /><span>{t('authors')}</span></NavLink>
        <NavLink to="/adicionar" state={{ returnTo }} onClick={() => positions.set(returnTo, window.scrollY)}>
          <Plus aria-hidden="true" /><span>{t('add')}</span>
        </NavLink>
        <NavLink to="/notas" aria-label={t('notesNotebook')}><NotebookPen aria-hidden="true" /><span>{t('notesNav')}</span></NavLink>
        <Link to="/mais" aria-current={['/mais', '/dados', '/duplicatas', '/configuracoes', '/instalar', '/apoiar'].includes(location.pathname) ? 'page' : undefined}>
          <MoreHorizontal aria-hidden="true" /><span>{t('more')}</span>
        </Link>
      </nav>
      {location.pathname !== '/configuracoes' && <PwaStatus />}
      <footer className="app-footer"><span>{t('footerTagline')}</span><div className="footer-links"><a href={privacyPath(locale)}>{t('privacy')}</a><Link to="/apoiar">{t('supportProject')}</Link></div></footer>
    </>
  );
}
