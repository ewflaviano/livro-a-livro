// @vitest-environment jsdom
import { StrictMode } from 'react';
import { cleanup, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ choice: 'accepted' as 'accepted' | 'rejected' }));
vi.mock('./consent', () => ({ openAnalyticsConsentStore: async () => ({ read: async () => fixture.choice, write: async () => {}, subscribe: () => () => {}, close() {} }) }));
vi.mock('../pwa/register', () => ({ getPwaState: () => ({ blocked: false, update: 'none' }) }));
vi.mock('../ui/interaction-guard', () => ({ getUiOccupancy: () => 0 }));
import { AnalyticsProvider } from './AnalyticsProvider';
afterEach(() => { cleanup(); document.cookie = '_ga=; Max-Age=0; Path=/'; document.head.querySelectorAll('script[src*="googletagmanager"]').forEach(node => node.remove()); });
it('preserves an accepted GA cookie across StrictMode remount and clears it only on rejection', async () => {
  document.cookie = '_ga=synthetic; Path=/'; document.cookie = '_ga_TEST=synthetic; Path=/';
  fixture.choice = 'accepted';
  const first = render(<StrictMode><MemoryRouter initialEntries={['/estante']}><AnalyticsProvider><p>Estante sintética</p></AnalyticsProvider></MemoryRouter></StrictMode>);
  await waitFor(() => expect(document.querySelector('script[src*="googletagmanager"]')).toBeTruthy());
  expect(document.cookie).toContain('_ga=synthetic'); expect(document.cookie).toContain('_ga_TEST=synthetic');
  first.unmount();
  expect(document.cookie).toContain('_ga=synthetic');
  fixture.choice = 'rejected';
  render(<MemoryRouter initialEntries={['/estante']}><AnalyticsProvider><p>Estante sintética</p></AnalyticsProvider></MemoryRouter>);
  await waitFor(() => expect(document.cookie).not.toContain('_ga=synthetic'));
  expect(document.cookie).not.toContain('_ga_TEST=synthetic');
});
