// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { openLibraryRepository } from '../../adapters/indexeddb/library-repository';
import { createBook, type Book } from '../../domain/book';
import { DomainError } from '../../domain/errors';
import { createShelfService } from '../../services/shelf-service';
import { AppRoutes } from '../../app/router';

const synthetic = (patch: Partial<Book> = {}) => createBook({ title: 'Livro de teste', ...patch }, {
  id: crypto.randomUUID(), now: '2026-09-26T12:00:00.000Z', shelfYear: 2026,
});
beforeEach(() => { vi.stubGlobal('fetch', vi.fn()); vi.spyOn(window, 'scrollTo').mockImplementation(() => {}); });
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
async function setup(books: Book[] = [], route = '/adicionar') {
  const repository = await openLibraryRepository({ name: crypto.randomUUID(), channelFactory: null });
  await repository.commit({ kind: 'replace', books }, await repository.readRevision());
  await repository.updatePreferences({ shelfYear: 2026 });
  const service = createShelfService(repository);
  render(<MemoryRouter initialEntries={[route]}><AppRoutes openService={async () => service} /></MemoryRouter>);
  return { repository, service };
}
const titleField = () => screen.getByRole('textbox', { name: 'Título (obrigatório)' });

describe('manual books and private detail', () => {
  it('adds quickly with only a title and shows the committed local detail', async () => {
    const { repository } = await setup();
    await screen.findByRole('textbox', { name: 'Título (obrigatório)' });
    await userEvent.click(screen.getByRole('button', { name: 'Salvar livro' }));
    expect(await screen.findByText('Informe um título com até 500 caracteres.')).toBeTruthy();
    expect(document.activeElement).toBe(titleField());
    await userEvent.type(titleField(), 'Leitura manual');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar livro' }));
    expect(await screen.findByRole('heading', { name: 'Leitura manual' })).toBeTruthy();
    expect(await screen.findByText('Livro salvo neste dispositivo.')).toBeTruthy();
    expect((await repository.readAll()).books[0]).toMatchObject({ title: 'Leitura manual', status: 'want-to-read', shelfYear: 2026, authors: [], finishedOn: null });
  });
  it('keeps incompatible dates visible and lets the user correct status and shelf year explicitly', async () => {
    const { repository } = await setup();
    await screen.findByRole('textbox', { name: 'Título (obrigatório)' });
    await userEvent.type(titleField(), 'Uma leitura');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Estado' }), 'read');
    fireEvent.change(screen.getByLabelText('Terminei em (opcional)'), { target: { value: '2025-03-12' } });
    await userEvent.click(screen.getByRole('button', { name: 'Salvar livro' }));
    expect(await screen.findByText(/Use um ano de 1 a 9999/)).toBeTruthy();
    expect((await repository.readAll()).books).toEqual([]);
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Estado' }), 'reading');
    expect((screen.getByLabelText('Terminei em (opcional)') as HTMLInputElement).value).toBe('2025-03-12');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar livro' }));
    expect(await screen.findByText(/Confira a data de término/)).toBeTruthy();
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Estado' }), 'read');
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Ano da estante' }), { target: { value: '2025' } });
    await userEvent.click(screen.getByRole('button', { name: 'Salvar livro' }));
    expect(await screen.findByText('12/03/2025')).toBeTruthy();
    expect((await repository.readAll()).books[0].shelfYear).toBe(2025);
  });
  it('edits private stars and literal notes, without exposing notes on the shelf', async () => {
    const original = synthetic({ status: 'read' });
    const { repository } = await setup([original], `/livro/${original.id}`);
    await userEvent.click(await screen.findByRole('button', { name: 'Editar livro' }));
    await userEvent.click(screen.getByRole('radio', { name: '5 de 5 estrelas' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Sua nota privada' }), { target: { value: '  <b>Texto privado</b>\n' } });
    await userEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }));
    expect(await screen.findByLabelText('Avaliação: 5 de 5 estrelas')).toBeTruthy();
    const note = screen.getByText('<b>Texto privado</b>');
    expect(note.textContent).toBe('  <b>Texto privado</b>\n');
    expect(note.querySelector('b')).toBeNull();
    expect((await repository.readBook(original.id)).book).toMatchObject({ rating: 5, note: '  <b>Texto privado</b>\n', createdAt: original.createdAt });
    await userEvent.click(screen.getByRole('link', { name: 'Voltar para a estante' }));
    expect(screen.queryByText(/Texto privado/)).toBeNull();
  });
  it('warns on a probable duplicate and only commits with explicit acknowledgement', async () => {
    const { repository } = await setup([synthetic()]);
    await screen.findByRole('textbox', { name: 'Título (obrigatório)' });
    await userEvent.type(titleField(), 'Livro de teste');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar livro' }));
    await screen.findByRole('button', { name: 'Salvar mesmo assim' });
    expect((await repository.readAll()).books).toHaveLength(1);
    await userEvent.click(screen.getByRole('button', { name: 'Salvar mesmo assim' }));
    await screen.findByRole('button', { name: 'Editar livro' });
    expect((await repository.readAll()).books).toHaveLength(2);
  });
  it('preserves unsaved edits on a quota failure and allows retry', async () => {
    const { repository } = await setup();
    await screen.findByRole('textbox', { name: 'Título (obrigatório)' });
    await userEvent.type(titleField(), 'Rascunho preservado');
    vi.spyOn(repository, 'commit').mockRejectedValueOnce(new DomainError('QuotaExceeded'));
    await userEvent.click(screen.getByRole('button', { name: 'Salvar livro' }));
    expect((await screen.findByRole('alert')).textContent).toContain('sem espaço');
    expect((titleField() as HTMLInputElement).value).toBe('Rascunho preservado');
    expect((await repository.readAll()).books).toHaveLength(0);
    await userEvent.click(screen.getByRole('button', { name: 'Salvar livro' }));
    expect(await screen.findByText('Livro salvo neste dispositivo.')).toBeTruthy();
  });
  it('preserves a stale editor until explicit reload confirmation and never overwrites the newer record', async () => {
    const original = synthetic();
    const { repository } = await setup([original], `/livro/${original.id}`);
    await userEvent.click(await screen.findByRole('button', { name: 'Editar livro' }));
    await userEvent.clear(titleField()); await userEvent.type(titleField(), 'Rascunho local');
    await act(async () => { await repository.commit({ kind: 'put', book: { ...original, title: 'Versão outra aba' } }, await repository.readRevision()); });
    expect((titleField() as HTMLInputElement).value).toBe('Rascunho local');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Sua biblioteca mudou');
    expect((await repository.readBook(original.id)).book?.title).toBe('Versão outra aba');
    await userEvent.click(screen.getByRole('button', { name: 'Recarregar versão salva' }));
    const dialog = screen.getByRole('alertdialog');
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Cancelar' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Descartar rascunho e recarregar' }));
    expect(await screen.findByRole('heading', { name: 'Versão outra aba' })).toBeTruthy();
  });
  it('confirms discard, traps delete dialog focus, restores focus on Escape and deletes after confirmation', async () => {
    const original = synthetic();
    const { repository } = await setup([original], `/livro/${original.id}`);
    await userEvent.click(await screen.findByRole('button', { name: 'Editar livro' }));
    await userEvent.type(titleField(), ' editado');
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Cancelar' }));
    expect((titleField() as HTMLInputElement).value).toBe('Livro de teste editado');
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    await userEvent.click(screen.getByRole('button', { name: 'Descartar alterações' }));
    const remove = await screen.findByRole('button', { name: 'Remover livro' });
    await userEvent.click(remove);
    const dialog = screen.getByRole('alertdialog');
    await userEvent.tab({ shift: true });
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Excluir livro' }));
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(document.activeElement).toBe(remove);
    expect((await repository.readAll()).books).toHaveLength(1);
    await userEvent.click(remove);
    await userEvent.click(screen.getByRole('button', { name: 'Excluir livro' }));
    await screen.findByRole('heading', { name: 'Estante 2026' });
    expect((await repository.readAll()).books).toHaveLength(0);
  });
  it('rejects deletion when the library changes while confirmation is open', async () => {
    const original = synthetic();
    const { repository } = await setup([original], `/livro/${original.id}`);
    await userEvent.click(await screen.findByRole('button', { name: 'Remover livro' }));
    await act(async () => { await repository.commit({ kind: 'put', book: { ...original, note: 'Atualização privada' } }, await repository.readRevision()); });
    await userEvent.click(screen.getByRole('button', { name: 'Excluir livro' }));
    expect((await screen.findByRole('alert')).textContent).toContain('O registro não foi excluído');
    expect((await repository.readBook(original.id)).book?.note).toBe('Atualização privada');
  });
  it('handles a missing ID without creating a book', async () => {
    const { repository } = await setup([], `/livro/${crypto.randomUUID()}`);
    expect(await screen.findByRole('heading', { name: 'Livro não encontrado' })).toBeTruthy();
    expect((await repository.readAll()).books).toHaveLength(0);
  });
});
