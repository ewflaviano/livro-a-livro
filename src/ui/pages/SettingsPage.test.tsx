// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
const analytics = vi.hoisted(() => ({ view: { choice: null as 'accepted' | 'rejected' | null, loading: false, error: false, review: vi.fn() } }));
vi.mock('../../analytics/AnalyticsProvider', () => ({ useAnalytics: () => analytics.view }));
import { SettingsPage } from './SettingsPage';
import { LocalePreview } from '../../i18n/context';

beforeEach(() => { analytics.view.choice = null; analytics.view.loading = false; analytics.view.error = false; analytics.view.review.mockClear();
});
afterEach(cleanup);
const mount = (locale: 'pt-BR' | 'en' = 'pt-BR') => render(<LocalePreview locale={locale}><MemoryRouter><SettingsPage /></MemoryRouter></LocalePreview>);

it('previews English settings and keeps usage choice explicit', async () => {
  mount('en');
  expect(screen.getByText('Visits and diagnostics: Not chosen yet.')).toBeTruthy();
  await userEvent.click(screen.getByRole('button', { name: 'Review app usage choice' }));
  expect(analytics.view.review).toHaveBeenCalledOnce();
  expect(screen.getByRole('link', { name: 'Your data and backup' }).getAttribute('href')).toBe('/dados');
});

it('replaces duplicate shelf controls with one usage choice', async () => {
  mount();
  expect(screen.queryByRole('combobox')).toBeNull();
  expect(screen.getByText('Visitas e diagnóstico: Ainda não escolhido.')).toBeTruthy();
  expect(screen.getAllByRole('heading', { level: 2, name: 'Uso do aplicativo' })).toHaveLength(1);
  await userEvent.click(screen.getByRole('button', { name: 'Revisar escolha de uso do aplicativo' }));
  expect(analytics.view.review).toHaveBeenCalledOnce();
});

it.each([
  ['accepted', 'Aceito'], ['rejected', 'Recusado'],
] as const)('shows the saved %s choice', (choice, label) => {
  analytics.view.choice = choice; mount();
  expect(screen.getByText(`Visitas e diagnóstico: ${label}.`)).toBeTruthy();
});

it('keeps an uncertain consent state honest', () => {
  analytics.view.error = true; mount();
  expect(screen.getByText('Visitas e diagnóstico: Não foi possível verificar.')).toBeTruthy();
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
