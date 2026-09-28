// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AppRouter, AppRoutes } from './router';
import { LibraryState } from '../ui/components/LibraryState';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.location.hash = ''; });

describe('application shell', () => {
  it('opens the shelf without network calls or presenting unconfirmed empty data', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    render(<MemoryRouter><AppRoutes /></MemoryRouter>);
    expect(await screen.findByRole('heading', { name: 'Minha estante', level: 1 })).toBeTruthy();
    expect(await within(screen.getByRole('main')).findByRole('alert')).toBeTruthy();
    expect(screen.queryByText(/0 livros/)).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('uses hash navigation, marks the current destination and focuses the content', async () => {
    window.location.hash = '#/estante';
    render(<AppRouter />);
    const sidebar = within(screen.getByRole('navigation', { name: 'Navegação principal' }));
    expect(sidebar.queryByRole('link', { name: 'Lendo' })).toBeNull();
    expect(sidebar.queryByRole('link', { name: 'Quero ler' })).toBeNull();
    await userEvent.click(sidebar.getByRole('link', { name: 'Seus dados' }));
    expect(window.location.hash).toBe('#/dados');
    expect(screen.getByRole('heading', { name: 'Seus dados' })).toBeTruthy();
    expect(sidebar.getByRole('link', { name: 'Seus dados' }).getAttribute('aria-current')).toBe('page');
    expect(document.activeElement).toBe(screen.getByRole('main'));
    await waitFor(() => expect(document.title).toBe('Seus dados · Livro a Livro'));
    await userEvent.click(within(screen.getByRole('navigation', { name: 'Navegação mobile' })).getByRole('link', { name: 'Adicionar' }));
    expect(window.location.hash).toBe('#/adicionar');
    expect(screen.getByRole('heading', { name: 'Adicionar livro' })).toBeTruthy();
  });

  it.each([
    ['/lendo', 'Lendo'], ['/dados', 'Seus dados'],
    ['/configuracoes', 'Configurações'], ['/apoiar', 'Apoie o Livro a Livro'], ['/livro/example', 'Livro'],
    ['/unknown', 'Página não encontrada'],
  ])('renders a direct visit to %s', (path, title) => {
    render(<MemoryRouter initialEntries={[path]}><AppRoutes /></MemoryRouter>);
    expect(screen.getByRole('heading', { name: title, level: 1 })).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'Navegação principal' })).toBeTruthy();
  });

  it('offers three mobile destinations and keeps more active on its child pages', async () => {
    render(<MemoryRouter initialEntries={['/lendo']}><AppRoutes /></MemoryRouter>);
    const mobile = within(screen.getByRole('navigation', { name: 'Navegação mobile' }));
    expect(mobile.getAllByRole('link')).toHaveLength(3);
    expect(mobile.getByRole('link', { name: 'Estante' }).getAttribute('aria-current')).toBe('page');
    await userEvent.click(mobile.getByRole('link', { name: 'Mais' }));
    const options = within(screen.getByRole('navigation', { name: 'Outras opções' }));
    expect(options.getAllByRole('link').map(link => link.getAttribute('href'))).toEqual(['/dados', '/configuracoes', '/instalar', '/apoiar']);
    await userEvent.click(options.getByRole('link', { name: /Seus dados/ }));
    expect(mobile.getByRole('link', { name: 'Mais' }).getAttribute('aria-current')).toBe('page');
    expect(document.activeElement).toBe(screen.getByRole('main'));
  });

  it('skips navigation without changing the route fragment', async () => {
    window.location.hash = '#/dados';
    render(<AppRouter />);
    await userEvent.click(screen.getByRole('link', { name: 'Pular para o conteúdo' }));
    expect(document.activeElement).toBe(screen.getByRole('main'));
    expect(window.location.hash).toBe('#/dados');
  });
});

describe('library presentation states', () => {
  it('does not present loading as an empty shelf', () => {
    render(<LibraryState state="loading" />);
    expect(screen.getByRole('status').textContent).toContain('Abrindo sua estante');
    expect(screen.queryByRole('heading')).toBeNull();
  });

  it('offers retry after a local failure', async () => {
    const retry = vi.fn();
    render(<LibraryState state="error" onRetry={retry} />);
    expect(screen.getByRole('alert').textContent).toContain('Não foi possível abrir');
    await userEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it('offers an add route only for a confirmed empty shelf', () => {
    render(<MemoryRouter><LibraryState state="empty" /></MemoryRouter>);
    expect(screen.getByRole('heading').textContent).toBe('Comece sua estante');
    expect(screen.getByRole('link', { name: 'Adicionar livro' }).getAttribute('href')).toBe('/adicionar');
  });
});
