// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
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
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.queryByText(/0 livros/)).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('uses hash navigation, marks the current destination and focuses the content', async () => {
    window.location.hash = '#/estante';
    render(<AppRouter />);
    await userEvent.click(screen.getByRole('link', { name: 'Quero ler' }));
    expect(window.location.hash).toBe('#/quero-ler');
    expect(screen.getByRole('heading', { name: 'Quero ler' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Quero ler' }).getAttribute('aria-current')).toBe('page');
    expect(document.activeElement).toBe(screen.getByRole('main'));
    await waitFor(() => expect(document.title).toBe('Quero ler · Livro a Livro'));
    await userEvent.click(screen.getByRole('link', { name: 'Adicionar livro' }));
    expect(window.location.hash).toBe('#/adicionar');
    expect(screen.getByRole('heading', { name: 'Adicionar livro' })).toBeTruthy();
  });

  it.each([
    ['/lendo', 'Lendo'], ['/dados', 'Seus dados'],
    ['/configuracoes', 'Configurações'], ['/livro/example', 'Livro'],
    ['/unknown', 'Página não encontrada'],
  ])('renders a direct visit to %s', (path, title) => {
    render(<MemoryRouter initialEntries={[path]}><AppRoutes /></MemoryRouter>);
    expect(screen.getByRole('heading', { name: title, level: 1 })).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'Navegação principal' })).toBeTruthy();
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
    render(<MemoryRouter><LibraryState state="empty" year={2026} /></MemoryRouter>);
    expect(screen.getByRole('heading').textContent).toBe('Sua estante de 2026 começa aqui.');
    expect(screen.getByRole('link', { name: 'Adicionar livro' }).getAttribute('href')).toBe('/adicionar');
  });
});
