# Livro a Livro · Design system

**Versão 1.0 · 26 set 2026 · Português do Brasil · Tema claro**

Uma estante pessoal para guardar a história dos livros que você lê.

Este guia define a primeira direção visual do Livro a Livro. Os [tokens CSS](tokens.css) são a fonte dos valores; o [catálogo visual](design-system.html) mostra fundamentos, estados e composições conceituais. Abra o HTML diretamente no navegador: não precisa de servidor, fontes remotas, bibliotecas, rede ou instalação. Controles de produto são amostras visuais; não há busca real, persistência ou exportação no catálogo. Títulos e autores reais aparecem com capas tipográficas ilustrativas, não com capas oficiais; notas e registros são fictícios.

## 1. Escopo e princípios

O Livro a Livro é privado, local-first, sem conta obrigatória e sem componente social. A V1 reúne **Quero ler, Lendo e Lido**, estante anual em Grade/Lista, cadastro por busca ou manual, página do livro, avaliação e nota privadas, estatísticas mínimas, exportação/importação JSON e imagem anual em Story/Quadrado. A arquitetura posterior inclui Google Drive opcional; seu cliente e simulador existem, mas a habilitação de produção depende dos gates da API. Consulte o [estado atual](../README.md#estado-atual); o catálogo visual continua conceitual. Não introduzir feed, metas, sequências de dias, recomendações, IA, comentários, seguidores ou rankings.

1. **O livro é o centro.** Capa, título e autoria têm precedência. A interface organiza a estante e depois sai do caminho.
2. **Calma com precisão.** Muito espaço em torno do conteúdo, pouco ornamento e rótulos que descrevem o efeito de cada ação.
3. **Memória sem cobrança.** Um livro lido e um ano vazio são igualmente legítimos. Contar registros, sem avaliar o ritmo de leitura.
4. **O privado é o padrão.** Avaliação e nota permanecem pessoais. Compartilhamento começa por uma prévia explícita, nunca por publicação automática.
5. **Local não significa cópia de segurança.** Comunicar onde os registros estão, o que foi salvo e o que uma exportação realmente confirma.
6. **O básico independe de catálogo externo.** A entrada manual continua disponível quando não há rede, capa ou resultado de busca.

O BioRotina é a referência funcional para conexão global, sincronização, resolução de divergências e escolhas iniciais de privacidade. A [correção de direção de 27 set 2026](paridade-biorotina.md) define a entrega sequencial dessas equivalências. Esta identidade usa linguagem editorial, serifas, tinta ameixa e marcador amarelo próprios. Os estados históricos abaixo não substituem essa decisão nem afirmam que toda a correção já foi entregue.

## 2. Identidade e tom de voz

**Nome:** Livro a Livro, sempre com esses espaços e caixa. Identificador técnico: `livro-a-livro`. Assinatura: **Uma leitura de cada vez.** Usar a assinatura apenas em abertura, apresentação e composição anual; não repeti-la em cada painel.

**Marca:** nome em Georgia regular, com duas lombadas verticais de alturas diferentes e uma terceira em forma de marcador. O símbolo é geométrico; pode usar o detalhe amarelo do marcador sobre fundo ameixa. Uma versão vetorial futura deve preservar essas formas; não é um ícone de rede ou um selo de conquista. Tamanho mínimo do símbolo: 24 px, respiro mínimo de 8 px. Para identificação pequena, priorizar nome legível em vez de comprimir o conjunto. Não usar textura de papel envelhecido, couro, estante de madeira, sombras dramáticas ou dourado.

**Voz:** íntima sem intimidade forçada; direta, serena e concreta. Usar “você” quando ajudar, sem nome de usuário ou saudação obrigatória. Botões em frase: “Adicionar livro”, “Salvar alterações”, “Exportar JSON”. Datas em pt-BR e mensagens sem exclamação automática.

| Situação | Usar | Evitar |
| --- | --- | --- |
| Estante vazia | “Sua estante de 2026 começa aqui.” | “Você ainda não leu nada!” |
| Salvamento confirmado | “Livro salvo neste dispositivo.” | “Tudo seguro para sempre.” |
| Sem rede | “A busca precisa de conexão. Você pode cadastrar manualmente.” | “Você está offline. Tente mais tarde.” |
| Erro de campo | “Informe o título do livro.” | “Campo inválido.” |
| Exportação | “Arquivo JSON gerado. Confira se ele foi salvo.” | “Backup garantido.” |
| Nota | “Sua nota privada” | “Escreva uma resenha para a comunidade.” |
| Ano concluído | “6 livros lidos em 2026.” | “Meta batida. Você venceu!” |

## 3. Cor: papel, tinta e marcador

A base é quase branca; ameixa identifica ações; amarelo marca uma passagem visual. Capas podem adicionar variedade, sem definir o estado de leitura. Priorizar cerca de 80% superfícies claras, 15% texto/capas e 5% acentos; é uma direção de composição, não uma cota.

### Paleta de origem

| Família | Tokens primitivos e valores |
| --- | --- |
| Papel | `--paper-0 #ffffff`, `--paper-50 #faf9f6`, `--paper-100 #f1eee8`, `--paper-200 #e1dcd3`, `--paper-300 #c9c1b6` |
| Tinta | `--ink-500 #786f77`, `--ink-600 #655c65`, `--ink-700 #4d444f`, `--ink-900 #29232d` |
| Ameixa | `--plum-50 #f1edf4`, `--plum-100 #e7deec`, `--plum-300 #c2afce`, `--plum-600 #745980`, `--plum-700 #60456e`, `--plum-800 #4d355a`, `--plum-900 #3d2848` |
| Marcador | `--citron-100 #f5efbc`, `--citron-300 #dfd580`, `--citron-800 #605511` |
| Informação | `--blue-50 #eaf0f7`, `--blue-700 #365a7b`, `--blue-800 #244c85` |
| Confirmação | `--sage-50 #eaf0eb`, `--sage-700 #385c46` |
| Atenção | `--amber-50 #faf0dd`, `--amber-700 #795017` |
| Erro | `--red-50 #faeeeb`, `--red-700 #943e36`, `--red-800 #78302a`, `--red-900 #62241f` |
| Capas de exemplo | `--clay-200 #e7c4b2`, `--slate-200 #c4d4de`, `--sage-200 #c7d5c5` |

### Contrato semântico

| Papel | Tokens | Regra |
| --- | --- | --- |
| Fundo e camadas | `--color-canvas`, `--color-surface`, `--color-surface-subtle`, `--color-surface-brand` | Página, formulário, faixa neutra, destaque de marca |
| Leitura | `--color-text`, `--color-text-secondary`, `--color-text-inverse` | Títulos/corpo, metadados, texto em fundo escuro |
| Ação | `--color-action`, `--color-action-hover`, `--color-action-pressed`, `--color-text-on-action` | Botão principal com texto claro |
| Link | `--color-link`, `--color-link-hover` | Sublinhado no texto corrido, nunca só cor |
| Separação | `--color-border`, `--color-border-strong` | A primeira é decorativa; campos e contornos essenciais usam a segunda |
| Foco | `--color-focus`, `--color-focus-gap` | Anel de 3 px com intervalo claro de 3 px |
| Seleção | `--color-selected-bg`, `--color-selected-text` | Sempre junto a marca, rótulo ou estado programático |
| Marcador | `--color-accent`, `--color-accent-soft`, `--color-on-accent` | Detalhe editorial; não é ação nem alerta |
| Feedback | `--color-info/success/warning/danger` e respectivos `-soft` | Texto/ícone forte sobre fundo claro correspondente |
| Leitura | `--color-status-want/reading/read` e respectivos `-bg` | “Quero ler”, “Lendo” e “Lido” escritos por extenso |
| Dados | `--color-local`, `--color-local-bg`, `--color-backup`, `--color-backup-bg` | Local e cópia são informações distintas |
| Indisponível | `--color-disabled-bg/text/border` | Sem reduzir opacidade do componente inteiro |

Contraste deve ser medido sobre cada par real. Texto comum ≥ 4,5:1; texto grande e contornos essenciais ≥ 3:1. Nunca colocar texto branco sobre o amarelo. Valores medidos nesta versão: texto/papel 14,53:1; ação/branco 8,16:1; texto secundário/papel 6,10:1; contorno forte/branco 4,84:1. Os pares de feedback sobre seus fundos claros superam 6:1. Tons de capa não expressam sucesso/erro. Tema escuro está fora desta entrega; não usar inversão automática.

## 4. Tipografia

Duas vozes complementares, ambas locais: **Georgia** para títulos editoriais e **system-ui** para leitura, controles e números. Fallback editorial: Times New Roman/serif. Fallback de interface: fontes nativas Apple/Segoe UI/sans-serif. Não há download de fontes nem promessa de métricas idênticas entre sistemas. Revisar quebras em cada plataforma; não travar altura de títulos.

| Estilo | Tamanho | Peso / entrelinha | Uso |
| --- | --- | --- | --- |
| Display | 44–84 px, fluido | Georgia 400 / 1,08 | Abertura do catálogo e imagem anual |
| H1 | 32–48 px, fluido | Georgia 400 / 1,2 | Estante e página do livro |
| H2 | 28–36 px, fluido | Georgia 400 / 1,2 | Seção editorial |
| H3 | 22 px | Georgia 400 / 1,2 | Subseção |
| Introdução | 18 px | UI 400 / 1,6 | Apresentação breve |
| Corpo/campos | 16 px | UI 400 / 1,6 | Informação principal e entrada |
| Apoio/ações | 14 px | UI 400 ou 600 / 1,4 | Autor, ajuda e controles |
| Legenda | 12 px | UI 400 ou 600 / 1,4 | Referência auxiliar, nunca único rótulo essencial |
| Métrica | 32 px | UI 500 / 1,2 | Contagem com algarismos tabulares |

Usar `rem`, largura de leitura até 42 rem, alinhamento à esquerda e espaçamento de título de −0,035 em. Não justificar texto. Caixa alta só em pequenas etiquetas de seção, com 0,12 em de espaçamento. Notas privadas mantêm texto normal, não itálico obrigatório. Nenhum título ou autor depende de tooltip para ser lido; títulos longos quebram e aumentam a linha.

## 5. Espaçamento, forma e composição

Escala de 4 px: `--space-0/1/2/3/4/5/6/8/10/12/16/20/24` = 0/4/8/12/16/20/24/32/40/48/64/80/96 px. Ícone + rótulo: 8 px. Rótulo + campo: 8 px. Campos: 16–24 px. Painéis: 24–32 px internos. Seções: 64–96 px desktop, 40–64 px mobile.

- Área útil máxima de 1200 px; margens fluidas entre 16 e 48 px. Formulário até 576 px e texto longo até 672 px.
- Desktop, a partir de 1024 px: cabeçalho horizontal, grade de 4–6 livros conforme área real. Tablet, 640–1023 px: 3–4 livros. Mobile, abaixo de 640 px: 2 livros; lista sempre em uma coluna. A grade usa colunas flexíveis e não uma largura fixa de capa.
- Capa: proporção 2:3; preservar capa real inteira com `object-fit: contain`. Cor de fundo neutra absorve proporções diferentes. Sem capa: composição tipográfica marcada “Sem capa”, com título e autor completos ao lado/abaixo.
- Raios: 2 px capa; 6 px controle; 10 px cartão; 16 px painel. Pílula só para estado curto. A estante usa espaço em branco e uma linha de apoio, não uma caixa com sombra por livro.
- Borda antes de sombra. `--shadow-cover` apenas nas capas, `--shadow-popover` em flutuantes e `--shadow-dialog` em modal. Não empilhar elevações.
- Camadas: base 0, sticky 10, popover 20, dialog 30, toast 40. Elementos fixos respeitam áreas seguras e nunca encobrem foco/ações; a barra inferior mobile respeita a área segura e reserva espaço no conteúdo.

## 6. Ícones e imagens

Ícones lineares em grade 24 × 24, traço de 1,75 px, pontas e junções arredondadas. Tamanhos de 16 px em metadados, 20 px em botões e 24 px em estados. A implementação deve usar um único conjunto de ícones, podendo mapear para o conjunto já previsto no repositório, preservando consistência. Símbolo de marca permanece próprio.

| Conceito | Forma | Rótulo |
| --- | --- | --- |
| Livro/estante | Livro fechado ou lombadas | Estante |
| Adicionar | Sinal de mais | Adicionar livro |
| Buscar | Lupa | Buscar |
| Visualização | Quatro células / linhas | Grade / Lista |
| Quero ler | Marcador | Quero ler |
| Lendo | Livro aberto | Lendo |
| Lido | Marca de verificação | Lido |
| Dados locais | Dispositivo | Neste dispositivo |
| Cópia/restauração | Seta para baixo / cima | Exportar JSON / Importar JSON |
| Privacidade | Cadeado | Privado |
| Compartilhar | Seta saindo de caixa | Compartilhar ano |

Ícones decorativos recebem `aria-hidden="true"`. Ações principais têm texto visível. Ações só com ícone exigem nome acessível e alvo mínimo de 44 × 44 px. Capas adjacentes ao título têm `alt=""`; quando forem o único conteúdo de um link, o link recebe título e autor no nome acessível. Não usar imagens remotas no catálogo. Não imitar capas oficiais com ilustração gerada.

## 7. Componentes e estados

### Botões e links

Primário em ameixa, secundário em superfície branca com contorno forte, discreto sem fundo e perigoso em vermelho. Uma ação principal por região. Altura 48 px, alvo mínimo de 44 px, texto 14–16 px, raio 6 px, espaço horizontal 16–20 px. `hover` escurece; `active` usa pressed; `focus-visible` adiciona anel de 3 px sem deslocar layout. Links no texto são sublinhados.

Carregando: preservar largura, exibir verbo em andamento (“Salvando…”), `aria-busy` na região, evitar envio duplicado. Indisponível: `disabled` quando apropriado e motivo visível próximo; se a explicação precisar de foco, usar `aria-disabled` com bloqueio real da ação. Não deixar controle parecer ativo sem comportamento no produto. O catálogo identifica suas amostras inertes expressamente.

### Campos, seleção e avaliação

Rótulo persistente, controle de 48 px, ajuda e erro próximos. Campos essenciais têm “obrigatório” por escrito; opcionais usam “opcional”. Placeholder só dá exemplo. Campo em erro usa contorno vermelho, `aria-invalid` e mensagem vinculada por `aria-describedby`; preservar o que foi digitado e levar o foco ao primeiro erro após envio. Sem validação agressiva a cada tecla.

Usar `select` nativo para ano e estado. Grade/Lista é um grupo de botões com `aria-pressed`, não abas sem painéis. Filtros podem ser botões de seleção com rótulo e contagem; trocar filtro não altera estatísticas anuais. Avaliação usa um `fieldset` com rádios de 1 a 5, rótulos “1 de 5” … “5 de 5” e opção “Sem avaliação”. Estrelas são complemento visual; zero não é sinônimo de não avaliado. Não exigir avaliação nem nota para marcar como Lido.

### Status e feedback

Estado de leitura é um badge com ícone e texto, não um botão se não houver ação. Avisos de sistema usam título, explicação e próximo passo. Sucesso em `role="status"` apenas quando ocorrer, erro de envio em região anunciada; não colocar todas as amostras estáticas em regiões vivas. Não anunciar cada tecla de busca. Carregamento usa texto e espaço reservado, sem cintilação. Erro de armazenamento: “Não foi possível salvar. Seu texto continua aqui. Tente novamente.” Nunca mostrar sucesso antes da confirmação de persistência.

### Confirmação e retorno

Exclusão de um livro pede “Excluir [título] desta estante?” e explica que registro, avaliação e nota serão removidos deste dispositivo. Cancelar vem antes de Excluir. Importação que substitui dados sempre exige resumo e confirmação específica. No produto, usar `dialog` nativo ou equivalente acessível: título, foco inicial seguro, foco contido, Escape para cancelar e retorno ao acionador. Demonstrações estáticas de confirmação devem usar painéis identificados como amostra, não janelas modais ativas.

## 8. Estante anual: Grade e Lista

Ordem: marca e “Seus dados”; título “Estante 2026”; explicação curta; seletor de ano e “Adicionar livro”; estatísticas; filtro de estado e Grade/Lista; coleção; estado local discreto. “Compartilhar ano” tem ênfase secundária. Em mobile, título/ano e CTA se reorganizam, filtros quebram linha e Grade/Lista mantém rótulos.

**Convenção proposta para V1:** cada registro pertence a um ano de estante escolhido pela pessoa, com padrão no ano selecionado. O mesmo título pode existir em outro ano como registro independente, sem automatizar releitura. Todos os estados usam esse mesmo ano. “Lidos em 2026” conta registros Lido na estante de 2026, não a data em que foram cadastrados. Se uma data de término for de outro ano, oferecer corrigir o ano antes de salvar; não mover silenciosamente. O ano é explícito no cadastro/página e permanece editável. Essa convenção deve ser confirmada na implementação, sem inferir retrospectivamente datas que a pessoa não informou.

**Grade:** capa, título, autor, estado. Avaliação pode ficar na página do livro, evitando ruído. Livro inteiro pode ser um único link; não aninhar botões dentro dele. **Lista:** capa de 48–64 px, título/autor, estado e avaliação; em mobile, metadados descem abaixo do título. Mesmos registros, ordem e filtros nos dois modos. Ordenação inicial: adição mais recente, sem novo controle de ordenação obrigatório. Voltar de um livro preserva ano, filtro, modo e posição.

**Estados:** primeiro uso (“Sua estante de 2026 começa aqui.” + Adicionar livro); ano vazio (oferecer mudar ano ou adicionar); filtro vazio (“Nenhum livro em Lendo nesta estante.” + Limpar filtro); carregando registros (placeholder estático + “Abrindo sua estante…”); falha local (explicar e oferecer tentar novamente/importar, sem sobrescrever dados); capa indisponível (fallback tipográfico, sem bloquear livro). Não exibir uma prateleira vazia como falha de rede: dados locais funcionam sem busca.

## 9. Busca e cadastro manual

“Adicionar livro” abre uma região com duas rotas visíveis: **Buscar livro** e **Cadastrar manualmente**. Busca tem rótulo “Título, autor ou ISBN”, botão Buscar e nota “A busca consulta a Open Library. Sua nota e avaliação não são enviadas.” A consulta é explícita: não mandar texto a um serviço só por digitar. Resultados mostram título, autor, capa se existir e dados bibliográficos disponíveis, com origem “Open Library”. A fonte enriquece o registro; não é a biblioteca pessoal nem garante completude.

Selecionar resultado abre revisão editável antes de salvar, sem adicionar automaticamente. Não inventar autoria, páginas, edição ou ano ausentes. Distinguir ano de publicação de ano da estante. ISBN e detalhes editoriais são opcionais; não obrigar a escolher uma edição inexistente. A integração futura deverá respeitar a [documentação de busca da Open Library](https://openlibrary.org/dev/docs/api/search).

| Estado de busca | Conteúdo e saída |
| --- | --- |
| Inicial | Campo vazio, ajuda e rota manual |
| Buscando | “Buscando na Open Library…”; manter consulta; bloquear envio duplicado |
| Resultados | Lista com botão “Usar este livro”; revisão antes de salvar |
| Nenhum resultado | “Não encontramos este livro. Tente outro título ou cadastre manualmente.” |
| Sem conexão | “A busca precisa de conexão. Você pode cadastrar manualmente.” |
| Erro/limite do serviço | “A busca está indisponível agora.” + Tentar novamente e Cadastrar manualmente |

Cadastro mínimo: título obrigatório; autor opcional (“Autoria não informada” quando ausente); estado obrigatório, inicialmente Quero ler; ano da estante obrigatório, preenchido pelo contexto. Data de término opcional aparece em Lido, com ajuda para manter coerência com o ano. Não exigir sinopse, gênero, páginas, ISBN ou capa. Avisar sobre provável duplicata (título/autor/ano), permitindo revisar ou salvar conscientemente; nunca bloquear homônimos. “Salvar livro” só confirma depois de salvar no dispositivo. Cancelar preserva contexto e pede confirmação se houver texto não salvo.

## 10. Página do livro

Voltar para Estante 2026; capa, título sem corte, autor e ano da estante; estado editável; avaliação opcional; campo “Sua nota privada”; Salvar alterações e ação de exclusão secundária. Desktop pode usar capa à esquerda e conteúdo à direita; mobile empilha. Nota tem largura de leitura confortável e cresce com o conteúdo. Rótulo “Sua nota é privada e acompanha o backup. Não entra na imagem compartilhada.” deve acompanhar a nota, sem alegar criptografia.

Datas, quando informadas, usam “26 set 2026”; datas exatas ficam disponíveis, sem depender de “ontem”. Estado Salvo / Alterações não salvas / Salvando / Falha ao salvar deve ser literal. Nota e avaliação não são resenha pública. Não há perfil, curtidas, comentários ou botão de publicar.

## 11. Estatísticas mínimas

Três estatísticas do ano: **Livros**, **Páginas** e **Autores**. Elas descrevem somente os registros com estado Lido na estante selecionada: Livros é a quantidade de registros lidos; Páginas é a soma das páginas informadas nesses livros; Autores é a quantidade de autores distintos desses mesmos livros. Os filtros Lidos, Lendo e Quero ler ficam logo abaixo e não alteram as estatísticas — são apenas uma forma de visualizar a estante. Exemplo: **20 livros · 5.842 páginas · 14 autores**. Mostrar 0 quando não houver livros lidos; não estimar páginas ou autoria ausentes. Usar números pt-BR e rótulos completos para leitores de tela, como “20 livros lidos em 2026”. Sem metas, taxas, comparação entre anos ou percentuais de sucesso. Preferir texto e números a gráficos sem necessidade.

## 12. Compartilhamento anual

Ação voluntária “Compartilhar ano”, seguida por prévia e formatos **Story (1080 × 1920, 9:16)** / **Quadrado (1080 × 1080, 1:1)**. Arquivo proposto: `livro-a-livro-2026-story.png` ou `livro-a-livro-2026-quadrado.png`. Conteúdo padrão: ano, contagem de livros Lido, mosaico de até seis capas e marca discreta. Se houver mais, mostrar “+ N livros” e não diminuir todas as capas até ficarem ilegíveis. Sem Lidos, explicar que a imagem fica disponível após marcar um livro como Lido.

Texto explícito antes de gerar: “A imagem inclui o ano, livros lidos, páginas informadas, autores distintos e, se você permitir, títulos em capas tipográficas. Não inclui suas notas nem avaliações.” Sem nome, conta, link de perfil, QR pessoal ou identificador do dispositivo. Prévia permite conferir o conteúdo antes do download; não faz upload nem abre publicação automática. A implementação da issue #9 oferece Canvas local e PNG nos dois formatos, opção de retirar títulos e descrição textual copiável. Nesta etapa as capas são sempre tipográficas, sem carregamento remoto: raster/cache de capas reais permanece uma evolução separada. As composições do catálogo são amostras reduzidas das proporções, não a prévia do arquivo gerado.

Margem segura de 8% nas laterais, 12% no topo/rodapé do Story e 8% no Quadrado. Preservar ano e contagem; não colocar informação essencial perto das áreas de controles das plataformas. Conferir a imagem em tamanho real antes de exportar. Exportar imagem não é exportar backup JSON.

## 13. Privacidade, armazenamento e cópia

“Seus dados” tem acesso estável em Mais no mobile e na lateral do desktop. Mensagem base: **“Seus livros ficam neste dispositivo, neste navegador. Limpar os dados do navegador ou trocar de dispositivo pode remover sua estante. Exporte uma cópia JSON para guardar seus registros.”** Instalar a PWA não cria backup. A V1 não pede login e não envia notas/avaliações à Open Library. Consultas e carregamento de capas externas usam rede; explicar esse limite sem chamar o app inteiro de “100% offline” ou “sem qualquer envio de dados”.

| Situação | Mensagem | Próxima ação |
| --- | --- | --- |
| Local confirmado | “Salvo neste dispositivo” | Seus dados |
| Ainda sem exportação | “Você ainda não exportou uma cópia.” | Exportar JSON |
| Exportando | “Preparando arquivo JSON…” | Aguardar, sem envios repetidos |
| Download iniciado | “Arquivo JSON gerado. Confira se ele foi salvo.” | Conferir downloads |
| Histórico observado | “Última exportação iniciada em 26 set 2026, 14:30.” | Exportar novamente |
| Erro de exportação | “Não foi possível gerar o arquivo. Seus registros continuam aqui.” | Tentar novamente |
| Armazenamento falhou | “Não foi possível salvar neste dispositivo.” | Preservar edição e tentar novamente |

Não afirmar “backup concluído” quando só foi possível observar o início do download. Não usar selo verde de sincronização para estado local. JSON contém notas e avaliações privadas; dizer “Guarde o arquivo em um lugar de confiança.” Nome proposto: `livro-a-livro-2026-09-26.json`, incluindo todos os anos, não só a estante visível.

**Importação:** selecionar arquivo local → validar formato/versão sem modificar estante → mostrar quantidade de livros e anos do arquivo e da biblioteca atual → explicar a operação → confirmar. Proposta V1: substituir biblioteca inteira, sem prometer mesclagem inteligente. Antes de substituir, oferecer exportar a atual; botão final “Substituir por 8 livros”, com Cancelar. Arquivo inválido, versão incompatível ou falha não altera registros existentes. Só anunciar “8 livros importados neste dispositivo” após conclusão atômica. Não enviar arquivo ao servidor. O catálogo não executa importação. Na aplicação, a issue #40 entrega esse fluxo como primeira seção de Seus dados, com o título Backup local e ações Exportar JSON/Importar JSON sempre independentes do Drive.

### Sincronização opcional — contrato visual e gate de produção

Os estados abaixo orientam o conector implementado e seu simulador. O catálogo estático não oferece conexão real. Em produção, enquanto o gate de autorização não estiver concluído, informar indisponibilidade claramente, sem botão que prometa um serviço pronto.

- Não conectado: “Seus dados estão apenas neste dispositivo.” Ação inicial “Entrar com Google”, opcional.
- Conta confirmada temporariamente: informar que o Drive ainda não foi autorizado e oferecer “Autorizar Google Drive” e “Cancelar autorização”. Retornar à tela entre as etapas; nunca abrir o segundo consentimento automaticamente.
- Identidade expirada: oferecer entrar novamente, preservando a biblioteca e sem prometer uma conta permanente.
- Conectando / Sincronizando: informar operação em andamento, sem antecipar sucesso.
- Sincronizado: data/hora e confirmação do serviço, sem inferir a partir da presença de internet.
- Sem conexão: “Alterações salvas aqui; aguardando conexão para sincronizar.”
- Falha: “Seus dados locais continuam aqui. Não foi possível atualizar a cópia no Drive.”
- Conflito: explicar versões, datas e quantidades; oferecer baixar cópias antes de escolher. Nunca substituir silenciosamente.

Permissões, sessão, conflitos e retenção estão definidos em [API OAuth](auth-api.md) e [sincronização](drive-sync.md); a ativação pública depende dos gates reais de produção. Google Drive é opcional; criar conta no Livro a Livro não é requisito implícito.

## 14. Responsividade e movimento

Validar larguras de 320, 375/390, 768, 1024 e 1440 px, paisagem e zoom de 200%. A leitura deve refluir a 320 CSS px, sem cortar títulos, campos ou ações. A estante do catálogo se adapta à janela. Na revisão visual, conferir desktop e viewport estreito; uma miniatura mobile isolada não é evidência suficiente.

Quebrar linhas de ferramentas; botões podem ocupar toda a largura; manter campos em 16 px para evitar zoom involuntário em mobile. Evitar rolagem horizontal na estante e na documentação. Não esconder ações essenciais por breakpoint. Tabelas documentais podem virar blocos ou usar área identificada rolável; listas de livros devem refluir.

Transições de 120 ms para hover, 180 ms para feedback e 240 ms para abertura leve. Movimento nunca celebra contagem, cria urgência ou desloca capas ao passar o mouse. `prefers-reduced-motion: reduce` remove animações/transições sem perder informação. Estados carregando sempre têm texto. O catálogo não usa animação automática.

## 15. Acessibilidade e revisão

Alvo de implementação: [WCAG 2.2 AA](https://www.w3.org/TR/WCAG22/). Usar HTML nativo, hierarquia clara, link para pular ao conteúdo, rótulos persistentes, foco visível e ordem lógica. Meta interna de alvo: 44 × 44 px. Estado nunca depende só de cor; ícone e palavra devem concordar. Atalhos não são necessários para tarefas básicas.

Antes de aceitar uma tela:

1. Conferir contraste de todos os pares e contornos essenciais, inclusive campos em erro e foco em botão escuro.
2. Percorrer com Tab/Shift+Tab, ativar com Enter/Espaço e confirmar saída por Escape em modal; restaurar foco.
3. Testar 200% de texto/zoom e reflow em 320 CSS px, título longo, autor ausente e capa ausente.
4. Anunciar alteração de estado uma vez; não anunciar a coleção inteira a cada digitação.
5. Verificar estado de leitura, seleção e avaliação sem cor; estrelas têm alternativa textual.
6. Conferir mensagens offline, falha ao salvar, JSON inválido e substituição; nunca antecipar sucesso.
7. Garantir que imagem anual exclui notas/avaliações e que a prévia corresponde ao arquivo.
8. Verificar leitor de tela e navegação real quando houver produto. Este catálogo estático não certifica os fluxos futuros.

## 16. Contrato de implementação e evolução

Consumo: importar `tokens.css`, aplicar tokens semânticos nos componentes e manter primitivos somente na camada de paleta. Exemplos não usam valores hexadecimais nem nomes de cores literais. Medidas de layout especial (proporções de exportação, breakpoints e molduras ilustrativas) podem ser explícitas; cores não. Tokens incluem fontes, escala, espaçamento, bordas, raios, foco, alvos, sombras, movimento e camadas.

```css
.book-status--reading {
  color: var(--color-status-reading);
  background: var(--color-status-reading-bg);
  border-radius: var(--radius-pill);
  padding: var(--space-1) var(--space-2);
}
```

Experimentos devem ser pequenos, descritos como “Experimento”, com efeito/limite explícitos, sem ativar serviços externos por surpresa. Não transformar experimento em promessa de produto; o catálogo original não desenha uma área de experimentos. Os consentimentos atuais em Seus dados ainda não acionam consumidores runtime; ver [estado da integração](experiments.md).

Atualizar guia, tokens e catálogo juntos. Novos estados exigem conteúdo, semântica, comportamento de teclado, variante estreita e contraste revisados. Mudar uma cor primitiva requer conferir todos os papéis que a usam. A documentação é referência de projeto, não declaração de que armazenamento, busca, compartilhamento ou sincronização já existem.


## 17. Direção de navegação mobile — revisão de 27 set 2026

A issue #44 entrega barra inferior **Estante · Adicionar · Mais** abaixo de 1024 CSS px, incluindo tablet. A partir de 1024 px, mantém navegação lateral e Adicionar livro no cabeçalho. Mais liga Seus dados, Configurações, Instalar e Apoiar. Lendo e Quero ler continuam como filtros e rotas diretas.

Rótulos e ícones permanecem visíveis, seleção usa `aria-current`, alvos têm pelo menos 44 px e o rodapé reserva área segura. A barra usa a camada sticky, abaixo dos diálogos. Os links seguem a proteção existente de rascunho e operações de backup; navegação muda o foco para o conteúdo. Não duplicar Adicionar no cabeçalho mobile.

A estante usa duas colunas abaixo de 640 px e quatro no tablet, com títulos completos e capas 2:3 inteiras. Cabeçalho, métricas e ferramentas são compactos; compartilhar fica depois da coleção e desaparece quando não há Lidos. Busca por título/autoria filtra apenas os registros locais do ano/estado selecionados, sem rede. Limpar busca preserva ano, filtro e modo. Consulta e rolagem sobrevivem à visita ao detalhe na sessão; a consulta não vai para URL, preferências ou telemetria.

Resultados externos têm título, autoria, origem e primeira publicação da obra quando conhecida em linhas compactas. A pessoa revisa os dados da edição antes de salvar; entrada manual continua disponível. Validar 320/390/768/1440 px, paisagem, foco, diálogos, formulário e zoom de 200%.

### Backup local — estados entregues na issue #40

A seção vem antes de Google Drive e privacidade. Exibe destino local, conteúdo privado do JSON e limite de 50 MiB; não apresenta autenticação como requisito. Seleção inicia “Validando o arquivo e as capas neste dispositivo…”, depois mostra contagens/anos do arquivo e deste dispositivo. Prévia permite Exportar biblioteca atual e Cancelar importação; a substituição abre diálogo de confirmação com rótulo explícito e singular/plural correto.

Cancelar diálogo retorna ao acionador; cancelar importação, concluir ou recusar restauração retorna ao seletor. Preparação/substituição têm estado anunciado e confirmação fica indisponível durante o commit. Exportação anuncia “Download iniciado; confira se ele foi salvo”, sem afirmar backup concluído. Formato, versão, excesso, quota e conflito têm mensagens distintas. A nota privada acompanha o JSON/Drive quando a pessoa escolhe essas ações, e permanece excluída da imagem anual.

### Capas na biblioteca — issue #42

Revisão da busca, estante em Grade/Lista e detalhe compartilham a mesma moldura 2:3. Usar `object-fit: contain`; nenhuma parte da imagem é cortada para preencher o espaço. Capas enviadas continuam disponíveis offline. Referências Open Library usam conexão, com aviso na estante/detalhe e fallback tipográfico em erro, ausência ou offline.

Título e autoria são conteúdo adjacente, não dependem da imagem nem ficam dentro do recorte. A imagem tem alt vazio por ser decorativa junto ao título; fallback é oculto para leitores de tela para evitar repetir o nome. Na busca, carregar apenas a capa do resultado já escolhido; a lista de resultados não dispara download de imagens. O catálogo permanece uma demonstração estática sem imagens remotas.

### Configurações e instalação — issue #45

Configurações oferece os controles existentes de ano (incluindo atual automático), Grade/Lista e filtro. Preferências são salvas pelo serviço; falha informa que a sessão conserva a escolha e oferece tentar salvar. A seção Aplicativo mostra versão/build públicos, disponibilidade offline, atualização e links para Instalar e backup.

Instalar oferece instruções Chrome/Android e Safari/iPhone/iPad. Botão só aparece com evento nativo disponível. Cancelamento e falha mantêm instruções; pedido aceito não vira instalado até observação do navegador. Estado instalado deixa backup acessível. Instalação não promete cópia ou conservação garantida dos registros.

A preparação offline inicial nunca usa a mensagem de atualização. Versão nova aguardando permite consentir, respeitando rascunhos/operações e outras abas. A página desconhecida oferece Estante e backup, sem “Em construção”.

### Conexão global — primeira fatia da correção de paridade, issue #13

O cabeçalho reúne Apoiar, conexão/estado do Drive e Configurações em todas as rotas. No celular, as ações podem ocupar uma segunda linha sem ocultar os rótulos. Adicionar continua na barra inferior; desktop mantém seu botão no cabeçalho. Preparando conexão e indisponibilidade real têm mensagens distintas.

Entrar com Google abre a confirmação compartilhada com Seus dados. Após identificação, o convite Autorizar Drive oferece Agora não; não inicia a segunda autorização por conta própria. Nesta fatia, a identificação ainda é temporária e o texto informa esse limite. Login persistente e a lembrança de Agora não entre aberturas pertencem à próxima fatia.

Formulário aberto, operação de backup, atualização em aplicação ou outro diálogo adiam o convite. Rascunho/backup/update também são conferidos imediatamente antes de sair para Google, depois da resposta de autorização. Fechar devolve o foco a um acionador disponível. Autorização usa o estilo de ação primária; ações destrutivas conservam seu estilo próprio.

Erro, reconexão, revogação pendente e conflito exibem aviso global com detalhes e Decidir depois. Dispensar o aviso mantém o estado no cabeçalho; uma nova situação pode voltar a ser anunciada. A resolução continua em Seus dados até a fatia de união. Com a flag desligada, o cabeçalho informa indisponibilidade e leva aos detalhes, sem simular conexão.
