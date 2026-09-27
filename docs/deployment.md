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

## Próxima implantação

Ainda não há site nem API para apontar. Quando cada recurso existir, criar na mesma zona:

- Alias `A`/`AAAA` de `livroalivro.app.br` para a distribuição CloudFront.
- Domínio regional do API Gateway com o certificado de `sa-east-1` e Alias `A` de `api.livroalivro.app.br` para ele.

Não criar CNAMEs de placeholder: eles poderiam aparentar que o produto está publicado antes de existir um destino válido.
