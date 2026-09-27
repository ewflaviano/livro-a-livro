import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const origin = 'https://livro.test';
const entries = [{ url: '/index.html', integrity: 'sha256-test' }, { url: '/assets/app-123.js', integrity: 'sha256-test' }];
const source = readFileSync(new URL('./service-worker.js', import.meta.url), 'utf8')
  .replace('__PRECACHE__', JSON.stringify(entries)).replace('__RELEASE__', 'test');
function environment() {
  const handlers = new Map<string, (event: any) => void>();
  const stores = new Map<string, Map<string, Response>>();
  const key = (request: string | Request) => new URL(typeof request === 'string' ? request : request.url, origin).href;
  const caches = {
    open: async (name: string) => {
      if (!stores.has(name)) stores.set(name, new Map());
      return { put: async (request: string | Request, response: Response) => { stores.get(name)!.set(key(request), response); },
        match: async (request: string | Request, options?: { ignoreVary?: boolean }) => {
          const response = stores.get(name)!.get(key(request));
          // Precache uses cache.put(url, response), so its stored request has no
          // Origin. Native module requests include it; ordinary fetch may not.
          if (!options?.ignoreVary && response?.headers.get('vary')?.toLowerCase().split(/,\s*/).includes('origin') &&
            typeof request !== 'string' && request.headers.has('Origin')) return undefined;
          return response;
        } };
    },
    keys: async () => [...stores.keys()], delete: vi.fn(async (name: string) => stores.delete(name)),
  };
  const clients = { matchAll: vi.fn(async () => [{ id: 'tab' }]) };
  const skipWaiting = vi.fn();
  const fetch = vi.fn(async () => new Response('public shell'));
  runInNewContext(source, { self: { location: { origin }, clients, skipWaiting,
    addEventListener: (name: string, handler: (event: any) => void) => handlers.set(name, handler) },
    Request, Response, URL, caches, fetch });
  async function lifecycle(name: string) {
    let promise: Promise<unknown> | undefined;
    handlers.get(name)!({ waitUntil: (next: Promise<unknown>) => { promise = next; } });
    await promise;
  }
  async function message(type: string) {
    const postMessage = vi.fn(); let promise: Promise<unknown> | undefined;
    handlers.get('message')!({ data: { type }, source: { id: 'tab', url: origin }, ports: [{ postMessage }],
      waitUntil: (next: Promise<unknown>) => { promise = next; } });
    await promise; return postMessage;
  }
  return { handlers, stores, caches, clients, fetch, skipWaiting, lifecycle, message };
}
describe('public app-shell worker', () => {
  it('installs only the manifest allowlist with integrity and omitted credentials', async () => {
    const env = environment(); await env.lifecycle('install');
    expect(env.fetch).toHaveBeenCalledTimes(entries.length);
    const requests = env.fetch.mock.calls as unknown as [Request][];
    expect(requests.map(([request]) => request.url)).toEqual(entries.map(({ url }) => origin + url));
    expect(requests.every(([request]) => request.credentials === 'omit' && request.integrity === 'sha256-test')).toBe(true);
    expect((await env.message('OFFLINE_STATUS')).mock.calls[0][0]).toEqual({ ready: true });
    expect(env.skipWaiting).not.toHaveBeenCalled();
  });
  it('removes incomplete cache and fails installation without touching other caches', async () => {
    const env = environment(); env.fetch.mockRejectedValueOnce(new Error('network'));
    await env.caches.open('unrelated');
    await expect(env.lifecycle('install')).rejects.toThrow('network');
    expect([...env.stores.keys()]).toEqual(['unrelated']);
  });
  it.each([
    [origin + '/backup.json', 'GET'], [origin + '/api/token', 'GET'],
    [origin + '/index.html?code=private', 'GET'], [origin + '/assets/app-123.js', 'POST'],
    ['https://www.googleapis.com/drive/v3/files', 'GET'], ['https://covers.openlibrary.org/b/id/1.jpg', 'GET'],
  ])('does not intercept %s %s', (url, method) => {
    const env = environment(); const respondWith = vi.fn();
    env.handlers.get('fetch')!({ request: new Request(url, { method }), respondWith });
    expect(respondWith).not.toHaveBeenCalled(); expect(env.fetch).not.toHaveBeenCalled();
  });
  it('rejects authorization even on an allowlisted URL', () => {
    const env = environment(); const respondWith = vi.fn();
    env.handlers.get('fetch')!({ request: new Request(origin + '/index.html', { headers: { Authorization: 'Bearer private' } }), respondWith });
    expect(respondWith).not.toHaveBeenCalled();
  });
  it('serves public shell offline without runtime caching private data', async () => {
    const env = environment(); await env.lifecycle('install'); env.fetch.mockRejectedValue(new Error('offline'));
    let result: Promise<Response> | undefined;
    env.handlers.get('fetch')!({ request: { url: origin + '/', method: 'GET', mode: 'navigate', headers: new Headers() },
      respondWith: (promise: Promise<Response>) => { result = promise; } });
    expect(await (await result)!.text()).toBe('public shell');
  });
  it('serves current and previous public modules with Vary Origin offline', async () => {
    const env = environment();
    env.fetch.mockImplementation(async () => new Response('public module', { headers: { 'Content-Type': 'text/javascript', Vary: 'Origin' } }));
    await env.lifecycle('install');
    const old = await env.caches.open('livro-a-livro-shell-previous');
    await old.put('/assets/previous.js', new Response('previous module', { headers: { 'Content-Type': 'text/javascript', Vary: 'Origin' } }));
    env.fetch.mockClear(); env.fetch.mockRejectedValue(new Error('offline'));
    for (const [path, body] of [['/assets/app-123.js', 'public module'], ['/assets/previous.js', 'previous module']]) {
      // Node Request preserves this header, modeling the native module request
      // observed in CDP; browser-authored JS cannot manually add forbidden Origin.
      const request = new Request(origin + path, { headers: { Origin: origin } });
      expect(request.headers.get('Origin')).toBe(origin);
      let result: Promise<Response> | undefined;
      env.handlers.get('fetch')!({ request, respondWith: (response: Promise<Response>) => { result = response; } });
      expect(await (await result)!.text()).toBe(body);
    }
    expect(env.fetch).not.toHaveBeenCalled();
  });
  it('defers updates with other windows and retains old caches when any window exists', async () => {
    const env = environment(); await env.caches.open('livro-a-livro-shell-old'); await env.caches.open('unrelated');
    env.clients.matchAll.mockResolvedValue([{ id: 'tab' }, { id: 'other' }]);
    expect((await env.message('APPLY_UPDATE')).mock.calls[0][0]).toEqual({ applied: false });
    expect(env.skipWaiting).not.toHaveBeenCalled();
    await env.lifecycle('activate'); expect(env.caches.delete).not.toHaveBeenCalled();
    env.clients.matchAll.mockResolvedValue([{ id: 'tab' }]);
    expect((await env.message('APPLY_UPDATE')).mock.calls[0][0]).toEqual({ applied: true });
    expect(env.skipWaiting).toHaveBeenCalledOnce();
    env.clients.matchAll.mockResolvedValue([]); await env.lifecycle('activate');
    expect([...env.stores.keys()]).toEqual(['unrelated']);
  });
});
