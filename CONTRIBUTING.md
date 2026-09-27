# Contribuir com o Livro a Livro

Obrigado por querer melhorar o projeto. O princípio central é simples: a biblioteca pertence à pessoa que a criou.

## Antes de começar

1. Abra uma issue explicando a necessidade, sem anexar backup, título, nota, token ou captura com dados reais.
2. Uma mudança por pull request, partindo de `main` em uma branch `codex/issue-<número>-<resumo>`.
3. Não acrescente login obrigatório, rede social, recomendação, IA, coleta de dados ou um novo destino para a biblioteca sem uma decisão explícita de arquitetura.

## Ambiente local

```sh
npm install
make
```

Para testar o Drive sem conta ou serviços externos, use `make local`. Ele cria dados descartáveis e um IndexedDB separado. Antes de enviar uma mudança, execute:

```sh
make check
```

## Limites de privacidade

- IndexedDB é a fonte de verdade; exportar/importar precisa continuar funcionando offline.
- Drive é opcional e direto: PWA ↔ Google Drive. A API não recebe livros, notas, avaliações, backups, hashes ou capas.
- Não inclua segredos, arquivos de teste reais, contas, tokens ou dados pessoais em commits, issues ou pull requests.
- Métricas e experimentos são opt-in e nunca podem habilitar transmissão de biblioteca.

## Pull requests

Explique o problema resolvido, a forma de testar e qualquer consequência de privacidade. Para mudança de interface, verifique uma tela estreita e mantenha foco, contraste e alvos de toque acessíveis. Para alteração de backup, inclua round-trip e compatibilidade com versões anteriores.
