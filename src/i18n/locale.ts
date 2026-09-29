export type Locale = 'pt-BR' | 'en';

export const DEFAULT_LOCALE: Locale = 'pt-BR';

/** An explicit local choice wins; browser languages are only a first-visit hint. */
export function resolveLocale(choice: Locale | null, languages: readonly string[]): Locale {
  if (choice) return choice;
  const first = languages[0]?.toLowerCase();
  return first === 'en' || first?.startsWith('en-') ? 'en' : DEFAULT_LOCALE;
}

export function formatNumber(locale: Locale, value: number): string {
  return new Intl.NumberFormat(locale).format(value);
}

export function formatDate(locale: Locale, value: Date, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(locale, options).format(value);
}

export function pluralCategory(locale: Locale, count: number): Intl.LDMLPluralRule {
  // Portuguese CLDR groups zero with singular; UI counts read more naturally in plural.
  if (locale === 'pt-BR' && count === 0) return 'other';
  return new Intl.PluralRules(locale).select(count);
}
