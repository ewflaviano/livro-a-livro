import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { DEFAULT_LOCALE, resolveLocale, type Locale } from './locale';
import { message, type MessageKey } from './messages';
import { openLocaleStore } from './store';
import { startInstallObservation } from '../pwa/install';
import { registerPwa } from '../pwa/register';

const LocaleContext = createContext<Locale>(DEFAULT_LOCALE);

type Preference = {
  choice: Locale | null;
  available: boolean;
  saving: boolean;
  error: boolean;
  suggestChoice: boolean;
  choose(locale: Locale): Promise<void>;
};
const PreferenceContext = createContext<Preference | null>(null);

function browserLanguages(): readonly string[] {
  return navigator.languages?.length ? navigator.languages : navigator.language ? [navigator.language] : [];
}

/** Apply public metadata before mounting the app or observing the install prompt. */
export function applyDocumentLocale(locale: Locale) {
  document.documentElement.lang = locale;
  document.querySelector<HTMLMetaElement>('meta[name="description"]')?.setAttribute('content',
    locale === 'en' ? 'A personal shelf to keep the story of the books you read.' : 'Uma estante pessoal para guardar a história dos livros que você lê.');
  let manifest = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
  if (!manifest) {
    manifest = document.createElement('link');
    manifest.rel = 'manifest';
    document.head.append(manifest);
  }
  const path = locale === 'en' ? '/manifest-en.webmanifest' : '/manifest.webmanifest';
  if (manifest.getAttribute('href') !== path) manifest.href = path;
}

type Ready = { locale: Locale; choice: Locale | null; session: string | null; available: boolean };

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState<Ready | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const store = useRef<Awaited<ReturnType<typeof openLocaleStore>> | null>(null);
  const revision = useRef(0);
  const refresh = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    let live = true;
    let settled = false;
    let timedOut = false;
    let unsubscribe = () => {};
    const show = (next: Ready) => {
      if (!live) return;
      applyDocumentLocale(next.locale);
      startInstallObservation();
      if (import.meta.env.PROD) void registerPwa();
      setReady(next);
    };
    const reload = async () => {
      const current = ++revision.current;
      try {
        const stored = await store.current!.read();
        if (live && !timedOut && current === revision.current) {
          settled = true;
          window.clearTimeout(timeout);
          show({ choice: stored.choice, session: stored.session, available: true,
            locale: resolveLocale(stored.choice, browserLanguages()) });
        }
      } catch {
        if (live && !timedOut && current === revision.current) {
          settled = true;
          window.clearTimeout(timeout);
          setError(true);
          show({ choice: null, session: null, available: false, locale: DEFAULT_LOCALE });
        }
      }
    };
    refresh.current = reload;
    const timeout = window.setTimeout(() => {
      if (!live || settled) return;
      settled = true;
      timedOut = true;
      unsubscribe();
      store.current?.close();
      store.current = null;
      setError(true);
      show({ choice: null, session: null, available: false, locale: DEFAULT_LOCALE });
    }, 4000);
    void openLocaleStore().then(async opened => {
      if (!live || timedOut) { opened.close(); return; }
      store.current = opened;
      unsubscribe = opened.subscribe(() => { void reload(); });
      window.addEventListener('focus', reload);
      await reload();
    }).catch(() => {
      if (!live || timedOut) return;
      settled = true;
      window.clearTimeout(timeout);
      setError(true);
      show({ choice: null, session: null, available: false, locale: DEFAULT_LOCALE });
    });
    return () => {
      live = false;
      window.clearTimeout(timeout);
      revision.current++;
      window.removeEventListener('focus', reload);
      unsubscribe();
      store.current?.close();
      store.current = null;
    };
  }, []);

  const choose = useCallback(async (locale: Locale) => {
    if (!ready?.session || !store.current) { setError(true); return; }
    setSaving(true);
    try {
      await store.current.write(locale, ready.session);
      setError(false);
      await refresh.current();
    } catch {
      setError(true);
      await refresh.current();
    } finally { setSaving(false); }
  }, [ready?.session]);

  if (!ready) return null;
  const preference: Preference = { choice: ready.choice, available: ready.available, saving, error,
    suggestChoice: ready.available && ready.choice === null && resolveLocale(null, browserLanguages()) === 'en', choose };
  return <PreferenceContext.Provider value={preference}><LocaleContext.Provider value={ready.locale}>{children}</LocaleContext.Provider></PreferenceContext.Provider>;
}

/** Static preview for component tests and editorial review. */
export function LocalePreview({ locale, children }: { locale: Locale; children: ReactNode }) {
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}

export function useLocalePreference() { return useContext(PreferenceContext); }

export function useLocale() {
  const locale = useContext(LocaleContext);
  const t = useCallback((key: MessageKey, values?: Record<string, string | number>) => message(locale, key, values), [locale]);
  return { locale, t };
}
