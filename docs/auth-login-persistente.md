# #13 — contrato de login persistente, separado do Drive

Contrato aprovado de arquitetura da issue #13, após a integração da experiência global na PR #55. Escopo: fazer a identificação Google continuar válida ao navegar/reabrir o aplicativo; autorização Drive continua uma segunda ação explícita. Não inclui merge de bibliotecas, alteração de hash, experimentos ou perfil social.

## 1. Resultado e limites

- Entrar solicita somente `openid`, online, com state/nonce/PKCE/iss e ID token verificado. Retorna à interface com uma sessão própria de login durável. Não cria sessão Drive, não acessa arquivos e não guarda refresh/access/ID token Google dessa etapa.
- A identidade técnica continua `HMAC(connection, verified_sub)`. Não guardar email, nome, avatar ou subject cru. O aplicativo pode dizer “Conectado ao Google”, sem apresentar uma conta nominal que não conhece.
- Ao abrir o app, consultar a sessão própria; um cookie ainda válido recupera o estado automaticamente. **Nunca abrir OAuth automaticamente.** Ausência/expiração exige um novo clique; falha de rede não impede leitura/escrita local nem deve ser apresentada como logout confirmado.
- “Autorizar Google Drive” continua um segundo clique e um OAuth separado. Somente essa etapa pode criar a capacidade Drive. O login persistente não amplia escopos e não equivale a consentimento para sincronizar.
- “Pausar sincronização” mantém o login. “Sair deste navegador” encerra login e capacidade Drive deste navegador, sem revogar outros dispositivos. “Desconectar Google Drive” revoga a conexão Drive global, mantendo o login próprio; explicar essa distinção na UI.
- IndexedDB e JSON local continuam independentes de ambas as sessões. Dados da biblioteca permanecem PWA ↔ Drive.

## 2. Sessões e renovação: decisão mínima

Criar `LOGIN#sha256(cookie)` separado de `SESSION#sha256(cookie)` existente. Cookie novo: `__Host-lal_login`, Secure, HttpOnly, SameSite=Lax, Path=/, sem Domain.

Login: prazo móvel de 30 dias, limite absoluto de 180 dias contados da autenticação original. `expires_at = min(now + 30d, absolute_expires_at)`. Os prazos são conferidos no código/condições; TTL só faz coleta eventual.

**O identificador LOGIN fica estável durante essa sessão.** Renovação apenas estende o prazo por atualização condicionada; não recria registro ausente. Novo login cria identificador aleatório novo e invalida o anterior deste navegador. Isso evita introduzir famílias/aliases de login para fechar a corrida renew/logout. Não alterar a rotação existente do cookie SESSION Drive; ele continuará sendo rotacionado na sua renovação.

Essa decisão substitui a sugestão inicial de rotacionar também LOGIN. Não prometer invalidação de um cookie LOGIN anterior em uma renovação: ele é o mesmo identificador. Rotação ocorre ao autenticar de novo; logout apaga o registro estável e impede toda renovação posterior.

## 3. Registros duráveis novos/estendidos

Sem GSI novo, sem Scan, sem segredo em atributo serializável. O papel auth já deve ser revisado para os prefixos/ações; worker continua sem responsabilidade sobre LOGIN.

```text
LOGIN#<cookie_hash>
  version: 1                  // versão do formato, obrigatória
  connection_id: HMAC
  sign_in_attempt_id: UUID     // correlação técnica com intenção local; não credencial
  expires_at: seconds
  absolute_expires_at: seconds
  drive_epoch: integer        // geração da capacidade Drive NESTE login/navegador
  drive_attempt_id: UUID|null
  record_version: integer     // CAS de atualizações
  deleteAfter: absolute_expires_at

AUTH_ATTEMPT#<oauth_cookie_hash>
  version: 1
  attempt_id: UUID
  purpose: SignIn | Drive { login_hash, drive_epoch, expected_connection }
  phase: Pending | Completed { login_hash } | Cancelled
  expires_at: seconds         // no máximo 10min desde início; nunca renovado
  record_version: integer
  deleteAfter: expires_at

OAUTH#<state_hash>             // conservar nonce/verifier e take de uso único
  ...campos atuais...
  version: 2
  attempt_hash: oauth_cookie_hash
  attempt_id: UUID
  purpose: SignIn | Drive { identity_hash, expected_connection,
                           login_hash, drive_epoch }

IDENTITY#<ticket_hash>         // ticket interno Drive, deixa de ser o login da UI
  version: 2
  connection_id: HMAC
  login_hash: string
  drive_epoch: integer
  attempt_id: UUID
  expires_at: seconds
  deleteAfter: expires_at

SESSION#<session_hash>
  ...campos/prazos/generation atuais...
  version: 2
  login_hash: string
  login_drive_epoch: integer
```

`drive_epoch` é local ao LOGIN, não outro coordenador global. É necessário para cancelar uma autorização deste navegador mesmo se o callback acabou de criar SESSION ou se SESSION foi rotacionada enquanto o cancelamento chegava. Não substitui `CONTROL#grants` nem a geração da conexão Google.

OAUTH e AUTH_ATTEMPT têm papéis distintos: `take_oauth` consome o código/state antes da chamada externa; AUTH_ATTEMPT permanece como fence até o commit posterior. Sem esse segundo registro, um cancelamento durante `exchange` não impediria a criação tardia de LOGIN.

## 4. Rotas e respostas

Todas mantêm origem exata, sem query/body, respostas no-store e erros estáticos. Callback é a exceção de query já validada. Novos cabeçalhos são aceitos apenas onde necessários; acrescentar allowlist CORS e smoke.

| Rota | Autorização | Resposta/efeito |
| --- | --- | --- |
| `GET /v1/login` | Origin + cookie LOGIN | `{connectionId, signInAttemptId, expiresAt, absoluteExpiresAt, csrfToken}`; 401 se ausente/expirada; não consulta Google nem exige conexão Drive ativa |
| `POST /v1/login/renew` | LOGIN + `x-lal-csrf` login | `{expiresAt, absoluteExpiresAt, csrfToken}` e mesmo cookie com Max-Age atualizado; atualização condicionada, sem Google |
| `DELETE /v1/login` | LOGIN + CSRF login | 204; apaga LOGIN, cancela tentativa OAuth atual quando identificável, remove SESSION apresentado e limpa cookies LOGIN/SESSION/IDENTITY/OAUTH deste navegador |
| `POST /v1/auth/google/start` | Origin + `x-lal-attempt: UUID`; se LOGIN válido, CSRF login | Mesmo `{authorizationUrl}` atual; invalida LOGIN/SESSION atuais deste navegador, cria OAUTH+AUTH_ATTEMPT e emite cookie OAUTH temporário |
| `POST /v1/auth/google/drive/start` | LOGIN + CSRF login + `x-lal-attempt: UUID` | Mesmo `{authorizationUrl}`; avança drive_epoch, cria ticket IDENTITY/OAUTH/AUTH_ATTEMPT ligados ao login exato; nenhum acesso Drive ainda |
| `GET /v1/auth/google/authorization` | Origin + cookie OAUTH | `{attemptId,purpose,expiresAt,csrfToken}` para cancelar a tentativa conhecida; não retorna state/nonce/verifier/token/identidade |
| `DELETE /v1/auth/google/authorization` | cookie OAUTH + CSRF oauth-cancel + `x-lal-attempt` exato | 204; cancela somente a tentativa indicada, conforme transações abaixo. Tentativa diferente não é cancelada |
| `GET /v1/session` | LOGIN + SESSION correspondentes | Contrato Drive atual; 401 sem SESSION válida; nunca transforma login-only em sessão Drive |
| `POST /v1/session/renew` | LOGIN + SESSION + CSRF de SESSION | Rotação atual, preservando login_hash/login_drive_epoch e revalidando LOGIN no commit |
| `POST /v1/auth/drive-token` | LOGIN + SESSION + CSRF de SESSION | LOGIN válido sem capacidade Drive recebe **403** com código estático `drive_authorization_required`; nenhuma chamada Google/KMS nesse caso |
| `DELETE /v1/session` | LOGIN + SESSION + CSRF de SESSION | Encerrar somente capacidade Drive deste navegador; avançar drive_epoch, preservando LOGIN. A UI “Sair” passa a chamar DELETE login |
| `DELETE /v1/drive-connection` | LOGIN + SESSION + CSRF de SESSION | Revogação global Drive atual; mantém LOGIN e sua possibilidade de mostrar estado autenticado |

CSRFs são HMAC separados: `login-csrf`, `oauth-cancel-csrf`, e `csrf` atual de SESSION. Nunca aceitar o CSRF de LOGIN como autorização para emitir token Drive. O 403 de login-only não é o mesmo código de erro que origem/CSRF inválidos; o cliente deve distingui-los sem analisar texto livre.

O cookie OAUTH **não será apagado no callback bem-sucedido**: permanece com seu prazo original de até dez minutos, sem renovação. Isso permite cancelar a tentativa conhecida enquanto o callback termina de chegar ao navegador. State já está consumido, e a linha AUTH_ATTEMPT Completed não permite novo exchange. DELETE authorization invalida somente a tentativa durável e não emite Set-Cookie; o cookie OAuth vence no prazo original. Isso evita que uma resposta de cancelamento antiga apague o cookie de uma tentativa nova. Logout limpa cookies; novo início substitui OAuth. Não criar cookie IDENTITY novo para V2: o ticket é interno, identificado pelo OAUTH persistido. Limpar cookie IDENTITY legado nos pontos de transição.

## 5. Transações/fences obrigatórios

### Iniciar SignIn

Gerar state, cookie OAuth, nonce/verifier e validar UUID da intenção recebida. Em uma transação: cancelar tentativa anterior identificável pelo cookie OAUTH, apagar LOGIN atual (e SESSION apresentado), Put OAUTH V2 e Put AUTH_ATTEMPT Pending. Não revogar CONNECTION global. Consolidar ações sobre a mesma chave: DynamoDB não aceita duas ações na mesma linha em uma transação.

“Cancelar tentativa anterior” usa a mesma semântica abaixo: se o SignIn anterior já fez commit, incluir a remoção do LOGIN apontado pelo AUTH_ATTEMPT, mesmo que o navegador ainda não tenha recebido seu cookie. Apenas mudar a fase da tentativa, nesse caso, deixaria uma autenticação antiga viva. Se era Drive, invalidar somente o epoch daquele LOGIN, sem revogação global. Releitura após CAS pode resolver a mesma tentativa; nunca substituí-la por uma tentativa descoberta mais nova.

Origin e cabeçalho customizado protegem início sem login; quando houver LOGIN válido, exigir seu CSRF antes de removê-lo. Falha/rejeição não apaga biblioteca. Se a resposta de start chegar depois de pausa/cancelamento local, a CAS da intenção impede navegar; uma tentativa nunca navegada expira em dez minutos.

### Callback SignIn

1. Validar query/iss/cookie/state e consumir OAUTH uma vez, mantendo AUTH_ATTEMPT.
2. Verificar Pending/prazo/attempt antes de exchange. Validar ID token normalmente; descartar credenciais Google inesperadas sem revogar grant existente.
3. Após exchange, revalidar prazo. `finish_sign_in` faz uma transação com **Update condicional AUTH_ATTEMPT Pending→Completed(login_hash)** + **Put LOGIN novo inexistente**. Condição inclui attempt_id, finalidade e expires_at > now. Nenhum SESSION/CONNECTION/KMS.
4. Retornar cookie LOGIN novo, limpar cookie SESSION/IDENTITY legado, destino canônico fixo. Conferir prazos novamente antes da resposta útil. Não confiar na intenção React para validar esse commit.

### Cancelar SignIn, inclusive durante exchange

Ler AUTH_ATTEMPT consistentemente, exigir cookie+CSRF+attempt_id exato. Pending: mudar para Cancelled por CAS. Completed: transação muda para Cancelled e apaga somente o LOGIN apontado por essa tentativa. Se a fase mudou durante leitura, reler e repetir de forma limitada. Nunca reorientar cancelamento para outro attempt_id.

Assim, se cancelamento vence, finish_sign_in não faz commit. Se callback fez commit primeiro, cancelamento apaga o LOGIN recém-criado. Um Set-Cookie atrasado só aponta para um registro inexistente. Novo login de outra tentativa tem hash diferente e fica intacto.

Essa garantia é de autorização no servidor. Respostas HTTP concorrentes podem chegar fora de ordem e substituir/limpar cookies no navegador: não prometer ordenação impossível de Set-Cookie. Evitar limpar cookies desnecessariamente no cancelamento de tentativa; uma resposta atrasada que deixe cookie inválido deve resultar em estado desconectado/repetição explícita, nunca aceitar outra identidade ou recriar a linha. O cliente confirma GET login/SESSION após transições, em vez de inferir sucesso pelo cookie ou pelo 303.

### Iniciar e concluir Drive

`start_drive`: ler LOGIN válido; transação CAS incrementa drive_epoch e registra drive_attempt_id, cria IDENTITY V2, OAUTH V2 e AUTH_ATTEMPT Pending. Todos recebem a mesma connection_id, login_hash, drive_epoch e attempt_id. Prazo OAuth/ticket = min(now+600, LOGIN.expires_at, LOGIN.absolute_expires_at). A capacidade Drive antiga deste mesmo LOGIN fica inválida ao avançar o epoch; outros perfis não são afetados.

Callback: manter verificação de ticket, subject HMAC igual, escopos exatos, refresh novo, KMS e epoch global antes/depois de exchange. O commit atual `connect` passa a incluir:

- condição LOGIN existente, mesma identidade/drive_epoch/drive_attempt_id e ambos os prazos válidos;
- consumo condicional de IDENTITY V2;
- AUTH_ATTEMPT Pending→Completed, com prazo/attempt exatos;
- epoch global e CAS/lease de CONNECTION atuais;
- Put SESSION V2 ligada ao LOGIN/drive_epoch.

Conclusão mantém LOGIN. Não habilitar sincronização no backend; frontend ainda exige CAS da intenção local e opt-in enabled.

### Cancelar Drive / pausar / sair

- Cancelamento de uma tentativa Drive: transação marca AUTH_ATTEMPT Cancelled e incrementa LOGIN.drive_epoch **somente se** LOGIN ainda tiver a tentativa/epoch correspondentes. Consome/remove IDENTITY se existir. Se callback já completou, o incremento torna inútil qualquer SESSION dessa autorização, inclusive uma SESSION que tenha sido rotacionada. Não revogar CONNECTION Google nem apagar LOGIN.
- Cancelamento atrasado de uma tentativa antiga não avança epoch de uma tentativa nova. Condições sobre attempt_id/epoch são obrigatórias.
- Pausar uma conexão já estabelecida continua somente local, invalidando lease/intenção e token em memória; mantém login e sessão Drive. Se havia OAuth em andamento, também cancelar somente sua tentativa conhecida.
- Sair apaga LOGIN estável: todas as SESSION ligadas a ele deixam de autorizar imediatamente, mesmo que outro request tenha rotacionado SESSION. Apagar o SESSION apresentado é coleta complementar; não depender de descobrir todos os hashes rotacionados.
- Se logout corre com finish/renew, ou logout vence e o commit condicionado falha, ou commit vence e a remoção do LOGIN deixa seu resultado inutilizável. Nunca usar Put para renovar LOGIN.

### Token e renovação Drive

`session`, `renew`, `claim` e `finish` precisam revalidar LOGIN e login_drive_epoch. Lease carrega login_hash/epoch e authorization_until inclui os prazos LOGIN além dos prazos atuais. O finish transacional faz ConditionCheck LOGIN junto com o de SESSION/CONNECTION. Após finish, manter verificação temporal antes de publicar token.

Revogação global mantém epoch/generation/worker/Uncertain atuais e invalida Drive em todos os perfis, mas não apaga os LOGIN desses perfis. GET login continua 200; GET session/token recusa Drive até nova autorização explícita permitida. Nenhuma revogação de token Google ocorre ao expirar ou encerrar apenas LOGIN.

## 6. Portas mínimas propostas

Assinaturas abaixo descrevem operações atômicas; tipos concretos podem seguir o estilo atual, sem expor credenciais na camada Store.

```rust
login(login_hash, now) -> Login
renew_login(login_hash, now) -> Login // CAS Update, nunca Put/recriação
logout_login(login_hash, presented_session_hash?, attempt_hash?, now) -> ()
begin_sign_in(attempt_id, oauth_cookie_hash, state_hash, transaction,
              previous_login_hash?, previous_session_hash?, previous_attempt_hash?, now) -> ()
finish_sign_in(attempt_hash, attempt_id, new_login_hash, connection_hmac, now) -> Login
authorization(attempt_hash, now) -> AuthorizationAttempt
cancel_authorization(attempt_hash, expected_attempt_id, now) -> ()
begin_drive(login_hash, attempt_id, ticket_hash, oauth_cookie_hash,
            state_hash, transaction, now) -> ()
// connect/session/renew/claim/finish existentes: acrescentar contexto LOGIN/drive_epoch.
```

Operações condicionais mantêm retry limitado apenas quando reler a mesma tentativa/LOGIN permite continuar com a mesma semântica. Nunca capturar epoch global novo para reaproveitar grant obtido antes de revogação. Manter idempotency token já usado nos TransactWrite existentes, quando aplicável.

## 7. Frontend, estado global e troca de conta

- Manter login em estado global em memória: `checking | signed-out | signed-in | unavailable`. GET login no bootstrap e ao voltar ao foco; deduplicar chamadas. Renovar quando restarem menos de sete dias, respeitando limite absoluto. Não criar polling rápido só para login.
- `signed-in` não implica `sync.enabled`. Sem Drive, topo oferece Autorizar Drive; usuário pode continuar indefinidamente sem autorizar enquanto seu login estiver válido.
- “Agora não” no convite Drive persiste localmente `drivePromptDismissedForSignIn: signInAttemptId` (UUID técnico, sem credencial; campo com default null, fora de backup/Drive). Consultar essa escolha ao montar/reabrir: o convite não reaparece para o mesmo login, mas a ação explícita do topo continua disponível. Novo SignIn gera outro UUID e pode oferecer o convite novamente; renovar LOGIN não muda o UUID nem remove a recusa. Sincronizar a atualização entre abas pelo mecanismo local existente. Se a preferência não puder ser gravada, manter a dispensa em memória e não bloquear biblioteca/login. Não usar apenas estado React como implementação definitiva.
- Intenção local deve distinguir `signin-starting/signin` de `drive-starting/drive`; UUID gerado antes de start é o `x-lal-attempt`. Não inspecionar/usar identidade anterior enquanto start está em voo. Ao observar LOGIN após SignIn, exigir signInAttemptId esperado antes de concluir a intenção; não ligar Drive automaticamente.
- Cancelar faz primeiro CAS local para disabled/sem intenção + revogação de lease. Capturar o UUID antigo antes de limpá-lo. GET authorization pode fornecer CSRF após reload, mas só DELETE se seu attemptId for exatamente o UUID capturado. Não cancelar tentativa de outra aba por descoberta tardia.
- **Sair enquanto SignIn está em andamento:** o início já pode ter invalidado o LOGIN anterior, ou pode ser a primeira entrada. Nesse estado, `DELETE /v1/login` não é a operação disponível. “Sair”/“Cancelar entrada” captura o UUID da intenção e usa `GET/DELETE /v1/auth/google/authorization`, com a comparação exata acima, inclusive sem LOGIN. Não omitir essa chamada por estar visualmente desconectado: é ela que fecha a corrida com um callback em voo. Se a primeira etapa já terminou e GET login confirma uma LOGIN válida, a ação Sair normal usa o CSRF dessa LOGIN e DELETE login; nunca reutiliza CSRF expirado do login anterior.
- Se OAuth não foi iniciado mas seu start está em voo, CAS local impede navegação tardia. Logout cancela tentativa durável quando já existe; uma resposta start atrasada não possui login autenticado e expira sem acesso.
- **Falha/offline durante saída ou cancelamento:** pausar envios localmente é a primeira operação durável; invalidar token em memória e intenção/lease. Só anunciar “Você saiu deste navegador” depois de DELETE login confirmado. Falha de rede/5xx não confirma logout, mesmo que o servidor eventualmente tenha executado a remoção. Mostrar “Não foi possível confirmar sua saída. A sincronização está pausada. Tente sair novamente quando houver conexão.” Para cancelamento de SignIn sem LOGIN, usar mensagem equivalente sobre o cancelamento da entrada, sem afirmar que o callback foi cancelado.
- Não criar fila de logout, família de login ou retry destrutivo automático nesta fatia. O aviso específico da falha vale no documento atual. Após reload, GET login continua sendo a autoridade: 200 mostra conectado com sincronização pausada e ação explícita Sair; 401 mostra desconectado; falha de rede mostra conexão não verificada. Se 200, pode informar “Você ainda está conectado ao Google. A sincronização permanece pausada.” Isso também é verdadeiro para uma pausa voluntária e não exige persistir a causa da pausa. **Nunca** inferir signed-out apenas de `sync.enabled=false`, nem reabilitar enabled ao reidratar LOGIN. O retry é novo clique e verifica as credenciais/tentativa atuais; não reutiliza um cancelamento antigo contra outra tentativa.
- Login/Drive start/callback tardios não navegam sobre formulário/backup/atualização em andamento. Reusar o bloqueio de navegação da fatia UX; falha deve permitir tentar novamente ou cancelar.
- “Trocar conta” inicia SignIn explicitamente, pausa sync e invalida LOGIN atual. A biblioteca atual continua visível e não muda de proprietário por suposição. Após autorização de outra conta, conservar a proteção accountChanged e exigir escolha explícita antes de enviar dados locais ao novo Drive. Não copiar arquitetura guest/account do BioRotina nesta fatia.
- Novo login não transfere automaticamente antiga capacidade Drive para outra LOGIN. Retomada automática usa somente LOGIN + SESSION existentes e válidos. Após expiração absoluta/reidentificação, o segundo passo explícito volta a ser necessário.
- API indisponível/offline preserva dados e preferências, mostra estado de conexão verificável e não abre Google nem apaga sessão local por suposição.

## 8. Migração e rollout sem promoção implícita

Ainda não há usuários públicos do Drive; sessões atuais são do ensaio. Preferir reinício explícito de autenticação a adicionar uma rota de conversão legada que amplia privilégio.

1. Adicionar versões/tipos novos; ler registros antigos o suficiente para classificá-los como legados. Ausência de version/login_hash não pode virar erro interno 500 nem valor implícito que autorize.
2. OAUTH/IDENTITY legados: recusar como tentativa expirada/reinício necessário, sem criar LOGIN/SESSION. Conservar TTL para coleta eventual. `GET/DELETE /v1/auth/google/identity` podem permanecer temporariamente como rotas legadas de expiração/cancelamento; nunca retornar LOGIN persistente por esse contrato antigo.
3. SESSION legada sem login_hash: retornar 401/reconnect e limpar cookie quando apropriado, sem usar refresh nem revogar CONNECTION. Não promover automaticamente para LOGIN. Dados IndexedDB, snapshots e backups intactos.
4. CONNECTION/CONTROL e ciphertext existentes permanecem no contrato atual. Uma nova autorização explícita pode reutilizar a mesma conexão lógica segundo CAS/epoch existentes; não apagar segredos ou arquivos como migração.
5. LOGIN/SESSION V2 usam os mesmos limites de prazo e migram somente por criação legítima. Não há migração de LibraryExport, hash ou livros nesta fatia.
6. API pode ser publicada antes do frontend mantendo a flag pública false. Builds QA/abas antigas receberão erro de reconexão durante a janela; encerrar ensaio antigo e abrir o novo build, sem prometer compatibilidade de autenticação do cliente anterior. Deploy frontend atualiza contratos/header allowlists/harness e mensagens. Nenhum fallback inseguro para clientes antigos.
7. Documentar retenção LOGIN/AUTH_ATTEMPT, renovação sem rotação de LOGIN, segunda autorização e logout. Atualizar privacidade factual; nunca afirmar remoção física exata por TTL.

## 9. Gates da fatia

### Unitários e HTTP

- Primeira etapa produz LOGIN e nenhum SESSION/CONNECTION/cifra; refresh inesperado descartado sem revoke. GETlogin200 e drive-token403/login-only, zero provider.refresh.
- Campos/scopes/iss/nonce/state/PKCE e erro estático existentes continuam cobertos. POSTs novos recusam body/query/origem/CSRF/attempt malformados e CSRF de propósito errado.
- Cancelar SignIn antes/durante/depois do commit, inclusive resposta Set-Cookie atrasada; nunca sobra LOGIN autorizável. Cancelar tentativa antiga não afeta login novo.
- Drive start/callback: LOGIN expirado/apagado, outra conta, epoch local/global avançado, ticket cancelado/consumido e prazo cruzado falham sem capacidade parcial.
- Cancelamento Drive depois de commit e depois de renewSESSION invalida capacidade via epoch local, mantendo LOGIN; tentativa nova permanece intacta.
- renewLOGIN vs logout em ambas ordens, prazo absoluto e TTL não removido; renew nunca faz ressurreição. renewSESSION/refresh finish vs logout/cancel revalidam LOGIN/epoch.
- Sair durante SignIn sem LOGIN usa a tentativa capturada e cancela o fence; não depende de DELETE login. Resposta de uma tentativa diferente não é cancelada. Callback que já fez commit é neutralizado pela mesma operação de cancelamento da tentativa conhecida.
- Revogação Drive mantém GETlogin200 e nega tokens; login-only nunca acessa KMS/refresh. Expiração/login logout não chama provider.revoke.
- Legados têm resultados explícitos de reinício; nenhum 500, promoção automática ou alteração de biblioteca.

### DynamoDB real isolado

- Concorrência finish_sign_in/cancel e cookie de callback atrasado representado por leitura do hash depois; observar zero login válido quando cancelamento terminou.
- renew_login/logout com barreiras determinísticas; cancel antigo/new SignIn e old Drive/new Drive epoch.
- connect/refresh finish/session renew concorrendo com logout e cancel Drive, incluindo callback commit antes do cancel e rotação SESSION antes do cancel.
- Manter gates existentes de epoch global, KMS/contexto, leases, idempotência de resposta perdida e revogação incerta. Não repetir todos sem necessidade, mas executar regressão existente.

### Navegador normal / sintético

- Entrar Google uma vez, retornar sem Drive, navegar/recarregar/reabrir e observar login restaurado + Drive ausente; nenhum novo consentimento automático.
- Segundo clique autoriza Drive; upload/restauração exclusivamente sintéticos. Login e status acessíveis em todas as páginas.
- Pausar mantém login; cancelar segundo consentimento mantém login; sair permanece encerrado após reload. Por decisão posterior do responsável, a saída confirmada também limpa a biblioteca e demais dados locais do navegador, após confirmação explícita do risco para alterações ainda não enviadas. Troca de conta não envia biblioteca à nova conta antes de escolha explícita.
- O gate “sair permanece encerrado” requer DELETE confirmado. Cobrir separadamente DELETE offline/5xx → aviso sem sucesso → reload: se LOGIN ainda válida, mostrar conectado/Drive pausado; enabled continua false, nenhum upload e Sair continua disponível. Em falha de resposta após commit, bootstrap 401 pode confirmar estado desconectado sem alegar que a resposta anterior foi recebida. Cobrir também cancelamento de entrada offline seguido de callback concluído: LOGIN pode reaparecer, mas a intenção local cancelada nunca habilita sincronização automaticamente.
- Fronteira de rede continua sem biblioteca/nota/capa/hash na API própria. Não afirmar cobertura de navegações não observadas pelo instrumento.

## 10. Fora do escopo e fechamento

Não implementar CRDT, merge por campo, banco por conta, email/avatar, refresh Google de login-only, sessão infinita ou login obrigatório. Não alterar o grant global para simular logout de um dispositivo. Não resolver corridas de OAuth limpando toda a tabela, todos os cookies do domínio ou IndexedDB; a limpeza local após logout confirmado é uma escolha de privacidade posterior e explícita, com fence próprio.

Esta fatia exige PR da #13, gates, revisão independente e publicação ainda sem liberar Drive globalmente. Merge adaptado e consentimentos/runtime seguem as fatias já acordadas.
