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

const payload = { numFound: 1, docs: [{ key: '/works/OL12W', title: 'Livro encontrado', author_name: ['Autora'], cover_i: 123, first_publish_year: 1953 }] };
beforeEach(async () => {
  const db = await openDatabase(); await db.db.clear('searchCache'); db.close();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(payload))));
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
  it('does not fetch on mount or typing, waits for selection before a cover, and saves reviewed data locally', async () => {
    const repository = await setup();
    await userEvent.type(screen.getByRole('textbox', { name: 'Título, autor ou ISBN' }), 'Livro');
    expect(fetch).not.toHaveBeenCalled(); expect(document.querySelector('img')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Buscar' }));
    const choose = await screen.findByRole('button', { name: 'Usar este livro: Livro encontrado' });
    expect(document.querySelector('img')).toBeNull(); expect((await repository.readAll()).books).toHaveLength(0);
    await userEvent.click(choose);
    const title = screen.getByRole('textbox', { name: 'Título (obrigatório)' });
    expect((title as HTMLInputElement).value).toBe('Livro encontrado');
    expect(document.querySelector('img')?.getAttribute('src')).toBe('https://covers.openlibrary.org/b/id/123-M.jpg?default=false');
    expect(document.querySelector('img')?.getAttribute('referrerpolicy')).toBe('no-referrer');
    fireEvent.error(document.querySelector('img')!);
    expect(screen.getByText('Sem capa · Livro encontrado')).toBeTruthy();
    await userEvent.clear(title); await userEvent.type(title, 'Título revisado');
    fireEvent.change(screen.getByRole('textbox', { name: 'Sua nota privada' }), { target: { value: 'Nota que fica local' } });
    await userEvent.click(screen.getByRole('button', { name: 'Salvar livro' }));
    await screen.findByRole('heading', { name: 'Título revisado' });
    const saved = (await repository.readAll()).books[0];
    expect(saved).toMatchObject({ title: 'Título revisado', note: 'Nota que fica local', publicationYear: null, pageCount: null,
      cover: { provider: 'open_library', coverId: 123 }, source: { provider: 'open_library', workId: 'OL12W', editionId: null } });
    expect(fetch).toHaveBeenCalledOnce();
    await userEvent.click(screen.getByRole('link', { name: 'Voltar para a estante' }));
    await screen.findByRole('heading', { name: /Estante/ }); expect(fetch).toHaveBeenCalledOnce();
  });
  it('keeps manual entry available on malformed data, empty results and offline', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response('not json'));
    await setup();
    await userEvent.type(screen.getByRole('textbox', { name: 'Título, autor ou ISBN' }), 'Livro');
    await userEvent.click(screen.getByRole('button', { name: 'Buscar' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Não foi possível ler');
    await userEvent.click(screen.getByRole('button', { name: 'Adicionar manualmente' }));
    expect(screen.getByRole('textbox', { name: 'Título (obrigatório)' })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
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
    await waitFor(() => expect(screen.queryByRole('button', { name: /Usar este livro/ })).toBeNull());
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
