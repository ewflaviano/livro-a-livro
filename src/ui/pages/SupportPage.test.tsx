// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { PIX_COPY_PASTE, PIX_KEY } from '../../support/pix';
import { SupportPage } from './SupportPage';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('SupportPage', () => {
  it('puts copy and recipient before the QR alternative without a request', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    render(<MemoryRouter><SupportPage /></MemoryRouter>);
    expect(screen.getByRole('heading', { name: 'Apoie o Livro a Livro' })).toBeTruthy();
    expect(screen.getByText('Inovaprog Desenvolvimento')).toBeTruthy();
    expect(screen.getByText('CNPJ 64.420.635/0001-20')).toBeTruthy();
    const copy = screen.getByRole('button', { name: 'Copiar código Pix' });
    const recipient = screen.getByText('Inovaprog Desenvolvimento');
    expect(copy.compareDocumentPosition(recipient) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await userEvent.click(screen.getByText('Usar QR Code em outro dispositivo'));
    expect(screen.getByRole('img', { name: /QR Code Pix/ }).getAttribute('src')).toBe('/pix-livro-a-livro.svg');
    expect((screen.getByLabelText('Pix copia e cola') as HTMLTextAreaElement).value).toBe(PIX_COPY_PASTE);
    expect(screen.getByText(PIX_KEY)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Enviar sugestão' }).getAttribute('href')).toBe('https://github.com/ewflaviano/livro-a-livro/issues/new');
    expect(screen.getByRole('link', { name: 'Contribuir com código' }).getAttribute('href')).toBe('https://github.com/ewflaviano/livro-a-livro');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('copies the complete Pix code locally', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    render(<MemoryRouter><SupportPage /></MemoryRouter>);
    await user.click(screen.getByRole('button', { name: 'Copiar código Pix' }));
    expect(writeText).toHaveBeenCalledWith(PIX_COPY_PASTE);
    expect((await screen.findByRole('status')).textContent).toContain('Cole o código');
  });

  it('keeps the code selectable when automatic copy is unavailable', async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } });
    render(<MemoryRouter><SupportPage /></MemoryRouter>);
    await user.click(screen.getByRole('button', { name: 'Copiar código Pix' }));
    expect((await screen.findByRole('status')).textContent).toContain('Não foi possível copiar automaticamente');
    expect(document.activeElement).toBe(screen.getByLabelText('Pix copia e cola'));
    expect((screen.getByLabelText('Pix copia e cola') as HTMLTextAreaElement).selectionStart).toBe(0);
    expect((screen.getByLabelText('Pix copia e cola') as HTMLTextAreaElement).selectionEnd).toBe(PIX_COPY_PASTE.length);
  });

});
