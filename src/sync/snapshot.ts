import { prepareBackupMedia } from '../backup/media';
import { LIBRARY_LIMITS, utf8ByteLength } from '../domain/library';
import { parseExportV1, parseExportV2, portableExport } from '../backup/schema';
import { serializeBackup } from '../backup/serialize';
import type { LibraryExport, LibraryExportV1, LibraryExportV2 } from '../backup/schema';
import { canonicalJson, binaryCompare, sameHeader, headerSchema, SyncError, type SyncSnapshot, type DriveFile } from './contracts';

export const MAX_SYNC_BYTES = LIBRARY_LIMITS.jsonBytes + 64 * 1024;
export async function libraryHashV1(library: LibraryExportV1) {
  const data = parseExportV1(library);
  data.books.sort((a, b) => a.id.localeCompare(b.id));
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify({ books: data.books, coverMedia: data.coverMedia })));
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
}
// Public legacy alias is intentional: callers validating V1 must opt in to V2 explicitly.
export const libraryHash = libraryHashV1;
function canonicalValidated(data: LibraryExport) {
  const bookIds = new Set<string>(); const mediaIds = new Set<string>();
  for (const book of data.books) { const id = book.id.toLowerCase(); if (bookIds.has(id)) throw new SyncError('invalid'); bookIds.add(id); }
  for (const media of data.coverMedia) { const id = media.id.toLowerCase(); if (mediaIds.has(id)) throw new SyncError('invalid'); mediaIds.add(id); }
  const referenced = new Set(data.books.flatMap(book => book.cover?.provider === 'local' ? [book.cover.mediaId.toLowerCase()] : []));
  return { books: data.books.map(book => ({ ...book, id: book.id.toLowerCase(), ...(book.cover?.provider === 'local' ? { cover: { ...book.cover, mediaId: book.cover.mediaId.toLowerCase() } } : {}) })).sort((a,b) => binaryCompare(a.id,b.id)),
    preferences: data.preferences, coverMedia: data.coverMedia.filter(media => referenced.has(media.id.toLowerCase())).map(media => ({ ...media, id: media.id.toLowerCase() })).sort((a,b) => binaryCompare(a.id,b.id)) };
}
export function canonicalLibrary(library: LibraryExportV1) { return canonicalValidated(parseExportV1(library)); }
export async function libraryHashV2(library: LibraryExportV1) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalJson(canonicalLibrary(library))));
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
}
export async function libraryHashV3(library: LibraryExport) {
  const portable = portableExport(library);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalJson(canonicalValidated(portable))));
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
}
export function referencedExport(library: LibraryExport): LibraryExportV2 {
  const data = portableExport(library);
  const refs = new Set(data.books.flatMap(book => book.cover?.provider === 'local' ? [book.cover.mediaId.toLowerCase()] : []));
  return { ...data, coverMedia: data.coverMedia.filter(media => refs.has(media.id.toLowerCase())) };
}
export async function parseSnapshot(input: unknown): Promise<SyncSnapshot> {
  try {
    if (!input || typeof input !== 'object' || !('library' in input)) throw new SyncError('invalid');
    const { library, ...header } = input;
    const parsedHeader = headerSchema.parse(header);
    const parsed = parsedHeader.protocolVersion === 3
      ? { ...parsedHeader, library: parseExportV2(library) }
      : { ...parsedHeader, library: parseExportV1(library) };
    serializeBackup(parsed.library); // Includes the backup envelope limit.
    const id = parsed.snapshotId.toLowerCase();
    if (parsed.parentSnapshotId?.toLowerCase() === id || parsed.resolvedSnapshotIds.some(value => value.toLowerCase() === id) ||
      new Set(parsed.resolvedSnapshotIds.map(value => value.toLowerCase())).size !== parsed.resolvedSnapshotIds.length ||
      utf8ByteLength(JSON.stringify(parsed)) > MAX_SYNC_BYTES || await (parsed.protocolVersion === 1 ? libraryHashV1(parsed.library as LibraryExportV1) : parsed.protocolVersion === 2 ? libraryHashV2(parsed.library as LibraryExportV1) : libraryHashV3(parsed.library)) !== parsed.hash) throw new SyncError('invalid');
    await prepareBackupMedia(parsed.library);
    if (parsed.protocolVersion !== 1 && referencedExport(parsed.library).coverMedia.length !== parsed.library.coverMedia.length) throw new SyncError('invalid');
    return parsed as SyncSnapshot;
  } catch { throw new SyncError('invalid'); }
}
/** Validate graph aliases before using casefold keys; wire IDs remain untouched. */
export function remoteHeads(files: DriveFile[]): DriveFile[] {
  const unique = new Map<string, DriveFile>(); const operations = new Map<string, DriveFile>();
  for (const file of files) {
    const key = file.header.snapshotId.toLowerCase(); const operationKey = file.header.operationId.toLowerCase();
    const previous = unique.get(key); const operation = operations.get(operationKey);
    if (previous && !sameHeader(previous.header, file.header) || operation && !sameHeader(operation.header, file.header)) throw new SyncError('invalid');
    unique.set(key, file); operations.set(operationKey, file);
  }
  const consumed = new Set<string>();
  for (const file of unique.values()) {
    const ancestors = [file.header.parentSnapshotId, ...file.header.resolvedSnapshotIds].filter((id): id is string => id !== null);
    for (const wire of ancestors) {
      const id = wire.toLowerCase();
      if (!unique.has(id)) throw new SyncError('invalid');
      consumed.add(id);
    }
  }
  const visited = new Set<string>(); const visiting = new Set<string>();
  function visit(id: string) {
    if (visiting.has(id)) throw new SyncError('invalid');
    if (visited.has(id)) return;
    visiting.add(id);
    const header = unique.get(id)!.header;
    for (const parent of [header.parentSnapshotId, ...header.resolvedSnapshotIds]) if (parent) visit(parent.toLowerCase());
    visiting.delete(id); visited.add(id);
  }
  for (const id of unique.keys()) visit(id);
  return [...unique.values()].filter(file => !consumed.has(file.header.snapshotId.toLowerCase())).sort((a,b) => binaryCompare(a.header.snapshotId.toLowerCase(), b.header.snapshotId.toLowerCase()));
}
