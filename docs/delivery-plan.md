# Sequência de entrega

> Plano de referência. Para distinguir entregas integradas, módulos isolados e serviços pendentes, consulte o [estado atual](../README.md#estado-atual) e a [auditoria de 27/09/2026](audit-2026-09-27.md).

As issues seguem uma ordem deliberada: primeiro provar que os dados locais são confiáveis; depois tornar a estante agradável; por último adicionar conexões opcionais.

| Ordem | Marco | Resultado verificável | Agente principal |
| --- | --- | --- | --- |
| 1 | Contratos de domínio | Livro, ano, estados e estatísticas validados sem interface | SOL médio |
| 2 | IndexedDB e backup | Exportar → limpar perfil de teste → importar recupera a biblioteca exatamente | SOL médio + revisão SOL alto |
| 3 | Shell e estante | Grade/Lista, ano, filtros e métricas funcionam offline | SOL médio |
| 4 | Cadastro e página do livro | Cadastro manual, edição, nota e avaliação privadas | SOL médio |
| 5 | Open Library | Busca explícita, revisável e dispensável, com rota manual sempre disponível | SOL médio |
| 6 | PWA e compartilhamento | Instalação, app shell offline e imagem anual sem dados privados | SOL médio |
| 7 | Drive opt-in | OAuth, sessão e transferência direta PWA ↔ Drive, com conflitos e revogação | SOL alto |
| 8 | Experimentos e operações | Catálogo remoto, kill switch, telemetria opt-in e CI/infraestrutura | SOL alto |

Cada marco pode ter várias issues, mas só inicia quando os critérios do anterior estiverem verdes. As tarefas de formatação, cobertura, documentação e inventário podem ser delegadas ao Luna; decisões e código de produto permanecem com o SOL.
