import { createContext, useCallback, useContext, type ReactNode } from 'react';
import { DEFAULT_LOCALE, type Locale } from './locale';
import { message, type MessageKey } from './messages';

const LocaleContext = createContext<Locale>(DEFAULT_LOCALE);

/** Kept at PT in production until every app flow and public document is translated. */
export function LocalePreview({ locale, children }: { locale: Locale; children: ReactNode }) {
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}

export function useLocale() {
  const locale = useContext(LocaleContext);
  const t = useCallback((key: MessageKey, values?: Record<string, string | number>) => message(locale, key, values), [locale]);
  return { locale, t };
}
