// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// jsdom's Blob lacks arrayBuffer and cannot be structured-cloned by fake IndexedDB.
// Use the actual Node Blob before schemas load; browser decode is exercised separately.
await vi.hoisted(async () => { const { Blob } = await import('node:buffer'); globalThis.Blob = Blob as unknown as typeof globalThis.Blob; });
import { openDB, deleteDB } from 'idb';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { openLibraryRepository } from '../../adapters/indexeddb/library-repository';
import type { LibraryDatabase } from '../../adapters/indexeddb/schema';
import { createShelfService } from '../../services/shelf-service';
import { AppRoutes } from '../../app/router';
import { downloadLibrary } from './DataPage';
import { getPwaState } from '../../pwa/register';
import fixture from '../../../test/fixtures/backups/v1.json';
import { encodedCover, syntheticCover, stubImageDecoder } from '../../../test/fixtures/covers/helpers';
import { createBook, parseBook } from '../../domain/book';
import { DomainError } from '../../domain/errors';
import { LIBRARY_LIMITS } from '../../domain/library';
import { LocalePreview } from '../../i18n/context';
import type { Locale } from '../../i18n/locale';

const original = parseBook(fixture.books[0]);
const covers = () => ({ ...fixture, books: [{ ...original, cover: { provider: 'local', mediaId: encodedCover().id } }], coverMedia: [encodedCover()] });
const file = (text = JSON.stringify(fixture)) => {
  const value = new File([text], 'synthetic.json', { type: 'application/json' });
  Object.defineProperty(value, 'text', { configurable: true, value: vi.fn(async () => text) });
  return value;
};
const downloaded: Blob[] = [];
const opened: { name: string; close(): void }[] = [];
beforeEach(() => {
  stubImageDecoder();
  vi.stubGlobal('fetch', vi.fn());
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL(blob: Blob) { downloaded.push(blob); return `blob:synthetic-${downloaded.length}`; }
    static revokeObjectURL = vi.fn();
  });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
});
afterEach(async () => {
  expect(fetch).not.toHaveBeenCalled(); cleanup();
  expect(getPwaState().blocked).toBe(false);
  vi.restoreAllMocks(); vi.unstubAllGlobals(); downloaded.length = 0;
  for (const item of opened.splice(0)) { item.close(); await deleteDB(item.name); }
});
async function setup(withBook = false, locale: Locale = 'pt-BR') {
  const name = crypto.randomUUID(); const repo = await openLibraryRepository({ name, channelFactory: null });
  const db = await openDB<LibraryDatabase>(name);
  if (withBook) await repo.commit({ kind: 'replace', books: [parseBook(covers().books[0])], coverMedia: [syntheticCover()], preferences: { shelfYear: fixture.preferences.shelfYear, filter: 'read' } }, await repo.readRevision());
  const service = createShelfService(repo);
  opened.push({ name, close: () => { service.close(); db.close(); } });
  const view = render(<LocalePreview locale={locale}><MemoryRouter initialEntries={['/dados']}><AppRoutes openService={async () => service} /></MemoryRouter></LocalePreview>);
  await vi.waitFor(() => expect((screen.getByRole('button', { name: locale === 'en' ? 'Make backup' : 'Fazer backup' }) as HTMLButtonElement).disabled).toBe(false));
  return { repo, db, service, view };
}
async function select(value = file()) {
  await userEvent.click(screen.getByRole('button', { name: 'Restaurar backup' }));
  await userEvent.upload(screen.getByLabelText('Importar JSON'), value);
  await screen.findByRole('heading', { name: 'Conferir restauração' });
}
async function openConfirmation(count = 1) {
  const trigger = screen.getByRole('button', { name: `Substituir por ${count} ${count === 1 ? 'livro' : 'livros'}` });
  await userEvent.click(trigger);
  return { trigger, dialog: screen.getByRole('alertdialog') };
}
async function confirm(count = 1) {
  const { dialog } = await openConfirmation(count);
  await userEvent.click(within(dialog).getByRole('button', { name: `Substituir por ${count} ${count === 1 ? 'livro' : 'livros'}` }));
}

describe('independent local backup interface', () => {
  it('previews English backup controls and a safe restoration summary offline', async () => {
    const target = await setup(false, 'en');
    expect(screen.getByRole('heading', { name: 'Local backup' })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Restore backup' }));
    await userEvent.upload(screen.getByLabelText('Import JSON'), file());
    expect(await screen.findByText('In the file: 1 book. Years: 2025.')).toBeTruthy();
    expect(screen.getByText('On this device: 0 books. Years: none.')).toBeTruthy();
    expect((await target.repo.readAll()).books).toHaveLength(0);
    expect(fetch).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Replace with 1 book' }));
    const dialog = screen.getByRole('alertdialog');
    expect(within(dialog).getByText(/current library \(0 books\) will be replaced/)).toBeTruthy();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Replace with 1 book' }));
    expect(await screen.findByText('1 book imported on this device.')).toBeTruthy();
    expect((await target.repo.readAll()).books).toEqual(fixture.books);
  });
  it('downloads a preserved V1 recovery as V2 without its old display mode', async () => {
    downloadLibrary(fixture as import('../../backup/schema').LibraryExportV1, 'recuperacao');
    const data = JSON.parse(await downloaded[0].text());
    expect(data).toMatchObject({ schemaVersion: 2, preferences: { shelfYear: fixture.preferences.shelfYear, filter: fixture.preferences.filter } });
    expect(data.preferences).not.toHaveProperty('mode');
  });
  it('shows backup actions first and reveals the file picker on request', async () => {
    await setup();
    expect(screen.queryByLabelText('Importar JSON')).toBeNull();
    expect(screen.getByText(/notas e capas privadas/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Restaurar backup' }));
    expect(document.activeElement).toBe(screen.getByLabelText('Importar JSON'));
    await userEvent.click(screen.getByRole('button', { name: 'Restaurar backup' }));
    expect(document.activeElement).toBe(screen.getByLabelText('Importar JSON'));
  });

  it('round-trips all fields and real cover bytes into a distinct profile, offline without Drive', async () => {
    const source = await setup(true);
    expect(screen.getAllByRole('heading', { level: 2 })[0].textContent).toBe('Backup local');
    expect(screen.queryByRole('heading', { name: 'Visitas ao site' })).toBeNull();
    expect(screen.getByText(/conector está em preparação/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Fazer backup' }));
    await screen.findByText(/Download iniciado; confira/);
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledOnce();
    expect((await source.repo.readPreferences()).lastExport?.version).toEqual(await source.repo.readRevision());
    const text = await downloaded[0].text();
    expect(JSON.parse(text).books).toEqual(covers().books);
    source.view.unmount();
    const target = await setup();
    await select(file(text));
    expect(screen.getByText('No arquivo: 1 livro. Anos: 2025.')).toBeTruthy();
    expect(screen.getByText('Neste dispositivo: 0 livros. Anos: nenhum.')).toBeTruthy();
    expect(await target.db.count('books')).toBe(0);
    expect(getPwaState().blocked).toBe(true);
    const { trigger, dialog } = await openConfirmation();
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Cancelar' }));
    await userEvent.keyboard('{Escape}'); expect(document.activeElement).toBe(trigger);
    await userEvent.click(screen.getByRole('button', { name: 'Exportar biblioteca atual' }));
    await screen.findByText(/Download iniciado; confira/);
    expect(JSON.parse(await downloaded[1].text()).books).toEqual([]);
    await confirm();
    await screen.findByText('1 livro importado neste dispositivo.');
    expect((await target.repo.readAll()).books).toEqual(covers().books);
    expect(await target.repo.readPreferences()).toMatchObject({ shelfYear: fixture.preferences.shelfYear, filter: fixture.preferences.filter, mode: 'grid' });
    expect(await (await target.repo.readCover(encodedCover().id))!.bytes.arrayBuffer()).toEqual(await syntheticCover().bytes.arrayBuffer());
    expect(target.service.getSnapshot()).toMatchObject({ status: 'ready', snapshot: { books: covers().books } });
    expect(document.activeElement).toBe(screen.getByLabelText('Importar JSON'));
    expect(getPwaState().blocked).toBe(false);
  });

  it.each([
    ['invalid JSON', '{', /não é um backup válido/],
    ['unsupported version', JSON.stringify({ ...fixture, schemaVersion: 999 }), /versão não compatível/],
    ['invalid cover', JSON.stringify({ ...covers(), coverMedia: [{ ...encodedCover(), bytes: btoa('false PNG') }] }), /capas inválidas/],
  ])('rejects %s before a preview or any changes', async (_, text, message) => {
    const { repo, db } = await setup(true); const before = await repo.readBackupSnapshot();
    await userEvent.click(screen.getByRole('button', { name: 'Restaurar backup' }));
    await userEvent.upload(screen.getByLabelText('Importar JSON'), file(text));
    expect((await screen.findByRole('alert')).textContent).toMatch(message);
    expect(screen.queryByRole('heading', { name: 'Conferir restauração' })).toBeNull();
    expect(await repo.readBackupSnapshot()).toEqual(before); expect(await db.count('coverMedia')).toBe(1);
  });

  it('checks the declared size before reading the file', async () => {
    await setup(); const value = file(); Object.defineProperty(value, 'size', { value: LIBRARY_LIMITS.jsonBytes + 1 });
    await userEvent.click(screen.getByRole('button', { name: 'Restaurar backup' }));
    await userEvent.upload(screen.getByLabelText('Importar JSON'), value);
    expect((await screen.findByRole('alert')).textContent).toContain('excede os limites');
    expect(value.text).not.toHaveBeenCalled();
  });

  it('cancels a valid preview, restores focus and preserves records and bytes', async () => {
    const { repo, db } = await setup(true); const before = await repo.readBackupSnapshot();
    await select(); await userEvent.click(screen.getByRole('button', { name: 'Cancelar importação' }));
    expect(await screen.findByText(/Importação cancelada/)).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByLabelText('Importar JSON'));
    expect(await repo.readBackupSnapshot()).toEqual(before); expect(await db.count('coverMedia')).toBe(1);
  });

  it('refuses a stale preview without losing concurrent edits or existing media', async () => {
    const { repo, db } = await setup(true); await select();
    await act(async () => { await repo.commit({ kind: 'put', book: { ...parseBook(covers().books[0]), note: 'Outra aba sintética' } }, await repo.readRevision()); });
    await confirm();
    expect((await screen.findByRole('alert')).textContent).toContain('mudou desde a prévia');
    expect((await repo.readAll()).books[0].note).toBe('Outra aba sintética'); expect(await db.count('coverMedia')).toBe(1);
    expect(screen.queryByText('1 livro importado neste dispositivo.')).toBeNull();
  });

  it('reports quota failure and preserves the entire current library', async () => {
    const { repo, db } = await setup(true); const before = await repo.readBackupSnapshot(); await select();
    vi.spyOn(repo, 'commit').mockRejectedValueOnce(new DomainError('QuotaExceeded'));
    await confirm(); expect((await screen.findByRole('alert')).textContent).toContain('sem espaço para restaurar');
    expect(await repo.readBackupSnapshot()).toEqual(before); expect(await db.count('coverMedia')).toBe(1);
  });

  it('keeps confirmation busy and announces success only after the transaction commits', async () => {
    const { repo, service } = await setup(); await select();
    const commit = repo.commit.bind(repo); let finish!: () => Promise<void>;
    vi.spyOn(repo, 'commit').mockImplementationOnce((change, version) => new Promise((resolve, reject) => { finish = async () => { try { resolve(await commit(change, version)); } catch (error) { reject(error); } }; }));
    await confirm();
    expect((within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Aguarde…' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByText('1 livro importado neste dispositivo.')).toBeNull();
    expect(getPwaState().blocked).toBe(true);
    await act(finish); await screen.findByText('1 livro importado neste dispositivo.');
    expect(service.getSnapshot()).toMatchObject({ status: 'ready', snapshot: { books: fixture.books } });
  });

  it('invalidates an older file selection and ignores unfinished validation after unmount', async () => {
    const { db, view } = await setup(); let release!: (text: string) => void;
    const first = file(); Object.defineProperty(first, 'text', { configurable: true, value: () => new Promise<string>(resolve => { release = resolve; }) });
    await userEvent.click(screen.getByRole('button', { name: 'Restaurar backup' }));
    await userEvent.upload(screen.getByLabelText('Importar JSON'), first);
    await screen.findByText(/Validando o arquivo/);
    await select(file(JSON.stringify({ ...fixture, books: [] })));
    await act(async () => { release(JSON.stringify(fixture)); });
    expect(screen.getByText('No arquivo: 0 livros. Anos: nenhum.')).toBeTruthy();
    const pending = file(); Object.defineProperty(pending, 'text', { configurable: true, value: () => new Promise<string>(resolve => { release = resolve; }) });
    await userEvent.upload(screen.getByLabelText('Importar JSON'), pending);
    view.unmount(); await act(async () => { release(JSON.stringify(fixture)); });
    expect(await db.count('books')).toBe(0); expect(await db.count('coverMedia')).toBe(0);
  });

  it('does not record a completed backup when browser download initiation fails', async () => {
    const { repo } = await setup(); vi.mocked(HTMLAnchorElement.prototype.click).mockImplementationOnce(() => { throw new Error('synthetic'); });
    await userEvent.click(screen.getByRole('button', { name: 'Fazer backup' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Não foi possível iniciar a exportação');
    expect((await repo.readPreferences()).lastExport).toBeNull();
  });
});

describe('local catalogue downloads', () => {
  it('downloads CSV and Markdown from two years offline without modifying the library', async () => {
    const { repo } = await setup(true);
    const second = createBook({ title: 'Farol de papel', authors: ['Autora Exemplo'], shelfYear: 2024, status: 'reading',
      note: 'NOTA SINTÉTICA PRIVADA', rating: 4 }, { id: crypto.randomUUID(), now: '2026-09-30T12:00:00.000Z', shelfYear: 2024 });
    await repo.commit({ kind: 'put', book: second }, await repo.readRevision());
    const before = await repo.readBackupSnapshot();
    const commit = vi.spyOn(repo, 'commit'); const preferences = vi.spyOn(repo, 'updatePreferences');
    await userEvent.click(screen.getByRole('button', { name: 'Baixar CSV' }));
    expect(await screen.findByText(/Download do catálogo iniciado/)).toBeTruthy();
    const csv = await downloaded[0].text();
    expect(csv).toContain('"Título","Autoria","Ano da estante","Estado","Páginas","ISBN"');
    expect(csv).toContain('"Farol de papel","Autora Exemplo","2024","Lendo"');
    await userEvent.click(screen.getByRole('button', { name: 'Baixar Markdown' }));
    await waitFor(() => expect(downloaded).toHaveLength(2));
    const markdown = await downloaded[1].text();
    expect(markdown).toContain('## Lidos');
    expect(markdown).toContain('## Lendo\n\n- Farol de papel — Autora Exemplo (Ano da estante: 2024)');
    expect(markdown).toContain('## Quero ler');
    expect(markdown).not.toContain('NOTA SINTÉTICA PRIVADA');
    expect(csv).not.toContain('NOTA SINTÉTICA PRIVADA');
    expect(commit).not.toHaveBeenCalled(); expect(preferences).not.toHaveBeenCalled();
    expect(await repo.readBackupSnapshot()).toEqual(before);
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledTimes(2);
  });

  it('localizes the export and explains that an empty file is not a backup', async () => {
    await setup(false, 'en');
    expect(screen.getByText(/CSV and Markdown cannot be restored here/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Download CSV' }));
    expect(await screen.findByText(/The library is empty/)).toBeTruthy();
    expect(await downloaded[0].text()).toContain('"Title","Authors","Shelf year","Status","Pages","ISBN"');
  });

  it('distinguishes a read failure from a download failure', async () => {
    const { repo } = await setup();
    vi.spyOn(repo, 'readAll').mockRejectedValueOnce(new Error('synthetic'));
    await userEvent.click(screen.getByRole('button', { name: 'Baixar CSV' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Não foi possível ler a biblioteca');
    expect(downloaded).toHaveLength(0);
    vi.mocked(HTMLAnchorElement.prototype.click).mockImplementationOnce(() => { throw new Error('synthetic'); });
    await userEvent.click(screen.getByRole('button', { name: 'Baixar Markdown' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Não foi possível iniciar o download');
    expect(screen.queryByText(/Download do catálogo iniciado/)).toBeNull();
  });
});
