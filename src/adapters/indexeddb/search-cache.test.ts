import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { createSearchCache } from './search-cache';
import type { SearchPage } from '../../ports/book-search';
const empty: SearchPage = { candidates: [], page: 1, hasMore: false, cached: false };
describe('discardable search cache and cross-tab quota', () => {
  it('expires empty pages in 5 minutes and populated pages in 24h', async () => {
    const cache = createSearchCache(crypto.randomUUID());
    await cache.write('empty', empty, 1000);
    expect((await cache.read('empty', 299_999))?.cached).toBe(true);
    expect(await cache.read('empty', 301_000)).toBeNull();
    await cache.write('book', { ...empty, candidates: [{ workId: 'OL1W', title: 'Teste', authors: [], coverId: null, editionId: null, firstPublishedYear: null, retrievedAt: '2026-09-26T12:00:00Z' }] }, 1000);
    expect(await cache.read('book', 86_400_999)).not.toBeNull();
    expect(await cache.read('book', 86_401_000)).toBeNull();
  });
  it('evicts least recently used entries beyond 100 and shares quota across connections', async () => {
    const name = crypto.randomUUID(); const a = createSearchCache(name); const b = createSearchCache(name);
    for (let i = 0; i < 100; i++) await a.write(String(i), empty, 1000 + i);
    await b.read('0', 1101); await b.write('100', empty, 1102);
    expect(await a.read('1', 1103)).toBeNull(); expect(await a.read('0', 1103)).not.toBeNull();
    expect(await Promise.all([a.claim(10_000), b.claim(10_000)])).toEqual([0, 1100]);
    await b.backoff(70_000);
    await expect(a.claim(20_000)).rejects.toMatchObject({ code: 'cooldown' });
    expect(await a.claim(70_000)).toBe(0);
  });
  it('evicts large normalized pages before the 5 MiB budget is exceeded', async () => {
    const cache = createSearchCache(crypto.randomUUID());
    const large: SearchPage = { ...empty, candidates: Array.from({ length: 20 }, (_, index) => ({
      workId: `OL${index + 1}W`, title: 'T'.repeat(500), authors: Array.from({ length: 20 }, (_, author) => `${author}`.padEnd(200, 'a')),
      coverId: null, editionId: null, firstPublishedYear: null, retrievedAt: '2026-09-26T12:00:00Z',
    })) };
    for (let index = 0; index < 60; index++) await cache.write(String(index), large, 1000 + index);
    expect(await cache.read('0', 1061)).toBeNull();
    expect(await cache.read('59', 1061)).not.toBeNull();
  });
});
