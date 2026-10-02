# Experimentos e métricas

Participação em experimentos e métricas técnicas é opcional, independente do Google Drive e desligada por padrão. Nenhuma escolha altera a biblioteca local.

O diagnóstico de erros da issue #95 tem rota própria. A issue #97 unifica sua escolha com a de visitas do Google Analytics; essa escolha não usa o catálogo, a semente, as atribuições ou a telemetria desta página e não ativa experimentos. A integração de experimentos continua pendente da issue #47.

## Estado da integração — 2 out 2026

A issue #47 conecta o catálogo ao runtime e aplica uma variante visual reversível ao resumo da estante. O rollout usa 10.000 buckets estáveis por seed local e versão de atribuição. Reduzir o percentual retira imediatamente quem saiu da faixa na próxima revalidação; o kill switch prevalece. Sem consentimento de experimentos, o cliente não consulta o catálogo. O valor inicial da tabela é ausente e corresponde a controle.

O endpoint de catálogo fica numa Lambda separada, com permissão apenas de leitura da tabela de experimentos. O deploy de infraestrutura e código precisa ocorrer antes da primeira publicação de configuração. A preferência de experimentos ainda não tem nova interface de adesão: após a decisão da issue #63, não adicionar outro convite ou caixa sem texto/finalidade aprovados. Por isso a variante permanece desligada para pessoas comuns até essa decisão. A telemetria própria da issue #47 também permanece sem runtime/ingestão publicados.

Para conferir a próxima revisão antes de publicar:

```sh
npm run publish:experiment -- --key shelf-summary-layout --expected-revision 0 --revision 1 --rollout 5 --enabled
```

O comando imprime o catálogo. Repetir com `--apply` grava na tabela por compare-and-swap via credenciais AWS do operador. `--rollout` aceita 0 a 100%, `--kill-switch` desliga a variante mesmo com `--enabled`, e toda reversão usa uma revisão maior. Para desligar, publicar nova revisão com `--kill-switch` e conferir `GET /v1/experiments/catalog`; não apagar a linha nem reduzir o contador. O comando não lê ou envia bibliotecas.

## Experimentos

O aplicativo só reconhece chaves e variantes compiladas em `src/experiments/registry.ts`. Um catálogo remoto versionado pode ativar ou desligar variantes já revisadas, mas não executa código, não cria uma finalidade nova de dados e não habilita o Drive. A atribuição usa uma semente aleatória guardada somente no IndexedDB deste dispositivo; ela não entra no backup, Drive, API ou telemetria.

Todo catálogo inválido, expirado, indisponível ou com *kill switch* ativo resulta no controle. O catálogo inicial não ativa nenhum experimento.

## Métricas técnicas

Quando integrado e autorizado, o cliente de métricas foi projetado para manter em memória contadores de eventos enumerados. O envio é sem cookies (`credentials: omit`), em no máximo quatro lotes por hora; um lote contém até 20 combinações e não recebe retry automático. Ao revogar a opção, o buffer é descartado.

Os contratos proíbem títulos, autores, ISBNs, notas, avaliações, UUIDs, seed, conexão Drive, tokens, URLs, IPs como dimensão, horários precisos, stacks e texto livre. A API deverá aceitar apenas combinações de contadores permitidas; a implementação atual ainda precisa da validação descrita em S3. A futura composição de produção agregará esses contadores por dia. Sem identificador, os contadores não representam pessoas únicas.

O catálogo e a ingestão estão em módulos Rust separados da autenticação OAuth: não recebem nem importam credenciais ou contratos de livros.
