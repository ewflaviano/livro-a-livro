import { createDriveClient } from './drive-client';
import { beforeEach, expect, it, vi } from 'vitest';
import { encodedCover, stubImageDecoder } from '../../test/fixtures/covers/helpers';
import { createBook } from '../domain/book';
import type { LibraryExport } from '../backup/schema';
import { libraryHash, libraryHashV1, libraryHashV2, parseSnapshot, remoteHeads } from './snapshot';
const now = '2026-09-26T12:00:00.000Z';
const id = 'ABCDEF00-0000-4000-8000-000000000001';
const library = (): LibraryExport => ({ format: 'livro-a-livro', schemaVersion: 1, exportedAt: now,
  books: [createBook({ title: 'Fixture V1', authors: ['Autoria sintética'], status: 'read', cover: { provider: 'local', mediaId: encodedCover().id } }, { id, now, shelfYear: 2026 })],
  preferences: { shelfYear: 2026, mode: 'list', filter: 'read' }, coverMedia: [encodedCover()] });
beforeEach(() => stubImageDecoder());
it('freezes the historical V1 digest and serialization including uppercase UUID and media', async () => {
  const data = library();
  expect(await libraryHash(data)).toBe('dc9dab7e904ad529031e0ffae6af0917bc7c2f64ad0972ead30f8adda6d3bf72');
  const snapshot = { format: 'livro-a-livro-sync' as const, protocolVersion: 1 as const, snapshotId: id, operationId: 'ABCDEF00-0000-4000-8000-000000000002', parentSnapshotId: null, resolvedSnapshotIds: [], hash: await libraryHash(data), createdAt: now, library: data };
  expect([...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(await parseSnapshot(snapshot)))))].map(n => n.toString(16).padStart(2,'0')).join('')).toBe('f871ba8218f19782c79afd643af09702ff3bb869600e29e5aae6617fef7981a6');
  expect(JSON.stringify(await parseSnapshot(snapshot))).toBe(JSON.stringify(snapshot));
});

it('V2 canonicalizes keys, book/media order and UUID case without changing wire values', async () => {
  const first = library(); const secondId = 'abcdef00-0000-4000-8000-000000000003'; const mediaId = 'abcdef00-0000-4000-8000-000000000004';
  first.books.push({ ...first.books[0], id: secondId, authors: ['A', 'B'], cover: { provider: 'local', mediaId } });
  first.coverMedia.push({ ...first.coverMedia[0], id: mediaId });
  const reordered = structuredClone(first); reordered.books.reverse(); reordered.coverMedia.reverse();
  reordered.books = reordered.books.map(book => Object.fromEntries(Object.entries({ ...book, id: book.id.toUpperCase(), cover: book.cover?.provider === 'local' ? { mediaId: book.cover.mediaId.toUpperCase(), provider: 'local' as const } : book.cover }).reverse()) as typeof book);
  reordered.coverMedia = reordered.coverMedia.map(media => ({ ...media, id: media.id.toUpperCase() }));
  const before = JSON.stringify(reordered);
  expect(await libraryHashV2(first)).toBe(await libraryHashV2(reordered)); expect(JSON.stringify(reordered)).toBe(before);
  expect(await libraryHashV1(first)).not.toBe(await libraryHashV1(reordered));
  reordered.books[0].authors.reverse(); expect(await libraryHashV2(first)).not.toBe(await libraryHashV2(reordered));
});
it('V2 detects every portable preference and complete book/media field while V1 remains preference blind', async () => {
  const source = library(); const initial = await libraryHashV2(source);
  for (const patch of [{ shelfYear: 2025 }, { mode: 'grid' as const }, { filter: 'all' as const }]) {
    const changed = { ...source, preferences: { ...source.preferences, ...patch } };
    expect(await libraryHashV1(changed)).toBe(await libraryHashV1(source)); expect(await libraryHashV2(changed)).not.toBe(initial);
  }
  for (const patch of [{ title: 'Outro' }, { note: 'Nota sintética' }, { rating: 4 as const }, { pageCount: 123 }, { isbn: '9788535914849' }, { publicationYear: 2020 }, { shelfYear: 2025 }, { startedOn: '2026-01-01' }, { finishedOn: '2026-01-02' }, { updatedAt: '2026-10-01T00:00:00Z' }]) {
    expect(await libraryHashV2({ ...source, books: [{ ...source.books[0], ...patch }] })).not.toBe(initial);
  }
  for (const patch of [{ width: 31 }, { height: 47 }, { mimeType: 'image/jpeg' as const }, { bytes: encodedCover('image/jpeg').bytes }, { createdAt: '2026-10-01T00:00:00Z' }]) {
    expect(await libraryHashV2({ ...source, coverMedia: [{ ...source.coverMedia[0], ...patch }] })).not.toBe(initial);
  }
});
it('rejects future versions, V2 orphans and casefold duplicates while accepting V1 orphans historically', async () => {
  const data = library(); const base = { format: 'livro-a-livro-sync' as const, snapshotId: crypto.randomUUID(), operationId: crypto.randomUUID(), parentSnapshotId: null, resolvedSnapshotIds: [], createdAt: now };
  const orphan = { ...data, books: [] };
  await expect(parseSnapshot({ ...base, protocolVersion: 1, library: orphan, hash: await libraryHashV1(orphan) })).resolves.toBeDefined();
  await expect(parseSnapshot({ ...base, protocolVersion: 2, library: orphan, hash: await libraryHashV2(orphan) })).rejects.toMatchObject({ code: 'invalid' });
  await expect(parseSnapshot({ ...base, protocolVersion: 3, library: data, hash: await libraryHashV2(data) })).rejects.toMatchObject({ code: 'invalid' });
  await expect(libraryHashV2({ ...data, coverMedia: [data.coverMedia[0], { ...data.coverMedia[0], id: data.coverMedia[0].id.toUpperCase() }] })).rejects.toBeDefined();
  await expect(libraryHashV2({ ...data, books: [data.books[0], { ...data.books[0], id: data.books[0].id.toLowerCase() }] })).rejects.toBeDefined();
});
it('rejects case aliases and hidden cycles without rewriting V1 wire IDs', async () => {
  const make = (snapshotId: string, operationId: string, parentSnapshotId: string | null = null) => ({ id: snapshotId, size: 1, header: { format: 'livro-a-livro-sync' as const, protocolVersion: 1 as const, snapshotId, operationId, parentSnapshotId, resolvedSnapshotIds: [], createdAt: now, hash: '0'.repeat(64) } });
  const a = make(id, 'abcdef00-0000-4000-8000-000000000002');
  expect(() => remoteHeads([a, make(id.toLowerCase(), a.header.operationId)])).toThrow();
  expect(() => remoteHeads([a, make('abcdef00-0000-4000-8000-000000000003', a.header.operationId.toUpperCase())])).toThrow();
  expect(() => remoteHeads([{ ...a, header: { ...a.header, parentSnapshotId: id.toLowerCase() } }])).toThrow();
  expect(remoteHeads([a])[0].header.snapshotId).toBe(id);
});

const auth = { token: async () => 'synthetic', invalidate() {} } as unknown as import('./contracts').AuthClient;
const binding = { connectionId: 'synthetic', generation: 1 };
const wire = async (data = library(), version: 1 | 2 = 1): Promise<import('./contracts').SyncSnapshot> => ({ format: 'livro-a-livro-sync' as const, protocolVersion: version, snapshotId: crypto.randomUUID(), operationId: crypto.randomUUID(), parentSnapshotId: null, resolvedSnapshotIds: [] as string[], hash: await (version === 1 ? libraryHashV1 : libraryHashV2)(data), createdAt: now, library: data });
const metadata = (snapshot: import('./contracts').SyncSnapshot, id = 'synthetic-file') => ({ id, size: String(JSON.stringify(snapshot).length), appProperties: { protocolVersion: String(snapshot.protocolVersion), snapshotId: snapshot.snapshotId, operationId: snapshot.operationId, parentSnapshotId: snapshot.parentSnapshotId ?? 'root', hash: snapshot.hash, createdAt: snapshot.createdAt, resolution: snapshot.resolvedSnapshotIds.length ? '1' : '0' } });
const response = (data: unknown) => new Response(JSON.stringify(data));
it('HTTP duplicate V1 operations must have equal complete preferences, not merely the historical hash', async () => {
  const a = await wire(); const b = { ...a, library: { ...a.library, preferences: { ...a.library.preferences, mode: 'grid' as const } } };
  expect(await libraryHashV1(a.library)).toBe(await libraryHashV1(b.library));
  const fetcher = vi.fn<typeof fetch>(async url => String(url).includes('alt=media') ? response(String(url).includes('/first?') ? a : b) : response({ files: [metadata(a,'first'),metadata(b,'second')] }));
  await expect(createDriveClient(auth,binding,fetcher).list(new AbortController().signal)).rejects.toMatchObject({ code: 'invalid' });
});
it('HTTP resolution-header cache is reused only for identical metadata', async () => {
  const root = await wire(); const resolved = await wire(); resolved.resolvedSnapshotIds = [root.snapshotId]; resolved.parentSnapshotId = root.snapshotId;
  let current = resolved; let downloads = 0;
  const fetcher = vi.fn<typeof fetch>(async url => { if (String(url).includes('alt=media')) { downloads++; return response(current); } return response({ files: [metadata(root,'root'), metadata(current,'resolved')] }); });
  const client = createDriveClient(auth,binding,fetcher); const signal = new AbortController().signal;
  await client.list(signal); await client.list(signal); expect(downloads).toBe(1);
  current = { ...resolved, createdAt: '2026-09-27T00:00:00Z' };
  expect((await client.list(signal)).find(file => file.id === 'resolved')?.header.createdAt).toBe(current.createdAt); expect(downloads).toBe(2);
});
it.each([false,true])('HTTP refuses a payload inconsistent with resolution metadata %s', async bit => {
  const data = await wire(); data.resolvedSnapshotIds = bit ? [] : [crypto.randomUUID()];
  const fetcher = vi.fn<typeof fetch>(async () => response(data));
  const { library: _, ...header } = data;
  await expect(createDriveClient(auth,binding,fetcher).download({ id: 'synthetic',size: 1000,header: { ...header,resolvedSnapshotIds: [] },resolution: bit },new AbortController().signal)).rejects.toMatchObject({ code: 'invalid' });
});
it.each([1,2] as const)('HTTP uploads V%i with unchanged historical discovery name and exact V1 body bytes', async version => {
  const data = await wire(library(),version);
  const fetcher = vi.fn<typeof fetch>(async (_url,init) => init?.method === 'POST' ? new Response(null,{headers:{location:'https://www.googleapis.com/upload/drive/v3/files/synthetic'}}) : new Response(null));
  await createDriveClient(auth,binding,fetcher).upload(data,new AbortController().signal);
  const meta = JSON.parse(String(fetcher.mock.calls[0][1]?.body));
  expect(meta).toMatchObject({ name:'livro-a-livro-snapshot-v1.json',appProperties:{protocolVersion:String(version)} });
  expect(fetcher.mock.calls[1][1]?.body).toBe(JSON.stringify(await parseSnapshot(data)));
  expect(new TextEncoder().encode(String(fetcher.mock.calls[1][1]?.body))).toEqual(new TextEncoder().encode(JSON.stringify(data)));
});
