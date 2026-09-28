import { syntheticCover } from '../../../test/fixtures/covers/helpers';
import 'fake-indexeddb/auto';
import { openDB, deleteDB } from 'idb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBook, updateBook } from '../../domain/book';
import { LIBRARY_LIMITS, utf8ByteLength } from '../../domain/library';
import type { LibraryRepository } from '../../ports/library-repository';
import { openLibraryRepository } from './library-repository';
import type { RepositoryOptions } from './library-repository';
import { DEFAULT_PREFERENCES } from './schema';
import type { LibraryDatabase } from './schema';

const names: string[] = [];
const repositories: LibraryRepository[] = [];
const newName = () => { const name = `synthetic-${crypto.randomUUID()}`; names.push(name); return name; };
const book = (id = 'ef9b4013-f78c-4918-9b92-a71d445b9b82', shelfYear = 2026) => createBook({
  title: 'Livro sintético', note: '  nota sintética\n<texto> 📚\r\n', authors: ['Autoria sintética'],
  status: 'read', pageCount: 123, publicationYear: 2025, rating: 4,
  startedOn: `${shelfYear}-01-01`, finishedOn: `${shelfYear}-02-03`,
  isbn: '9780306406157', cover: { provider: 'open_library', coverId: 123 },
  source: { provider: 'open_library', workId: 'OL123W', editionId: 'OL123M', retrievedAt: '2026-09-26T12:00:00Z' },
}, { id, now: '2026-09-26T12:00:00Z', shelfYear });

async function open(name = newName(), options: RepositoryOptions = {}) {
  const repo = await openLibraryRepository({ name, channelFactory: null, ...options });
  repositories.push(repo);
  return repo;
}

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  for (const repo of repositories.splice(0)) repo.close();
  await Promise.all(names.splice(0).map((name) => deleteDB(name)));
});

describe('IndexedDB library repository', () => {
  it.each(['QuotaExceededError', 'AbortError'] as const)('rolls back all five stores after partial replace writes: %s', async failure => {
    const name = newName(); const repo = await open(name); const db = await openDB<LibraryDatabase>(name);
    const media = syntheticCover(); const originalBook = { ...book(), cover: { provider: 'local' as const, mediaId: media.id } };
    await repo.commit({ kind: 'replace', books: [originalBook], coverMedia: [media], preferences: { shelfYear: 2025, filter: 'read' } }, await repo.readRevision());
    const before = await repo.readBackupSnapshot(); const preferences = await repo.readPreferences();
    const pending = await db.get('syncOutbox', 'pending'); const meta = await db.get('meta', 'library');
    const put = IDBObjectStore.prototype.put;
    const injection = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args) {
      const request = put.apply(this, args);
      // Outbox comes after books, media, preferences and metadata have all been written.
      if (this.name === 'syncOutbox') {
        if (failure === 'QuotaExceededError') throw new DOMException('synthetic', failure);
        request.addEventListener('success', () => this.transaction.abort());
      }
      return request;
    });
    await expect(repo.commit({ kind: 'replace', books: [], coverMedia: [], preferences: { shelfYear: 2026, filter: 'all' } }, before.version))
      .rejects.toMatchObject({ code: failure === 'QuotaExceededError' ? 'QuotaExceeded' : 'StorageUnavailable' });
    injection.mockRestore();
    expect(await repo.readBackupSnapshot()).toEqual(before); expect(await repo.readPreferences()).toEqual(preferences);
    expect(await db.get('meta', 'library')).toEqual(meta); expect(await db.get('syncOutbox', 'pending')).toEqual(pending);
    expect(await (await repo.readBackupSnapshot()).coverMedia[0].bytes.arrayBuffer()).toEqual(await media.bytes.arrayBuffer());
    db.close();
  });

  it('reads media, books, preferences and revision in one readonly transaction', async () => {
    const name = newName(); const a = await open(name); const b = await open(name);
    const media = syntheticCover(); const next = { ...book(), cover: { provider: 'local' as const, mediaId: media.id } };
    const old = await a.readBackupSnapshot();
    const writing = a.commit({ kind: 'replace', books: [next], coverMedia: [media], preferences: { shelfYear: 2025, filter: 'read' } }, old.version);
    const snapshot = await b.readBackupSnapshot(); const version = await writing;
    expect(snapshot).toMatchObject({ version, books: [next], preferences: { shelfYear: 2025, filter: 'read' } });
    expect(await snapshot.coverMedia[0].bytes.arrayBuffer()).toEqual(await media.bytes.arrayBuffer());
  });

  it('creates stores, indexes and metadata once and retains identity on reopen', async () => {
    const name = newName();
    const repo = await open(name);
    const snapshot = await repo.readAll();
    expect(snapshot.books).toEqual([]);
    expect(snapshot.version).toEqual({ generation: expect.any(String), revision: 0 });
    expect(await repo.readPreferences()).toEqual(DEFAULT_PREFERENCES);
    const db = await openDB<LibraryDatabase>(name);
    expect(db.version).toBe(2);
    expect([...db.objectStoreNames]).toEqual([
      'books', 'coverMedia', 'experimentState', 'meta', 'preferences', 'searchCache', 'syncOutbox', 'syncState',
    ]);
    expect([...db.transaction('books').store.indexNames]).toEqual(['byShelfYear', 'byYearStatus']);
    expect([...db.transaction('searchCache').store.indexNames]).toEqual(['byAccess']);
    expect(await db.get('meta', 'library')).toMatchObject({ bookCount: 0, serializedBytes: 2, recordVersion: 1 });
    db.close();
    repo.close();
    expect(await (await open(name)).readAll()).toEqual(snapshot);
  });

  it('round-trips all fields and updates byte/count metadata for put, edit and delete', async () => {
    const name = newName();
    const repo = await open(name);
    const first = book();
    let version = await repo.commit({ kind: 'put', book: first }, await repo.readRevision());
    const second = book(crypto.randomUUID(), 2025);
    version = await repo.commit({ kind: 'put', book: second }, version);
    expect(await repo.readYear(2026)).toEqual({ books: [first], version });
    expect(await repo.readBook(first.id.toUpperCase())).toEqual({ book: first, version });
    expect(await repo.readBook(crypto.randomUUID())).toEqual({ book: null, version });
    const updated = updateBook(first, { note: 'outra nota\n🧪', shelfYear: 2027, finishedOn: '2027-02-03' }, first.updatedAt);
    version = await repo.commit({ kind: 'put', book: updated }, version);
    expect((await repo.readYear(2026)).books).toEqual([]);
    expect((await repo.readYear(2027)).books).toEqual([updated]);
    const db = await openDB<LibraryDatabase>(name);
    expect(await db.getAllFromIndex('books', 'byYearStatus', [2027, 'read'])).toEqual([updated]);
    const saved = (await repo.readAll()).books;
    expect(await db.get('meta', 'library')).toMatchObject({ bookCount: 2,
      serializedBytes: utf8ByteLength(JSON.stringify(saved)), revision: 3 });
    version = await repo.commit({ kind: 'delete', id: second.id }, version);
    version = await repo.commit({ kind: 'delete', id: updated.id }, version);
    version = await repo.commit({ kind: 'delete', id: updated.id }, version);
    expect(await repo.readAll()).toEqual({ books: [], version });
    expect(await db.get('meta', 'library')).toMatchObject({ bookCount: 0, serializedBytes: 2, revision: 6 });
    db.close();
  });

  it('preserves imported UUID spelling without allowing case-variant duplicate records', async () => {
    const repo = await open();
    const first = book();
    let version = await repo.commit({ kind: 'replace', books: [{ ...first, id: first.id.toUpperCase() }] }, await repo.readRevision());
    expect((await repo.readBook(first.id)).book?.id).toBe(first.id.toUpperCase());
    version = await repo.commit({ kind: 'put', book: first }, version);
    expect((await repo.readAll()).books).toEqual([first]);
    await expect(repo.commit({ kind: 'replace', books: [first, { ...first, id: first.id.toUpperCase() }] }, version))
      .rejects.toMatchObject({ code: 'InvalidLibrary' });
    expect((await repo.readAll()).books).toEqual([first]);
  });

  it('allows exactly one concurrent writer, even for different books without broadcasting', async () => {
    const name = newName();
    const a = await open(name);
    const b = await open(name);
    const initial = await a.readRevision();
    const results = await Promise.allSettled([
      a.commit({ kind: 'put', book: book() }, initial),
      b.commit({ kind: 'put', book: book(crypto.randomUUID()) }, initial),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((result) => result.status === 'rejected')).toMatchObject({ reason: { code: 'StaleRevision' } });
    expect((await b.readAll()).books).toHaveLength(1);
    expect((await b.readRevision()).revision).toBe(1);
  });

  it('reads books and revision from the same snapshot while a write is queued', async () => {
    const name = newName();
    const a = await open(name);
    const b = await open(name);
    const initial = await a.readRevision();
    const writing = a.commit({ kind: 'put', book: book() }, initial);
    const reading = b.readYear(2026);
    const [version, snapshot] = await Promise.all([writing, reading]);
    expect(snapshot).toEqual({ books: [book()], version });
  });

  it('replaces atomically, rotates generation, rejects old drafts and preserves preferences/auxiliary stores', async () => {
    const name = newName();
    const repo = await open(name);
    const old = await repo.commit({ kind: 'put', book: book() }, await repo.readRevision());
    await repo.updatePreferences({ shelfYear: 2025, mode: 'list', lastExport: { startedAt: '2026-09-26T12:00:00Z', version: old } });
    const preferences = await repo.readPreferences();
    const db = await openDB<LibraryDatabase>(name);
    await db.put('searchCache', { synthetic: true }, 'synthetic');
    const version = await repo.commit({ kind: 'replace', books: [] }, await repo.readRevision());
    expect(version.generation).not.toBe(old.generation);
    expect(version.revision).toBe(old.revision + 2);
    await expect(repo.commit({ kind: 'put', book: book() }, old)).rejects.toMatchObject({ code: 'StaleRevision' });
    // Generation is checked independently, even if the revision number is current.
    await expect(repo.commit({ kind: 'delete', id: book().id }, { ...version, generation: old.generation }))
      .rejects.toMatchObject({ code: 'StaleRevision' });
    expect(await repo.readPreferences()).toEqual(preferences);
    expect(await db.get('searchCache', 'synthetic')).toEqual({ synthetic: true });
    expect((await repo.readAll()).books).toEqual([]);
    db.close();
  });

  it('does not reuse a generation after browser data removal', async () => {
    const name = newName();
    const old = await open(name);
    const draftVersion = await old.readRevision();
    old.close();
    await deleteDB(name);
    const fresh = await open(name);
    expect((await fresh.readRevision()).generation).not.toBe(draftVersion.generation);
    await expect(fresh.commit({ kind: 'put', book: book() }, draftVersion)).rejects.toMatchObject({ code: 'StaleRevision' });
  });

  it('merges concurrent portable preference patches and advances the shared revision', async () => {
    const name = newName();
    const a = await open(name);
    const b = await open(name);
    const version = await a.readRevision();
    await Promise.all([a.updatePreferences({ shelfYear: 2025 }), b.updatePreferences({ mode: 'list' })]);
    expect(await a.readPreferences()).toEqual({ ...DEFAULT_PREFERENCES, shelfYear: 2025, mode: 'list' });
    expect(await b.readRevision()).toEqual({ ...version, revision: version.revision + 1 });
    await expect(a.updatePreferences({ shelfYear: 0 })).rejects.toMatchObject({ code: 'InvalidLibrary' });
  });

  it('clones caller inputs before awaiting and rejects invalid records without writes', async () => {
    const repo = await open();
    const draft = book();
    const committing = repo.commit({ kind: 'put', book: draft }, await repo.readRevision());
    draft.note = 'changed after call';
    await committing;
    expect((await repo.readBook(draft.id)).book?.note).toBe(book().note);
    const before = await repo.readAll();
    await expect(repo.commit({ kind: 'put', book: { ...draft, rating: 0 } as unknown as typeof draft }, before.version))
      .rejects.toMatchObject({ code: 'InvalidBook' });
    expect(await repo.readAll()).toEqual(before);
  });

  it.each(['put', 'replace'] as const)('rolls back %s and metadata if quota fails after book writes', async (kind) => {
    const repo = await open();
    await repo.commit({ kind: 'put', book: book() }, await repo.readRevision());
    const before = await repo.readAll();
    const original = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args) {
      if (this.name === 'meta') throw new DOMException('Synthetic private detail', 'QuotaExceededError');
      return original.apply(this, args);
    });
    const next = book(crypto.randomUUID());
    const change = kind === 'put' ? { kind, book: next } : { kind, books: [next] };
    await expect(repo.commit(change, before.version)).rejects.toMatchObject({ code: 'QuotaExceeded', message: 'QuotaExceeded' });
    expect(await repo.readAll()).toEqual(before);
  });

  it('waits for transaction completion and never reports success or broadcasts after an abort', async () => {
    const postMessage = vi.fn();
    const repo = await open(newName(), { channelFactory: () => ({ postMessage, close() {}, onmessage: null }) });
    const before = await repo.readAll();
    const listener = vi.fn();
    repo.subscribe(listener);
    const original = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args) {
      const request = original.apply(this, args);
      if (this.name === 'meta') request.addEventListener('success', () => this.transaction.abort());
      return request;
    });
    await expect(repo.commit({ kind: 'put', book: book() }, before.version)).rejects.toMatchObject({ code: 'StorageUnavailable' });
    expect(await repo.readAll()).toEqual(before);
    expect(postMessage).not.toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();
  });

  it.each(['books', 'bytes'])('checks the aggregate %s limit inside the committing transaction', async (limit) => {
    const name = newName();
    const repo = await open(name);
    const version = await repo.readRevision();
    const db = await openDB<LibraryDatabase>(name);
    const meta = (await db.get('meta', 'library'))!;
    // Inject boundary metadata to isolate the transactional guard without a 50 MiB fixture.
    await db.put('meta', { ...meta, ...(limit === 'books' ? { bookCount: LIBRARY_LIMITS.books }
      : { serializedBytes: LIBRARY_LIMITS.jsonBytes - LIBRARY_LIMITS.exportEnvelopeBytes }) }, 'library');
    await expect(repo.commit({ kind: 'put', book: book() }, version)).rejects.toMatchObject({ code: 'ImportTooLarge' });
    expect(await db.getAll('books')).toEqual([]);
    expect((await db.get('meta', 'library'))?.revision).toBe(0);
    db.close();
  });

  it('refuses a corrupt local record and never repairs or resets it automatically', async () => {
    const name = newName();
    const repo = await open(name);
    await repo.commit({ kind: 'put', book: book() }, await repo.readRevision());
    const db = await openDB<LibraryDatabase>(name);
    const corrupt = { ...book(), note: null } as unknown as ReturnType<typeof book>;
    await db.put('books', corrupt, book().id);
    await expect(repo.readAll()).rejects.toMatchObject({ code: 'InvalidLibrary' });
    await expect(open(name)).rejects.toMatchObject({ code: 'InvalidLibrary' });
    expect(await db.get('books', book().id)).toEqual(corrupt);
    db.close();
  });

  it('normalizes unavailable storage and closed-connection errors without raw details', async () => {
    const repo = await open();
    repo.close();
    await expect(repo.readAll()).rejects.toMatchObject({ code: 'StorageUnavailable' });
    vi.stubGlobal('indexedDB', undefined);
    await expect(open()).rejects.toMatchObject({ code: 'StorageUnavailable', message: 'StorageUnavailable' });
  });

  it('sends only an invalidation signal, rereads locally, and survives broken subscribers/channels', async () => {
    const channels: Pick<BroadcastChannel, 'onmessage' | 'postMessage' | 'close'>[] = [];
    const messages: unknown[] = [];
    const factory = () => {
      const channel: typeof channels[number] = {
        onmessage: null, close() {},
        postMessage(message) {
          messages.push(message);
          for (const other of channels) {
            if (other !== channel) other.onmessage?.call({} as BroadcastChannel, new MessageEvent('message', { data: message }));
          }
        },
      };
      channels.push(channel);
      return channel;
    };
    const name = newName();
    const a = await open(name, { channelFactory: factory });
    const b = await open(name, { channelFactory: factory });
    const external = vi.fn();
    b.subscribe(external);
    a.subscribe(() => { throw new Error('synthetic callback failure'); });
    const version = await a.commit({ kind: 'put', book: book() }, await a.readRevision());
    await vi.waitFor(() => expect(external).toHaveBeenCalledWith(version));
    expect(messages).toEqual([{ type: 'revision-changed' }]);
    channels[0].postMessage = () => { throw new Error('synthetic channel failure'); };
    await expect(a.commit({ kind: 'delete', id: book().id }, version)).resolves.toMatchObject({ revision: 2 });
  });

  it('detects external changes on focus without BroadcastChannel and cleans up on close', async () => {
    const name = newName();
    const focusTarget = new EventTarget();
    const a = await open(name);
    const b = await open(name, { focusTarget, channelFactory: () => { throw new Error('unsupported'); } });
    const listener = vi.fn();
    const unsubscribe = b.subscribe(listener);
    const version = await a.commit({ kind: 'put', book: book() }, await a.readRevision());
    focusTarget.dispatchEvent(new Event('focus'));
    await vi.waitFor(() => expect(listener).toHaveBeenCalledWith(version));
    await b.checkForChanges();
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    b.close();
    focusTarget.dispatchEvent(new Event('focus'));
    expect(listener).toHaveBeenCalledTimes(1);
  });
  it('shares a mode-only change between tabs without content revision, outbox or content listeners', async () => {
    const channels: Pick<BroadcastChannel, 'onmessage' | 'postMessage' | 'close'>[] = [];
    const messages: unknown[] = [];
    const factory = () => {
      const channel: typeof channels[number] = { onmessage: null, close() {}, postMessage(message) {
        messages.push(message);
        for (const other of channels) if (other !== channel) other.onmessage?.call({} as BroadcastChannel, new MessageEvent('message', { data: message }));
      } };
      channels.push(channel); return channel;
    };
    const name = newName(); const a = await open(name, { channelFactory: factory }); const b = await open(name, { channelFactory: factory });
    const content = vi.fn(); const local = vi.fn(); b.subscribe(content); b.subscribeLocalPreferences(local);
    const revision = await a.readRevision(); const db = await openDB<LibraryDatabase>(name);
    const pending = await db.get('syncOutbox', 'pending');
    await a.updatePreferences({ mode: 'list' });
    await vi.waitFor(() => expect(local).toHaveBeenCalledOnce());
    expect((await b.readPreferences()).mode).toBe('list'); expect(await b.readRevision()).toEqual(revision);
    expect(await db.get('syncOutbox', 'pending')).toEqual(pending); expect(content).not.toHaveBeenCalled();
    expect(messages).toEqual([{ type: 'local-preferences-changed' }]); db.close();
  });
  it('notices a mode-only change on focus when BroadcastChannel is unavailable', async () => {
    const name = newName(); const focusTarget = new EventTarget();
    const a = await open(name); const b = await open(name, { focusTarget, channelFactory: null });
    const content = vi.fn(); const local = vi.fn(); b.subscribe(content); b.subscribeLocalPreferences(local);
    await a.updatePreferences({ mode: 'list' }); focusTarget.dispatchEvent(new Event('focus'));
    await vi.waitFor(() => expect(local).toHaveBeenCalledOnce()); expect(content).not.toHaveBeenCalled();
  });
});

it('portable no-ops and lastExport stay outside content revision, but a mixed portable patch advances once', async () => {
  const repo = await open(); const original = await repo.readRevision();
  await repo.updatePreferences({ mode: 'grid', filter: 'all', shelfYear: null });
  await repo.updatePreferences({ lastExport: { startedAt: '2026-09-26T12:00:00Z', version: original } });
  expect(await repo.readRevision()).toEqual(original);
  const observed = vi.fn(); repo.subscribe(observed);
  await repo.updatePreferences({ mode: 'list', filter: 'reading', lastExport: null });
  expect(await repo.readRevision()).toEqual({ ...original, revision: original.revision+1 }); expect(observed).toHaveBeenCalledOnce();
});
