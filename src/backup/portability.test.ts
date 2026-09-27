import 'fake-indexeddb/auto';
import { openDB, deleteDB } from 'idb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openLibraryRepository } from '../adapters/indexeddb/library-repository';
import type { LibraryDatabase } from '../adapters/indexeddb/schema';
import { createBook, type Book } from '../domain/book';
import { LIBRARY_LIMITS, utf8ByteLength } from '../domain/library';
import { COVER_LIMITS, type CoverMedia } from '../media/cover';
import { createBackupService } from '../services/backup-service';
import { assertPortableBudget, portableBytes } from './media';
import { paddedCover, syntheticCover, stubImageDecoder } from '../../test/fixtures/covers/helpers';

const now = '2026-09-26T12:00:00.000Z';
const book = (cover?: CoverMedia): Book => createBook({ title: 'Livro sintético', ...(cover ? { cover: { provider: 'local', mediaId: cover.id } } : {}) }, { id: crypto.randomUUID(), now, shelfYear: 2026 });
const closes: (() => Promise<void>)[] = [];
async function setup() {
  const name = crypto.randomUUID(); const repo = await openLibraryRepository({ name, channelFactory: null });
  const db = await openDB<LibraryDatabase>(name);
  closes.push(async () => { db.close(); repo.close(); await deleteDB(name); });
  return { repo, db, service: createBackupService(repo) };
}
beforeEach(stubImageDecoder);
afterEach(async () => { vi.unstubAllGlobals(); vi.restoreAllMocks(); for (const close of closes.splice(0)) await close(); });

describe('portable media budget and collection', () => {
  it('accepts the exact JSON budget including base64 metadata and envelope, and refuses one more byte', () => {
    const media = [syntheticCover()]; const overhead = portableBytes(0, media);
    expect(() => assertPortableBudget(LIBRARY_LIMITS.jsonBytes - overhead, media)).not.toThrow();
    expect(() => assertPortableBudget(LIBRARY_LIMITS.jsonBytes - overhead + 1, media)).toThrow('ImportTooLarge');
    expect(overhead).toBeGreaterThan(LIBRARY_LIMITS.exportEnvelopeBytes + media[0].bytes.size);
  });

  it('enforces count and aggregate byte boundaries independently', async () => {
    const { repo } = await setup();
    const small = Array.from({ length: COVER_LIMITS.count }, () => ({ ...syntheticCover(), id: crypto.randomUUID() }));
    let version = await repo.commit({ kind: 'replace', books: small.map(book), coverMedia: small }, await repo.readRevision());
    const extra = { ...syntheticCover(), id: crypto.randomUUID() };
    await expect(repo.commit({ kind: 'put', book: book(extra), coverMedia: extra }, version)).rejects.toMatchObject({ code: 'ImportTooLarge' });
    const large = Array.from({ length: 6 }, () => ({ ...paddedCover(COVER_LIMITS.bytes), id: crypto.randomUUID() }));
    version = await repo.commit({ kind: 'replace', books: large.map(book), coverMedia: large }, version);
    large[5] = { ...paddedCover(COVER_LIMITS.bytes - extra.bytes.size + 1), id: large[5].id };
    version = await repo.commit({ kind: 'replace', books: large.map(book), coverMedia: large }, version);
    expect(large.reduce((sum, value) => sum + value.bytes.size, extra.bytes.size)).toBe(COVER_LIMITS.totalBytes + 1);
    await expect(repo.commit({ kind: 'put', book: book(extra), coverMedia: extra }, version)).rejects.toMatchObject({ code: 'ImportTooLarge' });
    expect((await repo.readBackupSnapshot()).coverMedia).toHaveLength(6);
  });

  it('collects replaced/deleted covers, preserves shared case-insensitive references and refuses a missing reference', async () => {
    const { repo, db } = await setup(); const media = syntheticCover(); const a = book(media);
    const b = { ...book(media), cover: { provider: 'local' as const, mediaId: media.id.toUpperCase() } };
    let version = await repo.commit({ kind: 'replace', books: [a, b], coverMedia: [media] }, await repo.readRevision());
    for (let index = 0; index < 8; index++) {
      const next = { ...syntheticCover(), id: crypto.randomUUID() };
      version = await repo.commit({ kind: 'put', book: { ...a, cover: { provider: 'local', mediaId: next.id } }, coverMedia: next }, version);
      expect(await db.count('coverMedia')).toBe(2);
      expect(await repo.readCover(media.id)).not.toBeNull();
    }
    version = await repo.commit({ kind: 'delete', id: a.id }, version);
    expect(await db.count('coverMedia')).toBe(1);
    version = await repo.commit({ kind: 'delete', id: b.id }, version);
    expect(await db.count('coverMedia')).toBe(0);
    await expect(repo.commit({ kind: 'put', book: a }, version)).rejects.toMatchObject({ code: 'InvalidBackup' });
    expect((await repo.readAll()).books).toEqual([]);
  });

  it('reads legacy excess/orphans without deleting, exports only referenced media, and collects on an authorized write', async () => {
    const { repo, db, service } = await setup(); const media = syntheticCover(); const a = book(media);
    await repo.commit({ kind: 'put', book: a, coverMedia: media }, await repo.readRevision());
    for (let i = 0; i < 101; i++) { const orphan = { ...media, id: crypto.randomUUID() }; await db.put('coverMedia', orphan, orphan.id); }
    expect((await repo.readBackupSnapshot()).coverMedia).toHaveLength(1);
    expect(await db.count('coverMedia')).toBe(102);
    expect(JSON.parse((await service.exportBackup(now)).text).coverMedia).toHaveLength(1);
    expect(await db.count('coverMedia')).toBe(102);
    await repo.commit({ kind: 'put', book: { ...a, title: 'Editado' } }, await repo.readRevision());
    expect(await db.count('coverMedia')).toBe(1);
  });

  it('exports one revision while another tab replaces books and media', async () => {
    const { repo, service } = await setup(); const media = syntheticCover(); const a = book(media);
    const version = await repo.commit({ kind: 'put', book: a, coverMedia: media }, await repo.readRevision());
    const read = repo.readBackupSnapshot.bind(repo);
    vi.spyOn(repo, 'readBackupSnapshot').mockImplementationOnce(async () => {
      const snapshot = await read();
      await repo.commit({ kind: 'replace', books: [], coverMedia: [] }, version);
      return snapshot;
    });
    const exported = await service.exportBackup(now); const data = JSON.parse(exported.text);
    expect(exported.version).toEqual(version); expect(data.books).toEqual([a]); expect(data.coverMedia[0].id).toBe(media.id);
    expect((await repo.readAll()).books).toEqual([]);
  });

  it('round-trips the maximum accepted state and rejects count, byte and combined-budget increments atomically', async () => {
    const { repo, db, service } = await setup();
    const tiny = syntheticCover(); const large = paddedCover(COVER_LIMITS.bytes);
    const covers = Array.from({ length: 100 }, (_, index) => ({
      ...(index < 5 ? large : index === 5 ? paddedCover(COVER_LIMITS.bytes - 94 * tiny.bytes.size) : tiny), id: crypto.randomUUID(),
    }));
    expect(covers.reduce((sum, item) => sum + item.bytes.size, 0)).toBe(COVER_LIMITS.totalBytes);
    const books = covers.map(book); let bookBytes = utf8ByteLength(JSON.stringify(books));
    let remaining = LIBRARY_LIMITS.jsonBytes - portableBytes(bookBytes, covers);
    while (remaining > 21000) {
      const next = { ...book(), note: 'x'.repeat(20000) }; const bytes = utf8ByteLength(JSON.stringify(next)) + 1;
      books.push(next); bookBytes += bytes; remaining -= bytes;
    }
    books[0].note = 'x'.repeat(Math.min(remaining, 20000));
    bookBytes = utf8ByteLength(JSON.stringify(books));
    const lastRemaining = LIBRARY_LIMITS.jsonBytes - portableBytes(bookBytes, covers);
    books[1].note = 'x'.repeat(lastRemaining);
    expect(portableBytes(utf8ByteLength(JSON.stringify(books)), covers)).toBe(LIBRARY_LIMITS.jsonBytes);
    const version = await repo.commit({ kind: 'replace', books, coverMedia: covers }, await repo.readRevision());
    const exported = await service.exportBackup(now);
    expect(exported.blob.size).toBeLessThanOrEqual(LIBRARY_LIMITS.jsonBytes);
    const next = await setup();
    await next.service.confirmImport(await next.service.prepareImport({ size: exported.blob.size, text: async () => exported.text }));
    expect((await next.repo.readAll()).books).toEqual([...books].sort((a, b) => a.id.localeCompare(b.id)));
    expect(await next.db.count('coverMedia')).toBe(100);
    expect(await (await next.repo.readCover(covers[0].id))!.bytes.arrayBuffer()).toEqual(await covers[0].bytes.arrayBuffer());
    expect((await next.service.exportBackup(now)).text).toBe(exported.text);
    await expect(repo.commit({ kind: 'put', book: { ...books[1], note: books[1].note + 'x' } }, version)).rejects.toMatchObject({ code: 'ImportTooLarge' });
    const extra = { ...tiny, id: crypto.randomUUID() };
    await expect(repo.commit({ kind: 'put', book: book(extra), coverMedia: extra }, version)).rejects.toMatchObject({ code: 'ImportTooLarge' });
    await expect(repo.commit({ kind: 'put', book: books[0], coverMedia: { ...covers[0], bytes: new Blob([large.bytes, 'x'], { type: 'image/png' }) } }, version)).rejects.toMatchObject({ code: 'InvalidBook' });
    expect(await repo.readRevision()).toEqual(version); expect(await db.count('coverMedia')).toBe(100);
  }, 120000);
});
