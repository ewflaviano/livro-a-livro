import { z } from 'zod';
import { instantSchema } from '../domain/book';
import { DomainError, parseDomain } from '../domain/errors';

export const COVER_LIMITS = { bytes: 2 * 1024 * 1024, width: 2400, height: 3600, totalBytes: 12 * 1024 * 1024 } as const;
const mimeTypeSchema = z.enum(['image/jpeg', 'image/png', 'image/webp']);
export const coverMediaSchema = z.strictObject({
  id: z.uuid(), mimeType: mimeTypeSchema, bytes: z.instanceof(Blob), width: z.number().int().positive().max(COVER_LIMITS.width),
  height: z.number().int().positive().max(COVER_LIMITS.height), createdAt: instantSchema,
}).superRefine((media, ctx) => { if (media.bytes.size > COVER_LIMITS.bytes) ctx.addIssue({ code: 'custom', path: ['bytes'] }); });
export type CoverMedia = z.infer<typeof coverMediaSchema>;

export function parseCoverMedia(input: unknown): CoverMedia { return parseDomain(coverMediaSchema, input, 'InvalidBook'); }
export function coverError(error: unknown): DomainError {
  return error instanceof DomainError ? error : new DomainError('InvalidBook');
}

type DecodedImage = { width: number; height: number; close?: () => void };
async function decode(file: Blob): Promise<DecodedImage> {
  if ('createImageBitmap' in globalThis) return createImageBitmap(file);
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error('decode')); image.src = url; });
    return { width: image.naturalWidth, height: image.naturalHeight };
  } finally { URL.revokeObjectURL(url); }
}

/** Validates locally before any persistent write or network-capable sync work. */
export async function prepareCover(file: File, now: string, id = crypto.randomUUID()): Promise<CoverMedia> {
  if (!mimeTypeSchema.safeParse(file.type).success || file.size <= 0 || file.size > COVER_LIMITS.bytes) throw new DomainError('InvalidBook');
  let image: DecodedImage | undefined;
  try {
    image = await decode(file);
    if (image.width < 32 || image.height < 32 || image.width > COVER_LIMITS.width || image.height > COVER_LIMITS.height) throw new DomainError('InvalidBook');
    return parseCoverMedia({ id, mimeType: file.type, bytes: file, width: image.width, height: image.height, createdAt: now });
  } catch (error) { throw coverError(error); }
  finally { image?.close?.(); }
}
