// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const consent = vi.hoisted(() => ({ value: null as 'accepted' | 'rejected' | null, failed: false, openFailed: false, writeFailed: false,
  writeGate: null as Promise<void> | null, listener: null as (() => void) | null }));
const client = vi.hoisted(() => ({ setEnabled: vi.fn(), record: vi.fn() }));
vi.mock('./consent', () => ({ openDiagnosticsConsentStore: async () => { if (consent.openFailed) throw new Error('synthetic open failure'); return ({
  read: async () => { if (consent.failed) throw new Error('synthetic storage failure'); return consent.value; },
  write: async (value: 'accepted' | 'rejected') => { await consent.writeGate; if (consent.failed || consent.writeFailed) throw new Error('synthetic storage failure'); consent.value = value; },
  subscribe: (listener: () => void) => { consent.listener = listener; return () => { consent.listener = null; }; }, close() {},
}); } }));
vi.mock('./client', () => ({ diagnosticsClient: client, recordDiagnostic: client.record }));
import { DiagnosticsProvider, useDiagnostics } from './DiagnosticsProvider';

function Controls() {
  const value = useDiagnostics();
  return <><p>{value.error ? 'Erro' : value.loading ? 'Carregando' : value.choice ?? 'Desligado'}</p>
    <button onClick={() => void value.choose('accepted')}>Aceitar</button><button onClick={() => void value.choose('rejected')}>Recusar</button>
    <button onClick={value.retry}>Tentar novamente</button></>;
}
beforeEach(() => { consent.value = null; consent.failed = false; consent.openFailed = false; consent.writeFailed = false; consent.writeGate = null;
  consent.listener = null; client.setEnabled.mockClear(); client.record.mockClear(); });
afterEach(cleanup);
it('authorizes only a durable acceptance and stops immediately on rejection', async () => {
  render(<DiagnosticsProvider><Controls /></DiagnosticsProvider>);
  expect(await screen.findByText('Desligado')).toBeTruthy();
  expect(client.setEnabled).not.toHaveBeenCalledWith(true);
  await userEvent.click(screen.getByRole('button', { name: 'Aceitar' }));
  expect(await screen.findByText('accepted')).toBeTruthy(); expect(client.setEnabled).toHaveBeenLastCalledWith(true);
  await userEvent.click(screen.getByRole('button', { name: 'Recusar' }));
  expect(await screen.findByText('rejected')).toBeTruthy(); expect(client.setEnabled).toHaveBeenLastCalledWith(false);
});
it('revokes on another tab invalidation and fails closed when IndexedDB cannot be read', async () => {
  consent.value = 'accepted'; render(<DiagnosticsProvider><Controls /></DiagnosticsProvider>);
  expect(await screen.findByText('accepted')).toBeTruthy(); expect(client.setEnabled).toHaveBeenLastCalledWith(true);
  consent.value = 'rejected'; await act(async () => { consent.listener?.(); });
  expect(screen.getByText('rejected')).toBeTruthy(); expect(client.setEnabled).toHaveBeenLastCalledWith(false);
  consent.failed = true; await act(async () => { consent.listener?.(); });
  expect(screen.getByText('Erro')).toBeTruthy(); expect(client.setEnabled).toHaveBeenLastCalledWith(false);
});
it('keeps sending disabled after a failed revocation, even if focus rereads the old acceptance', async () => {
  consent.value = 'accepted'; render(<DiagnosticsProvider><Controls /></DiagnosticsProvider>);
  expect(await screen.findByText('accepted')).toBeTruthy();
  consent.writeFailed = true; await userEvent.click(screen.getByRole('button', { name: 'Recusar' }));
  expect(screen.getByText('Erro')).toBeTruthy(); expect(client.setEnabled).toHaveBeenLastCalledWith(false);
  await act(async () => { consent.listener?.(); });
  expect(screen.getByText('Erro')).toBeTruthy(); expect(client.setEnabled).toHaveBeenLastCalledWith(false);
});
it.each(['accepted', 'rejected'] as const)('settles a %s write before a competing focus read', async (next) => {
  consent.value = next === 'rejected' ? 'accepted' : null;
  render(<DiagnosticsProvider><Controls /></DiagnosticsProvider>);
  expect(await screen.findByText(next === 'rejected' ? 'accepted' : 'Desligado')).toBeTruthy();
  let release!: () => void; consent.writeGate = new Promise<void>(resolve => { release = resolve; });
  await userEvent.click(screen.getByRole('button', { name: next === 'rejected' ? 'Recusar' : 'Aceitar' }));
  await act(async () => { window.dispatchEvent(new Event('focus')); });
  await act(async () => { release(); });
  expect(await screen.findByText(next)).toBeTruthy();
  expect(client.setEnabled).toHaveBeenLastCalledWith(next === 'accepted');
});
it('remembers a rejection attempted while consent storage is unavailable', async () => {
  consent.value = 'accepted'; consent.openFailed = true;
  render(<DiagnosticsProvider><Controls /></DiagnosticsProvider>);
  expect(await screen.findByText('Erro')).toBeTruthy();
  await userEvent.click(screen.getByRole('button', { name: 'Recusar' }));
  consent.openFailed = false;
  await userEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
  expect(await screen.findByText('rejected')).toBeTruthy();
  expect(client.setEnabled).toHaveBeenLastCalledWith(false);
});
it('records browser exceptions by fixed category without their details', async () => {
  consent.value = 'accepted'; render(<DiagnosticsProvider><Controls /></DiagnosticsProvider>);
  expect(await screen.findByText('accepted')).toBeTruthy();
  await act(async () => {
    window.dispatchEvent(new ErrorEvent('error', { error: new Error('private synthetic detail'), message: 'private synthetic detail' }));
    window.dispatchEvent(new Event('unhandledrejection'));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(client.record).toHaveBeenCalledWith({ area: 'runtime', code: 'runtime_exception' });
  expect(client.record).toHaveBeenCalledWith({ area: 'runtime', code: 'unhandled_rejection' });
  expect(client.record.mock.calls.flat()).not.toContain('private synthetic detail');
});
