import { useState, useSyncExternalStore } from 'react';
import { checkPwaUpdate, getPwaState, subscribePwa } from '../../pwa/register';
import { useLocale } from '../../i18n/context';
import type { MessageKey } from '../../i18n/messages';

export function PwaStatus({ detailed = false, showStatus = true, showUnsupported = false }: { detailed?: boolean; showStatus?: boolean; showUnsupported?: boolean }) {
  const { t } = useLocale();
  const [checking, setChecking] = useState(false);
  const [checkMessage, setCheckMessage] = useState<MessageKey | null>(null);
  async function check() {
    setChecking(true); setCheckMessage(null);
    const checked = await checkPwaUpdate();
    setChecking(false);
    setCheckMessage(checked ? 'updateCheckComplete' : 'updateCheckFailed');
  }
  const state = useSyncExternalStore(subscribePwa, getPwaState);
  if (state.availability === 'unsupported' && !detailed && !showUnsupported) return null;
  return <section className="pwa-status" aria-label={showStatus ? t('pwaAvailability') : t('appUpdate')}>
    {showStatus && <p role="status">{!state.online ? t('offlinePrefix') : ''}{
      state.availability === 'ready' ? t('offlineReady') :
      state.availability === 'unsupported' ? t('offlineUnsupported') :
      state.availability === 'preparing' ? t('offlinePreparing') :
      t('offlineUnknown')
    }</p>}
    {detailed && <p className="field-help">{t('installNotBackup')}</p>}
    {detailed && <button className="button button-secondary" disabled={checking || !state.online || state.availability === 'unsupported'} onClick={() => void check()}>{checking ? t('checking') : t('checkUpdate')}</button>}
    {checkMessage && <p role="status">{t(checkMessage)}</p>}

  </section>;
}
