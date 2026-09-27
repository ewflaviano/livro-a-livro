import { useEffect, useRef } from 'react';
import { BookOpen, Bookmark, Library, Plus, Settings, ShieldCheck } from 'lucide-react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';

const navigation = [
  { to: '/estante', label: 'Estante', icon: Library },
  { to: '/lendo', label: 'Lendo', icon: BookOpen },
  { to: '/quero-ler', label: 'Quero ler', icon: Bookmark },
  { to: '/dados', label: 'Seus dados', icon: ShieldCheck },
  { to: '/configuracoes', label: 'Configurações', icon: Settings },
];

export function AppShell() {
  const location = useLocation();
  const main = useRef<HTMLElement>(null);
  const previousPath = useRef(location.pathname);

  useEffect(() => {
    if (previousPath.current !== location.pathname) {
      main.current?.focus();
      previousPath.current = location.pathname;
    }
  }, [location.pathname]);

  return (
    <>
      <a className="skip-link" href="#conteudo" onClick={(event) => {
        event.preventDefault();
        main.current?.focus();
      }}>Pular para o conteúdo</a>
      <header className="app-header">
        <Link className="brand" to="/estante" aria-label="Livro a Livro — Estante">
          <span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>
          <span>Livro a Livro</span>
        </Link>
        <Link className="button button-primary" to="/adicionar"><Plus aria-hidden="true" />Adicionar livro</Link>
      </header>
      <div className="app-layout">
        <aside className="sidebar">
          <nav aria-label="Navegação principal">
            {navigation.map(({ to, label, icon: Icon }) => (
              <NavLink key={to} to={to} className={({ isActive }) => `nav-link${isActive ? ' is-active' : ''}`}>
                <Icon aria-hidden="true" /><span>{label}</span>
              </NavLink>
            ))}
          </nav>
          <p className="sidebar-note">Uma leitura<br />de cada vez.</p>
        </aside>
        <main id="conteudo" ref={main} tabIndex={-1}><Outlet /></main>
      </div>
      <footer className="app-footer">Sua história em livros. Privada, por princípio.</footer>
    </>
  );
}
