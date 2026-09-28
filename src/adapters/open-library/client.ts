import { isbnSchema } from '../../domain/book';
import { SearchError, type BookDetails, type BookSearch, type SearchCache } from '../../ports/book-search';
import { normalizeEdition, normalizeResults } from './normalize';

const MAX_BYTES = 2 * 1024 * 1024;
function pause(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new SearchError('cancelled')); return; }
    const abort = () => { clearTimeout(timer); reject(new SearchError('cancelled')); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, milliseconds);
    signal.addEventListener('abort', abort, { once: true });
  });
}
async function boundedJson(response: Response, signal: AbortSignal): Promise<unknown> {
  if (Number(response.headers.get('Content-Length')) > MAX_BYTES || !response.body) throw new SearchError('invalid-response');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', abort, { once: true });
  try {
    while (true) {
      if (signal.aborted) throw new SearchError('cancelled');
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) throw new SearchError('invalid-response');
      chunks.push(value);
    }
    const body = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
    try { return JSON.parse(new TextDecoder().decode(body)); } catch { throw new SearchError('invalid-response'); }
  } finally { signal.removeEventListener('abort', abort); void reader.cancel().catch(() => {}); reader.releaseLock(); }
}

export function createOpenLibraryClient(cache: SearchCache, dependencies = {
  fetch: (url: URL, options: RequestInit) => fetch(url, options), now: () => Date.now(),
  online: () => typeof navigator === 'undefined' || navigator.onLine,
}): BookSearch {
  const editions = new Map<string, BookDetails>();
  async function request(url: URL, signal: AbortSignal): Promise<unknown> {
    if (!dependencies.online()) throw new SearchError('offline');
    let wait: number;
    do {
      if (signal.aborted) throw new SearchError('cancelled');
      try { wait = await cache.claim(dependencies.now()); }
      catch (error) { throw error instanceof SearchError ? error : new SearchError('unavailable'); }
      if (wait) await pause(wait, signal);
    } while (wait);
    if (signal.aborted) throw new SearchError('cancelled');
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal.addEventListener('abort', abort, { once: true });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 10_000);
    try {
      const response = await dependencies.fetch(url, { signal: controller.signal, credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error', headers: { Accept: 'application/json' } });
      if (response.status === 429 || response.status === 503) {
        const retryAfter = response.headers.get('Retry-After');
        const delay = retryAfter && /^\d+$/u.test(retryAfter) ? Number(retryAfter) * 1000 : retryAfter ? Date.parse(retryAfter) - dependencies.now() : NaN;
        await cache.backoff(dependencies.now() + (Number.isFinite(delay) && delay >= 0 ? Math.max(1100, delay) : 60_000));
        throw new SearchError('cooldown');
      }
      if (!response.ok) throw new SearchError('unavailable');
      const result = await boundedJson(response, controller.signal);
      if (controller.signal.aborted) throw new SearchError('cancelled');
      return result;
    } catch (error) {
      if (signal.aborted) throw new SearchError('cancelled');
      if (timedOut) throw new SearchError('timeout');
      throw error instanceof SearchError ? error : new SearchError('unavailable');
    } finally { clearTimeout(timer); signal.removeEventListener('abort', abort); }
  }
  return {
    async search(rawQuery, page, signal) {
      const query = rawQuery.trim().replace(/\s+/gu, ' ');
      if (query.length < 2 || query.length > 200 || !Number.isInteger(page) || page < 1 || page > 1000) throw new SearchError('invalid-query');
      if (signal.aborted) throw new SearchError('cancelled');
      const key = JSON.stringify(['edition-preview-v1', query.toLocaleLowerCase('pt-BR'), page]);
      const cached = await cache.read(key, dependencies.now()).catch(() => null);
      if (signal.aborted) throw new SearchError('cancelled');
      if (cached) return cached;
      const url = new URL('https://openlibrary.org/search.json');
      const isbn = isbnSchema.safeParse(query);
      url.search = new URLSearchParams({ [isbn.success ? 'isbn' : 'q']: isbn.success ? isbn.data : query,
        lang: 'pt', page: String(page), limit: '20', fields: 'key,title,author_name,cover_i,first_publish_year,editions,editions.key' }).toString();
      const result = normalizeResults(await request(url, signal), new Date(dependencies.now()).toISOString(), page);
      if (signal.aborted) throw new SearchError('cancelled');
      await cache.write(key, result, dependencies.now()).catch(() => {});
      return result;
    },
    async details(candidate, signal) {
      if (signal.aborted) throw new SearchError('cancelled');
      if (!candidate.editionId) return { candidate, edition: null };
      const existing = editions.get(candidate.editionId);
      if (existing) return { ...existing, candidate };
      const url = new URL(`https://openlibrary.org/books/${candidate.editionId}.json`);
      const result = normalizeEdition(await request(url, signal), candidate);
      if (signal.aborted) throw new SearchError('cancelled');
      editions.set(candidate.editionId, result);
      if (editions.size > 20) editions.delete(editions.keys().next().value!);
      return result;
    },
  };
}
