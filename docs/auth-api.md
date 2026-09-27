# API de autorização do Drive

A issue #10 implementou o núcleo Rust/Axum. A issue #13 acrescenta os adaptadores oficiais AWS para DynamoDB, KMS e Secrets Manager, os executáveis `auth`/`revocation` e a infraestrutura separada da PWA. O único store em memória está em testes, nunca no runtime. A ativação pública do Drive depende dos gates reais descritos em [drive-release-gate.md](drive-release-gate.md), além dos testes de contrato.

## Fronteira

O serviço recebe exclusivamente os controles de autorização. As rotas de controle exigem body vazio; queries são recusadas fora do callback. Um limite de 16 KiB também rejeita payloads grandes antes do handler. Não existem contratos de livro, nota, avaliação, backup, hash da biblioteca, imagem ou transferência de Drive. O provider conhece apenas endpoints fixos de token, JWKS e revogação Google.

O cliente pede um access token e faz as transferências **diretamente entre PWA e Google Drive** ([conector e modo local](drive-sync.md)). Capas locais seguem a mesma fronteira direta; nunca transitam por esta API. As issues #37/#39 implementaram validação, atomicidade e limites portáveis da recuperação com mídia.

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
- DynamoDB exige lease distribuído/fencing e atualização atômica do refresh token rotacionado; uma operação expirada/revogada não pode liberar seu access token. `invalid_grant` ou escopos retirados invalidam a geração. Revogação bloqueia imediatamente; tentativas comprovadamente não enviadas podem ser repetidas por até 24h. Uma resposta incerta não permite repetição nem reconexão automática. Arquivos Drive e biblioteca local nunca são apagados.

`Secret` não implementa Debug/Serialize e limpa sua String ao sair de escopo. Isso reduz exposição acidental, sem alegar eliminar todas as cópias que bibliotecas de HTTP/JSON podem produzir. O código não registra requisições, headers, códigos, identidades ou tokens.

## Composição durável — issue #13

Invariantes verificadas pelo adaptador, sem confiar na remoção eventual por TTL:

1. Leituras consistentes, transações condicionais, hashes de sessão e prazos conferidos nas operações. A posse de refresh dura 30s e limita inclusive tentativas que falham. Renovação remove a sessão antiga e cria a nova atomicamente, sem estender os 180 dias absolutos.
2. KMS autentica `application=livro-a-livro`, `environment=production` e conexão opaca. O contexto pode aparecer em registros administrativos AWS; nunca contém subject, e-mail, token ou biblioteca. A chave HMAC está no Secrets Manager com o segredo OAuth; não é derivada do client secret.
3. O callback lê o epoch global antes de trocar o código no Google. A criação da sessão exige que ele permaneça igual e que a conexão não esteja bloqueada. Revogação avança esse epoch, impedindo um callback antigo de ressuscitar acesso. Pode ser necessário repetir consentimento quando outra revogação coincidir; nunca se revoga automaticamente o token descartado.
4. O worker usa o índice apenas para encontrar candidatos; condições na tabela base autorizam cada alteração. Inatividade de 180 dias inicia o mesmo protocolo de bloqueio/revogação. Deadline de 24h impede uso da credencial mesmo se a limpeza atrasar.
5. Antes de chamar o Google, a tentativa é marcada como enviada. Se o processo morrer ou o resultado for ambíguo, o estado passa a incerto: não se toma o lease para repetir a chamada. Conclusão e limpeza exigem geração, operação e proprietário corretos.
6. Configuração ausente/inválida falha com código genérico. Não existe fallback em memória, segredo de desenvolvimento ou logging de erro bruto do SDK. Roles de execução não têm acesso a S3.

Configuração dos executáveis:

| Nome | Fonte / conteúdo |
| --- | --- |
| `APP_ENVIRONMENT` | `production`; outro valor falha fechado |
| `AUTH_SECRET_ARN` | segredo JSON estrito com `client_id`, `client_secret` e `hmac_key` (mínimo 32 bytes literais) |
| `AUTH_KMS_KEY_ID` | ARN da chave KMS do projeto |
| `AUTH_TABLE_NAME` | tabela exclusiva para OAuth, conexões e sessões |
| `AWS_REGION` | `sa-east-1`, fornecida pelo Lambda |

Origem e callback são allowlist literal na configuração compilada de produção. Alterações para outro ambiente exigem configuração revisada, cliente e tabela distintos. O [runbook](deployment.md#revogação-incerta) descreve retenção, alarmes e resolução assistida do bloqueio; expiração e limpeza nunca substituem confirmação do resultado externo.

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

Fixtures são sintéticas. A suíte padrão não acessa Google/AWS. Os testes ignorados de `api/tests/aws.rs` exigem recursos AWS isolados e variáveis explícitas, conforme [api/README.md](../api/README.md#checks-e-gates-reais); não usam conta Google nem segredo real. OAuth/Drive reais são um gate separado com autorização humana em perfis descartáveis.
