// A failed revocation must keep all optional processing off until a durable choice succeeds.
const KEY = 'livro-a-livro-usage-suspended-v1';
export const USAGE_SUSPENSION_EVENT = 'livro-usage-suspension-changed';
let suspendedInMemory = false;

export function isUsageSuspended(): boolean {
  if (suspendedInMemory) return true;
  if (typeof window === 'undefined') return false;
  try { return window.localStorage.getItem(KEY) === '1'; }
  catch { return false; }
}

export function suspendUsage() {
  suspendedInMemory = true;
  try { window.localStorage.setItem(KEY, '1'); } catch { /* Memory still fails closed in this tab. */ }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(USAGE_SUSPENSION_EVENT));
}

export function clearUsageSuspension() {
  suspendedInMemory = false;
  try { window.localStorage.removeItem(KEY); } catch { /* A stale marker remains fail closed. */ }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(USAGE_SUSPENSION_EVENT));
}
