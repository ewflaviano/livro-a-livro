import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { openLibraryRepository } from '../adapters/indexeddb/library-repository';
import { openSyncStore } from '../sync/outbox';
import { createAuthClient } from '../sync/api';
import { createDriveClient } from '../sync/drive-client';
import { createSyncCoordinator, type SyncCoordinator } from '../sync/coordinator';
import type { SyncView } from '../sync/contracts';
import { getPwaState } from '../pwa/register';

const local = import.meta.env.DEV && import.meta.env.VITE_LOCAL_MODE === 'true';
const enabled = local || import.meta.env.VITE_DRIVE_ENABLED === 'true';
const initial: SyncView = { status: 'disabled' };
const Context = createContext<{ coordinator: SyncCoordinator | null; state: SyncView; available: boolean; local: boolean }>({ coordinator: null, state: initial, available: false, local });
const noop = () => () => {};
const initialSnapshot = () => initial;
export function SyncProvider({ children }: { children: ReactNode }) {
  const [coordinator, setCoordinator] = useState<SyncCoordinator | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let active = true; let cleanup = () => {};
    void (async () => {
      const repository = await openLibraryRepository();
      try {
        const store = await openSyncStore();
        const fetcher = local ? (await import('../sync/local-client')).localTransport() : fetch;
        const auth = createAuthClient(fetcher);
        const next = createSyncCoordinator({ repository, store, auth, drive: binding => createDriveClient(auth, binding, fetcher),
          online: () => navigator.onLine, visible: () => document.visibilityState !== 'hidden',
          hasDraft: () => getPwaState().blocked, navigate: url => { if (local) { window.location.hash = '/dados'; window.location.reload(); } else window.location.assign(url); },
        });
        const wake = () => { void next.wake().catch(() => {}); };
        cleanup = () => { next.close(); repository.close(); store.close();
          window.removeEventListener('online', wake); window.removeEventListener('focus', wake); document.removeEventListener('visibilitychange', wake); };
        if (!active) { cleanup(); return; }
        window.addEventListener('online', wake); window.addEventListener('focus', wake); document.addEventListener('visibilitychange', wake);
        setCoordinator(next); await next.start();
      } catch { repository.close(); /* Optional sync cannot prevent local startup. */ }
    })();
    return () => { active = false; cleanup(); };
  }, []);
  const state = useSyncExternalStore(coordinator?.subscribe ?? noop, coordinator?.getSnapshot ?? initialSnapshot);
  return <Context.Provider value={{ coordinator, state, available: enabled, local }}>{children}</Context.Provider>;
}
export const useSync = () => useContext(Context);
