import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from '../ui/components/AppShell';
import { PlaceholderPage } from '../ui/pages/PlaceholderPage';

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<Navigate to="/estante" replace />} />
        <Route path="estante" element={<PlaceholderPage title="Minha estante" description="A história dos seus livros, uma leitura de cada vez." detail="Sua estante anual está sendo preparada. Aqui você poderá ver livros, páginas e autores, em grade ou lista." />} />
        <Route path="lendo" element={<PlaceholderPage title="Lendo" description="As leituras que estão com você agora." detail="Seus livros em leitura aparecerão aqui quando o cadastro estiver disponível." />} />
        <Route path="quero-ler" element={<PlaceholderPage title="Quero ler" description="Um lugar para os livros que despertam sua curiosidade." detail="Os livros que você quiser ler aparecerão aqui quando o cadastro estiver disponível." />} />
        <Route path="adicionar" element={<PlaceholderPage title="Adicionar livro" description="Toda história começa com um livro." detail="O cadastro manual e a busca por título, autor ou ISBN estarão disponíveis em uma próxima etapa." back />} />
        <Route path="livro/:id" element={<PlaceholderPage title="Livro" description="Um espaço para guardar sua leitura." detail="A página de detalhes está em preparação. Nenhum registro foi consultado ou alterado." back />} />
        <Route path="dados" element={<PlaceholderPage title="Seus dados" description="Sua biblioteca pertence a você." detail="Seus livros ficarão neste dispositivo, neste navegador. Limpar os dados do navegador ou trocar de dispositivo pode remover sua estante. A exportação e a importação de uma cópia JSON estarão disponíveis aqui." />} />
        <Route path="configuracoes" element={<PlaceholderPage title="Configurações" description="Simples, privado e do seu jeito." detail="As preferências do aplicativo estão em preparação. Você poderá usar sua estante sem criar uma conta." />} />
        <Route path="*" element={<PlaceholderPage title="Página não encontrada" description="Este endereço não faz parte da sua estante." detail="Volte para continuar navegando." back />} />
      </Route>
    </Routes>
  );
}

export function AppRouter() {
  return <HashRouter><AppRoutes /></HashRouter>;
}
