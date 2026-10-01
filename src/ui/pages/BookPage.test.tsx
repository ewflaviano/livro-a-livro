// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { openDB } from 'idb';
import { encodedCover } from '../../../test/fixtures/covers/helpers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { openLibraryRepository } from '../../adapters/indexeddb/library-repository';
import { createBook, type Book } from '../../domain/book';
import { DomainError } from '../../domain/errors';
import { createShelfService } from '../../services/shelf-service';
import { AppRoutes } from '../../app/router';
import { LocalePreview } from '../../i18n/context';
import type { Locale } from '../../i18n/locale';

const synthetic = (patch: Partial<Book> = {}) => createBook({ title: 'Livro de teste', ...patch }, {
  id: crypto.randomUUID(), now: '2026-09-26T12:00:00.000Z', shelfYear: 2026,
});
beforeEach(() => { vi.stubGlobal('fetch', vi.fn()); vi.spyOn(window, 'scrollTo').mockImplementation(() => {}); });
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
async function setup(books: Book[] = [], route = '/adicionar', locale: Locale = 'pt-BR') {
  const name = crypto.randomUUID();
  const repository = await openLibraryRepository({ name, channelFactory: null });
  await repository.commit({ kind: 'replace', books }, await repository.readRevision());
  await repository.updatePreferences({ shelfYear: 2026 });
  const service = createShelfService(repository);
  render(<LocalePreview locale={locale}><MemoryRouter initialEntries={[route]}><AppRoutes openService={async () => service} /></MemoryRouter></LocalePreview>);
  if (route === '/adicionar') await userEvent.click(await screen.findByRole('button', { name: locale === 'en' ? 'Add manually' : 'Adicionar manualmente' }));
  return { repository, service, name };
}
const titleField = () => screen.getByRole('textbox', { name: 'Título (obrigatório)' });
async function openRemoveMenu() {
  await userEvent.click(screen.getByText('Opções do livro'));
  return screen.getByRole('button', { name: 'Remover livro' });
}

const coverFile = (mime: 'image/png' | 'image/jpeg' = 'image/png') => {
  const bytes = Uint8Array.from(atob(encodedCover(mime).bytes), char => char.charCodeAt(0));
  const file = new File([bytes], mime === 'image/png' ? 'synthetic.png' : 'synthetic.jpg', { type: mime });
  // jsdom File does not implement this browser API.
  Object.defineProperty(file, 'arrayBuffer', { value: async () => bytes.buffer });
  return file;
};

describe('manual books and private detail', () => {
  it.each([
    { locale: 'pt-BR' as const, action: 'Marcar como lido', cancel: 'Cancelar', saved: 'Livro salvo neste dispositivo.' },
    { locale: 'en' as const, action: 'Mark as read', cancel: 'Cancel', saved: 'Book saved on this device.' },
  ])('confirms a reading completion in $locale and updates the annual shelf', async ({ locale, action, cancel, saved }) => {
    const original = synthetic({ status: 'reading', authors: ['Autora fictícia'], pageCount: 224, note: 'Nota de teste', startedOn: '2025-12-20' });
    const { repository } = await setup([original], `/livro/${original.id}`, locale);
    const mark = await screen.findByRole('button', { name: action });
    await userEvent.click(mark);
    const dialog = screen.getByRole('alertdialog');
    expect(dialog.textContent).toContain(original.title);
    expect(dialog.textContent).toContain('2026');
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: cancel }));
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(document.activeElement).toBe(mark);
    expect((await repository.readBook(original.id)).book).toEqual(original);
    await userEvent.click(mark);
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: action }));
    expect(await screen.findByText(saved)).toBeTruthy();
    expect(screen.queryByRole('button', { name: action })).toBeNull();
    expect((await repository.readBook(original.id)).book).toMatchObject({ status: 'read', note: original.note, startedOn: original.startedOn, pageCount: 224 });
    await userEvent.click(screen.getByRole('link', { name: locale === 'en' ? 'Back to shelf' : 'Voltar para a estante' }));
    expect(await screen.findByRole('link', { name: /Livro de teste/ })).toBeTruthy();
    expect(screen.getByLabelText(locale === 'en' ? '1 book read in 2026' : '1 livro lido em 2026')).toBeTruthy();
  });

  it('leaves the book intact on a quota error and lets the person retry', async () => {
    const original = synthetic({ status: 'reading' });
    const { repository } = await setup([original], `/livro/${original.id}`);
    vi.spyOn(repository, 'commit').mockRejectedValueOnce(new DomainError('QuotaExceeded'));
    await userEvent.click(await screen.findByRole('button', { name: 'Marcar como lido' }));
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Marcar como lido' }));
    expect((await screen.findByRole('alert')).textContent).toContain('sem espaço');
    expect((await repository.readBook(original.id)).book).toEqual(original);
    await userEvent.click(screen.getByRole('button', { name: 'Marcar como lido' }));
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Marcar como lido' }));
    expect(await screen.findByText('Livro salvo neste dispositivo.')).toBeTruthy();
  });

  it('requires a reload when the book changes after opening the completion dialog', async () => {
    const original = synthetic({ status: 'reading' });
    const { repository } = await setup([original], `/livro/${original.id}`);
    await userEvent.click(await screen.findByRole('button', { name: 'Marcar como lido' }));
    await act(async () => { await repository.commit({ kind: 'put', book: { ...original, note: 'Outra aba' } }, await repository.readRevision()); });
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Marcar como lido' }));
    expect((await screen.findByRole('alert')).textContent).toContain('A biblioteca mudou');
    expect((await repository.readBook(original.id)).book).toMatchObject({ status: 'reading', note: 'Outra aba' });
    await userEvent.click(screen.getByRole('button', { name: 'Recarregar versão salva' }));
    expect(await screen.findByText('Outra aba')).toBeTruthy();
  });

  it('previews English form and detail while preserving the original book title and note', async () => {
    const { repository } = await setup([], '/adicionar', 'en');
    expect((screen.getByRole('radio', { name: 'Read' }) as HTMLInputElement).checked).toBe(true);
    await userEvent.type(screen.getByRole('textbox', { name: 'Title (required)' }), 'Árvore de papel');
    await userEvent.click(screen.getByText('More details (optional)'));
    await userEvent.type(screen.getByRole('textbox', { name: 'Notes' }), 'Nota privada');
    await userEvent.click(screen.getByRole('button', { name: 'Save book' }));
    expect(await screen.findByRole('heading', { name: 'Árvore de papel' })).toBeTruthy();
    expect((await repository.readAll()).books[0].note).toBe('Nota privada');
    const entry = screen.getByRole('link', { name: /Árvore de papel/ });
    await userEvent.click(entry);
    expect(await screen.findByRole('button', { name: 'Edit book' })).toBeTruthy();
    expect(screen.getByText('Nota privada')).toBeTruthy();
  });
  it('shows Editar beside the book state and omits empty optional details', async () => {
    const original = synthetic();
    await setup([original], `/livro/${original.id}`);
    const edit = await screen.findByRole('button', { name: 'Editar livro' });
    expect(edit.closest('.book-detail-heading')).toBeTruthy();
    expect(screen.getByText('Quero ler')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Marcar como lido' })).toBeNull();
    expect(screen.queryByText('Não informadas')).toBeNull();
    expect(screen.queryByText('Sem avaliação')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Observações' })).toBeNull();
    expect(screen.queryByRole('term', { name: 'Páginas' })).toBeNull();
    expect(screen.getByText('Opções do livro').closest('details')?.open).toBe(false);
    await userEvent.click(edit);
    expect((screen.getByRole('radio', { name: 'Quero ler' }) as HTMLInputElement).checked).toBe(true);
  });

  it('keeps every populated optional detail visible', async () => {
    const original = synthetic({ authors: ['Autora sintética'], pageCount: 123, publicationYear: 2020, isbn: '9780306406157', rating: 5, note: 'Nota privada' });
    await setup([original], `/livro/${original.id}`);
    await screen.findByRole('button', { name: 'Editar livro' });
    expect(screen.getByText('Autora sintética')).toBeTruthy();
    expect(screen.getByText('123')).toBeTruthy();
    expect(screen.getByText('2020')).toBeTruthy();
    expect(screen.getByText('9780306406157')).toBeTruthy();
    expect(screen.getByLabelText('Avaliação: 5 de 5 estrelas')).toBeTruthy();
    expect(screen.getByText('Nota privada')).toBeTruthy();
  });

  it.each(['{Enter}', ' '])('opens book options with %s', async key => {
    const original = synthetic();
    await setup([original], `/livro/${original.id}`);
    const summary = await screen.findByText('Opções do livro');
    summary.focus();
    await userEvent.keyboard(key);
    expect(summary.closest('details')?.open).toBe(true);
    expect(screen.getByRole('button', { name: 'Remover livro' })).toBeTruthy();
  });

  it.each(['Estante', 'Mais'])('protects a draft when leaving through mobile %s', async destination => {
    const { repository } = await setup();
    await userEvent.type(titleField(), 'Rascunho local');
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const link = within(screen.getByRole('navigation', { name: 'Navegação mobile' })).getByRole('link', { name: destination });
    await userEvent.click(link);
    expect(confirm).toHaveBeenCalledOnce();
    expect((titleField() as HTMLInputElement).value).toBe('Rascunho local');
    confirm.mockReturnValue(true);
    await userEvent.click(link);
    expect(await screen.findByRole('heading', { name: destination === 'Mais' ? 'Mais' : 'Estante', level: 1 })).toBeTruthy();
    expect((await repository.readAll()).books).toEqual([]);
  });

  it('treats a cover-only edit as dirty and cancellation never persists its bytes', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 32, height: 48, close() {} })));
    const original = synthetic(); const { repository, name } = await setup([original], `/livro/${original.id}`);
    await userEvent.click(await screen.findByRole('button', { name: 'Editar livro' }));
    await userEvent.upload(screen.getByLabelText(/^Capa \(opcional\)/), coverFile());
    await screen.findByText(/Capa pronta para salvar/);
    expect(screen.getByText('Alterações não salvas')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.getByRole('alertdialog')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Descartar alterações' }));
    expect(document.activeElement).toBe(await screen.findByRole('button', { name: 'Editar livro' }));
    expect((await repository.readBackupSnapshot()).coverMedia).toEqual([]);
    expect((await repository.readBook(original.id)).book).toEqual(original);
    const db = await openDB(name); expect(await db.count('coverMedia')).toBe(0); db.close();
  });

  it('blocks save during decode and retains the last selected cover if decodes complete out of order', async () => {
    const decodes: ((image: { width: number; height: number; close(): void }) => void)[] = [];
    const decoder = vi.fn(() => new Promise(resolve => { decodes.push(resolve); }));
    vi.stubGlobal('createImageBitmap', decoder);
    const { repository, service } = await setup();
    // Browser Blob cloning is covered by repository tests; jsdom cannot clone File bytes.
    const save = vi.spyOn(service.books, 'save').mockResolvedValue({ kind: 'duplicate', count: 1 });
    await userEvent.type(await screen.findByRole('textbox', { name: 'Título (obrigatório)' }), 'Capa selecionada');
    await userEvent.upload(screen.getByLabelText(/^Capa \(opcional\)/), coverFile());
    await vi.waitFor(() => expect(decoder).toHaveBeenCalledTimes(1));
    expect((screen.getByRole('button', { name: 'Salvar livro' }) as HTMLButtonElement).disabled).toBe(true);
    await userEvent.upload(screen.getByLabelText(/^Capa \(opcional\)/), coverFile('image/jpeg'));
    await vi.waitFor(() => expect(decoder).toHaveBeenCalledTimes(2));
    await act(async () => { decodes[1]({ width: 32, height: 48, close() {} }); });
    await screen.findByText(/Capa pronta para salvar/);
    await act(async () => { decodes[0]({ width: 32, height: 48, close() {} }); });
    await userEvent.click(screen.getByRole('button', { name: 'Salvar livro' }));
    await screen.findByRole('button', { name: 'Salvar mesmo assim' });
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ coverMedia: expect.objectContaining({ mimeType: 'image/jpeg' }) }));
    expect((await repository.readBackupSnapshot()).coverMedia).toEqual([]);
  });

  it('adds quickly with only a title and returns to the shelf', async () => {
    const { repository } = await setup();
    await screen.findByRole('textbox', { name: 'Título (obrigatório)' });
    expect((screen.getByRole('radio', { name: 'Lido' }) as HTMLInputElement).checked).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: 'Salvar livro' }));
    expect(await screen.findByText('Informe um título com até 500 caracteres.')).toBeTruthy();
    expect(document.activeElement).toBe(titleField());
    await userEvent.type(titleField(), 'Leitura manual');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar livro' }));
    expect(await screen.findByRole('heading', { name: 'Leitura manual' })).toBeTruthy();
    expect(await screen.findByRole('heading', { name: 'Estante', level: 1 })).toBeTruthy();
    expect((await repository.readAll()).books[0]).toMatchObject({ title: 'Leitura manual', status: 'read', shelfYear: 2026, authors: [], finishedOn: null, rating: null });
  });
  it('respects an explicit Quero ler choice in a new manual record', async () => {
    const { repository } = await setup();
    await screen.findByRole('textbox', { name: 'Título (obrigatório)' });
    await userEvent.click(screen.getByRole('radio', { name: 'Quero ler' }));
    await userEvent.type(titleField(), 'Livro para depois');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar livro' }));
    await screen.findByRole('heading', { name: 'Estante', level: 1 });
    expect((await repository.readAll()).books[0].status).toBe('want-to-read');
  });
  it('preserves existing dates and confirms before removing incompatible dates', async () => {
    const original = synthetic({ status: 'read', startedOn: '2025-12-31', finishedOn: '2026-03-12' });
    const { repository } = await setup([original], `/livro/${original.id}`);
    await userEvent.click(await screen.findByRole('button', { name: 'Editar livro' }));
    expect(screen.queryByLabelText(/Comecei em|Terminei em/)).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }));
    await waitFor(async () => expect((await repository.readBook(original.id)).book)
      .toMatchObject({ startedOn: '2025-12-31', finishedOn: '2026-03-12' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Editar livro' }));
    await userEvent.click(screen.getByRole('radio', { name: 'Lendo' }));
    await userEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Remover datas anteriores?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
    expect((await repository.readBook(original.id)).book?.finishedOn).toBe('2026-03-12');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }));
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Remover datas e salvar' }));
    await waitFor(async () => expect((await repository.readBook(original.id)).book)
      .toMatchObject({ status: 'reading', startedOn: '2025-12-31', finishedOn: null }));
  });
  it('edits private stars and literal notes, without exposing notes on the shelf', async () => {
    const original = synthetic({ status: 'read' });
    const { repository } = await setup([original], `/livro/${original.id}`);
    await userEvent.click(await screen.findByRole('button', { name: 'Editar livro' }));
    await userEvent.click(screen.getByRole('radio', { name: '5 de 5 estrelas' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Observações' }), { target: { value: '  <b>Texto privado</b>\n' } });
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
    await screen.findByRole('heading', { name: 'Estante', level: 1 });
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
    expect(await screen.findByRole('heading', { name: 'Estante', level: 1 })).toBeTruthy();
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
    await screen.findByRole('button', { name: 'Editar livro' });
    const remove = await openRemoveMenu();
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
    await screen.findByRole('heading', { name: 'Estante' });
    expect((await repository.readAll()).books).toHaveLength(0);
  });
  it('rejects deletion when the library changes while confirmation is open', async () => {
    const original = synthetic();
    const { repository } = await setup([original], `/livro/${original.id}`);
    await screen.findByRole('button', { name: 'Editar livro' });
    await userEvent.click(await openRemoveMenu());
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
