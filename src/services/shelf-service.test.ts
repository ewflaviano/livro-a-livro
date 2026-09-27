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
  it('serializes rapid preference edits, merges only selected fields and advances content revision without changing books', async () => {
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
    expect(await repository.readRevision()).toEqual({ ...revision, revision: revision.revision + 4 });
    expect((await repository.readAll()).books).toEqual([]);
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

it('retains only failed fields across a later successful patch and a remote preference refresh', async () => {
  const { repository, service } = await setup();
  vi.spyOn(repository,'updatePreferences').mockRejectedValueOnce(new Error('synthetic failure'));
  service.updatePreferences({ mode:'list' }); await service.refresh();
  service.updatePreferences({ filter:'reading' }); await service.refresh();
  await repository.updatePreferences({ shelfYear:2025 }); await service.refresh();
  expect(service.getSnapshot()).toMatchObject({ status:'ready', preferenceError:true, preferences:{mode:'list',filter:'reading',shelfYear:2025} });
  expect(await repository.readPreferences()).toMatchObject({mode:'grid',filter:'reading',shelfYear:2025});
  service.updatePreferences({mode:'list'}); await service.refresh();
  expect(service.getSnapshot()).toMatchObject({status:'ready',preferenceError:false,preferences:{mode:'list',filter:'reading',shelfYear:2025}});
  expect(await repository.readPreferences()).toMatchObject({mode:'list',filter:'reading',shelfYear:2025});
});
it('an older successful write cannot clear the newer failed intention for the same field', async () => {
  const { repository,service }=await setup(); const original=repository.updatePreferences.bind(repository);
  let release!:()=>void; const blocked=new Promise<void>(resolve=>{release=resolve;});
  vi.spyOn(repository,'updatePreferences').mockImplementationOnce(async patch=>{await blocked;return original(patch);}).mockRejectedValueOnce(new Error('synthetic failure'));
  service.updatePreferences({mode:'list'}); await Promise.resolve(); service.updatePreferences({mode:'grid'}); release(); await service.refresh();
  expect((await repository.readPreferences()).mode).toBe('list'); expect(service.getSnapshot()).toMatchObject({status:'ready',preferenceError:true,preferences:{mode:'grid'}});
  service.updatePreferences({mode:'grid'}); await service.refresh(); expect((await repository.readPreferences()).mode).toBe('grid'); expect(service.getSnapshot()).toMatchObject({preferenceError:false});
});

it.each([false,true])('an explicit import supersedes older failed preferences and preserves a later intention: %s', async later => {
  const {repository,service}=await setup(); vi.spyOn(repository,'updatePreferences').mockRejectedValue(new Error('synthetic failure'));
  service.updatePreferences({mode:'list'}); await service.refresh();
  const text=JSON.stringify({format:'livro-a-livro',schemaVersion:1,exportedAt:'2026-09-26T12:00:00Z',books:[],coverMedia:[],preferences:{shelfYear:2025,mode:'grid',filter:'read'}});
  const preview=await service.backup.prepareImport({size:text.length,text:async()=>text});
  if(later){const commit=repository.commit.bind(repository);vi.spyOn(repository,'commit').mockImplementationOnce(async(...args)=>{const version=await commit(...args);service.updatePreferences({filter:'reading'});return version;});}
  await service.backup.confirmImport(preview);
  expect(await repository.readPreferences()).toMatchObject({shelfYear:2025,mode:'grid',filter:'read'});
  expect(service.getSnapshot()).toMatchObject({status:'ready',preferenceError:later,preferences:{shelfYear:2025,mode:'grid',filter:later?'reading':'read'}});
});

it('an older blocked read cannot erase a successful no-op preference intention', async () => {
  const {repository,service}=await setup(); const old=await repository.readBackupSnapshot();
  await repository.updatePreferences({mode:'list'}); await service.refresh();
  let release!:(value:typeof old)=>void; vi.spyOn(repository,'readBackupSnapshot').mockImplementationOnce(()=>new Promise(resolve=>{release=resolve;}));
  const reading=service.refresh(); await Promise.resolve();
  const write=vi.spyOn(repository,'updatePreferences');
  service.updatePreferences({mode:'list'}); await Promise.resolve();
  await write.mock.results[0].value; // Its service continuation clears the overlay before this read completes.
  release(old); await reading; expect(service.getSnapshot()).toMatchObject({status:'ready',preferenceError:false,preferences:{mode:'list'}});
});
