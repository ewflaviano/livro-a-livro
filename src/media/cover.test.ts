import { describe, expect, it, vi } from 'vitest';
import { COVER_LIMITS, prepareCover } from './cover';

describe('prepareCover', () => {
  it('rejects unsupported or excessive input before decoding', async () => {
    await expect(prepareCover(new File(['x'], 'cover.gif', { type: 'image/gif' }), '2026-09-27T00:00:00Z')).rejects.toMatchObject({ code: 'InvalidBook' });
    await expect(prepareCover(new File([new Uint8Array(COVER_LIMITS.bytes + 1)], 'cover.jpg', { type: 'image/jpeg' }), '2026-09-27T00:00:00Z')).rejects.toMatchObject({ code: 'InvalidBook' });
  });
  it('keeps accepted bytes and immutable metadata local', async () => {
    const close = vi.fn();
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 900, height: 1350, close }));
    const file = new File(['image'], 'cover.jpg', { type: 'image/jpeg' });
    const cover = await prepareCover(file, '2026-09-27T00:00:00Z', 'a5f7ab9f-c2ed-4779-b274-f89ae62716ed');
    expect(cover).toMatchObject({ mimeType: 'image/jpeg', width: 900, height: 1350 });
    expect(cover.bytes).toBe(file); expect(close).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });
});
