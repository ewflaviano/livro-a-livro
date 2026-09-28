import { useState, useSyncExternalStore } from 'react';
import { checkPwaUpdate, getPwaState, subscribePwa } from '../../pwa/register';

export function PwaStatus({ detailed = false, showStatus = true, showUnsupported = false }: { detailed?: boolean; showStatus?: boolean; showUnsupported?: boolean }) {
  const [checking, setChecking] = useState(false);
  const [checkMessage, setCheckMessage] = useState('');
  async function check() {
    setChecking(true); setCheckMessage('');
    const checked = await checkPwaUpdate();
    setChecking(false);
    setCheckMessage(checked ? 'Verificação concluída. Novas versões podem levar alguns instantes para ficar prontas.' : 'Não foi possível verificar agora. Tente novamente com conexão.');
  }
  const state = useSyncExternalStore(subscribePwa, getPwaState);
  if (state.availability === 'unsupported' && !detailed && !showUnsupported) return null;
  return <section className="pwa-status" aria-label={showStatus ? 'Disponibilidade do aplicativo' : 'Atualização do aplicativo'}>
    {showStatus && <p role="status">{!state.online ? 'Sem conexão. ' : ''}{
      state.availability === 'ready' ? 'Aplicativo disponível offline neste navegador.' :
      state.availability === 'unsupported' ? 'A preparação offline não está disponível neste contexto.' :
      state.availability === 'preparing' ? 'Preparando o aplicativo para uso offline…' :
      'Não foi possível confirmar o uso offline. Tente abrir o aplicativo novamente com conexão.'
    }</p>}
    {detailed && <p className="field-help">Instalar não cria backup. Busca e capas externas precisam de conexão.</p>}
    {detailed && <button className="button button-secondary" disabled={checking || !state.online || state.availability === 'unsupported'} onClick={() => void check()}>{checking ? 'Verificando…' : 'Verificar atualização'}</button>}
    {checkMessage && <p role="status">{checkMessage}</p>}

  </section>;
}
