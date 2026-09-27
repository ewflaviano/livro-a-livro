// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AppRoutes } from '../../app/router';
import { openLibraryRepository } from '../../adapters/indexeddb/library-repository';
import { createShelfService } from '../../services/shelf-service';
import { createBook } from '../../domain/book';

const context = { fillRect: vi.fn(), fillText: vi.fn(), measureText: (text: string) => ({ width: text.length * 10 }) };
beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => callback(new Blob(['PNG'], { type: 'image/png' })));
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  vi.stubGlobal('URL', class extends URL { static createObjectURL = vi.fn(() => 'blob:local'); static revokeObjectURL = vi.fn(); });
  vi.stubGlobal('fetch', vi.fn());
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function setup(empty = false) {
  const repository = await openLibraryRepository({ name: crypto.randomUUID(), channelFactory: null });
  const book = createBook({ title: 'Título público permitido', status: 'read', note: 'CONTEÚDO SECRETO', rating: 5,
    cover: { provider: 'open_library', coverId: 12345 }, authors: ['Nome de autor privado'] },
  { id: crypto.randomUUID(), now: '2026-09-26T12:00:00.000Z', shelfYear: 2026 });
  await repository.commit({ kind: 'replace', books: empty ? [] : [book] }, await repository.readRevision());
  await repository.updatePreferences({ shelfYear: 2026 });
  const service = createShelfService(repository);
  render(<MemoryRouter initialEntries={['/estante']}><AppRoutes openService={async () => service} /></MemoryRouter>);
  await screen.findByRole('button', { name: 'Compartilhar ano' });
  return repository;
}

describe('annual image preview', () => {
  it('requires an explicit preview, offers both dimensions, downloads locally and never updates backup state', async () => {
    const repository = await setup();
    const preferences = await repository.readPreferences();
    const version = await repository.readRevision();
    expect(screen.queryByRole('button', { name: 'Baixar PNG' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Compartilhar ano' }));
    const region = await screen.findByRole('region', { name: 'Compartilhar 2026' });
    expect(document.activeElement).toBe(within(region).getByRole('heading'));
    const canvas = within(region).getByRole('img') as HTMLCanvasElement;
    expect([canvas.width, canvas.height]).toEqual([1080, 1920]);
    const description = within(region).getByRole('textbox') as HTMLTextAreaElement;
    expect(description.value).toContain('Título público permitido');
    expect(description.value).not.toMatch(/CONTEÚDO SECRETO|Nome de autor privado|12345|rating|isbn/);
    await userEvent.click(within(region).getByRole('checkbox'));
    expect(description.value).not.toContain('Título público permitido');
    await userEvent.click(within(region).getByRole('button', { name: 'Quadrado · 1:1' }));
    expect([canvas.width, canvas.height]).toEqual([1080, 1080]);
    await userEvent.click(within(region).getByRole('button', { name: 'Baixar PNG' }));
    expect(await screen.findByRole('status')).toHaveProperty('textContent', expect.stringContaining('Download da imagem iniciado'));
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledOnce();
    const anchor = vi.mocked(HTMLAnchorElement.prototype.click).mock.instances[0] as HTMLAnchorElement;
    expect(anchor.download).toBe('livro-a-livro-2026-quadrado.png');
    expect(anchor.href).toBe('blob:local');
    expect(await repository.readPreferences()).toEqual(preferences);
    expect(await repository.readRevision()).toEqual(version);
    expect(fetch).not.toHaveBeenCalled();
    await userEvent.click(within(region).getByRole('button', { name: 'Fechar prévia' }));
    expect(screen.queryByRole('region', { name: 'Compartilhar 2026' })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Compartilhar ano' }));
  });

  it('explains why an empty year cannot create a share image', async () => {
    await setup(true);
    expect(screen.getByRole('button', { name: 'Compartilhar ano' })).toHaveProperty('disabled', true);
    expect(screen.getByText(/A imagem fica disponível após marcar um livro/)).toBeTruthy();
  });

  it('handles unsupported Canvas without pretending a file exists', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    await setup();
    await userEvent.click(screen.getByRole('button', { name: 'Compartilhar ano' }));
    expect(await screen.findByRole('status')).toHaveProperty('textContent', expect.stringContaining('Não foi possível preparar'));
    expect(screen.getByRole('button', { name: 'Baixar PNG' })).toHaveProperty('disabled', true);
    expect(HTMLAnchorElement.prototype.click).not.toHaveBeenCalled();
  });

  it('handles PNG conversion failure and allows retry', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementationOnce((callback) => callback(null));
    await setup();
    await userEvent.click(screen.getByRole('button', { name: 'Compartilhar ano' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Baixar PNG' }));
    expect(await screen.findByRole('status')).toHaveProperty('textContent', 'Não foi possível gerar o PNG. Tente novamente.');
    expect(HTMLAnchorElement.prototype.click).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Baixar PNG' }));
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledOnce();
  });
});
