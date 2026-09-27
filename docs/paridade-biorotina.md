# Paridade de experiência com o BioRotina

Decisão do usuário em 27 set 2026. Referência consultada: checkout do BioRotina
`f6fb6667f0c025a5bc02e7e6bde2960721a041aa`. Este documento define a correção
de direção; a tabela distingue comportamento existente de trabalho pendente.

O Livro a Livro deve repetir a mecânica de uso do BioRotina, com domínio de
livros e identidade visual própria. Esta decisão substitui a interpretação
anterior que usava o BioRotina principalmente como referência técnica e
documental. Login continua opcional; a biblioteca local funciona sem conta.

## Experiência esperada

| Fluxo | Referência e resultado esperado | Situação antes da correção |
| --- | --- | --- |
| Cabeçalho | Apoiar, conexão/estado do Drive e Configurações em todas as telas, inclusive celular | Conexão acessível apenas em Seus dados; Apoiar no rodapé/Mais |
| Login | Estado global restaurado ao abrir; primeiro identificar, depois convidar para autorizar Drive por outra ação | Provider global existente; identificação inicial dura dez minutos |
| Envio | Salvar localmente e sincronizar automaticamente enquanto o app está aberto | Coordenador já observa commits, abertura, foco, conexão e polling |
| Recebimento | Atualização remota chega ao navegador quando não há alteração local incompatível | Descendentes conhecidos já são aplicados automaticamente; biblioteca inicial vazia ainda apresenta conflito |
| Divergências | Juntar, manter navegador, usar Drive ou decidir depois, com explicação e recuperação | Escolha de biblioteca inteira; união ainda ausente |
| Privacidade | Convite inicial com escolhas explícitas, alteráveis em Configurações | Opções em Seus dados; consumidores runtime ainda pendentes |

Fontes funcionais no BioRotina: `src/components/Layout.tsx`,
`DrivePermissionPrompt.tsx`, `SyncConflictPrompt.tsx`, `GuestMergePrompt.tsx`,
`src/sync/DriveSyncContext.tsx`, `decision.ts`, `merge.ts` e
`src/analytics/AnalyticsConsentBanner.tsx`.

O merge consultado no BioRotina une registros por ID e conserva a versão
preferida inteira quando o mesmo ID diverge. Não é um merge por campo. No
Livro, a adaptação precisa explicitar livros divergentes, ausências/exclusões
e referências de capas antes do commit. Não copiar o algoritmo sem tratar
esses contratos, nem introduzir mesclagem automática silenciosa.

## Entrega sequencial

1. **Issue #13 — experiência global:** cabeçalho, comandos compartilhados e
   avisos em todas as rotas. Reutilizar o coordenador; manter a semântica de
   autenticação atual honestamente descrita até a próxima fatia. A flag de
   produção continua desligada durante os gates.
2. **Issue #13 — login persistente opcional:** aprovar e implementar contrato
   de sessão sem Drive. A identificação não concede acesso a arquivos;
   autorização do Drive continua em segundo clique. Restaurar a sessão ao
   abrir e manter estado em todas as telas. Não acrescentar perfil/e-mail
   apenas para preencher o cabeçalho.
3. **Issue #13 — sincronização e união:** adaptar o recebimento inicial e a
   resolução explícita de divergências, com prévia, cancelamento, cópia de
   recuperação, referências de mídias e proteção contra edição concorrente.
   Definir também a participação de preferências portáveis no hash antes de
   alterar o protocolo. Revalidar o fluxo real antes de liberar o Drive.
4. **Issue #47 — privacidade e runtime:** apresentar escolhas independentes
   de diagnósticos de erros e experimentos na entrada. Distinguir pendente,
   aceito e recusado; iniciar ambos desligados, permitir recusa e revisão
   posterior. Descrever apenas os dados enviados pelo runtime entregue.
5. **Issue #46 — gates finais:** cobrir a experiência corrigida nos testes de
   navegador e CI e registrar limites de validação de dispositivos reais.

Cada fatia terá PR próprio, revisão e integração antes da seguinte. OAuth,
protocolo de sincronização e experimentos exigem revisão de arquitetura SOL.

## Regras comuns de interface

- O estado no topo deve corresponder ao estado real: conexão não é confirmação
  de backup, e biblioteca salva localmente não significa envio confirmado.
- O convite do Drive pode aparecer após o retorno do login, mas só um clique
  explícito abre o consentimento Google. Oferecer Agora não.
- Erros e conflitos ficam visíveis globalmente, com acesso à resolução e
  possibilidade de decidir depois. Adiar não altera a biblioteca.
- Coordenar os convites de privacidade, Drive, instalação e conflito: apenas
  um diálogo ativo, sem interromper rascunhos ou operações de backup.
- Login, Drive, experimentos e diagnóstico são decisões distintas. Recusar
  qualquer serviço opcional não bloqueia cadastro, edição, leitura ou JSON.
- Preservar as cores, tipografia, marca, capas e navegação próprias do Livro.

## Fronteiras preservadas

IndexedDB continua sendo a fonte de verdade. Biblioteca, notas, avaliações,
capas e hashes de conteúdo trafegam diretamente entre PWA e Google Drive;
nunca pela API própria ou telemetria. Credenciais, recursos e cliente OAuth
do Livro permanecem exclusivos. Não trazer IA, notificações, módulos de saúde
ou coleta de dados do BioRotina como consequência da paridade de interface.

Sincronização automática depende do aplicativo em execução. Ao reabrir,
retomar pendências e conferir o Drive; não prometer execução com navegador
fechado.
