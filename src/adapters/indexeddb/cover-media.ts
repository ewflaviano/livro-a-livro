import { z } from 'zod';
import { openDatabase } from './database';
import type { DatabaseOptions } from './database';
import { COVER_LIMITS, coverMediaSchema, type CoverMedia } from '../../media/cover';

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
    read,
    async all() { return (await connection.db.getAll('coverMedia')).map(value => coverMediaSchema.parse(value)); },
    close() { connection.close(); },
  };
}

export async function encodeCover(media: CoverMedia): Promise<EncodedCover> {
  const value = coverMediaSchema.parse(media);
  const bytes = new Uint8Array(await value.bytes.arrayBuffer());
  const chunks: string[] = [];
  for (let start = 0; start < bytes.length; start += 32768) chunks.push(String.fromCharCode(...bytes.subarray(start, start + 32768)));
  return encodedSchema.parse({ ...value, bytes: btoa(chunks.join('')) });
}
