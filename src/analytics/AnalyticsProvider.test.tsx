// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const harness = vi.hoisted(() => {
  let persisted: 'accepted' | 'rejected' | null = null; let openFail = false;
  const listeners = new Set<() => void>();
  return { get openFail() { return openFail; }, set openFail(value: boolean) { openFail = value; }, openGate: null as Promise<void> | null, opened: vi.fn(),
    get persisted() { return persisted; }, set persisted(value: 'accepted' | 'rejected' | null) { persisted = value; }, listeners,
    read: vi.fn(async () => persisted), write: vi.fn(async (choice: 'accepted' | 'rejected') => { persisted = choice; }),
    enable: vi.fn(async () => true), disable: vi.fn(), page: vi.fn(), reload: vi.fn() };
});
const diagnostic = vi.hoisted(() => ({ setEnabled: vi.fn() }));
vi.mock('../diagnostics/client', () => ({ diagnosticsClient: diagnostic }));
vi.mock('./consent', () => ({ openAnalyticsConsentStore: async () => { harness.opened(); await harness.openGate; if (harness.openFail) throw new Error('storage'); return { read: harness.read, write: harness.write, subscribe: (listener: () => void) => { harness.listeners.add(listener); return () => harness.listeners.delete(listener); }, close() {} }; } }));
vi.mock('./ga4', () => ({ enableAnalytics: harness.enable, disableAnalytics: harness.disable, suspendAnalytics: harness.disable, recordPublicPage: harness.page }));
vi.mock('../pwa/register', () => ({ getPwaState: () => ({ blocked: false, update: 'none' }) }));
vi.mock('../ui/interaction-guard', () => ({ getUiOccupancy: () => 1 }));
vi.mock('../ui/components/PwaStatus', () => ({ PwaStatus: () => null }));
import { AnalyticsProvider, useAnalytics } from './AnalyticsProvider';
import { AnalyticsBanner } from '../ui/components/AnalyticsBanner';
import { SettingsPage } from '../ui/pages/SettingsPage';
import { LocalePreview } from '../i18n/context';
function View() { const analytics = useAnalytics(); const navigate = useNavigate(); return <><AnalyticsBanner /><button onClick={() => navigate('/livro/private-id?secret=1')}>Abrir livro</button><button onClick={analytics.review}>Revisar escolha</button><button onClick={() => void analytics.choose('rejected')}>Forçar recusa</button><span>{analytics.choice ?? 'indeciso'}</span></>; }
const mount = (locale: 'pt-BR' | 'en' = 'pt-BR') => render(<LocalePreview locale={locale}><MemoryRouter initialEntries={['/estante']}><AnalyticsProvider><View /></AnalyticsProvider></MemoryRouter></LocalePreview>);
beforeEach(() => { harness.openFail = false; harness.openGate = null; harness.opened.mockClear(); harness.persisted = null; harness.read.mockClear(); harness.write.mockClear(); harness.enable.mockClear(); harness.disable.mockClear(); harness.page.mockClear(); diagnostic.setEnabled.mockClear(); });
afterEach(cleanup);
it('previews English consent without enabling Analytics before acceptance', async () => {
  mount('en');
  expect(await screen.findByRole('button', { name: 'Accept' })).toBeTruthy();
  expect(screen.getByText(/does not follow you across other sites/)).toBeTruthy();
  expect(harness.enable).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'Decline' }));
  expect(harness.persisted).toBe('rejected');
  expect(harness.enable).not.toHaveBeenCalled();
});
it('does not load GA undecided or rejected and persists before enabling on acceptance', async () => {
  harness.enable.mockImplementationOnce(async () => { expect(harness.persisted).toBe('accepted'); return true; });
  mount(); await screen.findByRole('button', { name: 'Aceitar' });
  expect(screen.getByText(/contar visitas e envia dados técnicos de erros para melhorar o app/)).toBeTruthy();
  expect(screen.getByRole('link', { name: 'Saiba mais' })).toBeTruthy();
  expect(harness.enable).not.toHaveBeenCalled();
  expect(diagnostic.setEnabled).not.toHaveBeenCalledWith(true);
  await userEvent.click(screen.getByRole('button', { name: 'Aceitar' }));
  await waitFor(() => expect(harness.page).toHaveBeenCalledWith('/estante'));
  expect(harness.write).toHaveBeenCalledWith('accepted'); expect(harness.enable).toHaveBeenCalledOnce();
  expect(diagnostic.setEnabled).toHaveBeenLastCalledWith(true);
  expect(screen.queryByRole('button', { name: 'Aceitar' })).toBeNull();
});
it('recusal never loads the script and review allows a new choice', async () => {
  mount(); await userEvent.click(await screen.findByRole('button', { name: 'Recusar' }));
  expect(harness.persisted).toBe('rejected'); expect(harness.enable).not.toHaveBeenCalled();
  expect(diagnostic.setEnabled).toHaveBeenLastCalledWith(false);
  await userEvent.click(screen.getByRole('button', { name: 'Revisar escolha' }));
  expect(screen.getByText(/Escolha atual: Recusado/)).toBeTruthy();
});
it('storage failure fails closed with a retry message', async () => {
  harness.write.mockRejectedValueOnce(new Error('quota'));
  mount(); await userEvent.click(await screen.findByRole('button', { name: 'Aceitar' }));
  expect(await screen.findByRole('alert')).toBeTruthy(); expect(harness.enable).not.toHaveBeenCalled(); expect(harness.disable).toHaveBeenCalled();
  expect(diagnostic.setEnabled).toHaveBeenLastCalledWith(false);
  await userEvent.click(screen.getByRole('button', { name: 'Tentar novamente' })); await waitFor(() => expect(harness.enable).toHaveBeenCalledOnce());
});
it('cross-tab invalidation rereads storage; revocation disables and suggests a safe reopen', async () => {
  harness.persisted = 'accepted'; mount(); await waitFor(() => expect(harness.enable).toHaveBeenCalledOnce());
  harness.persisted = 'rejected'; for (const listener of harness.listeners) listener();
  await waitFor(() => expect(screen.getByText('rejected')).toBeTruthy());
  expect(harness.read).toHaveBeenCalledTimes(2); expect(harness.disable).toHaveBeenCalled();
  expect(diagnostic.setEnabled).toHaveBeenLastCalledWith(false);
  expect(await screen.findByRole('button', { name: 'Reabrir aplicativo' })).toBeTruthy();
});
it('never sends a route event before tag readiness', async () => {
  let resolve!: (value: boolean) => void; harness.enable.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  harness.persisted = 'accepted'; mount(); await waitFor(() => expect(harness.enable).toHaveBeenCalledOnce());
  await userEvent.click(screen.getByRole('button', { name: 'Abrir livro' })); expect(harness.page).not.toHaveBeenCalled();
  resolve(true); await waitFor(() => expect(harness.page).toHaveBeenCalledWith('/livro/private-id'));
});

it('repeated invalidation with unchanged acceptance does not duplicate a page view', async () => {
  harness.persisted = 'accepted'; mount(); await waitFor(() => expect(harness.page).toHaveBeenCalledOnce());
  for (const listener of harness.listeners) listener();
  await waitFor(() => expect(harness.read).toHaveBeenCalledTimes(2));
  expect(harness.enable).toHaveBeenCalledTimes(2); expect(harness.page).toHaveBeenCalledOnce();
});

it('recovers after opening storage fails without loading GA first', async () => {
  harness.openFail = true; mount();
  expect(await screen.findByRole('alert')).toBeTruthy(); expect(harness.enable).not.toHaveBeenCalled();
  harness.openFail = false; await userEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  await userEvent.click(screen.getByRole('button', { name: 'Aceitar' }));
  await waitFor(() => expect(harness.enable).toHaveBeenCalledOnce());
});
it('suspends immediately on cross-tab invalidation until IDB confirms consent', async () => {
  harness.persisted = 'accepted'; mount(); await waitFor(() => expect(harness.page).toHaveBeenCalledWith('/estante'));
  harness.page.mockClear();
  let release!: (value: 'accepted') => void;
  harness.read.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  for (const listener of harness.listeners) listener();
  await userEvent.click(screen.getByRole('button', { name: 'Abrir livro' }));
  expect(harness.page).not.toHaveBeenCalled();
  release('accepted'); await waitFor(() => expect(harness.page).toHaveBeenCalledExactlyOnceWith('/livro/private-id'));
});
it('returns keyboard focus to the review action after closing the banner', async () => {
  harness.persisted = 'rejected'; mount();
  const trigger = screen.getByRole('button', { name: 'Revisar escolha' });
  await userEvent.click(trigger);
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Recusar' })));
  await userEvent.click(screen.getByRole('button', { name: 'Fechar' }));
  await waitFor(() => expect(document.activeElement).toBe(trigger));
});
it('returns focus to the review action in Settings after closing the banner', async () => {
  harness.persisted = 'rejected';
  render(<MemoryRouter><AnalyticsProvider><SettingsPage /><AnalyticsBanner /></AnalyticsProvider></MemoryRouter>);
  const trigger = screen.getByRole('button', { name: 'Revisar escolha de uso do aplicativo' });
  await userEvent.click(trigger);
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Recusar' })));
  await userEvent.click(screen.getByRole('button', { name: 'Fechar' }));
  await waitFor(() => expect(document.activeElement).toBe(trigger));
});
it('keeps both senders off after a failed revocation and an old accepted reread', async () => {
  harness.persisted = 'accepted'; mount(); await waitFor(() => expect(diagnostic.setEnabled).toHaveBeenLastCalledWith(true));
  harness.write.mockRejectedValueOnce(new Error('synthetic quota'));
  await userEvent.click(screen.getByRole('button', { name: 'Forçar recusa' }));
  await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
  await act(async () => { window.dispatchEvent(new Event('focus')); });
  await waitFor(() => expect(harness.read).toHaveBeenCalledTimes(2));
  expect(diagnostic.setEnabled).toHaveBeenLastCalledWith(false);
  expect(harness.enable).toHaveBeenCalledOnce();
});
it('settles an acceptance write before focus rereads it', async () => {
  let release!: () => void;
  harness.write.mockImplementationOnce(async choice => { await new Promise<void>(resolve => { release = resolve; }); harness.persisted = choice; });
  mount(); await screen.findByRole('button', { name: 'Aceitar' });
  await userEvent.click(screen.getByRole('button', { name: 'Aceitar' }));
  await act(async () => { window.dispatchEvent(new Event('focus')); });
  expect(diagnostic.setEnabled).not.toHaveBeenCalledWith(true);
  await act(async () => { release(); });
  await waitFor(() => expect(diagnostic.setEnabled).toHaveBeenLastCalledWith(true));
});
it('keeps a concurrent rejection ahead of a pending acceptance', async () => {
  let release!: () => void;
  harness.write.mockImplementationOnce(async choice => { await new Promise<void>(resolve => { release = resolve; }); harness.persisted = choice; });
  mount(); await screen.findByRole('button', { name: 'Aceitar' });
  await userEvent.click(screen.getByRole('button', { name: 'Aceitar' }));
  await userEvent.click(screen.getByRole('button', { name: 'Forçar recusa' }));
  expect(diagnostic.setEnabled).toHaveBeenLastCalledWith(false);
  await act(async () => { release(); });
  await waitFor(() => expect(harness.persisted).toBe('rejected'));
  expect(diagnostic.setEnabled).toHaveBeenLastCalledWith(false);
  expect(harness.enable).not.toHaveBeenCalled();
});
it('suspends both senders during a pending cross-tab read', async () => {
  harness.persisted = 'accepted'; mount(); await waitFor(() => expect(diagnostic.setEnabled).toHaveBeenLastCalledWith(true));
  let release!: (choice: 'accepted' | 'rejected') => void;
  harness.read.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  await act(async () => { for (const listener of harness.listeners) listener(); });
  expect(diagnostic.setEnabled).toHaveBeenLastCalledWith(false);
  await act(async () => { release('rejected'); });
  await waitFor(() => expect(screen.getByText('rejected')).toBeTruthy());
  expect(diagnostic.setEnabled).toHaveBeenLastCalledWith(false);
});
it('keeps diagnostics authorized if the GA script cannot load after durable acceptance', async () => {
  harness.enable.mockResolvedValueOnce(false);
  mount(); await userEvent.click(await screen.findByRole('button', { name: 'Aceitar' }));
  await waitFor(() => expect(harness.enable).toHaveBeenCalledOnce());
  expect(harness.persisted).toBe('accepted');
  expect(diagnostic.setEnabled).toHaveBeenLastCalledWith(true);
  expect(harness.page).not.toHaveBeenCalled();
});
it('treats a rejected GA script promise as a GA failure after durable acceptance', async () => {
  harness.enable.mockRejectedValueOnce(new Error('synthetic script failure'));
  mount(); await userEvent.click(await screen.findByRole('button', { name: 'Aceitar' }));
  await waitFor(() => expect(harness.enable).toHaveBeenCalledOnce());
  expect(harness.persisted).toBe('accepted');
  expect(diagnostic.setEnabled).toHaveBeenLastCalledWith(true);
  expect(harness.page).not.toHaveBeenCalled();
});
it('allows rejection while the GA script is still pending after consent commit', async () => {
  let resolve!: (ready: boolean) => void;
  harness.enable.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  mount(); await userEvent.click(await screen.findByRole('button', { name: 'Aceitar' }));
  await waitFor(() => expect(diagnostic.setEnabled).toHaveBeenLastCalledWith(true));
  await userEvent.click(screen.getByRole('button', { name: 'Revisar escolha' }));
  const reject = screen.getByRole('button', { name: 'Recusar' });
  expect(reject.hasAttribute('disabled')).toBe(false);
  await userEvent.click(reject);
  await waitFor(() => expect(harness.persisted).toBe('rejected'));
  expect(diagnostic.setEnabled).toHaveBeenLastCalledWith(false);
  await act(async () => { resolve(true); });
  expect(harness.page).not.toHaveBeenCalled();
});
it('shares one storage opening across repeated retries', async () => {
  harness.openFail = true; mount(); await screen.findByRole('alert');
  expect(harness.opened).toHaveBeenCalledOnce();
  harness.openFail = false;
  let release!: () => void;
  harness.openGate = new Promise<void>(resolve => { release = resolve; });
  await userEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
  await userEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
  expect(harness.opened).toHaveBeenCalledTimes(2);
  await act(async () => { release(); });
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
});
