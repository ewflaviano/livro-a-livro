# Roteiro de construção da V1

> Plano de referência. Para distinguir entregas integradas, módulos isolados e serviços pendentes, consulte o [estado atual](../README.md#estado-atual) e a [auditoria de 27/09/2026](audit-2026-09-27.md).

## Regra de escopo

Construir primeiro a promessa: **“Livro a Livro é o lugar mais simples para guardar a história dos livros que você lê.”**

Não entram nesta fase login, feed, recomendações, metas, comentários, IA, leitura página a página, scanner, biblioteca física ou sincronização automática.

## 1. Fundação local-first

- Definir `Book`, `LibraryExport` e `schemaVersion: 1` como contratos TypeScript validados por Zod.
- Criar IndexedDB com migrações versionadas e uma camada de repositório isolada da interface.
- Implementar exportação e importação JSON com prévia, validação e substituição explícita da biblioteca.
- Testar o requisito de release: exportar → limpar dados → importar → recuperar exatamente os mesmos livros, notas, avaliações e datas.

**Pronto quando:** a biblioteca sobrevive ao ciclo completo de backup e restauração sem depender de rede.

## 2. Estrutura do aplicativo

- Aplicar os tokens e padrões do design system no shell responsivo.
- Criar navegação mínima: Estante, Seus dados e fluxo de adicionar livro.
- Adicionar estados de carregamento, vazio, erro de armazenamento e foco por teclado antes de conectar dados reais.

**Pronto quando:** desktop e celular mostram a mesma estrutura, sem rolagem horizontal e com controles acessíveis.

## 3. Estante anual

- Criar seletor de ano, Grade e Lista, filtros Lidos/Lendo/Quero ler e CTA Adicionar livro.
- Manter ano, filtro, visualização e posição ao voltar da página de um livro.
- Calcular as estatísticas do ano apenas com livros Lidos: livros, páginas registradas e autores distintos.

**Pronto quando:** uma lista do Keep com 20 livros pode ser visualizada e navegada de forma agradável.

## 4. Cadastro manual primeiro

- Implementar título obrigatório; autor, capa, páginas, ISBN, ano de publicação, datas, nota e avaliação opcionais.
- Permitir escolher Quero ler, Lendo ou Lido e o ano da estante.
- Avisar sobre provável duplicata, mas nunca bloquear livros homônimos ou releituras registradas conscientemente.

**Pronto quando:** é possível registrar qualquer livro, webnovel ou conteúdo sem ISBN, totalmente offline.

## 5. Página e edição do livro

- Criar página com capa/fallback, autoria, estado, data de término, páginas, avaliação privada e nota privada.
- Implementar edição, confirmação de exclusão e mensagens de persistência honestas.

**Pronto quando:** editar um livro não perde texto e uma nota nunca aparece fora do dispositivo sem ação explícita.

## 6. Busca da Open Library

- Implementar busca acionada por botão para título, autor ou ISBN.
- Normalizar apenas o resultado escolhido; abrir uma revisão editável antes de salvar.
- Mostrar origem, falha, ausência de resultado e rota manual em todos os estados.
- Não usar Open Library como banco de dados nem impedir o app de funcionar sem rede.

**Pronto quando:** encontrar um livro torna o cadastro mais rápido; não encontrar continua sendo uma boa experiência.

## 7. PWA e qualidade de release

- Criar manifesto, ícones, cache de app shell e comportamento offline após o primeiro acesso.
- Testar em 320 px, 390 px, tablet e desktop; conferir teclado, zoom de 200% e movimento reduzido.
- Criar testes de domínio, IndexedDB, importação/exportação e fluxos principais.

**Pronto quando:** o app pode ser instalado, aberto offline e usado para registrar e consultar a estante local.

## 8. Compartilhamento anual

- Gerar prévia e imagem Story 9:16 / Quadrado 1:1 somente quando houver livros Lidos no ano.
- Incluir ano, livros lidos e capas; excluir notas, avaliações e identificadores pessoais.
- Confirmar conteúdo antes do download e não publicar em rede alguma.

**Pronto quando:** a imagem é um resumo bonito da estante, não uma funcionalidade social.

## 9. Sincronização opcional com Google Drive

Esta etapa fica depois da validação da V1 local. Preparar desde já o contrato de backup para suportá-la, mas não colocá-la no caminho do primeiro uso.

- Conexão opt-in e escopo mínimo do Drive.
- Backup versionado, data da última sincronização e resolução explícita de conflitos.
- Garantir que o produto continue plenamente útil sem conta nem conexão.

**Pronto quando:** conectar o Drive cria uma cópia controlada pela pessoa, sem transformar o produto em um serviço centrado em conta.

## Ordem de validação com a primeira biblioteca

1. Cadastrar os 20 livros atuais como Lidos.
2. Conferir Grade, Lista, ano e estatísticas.
3. Exportar o JSON.
4. Limpar os dados locais em ambiente de teste.
5. Importar o arquivo e comparar cada registro.
6. Instalar a PWA e abrir a estante offline.
7. Gerar uma prévia de compartilhamento.

Se esse percurso for rápido, claro e confiável, a V1 está pronta para uso real.
