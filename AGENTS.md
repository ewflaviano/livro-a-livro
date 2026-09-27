# Entrega do Livro a Livro

## Limites do produto

- A biblioteca é local-first: `IndexedDB` é a fonte de verdade.
- Sem conexão, a estante, o cadastro manual, a edição e o backup JSON continuam utilizáveis.
- Ao optar pelo Drive, os dados vão diretamente entre PWA e Google Drive. A API não recebe livros, notas, avaliações, snapshots ou backups.
- Não adicionar IA, login obrigatório, recomendações, feed, metas, notificações ou coleta de dados pessoais sem uma issue e decisão explícitas.

## Método de entrega

1. Uma issue por vez, em branch `codex/issue-<numero>-<resumo>`.
2. Antes de editar: ler a issue, `docs/architecture.md`, o design system e os testes relacionados.
3. Depois de editar: executar os checks definidos pela issue, atualizar documentação afetada e manter a alteração limitada ao seu objetivo.
4. Cada etapa gera um pull request ligado à issue; não misturar refactors, infraestrutura e funcionalidade sem necessidade.
5. A biblioteca e seu backup nunca entram em logs, fixtures reais, URLs, telemetria, commits ou comentários de PR.

## Papéis dos agentes

| Papel | Modelo | Responsabilidade |
| --- | --- | --- |
| Arquitetura e revisão de fronteiras | GPT-6 Sol, alto | Contratos, segurança, sincronização, concorrência e decisões que afetam várias áreas. |
| Implementação de uma issue | GPT-6 Sol, médio | Código e testes de uma fatia vertical, seguindo a arquitetura aprovada. |
| Revisão e validação | GPT-6 Sol, médio | Revisar diff, testar casos de erro e verificar os limites local-first. |
| Tarefas mecânicas isoladas | GPT-6 Luna, baixo | Formatação, inventário, atualização documental e checagens repetitivas — nunca decisões de dados ou segurança. |

O controlador só libera a próxima issue depois que a anterior estiver revisada e integrada. Experimentos, OAuth e infraestrutura exigem revisão de arquitetura pelo SOL antes de merge.
