// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LocaleProvider, useLocale, useLocalePreference } from './context';
import { FirstVisitLanguageChoice, SettingsLanguageChoice } from '../ui/components/LanguageChoice';

const fake = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock('./store', () => ({ openLocaleStore: fake.open }));

let choice: 'pt-BR' | 'en' | null;
let listener: (() => void) | null;
const write = vi.fn(async (next: 'pt-BR' | 'en') => { choice = next; listener?.(); });
const close = vi.fn();
const store = { read: vi.fn(async () => ({ choice, session: 'session' })), write,
  subscribe: vi.fn((next: () => void) => { listener = next; return () => { listener = null; }; }), close };

function View() {
  const { locale, t } = useLocale();
  const preference = useLocalePreference();
  return <><p data-testid="locale">{locale}</p><p data-testid="settings">{t('settings')}</p>
    <p data-testid="available">{String(preference?.available)}</p>
    <FirstVisitLanguageChoice /><SettingsLanguageChoice /></>;
}

beforeEach(() => {
  choice = null; listener = null; vi.clearAllMocks(); fake.open.mockResolvedValue(store);
  vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['en-US', 'pt-BR']);
  document.querySelector('link[rel="manifest"]')?.remove();
  document.head.innerHTML = '<meta name="description" content="initial">';
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); document.querySelector('link[rel="manifest"]')?.remove(); });

it('infers English without storing it, then saves an explicit PT choice and updates public metadata', async () => {
  const view = render(<LocaleProvider><View /></LocaleProvider>);
  expect(await screen.findByTestId('settings')).toHaveProperty('textContent', 'Settings');
  expect(write).not.toHaveBeenCalled();
  expect(document.documentElement.lang).toBe('en');
  expect(document.querySelector<HTMLLinkElement>('link[rel="manifest"]')?.getAttribute('href')).toBe('/manifest-en.webmanifest');
  expect(screen.getByText('Choose the language for this browser. You can change it in Settings.')).toBeTruthy();
  await userEvent.click(screen.getAllByRole('button', { name: 'Português' })[0]);
  await waitFor(() => expect(screen.getByTestId('settings')).toHaveProperty('textContent', 'Configurações'));
  expect(write).toHaveBeenCalledWith('pt-BR', 'session');
  expect(document.documentElement.lang).toBe('pt-BR');
  expect(document.querySelector<HTMLLinkElement>('link[rel="manifest"]')?.getAttribute('href')).toBe('/manifest.webmanifest');
  expect(document.querySelector<HTMLMetaElement>('meta[name="description"]')?.content).toContain('estante pessoal');
  expect(screen.queryByText('Choose the language for this browser. You can change it in Settings.')).toBeNull();
  view.unmount();
  render(<LocaleProvider><View /></LocaleProvider>);
  expect(await screen.findByTestId('locale')).toHaveProperty('textContent', 'pt-BR');
  expect(close).toHaveBeenCalled();
});

it('rechecks other-tab changes and a logout without writing the browser inference', async () => {
  choice = 'pt-BR';
  render(<LocaleProvider><View /></LocaleProvider>);
  expect(await screen.findByTestId('locale')).toHaveProperty('textContent', 'pt-BR');
  choice = 'en'; listener?.();
  await waitFor(() => expect(screen.getByTestId('locale')).toHaveProperty('textContent', 'en'));
  choice = null; listener?.();
  await waitFor(() => expect(screen.getByText('Choose the language for this browser. You can change it in Settings.')).toBeTruthy());
  expect(write).not.toHaveBeenCalled();
});

it('falls back to Portuguese and disables saving when locale storage fails', async () => {
  fake.open.mockRejectedValueOnce(new Error('storage unavailable'));
  render(<LocaleProvider><View /></LocaleProvider>);
  expect(await screen.findByTestId('locale')).toHaveProperty('textContent', 'pt-BR');
  expect(screen.getByTestId('available')).toHaveProperty('textContent', 'false');
  expect(screen.getByRole('alert')).toHaveProperty('textContent', expect.stringContaining('Não foi possível salvar o idioma'));
  expect(screen.getAllByRole('button', { name: 'English' })[0]).toHaveProperty('disabled', true);
  expect(document.querySelector<HTMLLinkElement>('link[rel="manifest"]')?.getAttribute('href')).toBe('/manifest.webmanifest');
});

it('shows a Portuguese fallback when the locale database remains blocked', async () => {
  fake.open.mockReturnValueOnce(new Promise(() => {}));
  vi.useFakeTimers();
  render(<LocaleProvider><View /></LocaleProvider>);
  await act(async () => { await vi.advanceTimersByTimeAsync(4000); });
  expect(screen.getByTestId('locale')).toHaveProperty('textContent', 'pt-BR');
  expect(screen.getByTestId('available')).toHaveProperty('textContent', 'false');
});
