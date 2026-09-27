# Issue 13 — recebimento inicial e união explícita de bibliotecas

Contrato de arquitetura da fatia iniciada após integrar a PR 56. Referência BioRotina: f6fb6667f0c025a5bc02e7e6bde2960721a041aa, merge por união de IDs e preferência de registro inteiro. Leitura: docs/paridade-biorotina.md; src/sync/{contracts,snapshot,drive-client,coordinator,outbox}; backup/schema/media; repositório IndexedDB e portas.

## 1. Escopo e invariantes

- IndexedDB continua autoridade local. Login, biblioteca local, backup e edição offline conservam seus contratos. API/OAuth/IAM não mudam nesta fatia.
- Sincronização já automática durante execução: preservar debounce, foco/online/polling e limites atuais. Novo comportamento: receber primeira biblioteca em instalação vazia segura e oferecer união explícita nas divergências.
- Opções: Juntar bibliotecas; Manter esta biblioteca; Usar uma versão do Drive; Decidir depois. Nenhuma união ocorre sem prévia e confirmação. Escolha é de livro inteiro, nunca campo a campo, relógio vencedor ou CRDT.
- Toda resolução cobre local e TODAS as pontas remotas conhecidas. Não esconder uma terceira ponta ao mostrar apenas duas versões. Conta/geração diferente exige confirmação explícita antes de enviar dados locais.
- Biblioteca, capas, hashes, prévias e escolhas ficam no navegador/Drive. Sem payloads em API, logs, URLs de navegação, métricas, fixtures pessoais ou PR.

## 2. Protocolo 2, sem reinterpretar protocolo 1

### Envelope e descoberta

Manter envelope atual e LibraryExport schemaVersion 1; aceitar protocolVersion 1 ou 2 numa união discriminada. Novos snapshots/recuperações/resoluções são V2; operação V1 já persistida continua V1 até reconciliar.

Usar o MESMO nome histórico de descoberta `livro-a-livro-snapshot-v1.json` para ambos os protocolos nesta fatia. É um identificador estável de arquivos, não autoridade de versão. appProperties.protocolVersion acompanha o envelope (`1` ou `2`); os demais campos permanecem. Motivo: cliente antigo já consulta esse nome e rejeita protocolVersion desconhecido; criar um nome V2 invisível para ele permitiria uploads sobre história parcial. Não renomear arquivos antigos. Documentar esse nome legado deliberado. Futuro nome neutro exigiria estratégia adicional de descoberta/compatibilidade e está fora do escopo.

Listagem aceita ambos, rejeita versões futuras, valida o conjunto inteiro antes de decidir. Download compara também protocolVersion com metadata, além de snapshotId/operationId/hash/parent/createdAt. Envelope de resolução é lido para resolvedSnapshotIds como hoje; verificar que resolution=0 corresponde a lista vazia e resolution=1 a lista não vazia. Cache de header só vale para metadata idêntica (ou novo cliente/ciclo); não confiar em header antigo se metadata mudou.

IDs de grafo/operação: manter o texto wire V1 intacto, usando UUID minúsculo apenas como chave interna para verificar referências, ciclos e duplicatas. Rejeitar aliases ambíguos (dois snapshotIds/operationIds que diferem apenas em caixa), autorreferência ou ciclo escondido por caixa; não fundir esses registros silenciosamente. Duplicatas físicas legítimas da MESMA operação devem ter IDs wire exatos e header idêntico; em V1, antes de usá-las como evidência de equivalência, confirmar também igualdade de conteúdo pelo digestV2 após validar cada payload, porque o hashV1 omite preferências. UUIDs novos V2 são minúsculos. Não reescrever referências históricas V1.

### Hash exato

- `libraryHashV1` deve manter EXATAMENTE o algoritmo histórico: parseExportV1, books.sort(localeCompare(id)), JSON de books+coverMedia na ordem recebida, sem preferences. Não normalizar casos, campos ou ordem ao validar/reconciliar V1. Criar fixtures de golden digest antes da mudança.
- `libraryHashV2` é SHA-256 da codificação UTF-8 de JSON canônico de `{books, preferences, coverMedia}` após validação. Não inclui exportedAt, envelope de transporte ou estado local.
- Canonicalização V2: ordenar chaves de objetos recursivamente por comparação binária definida (`a < b`), ordenar books e coverMedia por UUID minúsculo com o mesmo comparador; manter ordem semântica dos arrays internos (autores); normalizar apenas UUIDs de identidade/referências na cópia canônica (book.id, cover.mediaId, media.id). Não alterar os valores persistidos nem normalizar textos, datas, notas ou autoria. Números/strings seguem JSON.stringify de valores já validados, sem undefined/NaN.
- Antes de canonicalizar/comparar/mesclar, rejeitar duplicados casefold de book.id ou media.id DENTRO de cada fonte, sem Map overwrite. Os validadores atuais já rejeitam esses casos em biblioteca/mídia; manter essa proteção e explicitá-la no caminho V2. Não alterar o hash/serialização V1 para "reparar" um legado ambíguo: preservar o arquivo, explicar a falha e não converter automaticamente. Colisões ENTRE fontes são tratadas pelas escolhas de livro inteiro ou renomeação de mídia abaixo.
- Incluir o registro completo de cada livro, preferences portáveis completas e mídia referenciada completa (mime/dimensões/createdAt/base64 canônico). Writer V2 remove órfãs; parser V2 exige conjunto de mídias exatamente referenciado, evitando conteúdo invisível ao hash. V1 mantém regras anteriores.
- V1 e V2 nunca comparam hashes de wire entre versões. Para equivalência semântica, baixar/validar V1 com V1, então calcular digest V2 do seu conteúdo validado. Mesmo hash V1 NÃO prova igualdade de preferências nem igualdade completa de dois payloads V1. A projeção comparativa V2 descarta mídias órfãs V1 somente após validar integralmente o snapshot histórico; os bytes e o hash wire V1 permanecem intactos. O parser V2 continua recusando órfãs.
- Base local passa a incluir protocolVersion e `comparisonHashV2` opcional, além de snapshotId/hash originais. Legado sem versão é explicitamente V1; comparisonHashV2 só nasce de download validado do snapshot exato da base. Não preencher com hash da biblioteca local atual por suposição.

### Migração conservadora

Leitura dupla/escrita nova V2, sem reescrever snapshots remotos. Não recriar operação V1 pendente com IDs/hash/data novos. Persistência atual guarda objeto snapshot, não o corpo HTTP original: conservar objeto e ordem/serializador V1 existentes; golden test prova JSON.stringify e bytes de PUT idênticos antes/depois, incluindo casos de mídia e UUID em maiúsculas. Se uma representação legada não puder ser reproduzida, pausar e preservar para reconciliação/ação explícita; não alegar igualdade de bytes sem teste.

Operação incerta: primeiro listar e reconciliar operationId+snapshotId+versão+hash e payload quando necessário; nunca converter antes disso. Se já confirmada, reconhecer a revisão antiga preservando alterações posteriores e gerar V2 só na próxima operação necessária. Se ausente e ainda válida para mesma base/conta, reenviar a mesma V1. Se nova ponta/conta impedir retry, expor conflito e preservar operação antiga até decisão explícita; sua substituição entra na transação da resolução, não numa limpeza no bootstrap.

Não publicar V2 apenas por abrir um cliente e não anunciar sincronizado enquanto comparação completa V1 ainda estiver pendente. `base=null` é legítimo: permite bootstrap vazio seguro ou prévia sem base. Uma base DECLARADA cujo snapshot não é encontrado/validável, história referenciada incompleta ou versão futura bloqueia aplicação, preservando local; não apagar a base para transformar erro em primeira conexão. Manter limites atuais de arquivos, JSON, envelope, mídia e resolvedSnapshotIds.

## 3. Preferências portáveis entram na revisão local

Hoje updatePreferences altera shelfYear/mode/filter sem revisão/outbox. Com hashV2 isso é incorreto: mudança remota pode sobrescrever preferência recém-editada e mudança só de preferência não dispara envio.

Alterar somente writes efetivamente diferentes de campos portáveis: numa transação preferences+meta+syncOutbox, mesclar patch, validar, incrementar revisão, gravar pending e notificar assinantes após commit. No-op não avança revisão. lastExport segue local, sem revisão de conteúdo/outbox; não incluir consentimentos, login, dismissal, filtros técnicos ou caches. Escrita conjunta portable+lastExport avança uma vez. Limite de revisão permanece validado.

Consequência esperada: prévia de importação/resolução ou formulário com revisão antiga precisa revalidar após preferência concorrente; não relaxar CAS para contornar isso. Queues do shelf-service permanecem ordenadas; atualização remota e edição local de preferências recebem os mesmos testes de concorrência. Não criar segundo relógio/revisão por antecipação.

## 4. Modelo da união

Portas conceituais mínimas (nomes ajustáveis, responsabilidades não):

`prepareResolution() -> ResolutionPreview`

`confirmResolution(previewId, choices) -> localCommittedPending | synchronized`

`cancelResolution(previewId) -> void`

Prévia em memória, de uso único, com UUID técnico: revisão local, authRevision, binding completo, fingerprint de headers de TODAS as pontas (não apenas IDs), conteúdo local/remoto validado, base confiável opcional, decisões requeridas e orçamento projetado. Nenhum token/CSRF/URL. Não persisti-la como autoridade; reload refaz a prévia. UUID não entra no Drive como metadado de usuário.

Fontes são `local` e cada snapshotId de ponta validada. Não fundir/remover registros por título/ISBN; UUID minúsculo é chave de comparação. Mesmo título com IDs distintos continua sendo dois livros, explicado na prévia. Não alterar timestamps de um livro só porque foi escolhido na resolução.

Preparação de união tem orçamento agregado próprio: no máximo 100 MiB de JSON de fontes distintas materializadas (local + heads + base, contando snapshot reutilizado uma vez), além dos limites individuais existentes. Somar metadados/tamanhos antes de materializar as fontes e conferir tamanho real ao ler, sem confiar apenas na declaração. Não carregar quantidade ilimitada de snapshots de 50 MiB simultaneamente. Processar sequencialmente, descartar buffers intermediários e revogar object URLs ao cancelar/fechar. Se ultrapassar o orçamento, bloquear SOMENTE Juntar com explicação e manter exportação/escolha de biblioteca inteira; não ignorar pontas para caber. Esse limite de preparação não reduz o limite de backup de uma biblioteca e deve estar documentado/testado, inclusive em celular. NÃO é orçamento global de tráfego do ciclo: a listagem atual pode baixar envelopes de resolução históricos para reconstruir headers antes da prévia. Esses downloads continuam com limites individuais/paginação, descartando conteúdo após extrair header; não alegar que 100 MiB limita toda a transferência de história. Se tal snapshot também vira fonte retida na prévia, conta uma vez no orçamento de fontes.

### Livros

1. Mesmo ID e conteúdo inteiro equivalente entre todas as versões presentes: uma cópia. A igualdade inclui a capa efetiva; mesmo Book com mesmo mediaId mas bytes distintos NÃO é equivalente.
2. IDs distintos/adições únicas: incluir na proposta de união. Usuário vê contagem e pode excluir antes de confirmar; não gravar ainda.
3. Mesmo ID com versões divergentes: escolha explícita de UMA versão inteira entre fontes presentes, ou excluir o livro. Mostrar título, autores, estado, datas/ano, páginas, nota/avaliação e capa com distinções legíveis. Nenhum default silencioso por data. A ação opcional “Preferir todos deste dispositivo/desta versão” é escolha explícita em lote, com contagem e confirmação; não obrigar milhares de cliques.
4. Sem base confiável, ausência não prova exclusão. Exibir grupo “Presentes só em algumas versões” com aviso que juntar pode trazer de volta algo removido. Exigir confirmação explícita de incluir esse grupo (ou escolhas de exclusão) antes de habilitar confirmação. Não rotular como “novos” com certeza.
5. Base confiável: somente snapshot exato da base local, mesma conta/geração, baixado/validado, ancestral de TODAS as pontas. Não procurar uma base comum arbitrária nem inventar ancestral a partir de tempos. Se um ID existia nessa base e está ausente em alguma fonte, destacar “Removido em uma versão” e exigir manter uma versão presente ou excluir. Mesmo quando a outra versão está igual à base, a resolução da união continua explícita; a base serve para explicar, não para apagar automaticamente.
6. Ausente em todas as fontes continua ausente. IDs que não existiam na base e aparecem numa fonte são adições únicas; podem entrar na proposta. Caso livro criado/apagado sem deixar histórico conhecido, não há promessa de detectar essa intenção.

Escolhas devem citar somente IDs/fontes presentes na prévia. Validar lista exata de decisões requeridas, sem entradas duplicadas/desconhecidas. Nunca aceitar LibraryExport arbitrário vindo da UI como resultado confiável: o serviço produz o resultado a partir de escolhas restritas.

### Preferências

Tratar `{shelfYear, mode, filter}` como um conjunto portátil indivisível nesta fatia. Se todos iguais, conservar. Se divergentes, escolha explícita “Preferências deste dispositivo” ou de uma versão Drive, com prévia dos três valores. Não usar preferência de login, lastExport ou timestamp. Não introduzir merge por campo.

### Capas e colisões

Primeiro selecionar os livros, depois resolver a mídia de cada livro pela MESMA fonte escolhida. Referências Open Library continuam referências existentes; não baixar imagens externas para realizar união. Local media exige bytes/imagem/dimensões válidos antes da prévia.

Se dois livros selecionados de fontes distintas usam mesmo mediaId e mídias diferentes, manter ambas: reservar novo UUID para uma mídia, reescrever somente referências dos livros daquela proveniência, conservar bytes e metadados. UUID novo deve evitar TODOS os IDs de mídia reservados nas fontes e já alocados na prévia, comparados em minúsculas; colisão gera outro UUID antes de congelar a proposta. UUIDs gerados uma vez na materialização da prévia e congelados até confirmação; novo retry de upload usa snapshot já persistido. Não sobrescrever mídia por ordem de iteração. Fonte/ordem canônica determina qual conserva o ID, sem valor semântico. Mídia idêntica significa todo o conteúdo canônico sem id: bytes+mimeType+width+height+createdAt, não somente bytes. Com mesmo ID pode ser compartilhada; não deduplicar IDs diferentes nesta fatia. Excluir órfãs após escolhas. Contagem/bytes pós-renomeação precisam passar 100 mídias/2MiB cada/12MiB total/50MiB backup/envelope sync. Se exceder, informar limite e permitir rever escolhas; sem truncamento ou remoção silenciosa.

## 5. Commit, recuperação e concorrência

Não manter lease vivo enquanto a pessoa lê a prévia. Preparar sob leitura consistente; na confirmação adquirir lease normal e reler autorização, controle, revisão e listagem completa. Comparar binding+authRevision+revisão+fingerprint de todos heads. Mudança invalida prévia e apresenta novas diferenças, sem aplicar escolha antiga automaticamente. Revalidar bloqueio de rascunho/backup/update antes do commit.

Fechar também a janela local hoje existente entre replace, saveOperation e update(binding/base): uma resolução nova não pode deixar biblioteca substituída sem seu plano durável de envio se o processo fechar.

Contrato mínimo de porta transacional de sync (pode compartilhar helper validado do adaptador; não duplicar validação nem colocar rede na transação):

`commitResolution({expectedRevision, expectedAuthRevision, expectedBinding, leaseOwner, result, recovery, outgoingDraft}) -> committedRevision`

Uma única transação IndexedDB em books/coverMedia/preferences/meta/syncState/syncOutbox:
- Confere revisão, enabled, ausência de autorização em curso, authRevision, binding permitido e lease proprietário/vigente.
- Conserva a biblioteca local exata capturada como recuperação (já preparada/validada); mantém intacta em abort/quota.
- Aplica resultado completo, mídias e prefs com as validações existentes; avança revisão/generation conforme replace; retira somente mídias órfãs resultantes.
- Grava operação de resolução V2 imutável com a revisão RESULTANTE, todos heads consumidos em resolvedSnapshotIds e parent escolhido determinístico entre eles; binding explicitamente confirmado, base ainda não confirmada, pending correspondente.
- Não descarta biblioteca/recuperação/operação antigas antes do commit. O resultado inteiro fica localmente salvo ou nada muda. Serialização/hash/decode são feitos antes da transação; nela só validação estrutural/CAS/writes.

Decisão aprovada: porta específica em `src/ports/sync-resolution-repository.ts`, implementação em `src/adapters/indexeddb/sync-resolution-repository.ts`, composta junto do repositório principal em SyncProvider. Reutilizar um helper interno de validação/aplicação do commit IndexedDB, extraído somente no limite necessário; não duplicar o algoritmo de escrita nem fazer domínio Book importar DriveClient/OAuth. Usar a conexão/schema compartilhados; não criar novo objectStore.

### Assinatura concreta para handoff

Tipos de protocolo/hash puros podem ficar em `src/sync/protocol.ts` e ser reexportados por contracts.ts; nenhuma implementação de rede nesse arquivo. A porta importa somente tipos (Book/backup/media/protocolo), não cliente Drive.

```ts
type SyncCommitFence = {
  expectedRevision: LocalRevision;
  expectedAuthRevision: number;
  expectedBinding: Binding | null; // estado local capturado, inclusive conta anterior
  expectedOperation: { binding: Binding; version: LocalRevision; header: SnapshotHeader } | null;
  expectedPending: LocalRevision | null;
  leaseOwner: string;
};
type PreparedSyncCommit = {
  fence: SyncCommitFence;
  library: LibraryExport; // resultado já validado pelo serviço, nunca payload livre da UI
  media: CoverMedia[]; // blobs decodificados correspondentes ao LibraryExport
  recovery: SyncSnapshotV2; // estado local capturado antes da substituição
  effect:
    | { kind: 'resolution'; binding: Binding; snapshot: SyncSnapshotV2 }
    | { kind: 'receive'; binding: Binding; head: SnapshotHeader; comparisonHashV2: string };
};
interface SyncResolutionRepository {
  commit(input: PreparedSyncCommit, assertReady: () => void): Promise<LocalRevision>;
}
```

`resolution` grava operation `{binding, version: revisão resultante, snapshot}` + pending e base=null. `receive` aplica resultado, grava base com versão/hash wire/comparisonHashV2, reconhece a revisão resultante sem operação de upload e limpa somente pendência/operação autorizada do estado capturado. Ambos conferem por igualdade exata expectedOperation (binding, revisão e todos os campos do header) e expectedPending na transação. Para operação V1 substituída por decisão explícita, essa identidade exata faz parte da prévia, impedindo descarte de operação criada depois. Writers nunca alteram payload de uma operação conservando sua identidade: snapshots/operações persistidos são imutáveis. Pending não pode representar revisão diferente/posterior à biblioteca capturada; base/pending/operação são lidos coerentemente ao preparar os fences.

Preparação valida previamente library versus snapshot.library, hash/versão, blobs versus mídias e recuperação versus snapshot local capturado. A guarda síncrona efêmera `assertReady`, fornecida pelo coordenador e não pela UI, verifica cancelamento, coordenador encerrado, rascunho e aplicação de atualização PWA após o preparo, após a leitura da revisão antes do primeiro write e antes de finalizar a transação. Se falhar, aborta; não substitui os fences persistidos. Hash/decodificação ficam fora da transação; CAS da revisão (incluindo prefs) comprova que a recuperação ainda corresponde ao local. A transação revalida schemas/referências/orçamento e todos os fences antes dos writes. `receive` só aceita o mesmo binding ou a primeira vinculação segura; conta diferente exige `resolution` explícita. A porta devolve a revisão realmente gravada; notificações acontecem após commit pelo mecanismo existente. Serviço/coordenador revalida SESSION/head remoto antes de chamar a porta; a porta nunca faz rede e não alega transação distribuída.

Handoff UI independente do adaptador: `ResolutionPreview` expõe id técnico, contagens, lista paginável de livros/variantes com `sourceId`, decisões de ausência/exclusão, opções de preferência e erro de orçamento. `ResolutionChoices` contém `books: {bookId: bookIdLower, sourceId: string | null}[]`, `preferencesSourceId` e `includeUnbased: boolean`; `null` significa excluir; grupos idênticos/adições conhecidas são propostos pelo serviço. Confirmação recebe somente previewId+choices. Labels/números são projeção, jamais base de autoridade. Serviço rejeita sourceId/bookId desconhecido, decisão faltante/duplicada ou prévia vencida; UI não monta snapshots nem blobs.

Manter local ou usar Drive também passa pelo mesmo commit de resolução, para consistência de recuperação/operação/conta. Se não houver alteração efetiva do conteúdo, pode conservar revisão; operação recebe a revisão efetiva retornada. A cópia de recuperação descreve o estado imediatamente anterior desta resolução, não a versão já modificada.

Após commit, UI diz “Salvo neste dispositivo; envio pendente” e pode fechar/reabrir. Upload direto fora da transação, só depois de revalidar lease/controle. Edição posterior fica numa revisão nova; confirmação do upload antigo não apaga nova pending. Pausa/logout bloqueiam novas chamadas e confirmação local tardia; chamada já recebida pelo Drive pode terminar e é reconciliada depois.

Relistar após upload, antes de reconhecer base. Ponta nova não coberta reabre conflito, conservando resolução local e recuperação; não afirmar transação global. resolvedSnapshotIds nunca é construído de IDs desconhecidos nem só de duas pontas escolhidas na UI. Mudança de conta nunca reenvia operação antiga para conta nova: somente resolução explícita cria operação vinculada à nova conta, mantendo biblioteca/recuperação. Histórico remoto não é apagado automaticamente.

Recebimento automático de descendente também deve aplicar biblioteca+recuperação+base+ack em transação local condicionada, evitando janela de crash entre replace e accepted. Não cria upload só para confirmar download. Fingerprint de head é evidência de listagem, não garantia que nenhum outro dispositivo criará irmão depois.

## 6. Recebimento inicial e decisões automáticas

Definir instalação vazia segura: books=0, base=null, nenhuma operação/outbox pendente, mesma conta ou nenhum binding anterior, nenhuma edição/rascunho/importação em curso e revisão inicial sem conteúdo/preferência editada. Não tratar biblioteca esvaziada por exclusão/restauração como instalação nova. Preferência default salva em no-op não tira esse estado; preferência personalizada o tira. Essa definição conservadora evita que excluir todos os livros ressuscite o Drive automaticamente.

- Instalação vazia segura + exatamente uma ponta: baixar/validar a ponta V1/V2, conferir autorização opt-in, revalidar e aplicar automaticamente com recuperação/base/CAS. Mostrar “Biblioteca recebida do Drive”. Nenhum conflito obrigatório para vazio genuíno.
- Local não vazio + Drive vazio + sem base: enviar automaticamente depois da autorização explícita e vínculo permitido, como hoje.
- Ambos vazios: nenhum snapshot vazio obrigatório; estado conectado sem conteúdo enviado. Não prometer backup inexistente. Alteração só de preferência pode posteriormente produzir snapshot V2 válido conforme opt-in.
- Mais de uma ponta, conta alterada, ausência de história, vazio com histórico local ou prefs personalizadas: prévia/escolha, sem substituição automática.
- Uma ponta descendente de base conhecida e local completamente igual à base por digestV2 (incluindo prefs/capas) + sem rascunho: receber automaticamente. Local mudou e remoto na mesma base: enviar. Ambos mudaram: conflito explícito, mesmo que união pudesse ser mecanicamente feita.
- Mesma biblioteca completa entre local/remoto pode reconhecer equivalência sem upload; V1 exige download/validação/comparaçãoV2. Hash wire V1 igual nunca basta. Ainda conservar proteção de conta alterada.

## 7. UX mínima

Painel existente de conflito em Seus dados ganha Juntar bibliotecas; aviso global/Decidir depois continua. Prévia é uma tela/painel acessível, não uma pilha de modais com milhares de registros. Paginar/lazy render opções de livros; mostrar totais, decisões pendentes, preferências e orçamento, com botão confirmar desabilitado até decisões completas. Dados sensíveis são texto escapado, sem HTML recebido.

Oferecer exportar biblioteca local e cada versão Drive antes de substituir. Resolver/confirmação usa o ConfirmDialog e guard de edição/backup/PWA. Escape/Cancelar/Decidir depois não gravam biblioteca nem operação. Erro de rede/quota/mídia/corrida preserva tudo e mostra ação adequada. Após commit local com falha de upload, mostrar pendente e permitir retomada; nunca afirmar que a escolha foi desfeita se já houve commit.

O estado do topo distingue Salvo aqui, Recebendo, Enviando, Pendência, Conflito e confirmação real. Não abrir OAuth nem consentimentos novos como efeito da prévia. Não prometer sincronização com app fechado.

## 8. Gates obrigatórios

### Contratos e IndexedDB (fixtures sintéticas)

- Golden V1 hash/serialized bytes intactos; V2 order de books/media/chaves indiferente, prefs e cada campo/bytes afetam digest; casos UUIDmaiúsculo, órfãs, caps malformadas/limites/futureversion.
- Cross-version: hashV1igual+preferencesdiferentes NÃO equal; baseV1 hidratada por conteúdo validado; localprefs-only dispara pending/revisão e impede remote overwrite; lastExport/no-op não disparam.
- União IDs distintos; mesmoIDidêntico; registros divergentes; escolha em lote explícita; excluir/keep com base; sem base confirmação de ausências; três pontas, conta alterada, prefsdivergentes.
- Mesmo mediaId com bytes diferentes inclusive mesmo Book: distinção na prévia, cloneID/rewrite correto, referências compartilhadas, órfãs, limite excedido aborta sem perda. Resultado exporta/importa com bytes exatos.
- Confirmação invalida com livro/prefs/importação/conta/heads/authRevision alterados; pause/logout/lease perdido em cada await relevante; opções antigas não aplicam em nova prévia.
- Falha em cada write da transação resolução/download (incluindo quota) mantém livros/mídias/prefs/base/outbox/recuperação anteriores; sucesso grava todos juntos. Fechar após commit antesPOST, apósPOST antesPUT, apósPUT aceito/resposta perdida: retoma mesmaoperação, sem novoUUID indevido.
- V1pendente antesmigração nunca convertido; respostaPUTincerta reconciliada commesmosbytes/IDs; edição posterior mantém pending; V2 parent/resolution apontaV1 sem reescreverhistória; clienteV1 encontraV2 pelo nome antigo e falha fechado.
- Vazio novo recebe; vazio por excluir/importar ouprefseditadas não recebe silenciosamente; zero arquivos/zero livros não inventabackup; atualização remota chegaautomaticamente em contexto semedits.

### Navegador hermético e normal

- Fixture sintética com livros/notas/avaliações/prefs e PNG: Aenvia, Bvazio recebe semconflito; ambosalteram → préviaJuntar → escolhasinteiras → convergência e recuperaçãoexata.
- Casoslimite UI320px, teclado/foco, leitura/notalongas, cancelarsemalteração, rascunhobloqueia, offline CRUD/JSON intactos. PUTperdido/reload preserva IDs.
- Gate Google real com consentimento humano e QA isolada: repetir bootstrapvazio, divergência/união/prefs/capas e lostPUT. Snapshots sintéticos V1 já existentes QA504 podem ser reutilizados SOMENTE com allowlist técnica de operações conhecida; não deletar arquivos para forçar estado vazio e não baixar biblioteca pessoal. Uma conta/pasta realmente vazia pode ser necessária para o gate de primeiro envio; fixtureV1 existente serve ao gate migração/recebimento.
- Mesmo perfil A/B prova bancos separados, não sessões independentes. Manter gates pendentes de logout/revogação entre perfis do contrato de login sem fingir que esta fatia os substitui. Nenhum bypass Google/Playwright bloqueado.

## 9. Sequência e decisões

Após PR56 integrada: uma branch/PR da fatia #13. Primeiro protocol/hash+prefs+portatransacional com testes, depois serviço de prévia/união+UI, por fim gates. Mesma issue; não iniciar #47/#46. Atualizar docs/drive-sync/architecture/release-gate/privacidade apenas onde comportamento mudou. Flag pública permanece false até gates acordados.

Não há pergunta de produto indispensável. O controlador aprovou nome histórico estável para descoberta failclosed, porta específica de sync com helper de commit compartilhado e orçamento de fontes de 100 MiB. Este documento incorpora a revisão independente de aliases/casefold, igualdade completa de mídia, base=null e escopo real do orçamento. Contrato firme para handoff; mudanças nesses pontos exigem revisão de arquitetura, sem pedir consentimento de produto novamente. Nenhum merge por campo, CRDT, tombstone global, banco por conta ou limpeza histórica nesta fatia.
