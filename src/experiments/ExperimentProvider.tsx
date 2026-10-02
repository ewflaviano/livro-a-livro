import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { assignExperiment } from './assignment';
import { fetchCatalog, type Catalog } from './catalog';
import { openExperimentStore } from './store';
import { experimentRegistry, type ExperimentKey, type ExperimentVariant } from './registry';
import { experimentTelemetry } from '../diagnostics/telemetry';
import { isUsageSuspended, USAGE_SUSPENSION_EVENT } from '../analytics/suspension';

const API = import.meta.env.VITE_EXPERIMENTS_API_URL || '';
const Context = createContext<{ catalog: Catalog | null; variants: Partial<Record<ExperimentKey, string>>; assigned: Partial<Record<ExperimentKey, string>> }>({ catalog: null, variants: {}, assigned: {} });

export function ExperimentProvider({ children, baseUrl = API }: { children: ReactNode; baseUrl?: string }) {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [variants, setVariants] = useState<Partial<Record<ExperimentKey, string>>>({});
  const [assigned, setAssigned] = useState<Partial<Record<ExperimentKey, string>>>({});
  useEffect(() => {
    if (!baseUrl) { experimentTelemetry.setEnabled(false); return; }
    let disposed = false;
    let revision = -1;
    let request = 0;
    let controller: AbortController | null = null;
    let expiryTimer: number | undefined;
    const clear = () => { setCatalog(null); setVariants({}); setAssigned({}); experimentTelemetry.setEnabled(false); window.clearTimeout(expiryTimer); };
    const refresh = async () => {
      const epoch = ++request;
      controller?.abort();
      controller = new AbortController();
      if (isUsageSuspended() || document.visibilityState === 'hidden' || navigator.onLine === false) { clear(); return; }
      try {
        const store = await openExperimentStore();
        try {
          const state = await store.read();
          if (disposed || epoch !== request) return;
          if (isUsageSuspended()) { clear(); return; }
          if (!state.experimentsConsent) { clear(); return; }
          const next = await fetchCatalog(fetch, baseUrl, controller.signal);
          if (disposed || epoch !== request) return;
          if (isUsageSuspended()) { clear(); return; }
          if (!next || next.catalogRevision < revision || !(await store.acceptCatalogRevision(next.catalogRevision))) { clear(); return; }
          if (disposed || epoch !== request) return;
          if (isUsageSuspended()) { clear(); return; }
          revision = next.catalogRevision;
          const assigned: Partial<Record<ExperimentKey, string>> = {};
          const activeVariants: Partial<Record<ExperimentKey, string>> = {};
          for (const entry of next.experiments) {
            const choice = await assignExperiment(entry, state, { build: __APP_VERSION__, driveConnected: false });
            if (disposed || epoch !== request) return;
            if (isUsageSuspended()) { clear(); return; }
            if (choice) {
              assigned[choice.key] = choice.variant;
              if (choice.variant !== experimentRegistry[choice.key].defaultVariant) activeVariants[choice.key] = choice.variant;
              const saved = state.assignments[choice.key];
              if (saved?.assignmentVersion !== choice.assignmentVersion || saved.variant !== choice.variant) {
                const updated = await store.saveAssignment(choice.key, choice.assignmentVersion, choice.variant);
                if (!updated.experimentsConsent) { clear(); return; }
              }
            }
          }
          if (disposed || epoch !== request) return;
          if (isUsageSuspended()) { clear(); return; }
          experimentTelemetry.setEnabled(state.telemetryConsent && Object.keys(assigned).length > 0);
          setCatalog(next);
          setVariants(activeVariants);
          setAssigned(assigned);
          window.clearTimeout(expiryTimer);
          expiryTimer = window.setTimeout(clear, Math.max(0, Date.parse(next.expiresAt) - Date.now()));
        } finally { store.close(); }
      } catch { if (!disposed && epoch === request) clear(); }
    };
    const onFocus = () => { clear(); if (document.visibilityState === 'visible') void refresh(); };
    const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('livro-experiments');
    channel?.addEventListener('message', onFocus);
    window.addEventListener('livro-experiments-changed', onFocus);
    window.addEventListener(USAGE_SUSPENSION_EVENT, onFocus);
    window.addEventListener('storage', onFocus);
    window.addEventListener('online', onFocus);
    window.addEventListener('offline', clear);
    document.addEventListener('visibilitychange', onFocus);
    const interval = window.setInterval(() => { if (document.visibilityState === 'visible') void refresh(); }, 60_000);
    void refresh();
    return () => {
      disposed = true; controller?.abort(); experimentTelemetry.setEnabled(false); channel?.close(); window.clearInterval(interval); window.clearTimeout(expiryTimer);
      window.removeEventListener('livro-experiments-changed', onFocus);
      window.removeEventListener(USAGE_SUSPENSION_EVENT, onFocus);
      window.removeEventListener('storage', onFocus);
      window.removeEventListener('online', onFocus);
      window.removeEventListener('offline', clear);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [baseUrl]);
  const value = useMemo(() => ({ catalog, variants, assigned }), [catalog, variants, assigned]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useExperiment<K extends ExperimentKey>(key: K, visible = true): ExperimentVariant<K> {
  const { catalog, variants, assigned } = useContext(Context);
  const control = experimentRegistry[key].defaultVariant as ExperimentVariant<K>;
  const active = !!catalog && Date.parse(catalog.expiresAt) > Date.now() && navigator.onLine !== false;
  const variant = active ? (variants[key] ?? control) as ExperimentVariant<K> : control;
  const assignmentVersion = catalog?.experiments.find(entry => entry.key === key)?.assignmentVersion;
  useEffect(() => {
    if (active && visible && assigned[key] && assignmentVersion === 1) experimentTelemetry.record({
      build: __APP_VERSION__, experiment: key, revision: assignmentVersion, variant: assigned[key], event: 'exposure',
    });
  }, [active, assigned, assignmentVersion, key, visible]);
  return variant;
}
