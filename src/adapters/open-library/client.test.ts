import { afterEach, describe, expect, it, vi } from 'vitest';
import { createOpenLibraryClient } from './client';
import { normalizeResults } from './normalize';
import { openLibraryCoverUrl } from './covers';
import { candidateDraft, type SearchCache } from '../../ports/book-search';
import { createSearchService } from '../../services/search-service';

const now = Date.parse('2026-09-26T12:00:00.000Z');
const response = { numFound: 1, docs: [{ key: '/works/OL123W', title: 'Teste', author_name: ['Autora'], cover_i: 123, first_publish_year: 1953 }] };
const cache = (): SearchCache => ({ read: vi.fn().mockResolvedValue(null), write: vi.fn().mockResolvedValue(undefined), claim: vi.fn().mockResolvedValue(0), backoff: vi.fn().mockResolvedValue(undefined) });
const make = (fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(response))), store = cache()) => ({
  fetch, store, client: createOpenLibraryClient(store, { fetch, now: () => now, online: () => true }),
});
afterEach(() => vi.useRealTimers());
describe('explicit Open Library lookup', () => {
  it('loads edition metadata while keeping the selected result title and cover', async () => {
    const search = { ...response, docs: [{ ...response.docs[0], editions: { docs: [{ key: '/books/OL456M' }] } }] };
    const edition = { key: '/books/OL456M', works: [{ key: '/works/OL123W' }], title: 'Edição brasileira',
      publish_date: '15 Oct 2007', number_of_pages: 231, isbn_13: ['9780306406157'], covers: [321] };
    const fetch = vi.fn((url: URL) => Promise.resolve(new Response(JSON.stringify(url.pathname.startsWith('/books/') ? edition : search))));
    const { client } = make(fetch);
    const candidate = (await client.search('livro', 1, new AbortController().signal)).candidates[0];
    const details = await client.details(candidate, new AbortController().signal);
    expect(fetch.mock.calls[1][0].pathname).toBe('/books/OL456M.json');
    expect(candidateDraft(details)).toMatchObject({ title: 'Teste', publicationYear: 2007, pageCount: 231,
      isbn: '9780306406157', source: { editionId: 'OL456M' }, cover: { coverId: 123 } });
    expect(candidateDraft({ ...details, candidate: { ...candidate, coverId: null } }).cover).toEqual({ provider: 'open_library', coverId: 321 });
    await client.details(candidate, new AbortController().signal);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('uses only a normalized query, fixed fields and no credentials/referrer', async () => {
    const { client, fetch, store } = make();
    expect(fetch).not.toHaveBeenCalled();
    const page = await client.search('  um   livro ', 1, new AbortController().signal);
    const [url, options] = fetch.mock.calls[0];
    expect(url.origin).toBe('https://openlibrary.org'); expect(url.pathname).toBe('/search.json');
    expect(url.searchParams.get('q')).toBe('um livro'); expect(url.searchParams.get('limit')).toBe('20');
    expect(url.searchParams.get('fields')).toBe('key,title,author_name,cover_i,first_publish_year,editions,editions.key');
    expect(options).toMatchObject({ credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error' });
    expect(page.candidates[0]).toMatchObject({ title: 'Teste', firstPublishedYear: 1953 });
    expect(candidateDraft({ candidate: page.candidates[0], edition: null }).publicationYear).toBe(1953);
    expect(candidateDraft({ candidate: page.candidates[0], edition: null })).not.toHaveProperty('pageCount');
    expect(store.write).toHaveBeenCalledOnce();
  });
  it('normalizes ISBN and rejects invalid requests without fetch', async () => {
    const { client, fetch } = make();
    await expect(client.search('x', 1, new AbortController().signal)).rejects.toMatchObject({ code: 'invalid-query' });
    await client.search('978-0-306-40615-7', 2, new AbortController().signal);
    expect(fetch.mock.calls[0][0].searchParams.get('isbn')).toBe('9780306406157');
    expect(fetch.mock.calls[0][0].searchParams.has('q')).toBe(false);
  });
  it('accepts incomplete works, removes duplicate authors and rejects arbitrary links or missing titles', () => {
    const normalized = normalizeResults({ docs: [{ key: 'OL1W', title: 'Só título', author_name: ['A', ' a ', ''], cover_i: -1 }, { key: 'https://evil.test', title: 'injetado' }] }, new Date(now).toISOString(), 1);
    expect(normalized.candidates).toHaveLength(1); expect(normalized.candidates[0].authors).toEqual([' a ']);
    expect(normalized.candidates[0].coverId).toBeNull();
    expect(() => normalizeResults({ docs: [{ key: '/works/OL1W' }] }, new Date(now).toISOString(), 1)).toThrow('invalid-response');
    expect(openLibraryCoverUrl(123)).toBe('https://covers.openlibrary.org/b/id/123-M.jpg?default=false');
    expect(openLibraryCoverUrl(NaN)).toBeNull(); expect(openLibraryCoverUrl(-1)).toBeNull();
  });
  it.each([429, 503])('persists cooldown on %s with no automatic retry', async (status) => {
    const { client, store, fetch } = make(vi.fn().mockResolvedValue(new Response('', { status, headers: { 'Retry-After': '120' } })));
    await expect(client.search('livro', 1, new AbortController().signal)).rejects.toMatchObject({ code: 'cooldown' });
    expect(store.backoff).toHaveBeenCalledWith(now + 120_000); expect(fetch).toHaveBeenCalledOnce();
  });
  it('uses 60s fallback and handles malformed JSON, oversized bodies and network errors', async () => {
    const limited = make(vi.fn().mockResolvedValue(new Response('', { status: 429 })));
    await expect(limited.client.search('livro', 1, new AbortController().signal)).rejects.toMatchObject({ code: 'cooldown' });
    expect(limited.store.backoff).toHaveBeenCalledWith(now + 60_000);
    for (const body of ['not json', JSON.stringify({ docs: 'invalid' }), ' '.repeat(2 * 1024 * 1024 + 1)]) {
      const { client } = make(vi.fn().mockResolvedValue(new Response(body)));
      await expect(client.search('livro', 1, new AbortController().signal)).rejects.toMatchObject({ code: 'invalid-response' });
    }
    const { client } = make(vi.fn().mockRejectedValue(new TypeError('private error')));
    await expect(client.search('livro', 1, new AbortController().signal)).rejects.toMatchObject({ code: 'unavailable', message: 'unavailable' });
  });
  it('returns valid cache offline and never retries the network', async () => {
    const store = cache(); const fetch = vi.fn();
    const client = createOpenLibraryClient(store, { fetch, now: () => now, online: () => false });
    await expect(client.search('livro', 1, new AbortController().signal)).rejects.toMatchObject({ code: 'offline' });
    vi.mocked(store.read).mockResolvedValue({ candidates: [], page: 1, hasMore: false, cached: true });
    expect((await client.search('livro', 1, new AbortController().signal)).cached).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('times out after 10s and observes caller cancellation', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn((_url, options) => new Promise<Response>((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    }));
    const { client } = make(fetch);
    const pending = expect(client.search('livro', 1, new AbortController().signal)).rejects.toMatchObject({ code: 'timeout' });
    await vi.advanceTimersByTimeAsync(10_001); await pending;
    const controller = new AbortController();
    const cancelled = expect(client.search('outro', 1, controller.signal)).rejects.toMatchObject({ code: 'cancelled' });
    await vi.advanceTimersByTimeAsync(1); controller.abort(); await cancelled;
  });
  it('deduplicates active submissions and discards stale responses even if provider ignores abort', async () => {
    const resolvers: ((value: { candidates: []; page: number; hasMore: boolean; cached: boolean }) => void)[] = [];
    const provider = { search: vi.fn(() => new Promise<{ candidates: []; page: number; hasMore: boolean; cached: boolean }>((resolve) => resolvers.push(resolve))),
      details: vi.fn() };
    const service = createSearchService(provider);
    const first = service.search('one'); expect(service.search('one')).toBe(first);
    const rejected = expect(first).rejects.toMatchObject({ code: 'cancelled' });
    const second = service.search('two');
    resolvers[0]({ candidates: [], page: 1, hasMore: false, cached: false }); await rejected;
    resolvers[1]({ candidates: [], page: 1, hasMore: false, cached: false }); await second;
    expect(provider.search).toHaveBeenCalledTimes(2);
  });
});
