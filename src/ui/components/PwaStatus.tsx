import { useState, useSyncExternalStore } from 'react';
import { applyPwaUpdate, checkPwaUpdate, getPwaState, subscribePwa } from '../../pwa/register';

export function PwaStatus({ detailed = false }: { detailed?: boolean }) {
  const [checking, setChecking] = useState(false);
  const [checkMessage, setCheckMessage] = useState('');
  async function check() {
    setChecking(true); setCheckMessage('');
    const checked = await checkPwaUpdate();
    setChecking(false);
    setCheckMessage(checked ? 'Verificação concluída. Novas versões podem levar alguns instantes para ficar prontas.' : 'Não foi possível verificar agora. Tente novamente com conexão.');
  }
  const state = useSyncExternalStore(subscribePwa, getPwaState);
  if (state.availability === 'unsupported' && !detailed) return null;
  return <section className="pwa-status" aria-label="Disponibilidade do aplicativo">
    <p role="status">{!state.online ? 'Sem conexão. ' : ''}{
      state.availability === 'ready' ? 'Aplicativo disponível offline neste navegador.' :
      state.availability === 'unsupported' ? 'A preparação offline não está disponível neste contexto.' :
      state.availability === 'preparing' ? 'Preparando o aplicativo para uso offline…' :
      'Não foi possível confirmar o uso offline. Tente abrir o aplicativo novamente com conexão.'
    }</p>
    <p className="field-help">Instalar o aplicativo não cria uma cópia de segurança dos seus livros. A busca e capas externas precisam de conexão.</p>
    {detailed && <button className="button button-secondary" disabled={checking || !state.online || state.availability === 'unsupported'} onClick={() => void check()}>{checking ? 'Verificando…' : 'Verificar atualização'}</button>}
    {checkMessage && <p role="status">{checkMessage}</p>}
    {state.update !== 'none' && <div className="pwa-update">
      <p role="status">{state.update === 'other-tabs' ? 'Feche as outras abas e janelas do Livro a Livro antes de atualizar.' :
        state.update === 'failed' ? 'Não foi possível atualizar agora. Você pode continuar usando sua estante.' : 'Uma atualização do aplicativo está disponível.'}</p>
      {state.blocked && <p>Salve ou descarte suas alterações antes de atualizar.</p>}
      <button className="button button-secondary" type="button" disabled={state.blocked || state.update === 'applying'} onClick={() => void applyPwaUpdate()}>
        {state.update === 'applying' ? 'Atualizando…' : 'Atualizar aplicativo'}
      </button>
      <p className="field-help">A página será reaberta. Seus registros já salvos continuam neste dispositivo.</p>
    </div>}
  </section>;
}
