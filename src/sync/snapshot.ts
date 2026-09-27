import { prepareBackupMedia } from '../backup/media';
import { LIBRARY_LIMITS, utf8ByteLength } from '../domain/library';
import { parseExportV1 } from '../backup/schema';
import { serializeBackup } from '../backup/serialize';
import type { LibraryExport } from '../backup/schema';
import { headerSchema, SyncError, type SyncSnapshot, type DriveFile } from './contracts';

export const MAX_SYNC_BYTES = LIBRARY_LIMITS.jsonBytes + 64 * 1024;
export async function libraryHash(library: LibraryExport) {
  const data = parseExportV1(library);
  data.books.sort((a, b) => a.id.localeCompare(b.id));
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify({ books: data.books, coverMedia: data.coverMedia })));
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
}
export async function parseSnapshot(input: unknown): Promise<SyncSnapshot> {
  try {
    if (!input || typeof input !== 'object' || !('library' in input)) throw new SyncError('invalid');
    const { library, ...header } = input;
    const parsed = { ...headerSchema.parse(header), library: parseExportV1(library) };
    serializeBackup(parsed.library); // Includes the backup envelope limit.
    if (parsed.snapshotId === parsed.parentSnapshotId || parsed.resolvedSnapshotIds.includes(parsed.snapshotId) ||
      new Set(parsed.resolvedSnapshotIds).size !== parsed.resolvedSnapshotIds.length ||
      utf8ByteLength(JSON.stringify(parsed)) > MAX_SYNC_BYTES || await libraryHash(parsed.library) !== parsed.hash) throw new SyncError('invalid');
    await prepareBackupMedia(parsed.library);
    return parsed;
  } catch { throw new SyncError('invalid'); }
}
/** Multiple byte-identical uploads of one operation are equivalent, never timestamp winners. */
export function remoteHeads(files: DriveFile[]): DriveFile[] {
  const unique = new Map<string, DriveFile>();
  for (const file of files) {
    const previous = unique.get(file.header.snapshotId);
    if (previous && JSON.stringify(previous.header) !== JSON.stringify(file.header)) throw new SyncError('invalid');
    unique.set(file.header.snapshotId, file);
  }
  const consumed = new Set<string>();
  for (const file of unique.values()) {
    const ancestors = [file.header.parentSnapshotId, ...file.header.resolvedSnapshotIds].filter((id): id is string => id !== null);
    for (const id of ancestors) {
      // Missing history is unsafe: we never prune automatically.
      if (!unique.has(id)) throw new SyncError('invalid');
      consumed.add(id);
    }
  }
  // Detect malformed cycles, including components unrelated to the current head.
  const visited = new Set<string>(); const visiting = new Set<string>();
  function visit(id: string) {
    if (visiting.has(id)) throw new SyncError('invalid');
    if (visited.has(id)) return;
    visiting.add(id);
    const header = unique.get(id)!.header;
    for (const parent of [header.parentSnapshotId, ...header.resolvedSnapshotIds]) if (parent) visit(parent);
    visiting.delete(id); visited.add(id);
  }
  for (const id of unique.keys()) visit(id);
  return [...unique.values()].filter(file => !consumed.has(file.header.snapshotId));
}
