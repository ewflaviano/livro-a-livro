import { z } from 'zod';
import type { IDBPObjectStore } from 'idb';
import type { LibraryDatabase } from './schema';
import { openDatabase } from './database';
import { candidateSchema } from '../../ports/book-search';
import type { SearchCache, SearchPage } from '../../ports/book-search';
import { SearchError } from '../../ports/book-search';

const pageSchema = z.strictObject({ candidates: z.array(candidateSchema).max(20), page: z.number().int().positive(), hasMore: z.boolean(), cached: z.boolean() });
const entrySchema = z.strictObject({ page: pageSchema, expiresAt: z.number(), lastAccessedAt: z.number(), bytes: z.number().nonnegative() });
const timingSchema = z.object({ nextAt: z.number().finite().nonnegative(), cooldown: z.number().finite().nonnegative() });
const encoder = new TextEncoder();
const timingKey = 'open-library:timing';

/** Separate store only; it never reads books and never participates in backups. */
export function createSearchCache(name?: string): SearchCache {
  async function access<T>(operation: (store: IDBPObjectStore<LibraryDatabase, ['searchCache'], 'searchCache', 'readwrite'>) => Promise<T>): Promise<T> {
    const connection = await openDatabase({ name });
    const transaction = connection.db.transaction('searchCache', 'readwrite');
    // Handle aborted transactions even when a validation/request rejects first.
    void transaction.done.catch(() => {});
    try { const result = await operation(transaction.store); await transaction.done; return result; }
    finally { connection.close(); }
  }
  return {
    read: (key, now) => access(async (store) => {
      const record = entrySchema.safeParse(await store!.get(`query:${key}`));
      if (!record.success || record.data.expiresAt <= now) { await store!.delete(`query:${key}`); return null; }
      await store!.put({ ...record.data, lastAccessedAt: now }, `query:${key}`);
      return { ...record.data.page, cached: true };
    }),
    write: (key, page: SearchPage, now) => access(async (store) => {
      const bytes = encoder.encode(JSON.stringify(page)).length + encoder.encode(key).length;
      await store!.put({ page, bytes, lastAccessedAt: now, expiresAt: now + (page.candidates.length ? 86_400_000 : 300_000) }, `query:${key}`);
      const entries: { key: string; bytes: number; access: number }[] = [];
      let cursor = await store!.openCursor();
      while (cursor) {
        if (typeof cursor.key === 'string' && cursor.key.startsWith('query:')) {
          const record = entrySchema.safeParse(cursor.value);
          if (!record.success || record.data.expiresAt <= now) await cursor.delete();
          else entries.push({ key: cursor.key, bytes: record.data.bytes, access: record.data.lastAccessedAt });
        }
        cursor = await cursor.continue();
      }
      entries.sort((a, b) => a.access - b.access);
      let bytesTotal = entries.reduce((sum, entry) => sum + entry.bytes, 0);
      while (entries.length > 100 || bytesTotal > 5 * 1024 * 1024) {
        const oldest = entries.shift()!; bytesTotal -= oldest.bytes; await store!.delete(oldest.key);
      }
    }),
    claim: (now) => access(async (store) => {
      const parsed = timingSchema.safeParse(await store!.get(timingKey));
      const timing = parsed.success ? parsed.data : { nextAt: 0, cooldown: 0 };
      if (timing.cooldown > now) throw new SearchError('cooldown');
      if (timing.nextAt > now) return timing.nextAt - now;
      await store!.put({ ...timing, nextAt: now + 1100 }, timingKey);
      return 0;
    }),
    backoff: (until) => access(async (store) => {
      const parsed = timingSchema.safeParse(await store!.get(timingKey));
      const timing = parsed.success ? parsed.data : { nextAt: 0, cooldown: 0 };
      await store!.put({ ...timing, cooldown: Math.max(timing.cooldown, until) }, timingKey);
    }),
  };
}
