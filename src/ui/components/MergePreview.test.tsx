// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createBook } from '../../domain/book';
import type { LibraryExport } from '../../backup/schema';
import { prepareMerge } from '../../sync/merge';
import { MergePreview } from './MergePreview';
import { getUiOccupancy } from '../interaction-guard';
import { encodedCover } from '../../../test/fixtures/covers/helpers';
const now = '2026-09-26T12:00:00Z';
const library = (count = 1): LibraryExport => ({ format: 'livro-a-livro', schemaVersion: 1, exportedAt: now, preferences: { shelfYear: null, mode: 'grid', filter: 'all' }, coverMedia: [], books: Array.from({ length: count }, (_, n) => createBook({ title: `Livro ${n + 1}`, authors: ['Autoria'], status: 'read' }, { now, id: `abcdef00-0000-4000-8000-${String(n + 1).padStart(12, '0')}`, shelfYear: 2026 })) });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); expect(getUiOccupancy()).toBe(0); });
it('requires whole-book and preferences decisions then an explicit final confirmation', async () => {
  const a = library(), b = library(); b.books[0].note = 'Nota diferente'; b.preferences.mode = 'list';
  const preview = prepareMerge({ id: 'p', sources: [{ id: 'local', library: a }, { id: 'remote', label: 'Drive B', library: b }] }).preview;
  const onConfirm = vi.fn(); render(<MergePreview preview={preview} busy={false} error="" onCancel={vi.fn()} onConfirm={onConfirm} />);
  expect((screen.getByRole('button', { name: 'Revisar e juntar' }) as HTMLButtonElement).disabled).toBe(true);
  await userEvent.click(screen.getByRole('radio', { name: 'Usar Drive B' }));
  await userEvent.click(screen.getByRole('radio', { name: /Preferências deste dispositivo/ }));
  await userEvent.click(screen.getByRole('button', { name: 'Revisar e juntar' }));
  expect(onConfirm).not.toHaveBeenCalled();
  await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Confirmar união' }));
  expect(onConfirm).toHaveBeenCalledWith({ books: [{ bookId: a.books[0].id, sourceId: 'remote' }], preferencesSourceId: 'local', includeUnbased: false });
});
it('paginates without losing choices and supports an explicit batch preference', async () => {
  const preview = prepareMerge({ id: 'p', sources: [{ id: 'local', library: library(11) }, { id: 'remote', library: library(11) }] }).preview;
  render(<MergePreview preview={preview} busy={false} error="" onCancel={vi.fn()} onConfirm={vi.fn()} />);
  expect(screen.queryByRole('group', { name: 'Livro 11: Livro 11' })).toBeNull();
  await userEvent.click(within(screen.getByRole('group', { name: 'Livro 1: Livro 1' })).getByRole('radio', { name: 'Excluir este livro da união' }));
  await userEvent.click(screen.getByRole('button', { name: 'Próxima página' }));
  expect(screen.getByRole('group', { name: 'Livro 11: Livro 11' })).toBeTruthy();
  await userEvent.click(screen.getByRole('button', { name: 'Página anterior' }));
  expect((within(screen.getByRole('group', { name: 'Livro 1: Livro 1' })).getByRole('radio', { name: 'Excluir este livro da união' }) as HTMLInputElement).checked).toBe(true);
  await userEvent.click(screen.getByText('Escolher vários livros de uma versão'));
  await userEvent.click(screen.getByRole('button', { name: 'Preferir livros deste dispositivo' }));
  expect(screen.getByRole('alertdialog').textContent).toContain('11 livros');
  await userEvent.click(screen.getByRole('button', { name: 'Aplicar preferência' }));
  expect((within(screen.getByRole('group', { name: 'Livro 1: Livro 1' })).getByRole('radio', { name: 'Usar versão deste dispositivo' }) as HTMLInputElement).checked).toBe(true);
});
it('requires unbased absence acknowledgement and supports Escape without saving', async () => {
  const preview = prepareMerge({ id: 'p', sources: [{ id: 'local', library: library() }, { id: 'remote', library: library(0) }] }).preview;
  const cancel = vi.fn(), confirm = vi.fn(); render(<MergePreview preview={preview} busy={false} error="" onCancel={cancel} onConfirm={confirm} />);
  expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Prévia da união' }));
  expect((screen.getByRole('button', { name: 'Revisar e juntar' }) as HTMLButtonElement).disabled).toBe(true);
  await userEvent.click(screen.getByRole('checkbox'));
  expect((screen.getByRole('button', { name: 'Revisar e juntar' }) as HTMLButtonElement).disabled).toBe(false);
  await userEvent.keyboard('{Escape}'); expect(cancel).toHaveBeenCalledOnce(); expect(confirm).not.toHaveBeenCalled();
});
it('uses source-local cover bytes and revokes object URLs on unmount without any external fetch', async () => {
  const data = library(); data.coverMedia = [encodedCover()]; data.books[0].cover = { provider: 'local', mediaId: encodedCover().id };
  const create = vi.fn(() => 'blob:preview'), revoke = vi.fn(); vi.stubGlobal('URL', class extends URL { static createObjectURL = create; static revokeObjectURL = revoke; }); vi.stubGlobal('fetch', vi.fn());
  const preview = prepareMerge({ id: 'p', sources: [{ id: 'local', library: data }] }).preview;
  const rendered = render(<MergePreview preview={preview} busy={false} error="" onCancel={vi.fn()} onConfirm={vi.fn()} />);
  expect(create).not.toHaveBeenCalled(); await userEvent.click(screen.getByText('Ver livro completo'));
  expect(create).toHaveBeenCalledOnce(); expect(fetch).not.toHaveBeenCalled(); rendered.unmount(); expect(revoke).toHaveBeenCalledWith('blob:preview');
});
