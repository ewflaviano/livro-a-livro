# Atualização na abertura — issue #13

Decisão do responsável em 27 set 2026, após a união simplificada da PR #61. Revisão de arquitetura SOL aprovada antes da implementação. O comportamento anterior exigia procurar a ação de atualização no rodapé/configurações.

## Contrato

- Registrar e verificar o service worker na abertura. Aplicar automaticamente somente uma substituição real do worker ativo, descoberta na verificação inicial, quando biblioteca/sync estiverem inicializados e os bloqueios da interface montados.
- Qualquer início de interação encerra a oportunidade automática. Formulário, diálogo, rascunho, backup, operação de sync ou preferência ainda não salva adiam a aplicação. Não coletar conteúdo da interação.
- Operações usam uma trava curta de recarregamento independente de `blocked`/`hasDraft`, injetada pela composição. Isso evita bloquear a própria sincronização. Aquisição antes do trabalho assíncrono; liberação em finally; não iniciar durante aplicação.
- Revalidar segurança imediatamente antes de solicitar ativação e antes da recarga. A ativação do worker selecionado é necessária; controllerchange sozinho não basta. Eventos repetidos recarregam no máximo uma vez.
- Bloqueio/interação após solicitação impede recarga e mantém `reload-ready`. Reabrir aplicativo funciona mesmo quando waiting já desapareceu. Não concluir automaticamente depois de liberar o bloqueio.
- Timeout da resposta não prova cancelamento da ativação. Se o worker ativar depois, oferecer conclusão explícita. Não repetir indefinidamente nem forçar atualização por erro.
- Primeira instalação e ativação externa não recarregam. Foco, retorno de rede e verificação manual não reiniciam a oportunidade automática da abertura.
- O SW conserva integridade do precache, cache público apenas, recusa quando há outra janela, ausência de claim e preservação dos assets anteriores. Nenhuma migração do IndexedDB ou mudança de OAuth/Drive.

## Interface

Aviso compacto imediatamente abaixo do cabeçalho em todas as rotas. Enquanto rascunho, diálogo, sincronização, preferência pendente ou outra ocupação bloquearem a ação, o banner não aparece; o estado pendente reaparece assim que a trava é liberada, sem nova verificação. O progresso de uma aplicação já iniciada permanece visível. Falha e recusa por outras abas mantêm suas explicações quando o banner reaparece, junto da tentativa explícita. O gate em `register.ts` revalida a segurança antes de ativar ou recarregar. Sem modal adicional. Rodapé e configurações conservam informações de disponibilidade offline e a verificação manual, sem duplicar o botão de aplicação.

Uma instalação que ainda execute o cliente anterior pode precisar da última atualização manual para receber este comportamento. A próxima abertura usando o cliente novo passa a seguir a política automática; não forçar recarga da versão antiga com rascunho aberto.

## Validação

Testes de ciclo cobrem primeira instalação, inicialização tardia, interação, bloqueios, recusa multiaba, eventos duplicados, timeout e ativação posterior. Testes de operações verificam liberação e ausência de deadlock, inclusive preferências pendentes.

Ensaio reproduzível em Chromium descartável, sem acessar perfil pessoal ou Google:

```sh
CHROMIUM_PATH=/usr/bin/chromium node scripts/pwa-update-gate.mjs
```

O script gera dois builds de produção com marcadores públicos distintos e os serve na mesma origem local. Usa service workers reais, IndexedDB e fixture sintética com PNG. Confere atualização automática uma vez na abertura, preservação integral da biblioteca, reabertura offline, acesso a chunk antigo no cache, rascunho preservado até salvar, ação no topo em 320 px e recusa com duas abas seguida de retry. Só imprime códigos fixos; não imprime a biblioteca. `LAL_PWA_SCREENSHOT=/tmp/lal-pwa-320.png` grava captura sintética opcional.

Esse ensaio valida o ciclo em Chromium; não comprova eviction de armazenamento, todas as plataformas instaladas ou autorização Google.

## Resultado da validação (27 set 2026)

- 532 testes passaram; `VITE_DRIVE_ENABLED=true npm run build` concluiu.
- O ensaio em Chromium passou primeira instalação sem recarga, atualização única na abertura com biblioteca preservada, uso offline dos chunks antigos, rascunho salvo antes da atualização em 320 px e recusa/retry com duas abas (`PWA_UPDATE_GATE_PASS`).
- Revisão independente SOL não encontrou bloqueios de arquitetura ou de interface.
