// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';

const pwa = vi.hoisted(() => ({ state: { update: 'available', blocked: false, operationPending: false }, listeners: new Set<() => void>(), apply: vi.fn(async () => {}) }));
vi.mock('../../pwa/register', () => ({ getPwaState: () => pwa.state, subscribePwa: (listener: () => void) => { pwa.listeners.add(listener); return () => pwa.listeners.delete(listener); }, applyPwaUpdate: pwa.apply }));
const occupancy = vi.hoisted(() => ({ count: 0, listeners: new Set<() => void>() }));
vi.mock('../interaction-guard', () => ({ getUiOccupancy: () => occupancy.count, subscribeUiOccupancy: (listener: () => void) => { occupancy.listeners.add(listener); return () => occupancy.listeners.delete(listener); } }));
import { PwaUpdateBanner } from './PwaUpdateBanner';

function setPwa(patch: Partial<typeof pwa.state>) {
  act(() => { pwa.state = { ...pwa.state, ...patch }; pwa.listeners.forEach(listener => listener()); });
}
function setOccupancy(count: number) {
  act(() => { occupancy.count = count; occupancy.listeners.forEach(listener => listener()); });
}
afterEach(() => {
  cleanup(); pwa.apply.mockClear(); pwa.state = { update: 'available', blocked: false, operationPending: false };
  pwa.listeners.clear(); occupancy.count = 0; occupancy.listeners.clear();
});

it('offers the available action and reopens an activated version', async () => {
  render(<PwaUpdateBanner />);
  await userEvent.click(screen.getByRole('button', { name: 'Atualizar aplicativo' }));
  expect(pwa.apply).toHaveBeenCalledOnce();
  setPwa({ update: 'reload-ready' });
  await userEvent.click(screen.getByRole('button', { name: 'Reabrir aplicativo' }));
  expect(pwa.apply).toHaveBeenCalledTimes(2);
});

it.each(['blocked', 'operationPending'] as const)('hides an available update during %s and reveals it on release', async key => {
  pwa.state = { ...pwa.state, [key]: true };
  render(<PwaUpdateBanner />);
  expect(screen.queryByRole('region', { name: 'Atualização do aplicativo' })).toBeNull();
  setPwa({ [key]: false });
  await userEvent.click(screen.getByRole('button', { name: 'Atualizar aplicativo' }));
  expect(pwa.apply).toHaveBeenCalledOnce();
});

it('hides the invitation during a dialog and reappears without a new check', () => {
  render(<PwaUpdateBanner />);
  setOccupancy(1);
  expect(screen.queryByRole('region', { name: 'Atualização do aplicativo' })).toBeNull();
  setOccupancy(0);
  expect(screen.getByRole('button', { name: 'Atualizar aplicativo' })).toBeTruthy();
});

it('holds reload-ready while blocked and offers explicit reopening after release', async () => {
  render(<PwaUpdateBanner />);
  setPwa({ update: 'reload-ready', blocked: true });
  expect(screen.queryByRole('region', { name: 'Atualização do aplicativo' })).toBeNull();
  expect(pwa.apply).not.toHaveBeenCalled();
  setPwa({ blocked: false });
  expect(screen.getByRole('button', { name: 'Reabrir aplicativo' })).toBeTruthy();
  expect(pwa.apply).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'Reabrir aplicativo' }));
  expect(pwa.apply).toHaveBeenCalledOnce();
});

it('keeps progress visible if a blocker appears after applying starts', () => {
  render(<PwaUpdateBanner />);
  setPwa({ update: 'applying', blocked: true, operationPending: true });
  setOccupancy(1);
  expect(screen.getByRole('status').textContent).toBe('Atualizando o aplicativo…');
  expect(screen.queryByRole('button')).toBeNull();
});

it.each([
  ['other-tabs', /Feche as outras abas/],
  ['failed', /continuar usando sua estante/],
] as const)('preserves %s explanation until blockers release and retry is safe', async (update, message) => {
  render(<PwaUpdateBanner />);
  setPwa({ update, operationPending: true });
  expect(screen.queryByRole('region', { name: 'Atualização do aplicativo' })).toBeNull();
  setPwa({ operationPending: false });
  expect(screen.getByRole('status').textContent).toMatch(message);
  await userEvent.click(screen.getByRole('button', { name: 'Atualizar aplicativo' }));
  expect(pwa.apply).toHaveBeenCalledOnce();
});

it('does not announce initial installation as an update', () => {
  pwa.state = { ...pwa.state, update: 'none' };
  render(<PwaUpdateBanner />);
  expect(screen.queryByRole('region', { name: 'Atualização do aplicativo' })).toBeNull();
});
