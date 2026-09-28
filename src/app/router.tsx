import { AnalyticsProvider } from '../analytics/AnalyticsProvider';
import { DiagnosticsProvider } from '../diagnostics/DiagnosticsProvider';
import { ErrorBoundary } from '../diagnostics/ErrorBoundary';
import { useEffect } from 'react';
import { armPwaStartup, reevaluatePwaStartup } from '../pwa/register';
import { getUiOccupancy, subscribeUiOccupancy } from '../ui/interaction-guard';
import { useLibrary } from './LibraryProvider';
import { useSync } from './SyncProvider';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from '../ui/components/AppShell';
import { NotFoundPage } from '../ui/pages/NotFoundPage';
import { SettingsPage } from '../ui/pages/SettingsPage';
import { InstallPage } from '../ui/pages/InstallPage';
import { ShelfPage } from '../ui/pages/ShelfPage';
import { AddBookPage, BookPage } from '../ui/pages/BookPage';
import { LibraryProvider } from './LibraryProvider';
import type { ShelfService } from '../services/shelf-service';
import { SyncProvider } from './SyncProvider';
import { DataPage } from '../ui/pages/DataPage';
import { MorePage } from '../ui/pages/MorePage';
import { SupportPage } from '../ui/pages/SupportPage';

export function AppRoutes({ openService }: { openService?: () => Promise<ShelfService> } = {}) {
  return (
    <DiagnosticsProvider><ErrorBoundary><LibraryProvider openService={openService}><SyncProvider><AnalyticsProvider><PwaStartup />
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<Navigate to="/estante" replace />} />
        <Route path="estante" element={<ShelfPage key="shelf" />} />
        <Route path="lendo" element={<ShelfPage key="reading" status="reading" />} />
        <Route path="quero-ler" element={<ShelfPage key="want" status="want-to-read" />} />
        <Route path="adicionar" element={<AddBookPage />} />
        <Route path="livro/:id" element={<BookPage />} />
        <Route path="mais" element={<MorePage />} />
        <Route path="dados" element={<DataPage />} />
        <Route path="apoiar" element={<SupportPage />} />
        <Route path="configuracoes" element={<SettingsPage />} />
        <Route path="instalar" element={<InstallPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
    </AnalyticsProvider></SyncProvider></LibraryProvider></ErrorBoundary></DiagnosticsProvider>
  );
}

export function AppRouter() {
  return <HashRouter><AppRoutes /></HashRouter>;
}

function PwaStartup() {
  const { state } = useLibrary(); const { initializing } = useSync();
  useEffect(() => {
    if (state.status === 'loading' || initializing) return;
    // A task after passive UI effects observes form/dialog occupancy, including deep links.
    const timer = window.setTimeout(() => armPwaStartup(() => getUiOccupancy() === 0), 0);
    const unsubscribe = subscribeUiOccupancy(reevaluatePwaStartup);
    return () => { window.clearTimeout(timer); unsubscribe(); };
  }, [state.status, initializing]);
  return null;
}
