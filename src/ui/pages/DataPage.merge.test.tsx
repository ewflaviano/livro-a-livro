// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { SyncView } from '../../sync/contracts';
import { prepareMerge, unionPolicy, type ResolutionPreview } from '../../sync/merge';
import type { LibraryExport } from '../../backup/schema';
import { DataPage } from './DataPage';
import { GlobalSyncControls } from '../components/GlobalSyncControls';
const sync = vi.hoisted(() => ({ state: { status: 'conflict', localCount: 0, remote: [] } as SyncView, available: true, local: false,
  coordinator: { prepareResolution: vi.fn<() => Promise<ResolutionPreview>>(), cancelResolution: vi.fn(), confirmResolution: vi.fn(async () => 'localCommittedPending'), resolve: vi.fn() } }));
vi.mock('../../app/SyncProvider', () => ({ useSync: () => sync }));
vi.mock('../components/BackupPanel', () => ({ BackupPanel: () => <section><h2>Backup local</h2></section> }));
vi.mock('../../experiments/store', () => ({ openExperimentStore: async () => ({ read: async () => ({ experimentsConsent: false, telemetryConsent: false }), close() {} }) }));
const data: LibraryExport = { format: 'livro-a-livro', schemaVersion: 1, exportedAt: '2026-09-26T12:00:00Z', books: [], coverMedia: [], preferences: { shelfYear: null, mode: 'grid', filter: 'all' } };
const preview = () => unionPolicy(prepareMerge({ id: 'preview', sources: [{ id: 'local', library: data }, { id: 'remote', library: data }] })).preview;
const mount = () => render(<MemoryRouter><GlobalSyncControls><DataPage /></GlobalSyncControls></MemoryRouter>);
beforeEach(() => { sync.coordinator.prepareResolution.mockResolvedValue(preview()); sync.coordinator.confirmResolution.mockResolvedValue('localCommittedPending'); });
afterEach(() => { cleanup(); vi.clearAllMocks(); });
it('cancels a late preparation without showing or applying it, then allows a fresh preview', async () => {
  let release!: (value: ResolutionPreview) => void; sync.coordinator.prepareResolution.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  mount(); await userEvent.click(screen.getByRole('button', { name: 'Juntar bibliotecas' }));
  await userEvent.click(screen.getByRole('button', { name: 'Cancelar preparação' }));
  await act(async () => release(preview()));
  expect(sync.coordinator.cancelResolution).toHaveBeenCalledWith('preview'); expect(screen.queryByRole('heading', { name: 'Juntar bibliotecas?' })).toBeNull();
  expect(sync.coordinator.confirmResolution).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'Juntar bibliotecas' }));
  expect(screen.getByRole('heading', { name: 'Juntar bibliotecas?' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Manter biblioteca local' })).toBeNull();
  expect(screen.getByRole('heading', { name: 'Backup local' })).toBeTruthy();
  await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
  expect(screen.getByRole('button', { name: 'Manter biblioteca local' })).toBeTruthy();
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Juntar bibliotecas' }));
});
it('cancels preparation that completes after unmount', async () => {
  let release!: (value: ResolutionPreview) => void; sync.coordinator.prepareResolution.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const rendered = mount(); await userEvent.click(screen.getByRole('button', { name: 'Juntar bibliotecas' })); rendered.unmount();
  await act(async () => release(preview())); expect(sync.coordinator.cancelResolution).toHaveBeenCalledWith('preview'); expect(sync.coordinator.confirmResolution).not.toHaveBeenCalled();
});
it('reports a committed local union with pending upload honestly', async () => {
  mount(); await userEvent.click(screen.getByRole('button', { name: 'Juntar bibliotecas' }));
  await userEvent.click(screen.getByRole('button', { name: 'Juntar bibliotecas' }));
  expect(sync.coordinator.confirmResolution).toHaveBeenCalledWith('preview');
  expect(screen.getByText(/Bibliotecas unidas e salvas neste dispositivo; envio pendente/)).toBeTruthy();
  expect(screen.queryByRole('heading', { name: 'Juntar bibliotecas?' })).toBeNull();
});
it('keeps the summary visible on failed confirmation and whole-library options on failed preparation', async () => {
  sync.coordinator.prepareResolution.mockRejectedValueOnce(new Error('budget'));
  mount(); await userEvent.click(screen.getByRole('button', { name: 'Juntar bibliotecas' }));
  expect(screen.getByRole('alert').textContent).toContain('100 MiB'); expect((screen.getByRole('button', { name: 'Manter biblioteca local' }) as HTMLButtonElement).disabled).toBe(false);
  sync.coordinator.confirmResolution.mockRejectedValueOnce(new Error('stale'));
  await userEvent.click(screen.getByRole('button', { name: 'Juntar bibliotecas' })); await userEvent.click(screen.getByRole('button', { name: 'Juntar bibliotecas' }));
  expect(screen.getByRole('heading', { name: 'Juntar bibliotecas?' })).toBeTruthy(); expect(screen.getByRole('alert').textContent).toContain('cancele e prepare uma nova prévia');
});

it('ignores a confirmation response after leaving and cancels only the captured plan', async () => {
  let release!: (value: string) => void;
  sync.coordinator.confirmResolution.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const rendered = mount(); await userEvent.click(screen.getByRole('button', { name: 'Juntar bibliotecas' }));
  await userEvent.click(screen.getByRole('button', { name: 'Juntar bibliotecas' }));
  rendered.unmount();
  expect(sync.coordinator.cancelResolution).toHaveBeenCalledWith('preview');
  await act(async () => release('synchronized'));
  expect(screen.queryByText(/Bibliotecas unidas/)).toBeNull();
  expect(sync.coordinator.confirmResolution).toHaveBeenCalledExactlyOnceWith('preview');
});
