/** Fixed categories only. Never pass an Error, URL, book, message or identifier here. */
export type Diagnostic =
  | { area: 'runtime'; code: 'render_failure' | 'runtime_exception' | 'unhandled_rejection' }
  | { area: 'storage'; code: 'storage_unavailable' }
  | { area: 'drive'; code: 'drive_sync_failed' }
  | { area: 'search'; code: 'search_failed' }
  | { area: 'backup'; code: 'backup_failed' };

const ORIGIN = 'https://api.livroalivro.app.br';
const MAX_BYTES = 512;
const WINDOW_MS = 15 * 60_000;
const MAX_SENDS = 4;
const MAX_COUNT = 10;
type Item = Diagnostic & { count: number };
function valid(item: unknown): item is Diagnostic {
  if (!item || typeof item !== 'object' || Object.keys(item).length !== 2 || !('area' in item) || !('code' in item)) return false;
  const { area, code } = item;
  if (typeof area !== 'string' || typeof code !== 'string') return false;
  return area === 'runtime' && ['render_failure', 'runtime_exception', 'unhandled_rejection'].includes(code) ||
    area === 'storage' && code === 'storage_unavailable' || area === 'drive' && code === 'drive_sync_failed' ||
    area === 'search' && code === 'search_failed' || area === 'backup' && code === 'backup_failed';
}

export function createDiagnosticsClient(fetcher: typeof fetch = fetch, online: () => boolean = () => navigator.onLine !== false) {
  const counts = new Map<string, Item>();
  const sentAt: number[] = [];
  const seen = new Map<string, number>();
  const controllers = new Set<AbortController>();
  let enabled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let generation = 0;
  const key = (item: Diagnostic) => `${item.area}:${item.code}`;
  const prune = (now: number) => {
    while (sentAt[0] !== undefined && sentAt[0] <= now - 3_600_000) sentAt.shift();
    for (const [name, at] of seen) if (at <= now - WINDOW_MS) seen.delete(name);
  };
  function setEnabled(value: boolean) {
    if (enabled === value) return;
    enabled = value; generation++;
    if (!value) {
      clearTimeout(timer); timer = undefined; counts.clear(); seen.clear();
      for (const controller of controllers) controller.abort(); controllers.clear();
    }
  }
  function record(item: Diagnostic) {
    if (!enabled || !valid(item)) return;
    const now = Date.now(); prune(now);
    const name = key(item);
    if (seen.has(name)) return;
    const previous = counts.get(name);
    counts.set(name, { area: item.area, code: item.code, count: Math.min(MAX_COUNT, (previous?.count ?? 0) + 1) } as Item);
    if (!timer) timer = setTimeout(() => { timer = undefined; void flush(); }, 1000);
  }
  async function flush(): Promise<boolean> {
    clearTimeout(timer); timer = undefined;
    const now = Date.now(); prune(now);
    if (!enabled || !online() || !counts.size || sentAt.length >= MAX_SENDS) return false;
    const item = counts.values().next().value as Item;
    counts.delete(key(item));
    seen.set(key(item), now);
    const body = JSON.stringify(item);
    if (new TextEncoder().encode(body).length > MAX_BYTES) return false;
    const controller = new AbortController(); controllers.add(controller); sentAt.push(now);
    const ticket = generation;
    try {
      const response = await fetcher(`${ORIGIN}/v1/diagnostics/errors`, {
        method: 'POST', credentials: 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer',
        headers: { 'content-type': 'application/json' }, body, signal: controller.signal,
      });
      return ticket === generation && enabled && response.status === 204;
    } catch { return false; }
    finally { controllers.delete(controller); if (enabled && counts.size && !timer) timer = setTimeout(() => { timer = undefined; void flush(); }, 1000); }
  }
  return { setEnabled, record, flush };
}

export const diagnosticsClient = createDiagnosticsClient();
export function recordDiagnostic(item: Diagnostic) { diagnosticsClient.record(item); }
