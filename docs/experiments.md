# Experimentos e métricas

O aviso de uso do aplicativo oferece uma escolha conjunta para visitas, diagnóstico de erros, experimentos de interface e contagens técnicas dos experimentos. A escolha é opcional, local ao navegador e independente do Drive. O aceite antigo (`usage-consent-v1`) não ativa as novas finalidades: a pessoa precisa aceitar o texto ampliado (`usage-consent-v2`). Sem esse aceite, o catálogo não é consultado e a telemetria de experimentos não é enviada. A revogação interrompe as consultas, cancela envios em andamento e descarta contadores em memória. Sair e apagar dados locais também apaga a escolha.

## Catálogo e distribuição

O código só reconhece `shelf-summary-layout` e as variantes `control` e `compact`. O catálogo remoto escolhe percentuais e um *kill switch*, mas não executa código. O cliente usa 10.000 faixas e uma semente aleatória guardada no IndexedDB; semente e atribuições não entram no backup, Drive, API ou telemetria. O catálogo é revisto a cada 60 segundos, ao retornar à aba e ao voltar a conexão. Catálogo ausente, inválido, vencido, indisponível, com revisão inferior ou desligado resulta em `control`. O catálogo inicial de produção é vazio: nenhum experimento está ativo.

O operador publica uma revisão maior após revisar o resultado sem `--apply`:

```sh
npm run publish:experiment -- --key shelf-summary-layout --expected-revision 0 --revision 1 --rollout 5 --enabled
```

`--apply` grava a revisão por compare-and-swap no DynamoDB. Para desligar, publique uma revisão maior com `--kill-switch` e confirme `GET /v1/experiments/catalog`. Não reduza a revisão nem apague a linha. A versão de atribuição de `shelf-summary-layout` é 1.

## Contagens

O cliente só cria contadores quando a escolha conjunta está aceita e um experimento foi atribuído. O buffer fica em memória, sem fila persistente, `sendBeacon`, Service Worker ou retry automático. Um lote tem até 20 combinações e 10 KiB; são no máximo quatro lotes por hora por aba visível. A requisição usa `credentials: omit`, `redirect: error` e `no-referrer`. A revogação aborta requisições em andamento.

A Lambda de ingestão aceita somente a tupla compilada `build=0.1.0`, `experiment=shelf-summary-layout`, `revision=1`, `variant=control|compact`, evento enumerado e, em erro, código técnico enumerado; cada contagem é de 1 a 100. Rejeita campos adicionais, texto livre, variantes desconhecidas e lotes acima dos limites antes do armazenamento. A publicação de uma nova revisão que precise de métricas exige atualizar essa lista compilada e implantar a Lambda antes de ativá-la.

A Lambda tem papel próprio com apenas `UpdateItem` na tabela de agregados diários e escrita em seu grupo de logs. A tabela não contém evento bruto, pessoa, IP, cookie, semente, livro, nota, avaliação, busca, URL, token ou identificador; o índice primário combina somente dia e dimensões enumeradas. Não há índice por pessoa. O TTL marca os agregados para exclusão após 30 dias; a remoção física assíncrona pode demorar mais. Não há PITR nessa tabela. Relatórios operacionais devem filtrar dias válidos e ocultar células com menos de 20 contagens; sem identificador, uma contagem não representa uma pessoa única. O API Gateway não grava access logs/payloads desta rota e aplica throttling; a Lambda não registra corpo ou cabeçalhos.

## Implantação

O pipeline testa e empacota `auth`, `revocation`, `diagnostics`, `experiments` e `telemetry`. O papel do CI só publica código em Lambdas existentes; o operador implanta infraestrutura com `infra/api.yml` e `scripts/provision-api.sh`, usando change set revisado. A implantação da rota de catálogo deve acontecer antes de qualquer configuração ativa. A rota de telemetria deve retornar 204 para um lote sintético permitido e rejeitar tuplas fora da lista. Verifique CORS/OPTIONS, ausência de cookies, papéis IAM, TTL e que AuthTable/KMS/Secrets não entraram no papel de telemetria. A biblioteca local continua funcional quando as rotas falham.
