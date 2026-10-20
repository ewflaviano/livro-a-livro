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

async function setup(books: Book[], locale: Locale = 'pt-BR', name = crypto.randomUUID()) {
  const repository = await openLibraryRepository({ name, channelFactory: null });
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
  const authorDestination = within(screen.getByRole('navigation', { name: 'Navegação mobile' })).getByRole('link', { name: 'Autores' });
  expect(authorDestination.getAttribute('href')).toBe('/autores');
  expect(screen.queryByRole('link', { name: 'Explorar autores' })).toBeNull();
  await userEvent.click(authorDestination);
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

it('moves focus to a book in its new author group after an edit', async () => {
  await setup([book('Livro A', ['Ana']), book('Livro B', ['Bia'])]);
  await userEvent.click(within(screen.getByRole('navigation', { name: 'Navegação mobile' })).getByRole('link', { name: 'Autores' }));
  await userEvent.click(screen.getByRole('button', { name: /Ana/ }));
  await userEvent.click(screen.getByRole('link', { name: /Livro A/ }));
  await userEvent.click(await screen.findByRole('button', { name: 'Editar livro' }));
  const authors = screen.getByRole('textbox', { name: 'Autores (opcional, um por linha)' });
  await userEvent.clear(authors);
  await userEvent.type(authors, 'Bia');
  await userEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }));
  await screen.findByText('Livro salvo neste dispositivo.');
  await userEvent.click(screen.getByRole('link', { name: 'Voltar para autores' }));
  await waitFor(() => expect(screen.getByRole('button', { name: /Bia/ }).getAttribute('aria-expanded')).toBe('true'));
  const moved = await screen.findByRole('link', { name: /Livro A/ });
  await waitFor(() => expect(document.activeElement).toBe(moved));
  expect(screen.getByRole('button', { name: /Bia/ }).getAttribute('aria-expanded')).toBe('true');
});

it('announces a changed English index and focuses its heading when a filtered book leaves', async () => {
  await setup([book('Sample book', ['Ana'])], 'en');
  await userEvent.click(within(screen.getByRole('navigation', { name: 'Mobile navigation' })).getByRole('link', { name: 'Authors' }));
  await userEvent.type(screen.getByRole('searchbox', { name: 'Search authors' }), 'ana');
  await userEvent.click(screen.getByRole('button', { name: /Ana/ }));
  await userEvent.click(screen.getByRole('link', { name: /Sample book/ }));
  await userEvent.click(await screen.findByRole('button', { name: 'Edit book' }));
  const authors = screen.getByRole('textbox', { name: 'Authors (optional, one per line)' });
  await userEvent.clear(authors);
  await userEvent.type(authors, 'Bia');
  await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await screen.findByText('Book saved on this device.', {}, { timeout: 10000 });
  await userEvent.click(screen.getByRole('link', { name: 'Back to authors' }));
  expect(await screen.findByRole('heading', { name: 'No authors found.' })).toBeTruthy();
  await waitFor(() => expect(screen.getByRole('status').textContent).toContain('index has been updated'));
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Authors', level: 1 })));
  expect((screen.getByRole('searchbox', { name: 'Search authors' }) as HTMLInputElement).value).toBe('ana');
});

it('finds a book moved to another author page by a concurrent local change', async () => {
  const original = book('Livro fictício', ['Autora 00']);
  const others = Array.from({ length: 24 }, (_, i) => book(`Outro ${i}`, [`Autora ${String(i + 1).padStart(2, '0')}`]));
  const repository = await setup([original, ...others]);
  await userEvent.click(within(screen.getByRole('navigation', { name: 'Navegação mobile' })).getByRole('link', { name: 'Autores' }));
  await userEvent.click(screen.getByRole('button', { name: /Autora 00/ }));
  await userEvent.click(screen.getByRole('link', { name: /Livro fictício/ }));
  await screen.findByRole('link', { name: 'Voltar para autores' });
  await repository.commit({ kind: 'replace', books: [{ ...original, authors: ['Zeta'] }, ...others] }, await repository.readRevision());
  await userEvent.click(screen.getByRole('link', { name: 'Voltar para autores' }));
  await waitFor(() => expect(screen.getByRole('button', { name: /Zeta/ }).getAttribute('aria-expanded')).toBe('true'));
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('link', { name: /Livro fictício/ })));
  expect(screen.getByRole('button', { name: /Zeta/ }).getAttribute('aria-expanded')).toBe('true');
  expect(screen.getByText('Página 2 de 2')).toBeTruthy();
});

it('restores focus when the library advances again during the return read', async () => {
  const original = book('Livro fictício', ['Ana']);
  const repository = await setup([original]);
  await userEvent.click(within(screen.getByRole('navigation', { name: 'Navegação mobile' })).getByRole('link', { name: 'Autores' }));
  await userEvent.click(screen.getByRole('button', { name: /Ana/ }));
  await userEvent.click(screen.getByRole('link', { name: /Livro fictício/ }));
  await screen.findByRole('link', { name: 'Voltar para autores' });
  const readRevision = repository.readRevision.bind(repository);
  let advanced = false;
  vi.spyOn(repository, 'readRevision').mockImplementation(async () => {
    const version = await readRevision();
    if (!advanced) {
      advanced = true;
      await repository.commit({ kind: 'put', book: { ...original, authors: ['Bia'] } }, version);
    }
    return version;
  });
  await userEvent.click(screen.getByRole('link', { name: 'Voltar para autores' }));
  await waitFor(() => expect(screen.getByRole('button', { name: /Bia/ }).getAttribute('aria-expanded')).toBe('true'));
  const moved = screen.getByRole('link', { name: /Livro fictício/ });
  await waitFor(() => expect(document.activeElement).toBe(moved));
});

it('refreshes an unnoticed change from another connection before restoring focus', async () => {
  const name = crypto.randomUUID();
  const original = book('Livro fictício', ['Ana']);
  const repository = await setup([original], 'pt-BR', name);
  const other = await openLibraryRepository({ name, channelFactory: null });
  await userEvent.click(within(screen.getByRole('navigation', { name: 'Navegação mobile' })).getByRole('link', { name: 'Autores' }));
  await userEvent.click(screen.getByRole('button', { name: /Ana/ }));
  await userEvent.click(screen.getByRole('link', { name: /Livro fictício/ }));
  await screen.findByRole('link', { name: 'Voltar para autores' });
  const readRevision = repository.readRevision.bind(repository);
  let advanced = false;
  vi.spyOn(repository, 'readRevision').mockImplementation(async () => {
    if (!advanced) {
      advanced = true;
      await other.commit({ kind: 'put', book: { ...original, authors: ['Bia'] } }, await other.readRevision());
    }
    return readRevision();
  });
  await userEvent.click(screen.getByRole('link', { name: 'Voltar para autores' }));
  await waitFor(() => expect(screen.getByRole('button', { name: /Bia/ }).getAttribute('aria-expanded')).toBe('true'));
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('link', { name: /Livro fictício/ })));
  other.close();
});

it('focuses a stable destination if an unseen revision cannot be projected', async () => {
  const name = crypto.randomUUID();
  const original = book('Livro fictício', ['Ana']);
  const repository = await setup([original], 'pt-BR', name);
  const other = await openLibraryRepository({ name, channelFactory: null });
  await userEvent.click(within(screen.getByRole('navigation', { name: 'Navegação mobile' })).getByRole('link', { name: 'Autores' }));
  await userEvent.click(screen.getByRole('button', { name: /Ana/ }));
  await userEvent.click(screen.getByRole('link', { name: /Livro fictício/ }));
  await screen.findByRole('link', { name: 'Voltar para autores' });
  await other.commit({ kind: 'put', book: { ...original, authors: ['Bia'] } }, await other.readRevision());
  vi.spyOn(repository, 'checkForChanges').mockResolvedValue();
  await userEvent.click(screen.getByRole('link', { name: 'Voltar para autores' }));
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Autores', level: 1 })), { timeout: 3500 });
  expect(screen.getByRole('status').textContent).toContain('índice foi atualizado');
  expect(window.scrollTo).toHaveBeenCalledWith(0, 0);
  other.close();
});

it('filters author names offline and displays an accessible empty result in English', async () => {
  const repository = await setup([book('Sample book', ['José'])], 'en');
  const revision = await repository.readRevision();
  await userEvent.click(within(screen.getByRole('navigation', { name: 'Mobile navigation' })).getByRole('link', { name: 'Authors' }));
  const search = screen.getByRole('searchbox', { name: 'Search authors' });
  await userEvent.type(search, 'jose');
  expect(screen.getByText('1 author name')).toBeTruthy();
  await userEvent.clear(search);
  await userEvent.type(search, 'unknown');
  expect(screen.getByRole('heading', { name: 'No authors found.' })).toBeTruthy();
  expect(screen.getByText('0 author names')).toBeTruthy();
  await userEvent.click(screen.getByRole('button', { name: 'Clear search' }));
  expect(search).toBe(document.activeElement);
  expect((search as HTMLInputElement).value).toBe('');
  expect(screen.getByText('1 author name')).toBeTruthy();
  expect(await repository.readRevision()).toEqual(revision);
});

it.each([
  ['pt-BR', 'Navegação mobile', 'Autores', 'Buscar autor', '1 nome de autoria', '0 nomes de autoria', 'Limpar busca'],
  ['en', 'Mobile navigation', 'Authors', 'Search authors', '1 author name', '0 author names', 'Clear search'],
] as const)('announces author search results after a pause in %s without moving focus', async (locale, navigation, destination, searchLabel, one, zero, clearLabel) => {
  const repository = await setup([book('Livro fictício', ['Ana'])], locale);
  const revision = await repository.readRevision();
  await userEvent.click(within(screen.getByRole('navigation', { name: navigation })).getByRole('link', { name: destination }));
  const search = screen.getByRole('searchbox', { name: searchLabel });
  const announcement = document.querySelector<HTMLElement>('.authors-announcement');
  expect(announcement?.getAttribute('aria-live')).toBe('polite');
  expect(announcement?.textContent).toBe('');

  await userEvent.type(search, 'ana');
  expect(announcement?.textContent).toBe('');
  await waitFor(() => expect(announcement?.textContent).toBe(one));
  expect(document.activeElement).toBe(search);

  await userEvent.click(screen.getByRole('button', { name: clearLabel }));
  expect(announcement?.textContent).toBe('');
  await waitFor(() => expect(announcement?.textContent).toBe(one));
  expect(document.activeElement).toBe(search);

  await userEvent.type(search, 'missing');
  await waitFor(() => expect(announcement?.textContent).toBe(zero));
  expect(document.activeElement).toBe(search);

  await userEvent.click(screen.getByRole('button', { name: clearLabel }));
  await waitFor(() => expect(announcement?.textContent).toBe(one));
  expect(document.activeElement).toBe(search);
  expect(await repository.readRevision()).toEqual(revision);
});

it('clears an empty author search with the keyboard in Portuguese', async () => {
  await setup([book('Livro fictício', ['Ana'])]);
  await userEvent.click(within(screen.getByRole('navigation', { name: 'Navegação mobile' })).getByRole('link', { name: 'Autores' }));
  const search = screen.getByRole('searchbox', { name: 'Buscar autor' });
  await userEvent.type(search, 'nome inexistente');
  expect(screen.getByRole('heading', { name: 'Nenhum autor encontrado.' })).toBeTruthy();
  await userEvent.tab();
  const clear = screen.getByRole('button', { name: 'Limpar busca' });
  expect(clear).toBe(document.activeElement);
  await userEvent.keyboard('{Enter}');
  expect(search).toBe(document.activeElement);
  expect(screen.getByText('1 nome de autoria')).toBeTruthy();
});

it.each([
  ['pt-BR', 'Buscar autor', 'Limpar busca', 'Índice de autores'],
  ['en', 'Search authors', 'Clear search', 'Author index'],
] as const)('clears a matching author search and restores the full index in %s', async (locale, searchLabel, clearLabel, listLabel) => {
  const repository = await setup([book('Livro A', ['Ana']), book('Livro B', ['Bia'])], locale);
  const revision = await repository.readRevision();
  await userEvent.click(within(screen.getByRole('navigation', { name: locale === 'en' ? 'Mobile navigation' : 'Navegação mobile' })).getByRole('link', { name: locale === 'en' ? 'Authors' : 'Autores' }));
  const search = screen.getByRole('searchbox', { name: searchLabel });
  expect(screen.queryByRole('button', { name: clearLabel })).toBeNull();
  await userEvent.type(search, 'Ana');
  const index = within(screen.getByRole('list', { name: listLabel }));
  expect(index.getAllByRole('listitem')).toHaveLength(1);
  await userEvent.click(index.getByRole('button'));
  expect(index.getByRole('button').getAttribute('aria-expanded')).toBe('true');
  await userEvent.click(screen.getByRole('button', { name: clearLabel }));
  expect((search as HTMLInputElement).value).toBe('');
  expect(document.activeElement).toBe(search);
  expect(index.getAllByRole('listitem')).toHaveLength(2);
  expect(index.getAllByRole('button').every(button => button.getAttribute('aria-expanded') === 'false')).toBe(true);
  expect(screen.queryByRole('button', { name: clearLabel })).toBeNull();
  expect(await repository.readRevision()).toEqual(revision);
});

it('paginates both author groups and the books inside a group', async () => {
  const books = [
    ...Array.from({ length: 25 }, (_, i) => book(`Main book ${String(i).padStart(2, '0')}`, ['Autora 00'])),
    ...Array.from({ length: 24 }, (_, i) => book(`Other book ${i}`, [`Autora ${String(i + 1).padStart(2, '0')}`])),
  ];
  await setup(books);
  await userEvent.click(within(screen.getByRole('navigation', { name: 'Navegação mobile' })).getByRole('link', { name: 'Autores' }));
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
  await userEvent.click(within(screen.getByRole('navigation', { name: 'Navegação mobile' })).getByRole('link', { name: 'Autores' }));
  expect(screen.getByRole('heading', { name: 'Nenhuma autoria informada ainda.' })).toBeTruthy();
  expect(screen.getByRole('link', { name: 'Voltar para a estante' })).toBeTruthy();
});
