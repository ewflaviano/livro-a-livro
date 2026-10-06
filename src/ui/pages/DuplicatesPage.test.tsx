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

const book = (title: string, year = 2026, patch: Partial<Book> = {}) =>
  createBook({ title, shelfYear: year, status: 'read', authors: ['Lia'], ...patch },
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
  await screen.findByRole('heading', { name: locale === 'en' ? 'Your data' : 'Seus dados', level: 1 });
  await userEvent.click(screen.getByRole('link', { name: locale === 'en' ? 'Review possible duplicates' : 'Conferir possíveis duplicatas' }));
  return repository;
}

it('reviews same-year records offline without writing and returns focus to the selected record', async () => {
  const first = book('  Ｊardim de Vidro ', 2026, { isbn: '9780306406157' });
  const second = book('jardim de vidro', 2026, { isbn: '9780306406157' });
  const otherYear = book('Jardim de Vidro', 2025);
  const repository = await setup([first, second, otherYear]);
  const before = await repository.readAll();
  const revision = await repository.readRevision();
  expect(within(screen.getByRole('navigation', { name: 'Navegação mobile' })).getByRole('link', { name: 'Mais' }).getAttribute('aria-current')).toBe('page');
  expect(await screen.findByText('1 grupo para conferir')).toBeTruthy();
  expect(screen.getByText('Mesmo título e autoria · Mesmo ISBN')).toBeTruthy();
  expect(within(screen.getByRole('list', { name: 'Grupos de possíveis duplicatas' })).getAllByRole('link')).toHaveLength(2);
  const link = screen.getByRole('link', { name: /Abrir registro 1:.*estante de 2026/ });
  vi.stubGlobal('scrollY', 280);
  await userEvent.click(link);
  await userEvent.click(await screen.findByRole('link', { name: 'Voltar para possíveis duplicatas' }));
  const restored = await screen.findByRole('link', { name: /Abrir registro 1:.*estante de 2026/ });
  await waitFor(() => expect(document.activeElement).toBe(restored));
  expect(window.scrollTo).toHaveBeenCalledWith(0, 280);
  expect(await repository.readAll()).toEqual(before);
  expect(await repository.readRevision()).toEqual(revision);
});

it('paginates groups and books within a large group without rendering every record', async () => {
  const many = Array.from({ length: 11 }, () => book('Mesmo livro'));
  const pairs = Array.from({ length: 12 }, (_, index) => [book(`Par ${index}`), book(`Par ${index}`)]).flat();
  await setup([...many, ...pairs]);
  expect(await screen.findByText('13 grupos para conferir')).toBeTruthy();
  const groupList = () => within(screen.getByRole('list', { name: 'Grupos de possíveis duplicatas' }));
  expect(document.querySelectorAll('.duplicate-group')).toHaveLength(12);
  const largeGroup = groupList().getByText('11 registros neste grupo').closest('li')!;
  expect(within(largeGroup).getAllByRole('link')).toHaveLength(2);
  await userEvent.click(within(largeGroup).getByRole('button', { name: 'Ver registros deste grupo' }));
  expect(within(largeGroup).getAllByRole('link')).toHaveLength(10);
  await userEvent.click(within(within(largeGroup).getByRole('navigation', { name: 'Páginas de registros deste grupo' })).getByRole('button', { name: 'Próxima' }));
  expect(within(largeGroup).getAllByRole('link')).toHaveLength(1);
  const lastBook = within(largeGroup).getByRole('link');
  await userEvent.click(lastBook);
  await userEvent.click(await screen.findByRole('link', { name: 'Voltar para possíveis duplicatas' }));
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('link', { name: lastBook.getAttribute('aria-label')! })));
  expect(screen.getByText('Página 2 de 2')).toBeTruthy();
  await userEvent.click(within(screen.getByRole('navigation', { name: 'Páginas de grupos' })).getByRole('button', { name: 'Próxima' }));
  expect(document.querySelectorAll('.duplicate-group')).toHaveLength(1);
});

it('explains empty and no-match libraries in English', async () => {
  await setup([book('Only one')], 'en');
  expect(await screen.findByRole('heading', { name: 'No similar records found.' })).toBeTruthy();
  expect(screen.queryByRole('list', { name: 'Possible duplicate groups' })).toBeNull();
});

it('refreshes the review after a confirmed removal through the existing book detail', async () => {
  const first = book('Mesmo livro');
  const second = book('Mesmo livro');
  const repository = await setup([first, second]);
  expect(await screen.findByText('1 grupo para conferir')).toBeTruthy();
  await userEvent.click(screen.getByRole('link', { name: /Abrir registro 1: Mesmo livro/ }));
  await userEvent.click(await screen.findByText('Opções do livro'));
  await userEvent.click(screen.getByRole('button', { name: 'Remover livro' }));
  await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Excluir livro' }));
  expect(await screen.findByRole('heading', { name: 'Nenhum registro parecido encontrado.' })).toBeTruthy();
  expect((await repository.readAll()).books).toHaveLength(1);
});
