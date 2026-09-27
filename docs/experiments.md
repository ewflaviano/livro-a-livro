# Experimentos e métricas

Participação em experimentos e métricas técnicas é opcional, independente do Google Drive e desligada por padrão. Nenhuma escolha altera a biblioteca local.

## Experimentos

O aplicativo só reconhece chaves e variantes compiladas em `src/experiments/registry.ts`. Um catálogo remoto versionado pode ativar ou desligar variantes já revisadas, mas não executa código, não cria uma finalidade nova de dados e não habilita o Drive. A atribuição usa uma semente aleatória guardada somente no IndexedDB deste dispositivo; ela não entra no backup, Drive, API ou telemetria.

Todo catálogo inválido, expirado, indisponível ou com *kill switch* ativo resulta no controle. O catálogo inicial não ativa nenhum experimento.

## Métricas técnicas

Com a opção ativada, o cliente mantém em memória contadores de eventos enumerados. O envio é sem cookies (`credentials: omit`), em no máximo quatro lotes por hora; um lote contém até 20 combinações e não recebe retry automático. Ao revogar a opção, o buffer é descartado.

Os contratos proíbem títulos, autores, ISBNs, notas, avaliações, UUIDs, seed, conexão Drive, tokens, URLs, IPs como dimensão, horários precisos, stacks e texto livre. A API recebe apenas contadores allowlisted e a futura implementação de produção os agregará por dia. Sem identificador, os contadores não representam pessoas únicas.

O catálogo e a ingestão estão em módulos Rust separados da autenticação OAuth: não recebem nem importam credenciais ou contratos de livros.
