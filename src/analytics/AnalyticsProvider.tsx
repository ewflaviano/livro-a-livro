import { getPwaState } from '../pwa/register';
import { getUiOccupancy } from '../ui/interaction-guard';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { disableAnalytics, suspendAnalytics, enableAnalytics, recordPublicPage } from './ga4';
import { openAnalyticsConsentStore, type AnalyticsChoice } from './consent';

type View = { choice: AnalyticsChoice; loading: boolean; saving: boolean; error: boolean; reviewing: boolean; reloadSuggested: boolean; reload: () => void;
  choose: (choice: Exclude<AnalyticsChoice, null>) => Promise<void>; retry: () => void; review: () => void; closeReview: () => void };
const Context = createContext<View | null>(null);
export function AnalyticsProvider({ children }: { children: ReactNode }) {
  const location = useLocation(); const path = useRef(location.pathname); path.current = location.pathname;
  const [choice, setChoice] = useState<AnalyticsChoice>(null); const choiceRef = useRef<AnalyticsChoice>(null); const readyRef = useRef(false); const writing = useRef<Promise<void> | null>(null);
  const [loading, setLoading] = useState(true); const [tagReady, setTagReady] = useState(false); const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false); const [reviewing, setReviewing] = useState(false); const [reloadSuggested, setReloadSuggested] = useState(false);
  const store = useRef<Awaited<ReturnType<typeof openAnalyticsConsentStore>> | null>(null);
  const lastRecorded = useRef<string | null>(null); const reviewTrigger = useRef<HTMLElement | null>(null);
  function restoreReviewFocus() { const target = reviewTrigger.current; reviewTrigger.current = null; queueMicrotask(() => { if (target?.isConnected) target.focus(); }); }
  const request = useRef(0); const active = useRef(false); const pendingChoice = useRef<Exclude<AnalyticsChoice, null> | null>(null);
  async function activate(value: AnalyticsChoice, ticket: number) {
    readyRef.current = false; setTagReady(false);
    if (value !== 'accepted') { disableAnalytics(); return; }
    const ready = await enableAnalytics(path.current);
    if (ticket !== request.current) return;
    if (!ready) { suspendAnalytics(); setError(true); return; }
    readyRef.current = true; setTagReady(true);
  }
  const safeToReopen = () => !getPwaState().blocked && !getPwaState().operationPending && getPwaState().update !== 'applying' && getUiOccupancy() === 0 && document.visibilityState !== 'hidden';
  function reopenAfterRevoke() {
    if (safeToReopen()) window.location.reload();
    else setReloadSuggested(true);
  }
  async function refresh() {
    const ticket = ++request.current; suspendAnalytics(); readyRef.current = false; setTagReady(false);
    try {
      await writing.current;
      if (!store.current) throw new Error('StorageUnavailable');
      const next = await store.current.read();
      if (ticket !== request.current || !active.current) return;
      const previous = choiceRef.current;
      if (next === previous && (next !== 'accepted' || readyRef.current)) { setLoading(false); setError(false); return; }
      choiceRef.current = next ?? null; setChoice(next ?? null); setLoading(false); setError(false);
      if (previous === 'accepted' && next === 'rejected') { lastRecorded.current = null; disableAnalytics(); readyRef.current = false; setTagReady(false); reopenAfterRevoke(); return; }
      await activate(next ?? null, ticket);
    } catch {
      if (ticket !== request.current || !active.current) return;
      disableAnalytics(); readyRef.current = false; setTagReady(false); setLoading(false); setError(true);
    }
  }
  async function openStore() {
    if (store.current) { await refresh(); return; }
    try {
      const next = await openAnalyticsConsentStore();
      if (!active.current) { next.close(); return; }
      store.current = next;
      unsubscribe.current = next.subscribe(() => { void refresh(); });
      await refresh();
    } catch { if (active.current) { disableAnalytics(); readyRef.current = false; setTagReady(false); setLoading(false); setError(true); } }
  }
  const unsubscribe = useRef<() => void>(() => {});
  useEffect(() => {
    active.current = true; void openStore();
    const onFocus = () => { if (store.current) void refresh(); };
    window.addEventListener('focus', onFocus);
    return () => { window.removeEventListener('focus', onFocus); active.current = false; ++request.current; unsubscribe.current(); store.current?.close(); store.current = null; suspendAnalytics(); };
  }, []);
  useEffect(() => {
    if (!tagReady || loading || error || choice !== 'accepted' || lastRecorded.current === location.pathname) return;
    recordPublicPage(location.pathname); lastRecorded.current = location.pathname;
  }, [location.pathname, tagReady, loading, error, choice]);
  async function choose(next: Exclude<AnalyticsChoice, null>) {
    if (!store.current || saving) { setError(true); return; }
    if (choiceRef.current === next && !error) { setReviewing(false); return; }
    const ticket = ++request.current; const wasAccepted = choiceRef.current === 'accepted'; setSaving(true); if (next === 'rejected') disableAnalytics(); else suspendAnalytics();
    let pending: Promise<void> | null = null;
    try {
      pending = store.current.write(next); writing.current = pending; await pending;
      pendingChoice.current = null;
      if (ticket !== request.current || !active.current) return;
      choiceRef.current = next; setChoice(next); setError(false); setReviewing(false); restoreReviewFocus();
      if (wasAccepted && next === 'rejected') { lastRecorded.current = null; reopenAfterRevoke(); return; }
      await activate(next, ticket);
    } catch { pendingChoice.current = next; if (ticket === request.current && active.current) { if (next === 'accepted') suspendAnalytics(); else disableAnalytics(); readyRef.current = false; setTagReady(false); setError(true); } }
    finally { if (writing.current === pending) writing.current = null; if (active.current) setSaving(false); }
  }
  return <Context.Provider value={{ choice, loading, saving, error, reviewing, reloadSuggested, reload: () => { if (safeToReopen()) window.location.reload(); }, choose, retry: () => { if (pendingChoice.current) void choose(pendingChoice.current); else void openStore(); }, review: () => { reviewTrigger.current = document.activeElement as HTMLElement | null; setReviewing(true); }, closeReview: () => { setReviewing(false); restoreReviewFocus(); } }}>{children}</Context.Provider>;
}
export function useAnalytics() { const view = useContext(Context); if (!view) throw new Error('AnalyticsProvider required'); return view; }
