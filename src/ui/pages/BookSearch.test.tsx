// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { openDatabase } from '../../adapters/indexeddb/database';
import { openLibraryRepository } from '../../adapters/indexeddb/library-repository';
import { createShelfService } from '../../services/shelf-service';
import { AppRoutes } from '../../app/router';

const payload = { numFound: 1, docs: [{ key: '/works/OL12W', title: 'Livro encontrado', author_name: ['Autora'], cover_i: 123, first_publish_year: 1953,
  editions: { docs: [{ key: '/books/OL34M' }] } }] };
const edition = { key: '/books/OL34M', works: [{ key: '/works/OL12W' }], title: 'Edição encontrada', publish_date: '2002', number_of_pages: 240,
  isbn_13: ['9780306406157'], covers: [456] };
beforeEach(async () => {
  const db = await openDatabase(); await db.db.clear('searchCache'); db.close();
  vi.stubGlobal('fetch', vi.fn((url: URL) => Promise.resolve(new Response(JSON.stringify(url.pathname.includes('/books/') ? edition : payload)))));
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
async function setup() {
  const repository = await openLibraryRepository({ name: crypto.randomUUID(), channelFactory: null });
  const service = createShelfService(repository);
  render(<MemoryRouter initialEntries={['/adicionar']}><AppRoutes openService={async () => service} /></MemoryRouter>);
  await screen.findByRole('textbox', { name: 'Título, autor ou ISBN' });
  return repository;
}
describe('optional book search UI', () => {
  it('shows covers in results and saves the chosen edition metadata locally', async () => {
    const repository = await setup();
    await userEvent.type(screen.getByRole('textbox', { name: 'Título, autor ou ISBN' }), 'Livro');
    expect(fetch).not.toHaveBeenCalled(); expect(document.querySelector('img')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Buscar' }));
    const choose = await screen.findByRole('button', { name: 'Selecionar Livro encontrado (1953)' });
    expect(document.querySelector('img')?.getAttribute('src')).toBe('https://covers.openlibrary.org/b/id/123-S.jpg?default=false');
    expect((await repository.readAll()).books).toHaveLength(0);
    expect(screen.getByText('Ano da obra: 1953')).toBeTruthy();
    await userEvent.click(choose);
    const title = await screen.findByRole('textbox', { name: 'Título (obrigatório)' }, { timeout: 3000 });
    expect(screen.getByRole('button', { name: 'Escolher outro livro' })).toBeTruthy();
    expect((title as HTMLInputElement).value).toBe('Livro encontrado');
    await userEvent.click(screen.getByText('Mais detalhes (opcional)'));
    expect((screen.getByRole('spinbutton', { name: 'Ano de publicação' }) as HTMLInputElement).value).toBe('2002');
    expect((screen.getByRole('spinbutton', { name: 'Páginas' }) as HTMLInputElement).value).toBe('240');
    expect((screen.getByRole('textbox', { name: 'ISBN' }) as HTMLInputElement).value).toBe('9780306406157');
    expect(document.querySelector('.selected-cover img')?.getAttribute('src')).toBe('https://covers.openlibrary.org/b/id/123-M.jpg?default=false');
    expect(document.querySelector('.selected-cover img')?.getAttribute('referrerpolicy')).toBe('no-referrer');
    fireEvent.error(document.querySelector('.selected-cover img')!);
    expect(screen.getByText('Sem capa · Livro encontrado')).toBeTruthy();
    await userEvent.clear(title); await userEvent.type(title, 'Título revisado');
    fireEvent.change(screen.getByRole('textbox', { name: 'Observações' }), { target: { value: 'Nota que fica local' } });
    await userEvent.click(screen.getByRole('button', { name: 'Salvar livro' }));
    await screen.findByRole('heading', { name: 'Título revisado' });
    expect(document.querySelector('img')?.getAttribute('src')).toBe('https://covers.openlibrary.org/b/id/123-M.jpg?default=false');
    const saved = (await repository.readAll()).books[0];
    expect(saved).toMatchObject({ title: 'Título revisado', note: 'Nota que fica local', publicationYear: 2002, pageCount: 240, isbn: '9780306406157',
      cover: { provider: 'open_library', coverId: 123 }, source: { provider: 'open_library', workId: 'OL12W', editionId: 'OL34M' } });
    expect(fetch).toHaveBeenCalledTimes(2);
    await screen.findByRole('heading', { name: /Estante/ }); expect(fetch).toHaveBeenCalledTimes(2);
    expect(document.querySelector('img')?.getAttribute('src')).toBe('https://covers.openlibrary.org/b/id/123-M.jpg?default=false');
    await userEvent.click(screen.getByRole('button', { name: 'Ver em lista' }));
    expect(document.querySelector('img')?.getAttribute('src')).toBe('https://covers.openlibrary.org/b/id/123-M.jpg?default=false');
    await userEvent.click(screen.getByRole('link', { name: /Título revisado/ }));
    await screen.findByRole('heading', { name: 'Título revisado' });
    expect(document.querySelector('img')?.getAttribute('src')).toBe('https://covers.openlibrary.org/b/id/123-M.jpg?default=false');
  });
  it('returns to the same results without another request and preserves a dirty draft until confirmed', async () => {
    const repository = await setup();
    await userEvent.type(screen.getByRole('textbox', { name: 'Título, autor ou ISBN' }), 'Livro');
    await userEvent.click(screen.getByRole('button', { name: 'Buscar' }));
    const choose = await screen.findByRole('button', { name: 'Selecionar Livro encontrado (1953)' });
    await userEvent.click(choose);
    const title = await screen.findByRole('textbox', { name: 'Título (obrigatório)' }, { timeout: 3000 });
    await userEvent.type(title, ' revisado');
    await userEvent.click(screen.getByRole('button', { name: 'Escolher outro livro' }));
    expect(screen.getByRole('alertdialog')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect((title as HTMLInputElement).value).toBe('Livro encontrado revisado');
    await userEvent.click(screen.getByRole('button', { name: 'Escolher outro livro' }));
    await userEvent.click(screen.getByRole('button', { name: 'Descartar alterações' }));
    const returned = await screen.findByRole('button', { name: 'Selecionar Livro encontrado (1953)' });
    await waitFor(() => expect(document.activeElement).toBe(returned));
    expect((screen.getByRole('textbox', { name: 'Título, autor ou ISBN' }) as HTMLInputElement).value).toBe('Livro');
    expect(fetch).toHaveBeenCalledTimes(2);
    expect((await repository.readAll()).books).toHaveLength(0);
  });
  it('keeps manual entry available on malformed data, empty results and offline', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response('not json'));
    await setup();
    await userEvent.type(screen.getByRole('textbox', { name: 'Título, autor ou ISBN' }), 'Livro');
    await userEvent.click(screen.getByRole('button', { name: 'Buscar' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Não foi possível ler');
    await userEvent.click(screen.getByRole('button', { name: 'Adicionar manualmente' }));
    expect(screen.getByRole('textbox', { name: 'Título (obrigatório)' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Adicionar manualmente' })));
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    await userEvent.type(screen.getByRole('textbox', { name: 'Título, autor ou ISBN' }), 'Outro livro');
    await userEvent.click(screen.getByRole('button', { name: 'Buscar' }));
    expect((await screen.findByRole('alert')).textContent).toContain('precisa de conexão');
    expect(screen.getByRole('button', { name: 'Adicionar manualmente' })).toBeTruthy();
    expect(fetch).toHaveBeenCalledOnce();
  });
  it('aborts a search when switching to manual entry and never applies its late result', async () => {
    let resolve!: (response: Response) => void;
    vi.mocked(fetch).mockImplementation(() => new Promise<Response>((done) => { resolve = done; }));
    await setup();
    await userEvent.type(screen.getByRole('textbox', { name: 'Título, autor ou ISBN' }), 'Livro');
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    const signal = vi.mocked(fetch).mock.calls[0][1]?.signal;
    await userEvent.click(screen.getByRole('button', { name: 'Adicionar manualmente' }));
    expect(signal?.aborted).toBe(true);
    resolve(new Response(JSON.stringify(payload)));
    await waitFor(() => expect(screen.queryByRole('button', { name: /Selecionar Livro encontrado/ })).toBeNull());
    expect((screen.getByRole('textbox', { name: 'Título (obrigatório)' }) as HTMLInputElement).value).toBe('');
  });
  it('displays an empty result and preserves the manual route', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ docs: [], numFound: 0 })));
    await setup();
    await userEvent.type(screen.getByRole('textbox', { name: 'Título, autor ou ISBN' }), 'Livro');
    await userEvent.click(screen.getByRole('button', { name: 'Buscar' }));
    expect(await screen.findByText(/Não encontramos este livro/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Adicionar manualmente' })).toBeTruthy();
  });
});
