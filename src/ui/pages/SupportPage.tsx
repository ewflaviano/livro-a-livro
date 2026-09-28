import { Check, Copy } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { PIX_CNPJ, PIX_COPY_PASTE, PIX_KEY, PIX_RECIPIENT } from '../../support/pix';

const REPOSITORY_URL = 'https://github.com/ewflaviano/livro-a-livro';
const SUGGESTIONS_URL = `${REPOSITORY_URL}/issues/new`;

export function SupportPage() {
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'failed'>('idle');
  const codeRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { document.title = 'Apoiar · Livro a Livro'; }, []);

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(PIX_COPY_PASTE);
      setCopyStatus('copied');
    } catch {
      codeRef.current?.focus();
      codeRef.current?.select();
      setCopyStatus('failed');
    }
  }

  return <section className="page-content support-page" aria-labelledby="page-title">
    <h1 id="page-title">Apoie o Livro a Livro</h1>
    <p className="page-description">Se o Livro a Livro ajuda você, considere apoiar com qualquer valor.</p>

    <div className="support-layout">
      <section className="notice-panel pix-card" aria-labelledby="pix-heading">
        <h2 id="pix-heading">Apoiar com Pix</h2>
        <p>Copie o código e escolha o valor no aplicativo do seu banco.</p>
        <button className="button button-primary" type="button" onClick={() => void copyCode()}>
          {copyStatus === 'copied' ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
          {copyStatus === 'copied' ? 'Código copiado' : 'Copiar código Pix'}
        </button>
        {copyStatus !== 'idle' && <p role="status" className="support-copy-status">{copyStatus === 'copied' ? 'Cole o código na opção Pix copia e cola do seu banco.' : 'Não foi possível copiar automaticamente. O código foi selecionado para você copiar.'}</p>}
        <div className="pix-recipient"><span>Confira o recebedor no banco antes de confirmar:</span><strong>{PIX_RECIPIENT}</strong><small>CNPJ {PIX_CNPJ}</small></div>
        <label className="pix-code-label" htmlFor="pix-copy-code">Pix copia e cola</label>
        <textarea ref={codeRef} id="pix-copy-code" className="pix-code" readOnly rows={3} value={PIX_COPY_PASTE} onFocus={(event) => event.currentTarget.select()} />
        <p className="pix-key">Chave Pix: <span>{PIX_KEY}</span></p>
        <details className="pix-qr-option"><summary>Usar QR Code em outro dispositivo</summary>
          <div className="pix-qr-frame"><img src="/pix-livro-a-livro.svg" alt="QR Code Pix para apoiar o Livro a Livro" width="260" height="260" /></div>
        </details>
        <p className="support-disclosure">O pagamento ocorre no seu banco. O Livro a Livro não processa pagamentos nem registra quem contribuiu.</p>
      </section>

      <section className="support-feedback" aria-labelledby="feedback-heading">
        <h2 id="feedback-heading">Sugestões e código aberto</h2>
        <p><a href={SUGGESTIONS_URL} target="_blank" rel="noreferrer">Enviar sugestão</a> · <a href={REPOSITORY_URL} target="_blank" rel="noreferrer">Contribuir com código</a></p>
      </section>
    </div>
  </section>;
}
