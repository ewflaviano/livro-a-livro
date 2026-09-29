# Busca em português e Google Books — issue #103

**29/09/2026 · avaliação com títulos públicos, sem biblioteca pessoal**

## Observação de busca

Uma consulta pequena à Open Library com `lang=pt` retornou 91 obras para “Dom Casmurro” e 143 para “A hora da estrela”. Os primeiros resultados incluíram a obra esperada, mas também variações de autoria e obras relacionadas. Uma terceira tentativa por ISBN não concluiu por erro de rede. Esses números não medem relevância geral nem qualidade das edições. A chamada experimental à Books API sem chave retornou HTTP 429; não há chave Books configurada no build do app e **não foi possível comparar os resultados Google em condições de produção**. Não usar esse teste como evidência de melhora.

## Decisão desta entrega

O app oferece **Pesquisar no Google Books ↗** como saída explícita para outra guia. A URL contém somente o texto digitado nessa busca, normalizado em espaços; o clique é necessário para enviar a consulta. A biblioteca, notas, avaliações, backup e preferências não entram na URL. O botão monta a URL apenas no clique, evitando que a medição automática de links externos do Analytics capture a consulta, e abre a guia com `noreferrer`. A Open Library, o cadastro manual e a estante offline continuam disponíveis. Nenhum resultado Google é copiado automaticamente para IndexedDB, backup ou Drive.

Esta opção não exige chave, billing, proxy, novos endpoints ou custo recorrente do projeto. O Google processa a pesquisa na própria página. A política de privacidade informa essa transferência no clique.

**Verificação de privacidade:** com Analytics consentido e `gtag.js` real em Chromium local, o coletor foi interceptado antes do envio. Houve um hit de página e nenhum hit com o título, `q` ou o domínio Google Books após clicar no botão. O teste de interface também confirma que não há URL de consulta em âncora nem requisição ao digitar. Esse ensaio não substitui nova verificação se a configuração da propriedade Analytics mudar.

## Condições para resultados dentro do aplicativo

1. **Direitos de retenção:** os [Termos gerais das APIs Google, seção 5(e)](https://developers.google.com/terms) restringem cópias permanentes do conteúdo retornado e cache além do cabeçalho, salvo permissão aplicável. O fluxo atual de seleção persiste título, autores, ano, ISBN, origem e referência de capa no IndexedDB e pode levá-los ao backup e Drive. Antes de habilitar seleção de resultados Google, documentar uma base para reter cada campo e uma política de remoção. Não presumir que a permissão de exibir resultados autoriza salvar capas.
2. **Identificação e custo:** [consultas públicas da Books API exigem chave de API ou token](https://developers.google.com/books/docs/v1/using). A chave precisa ser própria, limitada à Books API e aos referers do domínio; não reutilizar OAuth do Drive. Confirmar no projeto Cloud a quota, possibilidade de limite diário e eventual cobrança antes da ativação. A [documentação de quotas](https://docs.cloud.google.com/apis/docs/capping-api-usage) não estabelece uma cota grátis fixa para Books. Uma chave num PWA é observável no navegador mesmo se fornecida ao build por segredo do CI; restrições e quota limitam seu uso indevido. O cabeçalho atual `Referrer-Policy: no-referrer` exigiria exceção `origin` só para a chamada Books, testada com a restrição real do domínio.
3. **Apresentação:** resultados Google separados dos da Open Library, sem misturar nem reordenar, com [marca “Powered by Google” e link destacado por resultado](https://developers.google.com/books/branding). Manter cadastro manual e estados de erro, 429, timeout e offline. `langRestrict=pt` e `isbn:` são parâmetros documentados da [pesquisa de volumes](https://developers.google.com/books/docs/v1/reference/volumes/list), mas a relevância precisa ser medida com a chave e um conjunto público de QA. Não consultar ao digitar nem ao reabrir a estante.
4. **Contrato local:** se a retenção for permitida, adicionar uma variante discriminada de origem com `volumeId` validado, sem confundir IDs Google e Open Library. Tratar compatibilidade de backup, Drive e clientes antigos antes de gravar essa variante. Para capa, preferir ausência ou mídia enviada pelo usuário enquanto licença e comportamento offline não forem definidos. Não reutilizar o cache de 24 horas da Open Library para Google sem verificar cabeçalhos e direitos.

Uma integração embutida continua como trabalho separado, sujeita a revisão de arquitetura e testes com conta/chave do projeto. O [termo específico da Books API](https://developers.google.com/books/terms) também restringe cobrar pelo uso do aplicativo sem acordo; conferir o fluxo “Apoiar” se esse modelo mudar.
