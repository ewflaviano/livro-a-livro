import { useEffect, useRef, useState } from 'react';
import type { EncodedCover, ResolutionChoices, ResolutionPreview, ResolutionVariant } from '../../sync/merge';
import { ConfirmDialog } from './ConfirmDialog';
import { occupyUi } from '../interaction-guard';

const dateLabel = (value: string) => value.split('-').reverse().join('/');
function Instant({ value }: { value: string }) {
  const fraction = value.match(/\.(\d+)Z$/u)?.[1];
  return <time dateTime={value} title={value}>{new Date(value).toLocaleString('pt-BR', { timeZone: 'UTC' })}{fraction && Number(fraction) !== 0 ? `,${fraction}` : ''} UTC</time>;
}
function PreviewCover({ media, title }: { media: EncodedCover; title: string }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    const value = URL.createObjectURL(new Blob([Uint8Array.from(atob(media.bytes), character => character.charCodeAt(0))], { type: media.mimeType }));
    setUrl(value); return () => URL.revokeObjectURL(value);
  }, [media]);
  return url ? <img className="merge-cover" src={url} alt={`Capa de ${title}`} /> : null;
}
function Version({ variant }: { variant: ResolutionVariant }) {
  const book = variant.book;
  return <div className="merge-version">
    {variant.media && <PreviewCover media={variant.media} title={book.title} />}
    <strong>{book.title}</strong><p>{book.authors.join(', ')}</p>
    <dl><dt>Estado</dt><dd>{{ read: 'Lido', reading: 'Lendo', 'want-to-read': 'Quero ler' }[book.status]}</dd>
      <dt>Ano da estante</dt><dd>{book.shelfYear}</dd><dt>Páginas</dt><dd>{book.pageCount ?? 'Não informado'}</dd>
      <dt>Leitura</dt><dd>{book.startedOn ? dateLabel(book.startedOn) : 'Sem início'} → {book.finishedOn ? dateLabel(book.finishedOn) : 'Sem término'}</dd>
      <dt>Avaliação</dt><dd>{book.rating ? `${book.rating} de 5` : 'Sem avaliação'}</dd>
      <dt>ISBN / publicação</dt><dd>{book.isbn ?? 'Sem ISBN'} / {book.publicationYear ?? 'Sem ano'}</dd>
      <dt>Capa</dt><dd>{variant.media ? 'Imagem preservada nesta versão' : book.cover?.provider === 'open_library' ? 'Open Library' : 'Sem capa'}</dd>
      <dt>Cadastro / alteração</dt><dd><Instant value={book.createdAt} /> / <Instant value={book.updatedAt} /></dd>
      <dt>Origem</dt><dd>{book.source ? <>Open Library · consultada em <Instant value={book.source.retrievedAt} />{book.source.workId && <> · <a href={`https://openlibrary.org/works/${book.source.workId}`} target="_blank" rel="noreferrer">Obra de origem</a></>}{book.source.editionId && <> · <a href={`https://openlibrary.org/books/${book.source.editionId}`} target="_blank" rel="noreferrer">Edição de origem</a></>}</> : 'Cadastro manual'}</dd>
      <dt>Nota</dt><dd className="merge-note" tabIndex={book.note.length > 500 ? 0 : undefined}>{book.note || 'Sem nota'}</dd>
    </dl>
  </div>;
}
function VersionDetails({ variant, expanded }: { variant: ResolutionVariant; expanded: boolean }) {
  const [open, setOpen] = useState(expanded);
  return <details open={open} onToggle={event => setOpen(event.currentTarget.open)}><summary>Ver livro completo</summary>{open && <Version variant={variant} />}</details>;
}
export function MergePreview({ preview, busy, error, onCancel, onConfirm }: {
  preview: ResolutionPreview; busy: boolean; error: string; onCancel: () => void; onConfirm: (choices: ResolutionChoices) => void;
}) {
  const [choices, setChoices] = useState<Record<string, string | null | undefined>>(() => Object.fromEntries(preview.books.map(book => [book.id, book.defaultSourceId])));
  const [preferences, setPreferences] = useState(preview.preferencesDiffer ? '' : preview.defaultPreferencesSourceId);
  const [batch, setBatch] = useState<string | null>(null);
  const [includeUnbased, setIncludeUnbased] = useState(false); const [page, setPage] = useState(0); const [confirm, setConfirm] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null); const pageSize = 10;
  useEffect(() => { const release = occupyUi(); heading.current?.focus(); return release; }, []);
  const missing = preview.books.filter(book => choices[book.id] === undefined).length;
  const needsUnbased = preview.books.some(book => book.unbasedAbsence && choices[book.id] !== null);
  const included = preview.books.filter(book => choices[book.id] != null).length;
  const ready = !missing && !!preferences && (!needsUnbased || includeUnbased);
  const label = (sourceId: string) => preview.sources.find(source => source.id === sourceId)?.label ?? '';
  return <section className="merge-preview" aria-labelledby="merge-title" onKeyDown={event => { if (event.key === 'Escape' && !confirm && !batch && !busy) { event.preventDefault(); onCancel(); } }}>
    <h3 id="merge-title" ref={heading} tabIndex={-1}>Prévia da união</h3>
    <p>Nenhuma alteração foi salva. Escolha livros inteiros; livros cadastrados separadamente continuam separados, mesmo com título igual.</p>
    <p role="status">{preview.books.length} livros diferentes · {included} selecionados · {missing} decisões de livros pendentes</p>
    <p>Tamanho das versões: {(preview.sourceBytes / 1024 / 1024).toFixed(1)} de 100 MiB. O resultado também precisa respeitar os limites de livros e capas do backup.</p>
    <fieldset><legend>Preferências da biblioteca</legend>{preview.sources.map(source => <label key={source.id} className="merge-choice">
      <input type="radio" name={`merge-prefs-${preview.id}`} checked={preferences === source.id} disabled={busy} onChange={() => setPreferences(source.id)} />
      {source.id === 'local' ? 'Preferências deste dispositivo' : `Preferências de ${source.label}`}: ano {source.preferences.shelfYear ?? 'atual (automático)'}, {source.preferences.mode === 'grid' ? 'grade' : 'lista'}, {{ all: 'todos os livros', read: 'lidos', reading: 'lendo', 'want-to-read': 'quero ler' }[source.preferences.filter]}
    </label>)}</fieldset>
    {preview.books.some(book => book.unbasedAbsence) && <label className="notice-panel merge-choice"><input type="checkbox" checked={includeUnbased} disabled={busy} onChange={event => setIncludeUnbased(event.currentTarget.checked)} />
      Incluir livros presentes só em algumas versões. Isso pode trazer de volta livros removidos; sem uma base comum confiável, a ausência não prova exclusão.</label>}
    <details><summary>Escolher vários livros de uma versão</summary><p>A preferência em lote escolhe o livro inteiro para os livros presentes nessa versão. Você pode revisar cada escolha depois.</p><div className="form-actions">{preview.sources.map(source => <button key={source.id} className="button button-secondary" disabled={busy} onClick={() => setBatch(source.id)}>{source.id === 'local' ? 'Preferir livros deste dispositivo' : `Preferir livros de ${source.label}`}</button>)}</div></details>
    {preview.books.slice(page * pageSize, (page + 1) * pageSize).map((book, index) => <fieldset key={book.id} className="merge-book"><legend>Livro {page * pageSize + index + 1}: {book.variants[0].book.title}</legend>
      {book.removed && <p>Removido em uma versão. Escolha manter uma das versões presentes ou excluir.</p>}
      {book.unbasedAbsence && <p>Presente só em algumas versões.</p>}
      {book.requiresChoice && <p>Escolha uma versão inteira ou exclua este livro.</p>}
      <div className="merge-versions">{book.variants.map(variant => <div key={variant.sourceId}>
        <label className="merge-choice"><input type="radio" name={`merge-book-${book.id}`} checked={choices[book.id] === variant.sourceId} disabled={busy} onChange={() => setChoices(current => ({ ...current, [book.id]: variant.sourceId }))} />{variant.sourceId === 'local' ? 'Usar versão deste dispositivo' : `Usar ${label(variant.sourceId)}`}</label>
        <VersionDetails variant={variant} expanded={book.requiresChoice} />
      </div>)}</div>
      <label className="merge-choice"><input type="radio" name={`merge-book-${book.id}`} checked={choices[book.id] === null} disabled={busy} onChange={() => setChoices(current => ({ ...current, [book.id]: null }))} />Excluir este livro da união</label>
    </fieldset>)}
    <nav aria-label="Páginas da prévia" className="form-actions"><button className="button button-secondary" disabled={busy || page === 0} onClick={() => { setPage(page - 1); heading.current?.focus(); }}>Página anterior</button>
      <span>Página {page + 1} de {Math.max(1, Math.ceil(preview.books.length / pageSize))}</span><button className="button button-secondary" disabled={busy || (page + 1) * pageSize >= preview.books.length} onClick={() => { setPage(page + 1); heading.current?.focus(); }}>Próxima página</button></nav>
    {error && <p role="alert">{error}</p>}
    <div className="form-actions"><button className="button button-secondary" disabled={busy} onClick={onCancel}>Cancelar união</button><button className="button button-primary" disabled={busy || !ready} onClick={() => setConfirm(true)}>Revisar e juntar</button></div>
    {batch && <ConfirmDialog title="Preferir esta versão?" confirmLabel="Aplicar preferência" variant="primary" onCancel={() => setBatch(null)} onConfirm={() => { setChoices(current => ({ ...current, ...Object.fromEntries(preview.books.filter(book => book.variants.some(variant => variant.sourceId === batch)).map(book => [book.id, batch])) })); setBatch(null); }}>
      <p>{preview.books.filter(book => book.variants.some(variant => variant.sourceId === batch)).length} livros usarão a versão de {label(batch)}. Os demais livros conservarão suas escolhas; nada será salvo ainda.</p>
    </ConfirmDialog>}
    {confirm && <ConfirmDialog title="Juntar as bibliotecas?" confirmLabel="Confirmar união" variant="primary" busy={busy} onCancel={() => setConfirm(false)} onConfirm={() => { setConfirm(false); onConfirm({ books: preview.books.map(book => ({ bookId: book.id, sourceId: choices[book.id]! })), preferencesSourceId: preferences, includeUnbased }); }}>
      <p>{included} livros serão salvos neste dispositivo. A biblioteca anterior ficará preservada para recuperação. O envio ao Drive será feito quando houver conexão; versões remotas existentes serão mantidas.</p>
    </ConfirmDialog>}
  </section>;
}
