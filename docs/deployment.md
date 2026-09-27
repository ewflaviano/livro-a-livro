# Infraestrutura de domínio

## DNS

- Zona Route 53 pública: `livroalivro.app.br.` (`Z00589771OM34UZPERUI4`)
- Nameservers a delegar no Registro.br:
  - `ns-734.awsdns-27.net`
  - `ns-1571.awsdns-04.co.uk`
  - `ns-1058.awsdns-04.org`
  - `ns-334.awsdns-41.com`

Os CNAMEs de validação DNS do ACM já existem na zona. Após a delegação se propagar, os certificados serão emitidos automaticamente.

## Certificados

| Uso | Região | Domínio | ARN |
| --- | --- | --- | --- |
| Site via CloudFront | `us-east-1` | `livroalivro.app.br` | `arn:aws:acm:us-east-1:872515289365:certificate/e6d34afc-677c-43c2-8666-d1e036b85803` |
| API Gateway regional | `sa-east-1` | `api.livroalivro.app.br` | `arn:aws:acm:sa-east-1:872515289365:certificate/72f6da3a-39a8-44d9-bc11-5737c0d2f278` |

Os certificados devem estar com status `ISSUED` antes de serem associados aos recursos de produção.

## Publicação do site

`infra/frontend.yml` cria uma distribuição CloudFront com origem S3 privada/OAC, o alias `A`/`AAAA` da raiz e os cabeçalhos de segurança. O bucket recebe somente o build estático; não recebe bibliotecas, backups, capas enviadas ou arquivos de Drive.

Os assets com hash são publicados primeiro com cache imutável. Ícones e outros arquivos públicos estáveis na raiz do build entram em seguida, com revalidação curta. Só então entram `manifest.webmanifest`, `sw.js` e `index.html`, que usam revalidação. O pipeline não executa `sync --delete`: versões anteriores continuam disponíveis para instalações offline.

## API

O certificado regional de `sa-east-1` continua reservado para o domínio `api.livroalivro.app.br`. Ele será associado ao API Gateway somente quando a composição OAuth durável estiver pronta. Até lá, o frontend não habilita o conector de Drive em produção e não existe CNAME de placeholder.

## CI/CD

`.github/workflows/ci.yml` testa frontend e Rust em jobs independentes. Publicações da `main` assumem a role OIDC limitada definida em `infra/github-oidc.yml`; não usam chaves AWS estáticas. A confiança usa o identificador imutável do repositório no GitHub e a referência `main`, para que uma renomeação não abra a role a outro repositório. A role só pode ler os outputs da stack, publicar os assets no bucket deste site e invalidar sua distribuição.
