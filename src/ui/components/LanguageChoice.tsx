import { useLocale, useLocalePreference } from '../../i18n/context';
import type { Locale } from '../../i18n/locale';

function Choices() {
  const preference = useLocalePreference();
  const { t } = useLocale();
  if (!preference) return null;
  return <>
    <div className="segmented-control" role="group" aria-label={t('language')}>
      {(['pt-BR', 'en'] as const).map((locale: Locale) => <button key={locale} type="button"
        aria-pressed={preference.choice === locale} disabled={!preference.available || preference.saving}
        onClick={() => void preference.choose(locale)}>{t(locale === 'en' ? 'english' : 'portuguese')}</button>)}
    </div>
    {preference.error && <p role="alert">{t('languageSaveFailed')}</p>}
  </>;
}

export function FirstVisitLanguageChoice() {
  const preference = useLocalePreference();
  const { t } = useLocale();
  if (!preference?.suggestChoice) return null;
  return <section className="language-choice-banner" aria-labelledby="first-language-title">
    <h2 id="first-language-title">{t('language')}</h2>
    <p>{t('languagePrompt')}</p>
    <Choices />
  </section>;
}

export function SettingsLanguageChoice() {
  const preference = useLocalePreference();
  const { t } = useLocale();
  if (!preference) return null;
  return <section aria-labelledby="settings-language-title">
    <h2 id="settings-language-title">{t('language')}</h2>
    <p>{t('languageHint')}</p>
    <Choices />
  </section>;
}
