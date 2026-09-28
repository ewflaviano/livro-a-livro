// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const harness = vi.hoisted(() => {
  let persisted: 'accepted' | 'rejected' | null = null; let openFail = false;
  const listeners = new Set<() => void>();
  return { get openFail() { return openFail; }, set openFail(value: boolean) { openFail = value; }, get persisted() { return persisted; }, set persisted(value: 'accepted' | 'rejected' | null) { persisted = value; }, listeners,
    read: vi.fn(async () => persisted), write: vi.fn(async (choice: 'accepted' | 'rejected') => { persisted = choice; }),
    enable: vi.fn(async () => true), disable: vi.fn(), page: vi.fn(), reload: vi.fn() };
});
vi.mock('./consent', () => ({ openAnalyticsConsentStore: async () => { if (harness.openFail) throw new Error('storage'); return { read: harness.read, write: harness.write, subscribe: (listener: () => void) => { harness.listeners.add(listener); return () => harness.listeners.delete(listener); }, close() {} }; } }));
vi.mock('./ga4', () => ({ enableAnalytics: harness.enable, disableAnalytics: harness.disable, suspendAnalytics: harness.disable, recordPublicPage: harness.page }));
vi.mock('../pwa/register', () => ({ getPwaState: () => ({ blocked: false, update: 'none' }) }));
vi.mock('../ui/interaction-guard', () => ({ getUiOccupancy: () => 1 }));
vi.mock('../ui/components/PwaStatus', () => ({ PwaStatus: () => null }));
import { AnalyticsProvider, useAnalytics } from './AnalyticsProvider';
import { AnalyticsBanner } from '../ui/components/AnalyticsBanner';
import { SettingsPage } from '../ui/pages/SettingsPage';
function View() { const analytics = useAnalytics(); const navigate = useNavigate(); return <><AnalyticsBanner /><button onClick={() => navigate('/livro/private-id?secret=1')}>Abrir livro</button><button onClick={analytics.review}>Revisar escolha</button><span>{analytics.choice ?? 'indeciso'}</span></>; }
const mount = () => render(<MemoryRouter initialEntries={['/estante']}><AnalyticsProvider><View /></AnalyticsProvider></MemoryRouter>);
beforeEach(() => { harness.openFail = false; harness.persisted = null; harness.read.mockClear(); harness.write.mockClear(); harness.enable.mockClear(); harness.disable.mockClear(); harness.page.mockClear(); });
afterEach(cleanup);
it('does not load GA undecided or rejected and persists before enabling on acceptance', async () => {
  harness.enable.mockImplementationOnce(async () => { expect(harness.persisted).toBe('accepted'); return true; });
  mount(); await screen.findByRole('button', { name: 'Aceitar' });
  expect(harness.enable).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'Aceitar' }));
  await waitFor(() => expect(harness.page).toHaveBeenCalledWith('/estante'));
  expect(harness.write).toHaveBeenCalledWith('accepted'); expect(harness.enable).toHaveBeenCalledOnce();
  expect(screen.queryByRole('button', { name: 'Aceitar' })).toBeNull();
});
it('recusal never loads the script and review allows a new choice', async () => {
  mount(); await userEvent.click(await screen.findByRole('button', { name: 'Recusar' }));
  expect(harness.persisted).toBe('rejected'); expect(harness.enable).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'Revisar escolha' }));
  expect(screen.getByText(/Escolha atual: Recusado/)).toBeTruthy();
});
it('storage failure fails closed with a retry message', async () => {
  harness.write.mockRejectedValueOnce(new Error('quota'));
  mount(); await userEvent.click(await screen.findByRole('button', { name: 'Aceitar' }));
  expect(await screen.findByRole('alert')).toBeTruthy(); expect(harness.enable).not.toHaveBeenCalled(); expect(harness.disable).toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'Tentar novamente' })); await waitFor(() => expect(harness.enable).toHaveBeenCalledOnce());
});
it('cross-tab invalidation rereads storage; revocation disables and suggests a safe reopen', async () => {
  harness.persisted = 'accepted'; mount(); await waitFor(() => expect(harness.enable).toHaveBeenCalledOnce());
  harness.persisted = 'rejected'; for (const listener of harness.listeners) listener();
  await waitFor(() => expect(screen.getByText('rejected')).toBeTruthy());
  expect(harness.read).toHaveBeenCalledTimes(2); expect(harness.disable).toHaveBeenCalled();
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
  const trigger = screen.getByRole('button', { name: 'Revisar escolha de Analytics' });
  await userEvent.click(trigger);
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Recusar' })));
  await userEvent.click(screen.getByRole('button', { name: 'Fechar' }));
  await waitFor(() => expect(document.activeElement).toBe(trigger));
});
