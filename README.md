# Livro a Livro

Um registro pessoal, privado e local-first da história dos livros que você lê.

## Princípios

- Sem conta obrigatória e sem rede social.
- Biblioteca no dispositivo, com exportação e importação de dados.
- Sincronização opcional e direta pelo Google Drive.
- Código aberto, experiências pequenas e escolhas explicáveis.

## Estado atual

O domínio, o repositório IndexedDB e os serviços de backup têm implementação e testes. O aplicativo já inicia com o design system e navegação responsiva por hash: Estante, Lendo, Quero ler, Adicionar, Livro, Seus dados e Configurações.

A estante anual já lê o IndexedDB, com grade/lista, filtros e estatísticas dos livros lidos. O cadastro manual, a página privada do livro, a edição e a exclusão funcionam localmente, incluindo aviso de duplicata e proteção contra alterações concorrentes. Notas são texto simples e ficam fora da estante. A interface confirma salvamento somente depois do commit e preserva o rascunho quando há falha.

A busca explícita usa a Open Library somente para sugerir um rascunho revisável; a consulta é o único dado enviado ao catálogo. O aplicativo é instalável e prepara uma casca offline pública depois da primeira visita online. Cache de rede não recebe livros, notas, backups, tokens ou dados de Drive, e instalar o app não substitui a exportação de backup. Backup visual e serviços opcionais continuam nas próximas issues.

## Desenvolvimento

O núcleo opcional da [API de autorização do Drive](docs/auth-api.md) está em `api/` (Rust/Axum), com provider Google e testes de sessão. O [conector do frontend](docs/drive-sync.md) tem outbox local, transferência direta, conflitos e recuperação. A composição persistente AWS e a configuração Google são gates de entrega; nenhum serviço foi publicado nesta etapa. O conector de produção só aparece com `VITE_DRIVE_ENABLED=true`, após esses gates.

Use `npm install` e `npm run dev` para abrir o aplicativo localmente. `npm test`, `npm run typecheck` e `npm run build` verificam testes, tipos e produção. O build é estático e fica em `dist/`.

### Mesmo fluxo local do BioRotina

- `make` ou `make dev`: inicia o app em `http://127.0.0.1:5173`.
- `make local`: inicia app + simulador Google/Drive em `127.0.0.1:8788`. Dispensa login, AWS, GCP e secrets; a busca Open Library fica desativada. Abra **Seus dados → Conectar Google Drive** para testar.
- `make local-api`: somente o simulador; `LIVRO_LOCAL_API_PORT` troca a porta.
- Se o BioRotina ocupar 5173, use `LIVRO_LOCAL_APP_PORT=5174 make local` para abrir este projeto em outra porta.
- `make local-reset`: com o simulador parado, remove seus dois arquivos descartáveis em `.local/livro-a-livro`. Não remove dados reais nem o IndexedDB. Para limpar a estante de teste, remova apenas o banco `livro-a-livro-local` nas ferramentas do navegador.
- `make test`: testes TypeScript + simulador. `make check`: inclui tipos, build e Rust.

O modo local mostra uma faixa em todas as telas, usa banco IndexedDB separado e grava somente dados descartáveis no computador. Os arquivos do simulador são ignorados pelo Git. Para simular dois dispositivos, abra outro perfil de navegador em `127.0.0.1:5173`; ambos usam o mesmo Drive simulado. A variável `VITE_LOCAL_MODE` funciona apenas no servidor de desenvolvimento; o transporte local é eliminado do build de produção. O simulador não valida OAuth real e não substitui os gates de produção.

## Design system

- [Guia de identidade, componentes e padrões](docs/design-system.md)
- [Tokens CSS e bases reutilizáveis](docs/tokens.css)
- [Catálogo visual e Estante 2026](docs/design-system.html) — abra o arquivo diretamente no navegador, sem instalar dependências. Os exemplos são estáticos e não salvam dados.
- [Roteiro de construção da V1](docs/build-plan.md)
- [Arquitetura técnica: biblioteca local, API opcional, Drive e experimentos](docs/architecture.md)
- [Sequência de entrega e papéis dos agentes](docs/delivery-plan.md)

## Tecnologia planejada

React, TypeScript e Vite no cliente; IndexedDB para a biblioteca local. Open Library será uma fonte de busca e enriquecimento, nunca a base de dados do usuário.
