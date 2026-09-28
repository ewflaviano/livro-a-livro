import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { diagnosticsClient, recordDiagnostic } from './client';
import { openDiagnosticsConsentStore, type DiagnosticsChoice } from './consent';

type View = { choice: DiagnosticsChoice; loading: boolean; saving: boolean; error: boolean; reviewing: boolean;
  choose: (choice: Exclude<DiagnosticsChoice, null>) => Promise<void>; retry: () => void; review: () => void; closeReview: () => void };
const Context = createContext<View | null>(null);
let lastRenderFailure = 0;
export function reportRenderFailure() { lastRenderFailure = Date.now(); recordDiagnostic({ area: 'runtime', code: 'render_failure' }); }

export function DiagnosticsProvider({ children }: { children: ReactNode }) {
  const [choice, setChoice] = useState<DiagnosticsChoice>(null);
  const [loading, setLoading] = useState(true); const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false); const [reviewing, setReviewing] = useState(false);
  const store = useRef<Awaited<ReturnType<typeof openDiagnosticsConsentStore>> | null>(null);
  const active = useRef(false); const request = useRef(0); const reviewTrigger = useRef<HTMLElement | null>(null);
  const opening = useRef<Promise<void> | null>(null); const writing = useRef<Promise<void> | null>(null);
  const savingRef = useRef(false); const revocationPending = useRef(false); const queuedRejection = useRef(false);
  const restoreFocus = () => { const target = reviewTrigger.current; reviewTrigger.current = null; queueMicrotask(() => { if (target?.isConnected) target.focus(); }); };
  async function refresh() {
    const ticket = ++request.current;
    // A failed or pending read cannot authorize any new send.
    diagnosticsClient.setEnabled(false);
    try {
      await writing.current;
      if (!store.current) throw new Error('StorageUnavailable');
      const next = await store.current.read();
      if (!active.current || ticket !== request.current) return;
      if (next === 'rejected') revocationPending.current = false;
      setChoice(next); setError(revocationPending.current); setLoading(false);
      diagnosticsClient.setEnabled(next === 'accepted' && !revocationPending.current);
    } catch {
      if (!active.current || ticket !== request.current) return;
      setError(true); setLoading(false);
    }
  }
  function openStore(): Promise<void> {
    if (opening.current) return opening.current;
    const task = (async () => {
      try {
        if (!store.current) {
          const next = await openDiagnosticsConsentStore();
          if (!active.current) { next.close(); return; }
          store.current = next;
          unsubscribe.current = next.subscribe(() => { void refresh(); });
        }
        await refresh();
      } catch { if (active.current) { diagnosticsClient.setEnabled(false); setLoading(false); setError(true); } }
    })();
    opening.current = task;
    void task.finally(() => { if (opening.current === task) opening.current = null; });
    return task;
  }
  const unsubscribe = useRef<() => void>(() => {});
  useEffect(() => {
    active.current = true; void openStore();
    const focus = () => { void openStore(); };
    const runtimeError = (event: ErrorEvent) => {
      if (!event.error) return; // Resource load errors are not application exceptions.
      setTimeout(() => { if (Date.now() - lastRenderFailure > 1000) recordDiagnostic({ area: 'runtime', code: 'runtime_exception' }); }, 0);
    };
    const rejected = () => { recordDiagnostic({ area: 'runtime', code: 'unhandled_rejection' }); };
    window.addEventListener('focus', focus); window.addEventListener('error', runtimeError); window.addEventListener('unhandledrejection', rejected);
    return () => { active.current = false; ++request.current; diagnosticsClient.setEnabled(false); unsubscribe.current(); store.current?.close(); store.current = null;
      window.removeEventListener('focus', focus); window.removeEventListener('error', runtimeError); window.removeEventListener('unhandledrejection', rejected); };
  }, []);
  async function choose(next: Exclude<DiagnosticsChoice, null>) {
    if (next === 'rejected') revocationPending.current = true;
    diagnosticsClient.setEnabled(false);
    if (savingRef.current) { if (next === 'rejected') queuedRejection.current = true; return; }
    if (!store.current) { setError(true); return; }
    savingRef.current = true;
    const ticket = ++request.current; setSaving(true);
    let pending: Promise<void> | null = null;
    try {
      pending = store.current.write(next); writing.current = pending; await pending;
      if (!active.current || ticket !== request.current) return;
      if (!queuedRejection.current) revocationPending.current = false;
      setChoice(next); setError(false); setReviewing(false); restoreFocus();
      diagnosticsClient.setEnabled(next === 'accepted' && !revocationPending.current);
    } catch { if (active.current && ticket === request.current) setError(true); }
    finally {
      if (writing.current === pending) writing.current = null;
      savingRef.current = false;
      if (active.current) setSaving(false);
      if (active.current && queuedRejection.current) { queuedRejection.current = false; void choose('rejected'); }
    }
  }
  return <Context.Provider value={{ choice, loading, saving, error, reviewing, choose,
    retry: () => { if (revocationPending.current) void openStore().then(() => choose('rejected')); else void openStore(); }, review: () => { reviewTrigger.current = document.activeElement as HTMLElement | null; setReviewing(true); },
    closeReview: () => { setReviewing(false); restoreFocus(); } }}>{children}</Context.Provider>;
}
export function useDiagnostics() { const view = useContext(Context); if (!view) throw new Error('DiagnosticsProvider required'); return view; }
