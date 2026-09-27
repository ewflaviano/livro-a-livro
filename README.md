# Livro a Livro

Um registro pessoal, privado e local-first da história dos livros que você lê.

## Princípios

- Sem conta obrigatória e sem rede social.
- Biblioteca no dispositivo, com exportação e importação de dados.
- Sincronização opcional pelo Google Drive no futuro.
- Código aberto, experiências pequenas e escolhas explicáveis.

## Estado atual

O domínio, o repositório IndexedDB e os serviços de backup têm implementação e testes. O aplicativo já inicia com o design system e navegação responsiva por hash: Estante, Lendo, Quero ler, Adicionar, Livro, Seus dados e Configurações.

As páginas ainda são placeholders identificados como “Em construção”. A interface não abre o banco nem consulta serviços externos; não apresenta uma estante vazia como se tivesse lido os dados. Os componentes de inicialização, falha local e vazio estão preparados para a próxima etapa de integração da estante. Cadastro, busca, backup visual, PWA e serviços opcionais serão conectados em suas issues.

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
