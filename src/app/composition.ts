import { holdPwaReload } from '../pwa/register';
import { createBackupWorkerParser } from '../backup/worker-parser';
import { openLibraryRepository } from '../adapters/indexeddb/library-repository';
import { createShelfService } from '../services/shelf-service';
import { createSearchCache } from '../adapters/indexeddb/search-cache';
import { createOpenLibraryClient } from '../adapters/open-library/client';
import { createSearchService } from '../services/search-service';
import { openLibraryCoverUrl } from '../adapters/open-library/covers';
import type { BookCandidate } from '../ports/book-search';

export function bookCoverUrl(coverId: number, size: 'S' | 'M' = 'M'): string | null {
  return import.meta.env.DEV && import.meta.env.VITE_LOCAL_MODE === 'true' ? null : openLibraryCoverUrl(coverId, size);
}

export function openBookSearch() {
  const local = import.meta.env.DEV && import.meta.env.VITE_LOCAL_MODE === 'true';
  const source = local ? { async search() { return { candidates: [], page: 1, hasMore: false, cached: false }; },
    async details(candidate: BookCandidate) { return { candidate, edition: null }; } } : createOpenLibraryClient(createSearchCache());
  return createSearchService(source);
}

export async function openShelfService() {
  let service: ReturnType<typeof createShelfService> | undefined;
  const repository = await openLibraryRepository({
    onDatabaseEvent: () => { void service?.refresh(); },
    onObservationError: () => { void service?.refresh(); },
  });
  service = createShelfService(repository, createBackupWorkerParser(), holdPwaReload);
  return service;
}
