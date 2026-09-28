// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const installation = vi.hoisted(() => ({ state: { installed: false }, listeners: new Set<() => void>() }));
vi.mock('../../pwa/install', () => ({
  getInstallState: () => installation.state,
  subscribeInstall: (listener: () => void) => { installation.listeners.add(listener); return () => { installation.listeners.delete(listener); }; },
}));
import { MorePage } from './MorePage';

afterEach(() => { cleanup(); installation.state = { installed: false }; installation.listeners.clear(); });

it('keeps three concise, keyboard-accessible destinations', async () => {
  render(<MemoryRouter initialEntries={['/mais']}><Routes>
    <Route path="/mais" element={<MorePage />} />
    <Route path="/dados" element={<h1>Destino de dados</h1>} />
  </Routes></MemoryRouter>);
  const options = within(screen.getByRole('navigation', { name: 'Outras opções' }));
  expect(options.getAllByRole('link').map(link => link.textContent)).toEqual(['Seus dados', 'Configurações', 'Instalar']);
  await userEvent.tab();
  expect(document.activeElement).toBe(options.getByRole('link', { name: 'Seus dados' }));
  await userEvent.keyboard('{Enter}');
  expect(screen.getByRole('heading', { name: 'Destino de dados' })).toBeTruthy();
});

it('shows installed as a short state on the install destination', () => {
  render(<MemoryRouter><MorePage /></MemoryRouter>);
  act(() => {
    installation.state = { installed: true };
    installation.listeners.forEach(listener => listener());
  });
  const options = within(screen.getByRole('navigation', { name: 'Outras opções' }));
  expect(options.getAllByRole('link')).toHaveLength(3);
  expect(options.getByRole('link', { name: 'Instalar — instalado neste dispositivo' }).getAttribute('href')).toBe('/instalar');
});
