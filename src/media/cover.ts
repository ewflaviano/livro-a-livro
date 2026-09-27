import { z } from 'zod';
import { instantSchema } from '../domain/book';
import { DomainError, parseDomain } from '../domain/errors';

export const COVER_LIMITS = { count: 100, bytes: 2 * 1024 * 1024, width: 2400, height: 3600, totalBytes: 12 * 1024 * 1024 } as const;
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

export function imageMime(bytes: Uint8Array): string | null {
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((byte, i) => bytes[i] === byte)) return 'image/png';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.slice(start, end));
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  return null;
}

type DecodedImage = { width: number; height: number; close?: () => void };
export async function decodeImage(file: Blob): Promise<DecodedImage> {
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
    if (imageMime(new Uint8Array(await file.arrayBuffer())) !== file.type) throw new DomainError('InvalidBook');
    image = await decodeImage(file);
    if (image.width < 32 || image.height < 32 || image.width > COVER_LIMITS.width || image.height > COVER_LIMITS.height) throw new DomainError('InvalidBook');
    return parseCoverMedia({ id, mimeType: file.type, bytes: file, width: image.width, height: image.height, createdAt: now });
  } catch (error) { throw coverError(error); }
  finally { image?.close?.(); }
}
