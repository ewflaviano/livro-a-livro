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
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let valid = false;
    if (bytes.length < 4000) valid = Object.values(images).includes(btoa(String.fromCharCode(...bytes)));
    if (!valid && bytes.length > 1000) {
      const png = Uint8Array.from(atob(images['image/png']), char => char.charCodeAt(0));
      const at = png.length - 12;
      valid = png.subarray(0, at).every((byte, index) => bytes[index] === byte) &&
        bytes[at + 4] === 110 && bytes[at + 5] === 112 && bytes[at + 6] === 65 && bytes[at + 7] === 68 &&
        new DataView(bytes.buffer).getUint32(at) === bytes.length - png.length - 12 &&
        png.subarray(at).every((byte, index) => bytes[bytes.length - 12 + index] === byte);
    }
    if (!valid) throw new Error('Synthetic decode failure');
    return { width: 32, height: 48, close: vi.fn() };
  }));
}

// Add a valid unknown ancillary PNG chunk; real decoders ignore these synthetic padding bytes.
export function paddedCover(size: number): CoverMedia {
  const cover = syntheticCover();
  const original = Uint8Array.from(atob(images['image/png']), char => char.charCodeAt(0));
  if (size < original.length + 12) throw new Error('Synthetic padding too short');
  const output = new Uint8Array(size); const at = original.length - 12;
  output.set(original.slice(0, at)); output.set(original.slice(at), size - 12);
  const payload = size - original.length - 12;
  const view = new DataView(output.buffer); view.setUint32(at, payload);
  output.set([110, 112, 65, 68], at + 4); // npAD
  let crc = 0xffffffff;
  for (const byte of output.subarray(at + 4, at + 8 + payload)) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  view.setUint32(at + 8 + payload, (crc ^ 0xffffffff) >>> 0);
  return { ...cover, bytes: new Blob([output], { type: 'image/png' }) };
}
