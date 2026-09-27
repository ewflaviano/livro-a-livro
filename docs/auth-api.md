# API de autorização do Drive

A issue #10 implementou o núcleo Rust/Axum. A issue #13 acrescenta os adaptadores oficiais AWS para DynamoDB, KMS e Secrets Manager, os executáveis `auth`/`revocation` e a infraestrutura separada da PWA. O único store em memória está em testes, nunca no runtime. A ativação pública do Drive depende dos gates reais descritos em [drive-release-gate.md](drive-release-gate.md), além dos testes de contrato.

## Fronteira

O serviço recebe exclusivamente os controles de autorização. As rotas de controle exigem body vazio; queries são recusadas fora do callback. Um limite de 16 KiB também rejeita payloads grandes antes do handler. Não existem contratos de livro, nota, avaliação, backup, hash da biblioteca, imagem ou transferência de Drive. O provider conhece apenas endpoints fixos de token, JWKS e revogação Google.

O cliente pede um access token e faz as transferências **diretamente entre PWA e Google Drive** ([conector e modo local](drive-sync.md)). Capas locais seguem a mesma fronteira direta; nunca transitam por esta API. As issues #37/#39 implementaram validação, atomicidade e limites portáveis da recuperação com mídia.

## Contrato HTTP

Todas as respostas, inclusive erros, têm `Cache-Control: no-store`, `Referrer-Policy: no-referrer` e não incluem erros brutos do Google. CORS permite exclusivamente `https://livroalivro.app.br`, com credenciais. Preview/localhost precisam de composição/configuração separada; não estão liberados em produção.

| Rota | Requisição | Resposta |
| --- | --- | --- |
| `POST /v1/auth/google/start` | Origin exata, sem body | URL de identificação Google (`openid`), cookie OAuth temporário; encerra sessão deste navegador |
| `GET /v1/auth/google/identity` | Origin exata, cookie de identidade | `connectionId`, `expiresAt`, `csrfToken`; nenhuma sessão Drive |
| `POST /v1/auth/google/drive/start` | Origin, identidade temporária e seu `x-lal-csrf`, sem body | URL de consentimento Drive, novo state/nonce/PKCE |
| `DELETE /v1/auth/google/identity` | Origin, identidade temporária e seu `x-lal-csrf` | cancela a identidade e remove seu cookie |
| `GET /v1/auth/google/callback` | state, iss Google exato, code e cookie OAuth temporário | 303 para `https://livroalivro.app.br/#/dados`; etapa 1 emite identidade temporária, etapa 2 emite sessão Drive; nenhum token na URL |
| `GET /v1/session` | Origin exata, cookie | `connectionId`, `generation`, `expiresAt`, `csrfToken`, `scopes` |
| `POST /v1/session/renew` | Origin, cookie e `x-lal-csrf` | nova sessão/cookie, `csrfToken`, `expiresAt` |
| `POST /v1/auth/drive-token` | Origin, cookie e `x-lal-csrf` | somente `accessToken`, `expiresIn`, `scopes` |
| `DELETE /v1/session` | Origin, cookie e `x-lal-csrf` | 204 e cookie removido; encerra este aparelho |
| `DELETE /v1/drive-connection` | Origin, cookie e `x-lal-csrf` | `disconnected`, `revocationPending`; bloqueia a conexão globalmente |

O frontend usa `credentials: include` nas chamadas da API. Não envia body `{}`: os controles são deliberadamente sem body. Cada URL de autorização é usada para navegação completa após seu próprio clique: **Entrar com Google** e, depois do retorno à interface, **Autorizar Google Drive**. Não há redirecionamento automático entre as etapas. O callback não tem analytics nem HTML executável. Exige exatamente um `iss=https://accounts.google.com`, inclusive em respostas de erro, conforme [a referência oficial Google](https://developers.google.com/identity/openid-connect/reference#authorization-endpoint) e [RFC 9207](https://www.rfc-editor.org/rfc/rfc9207.html). Esse campo não escolhe endpoint ou concedente; a assinatura e os demais controles continuam obrigatórios. Parâmetros de resposta não reconhecidos são ignorados sem uso, persistência ou eco, conforme RFC 6749; campos conhecidos continuam tipados e sem duplicação, com limite total de 8 KiB. Os parâmetros informativos `scope`, `authuser` e `prompt` do callback são tolerados, mas não confiáveis: a concessão é validada na resposta do endpoint de tokens.

O access token permanece somente em memória durante a execução do PWA. Não entra em localStorage, IndexedDB, service worker, BroadcastChannel, URL, backup ou telemetria. O cliente reaproveita o token até perto da expiração; uma nova emissão pode retornar 429 com `Retry-After: 30`. A aba deve aguardar e tentar novamente, sem logout. `connectionId` é identificador técnico opaco para vínculo, nunca dimensão de métricas.

## Proteções implementadas

- State, nonce, PKCE verifier e cookies aleatórios de 256 bits. Challenge S256. Transação de dez minutos, consumo atômico de uso único vinculado ao cookie.
- Troca confidencial em duas etapas. Identificação solicita somente `openid`, com `access_type=online`, `prompt=select_account` e `include_granted_scopes=false`. Valida o ID token e descarta tokens de acesso/refresh sem usá-los ou revogá-los. Não cria conexão, sessão Drive ou cifra KMS.
- A identidade pendente dura dez minutos, sem renovação, em cookie `__Host-lal_identity` HttpOnly/Secure/SameSite=Lax. Dynamo guarda apenas o vínculo HMAC do subject validado e o hash do cookie, nunca e-mail, perfil ou ID token. Essa identidade não autoriza sessão, renovação ou emissão de token Drive.
- O segundo clique solicita exatamente `openid` e `https://www.googleapis.com/auth/drive.appdata`, `access_type=offline`, `prompt=consent`, `include_granted_scopes=false`, com novos state/nonce/PKCE. Rejeita conta diferente da etapa anterior e concessão extra ou incompleta. Exige refresh token novo no consentimento; se ausente retorna `incomplete_consent` sem criar sessão. O Google pode apresentar sua própria seleção de permissões nessa etapa.
- ID token verificado localmente por assinatura RS256/JWKS, issuer, audience exata, expiração, nonce e `azp` quando presente. Cache de JWKS por cinco minutos, respostas limitadas a 64 KiB, timeout e redirects de rede desativados. Chave nova desconhecida pode requerer nova tentativa após expiração do cache.
- Cookie `__Host-lal_session`, `Secure; HttpOnly; SameSite=Lax; Path=/`, sem Domain. O serviço persiste apenas hash do cookie; CSRF deriva de HMAC com propósito próprio. Sessão 30 dias, renovação explícita com rotação dentro de 180 dias absolutos.
- DynamoDB exige lease distribuído/fencing e atualização atômica do refresh token rotacionado; uma operação expirada/revogada não pode liberar seu access token. `invalid_grant` ou escopos retirados invalidam a geração. Revogação bloqueia imediatamente; tentativas comprovadamente não enviadas podem ser repetidas por até 24h. Uma resposta incerta não permite repetição nem reconexão automática. Arquivos Drive e biblioteca local nunca são apagados.

`Secret` não implementa Debug/Serialize e limpa sua String ao sair de escopo. Isso reduz exposição acidental, sem alegar eliminar todas as cópias que bibliotecas de HTTP/JSON podem produzir. O código não registra requisições, headers, códigos, identidades ou tokens.

## Composição durável — issue #13

Invariantes verificadas pelo adaptador, sem confiar na remoção eventual por TTL:

1. Leituras consistentes, transações condicionais, hashes de sessão e prazos conferidos nas operações. A posse de refresh dura 30s e limita inclusive tentativas que falham. Renovação remove a sessão antiga e cria a nova atomicamente, sem estender os 180 dias absolutos.
2. KMS autentica `application=livro-a-livro`, `environment=production` e conexão opaca. O contexto pode aparecer em registros administrativos AWS; nunca contém subject, e-mail, token ou biblioteca. A chave HMAC está no Secrets Manager com o segredo OAuth; não é derivada do client secret.
3. O callback da etapa Drive lê o epoch global antes de trocar o código no Google. A criação da sessão exige que ele permaneça igual e que a conexão não esteja bloqueada. Revogação avança esse epoch, impedindo um callback antigo de ressuscitar acesso. Pode ser necessário repetir consentimento quando outra revogação coincidir; nunca se revoga automaticamente o token descartado.
4. O worker usa o índice apenas para encontrar candidatos; condições na tabela base autorizam cada alteração. Inatividade de 180 dias inicia o mesmo protocolo de bloqueio/revogação. Deadline de 24h impede uso da credencial mesmo se a limpeza atrasar.
5. Antes de chamar o Google, a tentativa é marcada como enviada. Se o processo morrer ou o resultado for ambíguo, o estado passa a incerto: não se toma o lease para repetir a chamada. Conclusão e limpeza exigem geração, operação e proprietário corretos.
6. Configuração ausente/inválida falha com código genérico. Não existe fallback em memória, segredo de desenvolvimento ou logging de erro bruto do SDK. Roles de execução não têm acesso a S3.

A finalidade de cada OAuth fica na transação durável, nunca no query informado pelo navegador. A criação da sessão Drive consome a identidade pendente na mesma transação que verifica epoch e conexão: cancelamento, expiração ou consumo concorrente falham sem sessão parcial. Transações OAuth antigas sem finalidade são recusadas; uma nova tentativa deve começar pela identificação. Sessões Drive completas anteriores continuam válidas.

Erros do callback usam mensagens HTML estáticas distintas para autorização negada, identidade expirada, permissão Drive incompleta, conta diferente e falha geral. Não incluem parâmetros ou mensagens recebidas do Google. A falha desta nova tentativa foi reproduzida em 27/09 no navegador normal: o Google devolveu `iss` junto com os campos esperados e o parser estrito respondeu 400 antes da troca do código, pois não declarava esse campo. O identificador agora é aceito somente com o valor Google exato; campo ausente, duplicado ou diferente continua recusado. A tentativa anterior não teve seu status preservado e não pode ser atribuída retrospectivamente à mesma causa. Nenhum código, token ou conteúdo da biblioteca foi incluído nos registros de diagnóstico.

Configuração dos executáveis:

| Nome | Fonte / conteúdo |
| --- | --- |
| `APP_ENVIRONMENT` | `production`; outro valor falha fechado |
| `AUTH_SECRET_ARN` | segredo JSON estrito com `client_id`, `client_secret` e `hmac_key` (mínimo 32 bytes literais) |
| `AUTH_KMS_KEY_ID` | ARN da chave KMS do projeto |
| `AUTH_TABLE_NAME` | tabela exclusiva para OAuth, conexões e sessões |
| `AWS_REGION` | `sa-east-1`, fornecida pelo Lambda |

Origem e callback são allowlist literal na configuração compilada de produção. Alterações para outro ambiente exigem configuração revisada, cliente e tabela distintos. O [runbook](deployment.md#revogação-incerta) descreve retenção, alarmes e resolução assistida do bloqueio; expiração e limpeza nunca substituem confirmação do resultado externo.

## Configuração GCP

O projeto exclusivo `livro-a-livro` usa Google Drive API e cliente OAuth do tipo Web com callback exato `https://api.livroalivro.app.br/v1/auth/google/callback`. Solicitar os escopos em duas etapas, conforme acima. O client secret fica somente no Secrets Manager. Domínio verificado, marca aprovada/publicada e audiência em produção estão registrados no [runbook](deployment.md). Não copiar configuração ou credenciais do BioRotina. Consentimento em Testing não oferece garantia de sessão duradoura: publicar e concluir verificações aplicáveis antes do release.

Firebase não armazena biblioteca nem substitui a permissão Drive. Este fluxo de OAuth Web não requer Firebase Auth; se Firebase for utilizado para outro recurso, sua configuração deve preservar consentimentos separados.

Referências: [OAuth Web Server do Google](https://developers.google.com/identity/protocols/oauth2/web-server), [OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect), [Drive appDataFolder](https://developers.google.com/workspace/drive/api/guides/appdata).

## Verificação local

```sh
cargo fmt --manifest-path api/Cargo.toml -- --check
cargo clippy --manifest-path api/Cargo.toml --all-targets --all-features -- -D warnings
cargo test --manifest-path api/Cargo.toml --all-features
```

Fixtures são sintéticas. A suíte padrão não acessa Google/AWS. Os testes ignorados de `api/tests/aws.rs` exigem recursos AWS isolados e variáveis explícitas, conforme [api/README.md](../api/README.md#checks-e-gates-reais); não usam conta Google nem segredo real. OAuth/Drive reais são um gate separado com autorização humana em perfis descartáveis.
