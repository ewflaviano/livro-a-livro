import { useSyncExternalStore } from 'react';
import { applyPwaUpdate, getPwaState, subscribePwa } from '../../pwa/register';
import { getUiOccupancy, subscribeUiOccupancy } from '../interaction-guard';

export function PwaUpdateBanner() {
  const state = useSyncExternalStore(subscribePwa, getPwaState);
  const occupied = useSyncExternalStore(subscribeUiOccupancy, getUiOccupancy);
  const blocked = state.blocked || state.operationPending || occupied > 0;
  if (state.update === 'none' || blocked && state.update !== 'applying') return null;
  return <section className="pwa-update-banner" aria-label="Atualização do aplicativo">
    <div><p role="status">{state.update === 'other-tabs' ? 'Feche as outras abas e janelas do Livro a Livro antes de atualizar.' :
      state.update === 'failed' ? 'Não foi possível atualizar agora. Você pode continuar usando sua estante.' :
      state.update === 'reload-ready' ? 'A nova versão está pronta para abrir.' :
      state.update === 'applying' ? 'Atualizando o aplicativo…' : 'Uma atualização do aplicativo está disponível.'}</p>
    </div>
    {state.update !== 'applying' && <button className="button button-secondary" onClick={() => void applyPwaUpdate()}>
      {state.update === 'reload-ready' ? 'Reabrir aplicativo' : 'Atualizar aplicativo'}
    </button>}
  </section>;
}
