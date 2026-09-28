import { useEffect, useSyncExternalStore } from 'react';
import { Link } from 'react-router-dom';
import { getInstallState, requestInstall, startInstallObservation, subscribeInstall } from '../../pwa/install';

export function InstallPage() {
  useEffect(() => { document.title = 'Instalar · Livro a Livro'; startInstallObservation(); }, []);
  const state = useSyncExternalStore(subscribeInstall, getInstallState);
  return <section className="page-content" aria-labelledby="install-title">
    <h1 id="install-title">Instalar</h1>
    <p>Adicione o Livro a Livro à tela inicial.</p>
    {state.installed ? <p role="status">Aplicativo instalado neste dispositivo, conforme informado pelo navegador.</p> : <>
      {state.available && <button className="button button-primary" onClick={() => void requestInstall()}>Instalar aplicativo</button>}
      {state.busy && <p role="status">Aguardando sua escolha no navegador…</p>}
      {state.outcome === 'accepted' && <p role="status">Pedido aceito. Aguarde o navegador concluir a instalação.</p>}
      {state.outcome === 'dismissed' && <p role="status">Instalação cancelada. Você pode continuar por aqui.</p>}
      {state.outcome === 'failed' && <p role="status">Não foi possível abrir a instalação. Use as instruções abaixo ou tente novamente pelo navegador.</p>}
      <h2>Android e Chrome</h2>
      <p>Abra o menu do Chrome (três pontos) e escolha “Instalar aplicativo” ou “Adicionar à tela inicial”.</p>
      <h2>iPhone e iPad com Safari</h2>
      <p>No Safari, toque em Compartilhar → Adicionar à Tela de Início → Adicionar.</p>
    </>}
    <p>Instalar não cria backup. A estante funciona offline após a preparação inicial; busca e capas externas precisam de conexão.</p>
    <Link className="button button-secondary" to="/dados">Abrir backup local</Link>
  </section>;
}
