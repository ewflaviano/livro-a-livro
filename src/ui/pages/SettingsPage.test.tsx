// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
const analytics = vi.hoisted(() => ({ view: { choice: null as 'accepted' | 'rejected' | null, loading: false, error: false, review: vi.fn() } }));
vi.mock('../../analytics/AnalyticsProvider', () => ({ useAnalytics: () => analytics.view }));
const diagnostics = vi.hoisted(() => ({ view: { choice: null as 'accepted' | 'rejected' | null, loading: false, saving: false, error: false, reviewing: false,
  choose: vi.fn(), retry: vi.fn(), review: vi.fn(), closeReview: vi.fn() } }));
vi.mock('../../diagnostics/DiagnosticsProvider', () => ({ useDiagnostics: () => diagnostics.view }));
import { SettingsPage } from './SettingsPage';

beforeEach(() => { analytics.view.choice = null; analytics.view.loading = false; analytics.view.error = false; analytics.view.review.mockClear();
  diagnostics.view.choice = null; diagnostics.view.loading = false; diagnostics.view.error = false; diagnostics.view.reviewing = false;
  diagnostics.view.choose.mockClear(); diagnostics.view.review.mockClear(); });
afterEach(cleanup);
const mount = () => render(<MemoryRouter><SettingsPage /></MemoryRouter>);

it('replaces duplicate shelf controls with a separate visits choice', async () => {
  mount();
  expect(screen.queryByRole('combobox')).toBeNull();
  expect(screen.getByText('Google Analytics: Ainda não escolhida.')).toBeTruthy();
  await userEvent.click(screen.getByRole('button', { name: 'Revisar escolha de Analytics' }));
  expect(analytics.view.review).toHaveBeenCalledOnce();
});

it.each([
  ['accepted', 'Aceito'], ['rejected', 'Recusado'],
] as const)('shows the saved %s choice', (choice, label) => {
  analytics.view.choice = choice; mount();
  expect(screen.getByText(`Google Analytics: ${label}.`)).toBeTruthy();
});

it('keeps an uncertain consent state honest', () => {
  analytics.view.error = true; mount();
  expect(screen.getByText('Google Analytics: Não foi possível verificar.')).toBeTruthy();
});
it('keeps diagnostic choice independent from Analytics', async () => {
  mount();
  expect(screen.getByText('Envio de códigos técnicos: Desligado.')).toBeTruthy();
  await userEvent.click(screen.getByRole('button', { name: 'Aceitar diagnóstico' }));
  expect(diagnostics.view.choose).toHaveBeenCalledWith('accepted');
  expect(analytics.view.review).not.toHaveBeenCalled();
  diagnostics.view.choice = 'rejected'; cleanup(); mount();
  expect(screen.getByText('Envio de códigos técnicos: Recusado.')).toBeTruthy();
  await userEvent.click(screen.getByRole('button', { name: 'Rever diagnóstico' }));
  expect(diagnostics.view.review).toHaveBeenCalledOnce();
});

it('shows build and offline state while keeping install and update controls secondary', async () => {
  mount();
  expect(screen.getByText(`Versão ${__APP_VERSION__} · commit ${__BUILD_ID__} · desenvolvimento`)).toBeTruthy();
  expect(screen.getByRole('status')).toBeTruthy();
  const options = screen.getByText('Instalação e atualização').closest('details')!;
  expect(options.open).toBe(false);
  await userEvent.click(screen.getByText('Instalação e atualização'));
  expect(options.open).toBe(true);
  expect(screen.getAllByRole('status')).toHaveLength(1);
  expect(screen.getByRole('region', { name: 'Disponibilidade do aplicativo' })).toBeTruthy();
  expect(screen.getByRole('region', { name: 'Atualização do aplicativo' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Verificar atualização' })).toBeTruthy();
  expect(screen.getByRole('link', { name: 'Como instalar' }).getAttribute('href')).toBe('/instalar');
  expect(screen.getByRole('link', { name: 'Seus dados e backup' }).getAttribute('href')).toBe('/dados');
});
