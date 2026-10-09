// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { createBook, type Book } from '../../domain/book';
import { openLibraryRepository } from '../../adapters/indexeddb/library-repository';
import { createShelfService } from '../../services/shelf-service';
import { AppRoutes } from '../../app/router';
import { LocalePreview } from '../../i18n/context';
import type { Locale } from '../../i18n/locale';

const book = (title: string, note: string, year = 2026) =>
  createBook({ title, note, shelfYear: year, status: 'read', authors: ['Lia'] },
    { id: crypto.randomUUID(), shelfYear: year, now: '2026-09-26T12:00:00.000Z' });

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
});
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

async function setup(books: Book[], locale: Locale = 'pt-BR') {
  const repository = await openLibraryRepository({ name: crypto.randomUUID(), channelFactory: null });
  await repository.commit({ kind: 'replace', books }, await repository.readRevision());
  const service = createShelfService(repository);
  render(<LocalePreview locale={locale}><MemoryRouter initialEntries={['/notas']}>
    <AppRoutes openService={async () => service} />
  </MemoryRouter></LocalePreview>);
  await screen.findByRole('heading', { name: locale === 'en' ? 'Notes notebook' : 'Caderno de observações' });
  return repository;
}

it('searches private notes offline, renders literal text and restores focus after opening a book', async () => {
  const books = [book('Jardim de Papel', 'Lembrar da conversa <b>literal</b>', 2026), book('Maré', 'Outra ideia', 2024), book('Sem nota', '  ')];
  const repository = await setup(books);
  const before = await repository.readAll();
  expect(await screen.findByText('2 livros com observações')).toBeTruthy();
  expect(screen.queryByText('Sem nota')).toBeNull();
  const search = screen.getByRole('searchbox', { name: 'Buscar nas observações' });
  await userEvent.type(search, 'conversa');
  expect(screen.getByText('1 livro com observações')).toBeTruthy();
  expect(screen.getByText('Lembrar da conversa <b>literal</b>').innerHTML).not.toContain('<b>');
  const list = within(screen.getByRole('list', { name: 'Livros com observações' }));
  const link = list.getByRole('link', { name: 'Abrir Jardim de Papel e sua observação na estante de 2026' });
  vi.stubGlobal('scrollY', 350);
  await userEvent.click(link);
  expect(await screen.findByRole('link', { name: 'Voltar para notas' })).toBeTruthy();
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Observações' })));
  await userEvent.click(screen.getByRole('link', { name: 'Voltar para notas' }));
  const restored = await screen.findByRole('link', { name: 'Abrir Jardim de Papel e sua observação na estante de 2026' });
  await waitFor(() => expect(document.activeElement).toBe(restored));
  expect((screen.getByRole('searchbox', { name: 'Buscar nas observações' }) as HTMLInputElement).value).toBe('conversa');
  expect(window.scrollTo).toHaveBeenCalledWith(0, 350);
  expect(await repository.readAll()).toEqual(before);
});

it('shows empty and no-match states in English', async () => {
  await setup([book('Sample', 'A small note')], 'en');
  expect(await screen.findByText('1 book with notes')).toBeTruthy();
  await userEvent.type(screen.getByRole('searchbox', { name: 'Search notes' }), 'missing');
  expect(screen.getByRole('heading', { name: 'No notes found.' })).toBeTruthy();
  await userEvent.click(screen.getByRole('button', { name: 'Clear search' }));
  expect((screen.getByRole('searchbox', { name: 'Search notes' }) as HTMLInputElement).value).toBe('');
});

it.each([
  ['pt-BR', 'Voltar para a estante', 'Ano da estante'],
  ['en', 'Back to shelf', 'Shelf year'],
] as const)('returns from notes to the local shelf in %s', async (locale, backLabel, yearLabel) => {
  const repository = await setup([book('Livro de teste', 'Observação fictícia')], locale);
  const before = await repository.readAll();
  const link = screen.getByRole('link', { name: backLabel });
  expect(link.getAttribute('href')).toBe('/estante');
  await userEvent.click(link);
  expect(await screen.findByRole('combobox', { name: yearLabel })).toBeTruthy();
  expect(await repository.readAll()).toEqual(before);
});

it('shows the matching passage from a long note as literal text', async () => {
  const repository = await setup([book('Exemplo', `${'início '.repeat(40)}Coração revisitado <b>literal</b>`)]);
  await screen.findByText('1 livro com observações');
  await userEvent.type(screen.getByRole('searchbox', { name: 'Buscar nas observações' }), 'coracao revisitado');
  const excerpt = document.querySelector('.note-book-excerpt');
  expect(excerpt?.classList.contains('note-book-excerpt-search')).toBe(true);
  expect(excerpt?.textContent?.startsWith('…')).toBe(true);
  expect(excerpt?.textContent).toContain('Coração revisitado <b>literal</b>');
  expect(excerpt?.innerHTML).not.toContain('<b>');
  expect((await repository.readAll()).books).toHaveLength(1);
});

it('paginates note entries and resets to first page for a new search', async () => {
  await setup(Array.from({ length: 25 }, (_, index) => book(`Livro ${String(index).padStart(2, '0')}`, `Nota ${index}`)));
  expect(await screen.findByText('25 livros com observações')).toBeTruthy();
  const list = () => within(screen.getByRole('list', { name: 'Livros com observações' }));
  expect(list().getAllByRole('listitem')).toHaveLength(24);
  await userEvent.click(within(screen.getByRole('navigation', { name: 'Páginas de observações' })).getByRole('button', { name: 'Próxima' }));
  expect(list().getAllByRole('listitem')).toHaveLength(1);
  await userEvent.type(screen.getByRole('searchbox', { name: 'Buscar nas observações' }), 'Livro 00');
  expect(list().getAllByRole('listitem')).toHaveLength(1);
  expect(screen.queryByRole('navigation', { name: 'Páginas de observações' })).toBeNull();
});

it('explains how to start when no book has a note', async () => {
  await setup([book('Sem nota', '  ')]);
  expect(await screen.findByRole('heading', { name: 'Nenhuma observação salva ainda.' })).toBeTruthy();
  expect(screen.getAllByRole('link', { name: 'Voltar para a estante' })).toHaveLength(1);
});

it('refreshes the note list after a committed library replacement', async () => {
  const repository = await setup([book('Primeiro', 'Anotação inicial')]);
  expect(await screen.findByText('1 livro com observações')).toBeTruthy();
  await repository.commit({ kind: 'replace', books: [book('Segundo', 'Nova anotação', 2024)] }, await repository.readRevision());
  expect(await screen.findByRole('heading', { name: 'Segundo' })).toBeTruthy();
  expect(screen.queryByRole('heading', { name: 'Primeiro' })).toBeNull();
  await repository.commit({ kind: 'replace', books: [] }, await repository.readRevision());
  expect(await screen.findByRole('heading', { name: 'Comece sua estante' })).toBeTruthy();
});

it('offers Add book for an empty library', async () => {
  await setup([]);
  expect(await screen.findByRole('heading', { name: 'Comece sua estante' })).toBeTruthy();
  expect(screen.getByRole('link', { name: 'Adicionar livro' }).getAttribute('href')).toBe('/adicionar');
});

it('distinguishes repeated book titles by shelf year in accessible link names', async () => {
  await setup([book('Mesmo título', 'Nota A', 2024), book('Mesmo título', 'Nota B', 2026)]);
  expect(await screen.findByRole('link', { name: 'Abrir Mesmo título e sua observação na estante de 2024' })).toBeTruthy();
  expect(screen.getByRole('link', { name: 'Abrir Mesmo título e sua observação na estante de 2026' })).toBeTruthy();
});
