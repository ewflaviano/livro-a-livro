import { useEffect, type ReactNode } from 'react';
import { recordDiagnostic } from './client';

let lastRenderFailure = 0;
export function reportRenderFailure() {
  lastRenderFailure = Date.now();
  recordDiagnostic({ area: 'runtime', code: 'render_failure' });
}

// Consent is owned by AnalyticsProvider. This component only observes runtime errors.
export function DiagnosticsProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    const runtimeError = (event: ErrorEvent) => {
      if (!event.error) return;
      setTimeout(() => {
        if (Date.now() - lastRenderFailure > 1000) recordDiagnostic({ area: 'runtime', code: 'runtime_exception' });
      }, 0);
    };
    const rejected = () => { recordDiagnostic({ area: 'runtime', code: 'unhandled_rejection' }); };
    window.addEventListener('error', runtimeError);
    window.addEventListener('unhandledrejection', rejected);
    return () => {
      window.removeEventListener('error', runtimeError);
      window.removeEventListener('unhandledrejection', rejected);
    };
  }, []);
  return children;
}
