// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const client = vi.hoisted(() => ({ record: vi.fn() }));
vi.mock('./client', () => ({ recordDiagnostic: client.record }));
import { DiagnosticsProvider, reportRenderFailure } from './DiagnosticsProvider';

beforeEach(() => client.record.mockClear());
afterEach(cleanup);

it('observes runtime exceptions by fixed category without details', async () => {
  render(<DiagnosticsProvider><p>Estante</p></DiagnosticsProvider>);
  window.dispatchEvent(new ErrorEvent('error', { error: new Error('private synthetic detail'), message: 'private synthetic detail' }));
  window.dispatchEvent(new Event('unhandledrejection'));
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(client.record).toHaveBeenCalledWith({ area: 'runtime', code: 'runtime_exception' });
  expect(client.record).toHaveBeenCalledWith({ area: 'runtime', code: 'unhandled_rejection' });
  expect(client.record.mock.calls.flat()).not.toContain('private synthetic detail');
});
it('does not duplicate a render failure as a window exception', async () => {
  render(<DiagnosticsProvider><p>Estante</p></DiagnosticsProvider>);
  reportRenderFailure();
  window.dispatchEvent(new ErrorEvent('error', { error: new Error('synthetic render failure') }));
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(client.record).toHaveBeenCalledExactlyOnceWith({ area: 'runtime', code: 'render_failure' });
});
