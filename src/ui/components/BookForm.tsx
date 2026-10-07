import { occupyUi } from '../interaction-guard';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { BOOK_LIMITS, type Book, type NewBook, type ReadingStatus } from '../../domain/book';
import { DomainError } from '../../domain/errors';
import type { LocalRevision } from '../../ports/library-repository';
import type { LibraryService } from '../../services/library-service';
import { ConfirmDialog } from './ConfirmDialog';
import { blockPwaUpdate } from '../../pwa/register';
import { prepareCover, type CoverMedia } from '../../media/cover';
import { useLocale } from '../../i18n/context';
import { formatNumber } from '../../i18n/locale';
import type { MessageKey } from '../../i18n/messages';

const fieldMessages: Record<string, MessageKey> = {
  title: 'validationTitle', authors: 'validationAuthors', shelfYear: 'validationShelfYear',
  pageCount: 'validationPages', isbn: 'validationIsbn', publicationYear: 'validationPublicationYear', note: 'validationNote',
};

export function storageErrorKey(error: unknown): MessageKey {
  if (error instanceof DomainError) {
    if (error.code === 'StaleRevision') return 'staleRevision';
    if (error.code === 'QuotaExceeded') return 'quotaExceeded';
    if (error.code === 'ImportTooLarge') return 'storageLimit';
  }
  return 'saveFailed';
}

function makeDraft(book: NewBook | undefined, year: number) {
  return { title: book?.title ?? '', authors: book?.authors?.join('\n') ?? '',
    status: book?.status ?? 'read' as ReadingStatus, shelfYear: String(book?.shelfYear ?? year),
    pageCount: book?.pageCount?.toString() ?? '', isbn: book?.isbn ?? '',
    publicationYear: book?.publicationYear?.toString() ?? '', startedOn: book?.startedOn ?? '',
    finishedOn: book?.finishedOn ?? '', rating: book?.rating?.toString() ?? '', note: book?.note ?? '' };
}

export function BookForm({ book, initialDraft, year, version, service, onSaved, onCancel, onReload, cancelLabel }: {
  book?: Book; initialDraft?: NewBook; year: number; version: LocalRevision; service: LibraryService;
  onSaved: (book: Book, version: LocalRevision) => void; onCancel: () => void; onReload: () => void; cancelLabel?: string;
}) {
  const { t, locale } = useLocale();
  const [initial] = useState(() => makeDraft(book ?? initialDraft, year));
  const [draft, setDraft] = useState(initial);
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const [error, setError] = useState<MessageKey | null>(null);
  const [invalid, setInvalid] = useState<string[]>([]);
  const [duplicates, setDuplicates] = useState(0);
  const [dialog, setDialog] = useState<'cancel' | 'reload' | 'drop-dates' | null>(null);
  const [duplicateAfterDates, setDuplicateAfterDates] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [localCover, setLocalCover] = useState<CoverMedia | null>(null);
  const [coverPreparing, setCoverPreparing] = useState(false);
  const coverSelection = useRef(0);
  useEffect(() => () => { coverSelection.current++; }, []);
  const form = useRef<HTMLFormElement>(null);
  useEffect(occupyUi, []);
  const dirty = coverPreparing || localCover !== null || JSON.stringify(initial) !== JSON.stringify(draft);
  useEffect(() => { if (dirty || busy) return blockPwaUpdate(); }, [dirty, busy]);
  useEffect(() => { form.current?.querySelector('input')?.focus({ preventScroll: true }); }, []);
  useEffect(() => {
    if (busy || invalid.length === 0) return;
    if (invalid.some((field) => ['pageCount', 'isbn', 'publicationYear', 'note', 'rating'].includes(field))) {
      const details = form.current?.querySelector('details');
      if (details) details.open = true;
    }
    const first = form.current?.querySelector<HTMLElement>(`[name="${invalid[0]}"]`);
    if (first instanceof HTMLElement) first.focus();
  }, [invalid, busy]);
  useEffect(() => {
    if (!dirty) return;
    const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    const guardLink = (event: MouseEvent) => {
      const link = (event.target as Element).closest('a');
      if (!link || link.classList.contains('skip-link') || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      if (saving.current) { event.preventDefault(); event.stopPropagation(); return; }
      if (!window.confirm(t('discardUnsavedLeave'))) { event.preventDefault(); event.stopPropagation(); }
    };
    window.addEventListener('beforeunload', guard);
    document.addEventListener('click', guardLink, true);
    return () => { window.removeEventListener('beforeunload', guard); document.removeEventListener('click', guardLink, true); };
  }, [dirty, t]);
  const change = (name: keyof typeof draft, value: string) => {
    setDraft((previous) => ({ ...previous, [name]: value }));
    setDuplicates(0); setInvalid([]); setError(null);
  };
  async function save(allowDuplicate = false, dropDates = false) {
    if (saving.current || coverPreparing) return;
    const datesConflict = Boolean((draft.startedOn && draft.status === 'want-to-read') ||
      (draft.finishedOn && (draft.status !== 'read' || draft.finishedOn.slice(0, 4) !== draft.shelfYear)));
    if (datesConflict && !dropDates) { setDuplicateAfterDates(allowDuplicate); setDialog('drop-dates'); return; }
    saving.current = true; setBusy(true); setError(null); setInvalid([]);
    const numberOrNull = (value: string) => value === '' ? null : Number(value);
    const input: NewBook = { title: draft.title, authors: draft.authors.split('\n').filter((author) => author.trim().length > 0),
      status: draft.status, shelfYear: Number(draft.shelfYear), pageCount: numberOrNull(draft.pageCount),
      isbn: draft.isbn || null, publicationYear: numberOrNull(draft.publicationYear),
      startedOn: dropDates && draft.status === 'want-to-read' ? null : draft.startedOn || null,
      finishedOn: dropDates && (draft.status !== 'read' || draft.finishedOn.slice(0, 4) !== draft.shelfYear) ? null : draft.finishedOn || null,
      rating: numberOrNull(draft.rating) as Book['rating'], note: draft.note,
      ...(initialDraft ? { cover: initialDraft.cover, source: initialDraft.source } : book ? { cover: book.cover, source: book.source } : {}) };
    try {
      if (localCover) {
        input.cover = { provider: 'local', mediaId: localCover.id };
      }
      const result = await service.save({ draft: input, id: book?.id, year, expected: version, allowDuplicate, coverMedia: localCover ?? undefined });
      if (result.kind === 'duplicate') setDuplicates(result.count);
      else onSaved(result.book, result.version);
    } catch (failure) {
      if (failure instanceof DomainError && failure.code === 'InvalidBook') {
        const fields = [...new Set(failure.issues.map((issue) => String(issue.path[0])))];
        setInvalid(fields); setError('reviewFields');
      } else { setError(storageErrorKey(failure)); setConflict(failure instanceof DomainError && failure.code === 'StaleRevision'); }
    } finally { saving.current = false; setBusy(false); }
  }
  // Referenced by aria-describedby; excluded from the enclosing label's name.
  const fieldError = (name: string) => invalid.includes(name) && fieldMessages[name] ? <span className="field-error" aria-hidden="true" id={`${name}-error`}>{t(fieldMessages[name])}</span> : null;
  const attributes = (name: string) => ({ name, id: `book-${name}`, 'aria-invalid': invalid.includes(name),
    'aria-describedby': invalid.includes(name) ? `${name}-error` : undefined });
  const numberField = (name: 'pageCount' | 'publicationYear', label: string) =>
    <label className="form-field">{label}<input {...attributes(name)} type="number" min="1" max={name === 'pageCount' ? BOOK_LIMITS.pageCount : 9999}
      step="1" value={draft[name]} placeholder={name === 'pageCount' && (initialDraft?.source || book?.source) && !draft.pageCount ? t('notProvided') : undefined}
      onChange={(event) => change(name, event.target.value)} />{fieldError(name)}</label>;
  return <>
    <form className="book-form" ref={form} noValidate onSubmit={(event: FormEvent) => { event.preventDefault(); void save(); }} aria-busy={busy || coverPreparing}>
      {(coverPreparing || busy || dirty) && <p className="local-note" role="status">{coverPreparing ? t('preparingCover') : busy ? t('saving') : t('unsavedChanges')}</p>}
      <fieldset disabled={busy}>
        <legend className="visually-hidden">{t('bookRecord')}</legend>
        <label className="form-field">{t('titleRequired')}<input {...attributes('title')} required maxLength={BOOK_LIMITS.title} value={draft.title} onChange={(event) => change('title', event.target.value)} />{fieldError('title')}</label>
        <label className="form-field">{t('authorsOptional')}<textarea {...attributes('authors')} rows={2} value={draft.authors} onChange={(event) => change('authors', event.target.value)} />{fieldError('authors')}</label>
        <div className="form-columns book-primary-choices">
          <fieldset className="status-field"><legend>{t('status')}</legend><div className="status-options">
            {([['want-to-read', t('wantToRead')], ['reading', t('reading')], ['read', t('readSingular')]] as const).map(([value, label]) =>
              <label key={value} className="status-option"><input type="radio" name="status" value={value} checked={draft.status === value}
                onChange={() => change('status', value)} /><span>{label}</span></label>)}
          </div></fieldset>
          <div className="year-choice"><label htmlFor="book-shelfYear">{t('shelfYear')}</label>
            <div className="year-stepper">
              <button type="button" aria-label={t('previousYear')} disabled={Number(draft.shelfYear) <= 1}
                onClick={() => change('shelfYear', String(Number(draft.shelfYear || year) - 1))}>−</button>
              <input {...attributes('shelfYear')} type="number" min="1" max="9999" step="1" required inputMode="numeric"
                value={draft.shelfYear} onChange={(event) => change('shelfYear', event.target.value)} />
              <button type="button" aria-label={t('nextYear')} disabled={Number(draft.shelfYear) >= 9999}
                onClick={() => change('shelfYear', String(Number(draft.shelfYear || year) + 1))}>+</button>
            </div>{fieldError('shelfYear')}
          </div>
        </div>
        <details open={Boolean(book)}><summary>{t('moreDetailsOptional')}</summary>
          <label className="form-field">{t('coverOptional')}<input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => {
            const element = event.currentTarget; const file = element.files?.[0]; if (!file) return;
            const selected = ++coverSelection.current; setCoverPreparing(true); setError(null);
            void prepareCover(file, new Date().toISOString()).then(value => {
              if (selected !== coverSelection.current) return;
              setLocalCover(value); setDuplicates(0);
            }).catch(() => {
              if (selected !== coverSelection.current) return;
              setError('invalidCover'); element.value = '';
            }).finally(() => { if (selected === coverSelection.current) setCoverPreparing(false); });
          }} />{localCover && <span className="field-help">{t('coverReady', { width: localCover.width, height: localCover.height })}</span>}</label>
          <div className="form-columns">{numberField('pageCount', t('pages'))}{numberField('publicationYear', t('publicationYear'))}</div>
          <label className="form-field">ISBN<input {...attributes('isbn')} value={draft.isbn} onChange={(event) => change('isbn', event.target.value)} />{fieldError('isbn')}</label>
          <fieldset className="rating-field"><legend>{t('myRating')}</legend><div className="rating-options">
            {[1, 2, 3, 4, 5].map((rating) => <label key={rating} className="rating-option"><input type="radio" name="rating" value={rating} aria-label={t('starsOutOfFive', { rating })} checked={draft.rating === String(rating)} onChange={() => change('rating', String(rating))} />
              <span aria-hidden="true">{Number(draft.rating) >= rating ? '★' : '☆'}</span></label>)}
            {draft.rating && <button className="button button-quiet rating-clear" type="button" onClick={() => change('rating', '')}>{t('clear')}</button>}
          </div></fieldset>
          <label className="form-field">{t('notes')}<textarea {...attributes('note')} rows={6} maxLength={BOOK_LIMITS.note} value={draft.note} onChange={(event) => change('note', event.target.value)} />{fieldError('note')}</label>
        </details>
      </fieldset>
      {error && <p className="form-error" role="alert">{t(error)}</p>}
      {conflict && <button type="button" className="button button-secondary" disabled={busy} onClick={() => setDialog('reload')}>{t('reloadSaved')}</button>}
      {duplicates > 0 && <div className="notice-panel" role="status"><p>{t(duplicates === 1 ? 'duplicateWarningOne' : 'duplicateWarningMany', { count: formatNumber(locale, duplicates) })}</p>
        <button type="button" className="button button-secondary" disabled={busy || coverPreparing} onClick={() => void save(true)}>{t('saveAnyway')}</button></div>}
      <div className="form-actions"><button className="button button-primary" type="submit" disabled={busy || coverPreparing}>{busy ? t('saving') : book ? t('saveChanges') : t('saveBook')}</button>
        <button className="button button-secondary" type="button" disabled={busy} onClick={() => dirty ? setDialog('cancel') : onCancel()}>{cancelLabel ?? t('cancel')}</button></div>
    </form>
    {dialog && <ConfirmDialog title={dialog === 'reload' ? t('reloadSavedQuestion') : dialog === 'drop-dates' ? t('removePreviousDatesQuestion') : t('discardChangesQuestion')}
      confirmLabel={dialog === 'reload' ? t('discardDraftReload') : dialog === 'drop-dates' ? t('removeDatesSave') : t('discardChanges')}
      variant={dialog === 'drop-dates' ? 'primary' : 'danger'} onCancel={() => setDialog(null)}
      onConfirm={() => { if (dialog === 'reload') onReload(); else if (dialog === 'drop-dates') {
        setDraft(previous => ({ ...previous, startedOn: previous.status === 'want-to-read' ? '' : previous.startedOn,
          finishedOn: previous.status !== 'read' || previous.finishedOn.slice(0, 4) !== previous.shelfYear ? '' : previous.finishedOn }));
        setDialog(null); void save(duplicateAfterDates, true);
      } else onCancel(); }}>
      <p>{dialog === 'drop-dates' ? t('datesConflictExplanation') : t('discardDraftExplanation')}</p>
    </ConfirmDialog>}
  </>;
}
