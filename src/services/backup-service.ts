import { DomainError } from '../domain/errors';
import { instantSchema } from '../domain/book';
import { parseDomain } from '../domain/errors';
import { LIBRARY_LIMITS, utf8ByteLength } from '../domain/library';
import type { LibraryRepository, LocalRevision } from '../ports/library-repository';
import type { LibraryExport } from '../backup/schema';
import { parseExportV1 } from '../backup/schema';
import { parseBackupText, serializeBackup } from '../backup/serialize';

export type ImportPreview = Readonly<{
  incoming: Readonly<{ count: number; years: readonly number[] }>;
  current: Readonly<{ count: number; years: readonly number[] }>;
}>;
export type BackupFile = { size: number; text(): Promise<string> };
const summary = (books: LibraryExport['books']) => Object.freeze({
  count: books.length, years: Object.freeze([...new Set(books.map(book => book.shelfYear))].sort((a, b) => a - b)),
});

export function createBackupService(repository: LibraryRepository,
  parse: (text: string) => Promise<LibraryExport> = async text => parseBackupText(text)) {
  const pending = new WeakMap<ImportPreview, { data: LibraryExport; version: LocalRevision }>();
  let active: ImportPreview | undefined;
  let selection = 0;
  return {
    async exportBackup(exportedAt: string) {
      parseDomain(instantSchema, exportedAt, 'InvalidBackup');
      const snapshot = await repository.readBackupSnapshot();
      const text = serializeBackup({ format: 'livro-a-livro', schemaVersion: 1, exportedAt,
        books: snapshot.books, preferences: snapshot.preferences });
      return { text, filename: `livro-a-livro-${exportedAt.slice(0, 10)}.json`,
        blob: new Blob([text], { type: 'application/json;charset=utf-8' }), version: snapshot.version };
    },
    // Call only after the host starts the download, not merely after generating JSON.
    async recordDownloadStarted(startedAt: string, version: LocalRevision) {
      await repository.updatePreferences({ lastExport: { startedAt, version } });
    },
    async prepareImport(file: BackupFile): Promise<ImportPreview> {
      const selected = ++selection;
      if (active) pending.delete(active);
      active = undefined;
      if (!Number.isSafeInteger(file.size) || file.size < 0) throw new DomainError('InvalidBackup');
      if (file.size > LIBRARY_LIMITS.jsonBytes) throw new DomainError('ImportTooLarge');
      let text: string;
      try { text = await file.text(); } catch { throw new DomainError('InvalidBackup'); }
      if (utf8ByteLength(text) > LIBRARY_LIMITS.jsonBytes) throw new DomainError('ImportTooLarge');
      // Validate injected/worker result again and clone; callers never receive mutable data.
      const data = parseExportV1(await parse(text));
      const current = await repository.readAll();
      if (selected !== selection) throw new DomainError('InvalidBackup');
      const preview = Object.freeze({ incoming: summary(data.books), current: summary(current.books) });
      pending.set(preview, { data, version: current.version });
      active = preview;
      return preview;
    },
    cancelImport() { selection++; if (active) pending.delete(active); active = undefined; },
    async confirmImport(preview: ImportPreview): Promise<LocalRevision> {
      const prepared = pending.get(preview);
      if (!prepared) throw new DomainError('InvalidBackup');
      pending.delete(preview);
      active = undefined;
      return repository.commit({ kind: 'replace', books: prepared.data.books,
        preferences: prepared.data.preferences }, prepared.version);
    },
  };
}
