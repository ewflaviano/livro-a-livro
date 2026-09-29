# Contribuir com o Livro a Livro

A biblioteca pertence à pessoa que a criou. Leia primeiro o [estado atual](README.md#estado-atual), a [arquitetura](docs/architecture.md), o [design system](docs/design-system.md) e a issue da mudança. A [auditoria de maturidade](docs/audit-2026-09-27.md) identifica fluxos incompletos e prioridades.

## Preparar o ambiente

- Node.js 24 e npm, como no CI; use `npm ci` para respeitar o lockfile.
- Git e Make. `make help` lista os comandos disponíveis.
- Rust estável, Cargo, rustfmt e Clippy para `make api-check`/`make check`.
- Navegador atual com IndexedDB. Use um perfil/origem de teste, sem biblioteca pessoal.

```sh
npm ci
make dev
```

O app abre em `http://127.0.0.1:5173`. Não precisa de arquivo `.env`, credenciais ou backend para cadastro, edição e estante. `make dev` permite busca explícita na Open Library; use títulos públicos apenas como dados de teste.

Para Drive simulado, execute `make local` e abra **Seus dados**. Ele inicia o simulador em `127.0.0.1:8788`, usa `livro-a-livro-local` e desativa busca externa. Se a porta do BioRotina estiver ocupada, use `LIVRO_LOCAL_APP_PORT=5174 make local`. A API Rust é um núcleo reutilizável: não há executável de produção pronto para iniciar com `cargo run`.

## Onde trabalhar

| Área | Código e testes próximos |
| --- | --- |
| Regras e validação | `src/domain/`, `src/backup/` |
| Casos de uso | `src/services/`, `src/ports/` |
| IndexedDB e capas | `src/adapters/indexeddb/`, `src/media/` |
| Busca bibliográfica | `src/adapters/open-library/`, `src/services/search-service.ts` |
| Rotas e composição | `src/app/`; interface em `src/ui/` |
| Drive e concorrência | `src/sync/`, `src/app/SyncProvider.tsx` |
| Experimentos e métricas | `src/experiments/`, `src/diagnostics/`; integração runtime pendente |
| Offline e compartilhamento | `src/pwa/`, `build/pwa-plugin.ts`, `src/sharing/` |
| OAuth e contratos HTTP | `api/src/`, `api/tests/` |
| Simulador e publicação | `scripts/`, `infra/`, `.github/workflows/` |

Os testes TypeScript ficam junto ao código (`*.test.ts`/`*.test.tsx`); `test/fixtures/` contém apenas arquivos sintéticos. Não confunda a versão estrutural do IndexedDB com a versão do backup JSON. Mudanças de contrato precisam preservar a leitura dos backups suportados.

## Fluxo de entrega

1. Uma issue por vez. Descreva o comportamento esperado e os critérios de aceite sem dados reais.
2. Parta da `main` em `codex/issue-<número>-<resumo>`, com árvore de trabalho limpa ou mudanças existentes preservadas.
3. Leia os testes relacionados antes de editar. Mantenha a alteração limitada à issue.
4. Atualize a documentação afetada, principalmente a disponibilidade real no README. Não marque como pronto um módulo ainda sem composição/interface.
5. Abra PR ligado à issue (`Closes #<número>` quando concluir todos os critérios). Informe comportamento, validação e limites conhecidos.
6. Revise e integre antes de iniciar a próxima issue. OAuth, experimentos e infraestrutura exigem revisão de arquitetura pelo papel SOL definido em [AGENTS.md](AGENTS.md).

## Checks

| Comando | O que verifica |
| --- | --- |
| `npm test` | Suíte TypeScript/React com Vitest e IndexedDB emulado |
| `npm run test:local` | Isolamento e persistência do simulador |
| `node scripts/local-library-gate.mjs` | Cadastro/edição com capa e backup restaurado offline em outro perfil Chromium sintético |
| `node scripts/drive-gate.mjs --smoke` | Sincronização simulada, conflito, recuperação, logout e fronteira da API |
| `node scripts/pwa-update-gate.mjs` | Cache offline, atualização e proteção de rascunho/abas |
| `node scripts/ga-consent-gate.mjs` | Ausência de Analytics antes de aceitar e limpeza ao recusar |
| `npm run typecheck` | Tipos TypeScript |
| `npm run build` | Build estático e app shell em `dist/` |
| `make api-check` | rustfmt, Clippy sem warnings e testes Rust |
| `make check` | Todos os anteriores |
| `make preview` | Build servido para inspeção manual da PWA |

O CI executa o simulador e esses quatro gates de navegador com Chromium instalado no runner. Os gates não usam biblioteca pessoal nem substituem OAuth/Drive reais, quota de dispositivo, Safari/iOS/Android ou leitor de tela. Localmente, use `npx playwright install chromium` se necessário; `CHROMIUM_PATH` permite escolher um Chromium já instalado.

Na auditoria de 27/09/2026, `npm test` apresentou falhas de tempo/espera; `npm test -- --maxWorkers=2` passou os 239 testes. Se isso ocorrer, preserve o resultado original e compare com concorrência reduzida para diagnóstico. Não aumente timeouts nem declare a execução padrão aprovada sem investigar.

## Verificação manual por área

- **Interface:** desktop 1440 px; 768, 390 e 320 px; zoom de 200%; teclado, foco, Escape e retorno de diálogos; títulos longos, autor ausente e erros. Conferir conteúdo e ações, não apenas ausência de rolagem horizontal.
- **Biblioteca:** adicionar, editar, recarregar, excluir com confirmação; duas abas com revisões concorrentes; falha de gravação preservando o rascunho.
- **Capas:** seleção → salvar → estante → detalhe → recarregar; imagem ausente, inválida e offline; memória/object URLs e limites acumulados.
- **Backup:** exportar e restaurar em origem de teste independente, sem Drive e offline; comparar livros e capas. Cobrir arquivo inválido, versão futura, limite máximo e conflito depois da prévia. O fluxo está em Seus dados → Backup local: Exportar JSON → conferir arquivo salvo → Importar JSON em outra origem → conferir prévia → exportar biblioteca atual se necessário → confirmar. Verificar foco, cancelamento, arquivo selecionado novamente e unmount durante validação.
- **PWA:** primeira visita online ao preview do build, preparação offline, navegação/edição/importação offline (incluindo o chunk import-worker no precache); atualização com rascunho e outra aba aberta. Não apagar dados reais nem remover indiscriminadamente todos os caches.
- **Drive:** simulador, retomada, resposta perdida, contas/versões diferentes e conflito; só depois validar OAuth real em ambiente autorizado. O simulador não substitui integração AWS/GCP.
- **Experimentos:** comprovar consentimento → catálogo → variante visível, controle em erro/expiração e saída imediata. Esses consumidores ainda precisam ser integrados.

Na descrição do PR, separe checks automatizados, observações de navegador e cenários não verificados. Capturas devem usar exclusivamente conteúdo sintético.

## Privacidade e segurança

- IndexedDB é a fonte de verdade. Estante, edição, cadastro e backup devem continuar disponíveis sem conta/rede.
- Transferência da biblioteca é PWA ↔ Google Drive; a API própria só trata autorização e contratos técnicos permitidos.
- Não inclua backups reais, notas, imagens pessoais, contas ou tokens em logs, fixtures, URLs, commits, issues ou PRs. Não copie credenciais do BioRotina.
- `VITE_*` vai para o cliente: nunca coloque segredo OAuth ou chave privada nessas variáveis.
- Use texto React e schemas para entradas não confiáveis; capas aceitam provedores tipados, nunca URL arbitrária.
- Experimentos e métricas exigem consentimentos independentes; não habilitam rede ou coleta nova por surpresa.
- Não adicione IA, login obrigatório, recomendações, feed, metas, notificações ou coleta pessoal sem issue e decisão explícita.

Ao encontrar uma falha, prepare uma reprodução mínima com dados sintéticos e descreva impacto, pré-condições e limite da evidência. Nunca anexe credenciais ou uma biblioteca real para demonstrá-la.

### Parser de importação e teste sem rede

O build real compõe um Worker descartável para o parser. O servidor de desenvolvimento precisa buscar o módulo do Worker na primeira utilização; para comprovar importação offline, use o build/preview, aguarde o service worker declarar o shell disponível e só então desligue a rede. O serviço permite parser injetado nos testes; isso não valida a entrega do chunk, que deve ser conferida em `dist/sw.js` e no navegador.

Teste sempre com biblioteca sintética e origem separada. Nunca limpe IndexedDB de produção para simular perfil novo. O arquivo exportado deve ser comparado em memória com registros/capas/preferências, sem conteúdo pessoal em logs ou PRs.
