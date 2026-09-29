import { Check, Copy } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { PIX_CNPJ, PIX_COPY_PASTE, PIX_KEY, PIX_RECIPIENT } from '../../support/pix';
import { useLocale } from '../../i18n/context';

const REPOSITORY_URL = 'https://github.com/ewflaviano/livro-a-livro';
const SUGGESTIONS_URL = `${REPOSITORY_URL}/issues/new`;

export function SupportPage() {
  const { t } = useLocale();
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'failed'>('idle');
  const codeRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { document.title = `${t('support')} · ${t('appName')}`; }, [t]);

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
    <h1 id="page-title">{t('supportTitle')}</h1>
    <p className="page-description">{t('supportExplanation')}</p>

    <div className="support-layout">
      <section className="notice-panel pix-card" aria-labelledby="pix-heading">
        <h2 id="pix-heading">{t('supportPix')}</h2>
        <p>{t('pixInstructions')}</p>
        <button className="button button-primary" type="button" onClick={() => void copyCode()}>
          {copyStatus === 'copied' ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
          {copyStatus === 'copied' ? t('pixCopied') : t('copyPix')}
        </button>
        {copyStatus !== 'idle' && <p role="status" className="support-copy-status">{copyStatus === 'copied' ? t('pixPaste') : t('pixCopyFailed')}</p>}
        <div className="pix-recipient"><span>{t('verifyRecipient')}</span><strong>{PIX_RECIPIENT}</strong><small>CNPJ {PIX_CNPJ}</small></div>
        <label className="pix-code-label" htmlFor="pix-copy-code">{t('pixCopyPaste')}</label>
        <textarea ref={codeRef} id="pix-copy-code" className="pix-code" readOnly rows={3} value={PIX_COPY_PASTE} onFocus={(event) => event.currentTarget.select()} />
        <p className="pix-key">{t('pixKey')} <span>{PIX_KEY}</span></p>
        <details className="pix-qr-option"><summary>{t('qrOtherDevice')}</summary>
          <div className="pix-qr-frame"><img src="/pix-livro-a-livro.svg" alt={t('pixQrAlt')} width="260" height="260" /></div>
        </details>
        <p className="support-disclosure">{t('paymentDisclosure')}</p>
      </section>

      <section className="support-feedback" aria-labelledby="feedback-heading">
        <h2 id="feedback-heading">{t('suggestionsOpenSource')}</h2>
        <p><a href={SUGGESTIONS_URL} target="_blank" rel="noreferrer">{t('sendSuggestion')}</a> · <a href={REPOSITORY_URL} target="_blank" rel="noreferrer">{t('contributeCode')}</a></p>
      </section>
    </div>
  </section>;
}
