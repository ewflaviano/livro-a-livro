# Sincronização direta — issue #11

A biblioteca permanece local. Em produção, `sync/api.ts` só faz chamadas sem body às rotas fixas de sessão/OAuth. Access token e CSRF permanecem em memória. `sync/drive-client.ts` faz listagem paginada, download limitado e upload resumable exclusivamente em `https://www.googleapis.com/drive/v3/files` e `/upload/drive/v3/files`, com `credentials: omit`, redirects proibidos e `appDataFolder`. O callback é navegação completa gerenciada pela API; nenhum código/token passa pela URL da PWA.

Conectar é opt-in. O padrão compilado mantém o recurso indisponível até `VITE_DRIVE_ENABLED=true` depois da implantação/configuração da issue #13. Firebase não é necessário ao protocolo. Não há configuração de infraestrutura nem credenciais nesta entrega.

## Pendências conhecidas — 27 set 2026

O conector não substitui o backup independente: o download da tela Dados depende de sua disponibilidade/estado, e a interface de exportação/importação sem Drive ainda não foi ligada ao serviço. As capas externas não são desenhadas na estante/detalhe.

A issue #37 corrige S1/S4 da [auditoria](audit-2026-09-27.md): snapshots recebidos validam os bytes de imagem antes da prévia, e a aplicação remota automática ou escolhida no conflito substitui livros, mídias, preferências, revisão e outbox numa única transação condicional. Exportações leem esses dados em um snapshot readonly coerente. A divergência de limites de gravação/exportação/restauração (S2) ainda precisa ser corrigida antes de habilitar produção.

## Persistência e recuperação

- Cada commit de biblioteca marca sua revisão pendente **na mesma transação IndexedDB**. Outbox nunca contém credenciais. Revisões posteriores não são apagadas pela confirmação de uma anterior.
- `SyncSnapshot` V1 carrega backup V1, IDs de snapshot/operação, parent, hash canônico dos livros e IDs resolvidos. O hash e o envelope ficam só em IndexedDB e Drive. Não há criptografia ponta a ponta implementada; o JSON no Drive contém notas/avaliações.
- Snapshots são imutáveis. A listagem contém metadados pequenos; resoluções precisam baixar e validar seu envelope. `operationId` durável reconcilia respostas perdidas antes de repetir upload. Sessões resumable não persistem: se interrompidas, nova tentativa reconcilia a operação e inicia outra sessão.
- Sem escolher por relógio, duas pontas diferentes exigem escolha explícita. A tela Dados mostra quantidades/datas, baixa cada versão e confirma qual biblioteca inteira usar. Sem união por ID, para não ressuscitar exclusões. Pontas e revisão local são relidas antes de aplicar.
- A última biblioteca local substituída fica preservada em `syncState/recovery` para download. As versões remotas ficam preservadas, sem limpeza automática. O aplicativo limita listagem a 10.000 snapshots e cada backup a 50 MiB (+64 KiB para envelope); exceder exige intervenção, nunca apagamento.
- Apenas um coordenador por origem envia, com lease IndexedDB renovado a cada 10 s e validade de 45 s. Antes de efeitos confirma o lease/estado habilitado; respostas tardias resultam em reconciliação/conflito. Escritas na biblioteca continuam condicionadas à revisão.
- Alteração de conta ou geração congela base/outbox antigos e pede escolha explícita. Pausar, logout e revogar não removem livros nem arquivos do Drive.

## Agendamento e falhas

Commits disparam debounce de 1,5 s com máximo de 10 s, abertura/foco/retomada e online retomam o trabalho, e polling visível usa 60–70 s. Rede oculta/offline não inicia novos ciclos; uma requisição já em voo pode terminar. Retry exponencial com jitter respeita `Retry-After`, limitado a cinco tentativas por ciclo; reabrir/retomar permite outro ciclo. 401 renova token uma vez, quota e autorização exigem ação, conteúdo inválido não é aplicado. Uma falha nunca impede salvar localmente.

Rascunhos desta aba bloqueiam substituição automática; mudanças concorrentes em outra aba preservam o rascunho existente e impedem seu commit antigo pelas revisões do repositório. Não há Background Sync, sendBeacon, upload no service worker ou execução com navegador fechado. O mesmo cache público de app shell continua excluindo todos os endpoints autenticados.

## Modo de teste local

`make local` segue o fluxo de desenvolvimento do BioRotina, usando Node apenas como simulador. `local-client.ts` só existe em desenvolvimento com `VITE_LOCAL_MODE=true`, reescrevendo os dois hosts conhecidos para `http://127.0.0.1:8788`. A produção não admite essa variante nem um proxy de biblioteca.

O simulador escuta exclusivamente em loopback, recusa outros Host/Origin, não faz requests externas e persiste cópias descartáveis em `.local/livro-a-livro/drive-state.json`. A biblioteca de teste usa o banco `livro-a-livro-local`. Open Library/capas externas ficam desativadas nesse modo. Há faixa permanente de teste. A identidade e o token são sintéticos e não fornecem autenticação real; use só dados descartáveis.

Verificação: `npm test`, `npm run test:local`, `npm run typecheck`, `npm run build`. Testes exercitam biblioteca pendente, lease entre abas, alterações durante envio, resposta perdida, conflito/conta nova, rascunho, recuperação, limite de hosts e bodies vazios de auth. O simulador é verificado com rede externa proibida no processo servidor.

Referências: [pasta privada Drive](https://developers.google.com/workspace/drive/api/guides/appdata), [uploads resumable](https://developers.google.com/workspace/drive/api/guides/manage-uploads). Inspiração: `biodrive/src/sync/google.ts` e seu coordenador, sem copiar os dados de saúde nem os limites de seu schema.
