import { DomainError } from '../domain/errors';
import { LIBRARY_LIMITS, utf8ByteLength } from '../domain/library';
import { migrateExport } from './migrations';
import type { LibraryExport } from './schema';

export function parseBackupText(text: string): LibraryExport {
  if (utf8ByteLength(text) > LIBRARY_LIMITS.jsonBytes) throw new DomainError('ImportTooLarge');
  let input: unknown;
  try { input = JSON.parse(text); } catch { throw new DomainError('InvalidBackup'); }
  return migrateExport(input);
}

export function serializeBackup(input: LibraryExport): string {
  const data = migrateExport(input);
  // Schema parsing constructs fields in their declared order, including nested records.
  data.books.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  data.coverMedia.sort((a, b) => a.id.toLowerCase().localeCompare(b.id.toLowerCase()));
  const text = JSON.stringify(data) + '\n';
  if (utf8ByteLength(text) > LIBRARY_LIMITS.jsonBytes) throw new DomainError('ImportTooLarge');
  return text;
}
