import { useEffect, useSyncExternalStore } from 'react';
import { Link } from 'react-router-dom';
import { Download, Settings, ShieldCheck } from 'lucide-react';
import { getInstallState, subscribeInstall } from '../../pwa/install';

export function MorePage() {
  useEffect(() => { document.title = 'Mais · Livro a Livro'; }, []);
  const installed = useSyncExternalStore(subscribeInstall, getInstallState).installed;
  return <section aria-labelledby="more-title">
    <h1 id="more-title">Mais</h1>
    <nav className="more-navigation" aria-label="Outras opções">
      <Link className="nav-link" to="/dados"><ShieldCheck aria-hidden="true" /><span>Seus dados</span></Link>
      <Link className="nav-link" to="/configuracoes"><Settings aria-hidden="true" /><span>Configurações</span></Link>
      <Link className="nav-link" to="/instalar" aria-label={installed ? 'Instalar — instalado neste dispositivo' : undefined}><Download aria-hidden="true" /><span>Instalar</span>{installed && <span className="more-install-state">Instalado</span>}</Link>
    </nav>
  </section>;
}
