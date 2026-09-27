export type PwaState = {
  availability: 'preparing' | 'ready' | 'unavailable' | 'unsupported';
  online: boolean; update: 'none' | 'available' | 'applying' | 'reload-ready' | 'other-tabs' | 'failed'; blocked: boolean;
  operationPending?: boolean;
};
const listeners = new Set<() => void>();
const blockers = new Set<symbol>();
const operations = new Set<symbol>();
let state: PwaState = { availability: 'unsupported', online: true, update: 'none', blocked: false };
let registration: ServiceWorkerRegistration | undefined;
let started = false, reloaded = false, interacted = false, observingInteraction = false;
let startupMounted = false, initialChecked = false, initialDiscovery = true, automaticConsumed = false;
let initialWorker: ServiceWorker | null = null;
let uiIdle = () => true;
let interactionRevision = 0;
let reloadPage = () => window.location.reload();
let attempt: { worker: ServiceWorker; revision: number; acknowledged: boolean; expired: boolean } | undefined;
function publish(patch: Partial<PwaState>) {
  state = { ...state, ...patch }; listeners.forEach(listener => listener());
}
export const getPwaState = () => state;
export const subscribePwa = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
/** Capture only that interaction happened, never its content. Called before React mounts. */
export function observePwaInteraction() {
  if (observingInteraction) return;
  observingInteraction = true;
  const note = () => { interacted = true; interactionRevision++; };
  for (const type of ['pointerdown', 'keydown', 'input', 'touchstart']) document.addEventListener(type, note, { capture: true, passive: true });
}
export function armPwaStartup(isUiIdle: () => boolean) {
  uiIdle = isUiIdle; startupMounted = true; maybeAutomatic();
}
export function reevaluatePwaStartup() { maybeAutomatic(); }
export function blockPwaUpdate(): () => void {
  const token = Symbol(); blockers.add(token); publish({ blocked: true });
  return () => { blockers.delete(token); publish({ blocked: blockers.size > 0 }); maybeAutomatic(); };
}
/** Operations hold reload only; they are deliberately not form/draft blockers. */
export function holdPwaReload(): (() => void) | null {
  if (state.update === 'applying' || reloaded) return null;
  const token = Symbol(); operations.add(token); publish({ operationPending: true });
  return () => { operations.delete(token); publish({ operationPending: operations.size > 0 }); maybeAutomatic(); };
}
const safe = () => !state.blocked && operations.size === 0 && uiIdle() && document.visibilityState !== 'hidden';
function ask(worker: ServiceWorker, type: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const timeout = window.setTimeout(() => { channel.port1.close(); reject(new Error('WorkerUnavailable')); }, 5000);
    channel.port1.onmessage = event => { window.clearTimeout(timeout); channel.port1.close(); resolve(event.data ?? {}); };
    worker.postMessage({ type }, [channel.port2]);
  });
}
function replacement() {
  const waiting = registration?.waiting;
  return waiting && registration?.active && waiting !== registration.active && registration.active.state === 'activated' ? waiting : null;
}
function reconcileWaiting() {
  if (state.update === 'applying' || state.update === 'reload-ready') return;
  if (!replacement()) publish({ update: 'none' });
  else if (state.update === 'none') publish({ update: 'available' });
}
function maybeAutomatic() {
  if (automaticConsumed || !startupMounted || !initialChecked) return;
  if (initialWorker && !['installed', 'activated', 'redundant'].includes(initialWorker.state)) return;
  if (operations.size > 0) return;
  if (interacted || document.visibilityState === 'hidden') { automaticConsumed = true; return; }
  if (!safe()) return;
  automaticConsumed = true;
  if (!initialWorker || replacement() !== initialWorker) return;
  void apply();
}
let checkRegistration: (() => Promise<boolean>) | undefined;
export async function checkPwaUpdate() { return await checkRegistration?.() ?? false; }
async function refreshAvailability() {
  reconcileWaiting();
  if (!registration?.active) return;
  try { const response = await ask(registration.active, 'OFFLINE_STATUS'); publish({ availability: response.ready === true ? 'ready' : 'unavailable' }); }
  catch { publish({ availability: 'unavailable' }); }
}
function reloadOnce() { if (!reloaded) { reloaded = true; reloadPage(); } }
function finishActivation() {
  const current = attempt;
  // A controllerchange alone does not establish that the requested worker activated.
  if (!current || current.worker.state !== 'activated' || reloaded) return;
  if (!current.acknowledged && !current.expired) return;
  attempt = undefined;
  if (!current.expired && safe() && current.revision === interactionRevision) reloadOnce();
  else publish({ update: 'reload-ready' });
}
async function apply() {
  automaticConsumed = true;
  reconcileWaiting();
  if (!safe() || reloaded || state.update === 'applying') return;
  if (state.update === 'reload-ready') { reloadOnce(); return; }
  const worker = replacement(); if (!worker) return;
  const current = { worker, revision: interactionRevision, acknowledged: false, expired: false };
  attempt = current; publish({ update: 'applying' });
  const deadline = window.setTimeout(() => {
    if (attempt !== current) return;
    window.clearTimeout(deadline); current.expired = true; publish({ update: 'failed' }); finishActivation();
  }, 10_000);
  const activated = () => {
    if (worker.state !== 'activated' && worker.state !== 'redundant') return;
    window.clearTimeout(deadline); worker.removeEventListener('statechange', activated);
    if (attempt !== current) return;
    if (worker.state === 'redundant') { attempt = undefined; publish({ update: 'failed' }); }
    else finishActivation();
  };
  worker.addEventListener('statechange', activated);
  try {
    const response = await ask(worker, 'APPLY_UPDATE');
    if (attempt !== current) return;
    if (response.applied !== true) {
      window.clearTimeout(deadline); current.expired = true; publish({ update: 'other-tabs' }); finishActivation();
    } else { current.acknowledged = true; finishActivation(); }
  } catch {
    if (attempt !== current) return;
    window.clearTimeout(deadline); current.expired = true; publish({ update: 'failed' }); finishActivation();
  }
}
export async function applyPwaUpdate() { await apply(); }
export async function registerPwa(reload = () => window.location.reload()) {
  if (started) return;
  started = true; reloadPage = reload; observePwaInteraction();
  publish({ online: navigator.onLine });
  window.addEventListener('offline', () => publish({ online: false }));
  window.addEventListener('online', () => { publish({ online: true }); void check(); });
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
  publish({ availability: 'preparing' });
  let lastCheck = 0;
  async function check(force = false): Promise<boolean> {
    if (!registration || (!force && document.visibilityState === 'hidden')) return false;
    reconcileWaiting(); void refreshAvailability();
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
      if (initialDiscovery) initialWorker = replacement() ?? worker ?? null;
      worker?.addEventListener('statechange', () => {
        window.setTimeout(() => { reconcileWaiting(); maybeAutomatic(); }, 0);
        if (worker.state === 'activated') void refreshAvailability();
        if (worker.state === 'redundant' && !registration?.active) publish({ availability: 'unavailable' });
      });
    };
    registration.addEventListener('updatefound', observe); observe();
    navigator.serviceWorker.addEventListener('controllerchange', () => { finishActivation(); reconcileWaiting(); });
    document.addEventListener('visibilitychange', () => { void check(); });
    window.addEventListener('focus', () => { void check(); });
    void navigator.serviceWorker.ready.then(() => refreshAvailability());
    void refreshAvailability();
    await check(true);
    initialWorker = replacement() ?? registration.installing ?? initialWorker;
    initialDiscovery = false; initialChecked = true; maybeAutomatic();
  } catch { initialDiscovery = false; initialChecked = true; automaticConsumed = true; publish({ availability: 'unavailable' }); }
}
