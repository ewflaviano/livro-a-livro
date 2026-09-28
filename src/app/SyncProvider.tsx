import { openSyncResolutionRepository } from '../adapters/indexeddb/sync-resolution-repository';
import { recordDiagnostic } from '../diagnostics/client';
import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { openLibraryRepository } from '../adapters/indexeddb/library-repository';
import { openSyncStore } from '../sync/outbox';
import { createAuthClient } from '../sync/api';
import { createDriveClient } from '../sync/drive-client';
import { createSyncCoordinator, type SyncCoordinator } from '../sync/coordinator';
import type { SyncView } from '../sync/contracts';
import { assertAuthorizationNavigationSafe } from './authorization-navigation';
import { getPwaState, holdPwaReload } from '../pwa/register';

const local = import.meta.env.DEV && import.meta.env.VITE_LOCAL_MODE === 'true';
const enabled = local || import.meta.env.VITE_DRIVE_ENABLED === 'true';
const initial: SyncView = { status: 'disabled' };
const Context = createContext<{ coordinator: SyncCoordinator | null; state: SyncView; available: boolean; local: boolean; initializing: boolean }>({ coordinator: null, state: initial, available: false, local, initializing: false });
const noop = () => () => {};
const initialSnapshot = () => initial;
export function SyncProvider({ children }: { children: ReactNode }) {
  const [initializing, setInitializing] = useState(enabled);
  const [coordinator, setCoordinator] = useState<SyncCoordinator | null>(null);
  useEffect(() => {
    if (!enabled) return;
    setInitializing(true);
    let active = true; let cleanup = () => {};
    void (async () => {
      let repository: Awaited<ReturnType<typeof openLibraryRepository>> | undefined;
      try {
        repository = await openLibraryRepository();
        cleanup = () => { repository?.close(); };
        const store = await openSyncStore();
        cleanup = () => { repository?.close(); store.close(); };
        const resolutionRepository = await openSyncResolutionRepository(repository);
        cleanup = () => { repository?.close(); store.close(); resolutionRepository.close(); };
        if (!active) { cleanup(); return; }
        const fetcher = local ? (await import('../sync/local-client')).localTransport() : fetch;
        const auth = createAuthClient(fetcher);
        const next = createSyncCoordinator({ repository, resolutionRepository, store, auth, drive: binding => createDriveClient(auth, binding, fetcher),
          holdReload: holdPwaReload, online: () => navigator.onLine, visible: () => document.visibilityState !== 'hidden',
          hasDraft: () => getPwaState().blocked || getPwaState().update === 'applying', navigate: url => { assertAuthorizationNavigationSafe(); if (local) { window.location.hash = '/dados'; window.location.reload(); } else window.location.assign(url); },
        });
        const wake = () => { void next.wake().catch(() => {}); };
        cleanup = () => { next.close(); repository?.close(); store.close(); resolutionRepository.close();
          window.removeEventListener('online', wake); window.removeEventListener('focus', wake); document.removeEventListener('visibilitychange', wake); };
        if (!active) { cleanup(); return; }
        window.addEventListener('online', wake); window.addEventListener('focus', wake); document.addEventListener('visibilitychange', wake);
        await next.start();
        if (active) setCoordinator(next);
      } catch { cleanup(); if (active) { recordDiagnostic({ area: 'drive', code: 'drive_sync_failed' }); setCoordinator(null); } /* Optional sync cannot prevent local startup. */ }
      finally { if (active) setInitializing(false); }
    })();
    return () => { active = false; cleanup(); };
  }, []);
  const state = useSyncExternalStore(coordinator?.subscribe ?? noop, coordinator?.getSnapshot ?? initialSnapshot);
  return <Context.Provider value={{ coordinator, state, available: enabled, local, initializing }}>{children}</Context.Provider>;
}
export const useSync = () => useContext(Context);
