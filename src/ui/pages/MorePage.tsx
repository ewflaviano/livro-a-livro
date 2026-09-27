import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Heart, Settings, ShieldCheck } from 'lucide-react';

export function MorePage() {
  useEffect(() => { document.title = 'Mais · Livro a Livro'; }, []);
  return <section aria-labelledby="more-title">
    <h1 id="more-title">Mais</h1>
    <nav className="more-navigation" aria-label="Outras opções">
      <Link className="nav-link" to="/dados"><ShieldCheck aria-hidden="true" /><span>Seus dados<small>Backup local e Google Drive opcional</small></span></Link>
      <Link className="nav-link" to="/configuracoes"><Settings aria-hidden="true" /><span>Configurações<small>Preferências do aplicativo</small></span></Link>
      <Link className="nav-link" to="/apoiar"><Heart aria-hidden="true" /><span>Apoiar<small>Conheça o projeto</small></span></Link>
    </nav>
  </section>;
}
