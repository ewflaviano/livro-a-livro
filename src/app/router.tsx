import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from '../ui/components/AppShell';
import { PlaceholderPage } from '../ui/pages/PlaceholderPage';
import { ShelfPage } from '../ui/pages/ShelfPage';
import { LibraryProvider } from './LibraryProvider';
import type { ShelfService } from '../services/shelf-service';

export function AppRoutes({ openService }: { openService?: () => Promise<ShelfService> } = {}) {
  return (
    <LibraryProvider openService={openService}>
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<Navigate to="/estante" replace />} />
        <Route path="estante" element={<ShelfPage key="shelf" />} />
        <Route path="lendo" element={<ShelfPage key="reading" status="reading" />} />
        <Route path="quero-ler" element={<ShelfPage key="want" status="want-to-read" />} />
        <Route path="adicionar" element={<PlaceholderPage title="Adicionar livro" description="Toda história começa com um livro." detail="O cadastro manual e a busca por título, autor ou ISBN estarão disponíveis em uma próxima etapa." back />} />
        <Route path="livro/:id" element={<PlaceholderPage title="Livro" description="Um espaço para guardar sua leitura." detail="A página de detalhes está em preparação. Nenhum registro foi consultado ou alterado." back />} />
        <Route path="dados" element={<PlaceholderPage title="Seus dados" description="Sua biblioteca pertence a você." detail="Seus livros ficarão neste dispositivo, neste navegador. Limpar os dados do navegador ou trocar de dispositivo pode remover sua estante. A exportação e a importação de uma cópia JSON estarão disponíveis aqui." />} />
        <Route path="configuracoes" element={<PlaceholderPage title="Configurações" description="Simples, privado e do seu jeito." detail="As preferências do aplicativo estão em preparação. Você poderá usar sua estante sem criar uma conta." />} />
        <Route path="*" element={<PlaceholderPage title="Página não encontrada" description="Este endereço não faz parte da sua estante." detail="Volte para continuar navegando." back />} />
      </Route>
    </Routes>
    </LibraryProvider>
  );
}

export function AppRouter() {
  return <HashRouter><AppRoutes /></HashRouter>;
}
