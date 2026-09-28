import { COVER_LIMITS } from '../media/cover';
import { z } from 'zod';
import { instantSchema, readingStatusSchema, shelfYearSchema } from '../domain/book';
import { DomainError, parseDomain } from '../domain/errors';
import { parseLibrary } from '../domain/library';

export const legacyPreferencesSchema = z.strictObject({
  shelfYear: shelfYearSchema.nullable(), mode: z.enum(['grid', 'list']),
  filter: z.union([readingStatusSchema, z.literal('all')]),
});
export const portablePreferencesSchema = legacyPreferencesSchema.omit({ mode: true });
const envelopeSchema = z.strictObject({
  format: z.literal('livro-a-livro'), schemaVersion: z.literal(1), exportedAt: instantSchema,
  books: z.array(z.unknown()), preferences: legacyPreferencesSchema,
  coverMedia: z.array(z.strictObject({ id: z.uuid(), mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']), bytes: z.string().min(1),
    width: z.number().int().positive().max(COVER_LIMITS.width), height: z.number().int().positive().max(COVER_LIMITS.height), createdAt: instantSchema })).max(COVER_LIMITS.count),
});
const envelopeV2Schema = envelopeSchema.extend({ schemaVersion: z.literal(2), preferences: portablePreferencesSchema });
export type LibraryExportV1 = Omit<z.infer<typeof envelopeSchema>, 'books'> & {
  books: ReturnType<typeof parseLibrary>;
};
export type LibraryExportV2 = Omit<z.infer<typeof envelopeV2Schema>, 'books'> & { books: ReturnType<typeof parseLibrary> };
export type LibraryExport = LibraryExportV1 | LibraryExportV2;

export function parseExportV1(input: unknown): LibraryExportV1 {
  const envelope = parseDomain(envelopeSchema, { ...(input as object), coverMedia: (input as { coverMedia?: unknown })?.coverMedia ?? [] }, 'InvalidBackup');
  try { return { ...envelope, books: parseLibrary(envelope.books) }; }
  catch (error) {
    if (error instanceof DomainError && error.code === 'ImportTooLarge') throw error;
    throw new DomainError('InvalidBackup');
  }
}
export function parseExportV2(input: unknown): LibraryExportV2 {
  const envelope = parseDomain(envelopeV2Schema, { ...(input as object), coverMedia: (input as { coverMedia?: unknown })?.coverMedia ?? [] }, 'InvalidBackup');
  try { return { ...envelope, books: parseLibrary(envelope.books) }; }
  catch (error) {
    if (error instanceof DomainError && error.code === 'ImportTooLarge') throw error;
    throw new DomainError('InvalidBackup');
  }
}
/** Validate a legacy envelope before dropping its device-only display mode. */
export function portableExport(input: LibraryExport): LibraryExportV2 {
  const data = input.schemaVersion === 1 ? parseExportV1(input) : parseExportV2(input);
  return { format: data.format, schemaVersion: 2, exportedAt: data.exportedAt,
    books: data.books, preferences: { shelfYear: data.preferences.shelfYear, filter: data.preferences.filter }, coverMedia: data.coverMedia };
}
