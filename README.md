# Livro a Livro

Um registro pessoal, privado e local-first da história dos livros que você lê.

## Princípios

- Sem conta obrigatória e sem rede social.
- Biblioteca no dispositivo, com exportação e importação de dados.
- Sincronização opcional pelo Google Drive no futuro.
- Código aberto, experiências pequenas e escolhas explicáveis.

## Estado atual

O domínio, o repositório IndexedDB e os serviços de backup têm implementação e testes. O aplicativo já inicia com o design system e navegação responsiva por hash: Estante, Lendo, Quero ler, Adicionar, Livro, Seus dados e Configurações.

A estante anual já lê o IndexedDB, com grade/lista, filtros e estatísticas dos livros lidos. O cadastro manual, a página privada do livro, a edição e a exclusão funcionam localmente, incluindo aviso de duplicata e proteção contra alterações concorrentes. Notas são texto simples e ficam fora da estante. A interface confirma salvamento somente depois do commit e preserva o rascunho quando há falha.

A busca explícita usa a Open Library somente para sugerir um rascunho revisável; a consulta é o único dado enviado ao catálogo. O aplicativo é instalável e prepara uma casca offline pública depois da primeira visita online. Cache de rede não recebe livros, notas, backups, tokens ou dados de Drive, e instalar o app não substitui a exportação de backup. Backup visual e serviços opcionais continuam nas próximas issues.

## Desenvolvimento

Use `npm install` e `npm run dev` para abrir o aplicativo localmente. `npm test`, `npm run typecheck` e `npm run build` verificam testes, tipos e produção. O build é estático e fica em `dist/`.

## Design system

- [Guia de identidade, componentes e padrões](docs/design-system.md)
- [Tokens CSS e bases reutilizáveis](docs/tokens.css)
- [Catálogo visual e Estante 2026](docs/design-system.html) — abra o arquivo diretamente no navegador, sem instalar dependências. Os exemplos são estáticos e não salvam dados.
- [Roteiro de construção da V1](docs/build-plan.md)
- [Arquitetura técnica: biblioteca local, API opcional, Drive e experimentos](docs/architecture.md)
- [Sequência de entrega e papéis dos agentes](docs/delivery-plan.md)

## Tecnologia planejada

React, TypeScript e Vite no cliente; IndexedDB para a biblioteca local. Open Library será uma fonte de busca e enriquecimento, nunca a base de dados do usuário.
