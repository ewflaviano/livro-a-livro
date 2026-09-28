# Experimentos e métricas

Participação em experimentos e métricas técnicas é opcional, independente do Google Drive e desligada por padrão. Nenhuma escolha altera a biblioteca local.

O diagnóstico de erros da issue #95 tem consentimento e rota próprios. Não usa o catálogo, a semente, as atribuições ou a telemetria desta página; sua ativação não ativa experimentos. A integração de experimentos continua pendente da issue #47.

## Estado da integração — 27 set 2026

Existem módulos de registro, catálogo, atribuição e métricas com testes, além de consentimentos persistidos em Seus dados. Porém `fetchCatalog`, `assignExperiment` e `createTelemetry` ainda não têm consumidores na aplicação: ativar a opção não aplica uma variante nem inicia envio. Não há composição publicada de catálogo/ingestão no checkout.

As seções seguintes descrevem contratos dos módulos e o comportamento exigido para a integração. Antes da publicação, fechar o achado S3 da [auditoria](audit-2026-09-27.md): a API enumera eventos/códigos, mas ainda aceita texto livre limitado por comprimento nas dimensões build/experimento/variante. A proibição de conteúdo privado precisa ser validada no servidor, não apenas documentada.

## Experimentos

O aplicativo só reconhece chaves e variantes compiladas em `src/experiments/registry.ts`. Um catálogo remoto versionado pode ativar ou desligar variantes já revisadas, mas não executa código, não cria uma finalidade nova de dados e não habilita o Drive. A atribuição usa uma semente aleatória guardada somente no IndexedDB deste dispositivo; ela não entra no backup, Drive, API ou telemetria.

Todo catálogo inválido, expirado, indisponível ou com *kill switch* ativo resulta no controle. O catálogo inicial não ativa nenhum experimento.

## Métricas técnicas

Quando integrado e autorizado, o cliente de métricas foi projetado para manter em memória contadores de eventos enumerados. O envio é sem cookies (`credentials: omit`), em no máximo quatro lotes por hora; um lote contém até 20 combinações e não recebe retry automático. Ao revogar a opção, o buffer é descartado.

Os contratos proíbem títulos, autores, ISBNs, notas, avaliações, UUIDs, seed, conexão Drive, tokens, URLs, IPs como dimensão, horários precisos, stacks e texto livre. A API deverá aceitar apenas combinações de contadores permitidas; a implementação atual ainda precisa da validação descrita em S3. A futura composição de produção agregará esses contadores por dia. Sem identificador, os contadores não representam pessoas únicas.

O catálogo e a ingestão estão em módulos Rust separados da autenticação OAuth: não recebem nem importam credenciais ou contratos de livros.
