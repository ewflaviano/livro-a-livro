# Apoio ao projeto

O Livro a Livro continua utilizável sem apoio financeiro, conta ou cadastro. A página `#/apoiar` oferece um Pix estático e links para sugestões e contribuição de código.

O Pix é processado exclusivamente pelo banco da pessoa que contribui. O aplicativo não recebe pagamento, valor, identidade, comprovante ou histórico de contribuições. Antes de confirmar uma transferência, a pessoa deve conferir o recebedor exibido pelo banco.

O QR Code e o código copia e cola são a configuração estática aprovada para o projeto. Eles ficam no cliente para que a página funcione sem backend e não faça nenhuma consulta ao abrir. Para trocar essa configuração, atualize juntos `src/support/pix.ts`, `public/pix-livro-a-livro.svg` e os testes da página.

Sugestões e contribuições de código usam o repositório público no GitHub. Nunca inclua uma exportação da estante, notas, avaliações, token do Google Drive ou outros dados pessoais em uma issue.
