/** Never add free-form values, book data, IDs, tokens, URLs, stacks or timestamps here. */
export type TelemetryEvent = 'exposure' | 'use' | 'error' | 'rollback';
export type TelemetryCode = 'catalog_invalid' | 'catalog_unavailable' | 'sync_unavailable' | 'storage_unavailable';
export type TelemetryItem = { build: string; experiment: string; revision: number; variant: string; event: TelemetryEvent; code?: TelemetryCode; count: number };

const MAX_ITEMS = 20;
const MAX_COUNT = 100;
const MAX_BATCHES_PER_HOUR = 4;
export function createTelemetry(baseUrl: string, fetcher: typeof fetch = fetch) {
  const items = new Map<string, TelemetryItem>();
  const sentAt: number[] = [];
  let enabled = false;
  const key = (item: Omit<TelemetryItem, 'count'>) => JSON.stringify(item);
  return {
    setEnabled(next: boolean) { enabled = next; if (!next) items.clear(); },
    record(item: Omit<TelemetryItem, 'count'>) {
      if (!enabled || items.size >= MAX_ITEMS && !items.has(key(item))) return;
      const current = items.get(key(item));
      items.set(key(item), { ...item, count: Math.min(MAX_COUNT, (current?.count ?? 0) + 1) });
    },
    snapshot() { return [...items.values()]; },
    async flush() {
      const now = Date.now();
      while (sentAt[0] !== undefined && sentAt[0] < now - 3_600_000) sentAt.shift();
      if (!enabled || !baseUrl || !items.size || sentAt.length >= MAX_BATCHES_PER_HOUR || navigator.onLine === false) return false;
      const batch = [...items.values()];
      // Do not retry automatically: retries would turn approximate counters into duplicates.
      items.clear(); sentAt.push(now);
      try {
        const response = await fetcher(`${baseUrl.replace(/\/$/, '')}/v1/telemetry/batches`, {
          method: 'POST', credentials: 'omit', cache: 'no-store', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ items: batch }),
        });
        return response.status === 204;
      } catch { return false; }
    },
  };
}
