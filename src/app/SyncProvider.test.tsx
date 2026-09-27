// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterAll, afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => {
  vi.stubEnv('VITE_DRIVE_ENABLED', 'true');
  const state = { status: 'disabled' };
  return { failCompose: false, repository: vi.fn(), start: vi.fn(async () => {}), close: vi.fn(), storeClose: vi.fn(), resolutionClose: vi.fn(),
    coordinator: { start: vi.fn(async () => {}), close: vi.fn(), wake: vi.fn(async () => {}), subscribe: () => () => {}, getSnapshot: () => state } };
});
vi.mock('../adapters/indexeddb/library-repository', () => ({ openLibraryRepository: mocks.repository }));
vi.mock('../adapters/indexeddb/sync-resolution-repository', () => ({ openSyncResolutionRepository: async () => ({ close: mocks.resolutionClose }) }));
vi.mock('../sync/outbox', () => ({ openSyncStore: async () => ({ close: mocks.storeClose }) }));
vi.mock('../sync/api', () => ({ createAuthClient: () => ({}) }));
vi.mock('../sync/drive-client', () => ({ createDriveClient: () => ({}) }));
vi.mock('../sync/coordinator', () => ({ createSyncCoordinator: () => { if (mocks.failCompose) throw new Error('synthetic composition failure'); return mocks.coordinator; } }));
import { SyncProvider, useSync } from './SyncProvider';
function Probe() { const sync = useSync(); return <p>{sync.initializing ? 'Preparando' : sync.coordinator ? 'Pronto' : 'Indisponível'}</p>; }
beforeEach(() => { vi.clearAllMocks(); mocks.failCompose = false; mocks.coordinator.start.mockResolvedValue(undefined); });
afterEach(cleanup);
afterAll(() => vi.unstubAllEnvs());
it('keeps startup distinct from failure until the repository and coordinator finish', async () => {
  let ready = (_: { close: () => void }) => {};
  mocks.repository.mockReturnValue(new Promise(resolve => { ready = resolve; }));
  render(<SyncProvider><Probe /></SyncProvider>);
  expect(screen.getByText('Preparando')).toBeTruthy();
  expect(screen.queryByText('Indisponível')).toBeNull();
  ready({ close: mocks.close });
  expect(await screen.findByText('Pronto')).toBeTruthy();
});
it('reports a real initialization failure while preserving the local UI', async () => {
  mocks.repository.mockRejectedValueOnce(new Error('synthetic unavailable storage'));
  render(<SyncProvider><Probe /><h1>Biblioteca local</h1></SyncProvider>);
  expect(await screen.findByText('Indisponível')).toBeTruthy();
  expect(screen.getByRole('heading', { name: 'Biblioteca local' })).toBeTruthy();
});

it('closes all opened stores if later composition fails', async () => {
  mocks.repository.mockResolvedValueOnce({ close: mocks.close });
  mocks.failCompose = true;
  render(<SyncProvider><Probe /></SyncProvider>);
  expect(await screen.findByText('Indisponível')).toBeTruthy();
  expect(mocks.close).toHaveBeenCalledOnce();
  expect(mocks.storeClose).toHaveBeenCalledOnce();
  expect(mocks.resolutionClose).toHaveBeenCalledOnce();
});
