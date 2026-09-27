import { syntheticCover } from '../../test/fixtures/covers/helpers';
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openLibraryRepository } from '../adapters/indexeddb/library-repository';
import { createBook } from '../domain/book';
import { DomainError } from '../domain/errors';
import { createLibraryService } from './library-service';
import type { LibraryRepository } from '../ports/library-repository';

const repositories: LibraryRepository[] = [];
afterEach(() => { repositories.splice(0).forEach((repository) => repository.close()); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function setup() {
  const repository = await openLibraryRepository({ name: crypto.randomUUID(), channelFactory: null });
  repositories.push(repository);
  const service = createLibraryService(repository, { id: () => crypto.randomUUID(), now: () => '2026-09-26T12:00:00.000Z' });
  return { repository, service };
}
describe('library editing service', () => {
  it('keeps prepared bytes in the draft through duplicates and stale failures, then saves atomically', async () => {
    const { repository, service } = await setup();
    const draft = { title: 'Duplicado' };
    await service.save({ draft, year: 2026, expected: await service.readRevision() });
    const media = syntheticCover(); const withCover = { ...draft, cover: { provider: 'local' as const, mediaId: media.id } };
    const expected = await service.readRevision();
    expect(await service.save({ draft: withCover, coverMedia: media, year: 2026, expected })).toMatchObject({ kind: 'duplicate' });
    expect(await repository.readCover(media.id)).toBeNull();
    await service.save({ draft: { title: 'Outra aba' }, year: 2026, expected });
    await expect(service.save({ draft: withCover, coverMedia: media, year: 2026, expected, allowDuplicate: true })).rejects.toMatchObject({ code: 'StaleRevision' });
    expect(await repository.readCover(media.id)).toBeNull();
    const saved = await service.save({ draft: withCover, coverMedia: media, year: 2026, expected: await service.readRevision(), allowDuplicate: true });
    expect(saved.kind).toBe('saved');
    expect(await (await repository.readCover(media.id))!.bytes.arrayBuffer()).toEqual(await media.bytes.arrayBuffer());
  });

  it('rolls back a new book and its cover after a late quota failure', async () => {
    const { repository, service } = await setup(); const media = syntheticCover();
    const put = IDBObjectStore.prototype.put;
    const failing = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args) {
      if (this.name === 'syncOutbox') throw new DOMException('synthetic', 'QuotaExceededError');
      return put.apply(this, args);
    });
    await expect(service.save({ draft: { title: 'Capa', cover: { provider: 'local', mediaId: media.id } }, coverMedia: media, year: 2026, expected: await service.readRevision() })).rejects.toMatchObject({ code: 'QuotaExceeded' });
    failing.mockRestore();
    expect((await repository.readAll()).books).toEqual([]); expect(await repository.readCover(media.id)).toBeNull();
  });

  it('saves locally with defaults and preserves identity, creation, source and literal note on edit', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const { repository, service } = await setup();
    const original = createBook({ title: 'Livro sintético', source: { provider: 'open_library', workId: 'OL1W', editionId: null, retrievedAt: '2025-01-01T00:00:00Z' },
      cover: { provider: 'open_library', coverId: 1 } }, { id: crypto.randomUUID(), now: '2025-01-01T00:00:00Z', shelfYear: 2026 });
    const version = await repository.commit({ kind: 'put', book: original }, await service.readRevision());
    const saved = await service.save({ id: original.id, draft: { title: 'Novo título', note: '  <b>Privada</b>\n', rating: 4 }, year: 2026, expected: version });
    expect(saved.kind).toBe('saved');
    const { book } = await service.readBook(original.id);
    expect(book).toMatchObject({ id: original.id, createdAt: original.createdAt, source: original.source, cover: original.cover, note: '  <b>Privada</b>\n', rating: 4 });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('warns about duplicates without committing, then permits intentional rereading', async () => {
    const { service, repository } = await setup();
    const draft = { title: 'Livro sintético', authors: ['Autora sintética'] };
    await service.save({ draft, year: 2026, expected: await service.readRevision() });
    const version = await service.readRevision();
    expect(await service.save({ draft, year: 2026, expected: version })).toEqual({ kind: 'duplicate', count: 1 });
    expect(await service.readRevision()).toEqual(version);
    await service.save({ draft, year: 2026, expected: version, allowDuplicate: true });
    const { books } = await repository.readAll();
    expect(books).toHaveLength(2);
    expect(new Set(books.map((book) => book.id)).size).toBe(2);
  });
  it.each([
    { title: 'Inválido', status: 'want-to-read', startedOn: '2026-01-01' },
    { title: 'Inválido', status: 'reading', finishedOn: '2026-01-01' },
    { title: 'Inválido', status: 'read', startedOn: '2026-02-01', finishedOn: '2026-01-01' },
    { title: 'Inválido', status: 'read', finishedOn: '2025-01-01' },
  ] as const)('rejects inconsistent dates without any commit: %j', async (draft) => {
    const { service, repository } = await setup();
    const expected = await service.readRevision();
    await expect(service.save({ draft, year: 2026, expected })).rejects.toMatchObject({ code: 'InvalidBook' });
    expect(await repository.readAll()).toEqual({ books: [], version: expected });
  });
  it('rejects stale edit/delete even when the change happened during duplicate confirmation or replaced the library', async () => {
    const { service, repository } = await setup();
    const saved = await service.save({ draft: { title: 'Original' }, year: 2026, expected: await service.readRevision() });
    if (saved.kind !== 'saved') throw new Error('fixture');
    await repository.commit({ kind: 'replace', books: [saved.book] }, saved.version);
    await expect(service.save({ id: saved.book.id, draft: { title: 'Obsoleto' }, year: 2026, expected: saved.version, allowDuplicate: true })).rejects.toMatchObject({ code: 'StaleRevision' });
    await expect(service.remove(saved.book.id, saved.version)).rejects.toMatchObject({ code: 'StaleRevision' });
    expect((await service.readBook(saved.book.id)).book?.title).toBe('Original');
  });
  it('propagates quota failure and only confirms deletion after a committed transaction', async () => {
    const { service, repository } = await setup();
    const expected = await service.readRevision();
    const commit = vi.spyOn(repository, 'commit').mockRejectedValueOnce(new DomainError('QuotaExceeded'));
    await expect(service.save({ draft: { title: 'Livro' }, year: 2026, expected })).rejects.toMatchObject({ code: 'QuotaExceeded' });
    expect((await repository.readAll()).books).toEqual([]);
    commit.mockRestore();
    const saved = await service.save({ draft: { title: 'Livro' }, year: 2026, expected });
    if (saved.kind !== 'saved') throw new Error('fixture');
    await service.remove(saved.book.id, saved.version);
    expect((await service.readBook(saved.book.id)).book).toBeNull();
  });
});
