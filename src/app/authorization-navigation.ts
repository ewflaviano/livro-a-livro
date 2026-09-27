import { getPwaState } from '../pwa/register';
import { SyncError } from '../sync/contracts';

// Recheck after the authorization request, immediately before leaving the document.
export function assertAuthorizationNavigationSafe() {
  const state = getPwaState();
  if (state.blocked || state.update === 'applying') throw new SyncError('cancelled');
}
