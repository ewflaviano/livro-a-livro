import { z } from 'zod';
import { BOOK_LIMITS, normalizeName } from '../../domain/book';
import { SearchError, type BookCandidate } from '../../ports/book-search';

const responseSchema = z.object({ docs: z.array(z.unknown()).max(20), numFound: z.number().int().nonnegative().optional() });
const documentSchema = z.object({
  key: z.string().regex(/^(?:\/works\/)?OL[1-9]\d*W$/u),
  title: z.string().trim().min(1).max(BOOK_LIMITS.title),
  author_name: z.array(z.string()).optional().catch(undefined),
  cover_i: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional().catch(undefined),
  first_publish_year: z.number().int().min(1).max(9999).optional().catch(undefined),
});
export function normalizeResults(input: unknown, retrievedAt: string, page: number) {
  const parsed = responseSchema.safeParse(input);
  if (!parsed.success) throw new SearchError('invalid-response');
  const candidates: BookCandidate[] = [];
  for (const raw of parsed.data.docs) {
    const parsedDocument = documentSchema.safeParse(raw);
    if (!parsedDocument.success) continue;
    const item = parsedDocument.data;
    const workId = item.key.replace('/works/', '');
    if (candidates.some((candidate) => candidate.workId === workId)) continue;
    const authors = [...new Map((item.author_name ?? []).filter((name) => name.trim().length > 0 && name.length <= BOOK_LIMITS.author)
      .map((name) => [normalizeName(name), name])).values()].slice(0, BOOK_LIMITS.authors);
    candidates.push({ workId, title: item.title, authors, coverId: item.cover_i ?? null,
      firstPublishedYear: item.first_publish_year ?? null, retrievedAt });
  }
  if (parsed.data.docs.length && !candidates.length) throw new SearchError('invalid-response');
  return { candidates, page, hasMore: parsed.data.numFound !== undefined ? parsed.data.numFound > page * 20 : parsed.data.docs.length === 20, cached: false };
}
