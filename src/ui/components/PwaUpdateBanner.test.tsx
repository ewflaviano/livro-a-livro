// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
const pwa = vi.hoisted(() => ({ state: { update: 'available', blocked: false, operationPending: false }, listeners: new Set<() => void>(), apply: vi.fn(async () => {}) }));
vi.mock('../../pwa/register', () => ({ getPwaState: () => pwa.state, subscribePwa: (listener: () => void) => { pwa.listeners.add(listener); return () => pwa.listeners.delete(listener); }, applyPwaUpdate: pwa.apply }));
const occupancy = vi.hoisted(() => ({ count: 0, listeners: new Set<() => void>() }));
vi.mock('../interaction-guard', () => ({ getUiOccupancy: () => occupancy.count, subscribeUiOccupancy: (listener: () => void) => { occupancy.listeners.add(listener); return () => occupancy.listeners.delete(listener); } }));
import { PwaUpdateBanner } from './PwaUpdateBanner';
afterEach(() => { cleanup(); pwa.apply.mockClear(); pwa.state = { update: 'available', blocked: false, operationPending: false }; occupancy.count = 0; });
it('offers a compact top action and reopens an already activated version', async () => {
  const { rerender } = render(<PwaUpdateBanner />);
  await userEvent.click(screen.getByRole('button', { name: 'Atualizar aplicativo' })); expect(pwa.apply).toHaveBeenCalledOnce();
  pwa.state = { ...pwa.state, update: 'reload-ready' }; rerender(<PwaUpdateBanner />);
  expect(screen.getByRole('button', { name: 'Reabrir aplicativo' })).toBeTruthy();
  await userEvent.click(screen.getByRole('button', { name: 'Reabrir aplicativo' })); expect(pwa.apply).toHaveBeenCalledTimes(2);
});
it.each(['blocked', 'operationPending'] as const)('disables update while %s', key => {
  pwa.state = { ...pwa.state, [key]: true }; render(<PwaUpdateBanner />);
  expect((screen.getByRole('button', { name: 'Atualizar aplicativo' }) as HTMLButtonElement).disabled).toBe(true);
});
it('does not cover an open dialog and gives honest multi-tab and failure states', () => {
  occupancy.count = 1; const { rerender } = render(<PwaUpdateBanner />);
  expect((screen.getByRole('button', { name: 'Atualizar aplicativo' }) as HTMLButtonElement).disabled).toBe(true);
  occupancy.count = 0; pwa.state = { ...pwa.state, update: 'other-tabs' }; rerender(<PwaUpdateBanner />);
  expect(screen.getByText(/Feche as outras abas/)).toBeTruthy();
  pwa.state = { ...pwa.state, update: 'failed' }; rerender(<PwaUpdateBanner />);
  expect(screen.getByText(/continuar usando sua estante/)).toBeTruthy();
});
