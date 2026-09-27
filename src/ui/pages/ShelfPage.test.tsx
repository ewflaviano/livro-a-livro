// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { openLibraryRepository } from '../../adapters/indexeddb/library-repository';
import { createBook, type Book } from '../../domain/book';
import { createShelfService } from '../../services/shelf-service';
import { AppRoutes } from '../../app/router';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const book = (title: string, patch: Partial<Book> = {}) => createBook({ title, ...patch }, {
  id: crypto.randomUUID(), now: '2026-09-26T12:00:00.000Z', shelfYear: 2026,
});

async function setup(books: Book[] = [], route = '/estante') {
  const repository = await openLibraryRepository({ name: crypto.randomUUID(), channelFactory: null });
  await repository.commit({ kind: 'replace', books }, await repository.readRevision());
  await repository.updatePreferences({ shelfYear: 2026 });
  const service = createShelfService(repository);
  render(<MemoryRouter initialEntries={[route]}><AppRoutes openService={async () => service} /></MemoryRouter>);
  await screen.findByRole('combobox', { name: 'Ano da estante' });
  return { repository, service };
}

describe('annual shelf with the real IndexedDB adapter', () => {
  it('keeps read-only annual metrics across filters, modes and years without network', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    await setup([
      book('Leitura um', { status: 'read', pageCount: 1234, authors: ['Ana'] }),
      book('Leitura dois', { status: 'read', pageCount: 200, authors: ['ana', 'Bia'] }),
      book('Em andamento', { status: 'reading', pageCount: 999, authors: ['Cris'] }),
      book('Para depois'),
      book('Ano anterior', { status: 'read', shelfYear: 2025, pageCount: 12, authors: ['Dani'] }),
    ]);
    const stats = () => screen.getByRole('definition', { name: '2 livros lidos em 2026' });
    expect(stats().textContent).toBe('2');
    expect(screen.getByRole('definition', { name: '1.434 páginas informadas em livros lidos' }).textContent).toBe('1.434');
    expect(screen.getByRole('definition', { name: '2 autores distintos em livros lidos' }).textContent).toBe('2');
    await userEvent.click(screen.getByRole('button', { name: 'Lendo' }));
    expect(screen.getByRole('heading', { name: 'Em andamento' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Leitura um' })).toBeNull();
    expect(stats()).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Lista' }));
    expect(screen.getByRole('list', { name: /Livros da estante/ }).className).toContain('--list');
    expect(stats()).toBeTruthy();
    await userEvent.selectOptions(screen.getByRole('combobox'), '2025');
    expect(screen.getByRole('definition', { name: '1 livros lidos em 2025' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Nenhum livro em Lendo nesta estante.' })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Limpar filtro' }));
    expect(screen.getByRole('heading', { name: 'Ano anterior' })).toBeTruthy();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('shows a confirmed empty shelf with zero metrics and a manual add destination', async () => {
    await setup();
    expect(screen.getByRole('heading', { name: 'Sua estante de 2026 começa aqui.' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Compartilhar ano' })).toBeNull();
    expect(screen.getByRole('definition', { name: '0 livros lidos em 2026' }).textContent).toBe('0');
    expect(screen.getByRole('definition', { name: '0 páginas informadas em livros lidos' }).textContent).toBe('0');
    expect(screen.getAllByRole('link', { name: 'Adicionar livro' }).every((link) => link.getAttribute('href') === '/adicionar')).toBe(true);
  });

  it('preserves year, mode, filter and return position from a book without placing content in URLs', async () => {
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    vi.stubGlobal('scrollY', 340);
    const { repository } = await setup([book('Registro privado', { status: 'read', shelfYear: 2025, rating: 5, note: 'Nota privada' })]);
    await userEvent.selectOptions(screen.getByRole('combobox'), '2025');
    await userEvent.click(screen.getByRole('button', { name: 'Lidos' }));
    await userEvent.click(screen.getByRole('button', { name: 'Lista' }));
    expect(screen.getByLabelText('Avaliação: 5 de 5 estrelas')).toBeTruthy();
    await userEvent.type(screen.getByRole('searchbox', { name: 'Buscar na estante' }), 'registro');
    const link = screen.getByRole('link', { name: /Registro privado/ });
    expect(link.getAttribute('href')).toMatch(/^\/livro\/[0-9a-f-]+$/);
    expect(screen.queryByText('Nota privada')).toBeNull();
    await userEvent.click(link);
    await userEvent.click(screen.getByRole('link', { name: 'Voltar para a estante' }));
    expect(screen.getByRole('heading', { name: 'Estante 2025' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Lista' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Lidos' }).getAttribute('aria-pressed')).toBe('true');
    expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('registro');
    expect(window.scrollTo).toHaveBeenCalledWith(0, 340);
    await waitFor(async () => expect(await repository.readPreferences()).toMatchObject({ shelfYear: 2025, mode: 'list', filter: 'read' }));
  });

  it.each([['/lendo', 'reading'], ['/quero-ler', 'want-to-read']] as const)('projects the annual status on %s', async (route, status) => {
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    await setup([book('Selecionado', { status }), book('Outro', { status: 'read' })], route);
    expect(screen.getByRole('heading', { name: 'Selecionado' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Outro' })).toBeNull();
    expect(screen.getByRole('definition', { name: '1 livros lidos em 2026' })).toBeTruthy();
    await userEvent.click(screen.getByRole('link', { name: /Selecionado/ }));
    expect(screen.getByRole('link', { name: 'Voltar para a estante' }).getAttribute('href')).toBe(route);
  });

  it('searches local titles and authors without changing preferences or sending a query', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const { repository } = await setup([book('Árvore de papel', { authors: ['Cláudia'] }), book('Outra leitura', { status: 'reading' })]);
    const before = await repository.readPreferences();
    const input = screen.getByRole('searchbox', { name: 'Buscar na estante' });
    await userEvent.type(input, 'ARVORE');
    expect(screen.getByRole('heading', { name: 'Árvore de papel' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Outra leitura' })).toBeNull();
    await userEvent.clear(input); await userEvent.type(input, 'claudia');
    expect(screen.getByRole('heading', { name: 'Árvore de papel' })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Lendo' }));
    expect(screen.getByRole('heading', { name: 'Nenhum livro encontrado.' })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Limpar busca' }));
    expect(screen.getByRole('heading', { name: 'Outra leitura' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Lendo' }).getAttribute('aria-pressed')).toBe('true');
    expect(await repository.readPreferences()).toMatchObject({ ...before, filter: 'reading' });
    expect(fetch).not.toHaveBeenCalled();
    expect(screen.getAllByRole('link').every(link => !/ARVORE|claudia/.test(link.getAttribute('href') ?? ''))).toBe(true);
  });

  it('updates after a local commit and restores imported preferences with the library', async () => {
    const { repository } = await setup();
    await act(async () => { await repository.commit({ kind: 'replace', books: [book('Restaurado', { status: 'read', shelfYear: 2025 })],
      preferences: { shelfYear: 2025, filter: 'read', mode: 'list' } }, await repository.readRevision()); });
    expect(await screen.findByRole('heading', { name: 'Restaurado' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Estante 2025' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Lista' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('definition', { name: 'Páginas não informadas' }).textContent).toBe('—');
    expect(screen.getByRole('definition', { name: 'Autoria não informada' }).textContent).toBe('—');
    expect(within(screen.getByRole('list', { name: /Livros da estante/ })).getByText('Autoria não informada')).toBeTruthy();
  });

  it('distinguishes loading and storage failure and retries without clearing data', async () => {
    const openService = vi.fn().mockRejectedValueOnce(new Error('storage unavailable'));
    const repository = await openLibraryRepository({ name: crypto.randomUUID(), channelFactory: null });
    const service = createShelfService(repository);
    openService.mockResolvedValueOnce(service);
    render(<MemoryRouter><AppRoutes openService={openService} /></MemoryRouter>);
    expect(screen.getByRole('status').textContent).toContain('Abrindo sua estante');
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(await screen.findByRole('alert')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    await screen.findByRole('combobox');
    expect((await repository.readAll()).books).toEqual([]);
    expect(openService).toHaveBeenCalledTimes(2);
  });
});
