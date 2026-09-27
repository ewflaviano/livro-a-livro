# Gate real do Drive antes da liberação

O script `scripts/drive-gate.mjs` cria um Chromium novo e dois contextos descartáveis, A e B. Nunca conecta a um Chrome existente. O build temporário usa `VITE_DRIVE_ENABLED=true`, mas nenhum arquivo é publicado e a flag da distribuição pública permanece **false**. API, OAuth e Drive reais só devem ser usados depois do deploy da API e da revisão de suas fronteiras.

## Preparação e verificação sem Google

```sh
CHROMIUM_PATH=/usr/bin/chromium node scripts/drive-gate.mjs --smoke
```

O modo smoke executa headless, bloqueia toda rede externa, importa a fixture versionada com PNG sintético real, verifica os bytes e testa cadastro, edição e exclusão offline. Também simula uma conexão local descartável e tenta revogar com a API inacessível: exige aviso pendente persistente, sem alegar confirmação do Google. Por fim, respostas sintéticas de API exercitam o comando de renovação: rotação de cookie HttpOnly/CSRF e rejeição do cookie antigo num contexto novo; esse mock valida o harness, não a API real. As bibliotecas são comparadas em memória; os logs contêm apenas códigos fixos. `SMOKE_PASS` não comprova OAuth nem comunicação com Drive.

Sem `--smoke`, o navegador é visível. `CHROMIUM_PATH` é opcional quando o Chromium do Playwright estiver instalado. O script constrói em uma pasta temporária; `--dist /caminho/build-privado` permite usar um build já preparado com Drive habilitado. Não usar dados pessoais, bibliotecas exportadas de usuários ou contas com dados do aplicativo que devam ser preservados.

O harness serve somente a página canônica, privacidade, manifesto, assets e ícones do build privado via interceptação. A origem continua `https://livroalivro.app.br`, preservando CORS e cookies reais da API. Service Workers são bloqueados nesses contextos: este gate não substitui o teste separado da PWA instalada/offline. Google e API não são simulados no modo real.

## Execução com API real

```sh
CHROMIUM_PATH=/usr/bin/chromium node scripts/drive-gate.mjs
```

Digite um comando por linha. Use uma conta de teste Google sem biblioteca prévia do Livro a Livro; A e B devem autorizar a mesma conta.

1. `prepare`: abre A/B vazios e importa somente em A a fixture sintética com capa.
2. `connect A`: inicia o OAuth. Ao navegar ao Google, imprime `READY_FOR_GOOGLE_CONSENT`. **Pare a automação, solicite o handoff humano e aguarde autorização.** O humano realiza login e consentimento no navegador; o script não preenche credenciais, clica consentimento nem contorna bloqueios do Google. Se Google bloquear a automação, interrompa e registre o gate como pendente.
3. Depois do retorno canônico, `synced A`: exige confirmação visível do Drive.
4. `connect B`: repetir o handoff humano. Após o callback, B deve apresentar conflito inicial; `remote B` exige exatamente uma versão remota e confirma sua escolha. `synced B` e `compare` comprovam igualdade integral de livros, bytes das capas e preferências portáveis.
5. `pause A`: exige estado pausado persistente após reload e biblioteca intacta. `renew A`: faz GET de sessão, POST vazio de renovação com CSRF e novo GET pelo navegador na origem real. Compara cookie e CSRF somente em memória, exige cookie Secure/HttpOnly/SameSite=Lax e comprova que o cookie anterior recebe 401 num terceiro contexto efêmero. Nenhum token/cookie é persistido ou impresso. Se A estiver sincronizando, o comando pausa antes de renovar; deixa A pausado. `SESSION_ROTATED_OLD_COOKIE_REJECTED` confirma esse gate. `resume A`, `synced A` verificam retomada explícita.
6. `logout A`: encerra apenas a sessão de A, exige pausa persistente e dados intactos. `resume A`, `reconnect-required A` verificam necessidade de nova autenticação. B continua com sessão própria.
7. `revoke B`: solicita desconexão global, preservando a biblioteca e os arquivos no Drive. Se o retorno indicar revogação pendente ou a requisição falhar, o harness exige aviso persistente após reload e imprime `REVOCATION_UNCONFIRMED`; isso comprova somente pausa/preservação local e aviso honesto, **não** revogação concluída no Google. Siga o aviso para remover a conexão na Conta Google e acionar suporte quando necessário. A API deve negar sessões/tokens dessa conexão; para observar isso numa aba ainda autenticada, reconecte A antes da revogação de B e use `reconnect-required A`. A expiração/revogação de access tokens já emitidos não é instantânea.
8. `offline-crud A`: desliga rede do contexto, cadastra, edita e exclui um livro sintético e compara o estado final ao anterior. Reativa a rede ao terminar.
9. `audit`: exige que nenhuma requisição à API tenha violado a fronteira. `quit`: fecha o navegador e remove o build temporário.

`COMMAND_FAILED` indica um gate não aprovado. Não prossiga interpretando a falha como sucesso. A saída deliberadamente omite exceções do navegador, URLs, tokens e conteúdo. O último comando e a interface visível permitem localizar a etapa. Encerrar normalmente com `quit` garante limpeza; não persistir cookies/storageState, traces, HAR, screenshots do Google ou dumps do IndexedDB. Downloads são desabilitados.

## Auditoria da fronteira

As chamadas à API passam por allowlist de método/caminho, sem body e sem query. `OPTIONS` é permitido somente nas rotas de controle conhecidas. O callback aceita exclusivamente navegação GET com parâmetros OAuth previstos; seus valores não são registrados. Uma violação aborta a requisição e encerra o ensaio. O conteúdo sintético só trafega diretamente ao Google Drive.

O auditor não substitui as verificações de infraestrutura: logs de API Gateway/Lambda/CloudFront não podem capturar query, headers, cookies, tokens ou bodies; testar KMS/DynamoDB isolados, renovação/expiração, lease distribuído e worker de revogação conforme a issue 13.

## Gates adicionais antes de ativar produção

Os comandos básicos não cobrem automaticamente todos os cenários abaixo. Registrar cada um como aprovado ou pendente; não ativar a flag com pendências.

- **Conflito real:** partindo de A/B iguais e sincronizados, desligar ambos da rede, editar livros diferentes pela UI, reconectar e aguardar ambas as alterações. Exigir escolha explícita, baixar/inspecionar a recuperação apenas em memória ou armazenamento sintético descartável e comparar o resultado integral. Não aceitar escolha por timestamp.
- **Resposta perdida:** interceptar somente a resposta final do PUT resumable para Drive depois de sua aceitação pelo servidor. Reabrir o contexto preservando apenas seu armazenamento descartável e verificar reconciliação por operationId sem upload duplicado. Nunca imprimir URL da sessão resumable nem headers. Não repetir PUT manualmente.
- **Cancelamento concorrente:** retardar uma requisição Drive e pausar/logout antes de liberá-la; reload deve continuar pausado, sem substituição tardia. Os testes unitários cobrem deterministicamente as fronteiras transacionais.
- **Expiração real:** o comando `renew A` cobre rotação e invalidação imediatamente, sem alterar DynamoDB ou esperar a sessão expirar. Validade absoluta e expiração independente do TTL continuam cobertas pelos testes próprios da API; o harness não modifica registros de sessão.
- **Falhas de serviço:** negar API e Google mantendo a página aberta; estante, cadastro, edição, exportação e importação JSON devem continuar locais. O modo smoke testa CRUD offline; exportação/importação offline e Worker/PWA têm gates próprios.
- **Consentimento negado/expirado:** verificar recuperação honesta na UI após retorno do OAuth sem autorização válida, sem perda local.

Somente depois de todos os gates de frontend, API e infraestrutura, revisar e publicar separadamente a alteração da flag pública.
