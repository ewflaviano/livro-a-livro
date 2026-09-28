import { DomainError } from '../domain/errors';
import { parseExportV1, parseExportV2 } from './schema';
import type { LibraryExport } from './schema';

// File versions are independent from IndexedDB versions. No legacy format shipped.
export function migrateExport(input: unknown): LibraryExport {
  if (!input || typeof input !== 'object' || !('format' in input) || input.format !== 'livro-a-livro' ||
      !('schemaVersion' in input) || !Number.isInteger(input.schemaVersion)) throw new DomainError('InvalidBackup');
  switch (input.schemaVersion) {
    case 1: return parseExportV1(input);
    case 2: return parseExportV2(input);
    default: throw new DomainError('UnsupportedVersion');
  }
}
