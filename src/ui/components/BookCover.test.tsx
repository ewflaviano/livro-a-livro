// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
await vi.hoisted(async () => { const { Blob } = await import('node:buffer'); globalThis.Blob = Blob as unknown as typeof globalThis.Blob; });
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { openDB, deleteDB } from 'idb';
import { openLibraryRepository } from '../../adapters/indexeddb/library-repository';
import { createShelfService } from '../../services/shelf-service';
import { LibraryProvider } from '../../app/LibraryProvider';
import { createBook, type Book } from '../../domain/book';
import type { CoverMedia } from '../../media/cover';
import { syntheticCover, coverId } from '../../../test/fixtures/covers/helpers';
import { BookCover } from './BookCover';

const local = (id = coverId): Book['cover'] => ({ provider: 'local', mediaId: id });
const remote = (coverId = 123): Book['cover'] => ({ provider: 'open_library', coverId });
const created: Blob[] = []; const revoked = vi.fn();
const opened: { name: string; close(): void }[] = [];
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL(blob: Blob) { created.push(blob); return `blob:synthetic-${created.length}`; }
    static revokeObjectURL = revoked;
  });
});
afterEach(async () => {
  expect(fetch).not.toHaveBeenCalled(); cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); created.length = 0; revoked.mockClear();
  for (const item of opened.splice(0)) { item.close(); await deleteDB(item.name); }
});
async function setup(cover: Book['cover'], read?: (id: string) => Promise<CoverMedia | null>) {
  const name = crypto.randomUUID(); const repo = await openLibraryRepository({ name, channelFactory: null });
  const spy = read ? vi.spyOn(repo, 'readCover').mockImplementation(read) : vi.spyOn(repo, 'readCover');
  const service = createShelfService(repo); const openService = async () => service;
  opened.push({ name, close: service.close });
  const element = (reference: Book['cover']) => <LibraryProvider openService={openService}><BookCover cover={reference} title="Título sintético" /></LibraryProvider>;
  const view = render(element(cover));
  await vi.waitFor(() => expect(service.getSnapshot().status).toBe('ready'));
  return { view, repo, spy, show: (next: Book['cover']) => view.rerender(element(next)) };
}
describe('shared cover presentation', () => {
  it('uses only the allowlisted cover URL with anonymous CORS, no referrer, lazy loading and decorative alt', async () => {
    const { view } = await setup(remote()); const image = view.container.querySelector('img')!;
    expect(image.getAttribute('src')).toBe('https://covers.openlibrary.org/b/id/123-M.jpg?default=false');
    expect(image.crossOrigin).toBe('anonymous'); expect(image.getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(image.getAttribute('loading')).toBe('lazy'); expect(image.alt).toBe('');
    fireEvent.error(image); expect(view.container.querySelector('img')).toBeNull();
    expect(screen.getByText('Sem capa · Título sintético')).toBeTruthy();
  });
  it.each([0, -1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1])('never creates an image request for invalid CoverID %s', async id => {
    const { view } = await setup(remote(id)); expect(view.container.querySelector('img')).toBeNull();
  });
  it('omits external images offline and restores the source after an online event', async () => {
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const { view } = await setup(remote()); expect(view.container.querySelector('img')).toBeNull();
    online.mockReturnValue(true); act(() => window.dispatchEvent(new Event('online')));
    expect(view.container.querySelector('img')).not.toBeNull();
    online.mockReturnValue(false); act(() => window.dispatchEvent(new Event('offline')));
    expect(view.container.querySelector('img')).toBeNull();
  });
  it('blocks external URLs in local mode while local bytes remain available offline', async () => {
    vi.stubEnv('DEV', true); vi.stubEnv('VITE_LOCAL_MODE', 'true');
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    const { view, show } = await setup(remote(), async () => syntheticCover());
    expect(view.container.querySelector('img')).toBeNull();
    online.mockReturnValue(false); act(() => window.dispatchEvent(new Event('offline')));
    show(local()); await vi.waitFor(() => expect(view.container.querySelector('img')?.getAttribute('src')).toBe('blob:synthetic-1'));
    expect(created[0]).toBeInstanceOf(Blob);
  });
  it('discards late local reads, revokes the current URL on replacement, and creates nothing after unmount', async () => {
    const second = crypto.randomUUID(); const third = crypto.randomUUID();
    const releases = new Map<string, (media: CoverMedia | null) => void>();
    const { view, show, spy } = await setup(local(), id => new Promise(resolve => { releases.set(id, resolve); }));
    await vi.waitFor(() => expect(spy).toHaveBeenCalledWith(coverId));
    show(local(second)); await vi.waitFor(() => expect(spy).toHaveBeenCalledWith(second));
    await act(async () => { releases.get(coverId)!(syntheticCover()); }); expect(created).toHaveLength(0);
    await act(async () => { releases.get(second)!({ ...syntheticCover(), id: second }); });
    expect(view.container.querySelector('img')?.getAttribute('src')).toBe('blob:synthetic-1');
    show(local(third)); expect(revoked).toHaveBeenCalledWith('blob:synthetic-1'); expect(view.container.querySelector('img')).toBeNull();
    await vi.waitFor(() => expect(spy).toHaveBeenCalledWith(third)); view.unmount();
    await act(async () => { releases.get(third)!({ ...syntheticCover(), id: third }); }); expect(created).toHaveLength(1);
  });
  it('reloads the same media ID after an atomic restore changes the generation', async () => {
    const { view, repo } = await setup(local());
    const book = createBook({ title: 'Sintético', cover: local() }, { id: crypto.randomUUID(), now: '2026-09-27T00:00:00Z', shelfYear: 2026 });
    await act(async () => { await repo.commit({ kind: 'replace', books: [book], coverMedia: [syntheticCover()] }, await repo.readRevision()); });
    await vi.waitFor(() => expect(view.container.querySelector('img')?.getAttribute('src')).toBe('blob:synthetic-1'));
    await act(async () => { await repo.commit({ kind: 'replace', books: [book], coverMedia: [syntheticCover('image/jpeg')] }, await repo.readRevision()); });
    await vi.waitFor(() => expect(view.container.querySelector('img')?.getAttribute('src')).toBe('blob:synthetic-2'));
    expect(created[1].type).toBe('image/jpeg'); expect(revoked).toHaveBeenCalledWith('blob:synthetic-1');
    fireEvent.error(view.container.querySelector('img')!);
    expect(revoked).toHaveBeenCalledWith('blob:synthetic-2'); expect(view.container.querySelector('img')).toBeNull();
  });
  it('falls back when local media is missing or unreadable without changing storage', async () => {
    const { view, repo, show } = await setup(local(), async id => { if (id === coverId) return null; throw new Error('synthetic unavailable'); });
    expect(view.container.querySelector('img')).toBeNull(); show(local(crypto.randomUUID()));
    await vi.waitFor(() => expect(screen.getByText('Sem capa · Título sintético')).toBeTruthy());
    const version = await repo.readRevision(); expect(version.revision).toBe(0);
    // Reads and fallbacks do not write even orphan media.
    const entry = opened.at(-1)!; const db = await openDB(entry.name); expect(await db.count('coverMedia')).toBe(0); db.close();
  });
});
