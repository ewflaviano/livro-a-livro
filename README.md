# Livro a Livro

Um registro pessoal, privado e local-first da história dos livros que você lê.

A biblioteca fica no IndexedDB do navegador. Não há conta obrigatória; Google Drive é opcional e a transferência prevista é direta entre PWA e Drive. A API própria não recebe livros, notas, avaliações, backups ou capas.

## Estado atual

**Revisado em 1 out 2026.** O projeto tem uma base local funcional, Configurações e ajuda de instalação. O backup local tem fluxo independente. Os serviços opcionais seguem os gates de liberação abaixo; issue fechada ou módulo testado não significa recurso disponível de ponta a ponta.

| Recurso | Disponibilidade atual |
| --- | --- |
| Estante anual, busca local entre anos, Grade/Lista, filtros, ordenação e estatísticas | Integrados à interface; livros e preferências portáveis no IndexedDB, alcance da busca só na sessão |
| Cadastro manual, edição, exclusão, notas e avaliações | Integrados; livro em Lendo pode ser marcado como Lido no detalhe, com confirmação e commit local |
| Busca Open Library | Explícita, com capa pequena no resultado e dados da edição carregados ao escolher; revisão antes de salvar; indisponível no simulador local |
| Capas Open Library | Mesma capa na revisão, estante e detalhe; usa conexão e mostra fallback em ausência/erro/offline |
| Capas enviadas | Cadastro, estante e detalhe, inclusive offline; livro e capa gravados juntos, com limites portáveis |
| Backup JSON | Backup local em Seus dados, offline e sem Drive: exportação, prévia, confirmação e restauração atômica com capas |
| Catálogo CSV/Markdown | Downloads locais em Seus dados, offline e sem Drive: CSV para planilha e Markdown agrupado por estado de leitura; não restauráveis |
| Imagem anual | Gerador local existente; acesso pela estante removido enquanto a posição da ação é revista |
| PWA | App shell offline, atualização protegida e ajuda Instalar em Mais/Configurações; instalação não é backup |
| Configurações | Ano, Grade/Lista e filtro persistidos; versão/build, estado offline e verificação de atualização |
| Idioma PT/EN | Interface e políticas públicas bilíngues; escolha local em Configurações, disponível offline e fora do backup/Drive |
| Google Drive | Liberado no workflow público para teste manual do responsável, com login e autorização em duas etapas; gates entre perfis ainda pendentes na issue #13 |
| Experimentos e métricas | Consentimentos e módulos existem; consumo do catálogo, variantes e envio ainda não estão conectados à aplicação |

Veja a [auditoria de maturidade](docs/audit-2026-09-27.md) para evidências, riscos e ordem de correção. Exportação e restauração locais estão disponíveis; a validação do ciclo completo de instalação/atualização PWA permanece um gate separado. Não limpe o armazenamento de uma biblioteca real para testar recuperação.

## Começar a desenvolver

Pré-requisitos: Node.js 24 (versão do CI), npm, Git e Make. Para verificar a API, Rust estável com Cargo, rustfmt e Clippy. Não são necessárias contas Google ou AWS para o fluxo local.

```sh
npm ci
make dev
```

Abra `http://127.0.0.1:5173`. Para busca real na Open Library, use esse modo com dados de teste. A busca ocorre somente ao clicar Buscar ou pressionar Enter.

### Drive simulado, sem credenciais

```sh
make local
```

O comando inicia app e simulador em loopback (`5173` e `8788`), exibe uma faixa de teste e usa o banco separado `livro-a-livro-local`. Abra **Seus dados → Entrar com Google** e, ao voltar à tela, escolha **Autorizar Google Drive** em uma segunda ação. Open Library e capas externas ficam desativadas nesse modo. Somente dados descartáveis: o simulador não valida OAuth real.

- Outra porta: `LIVRO_LOCAL_APP_PORT=5174 make local`.
- Somente simulador: `make local-api`; porta configurável por `LIVRO_LOCAL_API_PORT`.
- Dois dispositivos: perfis de navegador separados acessando a mesma origem do app e o mesmo simulador.
- `make local-reset`, com simulador parado, remove apenas seus arquivos descartáveis; não limpa o IndexedDB.
- `make preview` compila e serve o build. Use para verificar o service worker; o servidor de desenvolvimento não reproduz o ciclo de PWA de produção.

`VITE_LOCAL_MODE` só funciona em desenvolvimento. O workflow usa `VITE_DRIVE_ENABLED=true` para o teste manual em produção autorizado pelo responsável, antes da entrada de usuários. Os [gates pendentes e a decisão de liberação](docs/drive-release-gate.md#liberação-para-teste-manual-do-responsável) continuam registrados; ativar a flag não os aprova. Para reproduzir o build público, use `VITE_DRIVE_ENABLED=true npm run build`. Variáveis `VITE_*` são públicas, nunca segredos.

## Verificar e contribuir

```sh
make check
```

Inclui testes TypeScript, simulador, tipos, build, formatação/Clippy e testes Rust. O [guia de contribuição](CONTRIBUTING.md) explica comandos por área, revisão, testes manuais e como investigar instabilidade da suíte.

## Documentação

- [Contribuir: ambiente, mapa do código e validação](CONTRIBUTING.md)
- [Auditoria: segurança, UI/UX e comparação com BioRotina](docs/audit-2026-09-27.md)
- [Arquitetura e fronteiras de dados](docs/architecture.md)
- [Design system](docs/design-system.md), [tokens](docs/tokens.css) e [catálogo conceitual](docs/design-system.html)
- [API OAuth](docs/auth-api.md), [sincronização](docs/drive-sync.md) e [experimentos](docs/experiments.md)
- [Publicação](docs/deployment.md), [sequência de entrega](docs/delivery-plan.md) e [roteiro original](docs/build-plan.md)
- [Apoiar ou sugerir melhorias](docs/support.md)

O catálogo visual e o roteiro são referências de intenção. A tabela de estado acima descreve a integração atual. Stack: React, TypeScript, Vite, IndexedDB e API opcional Rust/Axum.

### Limites de biblioteca e capas

Novas gravações aceitam até 100 capas locais, 2 MiB por imagem e 12 MiB de imagens no total. Livros, metadados, expansão base64 e uma reserva de envelope precisam caber no orçamento de 50 MiB do backup. Excesso preserva o rascunho e os dados anteriores. Troca/exclusão coleta somente capas sem referências; exportação usa uma única revisão e inclui apenas capas referenciadas.

As issues #37/#39 corrigem integridade e portabilidade para novos estados aceitos. Bibliotecas legadas excessivas continuam legíveis, sem limpeza automática; podem exigir substituição explícita por uma cópia válida. A issue #40 entrega a interface de backup local independente em Seus dados.

### Exportar e restaurar sem Google Drive

Em **Seus dados → Backup local**, use **Exportar JSON**. O aplicativo informa o início do download; confira se o arquivo foi salvo. Ele contém todos os anos, notas, avaliações, preferências e capas locais. Instalar a PWA não cria uma cópia desses dados.

Para restaurar, selecione **Importar JSON**, confira quantidades/anos do arquivo e da biblioteca atual, exporte a atual se quiser guardá-la e confirme a substituição integral. Até a confirmação, cancelar não altera nada. Arquivo inválido, versão incompatível, falta de espaço ou prévia vencida preservam a biblioteca. O fluxo funciona sem rede depois de o aplicativo e seus recursos estarem disponíveis no dispositivo.

### Baixar catálogo para consulta

Em **Seus dados → Exportar catálogo**, baixe um CSV de todos os anos para planilha ou um Markdown agrupado em Lidos, Lendo e Quero ler. O CSV contém título, autoria, ano da estante, estado, páginas e ISBN. O Markdown contém título, autoria, ano da estante e estado. Nenhum dos dois inclui notas, avaliações ou capas. Os arquivos são gerados somente neste dispositivo e podem ser baixados offline; o aplicativo não os envia a serviços externos. Antes de compartilhar o Markdown com um agente de IA escolhido por você, confira seu conteúdo e as regras de privacidade desse serviço. CSV e Markdown não podem ser restaurados aqui: **Exportar JSON** continua sendo a cópia completa para recuperação.

### Navegação e busca local

Em celular e tablet (abaixo de 1024 px), use Estante, Adicionar e Mais na barra inferior. Mais reúne Seus dados, Configurações, Instalar e Apoiar; no desktop, a lateral traz Estante, Seus dados e Configurações, e Adicionar livro fica junto ao título da estante. Lendo e Quero ler são filtros da estante. O campo de busca local filtra título, autoria e ISBN salvo sem conexão; o ISBN completo pode ser digitado com ou sem separadores. Com texto digitado, **Este ano** é o alcance inicial e **Todos os anos** procura na biblioteca inteira, identifica o ano de cada resultado e funciona mesmo quando o ano selecionado está vazio. A busca preserva filtro/modo/página e o contexto ao voltar de um livro; limpar o texto devolve a estante anual. Consulta e alcance ficam somente na memória da sessão, fora do backup/Drive. O botão compacto ao lado de Grade/Lista alterna entre adição mais recente (padrão) e título A–Z; a escolha fica apenas neste dispositivo e não entra no backup/Drive. Grade mobile tem duas colunas. A ação de compartilhar ano foi retirada da estante enquanto se decide um lugar adequado.

Configurações usa as mesmas preferências da estante. Em falha, informa que a escolha vale apenas na sessão e oferece tentar salvar novamente. Instalar mostra instruções por plataforma e botão somente quando o navegador oferece o evento nativo; aceitar o pedido ainda não confirma a conclusão. A primeira preparação offline não aparece como atualização. Atualizar exige uma versão aguardando, ausência de rascunho/operação e nenhuma outra aba aberta.
