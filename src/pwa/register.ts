export type PwaState = {
  availability: 'preparing' | 'ready' | 'unavailable' | 'unsupported';
  online: boolean; update: 'none' | 'available' | 'applying' | 'other-tabs' | 'failed'; blocked: boolean;
};
const listeners = new Set<() => void>();
const blockers = new Set<symbol>();
let state: PwaState = { availability: 'unsupported', online: true, update: 'none', blocked: false };
let registration: ServiceWorkerRegistration | undefined;
let started = false;
let reloadRequested = false;
function publish(patch: Partial<PwaState>) {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
}
export const getPwaState = () => state;
export const subscribePwa = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

// Locks contain no content. Future import/export/sync operations can acquire the same guard.
export function blockPwaUpdate(): () => void {
  const token = Symbol(); blockers.add(token); publish({ blocked: true });
  return () => { blockers.delete(token); publish({ blocked: blockers.size > 0 }); };
}

function ask(worker: ServiceWorker, type: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const timeout = window.setTimeout(() => { channel.port1.close(); reject(new Error('WorkerUnavailable')); }, 5000);
    channel.port1.onmessage = (event) => {
      window.clearTimeout(timeout); channel.port1.close(); resolve(event.data ?? {});
    };
    worker.postMessage({ type }, [channel.port2]);
  });
}

async function refreshAvailability() {
  if (!registration?.active) return;
  try {
    const response = await ask(registration.active, 'OFFLINE_STATUS');
    publish({ availability: response.ready === true ? 'ready' : 'unavailable' });
  } catch { publish({ availability: 'unavailable' }); }
}

export async function applyPwaUpdate() {
  if (state.blocked || state.update === 'applying' || !registration?.waiting) return;
  publish({ update: 'applying' });
  reloadRequested = true;
  try {
    const response = await ask(registration.waiting, 'APPLY_UPDATE');
    if (response.applied !== true) { reloadRequested = false; publish({ update: 'other-tabs' }); }
  } catch { reloadRequested = false; publish({ update: 'failed' }); }
}

export async function registerPwa() {
  if (started) return;
  started = true;
  publish({ online: navigator.onLine });
  window.addEventListener('offline', () => publish({ online: false }));
  window.addEventListener('online', () => { publish({ online: true }); void check(); });
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
  publish({ availability: 'preparing' });
  let lastCheck = 0;
  async function check() {
    if (!registration || document.visibilityState === 'hidden') return;
    void refreshAvailability();
    if (!navigator.onLine || Date.now() - lastCheck < 60_000) return;
    lastCheck = Date.now();
    try { await registration.update(); } catch { /* Connectivity does not change saved local data. */ }
  }
  try {
    registration = await navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' });
    const observe = () => {
      if (registration?.waiting) publish({ update: 'available' });
      const worker = registration?.installing;
      worker?.addEventListener('statechange', () => {
        if (worker.state === 'installed' && registration?.waiting) publish({ update: 'available' });
        if (worker.state === 'activated') void refreshAvailability();
        if (worker.state === 'redundant' && !registration?.active) publish({ availability: 'unavailable' });
      });
    };
    registration.addEventListener('updatefound', observe);
    observe();
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      // Other tabs never reload; a new draft acquired while activation was pending also survives.
      if (reloadRequested && !state.blocked) { reloadRequested = false; window.location.reload(); }
      else { reloadRequested = false; publish({ update: 'none' }); void refreshAvailability(); }
    });
    document.addEventListener('visibilitychange', () => { void check(); });
    window.addEventListener('focus', () => { void check(); });
    void navigator.serviceWorker.ready.then(() => refreshAvailability());
    void refreshAvailability();
  } catch { publish({ availability: 'unavailable' }); }
}
