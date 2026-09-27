import { coverId, encodedCover, syntheticCover, stubImageDecoder } from '../../test/fixtures/covers/helpers';
import 'fake-indexeddb/auto';
import { deleteDB } from 'idb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fixture from '../../test/fixtures/backups/v1.json';
import { openLibraryRepository } from '../adapters/indexeddb/library-repository';
import { openCoverMediaRepository } from '../adapters/indexeddb/cover-media';
import { LIBRARY_LIMITS } from '../domain/library';
import { createBook, parseBook } from '../domain/book';
import type { LibraryRepository } from '../ports/library-repository';
import { createBackupService } from '../services/backup-service';
import { parseBackupText, serializeBackup } from './serialize';

const text = JSON.stringify(fixture);
const file = (value = text) => ({ size: new Blob([value]).size, text: async () => value });
const opened: { repo: LibraryRepository; media: { close(): void }; name: string }[] = [];
async function setup() {
  const name = `backup-synthetic-${crypto.randomUUID()}`;
  const repo = await openLibraryRepository({ name, channelFactory: null });
  const media = await openCoverMediaRepository({ name });
  opened.push({ repo, media, name });
  return { repo, media, service: createBackupService(repo) };
}
beforeEach(stubImageDecoder);
afterEach(async () => { vi.unstubAllGlobals(); for (const { repo, media, name } of opened.splice(0)) { repo.close(); media.close(); await deleteDB(name); } });

describe('portable V1 backup', () => {
  it.each(['image/png', 'image/jpeg', 'image/webp'] as const)('prepares real synthetic %s bytes before confirmation', async mime => {
    const { service, media } = await setup();
    const incoming = { ...fixture, books: [{ ...fixture.books[0], cover: { provider: 'local', mediaId: coverId } }], coverMedia: [encodedCover(mime)] };
    const preview = await service.prepareImport(file(JSON.stringify(incoming)));
    expect(await media.all()).toEqual([]);
    await service.confirmImport(preview);
    expect(await (await media.read(coverId))?.bytes.arrayBuffer()).toEqual(await syntheticCover(mime).bytes.arrayBuffer());
  });

  it.each([
    ['invalid base64', { bytes: '!!!!' }], ['noncanonical base64', { bytes: 'Zh==' }],
    ['wrong MIME', { mimeType: 'image/jpeg' }], ['wrong dimensions', { width: 33 }],
    ['truncated image', { bytes: encodedCover().bytes.slice(0, 32) }],
    ['false image', { bytes: btoa('not an image') }],
  ])('rejects %s before preview and preserves media', async (_, patch) => {
    const { repo, media, service } = await setup();
    await repo.commit({ kind: 'put', book: parseBook({ ...fixture.books[0], cover: { provider: 'local', mediaId: coverId } }), coverMedia: syntheticCover() }, await repo.readRevision());
    const before = await repo.readBackupSnapshot();
    await expect(service.prepareImport(file(JSON.stringify({ ...fixture, coverMedia: [{ ...encodedCover(), ...patch }] }))))
      .rejects.toMatchObject({ code: 'InvalidBackup' });
    expect(await repo.readBackupSnapshot()).toEqual(before);
    expect(await (await media.read(coverId))?.bytes.arrayBuffer()).toEqual(await syntheticCover().bytes.arrayBuffer());
  });

  it('rejects duplicate case-variant media IDs and missing references before preview', async () => {
    const { service } = await setup();
    await expect(service.prepareImport(file(JSON.stringify({ ...fixture, coverMedia: [encodedCover(), { ...encodedCover(), id: coverId.toUpperCase() }] }))))
      .rejects.toMatchObject({ code: 'InvalidBackup' });
    await expect(service.prepareImport(file(JSON.stringify({ ...fixture, books: [{ ...fixture.books[0], cover: { provider: 'local', mediaId: coverId } }] }))))
      .rejects.toMatchObject({ code: 'InvalidBackup' });
  });

  it('checks decoded individual and aggregate sizes before allocating or decoding', async () => {
    const { service } = await setup();
    const oversized = btoa('x'.repeat(2 * 1024 * 1024 + 1));
    await expect(service.prepareImport(file(JSON.stringify({ ...fixture, coverMedia: [{ ...encodedCover(), bytes: oversized }] }))))
      .rejects.toMatchObject({ code: 'ImportTooLarge' });
    const entries = Array.from({ length: 7 }, () => ({ ...encodedCover(), id: crypto.randomUUID(), bytes: btoa('x'.repeat(2 * 1024 * 1024)) }));
    await expect(service.prepareImport(file(JSON.stringify({ ...fixture, coverMedia: entries })))).rejects.toMatchObject({ code: 'ImportTooLarge' });
    expect(createImageBitmap).not.toHaveBeenCalled();
  });

  it('round-trips local cover bytes separately from the book record', async () => {
    const a = await setup(); const id = 'a5f7ab9f-c2ed-4779-b274-f89ae62716ed';
    const book = createBook({ title: 'Com capa', cover: { provider: 'local', mediaId: id } }, { id: crypto.randomUUID(), now: fixture.exportedAt, shelfYear: 2026 });
    await a.repo.commit({ kind: 'put', book, coverMedia: syntheticCover() }, await a.repo.readRevision());
    const exported = await a.service.exportBackup(fixture.exportedAt);
    const b = await setup(); await b.service.confirmImport(await b.service.prepareImport(file(exported.text)));
    expect((await b.repo.readAll()).books[0].cover).toEqual({ provider: 'local', mediaId: id });
    expect(await (await b.media.read(id))?.bytes.arrayBuffer()).toEqual(await syntheticCover().bytes.arrayBuffer());
  });
  it('restores every book field and portable preference into a fresh profile', async () => {
    const a = await setup();
    await a.service.confirmImport(await a.service.prepareImport(file()));
    const exported = await a.service.exportBackup(fixture.exportedAt);
    const b = await setup();
    const preview = await b.service.prepareImport(file(exported.text));
    expect(preview).toEqual({ incoming: { count: 1, years: [2025] }, current: { count: 0, years: [] } });
    expect((await b.repo.readAll()).books).toEqual([]);
    await b.service.confirmImport(preview);
    expect((await b.repo.readAll()).books).toEqual(fixture.books);
    expect(await b.repo.readPreferences()).toEqual({ ...fixture.preferences, lastExport: null });
    expect((await b.service.exportBackup(fixture.exportedAt)).text).toBe(exported.text);
    expect(exported.filename).toBe('livro-a-livro-2026-09-26.json');
    expect(await exported.blob.text()).toBe(exported.text);
  });

  it('serializes deterministically regardless of key and book input order', () => {
    const first = parseBackupText(text);
    const second = { ...first.books[0], id: '00000000-0000-4000-8000-000000000001' };
    first.books.push(second);
    const reversed: Record<string, unknown> = Object.fromEntries(Object.entries(first).reverse());
    reversed.books = [...first.books].reverse().map(book => Object.fromEntries(Object.entries(book).reverse()));
    expect(serializeBackup(parseBackupText(JSON.stringify(reversed)))).toBe(serializeBackup(first));
    expect(serializeBackup(first).endsWith('\n')).toBe(true);
    expect(first.books[0].id).toBe(fixture.books[0].id);
  });

  it.each([
    ['syntax', '{'], ['null', 'null'], ['unknown field', JSON.stringify({ ...fixture, secret: 'PRIVATE' })],
    ['duplicate UUID', JSON.stringify({ ...fixture, books: [fixture.books[0], fixture.books[0]] })],
    ['invalid date', JSON.stringify({ ...fixture, books: [{ ...fixture.books[0], finishedOn: '2025-02-30' }] })],
    ['oversized note', JSON.stringify({ ...fixture, books: [{ ...fixture.books[0], note: 'x'.repeat(20001) }] })],
    ['missing preferences', JSON.stringify({ ...fixture, preferences: undefined })],
    ['nested unknown', JSON.stringify({ ...fixture, preferences: { ...fixture.preferences, token: 'PRIVATE' } })],
  ])('rejects %s without changing library or preferences', async (_, input) => {
    const { repo, service } = await setup();
    await service.confirmImport(await service.prepareImport(file()));
    const before = await repo.readBackupSnapshot();
    await expect(service.prepareImport(file(input))).rejects.toMatchObject({ code: 'InvalidBackup' });
    expect(await repo.readBackupSnapshot()).toEqual(before);
  });

  it.each([0, 2, 100])('refuses unsupported version %s explicitly', version => {
    expect(() => parseBackupText(JSON.stringify({ ...fixture, schemaVersion: version }))).toThrow('UnsupportedVersion');
  });

  it('rejects excessive declared size before reading and checks actual UTF-8 length', async () => {
    const { service } = await setup();
    const read = vi.fn();
    await expect(service.prepareImport({ size: LIBRARY_LIMITS.jsonBytes + 1, text: read })).rejects.toThrow('ImportTooLarge');
    expect(read).not.toHaveBeenCalled();
    expect(() => parseBackupText('é'.repeat(LIBRARY_LIMITS.jsonBytes / 2 + 1))).toThrow('ImportTooLarge');
  });

  it('refuses over 10000 books without partial writes', () => {
    expect(() => parseBackupText(JSON.stringify({ ...fixture, books: Array(10001).fill(fixture.books[0]) })))
      .toThrow('ImportTooLarge');
  });

  it('checks actual bytes before an injected parser even when the declared size is small', async () => {
    const { repo } = await setup();
    const parser = vi.fn(async () => parseBackupText(text));
    const service = createBackupService(repo, parser);
    const before = await repo.readBackupSnapshot();
    await expect(service.prepareImport({ size: 1,
      text: async () => 'é'.repeat(LIBRARY_LIMITS.jsonBytes / 2 + 1),
    })).rejects.toThrow('ImportTooLarge');
    expect(parser).not.toHaveBeenCalled();
    expect(await repo.readBackupSnapshot()).toEqual(before);
  });

  it('invalidates old/cancelled/foreign previews and only permits one commit', async () => {
    const { service } = await setup();
    const old = await service.prepareImport(file());
    const current = await service.prepareImport(file());
    expect(Object.isFrozen(current.incoming.years)).toBe(true);
    await expect(service.confirmImport(old)).rejects.toThrow('InvalidBackup');
    await expect(service.confirmImport({ ...current })).rejects.toThrow('InvalidBackup');
    service.cancelImport();
    await expect(service.confirmImport(current)).rejects.toThrow('InvalidBackup');
    const next = await service.prepareImport(file());
    await service.confirmImport(next);
    await expect(service.confirmImport(next)).rejects.toThrow('InvalidBackup');
  });

  it('refuses stale replacement and leaves concurrent books and preferences intact', async () => {
    const { repo, media, service } = await setup();
    await repo.commit({ kind: 'put', book: parseBook({ ...fixture.books[0], cover: { provider: 'local', mediaId: coverId } }), coverMedia: syntheticCover() }, await repo.readRevision());
    const preview = await service.prepareImport(file());
    const book = createBook({ title: 'Outro sintético' }, { id: crypto.randomUUID(), now: fixture.exportedAt, shelfYear: 2026 });
    await repo.commit({ kind: 'put', book }, await repo.readRevision());
    const before = await repo.readBackupSnapshot();
    await expect(service.confirmImport(preview)).rejects.toThrow('StaleRevision');
    expect(await repo.readBackupSnapshot()).toEqual(before);
    expect(await (await media.read(coverId))?.bytes.arrayBuffer()).toEqual(await syntheticCover().bytes.arrayBuffer());
  });

  it('allows an empty replacement after preview and records only download start explicitly', async () => {
    const { repo, service } = await setup();
    await service.confirmImport(await service.prepareImport(file()));
    const exported = await service.exportBackup(fixture.exportedAt);
    expect((await repo.readPreferences()).lastExport).toBeNull();
    await service.recordDownloadStarted(fixture.exportedAt, exported.version);
    expect((await repo.readPreferences()).lastExport?.version).toEqual(exported.version);
    const preview = await service.prepareImport(file(JSON.stringify({ ...fixture, books: [] })));
    expect(preview.current.count).toBe(1);
    await service.confirmImport(preview);
    expect((await repo.readAll()).books).toEqual([]);
    expect((await repo.readPreferences()).lastExport).toBeNull();
  });
});
