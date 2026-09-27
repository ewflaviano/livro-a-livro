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
let reloadPage = () => window.location.reload();
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

function reconcileWaiting() {
  const waiting = registration?.waiting;
  const replacement = waiting && registration?.active && waiting !== registration.active && registration.active.state === 'activated';
  if (!replacement) {
    if (state.update !== 'applying') publish({ update: 'none' });
  } else if (state.update === 'none') publish({ update: 'available' });
}

let checkRegistration: (() => Promise<boolean>) | undefined;
export async function checkPwaUpdate() { return await checkRegistration?.() ?? false; }

async function refreshAvailability() {
  reconcileWaiting();
  if (!registration?.active) return;
  try {
    const response = await ask(registration.active, 'OFFLINE_STATUS');
    publish({ availability: response.ready === true ? 'ready' : 'unavailable' });
  } catch { publish({ availability: 'unavailable' }); }
}

function finishActivation() {
  const shouldReload = reloadRequested && !state.blocked;
  reloadRequested = false;
  if (shouldReload) reloadPage();
  else { publish({ update: 'none' }); void refreshAvailability(); }
}

export async function applyPwaUpdate() {
  reconcileWaiting();
  if (state.blocked || state.update === 'none' || state.update === 'applying' || !registration?.waiting) return;
  publish({ update: 'applying' });
  reloadRequested = true;
  const worker = registration.waiting;
  const activated = () => {
    if (worker.state !== 'activated') return;
    worker.removeEventListener('statechange', activated);
    finishActivation();
  };
  worker.addEventListener('statechange', activated);
  try {
    const response = await ask(worker, 'APPLY_UPDATE');
    if (response.applied !== true) { worker.removeEventListener('statechange', activated); reloadRequested = false; publish({ update: 'other-tabs' }); }
  } catch { worker.removeEventListener('statechange', activated); reloadRequested = false; publish({ update: 'failed' }); }
}

export async function registerPwa(reload = () => window.location.reload()) {
  if (started) return;
  started = true;
  reloadPage = reload;
  publish({ online: navigator.onLine });
  window.addEventListener('offline', () => publish({ online: false }));
  window.addEventListener('online', () => { publish({ online: true }); void check(); });
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
  publish({ availability: 'preparing' });
  let lastCheck = 0;
  async function check(force = false): Promise<boolean> {
    if (!registration || (!force && document.visibilityState === 'hidden')) return false;
    reconcileWaiting();
    void refreshAvailability();
    if (!navigator.onLine || (!force && Date.now() - lastCheck < 60_000)) return false;
    lastCheck = Date.now();
    try { await registration.update(); reconcileWaiting(); return true; } catch { return false; }
  }
  checkRegistration = () => check(true);
  try {
    registration = await navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' });
    const observe = () => {
      reconcileWaiting();
      const worker = registration?.installing;
      worker?.addEventListener('statechange', () => {
        // waiting/active may settle after the statechange event (especially first install).
        window.setTimeout(reconcileWaiting, 0);
        if (worker.state === 'activated') void refreshAvailability();
        if (worker.state === 'redundant' && !registration?.active) publish({ availability: 'unavailable' });
      });
    };
    registration.addEventListener('updatefound', observe);
    observe();
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      // Only the consenting tab reloads, and a draft acquired during activation survives.
      finishActivation();
    });
    document.addEventListener('visibilitychange', () => { void check(); });
    window.addEventListener('focus', () => { void check(); });
    void navigator.serviceWorker.ready.then(() => refreshAvailability());
    void refreshAvailability();
  } catch { publish({ availability: 'unavailable' }); }
}
