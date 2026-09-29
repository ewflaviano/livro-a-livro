import { useSyncExternalStore } from 'react';
import { applyPwaUpdate, getPwaState, subscribePwa } from '../../pwa/register';
import { getUiOccupancy, subscribeUiOccupancy } from '../interaction-guard';
import { useLocale } from '../../i18n/context';

export function PwaUpdateBanner() {
  const { t } = useLocale();
  const state = useSyncExternalStore(subscribePwa, getPwaState);
  const occupied = useSyncExternalStore(subscribeUiOccupancy, getUiOccupancy);
  const blocked = state.blocked || state.operationPending || occupied > 0;
  if (state.update === 'none' || blocked && state.update !== 'applying') return null;
  return <section className="pwa-update-banner" aria-label={t('appUpdate')}>
    <div><p role="status">{state.update === 'other-tabs' ? t('closeOtherTabs') :
      state.update === 'failed' ? t('updateFailed') :
      state.update === 'reload-ready' ? t('updateReady') :
      state.update === 'applying' ? t('updatingApp') : t('updateAvailable')}</p>
    </div>
    {state.update !== 'applying' && <button className="button button-secondary" onClick={() => void applyPwaUpdate()}>
      {state.update === 'reload-ready' ? t('reopenApp') : t('updateApp')}
    </button>}
  </section>;
}
