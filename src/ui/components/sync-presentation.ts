import type { SyncView } from '../../sync/contracts';
import type { MessageKey } from '../../i18n/messages';

export const authorizationStates = ['identifying', 'authorize-drive', 'authorization-expired', 'authorization-waiting', 'authorization-error'];
export const syncLabelKeys: Record<SyncView['status'], MessageKey> = {
  identifying: 'syncIdentifying', 'authorize-drive': 'syncAuthorizeDrive',
  'authorization-expired': 'syncAuthorizationExpired', 'authorization-error': 'syncAuthorizationError',
  'authorization-waiting': 'syncAuthorizationWaiting', disabled: 'syncDisabled', paused: 'syncPaused',
  receiving: 'syncReceiving', pending: 'syncPending', syncing: 'syncSyncing', 'connected-empty': 'syncConnectedEmpty',
  synced: 'syncSynced', offline: 'syncOffline', reconnect: 'syncReconnect', error: 'syncError', quota: 'syncQuota', conflict: 'syncConflict',
};
