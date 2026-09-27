import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openLibraryRepository } from '../adapters/indexeddb/library-repository';
import { createBook } from '../domain/book';
import { createShelfService, type ShelfService } from './shelf-service';

const services: ShelfService[] = [];
afterEach(() => { services.splice(0).forEach((service) => service.close()); });
async function setup() {
  const repository = await openLibraryRepository({ name: crypto.randomUUID(), channelFactory: null });
  const service = createShelfService(repository);
  services.push(service);
  await service.refresh();
  return { repository, service };
}

describe('shelf service consistency', () => {
  it('serializes rapid preference edits, merges only selected fields and never increments book revision', async () => {
    const { repository, service } = await setup();
    const revision = await repository.readRevision();
    const lastExport = { startedAt: '2026-09-26T12:00:00.000Z', version: revision };
    await repository.updatePreferences({ lastExport });
    service.updatePreferences({ mode: 'list' });
    service.updatePreferences({ shelfYear: 2025 });
    service.updatePreferences({ mode: 'grid' });
    service.updatePreferences({ filter: 'read' });
    await service.refresh();
    expect(await repository.readPreferences()).toEqual({ lastExport, mode: 'grid', shelfYear: 2025, filter: 'read' });
    expect(await repository.readRevision()).toEqual(revision);
    expect(service.getSnapshot()).toMatchObject({ status: 'ready', preferenceError: false,
      preferences: { mode: 'grid', shelfYear: 2025, filter: 'read' } });
  });

  it('reports preference failures without turning a committed library into an empty shelf', async () => {
    const { repository, service } = await setup();
    vi.spyOn(repository, 'updatePreferences').mockRejectedValue(new Error('unavailable'));
    service.updatePreferences({ mode: 'list' });
    await service.refresh();
    expect(service.getSnapshot()).toMatchObject({ status: 'ready', preferenceError: true });
    expect((await repository.readAll()).books).toEqual([]);
  });

  it('does not apply an older read after a newer revision has been projected', async () => {
    const { repository, service } = await setup();
    const oldSnapshot = await repository.readBackupSnapshot();
    let release!: (snapshot: typeof oldSnapshot) => void;
    vi.spyOn(repository, 'readBackupSnapshot').mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const oldRead = service.refresh();
    await Promise.resolve();
    const book = createBook({ title: 'Novo registro' }, { id: crypto.randomUUID(), now: '2026-09-26T12:00:00.000Z', shelfYear: 2026 });
    await repository.commit({ kind: 'put', book }, oldSnapshot.version);
    await service.refresh();
    release(oldSnapshot);
    await oldRead;
    const current = service.getSnapshot();
    expect(current.status).toBe('ready');
    if (current.status === 'ready') expect(current.snapshot.books.map((item) => item.title)).toEqual(['Novo registro']);
  });

  it('keeps an edit made during a read and persists it without stale snapshot writes', async () => {
    const { repository, service } = await setup();
    const previous = await repository.readBackupSnapshot();
    let release!: (snapshot: typeof previous) => void;
    vi.spyOn(repository, 'readBackupSnapshot').mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const reading = service.refresh();
    await Promise.resolve();
    service.updatePreferences({ mode: 'list' });
    release(previous);
    await reading;
    expect(service.getSnapshot()).toMatchObject({ status: 'ready', preferences: { mode: 'list' } });
    await service.refresh();
    expect((await repository.readPreferences()).mode).toBe('list');
  });
});
