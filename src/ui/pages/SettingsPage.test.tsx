// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AppRoutes } from '../../app/router';
import { createShelfService } from '../../services/shelf-service';
import { openLibraryRepository } from '../../adapters/indexeddb/library-repository';
import { createBook } from '../../domain/book';
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
async function setup() {
  const name = crypto.randomUUID();
  const repository = await openLibraryRepository({ name, channelFactory: null });
  await repository.commit({ kind: 'put', book: createBook({ title: 'Ano anterior' }, { id: crypto.randomUUID(), now: '2026-09-27T12:00:00Z', shelfYear: 2025 }) }, await repository.readRevision());
  const service = createShelfService(repository);
  render(<MemoryRouter initialEntries={['/configuracoes']}><AppRoutes openService={async () => service} /></MemoryRouter>);
  await screen.findByRole('combobox', { name: 'Ano da estante' }); return { name, repository };
}
it('persists preferences across reopening and advances revision without changing books', async () => {
  const { name, repository } = await setup(); const revision = await repository.readRevision(); const books = (await repository.readAll()).books;
  await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Ano da estante' }), '2025');
  await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Visualização inicial' }), 'list');
  await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Filtro inicial' }), 'read');
  await waitFor(async () => expect(await repository.readPreferences()).toMatchObject({ shelfYear: 2025, mode: 'list', filter: 'read' }));
  expect(await repository.readRevision()).toEqual({ ...revision, revision: revision.revision + 3 });
  expect((await repository.readAll()).books).toEqual(books);
  expect(screen.getByText(/Versão .*build/)).toBeTruthy();
  expect(screen.getByRole('link', { name: 'Como instalar' }).getAttribute('href')).toBe('/instalar');
  cleanup();
  const reopened = await openLibraryRepository({ name, channelFactory: null });
  expect(await reopened.readPreferences()).toMatchObject({ shelfYear: 2025, mode: 'list', filter: 'read' }); reopened.close();
});
it('reports failed persistence, keeps session choice and allows retry', async () => {
  const { repository } = await setup();
  vi.spyOn(repository, 'updatePreferences').mockRejectedValueOnce(new Error('unavailable'));
  await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Visualização inicial' }), 'list');
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect((screen.getByRole('combobox', { name: 'Visualização inicial' }) as HTMLSelectElement).value).toBe('list');
  expect((await repository.readPreferences()).mode).toBe('grid');
  await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Filtro inicial' }), 'reading');
  await waitFor(async () => expect((await repository.readPreferences()).filter).toBe('reading'));
  expect(screen.getByRole('alert')).toBeTruthy();
  expect((await repository.readPreferences()).mode).toBe('grid');
  expect((screen.getByRole('combobox', { name: 'Visualização inicial' }) as HTMLSelectElement).value).toBe('list');
  await userEvent.click(screen.getByRole('button', { name: 'Tentar salvar preferências' }));
  await waitFor(async () => expect((await repository.readPreferences()).mode).toBe('list'));
  expect(screen.queryByRole('alert')).toBeNull();
});
