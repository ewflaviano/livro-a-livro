// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { createBook, type Book } from '../../domain/book';
import { openLibraryRepository } from '../../adapters/indexeddb/library-repository';
import { createShelfService } from '../../services/shelf-service';
import { AppRoutes } from '../../app/router';
import { LocalePreview } from '../../i18n/context';
import type { Locale } from '../../i18n/locale';

const book = (title: string, year = 2026, patch: Partial<Book> = {}) =>
  createBook({ title, shelfYear: year, status: 'read', authors: ['Autora'], pageCount: 100,
    isbn: '9780306406157', ...patch },
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
  render(<LocalePreview locale={locale}><MemoryRouter initialEntries={['/dados']}>
    <AppRoutes openService={async () => service} />
  </MemoryRouter></LocalePreview>);
  await userEvent.click(await screen.findByRole('link', { name: locale === 'en' ? 'Review book details' : 'Revisar fichas' }));
  await screen.findByRole('heading', { name: locale === 'en' ? 'Review book details' : 'Revisar fichas', level: 1 });
  return repository;
}

it('filters optional details across years without writing or fetching', async () => {
  const first = book('Zeta', 2026, { authors: [], pageCount: null });
  const second = book('Árvore', 2026, { authors: [], isbn: null });
  const third = book('Antigo', 2024, { pageCount: null, isbn: null });
  const repository = await setup([first, second, third]);
  const before = await repository.readBackupSnapshot();
  const revision = await repository.readRevision();
  const links = () => within(screen.getByRole('list', { name: 'Fichas para revisar' })).getAllByRole('link');
  expect(links().map(link => link.getAttribute('aria-label'))).toEqual([
    'Abrir ficha de Árvore na estante de 2026', 'Abrir ficha de Zeta na estante de 2026',
  ]);
  expect(screen.getByText('2 livros em todos os anos · Sem autoria')).toBeTruthy();
  await userEvent.click(screen.getByRole('button', { name: 'Páginas' }));
  expect(links().map(link => link.getAttribute('aria-label'))).toEqual([
    'Abrir ficha de Zeta na estante de 2026', 'Abrir ficha de Antigo na estante de 2024',
  ]);
  await userEvent.click(screen.getByRole('button', { name: 'ISBN' }));
  expect(links().map(link => link.getAttribute('aria-label'))).toEqual([
    'Abrir ficha de Árvore na estante de 2026', 'Abrir ficha de Antigo na estante de 2024',
  ]);
  expect(screen.getByRole('button', { name: 'ISBN' }).getAttribute('aria-pressed')).toBe('true');
  expect(await repository.readBackupSnapshot()).toEqual(before);
  expect(await repository.readRevision()).toEqual(revision);
});

it('preserves the filter and focuses a valid destination after editing a book out of the list', async () => {
  const original = book('Uma cidade', 2025, { authors: [] });
  const repository = await setup([original]);
  await userEvent.click(screen.getByRole('link', { name: 'Abrir ficha de Uma cidade na estante de 2025' }));
  await userEvent.click(await screen.findByRole('button', { name: 'Editar livro' }));
  await userEvent.type(screen.getByRole('textbox', { name: 'Autores (opcional, um por linha)' }), 'Autora fictícia');
  await userEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }));
  await screen.findByText('Livro salvo neste dispositivo.');
  await userEvent.click(screen.getByRole('link', { name: 'Voltar para Revisar fichas' }));
  expect(await screen.findByRole('heading', { name: 'Nenhum livro neste recorte.' })).toBeTruthy();
  expect(screen.getByText('A ficha mudou; a lista foi atualizada.')).toBeTruthy();
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Revisar fichas', level: 1 })));
  expect(screen.getByRole('button', { name: 'Autoria' }).getAttribute('aria-pressed')).toBe('true');
  expect((await repository.readAll()).books[0].authors).toEqual(['Autora fictícia']);
});

it('paginates large lists and restores the selected record and scroll position', async () => {
  const books = Array.from({ length: 25 }, (_, index) => book(`Livro ${String(index + 1).padStart(2, '0')}`, 2026, { authors: [] }));
  await setup(books);
  expect(within(screen.getByRole('list', { name: 'Fichas para revisar' })).getAllByRole('link')).toHaveLength(24);
  await userEvent.click(within(screen.getByRole('navigation', { name: 'Páginas de fichas' })).getByRole('button', { name: 'Próxima' }));
  const last = screen.getByRole('link', { name: 'Abrir ficha de Livro 25 na estante de 2026' });
  expect(document.activeElement).toBe(last);
  vi.stubGlobal('scrollY', 320);
  await userEvent.click(last);
  await userEvent.click(await screen.findByRole('link', { name: 'Voltar para Revisar fichas' }));
  const restored = await screen.findByRole('link', { name: 'Abrir ficha de Livro 25 na estante de 2026' });
  await waitFor(() => expect(document.activeElement).toBe(restored));
  expect(screen.getByText('Página 2 de 2')).toBeTruthy();
  expect(window.scrollTo).toHaveBeenCalledWith(0, 320);
});

it('responds to local revisions and distinguishes an empty library in English', async () => {
  const original = book('Sample', 2026, { authors: [] });
  const repository = await setup([original], 'en');
  expect(screen.getByRole('list', { name: 'Book details to review' })).toBeTruthy();
  await act(async () => { await repository.commit({ kind: 'put', book: { ...original, authors: ['Author'] } }, await repository.readRevision()); });
  expect(await screen.findByRole('heading', { name: 'No books in this view.' })).toBeTruthy();
  await act(async () => { await repository.commit({ kind: 'replace', books: [] }, await repository.readRevision()); });
  expect(await screen.findByRole('heading', { name: 'Start your shelf' })).toBeTruthy();
});
