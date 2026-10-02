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

const book = (title: string, authors: string[], year = 2026, status: Book['status'] = 'read') =>
  createBook({ title, authors, shelfYear: year, status }, { id: crypto.randomUUID(), shelfYear: year, now: '2026-09-26T12:00:00.000Z' });

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
});
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

async function setup(books: Book[], locale: Locale = 'pt-BR') {
  const repository = await openLibraryRepository({ name: crypto.randomUUID(), channelFactory: null });
  await repository.commit({ kind: 'replace', books }, await repository.readRevision());
  await repository.updatePreferences({ shelfYear: 2026 });
  const service = createShelfService(repository);
  render(<LocalePreview locale={locale}><MemoryRouter initialEntries={['/estante']}>
    <AppRoutes openService={async () => service} />
  </MemoryRouter></LocalePreview>);
  await screen.findByRole('combobox', { name: locale === 'en' ? 'Shelf year' : 'Ano da estante' });
  return repository;
}

it('opens a local author index across years and restores the book link after returning', async () => {
  const books = [book('Livro A', ['Ana', 'Bia'], 2025), book('Livro B', ['ana'], 2026, 'reading'), book('Sem autor', [])];
  const repository = await setup(books);
  const before = await repository.readAll();
  const revision = await repository.readRevision();
  expect(screen.getByRole('link', { name: 'Explorar autores' }).getAttribute('href')).toBe('/autores');
  await userEvent.click(screen.getByRole('link', { name: 'Explorar autores' }));
  expect(screen.getByRole('heading', { name: 'Autores' })).toBeTruthy();
  expect(screen.getByText('2 nomes de autoria')).toBeTruthy();
  expect(screen.queryByText('Sem autor')).toBeNull();
  await userEvent.type(screen.getByRole('searchbox', { name: 'Buscar autor' }), 'ana');
  const index = within(screen.getByRole('list', { name: 'Índice de autores' }));
  await userEvent.click(index.getByRole('button', { name: /Ana/i }));
  const link = within(screen.getByRole('list', { name: /Livros de ana/i })).getByRole('link', { name: /Livro A/ });
  expect(link.textContent).toContain('2025 · Lido');
  vi.stubGlobal('scrollY', 350);
  await userEvent.click(link);
  expect(await screen.findByRole('link', { name: 'Voltar para autores' })).toBeTruthy();
  await userEvent.click(screen.getByRole('link', { name: 'Voltar para autores' }));
  const restored = await screen.findByRole('link', { name: /Livro A/ });
  await waitFor(() => expect(document.activeElement).toBe(restored));
  expect((screen.getByRole('searchbox', { name: 'Buscar autor' }) as HTMLInputElement).value).toBe('ana');
  expect(window.scrollTo).toHaveBeenCalledWith(0, 350);
  expect(await repository.readAll()).toEqual(before);
  expect(await repository.readRevision()).toEqual(revision);
});

it('filters author names offline and displays an accessible empty result in English', async () => {
  await setup([book('Sample book', ['José'])], 'en');
  await userEvent.click(screen.getByRole('link', { name: 'Explore authors' }));
  const search = screen.getByRole('searchbox', { name: 'Search authors' });
  await userEvent.type(search, 'jose');
  expect(screen.getByText('1 author name')).toBeTruthy();
  await userEvent.clear(search);
  await userEvent.type(search, 'unknown');
  expect(screen.getByRole('heading', { name: 'No authors found.' })).toBeTruthy();
  expect(screen.getByText('0 author names')).toBeTruthy();
});

it('paginates both author groups and the books inside a group', async () => {
  const books = [
    ...Array.from({ length: 25 }, (_, i) => book(`Main book ${String(i).padStart(2, '0')}`, ['Autora 00'])),
    ...Array.from({ length: 24 }, (_, i) => book(`Other book ${i}`, [`Autora ${String(i + 1).padStart(2, '0')}`])),
  ];
  await setup(books);
  await userEvent.click(screen.getByRole('link', { name: 'Explorar autores' }));
  const authorList = () => within(screen.getByRole('list', { name: 'Índice de autores' }));
  expect(authorList().getAllByRole('listitem', { name: '' })).toHaveLength(24);
  await userEvent.click(authorList().getByRole('button', { name: /Autora 00/ }));
  const bookList = () => within(screen.getByRole('list', { name: 'Livros de Autora 00' }));
  expect(bookList().getAllByRole('link')).toHaveLength(24);
  await userEvent.click(within(screen.getByRole('navigation', { name: 'Páginas de livros deste autor' })).getByRole('button', { name: 'Próxima' }));
  expect(bookList().getAllByRole('link')).toHaveLength(1);
  await userEvent.click(within(screen.getByRole('navigation', { name: 'Páginas de autores' })).getByRole('button', { name: 'Próxima' }));
  expect(authorList().getAllByRole('button')).toHaveLength(1);
  expect(screen.getByText('Página 2 de 2')).toBeTruthy();
  await userEvent.click(authorList().getByRole('button', { name: /Autora 24/ }));
  await userEvent.click(within(screen.getByRole('list', { name: 'Livros de Autora 24' })).getByRole('link'));
  await userEvent.click(await screen.findByRole('link', { name: 'Voltar para autores' }));
  expect(await screen.findByRole('list', { name: 'Livros de Autora 24' })).toBeTruthy();
  expect(screen.getByText('Página 2 de 2')).toBeTruthy();
});

it('explains an empty index when books have no author names', async () => {
  await setup([book('Sample book', [])]);
  await userEvent.click(screen.getByRole('link', { name: 'Explorar autores' }));
  expect(screen.getByRole('heading', { name: 'Nenhuma autoria informada ainda.' })).toBeTruthy();
  expect(screen.getByRole('link', { name: 'Voltar para a estante' })).toBeTruthy();
});
