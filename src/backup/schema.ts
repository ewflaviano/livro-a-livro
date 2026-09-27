import { z } from 'zod';
import { instantSchema, readingStatusSchema, shelfYearSchema } from '../domain/book';
import { DomainError, parseDomain } from '../domain/errors';
import { parseLibrary } from '../domain/library';

export const portablePreferencesSchema = z.strictObject({
  shelfYear: shelfYearSchema.nullable(), mode: z.enum(['grid', 'list']),
  filter: z.union([readingStatusSchema, z.literal('all')]),
});
const envelopeSchema = z.strictObject({
  format: z.literal('livro-a-livro'), schemaVersion: z.literal(1), exportedAt: instantSchema,
  books: z.array(z.unknown()), preferences: portablePreferencesSchema,
  coverMedia: z.array(z.strictObject({ id: z.uuid(), mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']), bytes: z.string().min(1),
    width: z.number().int().positive().max(2400), height: z.number().int().positive().max(3600), createdAt: instantSchema })).max(100),
});
export type LibraryExport = Omit<z.infer<typeof envelopeSchema>, 'books'> & {
  books: ReturnType<typeof parseLibrary>;
};

export function parseExportV1(input: unknown): LibraryExport {
  const envelope = parseDomain(envelopeSchema, { ...(input as object), coverMedia: (input as { coverMedia?: unknown })?.coverMedia ?? [] }, 'InvalidBackup');
  try { return { ...envelope, books: parseLibrary(envelope.books) }; }
  catch (error) {
    if (error instanceof DomainError && error.code === 'ImportTooLarge') throw error;
    throw new DomainError('InvalidBackup');
  }
}
