import { useSyncExternalStore } from 'react';
import { applyPwaUpdate, getPwaState, subscribePwa } from '../../pwa/register';

export function PwaStatus() {
  const state = useSyncExternalStore(subscribePwa, getPwaState);
  if (state.availability === 'unsupported') return null;
  return <section className="pwa-status" aria-label="Disponibilidade do aplicativo">
    <p role="status">{!state.online ? 'Sem conexão. ' : ''}{
      state.availability === 'ready' ? 'Aplicativo disponível offline neste navegador.' :
      state.availability === 'preparing' ? 'Preparando o aplicativo para uso offline…' :
      'Não foi possível confirmar o uso offline. Tente abrir o aplicativo novamente com conexão.'
    }</p>
    <p className="field-help">Instalar o aplicativo não cria uma cópia de segurança dos seus livros. A busca e capas externas precisam de conexão.</p>
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
