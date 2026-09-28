# Infraestrutura de domínio

## DNS

- Zona Route 53 pública: `livroalivro.app.br.` (`Z00589771OM34UZPERUI4`)
- Nameservers a delegar no Registro.br:
  - `ns-734.awsdns-27.net`
  - `ns-1571.awsdns-04.co.uk`
  - `ns-1058.awsdns-04.org`
  - `ns-334.awsdns-41.com`

Os CNAMEs de validação DNS do ACM já existem na zona. Após a delegação se propagar, os certificados serão emitidos automaticamente.

## Certificados

| Uso | Região | Domínio | ARN |
| --- | --- | --- | --- |
| Site via CloudFront | `us-east-1` | `livroalivro.app.br` | `arn:aws:acm:us-east-1:872515289365:certificate/e6d34afc-677c-43c2-8666-d1e036b85803` |
| API Gateway regional | `sa-east-1` | `api.livroalivro.app.br` | `arn:aws:acm:sa-east-1:872515289365:certificate/72f6da3a-39a8-44d9-bc11-5737c0d2f278` |

Os certificados devem estar com status `ISSUED` antes de serem associados aos recursos de produção.

### Propriedade do domínio no Google

Em 27/09/2026, `livroalivro.app.br` foi verificado como propriedade de domínio no Google Search Console, na conta responsável pelo projeto `livro-a-livro`, via registro TXT no ápice da zona Route 53. Preserve o registro `google-site-verification`: removê-lo pode invalidar a propriedade exigida pelo Branding OAuth. Ele é separado dos CNAMEs de validação dos certificados ACM.

O consentimento Google está em produção, com escopos `openid` e `drive.appdata`; os links públicos apontam para a raiz do site e `/privacidade.html`. O ícone de Branding está em [`docs/branding`](branding/README.md). Após a comprovação do domínio, a marca foi verificada e publicada pelo Google em 27/09/2026. Publicação do consentimento, aprovação visual da marca pelo Google e ativação da flag Drive no frontend são estados separados. Os gates e o estado de ativação devem ser conferidos antes de anunciar disponibilidade.

## Publicação do site

`infra/frontend.yml` cria uma distribuição CloudFront com origem S3 privada/OAC, o alias `A`/`AAAA` da raiz e os cabeçalhos de segurança. O bucket recebe somente o build estático; não recebe bibliotecas, backups, capas enviadas ou arquivos de Drive.

Os assets com hash são publicados primeiro com cache imutável. Ícones e outros arquivos públicos estáveis na raiz do build entram em seguida, com revalidação curta. Só então entram `manifest.webmanifest`, `sw.js` e `index.html`, que usam revalidação. O pipeline não executa `sync --delete`: versões anteriores continuam disponíveis para instalações offline. Configurações mostra os sete primeiros caracteres do commit da execução que construiu o frontend; fora do CI, usa o commit local.

## API

`infra/api-deploy.yml` provisiona o bucket privado de artefatos e a role `livro-a-livro-api-deploy`, em `sa-east-1`. `infra/api.yml` provisiona a composição de autorização: API Gateway HTTP no domínio `api.livroalivro.app.br`, funções Lambda `auth` e `revocation`, tabela DynamoDB exclusiva, chave KMS, rotina por minuto e alarmes. A issue #95 acrescenta uma função `diagnostics` com role e log próprios, sem permissão de sessão ou segredo. O endpoint padrão execute-api é desabilitado. O serviço não tem bucket para biblioteca nem permissão para S3 nas roles de execução.

A publicação da API e a ativação do Drive são passos distintos. Em 27/09/2026, o responsável reiterou a entrega em produção e informou que testa manualmente, sem usuários no projeto. O workflow passa a usar `VITE_DRIVE_ENABLED=true` tanto na validação frontend quanto na publicação, conforme a [decisão de teste manual e suas pendências](drive-release-gate.md#liberação-para-teste-manual-do-responsável). A página `/privacidade.html` é estática, legível sem JavaScript e incluída no cache público offline.

Para reverter essa liberação, definir a flag como `false` nos dois jobs e publicar novamente. Isso impede a composição do conector no novo aplicativo, mas não revoga permissões Google nem apaga dados, e não interrompe imediatamente abas antigas/offline. A revogação da conexão continua uma ação explícita separada.

### Configuração da API

| Variável | Conteúdo |
| --- | --- |
| `APP_ENVIRONMENT` | `production`, com origem/callback compilados e exatos |
| `AUTH_TABLE_NAME` | Tabela exclusiva `livro-a-livro-auth` |
| `AUTH_KMS_KEY_ID` | ARN da chave da stack; contexto autenticado application/environment/connection |
| `AUTH_SECRET_ARN` | ARN do segredo `livro-a-livro/production/auth`, nunca seu conteúdo |
| `AWS_REGION` | Definida pelo runtime Lambda: `sa-east-1` |

O segredo contém `client_id`, `client_secret` e `hmac_key`. A chave HMAC é uma string de pelo menos 32 bytes, usada como bytes literais. Trocar essa chave altera os vínculos e CSRF: não gerar uma nova durante deploy ou rotação automática. Nenhum segredo entra em variáveis `VITE_*`, CloudFormation, argumentos de processo, comentários ou artefatos públicos.

### Publicação e reversão

O operador provisiona/atualiza a infraestrutura com perfil AWS autorizado e revisão de arquitetura. A role GitHub publica somente código das funções existentes e arquivos sob `releases/` no bucket privado; não pode ler o segredo, alterar IAM ou criar infraestrutura. As variáveis GitHub `AWS_API_DEPLOY_ROLE_ARN` e `AWS_API_ARTIFACT_BUCKET` apontam para os outputs da stack de publicação.

Para a primeira instalação, baixe o artefato `api-release` do run validado e use `bash scripts/provision-api.sh`, na raiz do repositório. O script exige diretório do artefato, bucket, commit completo, ARN do segredo/certificado e zona DNS em variáveis `API_*` documentadas no próprio arquivo. A autenticação usa o perfil/role AWS do operador; não recebe chaves ou conteúdo do segredo. Depois execute `node scripts/check-auth-production.mjs`: o smoke verifica controles sem sessão, CORS/cookies/PKCE e recuperação de callback cancelado, sem seguir a URL Google nem registrar valores OAuth.

Para introduzir o diagnóstico da issue #95 sem alterar os artefatos atuais de `auth`/`revocation`: após CI e revisão da PR, atualize primeiro a stack `livro-a-livro-api-deploy` com `infra/api-deploy.yml` para permitir publicação do terceiro binário. Inspecione o change set da stack `livro-a-livro-api`: ela deve adicionar a função/role/rota/log/alarme de diagnóstico, sem substituir tabela/KMS ou atualizar código das duas funções antigas. Baixe o `api-release` do run aprovado da PR, configure `API_ARTIFACT_DIR`, `API_ARTIFACT_BUCKET`, `API_RELEASE_ID` com o SHA integral do run e execute `API_DIAGNOSTICS_ONLY=true bash scripts/provision-api.sh` com perfil AWS operador. Esse modo reutiliza os parâmetros atuais de código de `auth`/`revocation`, envia apenas `diagnostics.zip` e não pede segredo, certificado ou zona em variáveis. Faça `node scripts/check-diagnostics-production.mjs`: o probe usa apenas códigos sintéticos e testa CORS, rejeição de campo extra e aceite de um código fixo. O evento sintético válido incrementa `ClientErrorReport` e pode levar seu alarme a `ALARM` no painel. Só depois integre a PR; a pipeline atualizará apenas os binários cuja origem mudou e publicará a PWA. O consentimento de diagnóstico começa desligado. Se a stack não tiver sido aplicada, a pipeline guarda o ZIP no bucket e deixa explícito que a função ainda requer provisionamento; isso não comprova diagnóstico em produção.

O job da API produz os ZIPs com Cargo Lambda após fmt, clippy e testes. Na `main`, a publicação usa o artefato daquele run e atualiza apenas as funções afetadas pelos arquivos alterados em `api/`; uma execução manual publica todas. Mudança isolada de frontend não troca código da API. Uma alteração só no manifesto/lockfile sem fonte identificada republica todas, por segurança. Os ZIPs publicados ficam identificados pelo commit. Para reverter código, um operador republica os ZIPs das funções afetadas do commit aprovado anterior e aguarda `function-updated` (usa a permissão limitada GetFunctionConfiguration). Confirmar compatibilidade do esquema antes: uma reversão nunca deve restaurar credenciais antigas ou remover tombstones. A rotina e a API podem executar versões diferentes durante a atualização; alterações no contrato exigem uma transição compatível.

A publicação direta de código não atualiza os parâmetros de artefato guardados pelo CloudFormation. Em uma atualização posterior de infraestrutura, execute o script de provisionamento com os ZIPs e o commit da versão aprovada atual; não reaplique um template com chaves de artefatos antigos, pois isso pode reverter o código das funções.

### Limites e operação

- Lambda tem timeout de 25 segundos; a posse exclusiva de refresh/revogação dura 30 segundos. O código limita chamadas externas e falha sem liberar token quando perde essa posse.
- API Gateway limita inicialmente 2 solicitações/s e burst de 5. A conta tem limite regional compartilhado de 10 execuções Lambda; não foi configurada reserva de concorrência. Sob carga, extras podem ficar indisponíveis, preservando a biblioteca local.
- A rotina consulta o índice `work-due`, revalida cada item e processa lotes pequenos. TTL não autoriza sessões nem substitui a remoção explícita de credenciais vencidas.
- Tabela e chave têm retenção em remoção da stack; a tabela tem proteção contra exclusão. PITR/streams não são habilitados. Não restaurar backup histórico sobre a tabela ativa sem preservar bloqueios e gerações.
- Gateway não grava access logs; auth e diagnóstico não registram payloads. Logs de execução têm 14 dias. O worker emite somente contadores fixos EMF no namespace `LivroALivro/Auth`, sem IDs, tokens, e-mail ou biblioteca. Auth registra código fixo em respostas 5xx; a função de diagnóstico registra somente enums aceitos após consentimento no navegador.
- Alarmes cobrem erros das Lambdas, códigos 5xx da autenticação, diagnóstico recebido, throttling, ausência da rotina em cinco minutos, revogação incerta e execução incompleta. O responsável optou por consultar logs, métricas e alarmes no CloudWatch nesta etapa; não há tópico SNS nem envio automático de e-mail.

Diagnósticos têm custo de invocação Lambda/API Gateway e CloudWatch por log, métrica e alarme; a rota é limitada a 1 requisição/s e burst 2, o cliente limita envios e logs expiram em 14 dias. Conferir gasto e estado dos alarmes após ativação. Para suspender novos relatórios em incidente, publicar frontend com envio de diagnóstico desligado e bloquear/remover a rota específica na stack; abas antigas podem continuar abertas, então o bloqueio da rota é o controle imediato. Essa reversão não toca estante local, Drive, tabela OAuth nem credenciais Google.

### Revogação incerta

Uma falha antes de enviar a solicitação ao Google permite nova tentativa limitada. Se a solicitação pode ter sido recebida, a conexão fica bloqueada e não é reconectada automaticamente. Expirar o lease ou remover a credencial após 24 horas não libera esse bloqueio.

O responsável deve verificar a ocorrência sem copiar credenciais para logs, orientar a pessoa a remover Livro a Livro nas conexões da Conta Google e confirmar que não há execução em andamento. Use a ferramenta local [`auth-admin`](../api/README.md#resolução-de-uncertain), autenticada por IAM, com conexão/geração/ID de revogação exatos e confirmação humana explícita. Ela confere o estado e incrementa o epoch antes de permitir novo consentimento; nunca editar apenas o campo de status ou apagar o registro. Não precisa ler Secrets Manager/KMS e não é publicada como função ou endpoint. Fencing no DynamoDB não cancela uma chamada já recebida pelo Google.

## CI/CD

`.github/workflows/ci.yml` testa e publica frontend e Rust independentemente. Publicações da `main` assumem as roles OIDC limitadas em `infra/github-oidc.yml` e `infra/api-deploy.yml`; não usam chaves AWS estáticas. A confiança usa o identificador imutável do repositório no GitHub e a referência `main`, para que uma renomeação não abra a role a outro repositório. A role estática só pode ler os outputs da stack, publicar assets no bucket do site e invalidar sua distribuição; a role da API não publica o frontend.

## Login persistente — implantação da issue #13

O contrato novo separa LOGIN e SESSION Drive, acrescentando AUTH_ATTEMPT durável e `x-lal-attempt` na allowlist. Não exige novo índice ou ampliação do papel do worker: LOGIN/AUTH_ATTEMPT não têm trabalho no índice `work-due`. Auth conserva as ações condicionais da tabela exclusiva. Ver [transações e gates](auth-login-persistente.md).

Publicar com Drive público false. OAUTH/IDENTITY antigos e SESSION sem LOGIN exigem reinício explícito; não promover sessão antiga nem revogar CONNECTION durante a migração. Livros locais, snapshots e credenciais de conexão cifradas são preservados. A API pode preceder a PWA, mas clientes antigos exigirão reconexão; encerrar ensaios antigos e usar o build novo.

LOGIN usa prazos móveis de 30 dias e absolutos de 180 dias, verificados a cada operação. Seu TTL é o limite absoluto. AUTH_ATTEMPT/OAUTH/ticket interno expiram em até dez minutos. TTL não comprova remoção física pontual nem permite renovar registro removido. Renew LOGIN conserva cookie; renew SESSION continua rotacionando. Logout remove LOGIN estável, invalidando inclusive SESSION rotacionada concorrente.

Após publicar ambos, executar o smoke atualizado: consulta anônima de LOGIN/SESSION, preflight do novo header, início openid com UUID, consulta/cancelamento exato de tentativa e rejeição após cancelar. Cookies permanecem somente em memória. Complementar com navegador normal para persistência e consentimento separado; smoke sem conta não prova esses fluxos. Ao atualizar `privacidade.html`, invalidar também essa página no CDN.

## Política CSP para imagens e Analytics (#63, #69)

`infra/frontend.yml` permite somente `www.googletagmanager.com`, `www.google-analytics.com` e `region1.google-analytics.com` nas diretivas necessárias ao Google Analytics consentido. A pipeline de frontend publica assets, mas **não atualiza a stack CloudFormation**. A alteração desta política foi aplicada manualmente à stack de produção antes da publicação do JavaScript da issue #63, com change set limitado a `SecurityHeaders` sem substituição. O cabeçalho público foi conferido. Ao alterar esta política novamente, revisar/aplicar a stack antes de publicar código que dependa do novo host. Invalidar `/privacidade.html` após a publicação da página atualizada.

Algumas capas da Open Library redirecionam de `covers.openlibrary.org` para `archive.org` e `*.us.archive.org`. A issue #69 acrescenta esses dois destinos somente a `img-src`; `connect-src` não os inclui. Aplicar a mudança na stack e conferir o cabeçalho público antes de publicar o frontend corrigido. Testar uma capa redirecionada no domínio canônico após a propagação do CloudFront.
