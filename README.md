# Soberano Assistência Técnica

Sistema web com React, API Express e banco persistente Turso/libSQL.

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/GWZ-dotcom/git)

## Publicar no Render

1. Clique em **Deploy to Render** e entre na sua conta Render/GitHub, se solicitado.
2. No formulário do Blueprint, informe `TURSO_DATABASE_URL` e `TURSO_AUTH_TOKEN` da sua base Turso.
3. Para `APP_INITIAL_PASSWORD`, use `1020304050`. No primeiro acesso, o sistema pedirá para criar uma nova senha.
4. Clique em **Apply** para criar e implantar o serviço.

O Blueprint configura o build, inicia o servidor na porta do Render, gera automaticamente `APP_SESSION_SECRET` e verifica `/api/health`. As credenciais do Turso e a senha inicial são solicitadas como segredos no Render; não as coloque no Git. A base de dados permanece no Turso, mesmo quando a instância gratuita do Render suspender por inatividade.

## Configuração do Turso

1. Confirme se `TURSO_DATABASE_URL` e `TURSO_AUTH_TOKEN` estão preenchidos no `.env` local. Esses valores não devem ser incluídos em `.env.example`.
2. Se precisar recriar o arquivo local, copie o exemplo:

   ```powershell
   Copy-Item .env.example .env
   ```

3. Configure `APP_USERNAME` e gere uma chave exclusiva para `APP_SESSION_SECRET` (mínimo 32 caracteres). No PowerShell:

   ```powershell
   [Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(48))
   ```

4. No primeiro acesso, entre com a senha temporária `APP_INITIAL_PASSWORD`. O sistema exige que ela seja substituída por uma senha de pelo menos 12 caracteres. Depois da troca, remova `APP_INITIAL_PASSWORD` do `.env`; a senha nova fica armazenada no Turso como hash com sal, e as sessões anteriores são revogadas.
5. Instale as dependências e inicie a API e o frontend:

   ```powershell
   npm install
   npm run dev
   ```

6. Abra o endereço informado pelo Vite. Na primeira execução, a API cria as tabelas no Turso automaticamente.

O arquivo `.env` contém credenciais privadas e não deve ser compartilhado ou enviado ao Git. A configuração inicial da conta é usada apenas para criar a conta no primeiro acesso; após a troca, ela não substitui nem sobrescreve a senha armazenada no Turso. A aplicação não cria registros fictícios: clientes, aparelhos, ordens, estoque, vendas e caixa começam vazios e são gravados no Turso. As senhas são armazenadas com scrypt e as rotas da API são protegidas por um cookie HTTP-only.

## Verificações

```powershell
npm test
npm run lint
npm run build
```
