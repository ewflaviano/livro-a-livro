// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SyncView } from '../../sync/contracts';
import { MemoryRouter } from 'react-router-dom';
import { GlobalSyncControls, GlobalSyncHeader } from '../components/GlobalSyncControls';
import { DataPage } from './DataPage';
import { LocalePreview } from '../../i18n/context';
const sync = vi.hoisted(() => ({
  state: { status: 'disabled' } as SyncView, available: true, local: false,
  coordinator: { dismissDrivePrompt: vi.fn(async () => {}), connect: vi.fn(async () => {}), authorizeDrive: vi.fn(async () => {}), cancelAuthorization: vi.fn(async () => {}), retryAuthorization: vi.fn(async () => {}), recoveryCopy: vi.fn(async () => null) },
}));
vi.mock('../../app/SyncProvider', () => ({ useSync: () => sync }));
vi.mock('../components/BackupPanel', () => ({ BackupPanel: () => <section><h2>Backup local</h2><button>Exportar JSON</button></section> }));
vi.mock('../components/CatalogPanel', () => ({ CatalogPanel: () => null }));
vi.mock('../../analytics/AnalyticsProvider', () => ({ useAnalytics: () => ({ choice: null, loading: false, error: false, review: vi.fn() }) }));
vi.mock('../../experiments/store', () => ({ openExperimentStore: async () => ({ read: async () => ({ experimentsConsent: false, telemetryConsent: false }), close() {} }) }));
afterEach(() => { cleanup(); vi.clearAllMocks(); sync.state = { status: 'disabled' }; });
describe('optional two-step Google authorization', () => {
  it('requires a separate confirmed action after identity, keeping backup available', async () => {
    const view = render(<MemoryRouter><GlobalSyncControls><DataPage /></GlobalSyncControls></MemoryRouter>);
    await userEvent.click(screen.getByRole('button', { name: 'Entrar com Google' }));
    expect(screen.getByText(/sua biblioteca não será enviada nesta etapa/)).toBeTruthy();
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Entrar com Google' }));
    expect(sync.coordinator.connect).toHaveBeenCalledOnce(); expect(sync.coordinator.authorizeDrive).not.toHaveBeenCalled();
    sync.state = { status: 'authorize-drive' }; view.rerender(<MemoryRouter><GlobalSyncControls><DataPage /></GlobalSyncControls></MemoryRouter>);
    expect(screen.getByText(/Você escolhe se quer sincronizar sua biblioteca com o Drive/)).toBeTruthy();
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
    await userEvent.click(screen.getByText('Gerenciar conexão'));
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
  expect(screen.getByText('Gerenciar conexão')).toBeTruthy();
  screen.getByText('Gerenciar conexão').click();
  expect(screen.getByRole('button', { name: 'Sair e apagar dados deste navegador' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Desconectar Google Drive' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Retomar sincronização' })).toBeNull();
});

it('explains local deletion and unsent changes before logout', async () => {
  sync.state = { status: 'synced', login: { status: 'signed-in', driveAuthorized: true } };
  render(<MemoryRouter><GlobalSyncControls><DataPage /></GlobalSyncControls></MemoryRouter>);
  await userEvent.click(screen.getByText('Gerenciar conexão'));
  await userEvent.click(screen.getByRole('button', { name: 'Sair e apagar dados deste navegador' }));
  const dialog = screen.getByRole('alertdialog');
  expect(dialog.textContent).toContain('alterações ainda não enviadas');
  expect(dialog.textContent).toContain('Faça backup antes');
  expect(dialog.textContent).toContain('outros dispositivos continuarão disponíveis');
});

it('previews English logout consequences before any local deletion', async () => {
  sync.state = { status: 'synced', login: { status: 'signed-in', driveAuthorized: true } };
  render(<LocalePreview locale="en"><MemoryRouter><GlobalSyncControls><DataPage /></GlobalSyncControls></MemoryRouter></LocalePreview>);
  await userEvent.click(screen.getByText('Manage connection'));
  await userEvent.click(screen.getByRole('button', { name: 'Sign out and erase this browser’s data' }));
  const dialog = screen.getByRole('alertdialog');
  expect(dialog.textContent).toContain('changes not yet uploaded');
  expect(dialog.textContent).toContain('Make a backup first');
  expect(dialog.textContent).toContain('Drive files and other devices will remain available');
  expect(sync.coordinator.connect).not.toHaveBeenCalled();
});

it('previews global Drive revocation separately from local logout in English', async () => {
  sync.state = { status: 'synced', login: { status: 'signed-in', driveAuthorized: true } };
  render(<LocalePreview locale="en"><MemoryRouter><GlobalSyncControls><DataPage /></GlobalSyncControls></MemoryRouter></LocalePreview>);
  await userEvent.click(screen.getByText('Manage connection'));
  await userEvent.click(screen.getByRole('button', { name: 'Disconnect Google Drive' }));
  const dialog = screen.getByRole('alertdialog');
  expect(dialog.textContent).toContain('revoked on all devices');
  expect(dialog.textContent).toContain('The local library and existing files will be preserved');
  expect(dialog.textContent).not.toContain('will be erased');
});

it('describes an empty connected Drive without claiming a confirmed backup', () => {
  sync.state = { status: 'connected-empty', login: { status: 'signed-in', driveAuthorized: true } };
  render(<MemoryRouter><GlobalSyncControls><GlobalSyncHeader /><DataPage /></GlobalSyncControls></MemoryRouter>);
  expect(screen.getByText('Drive conectado. Sua biblioteca está vazia; nenhum backup foi enviado.')).toBeTruthy();
  expect(screen.getByText('Drive conectado')).toBeTruthy();
  expect(screen.queryByText(/Cópia confirmada no Google Drive/)).toBeNull();
  expect(screen.getByRole('button', { name: 'Exportar JSON' })).toBeTruthy();
});

it('keeps the recovery copy accessible while paused and login cannot be checked', async () => {
  sync.state = { status: 'paused', login: { status: 'unavailable' } };
  render(<MemoryRouter><GlobalSyncControls><DataPage /></GlobalSyncControls></MemoryRouter>);
  await userEvent.click(screen.getByText('Gerenciar conexão'));
  await userEvent.click(screen.getByRole('button', { name: 'Baixar cópia anterior preservada' }));
  expect(sync.coordinator.recoveryCopy).toHaveBeenCalledOnce();
  expect(screen.getByRole('alert').textContent).toContain('Ainda não há uma cópia anterior preservada');
});
