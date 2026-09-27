# Livro a Livro

Um registro pessoal, privado e local-first da história dos livros que você lê.

## Princípios

- Sem conta obrigatória e sem rede social.
- Biblioteca no dispositivo, com exportação e importação de dados.
- Sincronização opcional pelo Google Drive no futuro.
- Código aberto, experiências pequenas e escolhas explicáveis.

## Estado inicial

O repositório começa intencionalmente sem produto implementado. A primeira entrega é o design system: fundamentos, tokens e catálogo visual para orientar a V1.

## Design system

- [Guia de identidade, componentes e padrões](docs/design-system.md)
- [Tokens CSS e bases reutilizáveis](docs/tokens.css)
- [Catálogo visual e Estante 2026](docs/design-system.html) — abra o arquivo diretamente no navegador, sem instalar dependências. Os exemplos são estáticos e não salvam dados.
- [Roteiro de construção da V1](docs/build-plan.md)
- [Arquitetura técnica: biblioteca local, API opcional, Drive e experimentos](docs/architecture.md)
- [Sequência de entrega e papéis dos agentes](docs/delivery-plan.md)

## Tecnologia planejada

React, TypeScript e Vite no cliente; IndexedDB para a biblioteca local. Open Library será uma fonte de busca e enriquecimento, nunca a base de dados do usuário.
