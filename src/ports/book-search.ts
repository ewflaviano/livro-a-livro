import { z } from 'zod';
import { BOOK_LIMITS, instantSchema, type NewBook } from '../domain/book';

export const candidateSchema = z.strictObject({
  workId: z.string().regex(/^OL[1-9]\d*W$/u),
  title: z.string().trim().min(1).max(BOOK_LIMITS.title),
  authors: z.array(z.string().min(1).max(BOOK_LIMITS.author)).max(BOOK_LIMITS.authors),
  coverId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).nullable(),
  editionId: z.string().regex(/^OL[1-9]\d*M$/u).nullable(),
  firstPublishedYear: z.number().int().min(1).max(9999).nullable(), retrievedAt: instantSchema,
});
export type BookCandidate = z.infer<typeof candidateSchema>;
export type BookDetails = { candidate: BookCandidate; edition: {
  id: string; title: string | null; publicationYear: number | null; pageCount: number | null;
  isbn: string | null; coverId: number | null;
} | null };
export type SearchPage = { candidates: BookCandidate[]; page: number; hasMore: boolean; cached: boolean };
export type BookSearch = {
  search(query: string, page: number, signal: AbortSignal): Promise<SearchPage>;
  details(candidate: BookCandidate, signal: AbortSignal): Promise<BookDetails>;
};
export type SearchCache = {
  read(key: string, now: number): Promise<SearchPage | null>;
  write(key: string, page: SearchPage, now: number): Promise<void>;
  claim(now: number): Promise<number>;
  backoff(until: number): Promise<void>;
};
export type SearchErrorCode = 'invalid-query' | 'offline' | 'timeout' | 'cancelled' | 'unavailable' | 'invalid-response' | 'cooldown';
export class SearchError extends Error {
  constructor(readonly code: SearchErrorCode) { super(code); this.name = 'SearchError'; }
}
export function candidateDraft({ candidate, edition }: BookDetails): NewBook {
  const coverId = edition?.coverId ?? candidate.coverId;
  const publicationYear = edition?.publicationYear ?? candidate.firstPublishedYear;
  return { title: edition?.title ?? candidate.title, authors: [...candidate.authors],
    cover: coverId ? { provider: 'open_library', coverId } : null,
    ...(publicationYear ? { publicationYear } : {}),
    ...(edition?.pageCount ? { pageCount: edition.pageCount } : {}),
    ...(edition?.isbn ? { isbn: edition.isbn } : {}),
    source: { provider: 'open_library', workId: candidate.workId, editionId: edition?.id ?? null, retrievedAt: candidate.retrievedAt } };
}
