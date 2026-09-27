// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
const installation = vi.hoisted(() => ({ state: { installed: false, available: false, busy: false, outcome: 'none' }, request: vi.fn() }));
vi.mock('../../pwa/install', () => ({ getInstallState: () => installation.state, subscribeInstall: () => () => {}, startInstallObservation() {}, requestInstall: installation.request }));
import { InstallPage } from './InstallPage';
afterEach(() => { cleanup(); installation.state = { installed: false, available: false, busy: false, outcome: 'none' }; vi.clearAllMocks(); });
it('offers platform instructions and backup without an unavailable install action', () => {
  render(<MemoryRouter><InstallPage /></MemoryRouter>);
  expect(screen.queryByRole('button', { name: 'Instalar aplicativo' })).toBeNull();
  expect(screen.getByRole('heading', { name: 'Android e Chrome' })).toBeTruthy();
  expect(screen.getByRole('heading', { name: 'iPhone e iPad com Safari' })).toBeTruthy();
  expect(screen.getByRole('link', { name: 'Abrir backup local' }).getAttribute('href')).toBe('/dados');
});
it('only invokes an available native prompt on explicit click', async () => {
  installation.state.available = true; render(<MemoryRouter><InstallPage /></MemoryRouter>);
  expect(installation.request).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'Instalar aplicativo' }));
  expect(installation.request).toHaveBeenCalledOnce();
});
it.each([['accepted', /Pedido aceito/], ['dismissed', /Instalação cancelada/]])('reports %s without presenting installed status', (outcome, message) => {
  installation.state.outcome = outcome as string; render(<MemoryRouter><InstallPage /></MemoryRouter>);
  expect(screen.getByRole('status').textContent).toMatch(message as RegExp);
  expect(screen.queryByText(/Aplicativo instalado neste dispositivo/)).toBeNull();
});
it('announces observed installation instead of offering another prompt', () => {
  installation.state.installed = true; render(<MemoryRouter><InstallPage /></MemoryRouter>);
  expect(screen.getByRole('status').textContent).toContain('conforme informado pelo navegador');
  expect(screen.queryByRole('button')).toBeNull();
});
