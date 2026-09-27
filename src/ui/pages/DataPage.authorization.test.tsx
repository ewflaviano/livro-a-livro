// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SyncView } from '../../sync/contracts';
import { MemoryRouter } from 'react-router-dom';
import { GlobalSyncControls } from '../components/GlobalSyncControls';
import { DataPage } from './DataPage';
const sync = vi.hoisted(() => ({
  state: { status: 'disabled' } as SyncView, available: true, local: false,
  coordinator: { dismissDrivePrompt: vi.fn(async () => {}), connect: vi.fn(async () => {}), authorizeDrive: vi.fn(async () => {}), cancelAuthorization: vi.fn(async () => {}), retryAuthorization: vi.fn(async () => {}) },
}));
vi.mock('../../app/SyncProvider', () => ({ useSync: () => sync }));
vi.mock('../components/BackupPanel', () => ({ BackupPanel: () => <section><h2>Backup local</h2><button>Exportar JSON</button></section> }));
vi.mock('../../experiments/store', () => ({ openExperimentStore: async () => ({ read: async () => ({ experimentsConsent: false, telemetryConsent: false }), close() {} }) }));
afterEach(() => { cleanup(); vi.clearAllMocks(); sync.state = { status: 'disabled' }; });
describe('optional two-step Google authorization', () => {
  it('requires a separate confirmed action after identity, keeping backup available', async () => {
    const view = render(<MemoryRouter><GlobalSyncControls><DataPage /></GlobalSyncControls></MemoryRouter>);
    await userEvent.click(screen.getByRole('button', { name: 'Entrar com Google' }));
    expect(screen.getByText(/Ela ainda não autoriza o Drive nem envia sua biblioteca/)).toBeTruthy();
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Entrar com Google' }));
    expect(sync.coordinator.connect).toHaveBeenCalledOnce(); expect(sync.coordinator.authorizeDrive).not.toHaveBeenCalled();
    sync.state = { status: 'authorize-drive' }; view.rerender(<MemoryRouter><GlobalSyncControls><DataPage /></GlobalSyncControls></MemoryRouter>);
    expect(screen.getAllByText(/Você entrou com Google. O Drive ainda não foi autorizado/).length).toBeGreaterThan(0);
    expect((screen.getByRole('button', { name: 'Exportar JSON' }) as HTMLButtonElement).disabled).toBe(false);
    expect(sync.coordinator.authorizeDrive).not.toHaveBeenCalled();
    expect(screen.getByRole('alertdialog')).toBeTruthy();
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Autorizar Drive' }));
    expect(sync.coordinator.authorizeDrive).toHaveBeenCalledOnce();
  });
  it('offers cancellation and retry without making Google necessary for offline backup', async () => {
    sync.state = { status: 'authorization-waiting' }; render(<MemoryRouter><GlobalSyncControls><DataPage /></GlobalSyncControls></MemoryRouter>);
    expect(screen.getByText(/backup continuam disponíveis offline/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Verificar autorização novamente' }));
    expect(sync.coordinator.retryAuthorization).toHaveBeenCalledOnce();
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar autorização' }));
    expect(sync.coordinator.cancelAuthorization).toHaveBeenCalledOnce();
    expect(sync.coordinator.connect).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Exportar JSON' })).toBeTruthy();
  });
});

it('shows unconfirmed logout honestly and offers no global Drive revocation for login-only', () => {
  sync.state = { status: 'paused', login: { status: 'signed-in', driveAuthorized: false }, logoutUnconfirmed: true };
  render(<MemoryRouter><GlobalSyncControls><DataPage /></GlobalSyncControls></MemoryRouter>);
  expect(screen.getByRole('alert').textContent).toContain('A saída não foi confirmada');
  expect(screen.getByRole('button', { name: 'Sair deste navegador' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Desconectar Google Drive' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Retomar sincronização' })).toBeNull();
});
