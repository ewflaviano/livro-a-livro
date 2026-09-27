import { LIBRARY_LIMITS, utf8ByteLength } from '../domain/library';
import type { Book } from '../domain/book';
import { DomainError, parseDomain } from '../domain/errors';
import { COVER_LIMITS, coverMediaSchema, decodeImage, imageMime, type CoverMedia } from '../media/cover';
import type { LibraryExport } from './schema';

/** The fixed reserve covers preferences, timestamp, keys and the trailing newline.
 * Blob sizes determine base64 length exactly; no async encoding belongs in a transaction. */
export function portableBytes(bookBytes: number, media: CoverMedia[]): number {
  const metadata = media.map(value => ({ ...value, bytes: '' }));
  return bookBytes + utf8ByteLength(JSON.stringify(metadata))
    + media.reduce((total, value) => total + 4 * Math.ceil(value.bytes.size / 3), 0)
    + LIBRARY_LIMITS.exportEnvelopeBytes;
}
export function assertPortableBudget(bookBytes: number, media: CoverMedia[]): void {
  if (portableBytes(bookBytes, media) > LIBRARY_LIMITS.jsonBytes) throw new DomainError('ImportTooLarge');
}
export function referencedMedia(books: Book[], media: CoverMedia[]): CoverMedia[] {
  const ids = new Set(books.flatMap(book => book.cover?.provider === 'local' ? [book.cover.mediaId.toLowerCase()] : []));
  return media.filter(value => ids.has(value.id.toLowerCase())).sort((a, b) => a.id.toLowerCase().localeCompare(b.id.toLowerCase()));
}

/** Synchronous structural guard for prepared blobs, also enforced by the commit boundary. */
export function validateMediaCollection(books: Book[], input: CoverMedia[]): CoverMedia[] {
  if (input.length > COVER_LIMITS.count) throw new DomainError('ImportTooLarge');
  const media = input.map(value => parseDomain(coverMediaSchema, value, 'InvalidBackup'));
  const ids = new Set(media.map(value => value.id.toLowerCase()));
  if (ids.size !== media.length || books.some(book => book.cover?.provider === 'local' && !ids.has(book.cover.mediaId.toLowerCase()))) {
    throw new DomainError('InvalidBackup');
  }
  if (media.reduce((total, value) => total + value.bytes.size, 0) > COVER_LIMITS.totalBytes) throw new DomainError('ImportTooLarge');
  return media;
}

/** Decode all untrusted bytes before preview/confirmation and outside IndexedDB transactions. */
export async function prepareBackupMedia(data: LibraryExport): Promise<CoverMedia[]> {
  try {
    const ids = new Set(data.coverMedia.map(value => value.id.toLowerCase()));
    if (ids.size !== data.coverMedia.length || data.books.some(book => book.cover?.provider === 'local' && !ids.has(book.cover.mediaId.toLowerCase()))) throw new DomainError('InvalidBackup');
    let total = 0;
    const sizes = data.coverMedia.map(value => {
      const encoded = value.bytes;
      if (!encoded.length || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) throw new DomainError('InvalidBackup');
      const size = encoded.length / 4 * 3 - (encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0);
      total += size;
      if (size > COVER_LIMITS.bytes || total > COVER_LIMITS.totalBytes) throw new DomainError('ImportTooLarge');
      return size;
    });
    const media: CoverMedia[] = [];
    for (const [index, value] of data.coverMedia.entries()) {
      const binary = atob(value.bytes);
      if (btoa(binary) !== value.bytes || binary.length !== sizes[index]) throw new DomainError('InvalidBackup');
      const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
      if (imageMime(bytes) !== value.mimeType) throw new DomainError('InvalidBackup');
      const blob = new Blob([bytes], { type: value.mimeType });
      const image = await decodeImage(blob);
      try {
        if (image.width !== value.width || image.height !== value.height) throw new DomainError('InvalidBackup');
      } finally { image.close?.(); }
      media.push({ ...value, bytes: blob });
    }
    const validated = validateMediaCollection(data.books, media);
    assertPortableBudget(utf8ByteLength(JSON.stringify(data.books)), referencedMedia(data.books, validated));
    return validated;
  } catch (error) {
    if (error instanceof DomainError && error.code === 'ImportTooLarge') throw error;
    throw new DomainError('InvalidBackup');
  }
}
