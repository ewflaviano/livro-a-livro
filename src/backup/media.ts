import type { Book } from '../domain/book';
import { DomainError, parseDomain } from '../domain/errors';
import { COVER_LIMITS, coverMediaSchema, decodeImage, type CoverMedia } from '../media/cover';
import type { LibraryExport } from './schema';

/** Synchronous structural guard for prepared blobs, also enforced by the commit boundary. */
export function validateMediaCollection(books: Book[], input: CoverMedia[]): CoverMedia[] {
  if (input.length > 100) throw new DomainError('ImportTooLarge');
  const media = input.map(value => parseDomain(coverMediaSchema, value, 'InvalidBackup'));
  const ids = new Set(media.map(value => value.id.toLowerCase()));
  if (ids.size !== media.length || books.some(book => book.cover?.provider === 'local' && !ids.has(book.cover.mediaId.toLowerCase()))) {
    throw new DomainError('InvalidBackup');
  }
  if (media.reduce((total, value) => total + value.bytes.size, 0) > COVER_LIMITS.totalBytes) throw new DomainError('ImportTooLarge');
  return media;
}

function actualMime(bytes: Uint8Array): string | null {
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((byte, i) => bytes[i] === byte)) return 'image/png';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.slice(start, end));
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  return null;
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
      if (actualMime(bytes) !== value.mimeType) throw new DomainError('InvalidBackup');
      const blob = new Blob([bytes], { type: value.mimeType });
      const image = await decodeImage(blob);
      try {
        if (image.width !== value.width || image.height !== value.height) throw new DomainError('InvalidBackup');
      } finally { image.close?.(); }
      media.push({ ...value, bytes: blob });
    }
    return validateMediaCollection(data.books, media);
  } catch (error) {
    if (error instanceof DomainError && error.code === 'ImportTooLarge') throw error;
    throw new DomainError('InvalidBackup');
  }
}
