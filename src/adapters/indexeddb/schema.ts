import type { DBSchema } from 'idb';
import { z } from 'zod';
import { instantSchema, readingStatusSchema, shelfYearSchema } from '../../domain/book';
import type { Book } from '../../domain/book';
import { DomainError, parseDomain } from '../../domain/errors';
import { LIBRARY_LIMITS } from '../../domain/library';
import type { LibraryPreferences, LocalRevision } from '../../ports/library-repository';

export const DATABASE_NAME = import.meta.env.DEV && import.meta.env.VITE_LOCAL_MODE === 'true' ? 'livro-a-livro-local' : 'livro-a-livro';
export const DATABASE_VERSION = 2;
export const RECORD_VERSION = 1;
export const revisionSchema = z.strictObject({
  generation: z.uuid(), revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
});
export const metadataSchema = revisionSchema.extend({
  recordVersion: z.literal(RECORD_VERSION),
  bookCount: z.number().int().min(0).max(LIBRARY_LIMITS.books),
  // Bytes of the JSON array, including brackets and commas, excluding its envelope.
  serializedBytes: z.number().int().min(2)
    .max(LIBRARY_LIMITS.jsonBytes - LIBRARY_LIMITS.exportEnvelopeBytes),
});
export type LibraryMetadata = z.infer<typeof metadataSchema>;

export const preferencesSchema = z.strictObject({
  shelfYear: shelfYearSchema.nullable(),
  mode: z.enum(['grid', 'list']),
  // Older databases have no sort order; parsing supplies the original view.
  sortOrder: z.enum(['recent', 'title']).default('recent'),
  filter: z.union([readingStatusSchema, z.literal('all')]),
  lastExport: z.strictObject({ startedAt: instantSchema, version: revisionSchema }).nullable(),
});
export const DEFAULT_PREFERENCES: LibraryPreferences = {
  shelfYear: null, mode: 'grid', sortOrder: 'recent', filter: 'all', lastExport: null,
};

export function parseMetadata(input: unknown): LibraryMetadata {
  if (typeof input === 'object' && input !== null && 'recordVersion' in input &&
    typeof input.recordVersion === 'number' && input.recordVersion !== RECORD_VERSION) {
    throw new DomainError('UnsupportedVersion');
  }
  return parseDomain(metadataSchema, input, 'InvalidLibrary');
}

export function versionOf(meta: LocalRevision): LocalRevision {
  return { generation: meta.generation, revision: meta.revision };
}

export function sameRevision(a: LocalRevision, b: LocalRevision): boolean {
  return a.generation === b.generation && a.revision === b.revision;
}

export interface LibraryDatabase extends DBSchema {
  // Out-of-line UUID key is lowercased; the Book value preserves its original UUID.
  books: { key: string; value: Book; indexes: { byShelfYear: number; byYearStatus: [number, string] } };
  meta: { key: 'library'; value: LibraryMetadata };
  preferences: { key: 'ui'; value: LibraryPreferences };
  // Reserved stores only. Their feature adapters will define and validate contracts.
  syncState: { key: string; value: unknown };
  syncOutbox: { key: string; value: unknown };
  experimentState: { key: string; value: unknown };
  searchCache: { key: string; value: unknown; indexes: { byAccess: number } };
  // Media never shares the book store, sync outbox, cache or server boundary.
  coverMedia: { key: string; value: unknown };
}
