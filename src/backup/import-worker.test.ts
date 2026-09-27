import { afterEach, describe, expect, it, vi } from 'vitest';
import fixture from '../../test/fixtures/backups/v1.json';
afterEach(() => { vi.unstubAllGlobals(); });
describe('backup worker entry', () => {
  it('parses V1 and emits only public codes on malformed/private or future input', async () => {
    const post = vi.fn(); vi.stubGlobal('postMessage', post); vi.stubGlobal('onmessage', null);
    await import('./import-worker');
    const receive = (data: unknown) => (globalThis as unknown as { onmessage(event: MessageEvent): void }).onmessage({ data } as MessageEvent);
    receive(JSON.stringify(fixture)); expect(post.mock.calls[0][0]).toMatchObject({ ok: true, data: { books: fixture.books } });
    receive('PRIVATE synthetic malformed'); expect(post.mock.calls[1][0]).toEqual({ ok: false, code: 'InvalidBackup' });
    receive(JSON.stringify({ ...fixture, schemaVersion: 999 })); expect(post.mock.calls[2][0]).toEqual({ ok: false, code: 'UnsupportedVersion' });
  });
});
