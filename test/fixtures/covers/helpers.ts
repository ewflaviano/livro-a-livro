import { vi } from 'vitest';
import images from './synthetic.json';
import type { CoverMedia } from '../../../src/media/cover';
export const coverId = 'a5f7ab9f-c2ed-4779-b274-f89ae62716ed';
export const encodedCover = (mimeType: keyof typeof images = 'image/png') => ({
  id: coverId, mimeType, bytes: images[mimeType], width: 32, height: 48, createdAt: '2026-09-26T12:00:00Z',
});
export function syntheticCover(mimeType: keyof typeof images = 'image/png'): CoverMedia {
  const encoded = encodedCover(mimeType);
  return { ...encoded, bytes: new Blob([Uint8Array.from(atob(encoded.bytes), char => char.charCodeAt(0))], { type: mimeType }) };
}
// Node has no native image decoder. Only our complete, real synthetic encodings decode here;
// corrupted/truncated data must fail. Browser decode remains the production implementation.
export function stubImageDecoder() {
  vi.stubGlobal('createImageBitmap', vi.fn(async (blob: Blob) => {
    const encoded = btoa(String.fromCharCode(...new Uint8Array(await blob.arrayBuffer())));
    if (!Object.values(images).includes(encoded)) throw new Error('Synthetic decode failure');
    return { width: 32, height: 48, close: vi.fn() };
  }));
}
