import { useEffect, useRef, useState } from 'react';
import type { YearShare } from '../../sharing/projection';
import { shareDescription } from '../../sharing/projection';
import { downloadShare, pngFromCanvas, renderYearShare, SHARE_FORMATS, type ShareFormat } from '../../sharing/render';

export default function YearSharePreview({ projection, onClose }: { projection: YearShare; onClose: () => void }) {
  const [format, setFormat] = useState<ShareFormat>('story');
  const [includeTitles, setIncludeTitles] = useState(true);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const canvas = useRef<HTMLCanvasElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const alive = useRef(true);
  const share = includeTitles ? projection : { ...projection, titles: [], remaining: 0 };
  const description = shareDescription(share);
  useEffect(() => { heading.current?.focus(); alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    setReady(false); setMessage('');
    try {
      const context = canvas.current?.getContext('2d');
      if (!context) throw new Error('ShareUnavailable');
      const styles = getComputedStyle(document.documentElement);
      const token = (name: string) => styles.getPropertyValue(name).trim();
      renderYearShare(context, includeTitles ? projection : { ...projection, titles: [], remaining: 0 }, format, {
        background: token('--color-canvas'), ink: token('--color-text'), muted: token('--color-text-secondary'),
        accent: token('--color-accent'), covers: ['plum', 'clay', 'blue', 'sage', 'citron', 'plum'].map((color) => token(`--color-cover-${color}`)),
      });
      setReady(true);
    } catch { setMessage('Não foi possível preparar a imagem neste navegador. Seus livros continuam salvos.'); }
  }, [projection, format, includeTitles]);

  async function download() {
    if (!canvas.current || !ready || busy) return;
    setBusy(true); setMessage('');
    try {
      const blob = await pngFromCanvas(canvas.current);
      if (!alive.current) return;
      downloadShare(blob, projection.year, format);
      setMessage('Download da imagem iniciado. Confira se ela foi salva. Esta imagem não substitui seu backup JSON.');
    } catch { if (alive.current) setMessage('Não foi possível gerar o PNG. Tente novamente.'); }
    finally { if (alive.current) setBusy(false); }
  }

  return <section className="share-preview notice-panel" aria-labelledby="share-title">
    <h2 id="share-title" tabIndex={-1} ref={heading}>Compartilhar {projection.year}</h2>
    <p>A imagem inclui o ano, livros lidos, páginas informadas, autores distintos e, se você permitir, títulos em capas tipográficas. Não inclui suas notas nem avaliações.</p>
    <p>As capas são desenhadas neste dispositivo, sem consultar serviços externos. Confira a prévia antes de baixar.</p>
    <label className="share-consent"><input type="checkbox" checked={includeTitles} disabled={busy}
      onChange={(event) => setIncludeTitles(event.target.checked)} />Incluir os títulos de até seis livros na imagem</label>
    <div className="segmented-control" role="group" aria-label="Formato da imagem">
      <button disabled={busy} aria-pressed={format === 'story'} onClick={() => setFormat('story')}>Story · 9:16</button>
      <button disabled={busy} aria-pressed={format === 'quadrado'} onClick={() => setFormat('quadrado')}>Quadrado · 1:1</button>
    </div>
    <p className="field-help">{SHARE_FORMATS[format].width} × {SHARE_FORMATS[format].height} pixels</p>
    <canvas ref={canvas} {...SHARE_FORMATS[format]} className={`share-canvas share-canvas--${format}`}
      role="img" aria-label={`Prévia da imagem de ${projection.year}`} aria-describedby="share-description">{description}</canvas>
    <label className="form-field">Descrição da imagem para copiar
      <textarea id="share-description" readOnly value={description} rows={5} onFocus={(event) => event.target.select()} />
    </label>
    <div className="form-actions">
      <button className="button button-secondary" onClick={onClose}>Fechar prévia</button>
      <button className="button button-primary" disabled={!ready || busy} onClick={() => { void download(); }}>{busy ? 'Preparando PNG…' : 'Baixar PNG'}</button>
    </div>
    {message && <p role="status">{message}</p>}
  </section>;
}
