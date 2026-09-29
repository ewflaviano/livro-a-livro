# Gate real do Drive antes da liberação

## Liberação para teste manual do responsável

**Decisão de 27/09/2026:** após autorizar a entrega integral em produção, o responsável informou que não há usuários e que está realizando os testes manuais. A flag desabilitada impedia esse uso no domínio canônico e aparecia como “Google indisponível”. O workflow passa a habilitar `VITE_DRIVE_ENABLED=true` nos jobs de validação e publicação frontend. Não há mudança de código OAuth, permissões Google, biblioteca, API ou infraestrutura nesta ativação.

Esta decisão antecipa a disponibilidade pública para o ensaio manual do responsável em relação à ordem de gates definida abaixo. O site continua público: não há allowlist de usuários nem garantia de que só o responsável possa acessá-lo. O login segue opcional; acesso ao Drive depende da segunda autorização explícita. Os resultados das PRs #56–#58 sustentam o teste: API/AWS isolados, fluxo Google real, união/recuperação/convergência, resposta PUT perdida e renovação. **Ativação não equivale à aprovação de todos os gates.**

Com a issue #13 ainda aberta, o envio e o recebimento de um livro sintético foram observados em duas sessões reais independentes; o perfil de destino tinha vínculo técnico anterior e exigiu escolha explícita. Permanecem pendentes um recebimento automático em perfil genuinamente novo, a rejeição do cookie SESSION antigo com LOGIN válido, logout isolado com a nova limpeza local e revogação global entre essas sessões. O convite inicial de privacidade (#47) e os gates finais (#46) também não são considerados entregues por esta mudança.

As menções a flag desabilitada nas evidências anteriores registram o estado na data de cada ensaio. Para um lançamento geral com todos os gates aprovados, continuam valendo os critérios abaixo. O procedimento de reversão está em [deployment.md](deployment.md).

O script `scripts/drive-gate.mjs` cria um Chromium novo e dois contextos descartáveis, A e B. Nunca conecta a um Chrome existente. O build temporário usa `VITE_DRIVE_ENABLED=true`, mas nenhum arquivo é publicado; o harness não altera a flag da distribuição pública, definida pelo workflow. API, OAuth e Drive reais só devem ser usados depois do deploy da API e da revisão de suas fronteiras.

## Preparação e verificação sem Google

```sh
CHROMIUM_PATH=/usr/bin/chromium node scripts/drive-gate.mjs --smoke
```

O modo smoke executa headless, bloqueia toda rede externa, importa a fixture versionada com PNG sintético real, verifica os bytes e testa cadastro, edição e exclusão offline. Também simula uma conexão local descartável e tenta revogar com a API inacessível: exige aviso pendente persistente, sem alegar confirmação do Google. Por fim, respostas sintéticas de API exercitam o comando de renovação: rotação de cookie HttpOnly/CSRF e rejeição do cookie antigo num contexto novo; esse mock valida o harness, não a API real. O smoke também executa o aplicativo completo contra um Drive sintético em memória: duas bibliotecas, recebimento inicial automático, conflito, união explícita, recuperação e PUT aceito cuja resposta é perdida. O mecanismo de abortar a resposta e reabrir a página é o mesmo usado no modo real; somente a origem da resposta do Drive muda. As bibliotecas são comparadas em memória; os logs contêm apenas códigos fixos. `SMOKE_PASS` não comprova OAuth nem comunicação com Drive.

Sem `--smoke`, o navegador é visível. `CHROMIUM_PATH` é opcional quando o Chromium do Playwright estiver instalado. O script constrói em uma pasta temporária; `--dist /caminho/build-privado` permite usar um build já preparado com Drive habilitado. Não usar dados pessoais, bibliotecas exportadas de usuários ou contas com dados do aplicativo que devam ser preservados.

O harness serve somente a página canônica, privacidade, manifesto, assets e ícones do build privado via interceptação. A origem continua `https://livroalivro.app.br`, preservando CORS e cookies reais da API. Service Workers são bloqueados nesses contextos: este gate não substitui o teste separado da PWA instalada/offline. Google e API não são simulados no modo real. No início do modo real, o harness lê a página pública sem cookies, sem cache e sem redirects e aplica os cabeçalhos CSP, `X-Content-Type-Options` e `Referrer-Policy` às respostas do build privado. Cabeçalhos ausentes interrompem o gate; `Content-Length` e `Content-Encoding` não são copiados. O smoke lê a CSP de `infra/frontend.yml`, sem rede externa.

## Execução com API real

```sh
CHROMIUM_PATH=/usr/bin/chromium node scripts/drive-gate.mjs
```

Digite um comando por linha. Use uma conta de teste Google sem biblioteca prévia do Livro a Livro; A e B devem autorizar a mesma conta.

1. `prepare`: abre A/B vazios e importa somente em A a fixture sintética com capa.
2. `signin A`: inicia somente a identificação Google (`openid`). Ao navegar ao Google, imprime `READY_FOR_GOOGLE_CONSENT`. **Pare a automação, solicite o handoff humano e aguarde autorização.** O humano realiza o login no navegador; o script não preenche credenciais, clica consentimento nem contorna bloqueios do Google. Se Google bloquear a automação, interrompa e registre o gate como pendente.
3. Depois do retorno canônico, `identity A`: exige o botão “Autorizar Google Drive”, LOGIN 200, sincronização desabilitada, sessão Drive 401 e nenhuma nova chamada ao Drive. Reabrir/recarregar deve manter LOGIN; Agora não deve permanecer lembrado para esse login. A interface deve permanecer aqui sem redirecionamento automático. Só então `authorize A` abre o segundo consentimento: fazer novo handoff humano para autorizar a pasta privada. Após o segundo retorno, `synced A` exige confirmação visível do Drive.
4. `signin B`, `identity B` e `authorize B`: repetir as duas ações e os handoffs humanos separados. Após o callback, B realmente vazio deve receber automaticamente a única ponta remota. `synced B` e `compare` comprovam igualdade integral de livros, bytes das capas e preferências portáveis, sem escolha de conflito inicial. `remote B` permanece disponível para cenários com histórico local que exigem escolha explícita.
5. `conflict`: exige A/B sincronizados e iguais, edita pela UI a nota do livro sintético de maneira diferente em cada contexto offline, publica A e exige conflito explícito em B sem alterar seus dados. Escolhe a versão de A pela UI, compara a recuperação de B em memória e exige convergência final. `DIVERGENT_CONFLICT_RECOVERY_PASS` confirma esse gate. Executar também `merge`: adiciona um livro sintético distinto em cada lado, altera o livro comum e as preferências, cancela uma prévia sem alterar nada e confirma outra em um único diálogo, sem escolhas por livro. Exige três livros, registro comum e preferências locais conservados, PNG exato, recuperação anterior e convergência (`EXPLICIT_MERGE_BOOKS_PREFERENCES_COVER_RECOVERY_PASS`). Depois, `lost-put A`: edita outra nota sintética, encaminha o PUT resumable uma única vez e só depois de receber 2xx do Drive aborta a resposta ao cliente. Fecha a página e abre outra no **mesmo contexto**, preservando IndexedDB/cookie; exige confirmação, exatamente um arquivo listado para o operationId e nenhum PUT adicional. `LOST_PUT_RECONCILED_WITHOUT_DUPLICATE` confirma reconciliação. As URLs resumable, operationIds e conteúdo não são impressos.
6. `pause A`: exige estado pausado persistente após reload e biblioteca intacta. `renew A`: faz GET de sessão, POST vazio de renovação com CSRF e novo GET pelo navegador na origem real. Compara cookie e CSRF somente em memória, exige cookie Secure/HttpOnly/SameSite=Lax e comprova que o cookie SESSION anterior recebe 401 num terceiro contexto efêmero, que recebe também o LOGIN válido do ensaio. Assim a recusa comprova a rotação da SESSION, não a simples ausência de LOGIN. Cookies Google nunca são copiados. Nenhum token/cookie é persistido ou impresso. Se A estiver sincronizando, o comando pausa antes de renovar; deixa A pausado. `SESSION_ROTATED_OLD_COOKIE_REJECTED` confirma esse gate. `resume A`, `synced A` verificam retomada explícita.
7. `logout A`: encerra LOGIN e capacidade Drive de A e apaga seus dados locais após a confirmação. Recarregar deve confirmar GET login 401 e estante vazia; B conserva seu LOGIN e a biblioteca independentes. `resume A`, `reconnect-required A` verificam necessidade de nova autenticação. B continua com sessão própria.
8. `revoke B`: solicita desconexão global, preservando a biblioteca e os arquivos no Drive. Se o retorno indicar revogação pendente ou a requisição falhar, o harness exige aviso persistente após reload e imprime `REVOCATION_UNCONFIRMED`; isso comprova somente pausa/preservação local e aviso honesto, **não** revogação concluída no Google. Siga o aviso para remover a conexão na Conta Google e acionar suporte quando necessário. A API deve negar sessões/tokens dessa conexão; para observar isso numa aba ainda autenticada, reconecte A antes da revogação de B e use `reconnect-required A`. A expiração/revogação de access tokens já emitidos não é instantânea.
9. `offline-crud A`: desliga rede do contexto, cadastra, edita e exclui um livro sintético e compara o estado final ao anterior. Reativa a rede ao terminar.
10. `audit`: exige que nenhuma requisição à API tenha violado a fronteira. `quit`: fecha o navegador e remove o build temporário.

`COMMAND_FAILED` indica um gate não aprovado. Não prossiga interpretando a falha como sucesso. A saída deliberadamente omite exceções do navegador, URLs, tokens e conteúdo. O último comando e a interface visível permitem localizar a etapa. Encerrar normalmente com `quit` garante limpeza; não persistir cookies/storageState, traces, HAR, screenshots do Google ou dumps do IndexedDB. Downloads são desabilitados.

## Auditoria da fronteira

As chamadas à API passam por allowlist de método/caminho, sem body e sem query. `OPTIONS` é permitido somente nas rotas de controle conhecidas. O callback aceita exclusivamente navegação GET com parâmetros OAuth previstos e um único `iss=https://accounts.google.com`; seus valores não são registrados. Essa allowlist é um controle conservador do ensaio; a API de produção ignora extensões não reconhecidas conforme RFC 6749, sem lhes atribuir autoridade. Uma violação aborta a requisição e encerra o ensaio. O conteúdo sintético só trafega diretamente ao Google Drive. O harness registra em memória somente operationIds das submissões desta execução e contagens por operação. Se uma listagem trouxer arquivo desconhecido, interrompe antes de entregar a resposta à PWA ou baixar essa biblioteca. Uploads/downloads aceitam apenas os IDs, campos e bytes da fixture; são permitidos somente o livro original, dois registros sintéticos adicionais conhecidos, as notas geradas pelos comandos, seu updatedAt e os conjuntos fixos de preferências do ensaio. `UNKNOWN_OR_INVALID_REMOTE_STOP` exige interromper o ensaio, não apagar arquivos desconhecidos. A conta deve começar sem arquivos deste aplicativo; reiniciar o harness contra uma biblioteca preexistente também será recusado. Não há limpeza remota automática.

O auditor não substitui as verificações de infraestrutura: logs de API Gateway/Lambda/CloudFront não podem capturar query, headers, cookies, tokens ou bodies; testar KMS/DynamoDB isolados, renovação/expiração, lease distribuído e worker de revogação conforme a issue 13.

## Gates adicionais antes de ativar produção

Os comandos concretos acima cobrem recebimento inicial, conflito divergente, união explícita e resposta PUT perdida, além de renovação. Os cenários abaixo complementam esses gates. Registrar cada um como aprovado ou pendente; não ativar a flag com pendências.

- **Cancelamento concorrente:** retardar uma requisição Drive e pausar/logout antes de liberá-la; reload deve continuar pausado, sem substituição tardia. Os testes unitários cobrem deterministicamente as fronteiras transacionais.
- **Expiração real:** o comando `renew A` cobre rotação e invalidação imediatamente, sem alterar DynamoDB ou esperar a sessão expirar. Validade absoluta e expiração independente do TTL continuam cobertas pelos testes próprios da API; o harness não modifica registros de sessão.
- **Falhas de serviço:** negar API e Google mantendo a página aberta; estante, cadastro, edição, exportação e importação JSON devem continuar locais. O modo smoke testa CRUD offline; exportação/importação offline e Worker/PWA têm gates próprios.
- **Consentimento negado/expirado:** verificar mensagens estáticas distintas, Drive recusado na segunda etapa, conta diferente recusada, LOGIN/tentativa expirada e retry explícito, sempre sem perda local nem envio antes da sessão completa.

Somente depois de todos os gates de frontend, API e infraestrutura, revisar e publicar separadamente a alteração da flag pública.

## Alternativa no Chrome normal quando Google recusa o navegador automatizado

Interromper o OAuth automatizado ao receber essa recusa. Não alterar identificação do navegador, flags de segurança ou verificações do Google. O login/consentimento continua manual em um navegador normal; a automação autorizada pode acompanhar a interface do aplicativo depois.

`node scripts/build-drive-qa.mjs` gera dois builds temporários fora do repositório. `--out /tmp/diretorio-novo` permite escolher um diretório ainda inexistente. O script não publica arquivos e não muda o build de produção. O arquivo local `build-info.json` informa o commit, prefixo público, nomes exatos dos bancos e URLs terminadas em `index.html#/dados`.

- Cada build compila o mesmo aplicativo com Drive habilitado e um banco fixo `livro-a-livro-qa-<commit>-a` ou `-b`. Livros, mídias, preferências, busca, outbox e canais de revisão usam esse nome; o banco habitual não é aberto por esses builds. O caminho/origem exatos são conferidos antes de montar o aplicativo. Mudança no código que impeça aplicar os transforms interrompe o build.
- O banner identifica A/B e exige dados sintéticos. Não há manifesto, registro de Service Worker ou observação de instalação nesses builds. O SW público existente não intercepta esses caminhos/assets. Não remover esse SW nem limpar dados da origem para preparar o teste.
- A página de validação é **pública**: endereço não divulgado e `noindex` não são controle de acesso. Ela exige a mesma autorização Google/API e não contém segredo, sessão pronta, fixture pessoal ou mecanismo de contornar permissões. Não existe parâmetro de URL que habilite Drive no aplicativo normal.
- API, origem, callback, cookies, escopos e CSP permanecem iguais aos de produção. A pasta tem armazenamento separado por convenção da aplicação, não isolamento de segurança entre scripts da mesma origem.
- Usar conta sem biblioteca anterior do Livro a Livro. O transporte exclusivo de QA registra em `localStorage` somente IDs de operações criadas pelo ensaio, em chaves `livro-a-livro-qa-<commit>:operation:<uuid>` compartilhadas por A/B. A primeira listagem deve estar vazia, exceto numa retomada deliberada de fixtures sintéticas conhecidas: nesse caso, copiar somente as chaves técnicas exatas de operações do ensaio anterior para o namespace atual, preservando a allowlist e sem aceitar novas operações por inferência do conteúdo. Essa retomada comprova migração/recebimento, não primeiro envio em Drive vazio. Metadados de arquivos com operação desconhecida interrompem a validação **antes de qualquer download**, com aviso no banner; não continuar ou apagar arquivos desconhecidos para forçar o teste. O registro não contém tokens, cookies, URLs de upload ou conteúdo da biblioteca.

O operador publica somente o conteúdo de `a/` e `b/` sob seus prefixos exatos de `build-info.json`, com `Cache-Control: no-store`; não publicar o diretório pai, alterar arquivos da raiz ou usar remoção recursiva no bucket inteiro. Definir a janela de teste e remover o prefixo ao final da sessão de validação; invalidar somente esse prefixo no CDN. Metadados de operação ficam locais. A publicação não faz parte do fluxo normal de CI.

Preferir um **perfil novo normal do Chrome** para o teste. O callback fixo retorna a `https://livroalivro.app.br/#/dados`, que carrega o aplicativo público e pode abrir o banco habitual daquele perfil. Em um perfil pessoal, esse retorno não é uma prova de isolamento global. Não abrir, exportar ou inspecionar sua biblioteca para validar o teste. Depois do retorno, a pessoa abre novamente a URL A/B informada; o opt-in pendente continua no banco de validação.

1. Abrir A e B e confirmar os dois banners e bibliotecas vazias. Importar somente a fixture sintética em A; manter B vazia.
2. Na página A, usar Entrar com Google. Após o retorno canônico, voltar explicitamente à URL A e confirmar login sem autorização do Drive. Só então escolher Autorizar Google Drive e, após o segundo callback, voltar a A e exigir sincronização confirmada.
3. Em A e B, usar “Entrar com Google”, voltar à página de validação do mesmo slot e conferir que o Drive continua sem acesso. Usar “Autorizar Google Drive” somente por novo clique explícito; após o callback canônico, voltar novamente ao mesmo slot. Conectar/retomar B pelo fluxo normal e testar restauração/conflito com comparação dos dados sintéticos. Repetir os gates aplicáveis desta página pela interface, sem copiar tokens, cookies ou conteúdo pessoal.
4. A e B no **mesmo perfil** compartilham cookies da API. Elas comprovam isolamento das bibliotecas e concorrência local, mas não equivalem a duas sessões de dispositivos. Logout independente e revogação entre sessões reais exigem outro perfil/navegador normal ou permanecem registrados como pendentes; testes AWS separados não devem ser chamados de evidência de navegador real.
5. Ao terminar, fechar as abas QA, remover os objetos do prefixo publicado e invalidar esse prefixo. Se desejado, excluir somente os dois bancos QA de nomes exatos e as chaves técnicas de operações desse ensaio, com as abas fechadas. Nunca usar “limpar dados do site”, apagar o banco `livro-a-livro`, desregistrar o SW da raiz ou remover caches do aplicativo público. Arquivos sintéticos do Drive seguem a política explícita do ensaio; desconectar não os apaga. Apagar os IDs conhecidos impede que um ensaio futuro baixe os arquivos antigos: usar uma conta de teste vazia ou um plano explícito para a limpeza sintética.

Este caminho valida o OAuth normal e Drive reais; não substitui os gates de instalação/offline da PWA ou transforma gates ainda pendentes em aprovados.

## Gates adicionais do login persistente

Usar o contrato e a matriz de [auth-login-persistente.md](auth-login-persistente.md). Uma janela/aba diferente no mesmo perfil compartilha cookies e não prova isolamento entre dispositivos. Registrar separadamente os testes em um perfil e os testes com LOGIN independentes.

O ensaio de persistência verifica login sem Drive, navegação, recarga, reabertura e Agora não lembrado, com zero autorização/upload automático. O ensaio de falha de saída bloqueia apenas DELETE login: deve mostrar saída não confirmada, conservar pausa e dados e, após reload, recuperar o LOGIN ainda válido. Novo clique pode repetir a saída; só DELETE confirmado seguido de GET401 comprova encerramento. Não usar falha artificial no Google nem contornar bloqueio de navegador.

Sessões V1 usadas em ensaios anteriores não são promovidas. Reiniciar explicitamente o login no build novo preservando biblioteca e operações sintéticas conhecidas. Os testes de renovação/login/logout/cancelamento concorrente em DynamoDB usam tabela e chave isoladas; não alterar os prazos da tabela de produção para simular expiração.

### Evidência de produção — PR #56

Build `99dc01184042`, API/frontend publicados pelo workflow `36343523719`. Smoke operacional aprovado. No Chromium normal, o primeiro OAuth retornou LOGIN 200 e SESSION Drive 401. Agora não persistiu após recarga e fechamento/reabertura da aba; Configurações e Seus dados mantiveram o estado global. Sair pela interface foi confirmado, e GET login continuou 401 após recarga. Nenhuma segunda autorização Drive foi iniciada neste ensaio de login. A página QA com banco separado foi retirada ao concluir.

Essa evidência não substitui os gates de Drive entre perfis independentes, união/convergência, renovação de SESSION ou revogação global real. Os testes AWS isolados verificaram transações e deadlines, não passagem de 180 dias reais. Falhas intermitentes observadas nos testes locais estão rastreadas na #46.


## Gate hermético da união — issue #13

### Duas sessões reais independentes e mudança de saída — 28/09/2026

No Chrome normal e anônimo, com LOGIN independentes da mesma conta de teste, o convite do Drive foi dispensado separadamente. A biblioteca antiga do perfil normal foi substituída por um backup local vazio com autorização explícita do responsável, antes de qualquer consentimento Drive; o perfil anônimo continha somente um livro sintético. O segundo consentimento foi concluído manualmente em cada perfil. A guia anônima confirmou cópia no Drive; a guia normal detectou a cópia, exigiu escolha explícita por conservar um vínculo técnico anterior e, após escolher a versão remota, mostrou o mesmo livro sintético e cópia confirmada. Isso comprova envio/recebimento entre sessões independentes, com a ressalva da escolha por vínculo anterior; não comprova recebimento automático de um perfil sem histórico de sync.

O responsável determinou depois que **sair deve apagar dados locais**. A implementação seguinte da mesma issue muda a confirmação e a transação de logout. O gate hermético reexecutado passou `LOCAL_ERASED_AND_SIGNED_OUT` e `INDEPENDENT_LOGOUT_LOCAL_ERASE_PASS`: após saída confirmada em A, suas stores privadas ficaram vazias, e B conservou sua biblioteca e conexão simuladas. A publicação e o ensaio real da nova saída ainda são necessários. A rejeição do cookie SESSION anterior com LOGIN válido e a revogação global entre estas sessões também continuam pendentes. O gate hermético e os testes unitários não substituem esses ensaios reais.

**Revalidação em 28/09/2026:** o harness passou a abrir a restauração antes de escolher o JSON, acompanhar o retorno à estante após o cadastro e abrir Gerenciar conexão para pausa/saída/revogação. O teste offline repõe o filtro alterado pelo cadastro antes de comparar a biblioteca. As comparações de cópias do Drive e de recuperação excluem Grade/Lista, que é preferência local no backup V2. `CHROMIUM_PATH=/usr/bin/chromium node scripts/drive-gate.mjs --smoke` concluiu com `SMOKE_PASS`, incluindo recebimento, conflito, união e resposta PUT perdida. Esse resultado permanece sintético e não aprova os gates Google reais entre sessões independentes.

O fluxo sintético passou recebimento automático em B novo, edição offline em A/B, conflito sem alteração prematura, escolha de versão inteira, cancelamento da prévia, união explícita com preferências e capa, recuperação exata e convergência. O PUT aceito com resposta perdida foi reconciliado na reabertura com um único arquivo/operação e sem segundo PUT. O simulador local também passou seu teste de fronteira. A revisão visual da prévia em 320 px não apresentou rolagem horizontal; livros/capas/escolhas ficaram legíveis.

Checks da fatia: 502 testes frontend em 39 arquivos com concorrência padrão, typecheck/build e teste do simulador aprovados. A suíte completa identificou e a entrega corrigiu a preservação de preferências não salvas durante refresh; regressões cobrem falha, retry, importação e conclusão fora de ordem. Revisão de arquitetura e revisão independente sem achados pendentes.

Esses resultados são do Drive simulado e não substituem os gates Google reais. No cenário de duas bibliotecas genuinamente vazias, o estado “Drive conectado” informa que nenhum backup foi enviado, em vez de anunciar uma cópia inexistente.

## Evidência Google real — PR #57, 27 set 2026

Produção `206627e94783`, workflow `36345922729`, com frontend/API publicados e smoke de controles aprovado. O build QA `6d21da790fd1` corresponde à mesma árvore da integração, com bancos A/B separados e Drive habilitado apenas no build temporário. A distribuição pública continua com `VITE_DRIVE_ENABLED=false`.

No Chromium normal, com a conta e a pasta privada já autorizadas para o ensaio sintético:

- Login seguido de autorização Drive em outra ação explícita. A/B novos receberam automaticamente os snapshots V1 do ensaio anterior, sem conflito artificial. Comparação em memória confirmou livros, preferências e bytes PNG exatos. Somente quatro operações sintéticas conhecidas do ensaio anterior foram admitidas pela allowlist técnica.
- Importação de duas variantes sintéticas enquanto pausadas, seguida de edição divergente das notas pela interface sem rede. A publicou V2; B apresentou conflito e preservou sua biblioteca. Cancelar a primeira prévia não alterou os dados. A segunda prévia escolheu explicitamente a versão B do livro comum e suas preferências, incluindo os livros exclusivos de ambos os lados.
- União confirmada no Drive: três registros esperados, preferências escolhidas e PNG exato. A recuperação de B correspondeu à biblioteca anterior. Ao recarregar A, o recebimento automático convergiu para o resultado integral, sem operação pendente.
- Falha injetada somente no transporte da página QA, após um PUT receber HTTP 200 real do Google: a resposta foi negada ao cliente. A reconciliação automática confirmou o envio sem novo PUT e preservou a biblioteca.
- Segundo ensaio de falha: após HTTP 200, a página foi recarregada antes de entregar qualquer resposta ao aplicativo. O estado pendente persistiu; após a proteção de concorrência e a verificação automática, a operação foi confirmada. A listagem real completa continha exatamente um arquivo para essa operação; a captura sem truncamento registrou um PUT e nenhum adicional. A biblioteca permaneceu exata. A recarga removeu a injeção e o marcador técnico temporário foi excluído.
- Pausa pela interface seguida de recarga preservou a biblioteca. Renovação real pelo navegador retornou 200, alterou CSRF, manteve o vínculo e permitiu novo GET de sessão 200. Este ensaio não copiou cookies nem comprovou a rejeição do cookie anterior em outro contexto.
- Durante prévia/união, a captura completa do documento registrou quatro chamadas de controle à API, sem corpo ou query. Essa evidência não cobre integralmente as navegações OAuth nem substitui o auditor do harness.

Limites: A/B usaram o mesmo perfil e compartilham cookies. Continuam pendentes a segunda sessão independente, a rejeição do cookie SESSION antigo com LOGIN válido, saída isolada e revogação global entre sessões reais. Não ativar a flag pública com essas pendências. Os testes unitários, AWS isolados e herméticos permanecem evidências distintas.

A primeira tentativa de importar JSON sem rede na página QA foi recusada porque o Worker ainda não estava carregado: esse build deliberadamente não instala SW e usa `no-store`. A importação foi repetida online, com sincronização pausada; somente a edição posterior ocorreu offline. Isso não comprova nem invalida o gate próprio de importação offline da PWA pública.

Ao encerrar esta janela, A/B ficaram pausadas e suas abas foram fechadas. O prefixo temporário `/validacao-drive/6d21da790fd1/` foi removido do S3 (zero objetos restantes); a invalidação específica do CDN foi solicitada. Bancos e registros técnicos de operações sintéticas permanecem locais para retomar o ensaio conhecido. A biblioteca habitual, o SW público e os arquivos do Drive não foram removidos.

## União simplificada após PR #60

510 testes frontend, typecheck e build com Drive habilitado aprovados. O harness hermético passou `SMOKE_PASS`, incluindo cancelamento sem alteração, união em uma confirmação sem radios, prioridade do livro e preferências locais, três livros finais, PNG exato, recuperação e convergência. Conservou o gate de navegação de conflito em 320 px e a reconciliação de PUT aceito com resposta perdida sem duplicação. A confirmação foi inspecionada visualmente em 320 px. Revisões SOL de arquitetura e código aprovadas. Este ensaio não acrescenta evidência Google real aos resultados históricos acima.
