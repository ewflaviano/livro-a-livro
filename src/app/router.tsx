import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from '../ui/components/AppShell';
import { PlaceholderPage } from '../ui/pages/PlaceholderPage';
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
    <LibraryProvider openService={openService}><SyncProvider>
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
        <Route path="configuracoes" element={<PlaceholderPage title="Configurações" description="Simples, privado e do seu jeito." detail="As preferências do aplicativo estão em preparação. Você poderá usar sua estante sem criar uma conta." />} />
        <Route path="*" element={<PlaceholderPage title="Página não encontrada" description="Este endereço não faz parte da sua estante." detail="Volte para continuar navegando." back />} />
      </Route>
    </Routes>
    </SyncProvider></LibraryProvider>
  );
}

export function AppRouter() {
  return <HashRouter><AppRoutes /></HashRouter>;
}
