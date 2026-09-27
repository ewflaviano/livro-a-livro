# Runtime OAuth AWS

A API só recebe controles OAuth/sessão. Nenhum contrato de livro, nota, capa, backup ou hash da biblioteca existe neste runtime.

## Executáveis e configuração

- `auth` (`--features lambda`): Axum via Lambda HTTP API v2.
- `revocation` (`--features lambda`): EventBridge com evento vazio, orçamento de trabalho de 20 s. Timeout Lambda deve ser 25 s, menor que lease de 30 s.
- `auth-admin` (`--features aws`): ferramenta local IAM; **não publicar como endpoint/Lambda**.

Variáveis de runtime: `AUTH_TABLE_NAME`, `AUTH_KMS_KEY_ID` (ARN), `AUTH_SECRET_ARN`, `APP_ENVIRONMENT=production`, `AWS_REGION=sa-east-1`. Origem/callback/destino permanecem literais em `Config::production`.

Secrets Manager deve fornecer JSON estrito com `client_id`, `client_secret`, `hmac_key`. HMAC usa bytes ASCII da string (mínimo 32), sem decodificação base64 implícita. Configuração ausente/inválida falha fechada com erro genérico; não há store/segredo de desenvolvimento ou fallback em memória. Nunca registrar o documento. Rotação de HMAC exige plano de migração dos vínculos e sessões; não trocar em cada deploy.

KMS Encrypt/Decrypt recebe contexto `application=livro-a-livro`, `environment=production`, `connection=<HMAC opaco>`. Plaintext limitado a 4096 bytes, sem truncar. Esses campos técnicos entram no CloudTrail; jamais usar subject, token, e-mail ou biblioteca no contexto.

## DynamoDB e permissões

Tabela exclusiva com `pk` string e TTL `deleteAfter`; GSI `work-due`: `workType` string + `workAt` number, projeção KEYS_ONLY. Sem streams/Scan. IAM: GetItem/PutItem/UpdateItem/DeleteItem/ConditionCheckItem conforme runtime; worker não precisa DeleteItem, precisa Query no índice. TransactGet/TransactWrite autorizam suas suboperações IAM.

Prefixos: CONTROL#grants, OAUTH#hash, SESSION#hash, CONNECTION#HMAC. Conexões guardam registro técnico em atributo JSON `data`, `recordVersion` para CAS, ciphertext separado em `encryptedRefresh` Binary e agenda GSI. Sessões guardam `data` e TTL. OAuth guarda apenas hashes e nonce/verifier temporários, nunca código OAuth. Nenhum access token ou subject é persistido.

Toda autorização verifica prazo em leitura consistente/TransactGet; ações sensíveis repetem pré-condições CAS/ConditionCheck na escrita. TTL apenas remove fisicamente depois. Uma sessão vencida, removida ou renovada durante refresh impede o finish/publicação do access token. Callback captura epoch antes de exchange e não tenta novamente com epoch novo após conflito. Lease perdido/expirado nunca publica token nem substitui credencial. O core também confere o prazo mínimo após finish, pois a latência AWS pode atravessar a validade durante a transação.

O SDK usa token estável de idempotência por TransactWrite e no máximo duas tentativas dentro de 5 s de orçamento AWS; resultados incertos não são reconstruídos automaticamente pela aplicação. Erros externos são convertidos para códigos internos, sem Debug do SDK.

## Revogação e limpeza

`invalid_grant` confirmado remove credencial/invalida geração com epoch e permite novo OAuth, sem revogação externa de um token já inválido. Escopos retirados usam revogação pendente.

Disconnect bloqueia atomicamente geração/acesso antes de tentar Google. Tentativa imediata e worker usam o mesmo claim, contexto e estado `dispatching` durável. Falha de KMS anterior ao despacho pode ser reagendada. Resposta não bem-sucedida, timeout ou interrupção após possível despacho vira uncertain: nenhum retry automático de Google e nenhuma reconexão.

Worker inicia no máximo uma revogação externa por invocação e somente nos primeiros cinco segundos; cleanup continua em lote. O baixo volume inicial cabe nesse orçamento, e ampliar capacidade exige revisar limites/alarme de backlog. Worker consulta lotes limitados do índice (que é apenas descoberta), relê a base consistentemente e progride os itens. Item queued abandonado pode ser reclamado depois do lease; dispatching abandonado vira uncertain. Deadline de 24 h é verificado antes de retornar bytes/decifrar/despachar/finalizar. Ao vencer, job remove explicitamente ciphertext e mantém bloqueio/tombstone; atraso AWS não torna a credencial utilizável. Inatividade de 180 dias cria revogação com incremento de geração/epoch; CAS recusa expirar conexão com atividade nova.

Tombstones não são removidos automaticamente. Sessões/OAuth vencidos são recusados mesmo antes do TTL. Backups históricos/PITR podem reter ciphertext depois da exclusão ativa; não prometer expurgo físico exato durante falha AWS ou em histórico.

### Resolução de uncertain

1. Confirmar com a pessoa que Livro a Livro foi removido nas permissões Google.
2. Confirmar ausência de execução em voo; lease vencido sozinho não é prova de que Google não recebeu a requisição.
3. Obter connectionId, generation e revocationId do registro técnico por acesso IAM autorizado, sem copiar ciphertext/segredos em logs/tickets.
4. Executar com role administrativa limitada, região e tabela exatas:

```sh
CARGO_BUILD_JOBS=2 cargo build --manifest-path api/Cargo.toml --features aws --bin auth-admin
AWS_REGION=sa-east-1 AUTH_TABLE_NAME="$TABLE" api/target/debug/auth-admin "$CONNECTION_ID" "$GENERATION" "$REVOCATION_ID" --confirmed-google-revoked-no-inflight
```

O comando só aceita uncertain, chave completa e lease não vigente; CAS + incremento de epoch apagam ciphertext e marcam revoked. Não precisa ler Secrets Manager/KMS. Retorna apenas código fixo. Novo OAuth é necessário depois; nenhuma operação administra arquivos Drive/biblioteca.

## Observabilidade

Não inicializar subscriber de tracing nem logging HTTP/SDK. Auth só emite EMF fixo RevocationUncertain quando tentativa imediata fica incerta. Worker emite uma linha EMF agregada por execução em `LivroALivro/Auth`, sem dimensões/IDs: Processed, RevocationUncertain, CleanupCompleted, Failed, Incomplete e Duration. INFO deve permitir esses eventos; nenhuma entrada/erro externo é serializada. Alarmar Failed/Incomplete/Uncertain e ausência de invocações, além de erros/throttles Lambda. Um lote vazio bem-sucedido emite zeros.

## Checks e gates reais

```sh
cargo fmt --manifest-path api/Cargo.toml -- --check
CARGO_BUILD_JOBS=2 cargo clippy --manifest-path api/Cargo.toml --all-targets --all-features -- -D warnings
CARGO_BUILD_JOBS=2 cargo test --manifest-path api/Cargo.toml --all-features
```

Os testes `api/tests/aws.rs` são ignorados por padrão. Usam somente fixtures sintéticas e exigem recursos isolados (nome de tabela com prefixo `livro-a-livro-auth-gate-`):

```sh
AWS_PROFILE=biorotina AWS_REGION=sa-east-1 AUTH_TEST_TABLE="$ISOLATED_TABLE" AUTH_TEST_KMS_KEY="$ISOLATED_KEY_ARN" CARGO_BUILD_JOBS=2 cargo test --manifest-path api/Cargo.toml --all-features --test aws -- --ignored --test-threads=1
```

Executam concorrência, prazos, leases/fencing/rotação, renew, callback atravessado por epoch, revogação incerta/reconexão/limpeza/inatividade e KMS com contexto incorreto. Não acessam Google nem secret real. A integração OAuth/Drive em domínio canônico e a revisão IAM continuam gates separados antes de habilitar o frontend.
