import { paddedCover, stubImageDecoder, syntheticCover } from '../../test/fixtures/covers/helpers';
import { describe, expect, it, vi } from 'vitest';
import { COVER_LIMITS, prepareCover } from './cover';

describe('prepareCover', () => {
  it('accepts a real PNG at exactly the individual byte limit', async () => {
    stubImageDecoder();
    const file = new File([paddedCover(COVER_LIMITS.bytes).bytes], 'exact.png', { type: 'image/png' });
    expect((await prepareCover(file, '2026-09-27T00:00:00Z')).bytes.size).toBe(COVER_LIMITS.bytes);
    vi.unstubAllGlobals();
  });
  it('rejects a real PNG falsely labeled JPEG before it can become an unrestorable cover', async () => {
    const file = new File([syntheticCover().bytes], 'false.jpg', { type: 'image/jpeg' });
    await expect(prepareCover(file, '2026-09-27T00:00:00Z')).rejects.toMatchObject({ code: 'InvalidBook' });
  });

  it('rejects unsupported or excessive input before decoding', async () => {
    await expect(prepareCover(new File(['x'], 'cover.gif', { type: 'image/gif' }), '2026-09-27T00:00:00Z')).rejects.toMatchObject({ code: 'InvalidBook' });
    await expect(prepareCover(new File([new Uint8Array(COVER_LIMITS.bytes + 1)], 'cover.jpg', { type: 'image/jpeg' }), '2026-09-27T00:00:00Z')).rejects.toMatchObject({ code: 'InvalidBook' });
  });
  it('keeps accepted bytes and immutable metadata local', async () => {
    const close = vi.fn();
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 900, height: 1350, close }));
    const file = new File([syntheticCover('image/jpeg').bytes], 'cover.jpg', { type: 'image/jpeg' });
    const cover = await prepareCover(file, '2026-09-27T00:00:00Z', 'a5f7ab9f-c2ed-4779-b274-f89ae62716ed');
    expect(cover).toMatchObject({ mimeType: 'image/jpeg', width: 900, height: 1350 });
    expect(cover.bytes).toBe(file); expect(close).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });
});
