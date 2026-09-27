/* Build substitutes only these two constants. No runtime API or private data cache. */
const entries = __PRECACHE__;
const prefix = 'livro-a-livro-shell-';
const cacheName = `${prefix}__RELEASE__`;
const urls = new Set(entries.map((entry) => new URL(entry.url, self.location.origin).href));

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(cacheName);
    try {
      // Integrity rejects a partial/mixed CDN deployment. Installation is all-or-nothing.
      for (const entry of entries) {
        const request = new Request(new URL(entry.url, self.location.origin), {
          cache: 'reload', credentials: 'omit', integrity: entry.integrity,
        });
        const response = await fetch(request);
        if (!response.ok || response.type === 'opaque' || response.redirected) throw new Error('ShellUnavailable');
        await cache.put(entry.url, response);
      }
    } catch (error) {
      await caches.delete(cacheName);
      throw error;
    }
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // Natural activation after all tabs close is the only safe cleanup opportunity.
    // Explicit activation keeps prior releases for any tab that opened concurrently.
    if ((await self.clients.matchAll({ type: 'window', includeUncontrolled: true })).length === 0) {
      await Promise.all((await caches.keys()).filter((name) => name.startsWith(prefix) && name !== cacheName)
        .map((name) => caches.delete(name)));
    }
    // No claim(): an already-open document is never silently migrated or reloaded.
  })());
});

self.addEventListener('message', (event) => {
  const port = event.ports[0];
  if (!port || !event.source?.url || new URL(event.source.url).origin !== self.location.origin) return;
  if (event.data?.type === 'OFFLINE_STATUS') {
    event.waitUntil((async () => {
      const cache = await caches.open(cacheName);
      const complete = (await Promise.all(entries.map((entry) => cache.match(entry.url)))).every(Boolean);
      port.postMessage({ ready: complete });
    })());
  } else if (event.data?.type === 'APPLY_UPDATE') {
    event.waitUntil((async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      if (windows.length !== 1 || windows[0].id !== event.source.id) {
        port.postMessage({ applied: false });
        return;
      }
      port.postMessage({ applied: true });
      await self.skipWaiting();
    })());
  }
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  // Query strings, Authorization, all non-GET and foreign origins bypass the SW entirely.
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.search || request.headers.has('authorization')) return;
  const navigation = request.mode === 'navigate' && (url.pathname === '/' || url.pathname === '/index.html');
  if (!navigation && !urls.has(url.href) && !url.pathname.startsWith('/assets/')) return;
  event.respondWith((async () => {
    const cache = await caches.open(cacheName);
    // These caches contain only public, integrity-checked build assets fetched
    // without credentials. Module requests add Origin, unlike precache requests;
    // Vary: Origin must not hide an otherwise identical immutable public asset.
    const cached = await cache.match(navigation ? '/index.html' : request, { ignoreVary: true });
    if (cached) return cached;
    // Old tabs may request their immutable chunks after an explicit update.
    if (url.pathname.startsWith('/assets/')) {
      for (const name of await caches.keys()) {
        if (!name.startsWith(prefix)) continue;
        const previous = await (await caches.open(name)).match(request, { ignoreVary: true });
        if (previous) return previous;
      }
    }
    // Never runtime-cache requests; only build-time public assets are stored.
    return fetch(request);
  })());
});
