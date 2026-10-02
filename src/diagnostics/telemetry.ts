/** Fixed dimensions only. Never pass a book, identifier, URL, token or error text. */
export type TelemetryEvent = 'exposure' | 'use' | 'error' | 'rollback';
export type TelemetryCode = 'catalog_invalid' | 'catalog_unavailable' | 'sync_unavailable' | 'storage_unavailable';
export type TelemetryItem = { build: string; experiment: string; revision: number; variant: string; event: TelemetryEvent; code?: TelemetryCode; count: number };
type Observation = Omit<TelemetryItem, 'count'>;

const MAX_ITEMS = 20;
const MAX_COUNT = 100;
const MAX_BATCHES_PER_HOUR = 4;
const WINDOW_MS = 15 * 60_000;
const FLUSH_DELAY_MS = 30_000;
const EVENTS: readonly TelemetryEvent[] = ['exposure', 'use', 'error', 'rollback'];
const CODES: readonly TelemetryCode[] = ['catalog_invalid', 'catalog_unavailable', 'sync_unavailable', 'storage_unavailable'];

function valid(value: Observation): boolean {
  const keys = Object.keys(value);
  if (keys.length !== (value.event === 'error' ? 6 : 5) ||
    keys.some(key => !['build', 'experiment', 'revision', 'variant', 'event', 'code'].includes(key))) return false;
  return value.build === __APP_VERSION__ && value.experiment === 'shelf-summary-layout' && value.revision === 1 &&
    (value.variant === 'control' || value.variant === 'compact') && EVENTS.includes(value.event) &&
    (value.event === 'error' ? value.code !== undefined && CODES.includes(value.code) : value.code === undefined);
}

export function createTelemetry(baseUrl: string, fetcher: typeof fetch = fetch) {
  const items = new Map<string, TelemetryItem>();
  const seen = new Map<string, number>();
  const sentAt: number[] = [];
  const controllers = new Set<AbortController>();
  let enabled = false;
  let generation = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const key = (item: Observation) => JSON.stringify(item);
  const prune = (now: number) => {
    while (sentAt[0] !== undefined && sentAt[0] <= now - 3_600_000) sentAt.shift();
    for (const [name, at] of seen) if (at <= now - WINDOW_MS) seen.delete(name);
  };
  function setEnabled(next: boolean) {
    if (enabled === next) return;
    enabled = next; generation++;
    if (!next) {
      clearTimeout(timer); timer = undefined; items.clear(); seen.clear();
      for (const controller of controllers) controller.abort();
      controllers.clear();
    }
  }
  function record(item: Observation) {
    if (!enabled || !valid(item)) return;
    const safe: Observation = { build: item.build, experiment: item.experiment, revision: item.revision,
      variant: item.variant, event: item.event, ...(item.code === undefined ? {} : { code: item.code }) };
    const now = Date.now(); prune(now);
    const name = key(safe);
    if (seen.has(name) || items.size >= MAX_ITEMS && !items.has(name)) return;
    const current = items.get(name);
    items.set(name, { ...safe, count: Math.min(MAX_COUNT, (current?.count ?? 0) + 1) });
    if (!timer) timer = setTimeout(() => { timer = undefined; void flush(); }, FLUSH_DELAY_MS);
  }
  async function flush() {
    clearTimeout(timer); timer = undefined;
    const now = Date.now(); prune(now);
    if (!enabled || !baseUrl || !items.size || sentAt.length >= MAX_BATCHES_PER_HOUR || navigator.onLine === false || typeof document !== 'undefined' && document.visibilityState === 'hidden') return false;
    const batch = [...items.values()];
    items.clear();
    for (const item of batch) seen.set(key(item), now);
    const body = JSON.stringify({ items: batch });
    if (new TextEncoder().encode(body).length > 10 * 1024) return false;
    const controller = new AbortController(); controllers.add(controller);
    const ticket = generation; sentAt.push(now);
    try {
      const response = await fetcher(`${baseUrl.replace(/\/$/, '')}/v1/telemetry/batches`, {
        method: 'POST', credentials: 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer',
        headers: { 'content-type': 'application/json' }, body, signal: controller.signal,
      });
      return enabled && ticket === generation && response.status === 204;
    } catch { return false; }
    finally { controllers.delete(controller); }
  }
  return { setEnabled, record, snapshot: () => [...items.values()], flush };
}

export const experimentTelemetry = createTelemetry(import.meta.env.VITE_EXPERIMENTS_API_URL || '');
