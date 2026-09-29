// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
const installation = vi.hoisted(() => ({ state: { installed: false, available: false, busy: false, outcome: 'none' }, request: vi.fn() }));
vi.mock('../../pwa/install', () => ({ getInstallState: () => installation.state, subscribeInstall: () => () => {}, startInstallObservation() {}, requestInstall: installation.request }));
import { detectInstallGuide, InstallPage } from './InstallPage';
import { LocalePreview } from '../../i18n/context';
afterEach(() => { cleanup(); installation.state = { installed: false, available: false, busy: false, outcome: 'none' }; vi.restoreAllMocks(); vi.clearAllMocks(); });
const mount = (locale: 'pt-BR' | 'en' = 'pt-BR') => render(<LocalePreview locale={locale}><MemoryRouter><InstallPage /></MemoryRouter></LocalePreview>);
const android = 'Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 Chrome/130.0.0.0 Mobile Safari/537.36';
const androidWebView = 'Mozilla/5.0 (Linux; Android 15; Pixel 8; wv) AppleWebKit/537.36 Version/4.0 Chrome/130.0.0.0 Mobile Safari/537.36';
const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1';
const iosChrome = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 CriOS/130.0 Mobile/15E148 Safari/604.1';
const desktop = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36';

it('previews English install guidance without claiming installation is a backup', () => {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Unknown browser');
  mount('en');
  expect(screen.getByRole('heading', { name: 'Install' })).toBeTruthy();
  expect(screen.getByRole('heading', { name: 'iPhone or iPad with Safari' })).toBeTruthy();
  expect(screen.getByText(/Installing does not create a backup/)).toBeTruthy();
  expect(screen.getByRole('link', { name: 'Open local backup' }).getAttribute('href')).toBe('/dados');
});

it.each([
  [android, 'android', false], [androidWebView, 'android', true], [iphone, 'ios', false], [iosChrome, 'ios', true], [desktop, 'desktop', false],
] as const)('chooses an instruction hint from the browser without promising a native prompt', (userAgent, guide, switchBrowser) => {
  expect(detectInstallGuide(userAgent)).toEqual({ guide, switchBrowser });
});

it('shows all known options when browser detection is uncertain', () => {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Unknown browser');
  mount();
  expect(screen.queryByRole('button', { name: 'Instalar aplicativo' })).toBeNull();
  expect(screen.getByRole('heading', { name: 'Android com Chrome' })).toBeTruthy();
  expect(screen.getByRole('heading', { name: 'iPhone ou iPad com Safari' })).toBeTruthy();
  expect(screen.getByRole('heading', { name: 'Chrome no computador' })).toBeTruthy();
  expect(screen.queryByText('Outro dispositivo')).toBeNull();
  expect(screen.getByRole('link', { name: 'Abrir backup local' }).getAttribute('href')).toBe('/dados');
  expect(screen.getByText(/Instalar não cria backup/)).toBeTruthy();
});

it.each([
  [android, 'Android com Chrome'], [iphone, 'iPhone ou iPad com Safari'], [desktop, 'Chrome no computador'],
] as const)('shows the relevant %s guide and keeps other devices secondary', async (userAgent, title) => {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(userAgent);
  mount();
  expect(screen.getByRole('heading', { name: title, level: 2 })).toBeTruthy();
  const other = screen.getByText('Outro dispositivo').closest('details')!;
  expect(other.open).toBe(false);
  await userEvent.click(screen.getByText('Outro dispositivo'));
  expect(other.open).toBe(true);
  expect(other.querySelectorAll('h3')).toHaveLength(2);
});

it('asks iPhone users in another browser to open Safari', () => {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(iosChrome);
  mount();
  expect(screen.getByText('Abra este site no Safari para seguir estes passos.')).toBeTruthy();
});

it('asks Android WebView users to open Chrome even when its UA contains Chrome', () => {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(androidWebView);
  mount();
  expect(screen.getByText('Abra este site no Chrome para seguir estes passos.')).toBeTruthy();
});

it('puts an available native prompt first and invokes it only on click', async () => {
  installation.state.available = true;
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(android);
  mount();
  const button = screen.getByRole('button', { name: 'Instalar aplicativo' });
  const fallback = screen.getByText('Instalar pelo navegador');
  expect(button.compareDocumentPosition(fallback) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(fallback.closest('details')?.open).toBe(false);
  expect(installation.request).not.toHaveBeenCalled();
  await userEvent.click(button);
  expect(installation.request).toHaveBeenCalledOnce();
});

it.each([['accepted', /Pedido aceito/], ['dismissed', /Instalação cancelada/], ['failed', /Não foi possível abrir/]])('reports %s without claiming installation', (outcome, message) => {
  installation.state.outcome = outcome as string;
  mount();
  expect(screen.getByRole('status').textContent).toMatch(message as RegExp);
  expect(screen.queryByText(/Aplicativo instalado neste dispositivo/)).toBeNull();
  if (outcome === 'accepted') expect(screen.queryByText('Outro dispositivo')).toBeNull();
});

it('shows an observed installation without prompts or instructions', () => {
  installation.state.installed = true;
  mount();
  expect(screen.getByRole('status').textContent).toContain('conforme informado pelo navegador');
  expect(screen.queryByRole('button')).toBeNull();
  expect(screen.queryByText('Outro dispositivo')).toBeNull();
  expect(screen.queryByRole('heading', { name: 'Android com Chrome' })).toBeNull();
  expect(screen.getByRole('link', { name: 'Abrir backup local' })).toBeTruthy();
});
