import { getPwaState } from '../pwa/register';
import { getUiOccupancy } from '../ui/interaction-guard';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { disableAnalytics, suspendAnalytics, enableAnalytics, recordPublicPage } from './ga4';
import { openAnalyticsConsentStore, type AnalyticsChoice } from './consent';
import { diagnosticsClient } from '../diagnostics/client';

type View = { choice: AnalyticsChoice; loading: boolean; saving: boolean; error: boolean; analyticsUnavailable: boolean; reviewing: boolean; reloadSuggested: boolean; reload: () => void;
  choose: (choice: Exclude<AnalyticsChoice, null>) => Promise<void>; retry: () => void; review: () => void; closeReview: () => void };
const Context = createContext<View | null>(null);
export function AnalyticsProvider({ children }: { children: ReactNode }) {
  const location = useLocation(); const path = useRef(location.pathname); path.current = location.pathname;
  const [choice, setChoice] = useState<AnalyticsChoice>(null); const choiceRef = useRef<AnalyticsChoice>(null); const readyRef = useRef(false); const writing = useRef<Promise<void> | null>(null);
  const [loading, setLoading] = useState(true); const [tagReady, setTagReady] = useState(false); const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false); const [reviewing, setReviewing] = useState(false); const [reloadSuggested, setReloadSuggested] = useState(false);
  const [analyticsUnavailable, setAnalyticsUnavailable] = useState(false);
  const store = useRef<Awaited<ReturnType<typeof openAnalyticsConsentStore>> | null>(null);
  const opening = useRef<Promise<void> | null>(null);
  const lastRecorded = useRef<string | null>(null); const reviewTrigger = useRef<HTMLElement | null>(null);
  function restoreReviewFocus() { const target = reviewTrigger.current; reviewTrigger.current = null; queueMicrotask(() => { if (target?.isConnected) target.focus(); }); }
  const request = useRef(0); const active = useRef(false); const pendingChoice = useRef<Exclude<AnalyticsChoice, null> | null>(null);
  const savingRef = useRef(false); const revocationPending = useRef(false); const queuedRejection = useRef(false);
  async function activate(value: AnalyticsChoice, ticket: number) {
    readyRef.current = false; setTagReady(false); setAnalyticsUnavailable(false);
    if (value !== 'accepted') { disableAnalytics(); return; }
    let ready = false;
    try { ready = await enableAnalytics(path.current); } catch { /* Script load failures do not revoke durable diagnostic consent. */ }
    if (ticket !== request.current) return;
    if (!ready) { suspendAnalytics(); setAnalyticsUnavailable(true); return; }
    readyRef.current = true; setTagReady(true);
  }
  const safeToReopen = () => !getPwaState().blocked && !getPwaState().operationPending && getPwaState().update !== 'applying' && getUiOccupancy() === 0 && document.visibilityState !== 'hidden';
  function reopenAfterRevoke() {
    if (safeToReopen()) window.location.reload();
    else setReloadSuggested(true);
  }
  async function refresh() {
    const ticket = ++request.current; suspendAnalytics(); diagnosticsClient.setEnabled(false); readyRef.current = false; setTagReady(false);
    try {
      await writing.current;
      if (!store.current) throw new Error('StorageUnavailable');
      const next = await store.current.read();
      if (ticket !== request.current || !active.current) return;
      const previous = choiceRef.current;
      if (next === 'rejected') revocationPending.current = false;
      choiceRef.current = next ?? null; setChoice(next ?? null); setLoading(false); setError(revocationPending.current);
      if (previous === 'accepted' && next === 'rejected') { lastRecorded.current = null; disableAnalytics(); setAnalyticsUnavailable(false); readyRef.current = false; setTagReady(false); reopenAfterRevoke(); return; }
      if (revocationPending.current) return;
      diagnosticsClient.setEnabled(next === 'accepted');
      await activate(next ?? null, ticket);
    } catch {
      if (ticket !== request.current || !active.current) return;
      disableAnalytics(); diagnosticsClient.setEnabled(false); readyRef.current = false; setTagReady(false); setAnalyticsUnavailable(false); setLoading(false); setError(true);
    }
  }
  function openStore(): Promise<void> {
    if (opening.current) return opening.current;
    const task = (async () => {
      try {
        if (!store.current) {
          const next = await openAnalyticsConsentStore();
          if (!active.current) { next.close(); return; }
          store.current = next;
          unsubscribe.current = next.subscribe(() => { void refresh(); });
        }
        await refresh();
      } catch { if (active.current) { disableAnalytics(); diagnosticsClient.setEnabled(false); readyRef.current = false; setTagReady(false); setAnalyticsUnavailable(false); setLoading(false); setError(true); } }
    })();
    opening.current = task;
    void task.finally(() => { if (opening.current === task) opening.current = null; });
    return task;
  }
  const unsubscribe = useRef<() => void>(() => {});
  useEffect(() => {
    active.current = true; void openStore();
    const onFocus = () => { if (store.current) void refresh(); };
    window.addEventListener('focus', onFocus);
    return () => { window.removeEventListener('focus', onFocus); active.current = false; ++request.current; unsubscribe.current(); store.current?.close(); store.current = null; suspendAnalytics(); diagnosticsClient.setEnabled(false); };
  }, []);
  useEffect(() => {
    if (!tagReady || loading || error || choice !== 'accepted' || lastRecorded.current === location.pathname) return;
    recordPublicPage(location.pathname); lastRecorded.current = location.pathname;
  }, [location.pathname, tagReady, loading, error, choice]);
  async function choose(next: Exclude<AnalyticsChoice, null>) {
    if (next === 'rejected') { revocationPending.current = true; disableAnalytics(); diagnosticsClient.setEnabled(false); setAnalyticsUnavailable(false); }
    if (next === 'accepted' && revocationPending.current) return;
    if (savingRef.current) { if (next === 'rejected') queuedRejection.current = true; return; }
    if (!store.current) { setError(true); return; }
    if (choiceRef.current === next && !error && !revocationPending.current) { setReviewing(false); restoreReviewFocus(); return; }
    savingRef.current = true;
    const ticket = ++request.current; const wasAccepted = choiceRef.current === 'accepted'; setSaving(true); suspendAnalytics(); diagnosticsClient.setEnabled(false);
    let pending: Promise<void> | null = null; let writeReleased = false;
    try {
      pending = store.current.write(next); writing.current = pending; await pending;
      if (writing.current === pending) writing.current = null;
      writeReleased = true;
      savingRef.current = false; if (active.current) setSaving(false);
      if (queuedRejection.current) { queuedRejection.current = false; void choose('rejected'); return; }
      pendingChoice.current = null;
      if (ticket !== request.current || !active.current) return;
      if (!queuedRejection.current) revocationPending.current = false;
      choiceRef.current = next; setChoice(next); setError(revocationPending.current); setReviewing(false); restoreReviewFocus();
      if (wasAccepted && next === 'rejected') { lastRecorded.current = null; reopenAfterRevoke(); return; }
      if (!revocationPending.current) diagnosticsClient.setEnabled(next === 'accepted');
      if (!revocationPending.current) void activate(next, ticket);
    } catch { pendingChoice.current = next; if (ticket === request.current && active.current) { if (next === 'accepted') suspendAnalytics(); else disableAnalytics(); diagnosticsClient.setEnabled(false); readyRef.current = false; setTagReady(false); setError(true); } }
    finally { if (!writeReleased) { if (writing.current === pending) writing.current = null; savingRef.current = false; if (active.current) setSaving(false);
      if (active.current && queuedRejection.current) { queuedRejection.current = false; void choose('rejected'); } } }
  }
  return <Context.Provider value={{ choice, loading, saving, error, analyticsUnavailable, reviewing, reloadSuggested, reload: () => { if (safeToReopen()) window.location.reload(); }, choose, retry: () => { if (revocationPending.current) void openStore().then(() => choose('rejected')); else if (pendingChoice.current) void choose(pendingChoice.current); else void openStore(); }, review: () => { reviewTrigger.current = document.activeElement as HTMLElement | null; setReviewing(true); }, closeReview: () => { setReviewing(false); restoreReviewFocus(); } }}>{children}</Context.Provider>;
}
export function useAnalytics() { const view = useContext(Context); if (!view) throw new Error('AnalyticsProvider required'); return view; }
