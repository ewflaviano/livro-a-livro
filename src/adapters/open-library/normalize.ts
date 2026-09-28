import { z } from 'zod';
import { BOOK_LIMITS, isbnSchema, normalizeName } from '../../domain/book';
import { SearchError, type BookCandidate, type BookDetails } from '../../ports/book-search';

const responseSchema = z.object({ docs: z.array(z.unknown()).max(20), numFound: z.number().int().nonnegative().optional() });
const documentSchema = z.object({
  key: z.string().regex(/^(?:\/works\/)?OL[1-9]\d*W$/u),
  title: z.string().trim().min(1).max(BOOK_LIMITS.title),
  author_name: z.array(z.string()).optional().catch(undefined),
  cover_i: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional().catch(undefined),
  first_publish_year: z.number().int().min(1).max(9999).optional().catch(undefined),
  editions: z.object({ docs: z.array(z.object({ key: z.string() })).max(1) }).optional().catch(undefined),
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
    const editionKey = item.editions?.docs[0]?.key;
    const editionId = /^\/books\/(OL[1-9]\d*M)$/u.exec(editionKey ?? '')?.[1] ?? null;
    candidates.push({ workId, title: item.title, authors, coverId: item.cover_i ?? null, editionId,
      firstPublishedYear: item.first_publish_year ?? null, retrievedAt });
  }
  if (parsed.data.docs.length && !candidates.length) throw new SearchError('invalid-response');
  return { candidates, page, hasMore: parsed.data.numFound !== undefined ? parsed.data.numFound > page * 20 : parsed.data.docs.length === 20, cached: false };
}

const editionSchema = z.object({
  key: z.string().regex(/^\/books\/OL[1-9]\d*M$/u),
  title: z.string().trim().min(1).max(BOOK_LIMITS.title).optional().catch(undefined),
  publish_date: z.string().max(100).optional().catch(undefined),
  number_of_pages: z.number().int().positive().max(BOOK_LIMITS.pageCount).optional().catch(undefined),
  isbn_13: z.array(z.string()).max(50).optional().catch(undefined),
  isbn_10: z.array(z.string()).max(50).optional().catch(undefined),
  covers: z.array(z.number()).max(50).optional().catch(undefined),
  works: z.array(z.object({ key: z.string() })).max(50).optional().catch(undefined),
});

export function normalizeEdition(input: unknown, candidate: BookCandidate): BookDetails {
  const parsed = editionSchema.safeParse(input);
  if (!parsed.success || parsed.data.key !== `/books/${candidate.editionId}`) throw new SearchError('invalid-response');
  const item = parsed.data;
  if (item.works?.length && !item.works.some((work) => work.key === `/works/${candidate.workId}`)) throw new SearchError('invalid-response');
  const firstValidIsbn = [...(item.isbn_13 ?? []), ...(item.isbn_10 ?? [])]
    .map((value) => isbnSchema.safeParse(value)).find((value) => value.success);
  const year = /(?:^|\D)([1-9]\d{3})(?!\d)/u.exec(item.publish_date ?? '')?.[1];
  const coverId = item.covers?.find((value) => Number.isSafeInteger(value) && value > 0) ?? null;
  return { candidate, edition: { id: candidate.editionId!, title: item.title ?? null,
    publicationYear: year ? Number(year) : null, pageCount: item.number_of_pages ?? null,
    isbn: firstValidIsbn?.success ? firstValidIsbn.data : null, coverId } };
}
