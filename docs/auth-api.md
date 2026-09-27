# API de autorização do Drive

A issue #10 implementa o núcleo Rust/Axum, o cliente OAuth Google e a entrada reutilizável `run_lambda`, atrás da feature `lambda`. **Ainda não existe serviço publicado ou executável com persistência de produção.** A composição AWS da issue #13 precisa implementar as portas `Store` e `Crypto` com DynamoDB/KMS/Secrets Manager. O único store em memória está em testes, nunca no runtime. Nenhum recurso, segredo ou configuração GCP/AWS foi criado nesta issue.

## Fronteira

O serviço recebe exclusivamente os controles de autorização. As rotas de controle exigem body vazio; queries são recusadas fora do callback. Um limite de 16 KiB também rejeita payloads grandes antes do handler. Não existem contratos de livro, nota, avaliação, backup, hash da biblioteca, imagem ou transferência de Drive. O provider conhece apenas endpoints fixos de token, JWKS e revogação Google.

O cliente da issue #11 pede um access token e faz as transferências **diretamente entre PWA e Google Drive** ([conector e modo local](drive-sync.md)). A habilitação em produção depende da composição AWS e configuração GCP. Capas locais já têm implementação no cliente e seguem a mesma fronteira direta; nunca transitam por esta API. Sua recuperação ainda tem pendências registradas na [auditoria](audit-2026-09-27.md).

## Contrato HTTP

Todas as respostas, inclusive erros, têm `Cache-Control: no-store`, `Referrer-Policy: no-referrer` e não incluem erros brutos do Google. CORS permite exclusivamente `https://livroalivro.app.br`, com credenciais. Preview/localhost precisam de composição/configuração separada; não estão liberados em produção.

| Rota | Requisição | Resposta |
| --- | --- | --- |
| `POST /v1/auth/google/start` | Origin exata, sem body | `authorizationUrl` para Google e cookie temporário HttpOnly |
| `GET /v1/auth/google/callback` | state, code e cookie temporário | 303 para `https://livroalivro.app.br/#/dados`, cookie de sessão; nenhum token na URL |
| `GET /v1/session` | Origin exata, cookie | `connectionId`, `generation`, `expiresAt`, `csrfToken`, `scopes` |
| `POST /v1/session/renew` | Origin, cookie e `x-lal-csrf` | nova sessão/cookie, `csrfToken`, `expiresAt` |
| `POST /v1/auth/drive-token` | Origin, cookie e `x-lal-csrf` | somente `accessToken`, `expiresIn`, `scopes` |
| `DELETE /v1/session` | Origin, cookie e `x-lal-csrf` | 204 e cookie removido; encerra este aparelho |
| `DELETE /v1/drive-connection` | Origin, cookie e `x-lal-csrf` | `disconnected`, `revocationPending`; bloqueia a conexão globalmente |

O frontend usa `credentials: include` nas chamadas da API. Não envia body `{}`: os controles são deliberadamente sem body. A URL de autorização é usada para navegação completa após o clique Conectar. O callback não tem analytics nem HTML executável. Os parâmetros informativos `scope`, `authuser` e `prompt` do callback são tolerados, mas não confiáveis: a concessão é validada na resposta do endpoint de tokens.

O access token permanece somente em memória durante a execução do PWA. Não entra em localStorage, IndexedDB, service worker, BroadcastChannel, URL, backup ou telemetria. O cliente reaproveita o token até perto da expiração; uma nova emissão pode retornar 429 com `Retry-After: 30`. A aba deve aguardar e tentar novamente, sem logout. `connectionId` é identificador técnico opaco para vínculo, nunca dimensão de métricas.

## Proteções implementadas

- State, nonce, PKCE verifier e cookies aleatórios de 256 bits. Challenge S256. Transação de dez minutos, consumo atômico de uso único vinculado ao cookie.
- Troca confidencial no servidor. Solicita exatamente `openid` e `https://www.googleapis.com/auth/drive.appdata`, sem e-mail, perfil ou Drive completo. Rejeita concessão extra ou incompleta. Exige refresh token novo no consentimento; se ausente retorna `incomplete_consent` sem criar sessão.
- ID token verificado localmente por assinatura RS256/JWKS, issuer, audience exata, expiração, nonce e `azp` quando presente. Cache de JWKS por cinco minutos, respostas limitadas a 64 KiB, timeout e redirects de rede desativados. Chave nova desconhecida pode requerer nova tentativa após expiração do cache.
- Cookie `__Host-lal_session`, `Secure; HttpOnly; SameSite=Lax; Path=/`, sem Domain. O serviço persiste apenas hash do cookie; CSRF deriva de HMAC com propósito próprio. Sessão 30 dias, renovação explícita com rotação dentro de 180 dias absolutos.
- Portas exigem lease distribuído/fencing e atualização atômica do refresh token rotacionado; uma operação expirada/revogada não pode liberar seu access token. `invalid_grant` ou escopos retirados invalidam a geração. Revogação bloqueia imediatamente e mantém apenas credencial cifrada para retry até 24h. Arquivos Drive e biblioteca local nunca são apagados.

`Secret` não implementa Debug/Serialize e limpa sua String ao sair de escopo. Isso reduz exposição acidental, sem alegar eliminar todas as cópias que bibliotecas de HTTP/JSON podem produzir. O código não registra requisições, headers, códigos, identidades ou tokens.

## Composição de produção: gate da issue #13

Implementar e testar, antes de habilitar o conector:

1. Store DynamoDB com leitura consistente, transações condicionais, hashes de sessão, prazos verificados em cada operação, lease de 30s e fencing por owner. TTL é somente limpeza. Conexões sem atividade por 180 dias devem expirar; sessões respeitam o prazo absoluto. `connect` deve respeitar lease em andamento e nunca ressuscitar consentimento por uma operação antiga.
2. Crypto KMS com contexto autenticado ambiente/conexão, HMAC com chave separada carregada de Secrets Manager (primitiva `keyed_digest`). OAuth client secret também vem de Secrets Manager. Sem plaintext de refresh token em DynamoDB, variáveis VITE ou logs.
3. Job pequeno de retry de revogação e limpeza: retenção máxima 24h de credencial bloqueada; remoção condicional pela geração para não apagar reconexão mais recente. IAM exclusivo de auth, sem permissões S3 para dados privados.
4. Binário de composição que carrega configuração e chama `run_lambda(Auth { ... })`. Não existe fallback em memória ou segredo de desenvolvimento.
5. Rate limits de API Gateway para início/callback e tentativas inválidas; rate limit de token por conexão também no Store. Desativar logs de query string, headers e bodies em Gateway/Lambda/tracing. Métricas só por códigos agregados.
6. Testes de integração reais do adaptador (corridas entre invocações, atomicidade, expiração, falha de KMS, rotação e revogação). Os testes em memória desta issue validam o contrato do núcleo, mas não substituem a prova de atomicidade do DynamoDB.

Configuração prevista para o binário de composição:

| Nome | Fonte / conteúdo |
| --- | --- |
| `GOOGLE_CLIENT_ID` | identificador público do cliente Web do projeto próprio |
| `GOOGLE_OAUTH_SECRET_ARN` | ARN Secrets Manager, nunca o segredo no repositório |
| `AUTH_HMAC_SECRET_ARN` | ARN de chave aleatória de pelo menos 32 bytes |
| `AUTH_KMS_KEY_ARN` | chave KMS restrita à role de auth |
| `AUTH_TABLE_NAME` | tabela exclusiva para OAuth, conexões e sessões |

Origem e callback são allowlist literal na configuração compilada de produção. Alterações para outro ambiente exigem configuração revisada, cliente e tabela distintos. Os nomes acima são contrato de implantação, ainda não lidos automaticamente por um binário.

## Preparação GCP já autorizada pelo usuário, em etapa posterior

Usar o projeto já criado e aberto no navegador. Habilitar Google Drive API, configurar branding/consentimento e cliente OAuth do tipo Web com callback exato `https://api.livroalivro.app.br/v1/auth/google/callback`. Pedir somente os dois escopos acima. Guardar o client secret diretamente em Secrets Manager. Não copiar configuração ou credenciais do BioRotina. Consentimento em Testing não oferece garantia de sessão duradoura: publicar e concluir verificações aplicáveis antes do release.

Firebase não armazena biblioteca nem substitui a permissão Drive. Este fluxo de OAuth Web não requer Firebase Auth; se Firebase for utilizado para outro recurso, sua configuração deve preservar consentimentos separados.

Referências: [OAuth Web Server do Google](https://developers.google.com/identity/protocols/oauth2/web-server), [OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect), [Drive appDataFolder](https://developers.google.com/workspace/drive/api/guides/appdata).

## Verificação local

```sh
cargo fmt --manifest-path api/Cargo.toml -- --check
cargo clippy --manifest-path api/Cargo.toml --all-targets --all-features -- -D warnings
cargo test --manifest-path api/Cargo.toml --all-features
```

Fixtures são sintéticas. Testes não acessam Google/AWS e não geram credenciais reais.
