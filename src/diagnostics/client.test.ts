import { afterEach, expect, it, vi } from 'vitest';
import { createDiagnosticsClient } from './client';

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
it('sends only fixed enums and bounded counts after opt-in, without credentials or extra fields', async () => {
  const fetcher = vi.fn<typeof fetch>(async () => new Response(null, { status: 204 }));
  const client = createDiagnosticsClient(fetcher, () => true);
  client.record({ area: 'runtime', code: 'runtime_exception' });
  expect(await client.flush()).toBe(false); expect(fetcher).not.toHaveBeenCalled();
  client.setEnabled(true);
  for (let index = 0; index < 20; index++) client.record({ area: 'runtime', code: 'runtime_exception' });
  client.record({ area: 'runtime', code: 'runtime_exception', message: 'PRIVATE book title' } as never);
  expect(await client.flush()).toBe(true);
  expect(fetcher).toHaveBeenCalledOnce();
  const [url, options] = fetcher.mock.calls[0];
  expect(url).toBe('https://api.livroalivro.app.br/v1/diagnostics/errors');
  expect(options).toMatchObject({ method: 'POST', credentials: 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer' });
  expect(JSON.parse(String(options?.body))).toEqual({ area: 'runtime', code: 'runtime_exception', count: 10 });
  expect(new TextEncoder().encode(String(options?.body)).length).toBeLessThanOrEqual(512);
  client.record({ area: 'runtime', code: 'runtime_exception' });
  expect(await client.flush()).toBe(false); expect(fetcher).toHaveBeenCalledOnce();
});
it('never serializes a coercible object into a diagnostic code', async () => {
  const fetcher = vi.fn<typeof fetch>(async () => new Response(null, { status: 204 }));
  const client = createDiagnosticsClient(fetcher, () => true); client.setEnabled(true);
  client.record({ area: 'runtime', code: { toString: () => 'render_failure', toJSON: () => 'PRIVATE book title' } } as never);
  expect(await client.flush()).toBe(false);
  expect(fetcher).not.toHaveBeenCalled();
});
it('does nothing offline, aborts and clears in-memory reports on revocation', async () => {
  let online = false; let release!: (response: Response) => void;
  const fetcher = vi.fn<typeof fetch>(() => new Promise(resolve => { release = resolve; }));
  const client = createDiagnosticsClient(fetcher, () => online); client.setEnabled(true);
  client.record({ area: 'backup', code: 'backup_failed' });
  expect(await client.flush()).toBe(false); expect(fetcher).not.toHaveBeenCalled();
  online = true;
  const sending = client.flush();
  expect(fetcher).toHaveBeenCalledOnce();
  const signal = fetcher.mock.calls[0][1]?.signal;
  client.setEnabled(false);
  expect(signal?.aborted).toBe(true);
  release(new Response(null, { status: 204 }));
  expect(await sending).toBe(false);
  client.setEnabled(true); expect(await client.flush()).toBe(false);
  expect(fetcher).toHaveBeenCalledOnce();
});
it('limits the number of sends in an hour and does not retry a failed POST', async () => {
  const fetcher = vi.fn<typeof fetch>(async () => { throw new Error('synthetic network failure'); });
  const client = createDiagnosticsClient(fetcher, () => true); client.setEnabled(true);
  for (const item of [
    { area: 'runtime', code: 'render_failure' }, { area: 'storage', code: 'storage_unavailable' },
    { area: 'drive', code: 'drive_sync_failed' }, { area: 'search', code: 'search_failed' }, { area: 'backup', code: 'backup_failed' },
  ] as const) { client.record(item); await client.flush(); }
  expect(fetcher).toHaveBeenCalledTimes(4);
});
