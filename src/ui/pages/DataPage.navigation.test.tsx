// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { SyncView } from '../../sync/contracts';
import { prepareMerge, unionPolicy } from '../../sync/merge';
import type { LibraryExport } from '../../backup/schema';
import { AppShell } from '../components/AppShell';
import { DataPage } from './DataPage';

const sync = vi.hoisted(() => ({ state: { status: 'conflict', localCount: 0, remote: [] } as SyncView,
  available: true, local: false, initializing: false,
  coordinator: { prepareResolution: vi.fn(), cancelResolution: vi.fn(), confirmResolution: vi.fn(), resolve: vi.fn() } }));
vi.mock('../../app/SyncProvider', () => ({ useSync: () => sync }));
vi.mock('../../app/LibraryProvider', () => ({ useLibrary: () => ({ positions: new Map() }) }));
vi.mock('../components/BackupPanel', () => ({ BackupPanel: () => <section><h2>Backup local</h2></section> }));
vi.mock('../../experiments/store', () => ({ openExperimentStore: async () => ({ read: async () => ({ experimentsConsent: false, telemetryConsent: false }), close() {} }) }));
const data: LibraryExport = { format: 'livro-a-livro', schemaVersion: 1, exportedAt: '2026-09-26T12:00:00Z', books: [], coverMedia: [], preferences: { shelfYear: null, mode: 'grid', filter: 'all' } };
const scroll = vi.fn();
const originalScroll = HTMLElement.prototype.scrollIntoView;
beforeEach(() => {
  sync.state = { status: 'conflict', localCount: 0, remote: [] };
  HTMLElement.prototype.scrollIntoView = scroll;
  sync.coordinator.prepareResolution.mockResolvedValue(unionPolicy(prepareMerge({ id: 'preview', sources: [
    { id: 'local', library: data }, { id: 'remote', library: { ...data, preferences: { ...data.preferences, mode: 'list' } } },
  ] })).preview);
});
afterEach(() => { cleanup(); vi.clearAllMocks(); HTMLElement.prototype.scrollIntoView = originalScroll; });
function mount(path: string, state?: object) {
  return render(<MemoryRouter initialEntries={[{ pathname: path, state }]}><Routes><Route element={<AppShell />}>
    <Route path="estante" element={<h1>Estante</h1>} /><Route path="dados" element={<DataPage />} />
  </Route></Routes></MemoryRouter>);
}
it.each(['/dados', '/estante'])('reveals conflict choices from %s and on repeated activation without applying a version', async path => {
  mount(path);
  for (let click = 0; click < 2; click++) {
    await userEvent.click(screen.getByRole('link', { name: 'Conferir versões' }));
    const target = screen.getByRole('heading', { name: 'Escolher uma versão' });
    await waitFor(() => expect(document.activeElement).toBe(target));
    expect(scroll.mock.contexts.at(-1)).toBe(target);
    expect(screen.getByRole('button', { name: 'Juntar bibliotecas' })).toBeTruthy();
  }
  expect(sync.coordinator.prepareResolution).not.toHaveBeenCalled();
  expect(sync.coordinator.resolve).not.toHaveBeenCalled();
});
it('keeps a single union confirmation open during repeated detail navigation', async () => {
  mount('/dados');
  await userEvent.click(screen.getByRole('button', { name: 'Juntar bibliotecas' }));
  await userEvent.click(screen.getByRole('link', { name: 'Versões diferentes — ver detalhes' }));
  expect(screen.getAllByRole('alertdialog')).toHaveLength(1);
  expect(screen.getByRole('heading', { name: 'Juntar bibliotecas?' })).toBeTruthy();
  expect(sync.coordinator.prepareResolution).toHaveBeenCalledOnce();
  expect(sync.coordinator.cancelResolution).not.toHaveBeenCalled();
  expect(sync.coordinator.confirmResolution).not.toHaveBeenCalled();
});
it('falls back to Drive details if the conflict has already cleared', async () => {
  sync.state = { status: 'synced' };
  mount('/dados', { focus: 'sync-conflict' });
  const target = screen.getByRole('heading', { name: 'Google Drive opcional' });
  await waitFor(() => expect(document.activeElement).toBe(target));
  expect(scroll.mock.contexts.at(-1)).toBe(target);
});
