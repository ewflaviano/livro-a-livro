// A failed revocation must keep all optional processing off until a durable choice succeeds.
const KEY = 'livro-a-livro-usage-suspended-v1';
const CHANNEL = 'livro-a-livro-usage-suspension';
export const USAGE_SUSPENSION_EVENT = 'livro-usage-suspension-changed';
const TAB_ID = typeof crypto !== 'undefined' ? crypto.randomUUID() : 'server';
let suspendedInMemory = false;
let localRevocationPending = false;

function stored(): boolean {
  if (typeof window === 'undefined') return false;
  for (const storage of ['localStorage', 'sessionStorage'] as const) {
    try { if (window[storage].getItem(KEY) === '1') return true; } catch { /* Try the other store. */ }
  }
  return false;
}
function notify(usage: boolean) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event('livro-experiments-changed'));
  if (usage) window.dispatchEvent(new Event(USAGE_SUSPENSION_EVENT));
}
function broadcast(value: 'suspend' | 'resume') {
  if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') return;
  try { const channel = new BroadcastChannel(CHANNEL); channel.postMessage({ value, from: TAB_ID }); channel.close(); } catch { /* Storage/focus remain fallbacks. */ }
}
function apply(value: boolean, notifyUsage: boolean) {
  suspendedInMemory = value;
  for (const storage of ['localStorage', 'sessionStorage'] as const) {
    try { if (value) window[storage].setItem(KEY, '1'); else window[storage].removeItem(KEY); }
    catch { /* In-memory block remains active in this tab. */ }
  }
  notify(notifyUsage);
}

export function isUsageSuspended(): boolean {
  if (suspendedInMemory) return true;
  return stored();
}

export function suspendUsage() {
  localRevocationPending = true;
  apply(true, false); broadcast('suspend');
}

export function clearUsageSuspension() {
  localRevocationPending = false;
  apply(false, false); broadcast('resume');
}

export function listenUsageSuspension() {
  if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') return () => {};
  const channel = new BroadcastChannel(CHANNEL);
  const receive = (event: MessageEvent) => {
    if (event.data?.from === TAB_ID) return;
    if (event.data?.value === 'suspend') apply(true, true);
    else if (event.data?.value === 'resume' && !localRevocationPending) apply(false, true);
  };
  channel.addEventListener('message', receive);
  return () => { channel.removeEventListener('message', receive); channel.close(); };
}
