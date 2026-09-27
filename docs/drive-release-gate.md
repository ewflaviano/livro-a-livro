# Gate real do Drive antes da liberação

O script `scripts/drive-gate.mjs` cria um Chromium novo e dois contextos descartáveis, A e B. Nunca conecta a um Chrome existente. O build temporário usa `VITE_DRIVE_ENABLED=true`, mas nenhum arquivo é publicado e a flag da distribuição pública permanece **false**. API, OAuth e Drive reais só devem ser usados depois do deploy da API e da revisão de suas fronteiras.

## Preparação e verificação sem Google

```sh
CHROMIUM_PATH=/usr/bin/chromium node scripts/drive-gate.mjs --smoke
```

O modo smoke executa headless, bloqueia toda rede externa, importa a fixture versionada com PNG sintético real, verifica os bytes e testa cadastro, edição e exclusão offline. Também simula uma conexão local descartável e tenta revogar com a API inacessível: exige aviso pendente persistente, sem alegar confirmação do Google. Por fim, respostas sintéticas de API exercitam o comando de renovação: rotação de cookie HttpOnly/CSRF e rejeição do cookie antigo num contexto novo; esse mock valida o harness, não a API real. O smoke também executa o aplicativo completo contra um Drive sintético em memória: duas bibliotecas, conflito, recuperação e PUT aceito cuja resposta é perdida. O mecanismo de abortar a resposta e reabrir a página é o mesmo usado no modo real; somente a origem da resposta do Drive muda. As bibliotecas são comparadas em memória; os logs contêm apenas códigos fixos. `SMOKE_PASS` não comprova OAuth nem comunicação com Drive.

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
4. `signin B`, `identity B` e `authorize B`: repetir as duas ações e os handoffs humanos separados. Após o callback, B deve apresentar conflito inicial; `remote B` exige exatamente uma versão remota e confirma sua escolha. `synced B` e `compare` comprovam igualdade integral de livros, bytes das capas e preferências portáveis.
5. `conflict`: exige A/B sincronizados e iguais, edita pela UI a nota do livro sintético de maneira diferente em cada contexto offline, publica A e exige conflito explícito em B sem alterar seus dados. Escolhe a versão de A pela UI, compara a recuperação de B em memória e exige convergência final. `DIVERGENT_CONFLICT_RECOVERY_PASS` confirma esse gate. Depois, `lost-put A`: edita outra nota sintética, encaminha o PUT resumable uma única vez e só depois de receber 2xx do Drive aborta a resposta ao cliente. Fecha a página e abre outra no **mesmo contexto**, preservando IndexedDB/cookie; exige confirmação, exatamente um arquivo listado para o operationId e nenhum PUT adicional. `LOST_PUT_RECONCILED_WITHOUT_DUPLICATE` confirma reconciliação. As URLs resumable, operationIds e conteúdo não são impressos.
6. `pause A`: exige estado pausado persistente após reload e biblioteca intacta. `renew A`: faz GET de sessão, POST vazio de renovação com CSRF e novo GET pelo navegador na origem real. Compara cookie e CSRF somente em memória, exige cookie Secure/HttpOnly/SameSite=Lax e comprova que o cookie SESSION anterior recebe 401 num terceiro contexto efêmero, que recebe também o LOGIN válido do ensaio. Assim a recusa comprova a rotação da SESSION, não a simples ausência de LOGIN. Cookies Google nunca são copiados. Nenhum token/cookie é persistido ou impresso. Se A estiver sincronizando, o comando pausa antes de renovar; deixa A pausado. `SESSION_ROTATED_OLD_COOKIE_REJECTED` confirma esse gate. `resume A`, `synced A` verificam retomada explícita.
7. `logout A`: encerra LOGIN e capacidade Drive de A, exige pausa persistente e dados intactos. Recarregar deve confirmar GET login 401; B conserva seu LOGIN independente. `resume A`, `reconnect-required A` verificam necessidade de nova autenticação. B continua com sessão própria.
8. `revoke B`: solicita desconexão global, preservando a biblioteca e os arquivos no Drive. Se o retorno indicar revogação pendente ou a requisição falhar, o harness exige aviso persistente após reload e imprime `REVOCATION_UNCONFIRMED`; isso comprova somente pausa/preservação local e aviso honesto, **não** revogação concluída no Google. Siga o aviso para remover a conexão na Conta Google e acionar suporte quando necessário. A API deve negar sessões/tokens dessa conexão; para observar isso numa aba ainda autenticada, reconecte A antes da revogação de B e use `reconnect-required A`. A expiração/revogação de access tokens já emitidos não é instantânea.
9. `offline-crud A`: desliga rede do contexto, cadastra, edita e exclui um livro sintético e compara o estado final ao anterior. Reativa a rede ao terminar.
10. `audit`: exige que nenhuma requisição à API tenha violado a fronteira. `quit`: fecha o navegador e remove o build temporário.

`COMMAND_FAILED` indica um gate não aprovado. Não prossiga interpretando a falha como sucesso. A saída deliberadamente omite exceções do navegador, URLs, tokens e conteúdo. O último comando e a interface visível permitem localizar a etapa. Encerrar normalmente com `quit` garante limpeza; não persistir cookies/storageState, traces, HAR, screenshots do Google ou dumps do IndexedDB. Downloads são desabilitados.

## Auditoria da fronteira

As chamadas à API passam por allowlist de método/caminho, sem body e sem query. `OPTIONS` é permitido somente nas rotas de controle conhecidas. O callback aceita exclusivamente navegação GET com parâmetros OAuth previstos e um único `iss=https://accounts.google.com`; seus valores não são registrados. Essa allowlist é um controle conservador do ensaio; a API de produção ignora extensões não reconhecidas conforme RFC 6749, sem lhes atribuir autoridade. Uma violação aborta a requisição e encerra o ensaio. O conteúdo sintético só trafega diretamente ao Google Drive. O harness registra em memória somente operationIds das submissões desta execução e contagens por operação. Se uma listagem trouxer arquivo desconhecido, interrompe antes de entregar a resposta à PWA ou baixar essa biblioteca. Uploads/downloads aceitam apenas os IDs, campos e bytes da fixture; a única edição permitida é a nota sintética gerada pelos comandos e seu updatedAt. `UNKNOWN_OR_INVALID_REMOTE_STOP` exige interromper o ensaio, não apagar arquivos desconhecidos. A conta deve começar sem arquivos deste aplicativo; reiniciar o harness contra uma biblioteca preexistente também será recusado. Não há limpeza remota automática.

O auditor não substitui as verificações de infraestrutura: logs de API Gateway/Lambda/CloudFront não podem capturar query, headers, cookies, tokens ou bodies; testar KMS/DynamoDB isolados, renovação/expiração, lease distribuído e worker de revogação conforme a issue 13.

## Gates adicionais antes de ativar produção

Os comandos concretos acima cobrem conflito divergente e resposta PUT perdida, além de renovação. Os cenários abaixo complementam esses gates. Registrar cada um como aprovado ou pendente; não ativar a flag com pendências.

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
- Usar conta sem biblioteca anterior do Livro a Livro. O transporte exclusivo de QA registra em `localStorage` somente IDs de operações criadas pelo ensaio, em chaves `livro-a-livro-qa-<commit>:operation:<uuid>` compartilhadas por A/B. A primeira listagem deve estar vazia. Metadados de arquivos com operação desconhecida interrompem a validação **antes de qualquer download**, com aviso no banner; não continuar ou apagar arquivos desconhecidos para forçar o teste. O registro não contém tokens, cookies, URLs de upload ou conteúdo da biblioteca.

O operador publica somente o conteúdo de `a/` e `b/` sob seus prefixos exatos de `build-info.json`, com `Cache-Control: no-store`; não publicar o diretório pai, alterar arquivos da raiz ou usar remoção recursiva no bucket inteiro. Definir a janela de teste e remover o prefixo ao final da sessão de validação; invalidar somente esse prefixo no CDN. Metadados de operação ficam locais. A publicação não faz parte do fluxo normal de CI.

Preferir um **perfil novo normal do Chrome** para o teste. O callback fixo retorna a `https://livroalivro.app.br/#/dados`, que carrega o aplicativo público e pode abrir o banco habitual daquele perfil. Em um perfil pessoal, esse retorno não é uma prova de isolamento global. Não abrir, exportar ou inspecionar sua biblioteca para validar o teste. Depois do retorno, a pessoa abre novamente a URL A/B informada; o opt-in pendente continua no banco de validação.

1. Abrir A e B e confirmar os dois banners e bibliotecas vazias. Importar somente a fixture sintética em A; manter B vazia.
2. Na página A, escolher conectar e realizar login/consentimento manualmente. Após o retorno canônico, voltar explicitamente à URL A. Exigir sincronização confirmada.
3. Em A e B, usar “Entrar com Google”, voltar à página de validação do mesmo slot e conferir que o Drive continua sem acesso. Usar “Autorizar Google Drive” somente por novo clique explícito; após o callback canônico, voltar novamente ao mesmo slot. Conectar/retomar B pelo fluxo normal e testar restauração/conflito com comparação dos dados sintéticos. Repetir os gates aplicáveis desta página pela interface, sem copiar tokens, cookies ou conteúdo pessoal.
4. A e B no **mesmo perfil** compartilham cookies da API. Elas comprovam isolamento das bibliotecas e concorrência local, mas não equivalem a duas sessões de dispositivos. Logout independente e revogação entre sessões reais exigem outro perfil/navegador normal ou permanecem registrados como pendentes; testes AWS separados não devem ser chamados de evidência de navegador real.
5. Ao terminar, fechar as abas QA, remover os objetos do prefixo publicado e invalidar esse prefixo. Se desejado, excluir somente os dois bancos QA de nomes exatos e as chaves técnicas de operações desse ensaio, com as abas fechadas. Nunca usar “limpar dados do site”, apagar o banco `livro-a-livro`, desregistrar o SW da raiz ou remover caches do aplicativo público. Arquivos sintéticos do Drive seguem a política explícita do ensaio; desconectar não os apaga. Apagar os IDs conhecidos impede que um ensaio futuro baixe os arquivos antigos: usar uma conta de teste vazia ou um plano explícito para a limpeza sintética.

Este caminho valida o OAuth normal e Drive reais; não substitui os gates de instalação/offline da PWA ou transforma gates ainda pendentes em aprovados.

## Gates adicionais do login persistente

Usar o contrato e a matriz de [auth-login-persistente.md](auth-login-persistente.md). Uma janela/aba diferente no mesmo perfil compartilha cookies e não prova isolamento entre dispositivos. Registrar separadamente os testes em um perfil e os testes com LOGIN independentes.

O ensaio de persistência verifica login sem Drive, navegação, recarga, reabertura e Agora não lembrado, com zero autorização/upload automático. O ensaio de falha de saída bloqueia apenas DELETE login: deve mostrar saída não confirmada, conservar pausa e dados e, após reload, recuperar o LOGIN ainda válido. Novo clique pode repetir a saída; só DELETE confirmado seguido de GET401 comprova encerramento. Não usar falha artificial no Google nem contornar bloqueio de navegador.

Sessões V1 usadas em ensaios anteriores não são promovidas. Reiniciar explicitamente o login no build novo preservando biblioteca e operações sintéticas conhecidas. Os testes de renovação/login/logout/cancelamento concorrente em DynamoDB usam tabela e chave isoladas; não alterar os prazos da tabela de produção para simular expiração.
