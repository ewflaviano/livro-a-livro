// @vitest-environment jsdom
import { useState, type ReactNode } from 'react';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import type { SyncView } from '../../sync/contracts';
import { blockPwaUpdate, getPwaState } from '../../pwa/register';
import { getUiOccupancy } from '../interaction-guard';
import { GlobalSyncControls, GlobalSyncHeader, GlobalSyncAttention } from './GlobalSyncControls';
import { ConfirmDialog } from './ConfirmDialog';
import { BookForm } from './BookForm';
import type { LibraryService } from '../../services/library-service';
const sync = vi.hoisted(() => ({
  state: { status: 'disabled' } as SyncView, available: true, local: false, initializing: false,
  coordinator: { dismissDrivePrompt: vi.fn(async () => {}), connect: vi.fn(async () => {}), authorizeDrive: vi.fn(async () => {}), retryDriveAuthorization: vi.fn(async () => {}) },
}));
vi.mock('../../app/SyncProvider', () => ({ useSync: () => sync }));
afterEach(() => { cleanup(); expect(getUiOccupancy()).toBe(0); expect(getPwaState().blocked).toBe(false); vi.clearAllMocks(); sync.state = { status: 'disabled' }; sync.available = true; sync.initializing = false; });
function Shell({ children }: { children?: ReactNode }) {
  return <MemoryRouter><GlobalSyncControls><GlobalSyncHeader /><GlobalSyncAttention />{children}</GlobalSyncControls></MemoryRouter>;
}
it('offers global support/settings and a confirmed sign-in without automatic Drive consent', async () => {
  const view = render(<Shell />);
  expect(screen.getByRole('link', { name: 'Apoiar' }).getAttribute('href')).toBe('/apoiar');
  expect(screen.getByRole('link', { name: 'Abrir configurações' }).getAttribute('href')).toBe('/configuracoes');
  const login = screen.getByRole('button', { name: 'Entrar com Google' });
  await userEvent.click(login);
  const dialog = within(screen.getByRole('alertdialog'));
  expect(document.activeElement).toBe(dialog.getByRole('button', { name: 'Cancelar' }));
  await userEvent.click(dialog.getByRole('button', { name: 'Entrar com Google' }));
  expect(sync.coordinator.connect).toHaveBeenCalledOnce();
  sync.state = { status: 'authorize-drive' }; view.rerender(<Shell />);
  // The return invites, but never grants permission on its own.
  expect(screen.getByRole('alertdialog')).toBeTruthy();
  expect(sync.coordinator.authorizeDrive).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'Agora não' }));
  expect(screen.queryByRole('alertdialog')).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'Autorizar Drive' }));
  await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Autorizar Drive' }));
  expect(sync.coordinator.authorizeDrive).toHaveBeenCalledOnce();
});
it('does not pretend Google sign-in is available with the flag disabled', () => {
  sync.available = false; render(<Shell />);
  expect(screen.getByRole('link', { name: 'Google indisponível — ver detalhes' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Entrar com Google' })).toBeNull();
  expect(sync.coordinator.connect).not.toHaveBeenCalled();
});
it.each([
  ['synced', 'Drive atualizado'], ['syncing', 'Sincronizando…'], ['pending', 'Envio pendente'],
  ['offline', 'Drive offline'], ['paused', 'Drive pausado'], ['reconnect', 'Reconectar Google'],
  ['conflict', 'Versões diferentes'], ['error', 'Falha no Drive'], ['quota', 'Drive sem espaço'],
] as const)('shows %s in the persistent header', (status, label) => {
  sync.state = { status }; render(<Shell />);
  expect(within(screen.getByRole('navigation', { name: 'Conta e opções' })).getByText(label)).toBeTruthy();
});
it('defers attention while retaining the header, and resurfaces new conflicts/transitions', async () => {
  sync.state = { status: 'conflict', remote: [{ snapshotId: 'a', count: 1, createdAt: '2026-01-01' }] };
  const view = render(<Shell />);
  await userEvent.click(screen.getByRole('button', { name: 'Decidir depois' }));
  expect(screen.queryByRole('complementary')).toBeNull(); expect(screen.getByText('Versões diferentes')).toBeTruthy();
  sync.state = { ...sync.state, remote: [{ snapshotId: 'b', count: 1, createdAt: '2026-01-01' }] }; view.rerender(<Shell />);
  expect(screen.getByRole('link', { name: 'Conferir versões' })).toBeTruthy();
  sync.state = { status: 'error' }; view.rerender(<Shell />);
  await userEvent.click(screen.getByRole('button', { name: 'Decidir depois' }));
  sync.state = { status: 'synced' }; view.rerender(<Shell />);
  sync.state = { status: 'error' }; view.rerender(<Shell />);
  expect(screen.getByRole('link', { name: 'Ver detalhes' })).toBeTruthy();
});
it('defers invitation through another dialog and restores focus when dismissed', async () => {
  sync.state = { status: 'authorize-drive' };
  function Existing() { const [open, setOpen] = useState(true); return <><button>Voltar à leitura</button>{open && <ConfirmDialog title="Outra decisão" confirmLabel="Confirmar" onCancel={() => setOpen(false)} onConfirm={() => setOpen(false)}>Uma operação local</ConfirmDialog>}</>; }
  render(<Shell><Existing /></Shell>);
  expect(screen.getAllByRole('alertdialog')).toHaveLength(1);
  expect(screen.getByRole('heading', { name: 'Outra decisão' })).toBeTruthy();
  await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
  expect(screen.getAllByRole('alertdialog')).toHaveLength(1);
  expect(screen.getByRole('heading', { name: 'Guardar sua biblioteca no Drive?' })).toBeTruthy();
  await userEvent.click(screen.getByRole('button', { name: 'Agora não' }));
  expect(screen.queryByRole('alertdialog')).toBeNull();
});
it('preserves a real form and waits for its removal, even before it is dirty', async () => {
  sync.state = { status: 'authorize-drive' };
  const form = <BookForm year={2026} version={{ generation: 'synthetic', revision: 0 }} service={{} as LibraryService} onSaved={() => {}} onCancel={() => {}} onReload={() => {}} />;
  const view = render(<Shell>{form}</Shell>);
  expect(screen.queryByRole('alertdialog')).toBeNull();
  const title = screen.getByRole('textbox', { name: 'Título (obrigatório)' });
  await userEvent.type(title, 'Rascunho sintético');
  await userEvent.click(screen.getByRole('button', { name: 'Autorizar Drive' }));
  expect((title as HTMLInputElement).value).toBe('Rascunho sintético');
  expect(sync.coordinator.authorizeDrive).not.toHaveBeenCalled();
  view.rerender(<Shell />);
  expect(screen.getByRole('alertdialog')).toBeTruthy();
});
it('waits for backup/PWA blockers and closes an invitation if a blocker arrives', async () => {
  const release = blockPwaUpdate();
  sync.state = { status: 'authorize-drive' }; render(<Shell />);
  expect(screen.queryByRole('alertdialog')).toBeNull();
  act(release);
  expect(screen.getByRole('alertdialog')).toBeTruthy();
  let next = () => {};
  act(() => { next = blockPwaUpdate(); });
  expect(screen.queryByRole('alertdialog')).toBeNull();
  act(next);
  expect(screen.getByRole('alertdialog')).toBeTruthy();
});
it('keeps errors inside the confirmation and allows an explicit retry', async () => {
  sync.coordinator.connect.mockRejectedValueOnce(new Error('synthetic'));
  render(<Shell />);
  await userEvent.click(screen.getByRole('button', { name: 'Entrar com Google' }));
  await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Entrar com Google' }));
  expect((await screen.findByRole('alert')).textContent).toContain('biblioteca local foi preservada');
  expect(screen.getByRole('alertdialog')).toBeTruthy();
  await userEvent.keyboard('{Escape}');
  expect(screen.queryByRole('alertdialog')).toBeNull();
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Entrar com Google' }));
});

it('distinguishes connector startup from an unavailable connection', () => {
  sync.initializing = true; render(<Shell />);
  expect(screen.getByText('Preparando conexão…')).toBeTruthy();
  expect(screen.queryByText('Drive indisponível')).toBeNull();
  expect(sync.coordinator.connect).not.toHaveBeenCalled();
});

it('yields an open invitation to a newly mounted dialog without competing focus traps', async () => {
  sync.state = { status: 'authorize-drive' };
  const view = render(<Shell />);
  expect(screen.getByRole('heading', { name: 'Guardar sua biblioteca no Drive?' })).toBeTruthy();
  view.rerender(<Shell><ConfirmDialog title="Operação local prioritária" confirmLabel="Concluir" onCancel={() => {}} onConfirm={() => {}}>Revisar antes de continuar.</ConfirmDialog></Shell>);
  expect(screen.getAllByRole('alertdialog')).toHaveLength(1);
  expect(screen.getByRole('heading', { name: 'Operação local prioritária' })).toBeTruthy();
  expect(document.activeElement).toBe(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Cancelar' }));
  view.rerender(<Shell />);
  expect(screen.getAllByRole('alertdialog')).toHaveLength(1);
  await userEvent.click(screen.getByRole('button', { name: 'Agora não' }));
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Autorizar Drive' }));
});

it('keeps a persisted dismissal while offering explicit Drive activation for login-only', () => {
  sync.state = { status: 'authorize-drive', login: { status: 'signed-in', signInAttemptId: 'synthetic', driveAuthorized: false }, drivePromptDismissed: true };
  render(<Shell />);
  expect(screen.queryByRole('alertdialog')).toBeNull();
  expect(screen.getByText('Google conectado')).toBeTruthy();
  expect(screen.getByRole('button', { name: /Autorizar Drive/ })).toBeTruthy();
  expect(sync.coordinator.authorizeDrive).not.toHaveBeenCalled();
});
