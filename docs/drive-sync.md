# Sincronização direta — issue #11

A biblioteca permanece local. Em produção, `sync/api.ts` só faz chamadas sem body às rotas fixas de sessão/OAuth. Access token e CSRF permanecem em memória. `sync/drive-client.ts` faz listagem paginada, download limitado e upload resumable exclusivamente em `https://www.googleapis.com/drive/v3/files` e `/upload/drive/v3/files`, com `credentials: omit`, redirects proibidos e `appDataFolder`. O callback é navegação completa gerenciada pela API; nenhum código/token passa pela URL da PWA.

Conectar é opt-in. O padrão compilado mantém o recurso indisponível até `VITE_DRIVE_ENABLED=true` depois da implantação/configuração da issue #13. Firebase não é necessário ao protocolo. A API de produção tem infraestrutura independente; credenciais não entram na PWA.

## Identificação e permissão em etapas

**Entrar com Google** cria login opcional que vale em todas as telas e pode ser restaurado ao reabrir. O aplicativo permanece pausado e não lista, baixa ou envia arquivos. **Autorizar Google Drive** é uma segunda ação explícita. O convite oferece **Agora não**, lembrado localmente para esse login, fora do backup/Drive; a ação do topo continua disponível. Renovação não reapresenta o convite; um novo login pode apresentá-lo.

A intenção temporária de autorização fica no controle local, com UUID, etapa e vínculo HMAC esperado, sem tokens/CSRF/URLs. O UUID acompanha o início no header `x-lal-attempt`. A sincronização só é habilitada após receber uma SESSION Drive completa da conta esperada e confirmar atomicamente a intenção atual. Pausa, cancelamento, logout ou nova tentativa invalidam intenção e lease; respostas atrasadas não reativam envios.

Cancelamento consulta a autorização atual, mas só cancela se o UUID for exatamente o capturado antes da pausa local. O servidor conserva uma tentativa durável para neutralizar callbacks concorrentes. Sair durante SignIn usa esse cancelamento mesmo sem LOGIN. Sair conectado usa DELETE login; falha de rede/recusa não é anunciada como saída confirmada. A sincronização fica pausada; após reload, GET login determina conectado, desconectado ou não verificado. Nunca reabilitar sync apenas por recuperar LOGIN.

O bootstrap/foco consulta login com deduplicação e renova perto do prazo, sem abrir OAuth automaticamente. Login usa 30 dias móveis/180 absolutos e não guarda refresh Google. SESSION Drive é separada. Após LOGIN válida, consultar SESSION apenas para apresentar capacidade não emite token nem acessa arquivos; 401 indica capacidade ausente e falha de rede deixa sua existência indeterminada. Sessões antigas sem LOGIN exigem reconexão, sem alterar biblioteca. Ver [contrato persistente](auth-login-persistente.md).

## Estado local e gates — 27 set 2026

O backup independente está disponível em Seus dados → Backup local (issue #40), com exportação/importação offline e sem Drive. A issue #42 unifica capas na revisão, estante e detalhe: mídias locais funcionam offline; capas externas usam conexão e fallback em ausência/erro. A habilitação do conector continua condicionada aos gates da API/OAuth.

A issue #37 corrige S1/S4 da [auditoria](audit-2026-09-27.md): snapshots recebidos validam os bytes de imagem antes da prévia, e a aplicação remota automática ou escolhida no conflito substitui livros, mídias, preferências, revisão e outbox numa única transação condicional. Exportações leem esses dados em um snapshot readonly coerente. A issue #39 unifica o orçamento de gravação/exportação/restauração (S2), com base64 e envelope incluídos, e limita snapshots às mídias referenciadas. Estados legados excessivos permanecem legíveis, sem garantia retroativa de exportação.

## Persistência e recuperação — protocolos V1/V2/V3

- Cada commit de biblioteca, inclusive mudança efetiva de ano/filtro, marca sua revisão pendente **na mesma transação IndexedDB**. Salvar o mesmo valor, atualizar lastExport ou mudar apenas Grade/Lista não altera a revisão de conteúdo. Modo é preferência local compartilhada entre abas do navegador, sem outbox ou envio ao Drive. Outbox nunca contém credenciais. Revisões posteriores não são apagadas pela confirmação de uma anterior.
- Novas operações usam `SyncSnapshot` V3 com backup V2, IDs de snapshot/operação, parent e IDs resolvidos. Seu hash canônico inclui livros, ano/filtro e capas referenciadas, excluindo o modo. O leitor mantém algoritmos e wire V1/V2 para snapshots e operações antigas; hash V1 não inclui preferências e não pode provar equivalência completa. Operação legada pendente preserva os bytes no retry. Não há criptografia ponta a ponta; o JSON no Drive contém notas/avaliações.
- Snapshots são imutáveis. A listagem contém metadados pequenos; resoluções precisam baixar e validar seu envelope. `operationId` durável reconcilia respostas perdidas antes de repetir upload. Sessões resumable não persistem: se interrompidas, nova tentativa reconcilia a operação e inicia outra sessão.
- Divergências oferecem Juntar bibliotecas, manter local, usar uma versão Drive ou decidir depois. Juntar cobre todas as pontas e inclui cada ID uma vez: o registro local inteiro prevalece; sem versão local, prevalece a primeira ponta na ordem canônica de UUID. IDs diferentes continuam separados. Ano/filtro locais são conservados na união; Grade/Lista atual deste navegador persiste em qualquer escolha. Uma única confirmação informa totais, divergências e que livros removidos em apenas um lado podem reaparecer. Sem seleção por livro, relógio vencedor ou merge por campo.
- A última biblioteca local substituída fica preservada em `syncState/recovery` para download. As versões remotas ficam preservadas, sem limpeza automática. O aplicativo limita listagem a 10.000 snapshots e cada backup a 50 MiB (+64 KiB para envelope); exceder exige intervenção, nunca apagamento.
- Apenas um coordenador por origem envia, com lease IndexedDB renovado a cada 10 s e validade de 45 s. Pausa/logout revogam o lease na mesma transação que desabilita o envio; o heartbeat apenas renova um lease existente. A confirmação atualiza a base, reconhece a revisão pendente e limpa a operação numa transação que verifica envio habilitado e posse do lease. Respostas antigas não reativam o envio. Escritas na biblioteca continuam condicionadas à revisão.
- Alteração de conta ou geração congela base/outbox antigos e pede escolha explícita. Pausar, logout e revogar não removem livros nem arquivos do Drive.
- Uma revogação não confirmada mantém aviso local persistente e bloqueia retomada automática, mesmo se a sessão antiga ainda for válida. A interface orienta verificar permissões Google e suporte. Somente uma confirmação de revogação ou a conclusão explícita de nova autorização Drive substitui esse aviso; a identificação inicial não o remove e uma sessão válida, isoladamente, não comprova revogação.

## Compatibilidade e união

O nome histórico `livro-a-livro-snapshot-v1.json` continua identificando os arquivos, inclusive V2. A versão real está em appProperties e no envelope, que devem coincidir. Isso permite ao cliente V1 descobrir V2 e interromper a sincronização por versão desconhecida, em vez de ignorar parte do histórico. Não renomear nem reescrever arquivos antigos.

Operação V1 pendente mantém objeto, ordem de serialização, hash e IDs. Reconciliar resposta incerta antes de criar V2; não reconstruir silenciosamente uma operação antiga. Comparação entre versões exige validar V1 com seu hash e depois calcular o digest V2. Uma base declarada mas não encontrada bloqueia decisão automática; base=null numa primeira conexão é um estado legítimo.

A prévia da união fica somente em memória. Limite agregado: 100 MiB das fontes materializadas (local, pontas e base, sem contar a mesma fonte duas vezes), além dos limites individuais. Esse limite não é um teto global de tráfego: reconstruir a linhagem também pode baixar envelopes históricos de resolução. Se a união exceder o orçamento, explicar o limite e manter opções de backup e biblioteca inteira; nunca ignorar uma ponta para caber.

Mídias são escolhidas pela mesma origem do livro. Colisão de mediaId com conteúdo diferente gera outro UUID e referências corrigidas; bytes e metadados são conservados. O resultado continua sujeito a 100 mídias, 2 MiB por mídia, 12 MiB agregados e 50 MiB por backup. Não baixar capas externas durante a união.

Confirmar relê conta/geração, revisão, autorização local e todas as pontas. Alteração invalida a prévia sem aplicar escolhas antigas. Resultado, capas, preferências, recuperação e operação de envio são gravados numa única transação IndexedDB; o upload ocorre depois. Falha de envio após o commit mantém a escolha salva e pendente. Recebimento automático também grava biblioteca, recuperação e base atomicamente. Ver [contrato completo e gates](sync-uniao.md).

Instalação realmente vazia, sem histórico, pendência ou preferência editada, pode receber uma única ponta automaticamente após autorizar Drive. Uma estante esvaziada por exclusão/importação, conta alterada, múltiplas pontas ou preferências personalizadas exige decisão. Duas bibliotecas vazias não produzem snapshot apenas para anunciar backup.

## Agendamento e falhas

Commits disparam debounce de 1,5 s com máximo de 10 s. Abertura, retorno de foco/visibilidade e reconexão retomam o trabalho; despertares próximos são limitados a uma consulta Drive por minuto quando há conexão. Uma página parada não consulta o Drive periodicamente. Mudanças feitas apenas em outro dispositivo aparecem ao voltar ao aplicativo ou após uma ação explícita de sincronização. Rede oculta/offline não inicia novos ciclos; uma requisição já em voo pode terminar. Retry exponencial com jitter respeita `Retry-After`, limitado a cinco tentativas por ciclo; reabrir/retomar permite outro ciclo. 401 renova token uma vez, quota e autorização exigem ação, conteúdo inválido não é aplicado. Uma falha nunca impede salvar localmente.

Rascunhos desta aba bloqueiam substituição automática; mudanças concorrentes em outra aba preservam o rascunho existente e impedem seu commit antigo pelas revisões do repositório. Não há Background Sync, sendBeacon, upload no service worker ou execução com navegador fechado. O mesmo cache público de app shell continua excluindo todos os endpoints autenticados.

## Modo de teste local

`make local` segue o fluxo de desenvolvimento do BioRotina, usando Node apenas como simulador. `local-client.ts` só existe em desenvolvimento com `VITE_LOCAL_MODE=true`, reescrevendo os dois hosts conhecidos para `http://127.0.0.1:8788`. A produção não admite essa variante nem um proxy de biblioteca.

O simulador escuta exclusivamente em loopback, recusa outros Host/Origin, não faz requests externas e persiste cópias descartáveis em `.local/livro-a-livro/drive-state.json`. A biblioteca de teste usa o banco `livro-a-livro-local`. Open Library/capas externas ficam desativadas nesse modo. Há faixa permanente de teste. A identidade e o token são sintéticos e não fornecem autenticação real; use só dados descartáveis.

Verificação: `npm test`, `npm run test:local`, `npm run typecheck`, `npm run build`. Testes exercitam biblioteca pendente, lease entre abas, alterações durante envio, resposta perdida, conflito/conta nova, rascunho, recuperação, limite de hosts e bodies vazios de auth. O simulador é verificado com rede externa proibida no processo servidor.

Referências: [pasta privada Drive](https://developers.google.com/workspace/drive/api/guides/appdata), [uploads resumable](https://developers.google.com/workspace/drive/api/guides/manage-uploads). Inspiração: `biodrive/src/sync/google.ts` e seu coordenador, sem copiar os dados de saúde nem os limites de seu schema.
