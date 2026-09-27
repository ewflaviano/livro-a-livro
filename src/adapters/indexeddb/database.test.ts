import 'fake-indexeddb/auto';
import { deleteDB, openDB } from 'idb';
import { afterEach, expect, it, vi } from 'vitest';
import { createBook } from '../../domain/book';
import type { LibraryRepository } from '../../ports/library-repository';
import { openLibraryRepository } from './library-repository';
import type { LibraryDatabase } from './schema';
import * as migrations from './migrations';

// A synthetic next bundle exercises real IndexedDB upgrades/blocked behavior.
// Production still has only structural V1, with no historical record migrations.
const structuralVersion = vi.hoisted(() => ({ value: 1 }));
vi.mock('./schema', async (importOriginal) => ({
  ...await importOriginal<typeof import('./schema')>(),
  get DATABASE_VERSION() { return structuralVersion.value; },
}));

const names: string[] = [];
const repositories: LibraryRepository[] = [];
const connections: { close(): void }[] = [];
const newName = () => { const name = `migration-${crypto.randomUUID()}`; names.push(name); return name; };
async function open(name: string, onDatabaseEvent?: (event: string) => void) {
  const repo = await openLibraryRepository({ name, channelFactory: null, onDatabaseEvent });
  repositories.push(repo);
  return repo;
}
async function raw(name: string, version?: number) {
  const db = await openDB<LibraryDatabase>(name, version);
  connections.push(db);
  return db;
}
async function seed(name: string) {
  const repo = await open(name);
  const book = createBook({ title: 'Registro sintético', note: 'Nota sintética' }, {
    id: crypto.randomUUID(), now: '2026-09-26T12:00:00Z', shelfYear: 2026,
  });
  await repo.commit({ kind: 'put', book }, await repo.readRevision());
  const snapshot = await repo.readAll();
  repo.close();
  return snapshot;
}

afterEach(async () => {
  structuralVersion.value = 1;
  vi.restoreAllMocks();
  for (const repo of repositories.splice(0)) repo.close();
  for (const connection of connections.splice(0)) connection.close();
  await Promise.all(names.splice(0).map((name) => deleteDB(name)));
});

it('closes old connections on versionchange and preserves records in a compatible upgrade', async () => {
  const name = newName();
  const before = await seed(name);
  const event = vi.fn();
  const old = await open(name, event);
  structuralVersion.value = 2;
  const upgraded = await open(name);
  expect(event).toHaveBeenCalledWith('versionchange');
  await expect(old.readAll()).rejects.toMatchObject({ code: 'StorageUnavailable' });
  expect(await upgraded.readAll()).toEqual(before);
});

it('reports blocked upgrades and aborts the pending request when the blocker eventually closes', async () => {
  const name = newName();
  const before = await seed(name);
  const blocker = await raw(name);
  const event = vi.fn();
  structuralVersion.value = 2;
  await expect(open(name, event)).rejects.toMatchObject({ code: 'StorageUnavailable' });
  expect(event).toHaveBeenCalledWith('blocked');
  blocker.close();
  // The failed attempt must not apply a late upgrade behind the caller's back.
  const unchanged = await raw(name, 1);
  expect(unchanged.version).toBe(1);
  expect(await unchanged.getAll('books')).toEqual(before.books);
});

it('aborts all upgrade mutations on failure and retains the previous schema/data', async () => {
  const name = newName();
  const before = await seed(name);
  structuralVersion.value = 2;
  vi.spyOn(migrations, 'migrateDatabase').mockImplementationOnce((db) => {
    db.deleteObjectStore('books');
    throw new Error('Synthetic private migration detail');
  });
  await expect(open(name)).rejects.toMatchObject({ code: 'StorageUnavailable', message: 'StorageUnavailable' });
  const unchanged = await raw(name, 1);
  expect(unchanged.version).toBe(1);
  expect(await unchanged.getAll('books')).toEqual(before.books);
  expect(await unchanged.get('meta', 'library')).toMatchObject(before.version);
});

it('rejects a database newer than the bundle without deleting, downgrading or resetting it', async () => {
  const name = newName();
  const before = await seed(name);
  const future = await raw(name, 2);
  future.close();
  await expect(open(name)).rejects.toMatchObject({ code: 'UnsupportedVersion' });
  const unchanged = await raw(name, 2);
  expect(await unchanged.getAll('books')).toEqual(before.books);
});

it('rejects unsupported record versions without rewriting data', async () => {
  const name = newName();
  const before = await seed(name);
  const db = await raw(name);
  const meta = (await db.get('meta', 'library'))!;
  await db.put('meta', { ...meta, recordVersion: 2 } as unknown as typeof meta, 'library');
  await expect(open(name)).rejects.toMatchObject({ code: 'UnsupportedVersion' });
  expect(await db.getAll('books')).toEqual(before.books);
  expect((await db.get('meta', 'library'))?.recordVersion).toBe(2);
});

it.each(['missing', 'invalid', 'mismatched'] as const)('refuses %s metadata without recreating it', async (kind) => {
  const name = newName();
  const before = await seed(name);
  const db = await raw(name);
  const meta = (await db.get('meta', 'library'))!;
  if (kind === 'missing') await db.delete('meta', 'library');
  else await db.put('meta', { ...meta, ...(kind === 'invalid' ? { revision: -1 } : { bookCount: 0 }) }, 'library');
  const corrupted = await db.get('meta', 'library');
  await expect(open(name)).rejects.toMatchObject({ code: 'InvalidLibrary' });
  expect(await db.get('meta', 'library')).toEqual(corrupted);
  expect(await db.getAll('books')).toEqual(before.books);
});
