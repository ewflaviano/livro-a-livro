# Validação de release — issue #46

**28/09/2026 · branch `codex/issue-46-release-browser-gates`**

## Escopo automatizado

O CI passa a executar `npm run test:local` após a suíte frontend e abre um job Chromium separado da API. A publicação frontend aguarda também esse job. Quatro gates usam somente perfis descartáveis e dados sintéticos: `local-library-gate` cobre cadastro e edição com capa, download do backup e restauração offline em outro perfil; `drive-gate --smoke` cobre a sincronização simulada e fronteira da API; `pwa-update-gate` cobre instalação, atualização, abas e rascunho; `ga-consent-gate` cobre recusa, aceite e revogação. A busca bibliográfica real, OAuth Google real e Safari/iOS/Android não são simulados por esses gates.

O servidor do gate PWA passou a servir o favicon exigido pelo precache. O gate passou a reconhecer o rótulo atual de versão (`commit`), abrir o painel de restauração antes de selecionar o JSON e verificar que o aviso de atualização fica oculto durante um rascunho. O gate Analytics usa o controle atual em Configurações. Essas são correções dos scripts de teste; não alteram a aplicação.

## Resultados locais desta branch

| Check | Resultado |
| --- | --- |
| `npm test`, isolado de outros builds | 622/622 em 50 arquivos, concorrência padrão, Node 26.7.0 |
| `npm run test:local` | 1/1, loopback e persistência simulada |
| `npm run typecheck` e `npm run build` | Aprovados |
| `drive-gate --smoke` | `SMOKE_PASS` |
| `local-library-gate` | `LOCAL_LIBRARY_GATE_PASS` |
| `pwa-update-gate` | `PWA_UPDATE_GATE_PASS` |
| `ga-consent-gate` | `GA_CONSENT_GATE_PASS` |
| `npm audit --audit-level=moderate` | Zero advisories reportados em 133 dependências |

As falhas intermitentes antigas da suíte padrão não se reproduziram nesta execução isolada. Isso não demonstra uma causa para o resultado anterior. A PR #105 passou com frontend, Chromium e API no CI Node 24; a execução da `main` `36509329608` também passou e publicou o frontend. O domínio público respondeu 200 para HTML e asset JS com CSP, e o JS servido continha o commit integrado `b1d570e`. Não aumentar timeout ou reduzir workers para ocultar falhas.

A configuração Rust do CI já usa `components: 'clippy,rustfmt'` como uma string única. `cargo fmt`, Clippy e testes continuam no job da API. O CI reportou depreciação do runtime Node 20 nas actions `checkout`, `setup-node` e `configure-aws-credentials`. A PR #106 fixou SHAs imutáveis das releases oficiais [checkout v7.0.1](https://github.com/actions/checkout/releases/tag/v7.0.1), [setup-node v7.0.0](https://github.com/actions/setup-node/releases/tag/v7.0.0) e [configure-aws-credentials v6.3.0](https://github.com/aws-actions/configure-aws-credentials/releases/tag/v6.3.0), que usam Node 24. O runner observado foi `2.337.0`, acima do mínimo `2.327.1` documentado para checkout/setup-node. Na execução `36510212782`, frontend, Chromium, API, publicação frontend e smoke OIDC read-only da role API passaram; `publish_api` ficou corretamente ignorado. O domínio serviu o JS do commit `c4fdb77` com HTTP 200 e CSP.

Essa execução ainda apontou Node 20 em `upload-artifact`. A terceira PR da #46 atualiza [upload-artifact v7.0.1](https://github.com/actions/upload-artifact/releases/tag/v7.0.1) e [download-artifact v8.0.1](https://github.com/actions/download-artifact/releases/tag/v8.0.1) por SHA. O smoke da role API passa a baixar o artefato gerado no mesmo run e verificar os três ZIPs antes do STS; não publica funções. As outras actions ficam fixadas como estavam. A validação desta terceira PR e o build servido depois dela ainda são necessários.

## Auditoria Rust

`cargo audit --file api/Cargo.lock` retornou cinco advisories em 309 dependências: `RUSTSEC-2026-0258` (`h2 0.3.27`), `RUSTSEC-2023-0071` (`rsa 0.9.10`) e `RUSTSEC-2026-0098`, `-0099`, `-0104` (`rustls-webpki 0.101.7`). `h2` e `rustls-webpki` entram pelo cliente HTTP do AWS SDK. `rsa` entra por `jsonwebtoken` e pelos testes; o código de produção verifica tokens com chave pública, enquanto a geração de assinatura com chave privada aparece nos testes. A auditoria do lockfile não comprova que todos os caminhos vulneráveis sejam alcançáveis neste serviço, mas os achados não devem ser ignorados nem classificados como corrigidos. A [issue #107](https://github.com/ewflaviano/livro-a-livro/issues/107) acompanha a análise e correção em PR próprio, com testes Lambda e revisão de arquitetura antes de publicar.

## Limites de release

O teste PWA verifica que assets da versão anterior continuam disponíveis offline após a atualização; a publicação retém assets versionados em S3. A verificação de `dist` no CI procura segredos e confirma os arquivos públicos. O teste não prova instalação ou persistência em Safari/iOS/Android, quota de armazenamento real, leitor de tela ou comportamento do Google em uma conta nova. Os gates OAuth/Drive de produção estão em [drive-release-gate.md](drive-release-gate.md). A confirmação do build servido em produção deve ocorrer após integrar esta PR.
