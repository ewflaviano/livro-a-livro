// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { MergePreview } from './MergePreview';
import type { ResolutionPreview } from '../../sync/merge';
const preview: ResolutionPreview = { id: 'p', totalCount: 8, addedCount: 3, divergentCount: 2, remoteOnlyDivergentCount: 0, remoteSourceCount: 3 };
afterEach(cleanup);
it('shows only a summary and confirms once without user-provided choices', async () => {
  const onConfirm = vi.fn(); render(<MergePreview preview={preview} busy={false} error="" onCancel={vi.fn()} onConfirm={onConfirm} />);
  expect(screen.getAllByRole('alertdialog')).toHaveLength(1);
  expect(screen.getByText('8 livros')).toBeTruthy();
  expect(screen.getByText(/3 adicionados do Drive/)).toBeTruthy();
  expect(screen.getByText(/2 livros têm versões diferentes/)).toBeTruthy();
  expect(screen.getByText(/preferências deste dispositivo serão mantidas/)).toBeTruthy();
  expect(screen.queryByRole('radio')).toBeNull(); expect(screen.queryByRole('checkbox')).toBeNull();
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancelar' }));
  await userEvent.click(screen.getByRole('button', { name: 'Juntar bibliotecas' }));
  expect(onConfirm).toHaveBeenCalledExactlyOnceWith();
});
it('cancels by button or Escape without committing', async () => {
  const cancel = vi.fn(), confirm = vi.fn(); render(<MergePreview preview={preview} busy={false} error="" onCancel={cancel} onConfirm={confirm} />);
  await userEvent.click(screen.getByRole('button', { name: 'Cancelar' })); await userEvent.keyboard('{Escape}');
  expect(cancel).toHaveBeenCalledTimes(2); expect(confirm).not.toHaveBeenCalled();
});
it('warns about remote-only divergence and changed account only when present', () => {
  const props = { preview, busy: false, error: '', onCancel: vi.fn(), onConfirm: vi.fn() };
  const view = render(<MergePreview {...props} />);
  expect(screen.queryByText(/primeira versão do Drive apresentada/)).toBeNull();
  view.rerender(<MergePreview {...props} preview={{ ...preview, remoteOnlyDivergentCount: 1 }} accountChanged />);
  expect(screen.getByText(/primeira versão do Drive apresentada/)).toBeTruthy(); expect(screen.getByText(/conta ou autorização mudou/)).toBeTruthy();
});
it('preserves the error and disables both actions during commit', async () => {
  const cancel = vi.fn(); render(<MergePreview preview={preview} busy error="Não foi possível concluir." onCancel={cancel} onConfirm={vi.fn()} />);
  expect(screen.getByRole('alert').textContent).toContain('Não foi possível');
  expect(screen.getAllByRole('button').every(button => (button as HTMLButtonElement).disabled)).toBe(true);
  await userEvent.keyboard('{Escape}'); expect(cancel).not.toHaveBeenCalled();
});
