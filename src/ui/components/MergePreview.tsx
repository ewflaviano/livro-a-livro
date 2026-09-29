import type { ResolutionPreview } from '../../sync/merge';
import { ConfirmDialog } from './ConfirmDialog';
import { useLocale } from '../../i18n/context';
import { formatNumber, pluralCategory } from '../../i18n/locale';

export function MergePreview({ preview, busy, error, accountChanged, onCancel, onConfirm }: {
  preview: ResolutionPreview; busy: boolean; error: string; accountChanged?: boolean;
  onCancel: () => void; onConfirm: () => void;
}) {
  const { t, locale } = useLocale();
  const bookCount = (count: number) => t(pluralCategory(locale, count) === 'one' ? 'backupBookOne' : 'backupBooks', { count: formatNumber(locale, count) });
  const added = t(pluralCategory(locale, preview.addedCount) === 'one' ? 'mergeAddedOne' : 'mergeAddedMany', { count: formatNumber(locale, preview.addedCount) });
  const divergent = t(pluralCategory(locale, preview.divergentCount) === 'one' ? 'mergeDivergentOne' : 'mergeDivergentMany', { count: formatNumber(locale, preview.divergentCount) });
  return <ConfirmDialog title={t('mergeQuestion')} confirmLabel={t('mergeLibraries')} variant="primary" busy={busy} onCancel={onCancel} onConfirm={() => onConfirm()}>
    <p>{t('mergeTotalStart')} <strong>{bookCount(preview.totalCount)}</strong>{t('mergeTotalEnd', { added })}</p>
    <p>{divergent} {t('mergeLocalWins')}</p>
    <p>{t('mergePreferences')}</p>
    {preview.remoteOnlyDivergentCount > 0 && <p className="notice-panel">{t('mergeRemoteOnly')}</p>}
    {accountChanged && <p className="notice-panel">{t('mergeAccountChanged')}</p>}
    <p>{t('mergeRecovery')}</p>
    {error && <p role="alert">{error}</p>}
  </ConfirmDialog>;
}
