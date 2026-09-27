import { z } from 'zod';
import { openDatabase } from './database';
import type { DatabaseOptions } from './database';
import { COVER_LIMITS, coverMediaSchema, type CoverMedia } from '../../media/cover';
import { DomainError } from '../../domain/errors';

export type EncodedCover = Omit<CoverMedia, 'bytes'> & { bytes: string };
const encodedSchema = z.strictObject({ id: z.uuid(), mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']), bytes: z.string().min(1),
  width: z.number().int().positive().max(COVER_LIMITS.width), height: z.number().int().positive().max(COVER_LIMITS.height),
  createdAt: z.iso.datetime() });

export async function openCoverMediaRepository(options: DatabaseOptions = {}) {
  const connection = await openDatabase(options);
  async function read(id: string): Promise<CoverMedia | null> {
    const raw = await connection.db.get('coverMedia', id.toLowerCase());
    return raw === undefined ? null : coverMediaSchema.parse(raw);
  }
  return {
    async put(media: CoverMedia) {
      const value = coverMediaSchema.parse(media);
      try { await connection.db.put('coverMedia', value, value.id.toLowerCase()); }
      catch (error) { if (error instanceof DOMException && error.name === 'QuotaExceededError') throw new DomainError('QuotaExceeded'); throw error; }
    },
    read,
    async all() { return (await connection.db.getAll('coverMedia')).map(value => coverMediaSchema.parse(value)); },
    close() { connection.close(); },
  };
}

export async function encodeCover(media: CoverMedia): Promise<EncodedCover> {
  const value = coverMediaSchema.parse(media);
  const bytes = new Uint8Array(await value.bytes.arrayBuffer());
  let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte);
  return encodedSchema.parse({ ...value, bytes: btoa(binary) });
}
