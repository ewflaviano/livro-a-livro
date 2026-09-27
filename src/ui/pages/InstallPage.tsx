import { useEffect, useSyncExternalStore } from 'react';
import { Link } from 'react-router-dom';
import { getInstallState, requestInstall, startInstallObservation, subscribeInstall } from '../../pwa/install';

export function InstallPage() {
  useEffect(() => { document.title = 'Instalar · Livro a Livro'; startInstallObservation(); }, []);
  const state = useSyncExternalStore(subscribeInstall, getInstallState);
  return <section className="page-content" aria-labelledby="install-title">
    <h1 id="install-title">Instalar</h1>
    <p>Tenha um atalho para o Livro a Livro na sua tela inicial. Você também pode continuar usando este navegador.</p>
    {state.installed ? <p role="status">Aplicativo instalado neste dispositivo, conforme informado pelo navegador.</p> : <>
      {state.available && <button className="button button-primary" onClick={() => void requestInstall()}>Instalar aplicativo</button>}
      {state.busy && <p role="status">Aguardando sua escolha no navegador…</p>}
      {state.outcome === 'accepted' && <p role="status">Pedido aceito. Aguarde o navegador concluir a instalação.</p>}
      {state.outcome === 'dismissed' && <p role="status">Instalação cancelada. Você pode continuar por aqui.</p>}
      {state.outcome === 'failed' && <p role="status">Não foi possível abrir a instalação. Use as instruções abaixo ou tente novamente pelo navegador.</p>}
      <h2>Android e Chrome</h2>
      <p>No menu do Chrome (três pontos), procure “Instalar e criar atalho”, depois “Instalar”. Em outras versões, procure “Instalar aplicativo” ou “Adicionar à tela inicial” e confirme. A opção pode variar conforme o navegador. O botão acima aparece somente quando o navegador oferece a instalação.</p>
      <h2>iPhone e iPad com Safari</h2>
      <p>Abra este endereço no Safari. Toque em Compartilhar, depois em “Adicionar à Tela de Início” e confirme em Adicionar. Se aparecer “Abrir como App da Web”, mantenha essa opção ativada.</p>
    </>}
    <p>Instalar não cria backup nem garante que o navegador conservará seus registros. Seus livros ficam neste navegador e neste endereço; outro endereço ou navegador pode mostrar outra estante.</p>
    <p>Depois da preparação offline, as tarefas locais funcionam sem conexão. Busca e capas externas precisam de internet.</p>
    <Link className="button button-secondary" to="/dados">Abrir backup local</Link>
  </section>;
}
