import { Check, Copy, ExternalLink, HeartHandshake, MessageSquareText, QrCode } from 'lucide-react';
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
    <p className="eyebrow">Feito com cuidado</p>
    <h1 id="page-title">Apoie o Livro a Livro</h1>
    <p className="page-description">O projeto é gratuito, privado por princípio e feito para durar.</p>

    <div className="support-layout">
      <section className="notice-panel support-intro" aria-labelledby="support-intro-title">
        <HeartHandshake aria-hidden="true" />
        <h2 id="support-intro-title">Se ele ajuda a guardar sua história, considere apoiar.</h2>
        <p>Qualquer valor ajuda a manter o projeto disponível e a criar melhorias. Apoiar é opcional: a sua estante continua gratuita e sem conta.</p>
        <p className="support-disclosure">O pagamento é feito pelo aplicativo do seu banco. Livro a Livro não processa pagamentos nem registra quem contribuiu.</p>
      </section>

      <section className="notice-panel pix-card" aria-labelledby="pix-heading">
        <div className="support-card-heading">
          <QrCode aria-hidden="true" />
          <div><h2 id="pix-heading">Apoiar com Pix</h2><p>Escolha o valor no aplicativo do seu banco.</p></div>
        </div>
        <div className="pix-qr-frame"><img src="/pix-livro-a-livro.svg" alt="QR Code Pix para apoiar o Livro a Livro" width="260" height="260" /></div>
        <div className="pix-recipient"><span>Recebedor informado no QR Code</span><strong>{PIX_RECIPIENT}</strong><small>CNPJ {PIX_CNPJ}</small></div>
        <label className="pix-code-label" htmlFor="pix-copy-code">Pix copia e cola</label>
        <textarea ref={codeRef} id="pix-copy-code" className="pix-code" readOnly rows={3} value={PIX_COPY_PASTE} onFocus={(event) => event.currentTarget.select()} />
        <button className="button button-primary" type="button" onClick={() => void copyCode()}>
          {copyStatus === 'copied' ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
          {copyStatus === 'copied' ? 'Código copiado' : 'Copiar código Pix'}
        </button>
        {copyStatus !== 'idle' && <p role="status" className="support-copy-status">{copyStatus === 'copied' ? 'Cole o código na opção Pix copia e cola do seu banco.' : 'Não foi possível copiar automaticamente. O código foi selecionado para você copiar.'}</p>}
        <p className="pix-key">Chave Pix: <span>{PIX_KEY}</span></p>
        <p className="support-disclosure">Confira o recebedor no seu banco antes de confirmar a transferência.</p>
      </section>

      <section className="notice-panel support-feedback" aria-labelledby="feedback-heading">
        <div className="support-card-heading">
          <MessageSquareText aria-hidden="true" />
          <div><h2 id="feedback-heading">Sugestões e código aberto</h2><p>Ideias, relatos de problemas e contribuições são bem-vindos.</p></div>
        </div>
        <p>As conversas acontecem publicamente no repositório, sem enviar sua biblioteca ou suas notas para o projeto.</p>
        <div className="form-actions">
          <a className="button button-secondary" href={SUGGESTIONS_URL} target="_blank" rel="noreferrer"><MessageSquareText aria-hidden="true" />Enviar sugestão<ExternalLink aria-hidden="true" /></a>
          <a className="button button-secondary" href={REPOSITORY_URL} target="_blank" rel="noreferrer"><ExternalLink aria-hidden="true" />Contribuir com código</a>
        </div>
      </section>
    </div>
  </section>;
}
