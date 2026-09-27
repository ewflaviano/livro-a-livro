import { useSyncExternalStore } from 'react';
import { applyPwaUpdate, getPwaState, subscribePwa } from '../../pwa/register';
import { getUiOccupancy, subscribeUiOccupancy } from '../interaction-guard';

export function PwaUpdateBanner() {
  const state = useSyncExternalStore(subscribePwa, getPwaState);
  const occupied = useSyncExternalStore(subscribeUiOccupancy, getUiOccupancy);
  if (state.update === 'none') return null;
  const blocked = state.blocked || state.operationPending || occupied > 0;
  return <section className="pwa-update-banner" aria-label="Atualização do aplicativo">
    <div><p role="status">{state.update === 'other-tabs' ? 'Feche as outras abas e janelas do Livro a Livro antes de atualizar.' :
      state.update === 'failed' ? 'Não foi possível atualizar agora. Você pode continuar usando sua estante.' :
      state.update === 'reload-ready' ? 'A nova versão está pronta para abrir.' :
      state.update === 'applying' ? 'Atualizando o aplicativo…' : 'Uma atualização do aplicativo está disponível.'}</p>
      {blocked && <p>{state.operationPending ? 'Aguarde as operações em andamento e salve as preferências pendentes.' : 'Conclua ou feche a tarefa aberta antes de atualizar.'}</p>}
    </div>
    <button className="button button-secondary" disabled={blocked || state.update === 'applying'} onClick={() => void applyPwaUpdate()}>
      {state.update === 'applying' ? 'Atualizando…' : state.update === 'reload-ready' ? 'Reabrir aplicativo' : 'Atualizar aplicativo'}
    </button>
  </section>;
}
