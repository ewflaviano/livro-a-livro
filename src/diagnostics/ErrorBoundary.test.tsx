// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
const report = vi.hoisted(() => vi.fn());
vi.mock('./DiagnosticsProvider', () => ({ reportRenderFailure: report }));
import { ErrorBoundary } from './ErrorBoundary';
afterEach(() => { cleanup(); vi.restoreAllMocks(); report.mockClear(); });
it('shows a recoverable fallback and reports one fixed render category', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  let fail = true;
  function Content() { if (fail) throw new Error('PRIVATE synthetic detail'); return <p>Página pronta</p>; }
  render(<ErrorBoundary><Content /></ErrorBoundary>);
  expect(screen.getByRole('alert').textContent).toContain('Não foi possível mostrar esta página.');
  expect(document.activeElement).toBe(screen.getByRole('alert'));
  expect(report).toHaveBeenCalledOnce();
  fail = false; await userEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
  expect(screen.getByText('Página pronta')).toBeTruthy();
});
