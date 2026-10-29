# Caderno de Tarefas

App de tarefas para iPad, com cara de caderno pautado e **contas separadas**: cada pessoa
entra com a digital ou o Face ID do próprio aparelho e vê só as próprias tarefas.
As tarefas ficam num banco de dados e sincronizam entre iPad, iPhone e computador.

## O que tem

- Cadernos (Pessoal, Trabalho, Casa e os que você criar), aba **Hoje** e aba **Todas**
- Prazos, estrela de importante, anotações e lista de feitas com "Desfazer"
- **Ditar várias**: fale várias tarefas de uma vez pelo microfone do teclado; o app separa,
  entende prazos ("amanhã", "sexta", "dia 15", "semana que vem") e marca "urgente" com estrela
- Entrar com **chave-senha** (digital ou Face ID). Não existe senha.
- Se a internet cair com o app aberto, as mudanças esperam e são enviadas quando a conexão volta (para entrar na conta é preciso estar on-line)
- **Fazer backup** e **Restaurar** (arquivo .json)

## Como a separação funciona

- Cada conta tem uma ou mais chaves-senha. A chave fica guardada no aparelho da pessoa
  (no iCloud Keychain, no caso de iPhone, iPad e Mac) e nunca sai de lá.
- O servidor só entrega e altera tarefas da conta que entrou. Uma pessoa não consegue ler nem
  mudar tarefas de outra, nem tentando pelo endereço da API.
- **Atenção em iPad compartilhado:** quem tem a digital cadastrada nos Ajustes do iPad consegue
  usar as chaves-senha guardadas nele. Para separar de verdade, cada pessoa deve entrar pelo
  próprio aparelho, ou usar a opção de chave-senha de outro aparelho (QR code no iPhone dela).

## Publicar no Vercel

### 1. Envie para o GitHub

```bash
cd caderno-tarefas
git remote add origin https://github.com/SEU-USUARIO/caderno-tarefas.git
git push -u origin main
```

### 2. Importe no Vercel

Em [vercel.com/new](https://vercel.com/new), importe o repositório. Framework Preset: **Other**.
Não precisa de build command. Clique em **Deploy**. (O primeiro deploy funciona, mas o login
só passa a funcionar depois dos passos 3 e 4.)

### 3. Crie o banco de dados

No projeto, abra **Storage** → **Create Database** → **Neon** (Postgres, tem plano gratuito)
→ conecte ao projeto. O Vercel cria a variável `DATABASE_URL` sozinho.
As tabelas são criadas automaticamente no primeiro acesso.

### 4. Crie o segredo das sessões

Em **Settings → Environment Variables**, adicione:

| Nome | Valor |
|---|---|
| `SESSION_SECRET` | um texto aleatório de 32+ caracteres (gere com `openssl rand -base64 48` no Terminal) |
| `SIGNUP_CODE` | *opcional*: um código de convite. Com ele, só quem souber o código cria conta. |

Sem `SIGNUP_CODE`, qualquer pessoa com o link pode criar uma conta (vazia, só dela).

### 5. Publique de novo

Em **Deployments**, clique nos três pontinhos do último deploy → **Redeploy**.
Daqui em diante, cada `git push` na `main` publica sozinho.

## Usar

1. Abra o endereço no **Safari** do iPad → **Compartilhar → Adicionar à Tela de Início**.
2. Toque em **Criar uma conta**, escreva seu nome e confirme com a digital.
3. Se você já usava a versão anterior neste iPad, o app oferece **Trazer para minha conta**.
4. No iPhone ou Mac com o mesmo Apple ID, a chave-senha já aparece: é só tocar na digital.
   Em outro aparelho (Windows, Android), entre usando o QR code com o iPhone e depois toque em
   **Adicionar aparelho** para criar uma chave-senha própria dele.

## Endereço do site e chaves-senha

A chave-senha fica presa ao endereço onde foi criada (ex.: `caderno-tarefas.vercel.app`).
Os endereços de pré-visualização do Vercel (`...-git-...vercel.app`) também são diferentes:
use sempre o endereço de produção.

### Trocar de domínio sem perder as chaves

Para usar um domínio novo (ex.: `cadernos.exemplo.com`) com as chaves já criadas no antigo,
crie no Vercel (Settings → Environment Variables, ambiente Production) e faça **Redeploy**:

| Variável | Valor |
|---|---|
| `RP_ID` | o domínio antigo, onde as chaves foram criadas: `caderno-tarefas.vercel.app` |
| `ORIGENS_EXTRAS` | o endereço novo, com `https://`: `https://cadernos.exemplo.com` (vários: separe por vírgula) |

O domínio antigo precisa continuar abrindo o app **sem redirecionar** para o novo: o navegador lê
`https://caderno-tarefas.vercel.app/.well-known/webauthn` para saber que o endereço novo pode usar
as chaves. Funciona no Safari/iPadOS 18 ou mais novo e no Chrome 128 ou mais novo.

## Ao atualizar o app

Depois de mudar `index.html`, aumente a versão em `sw.js` (`cadernos-v3` → `cadernos-v4`)
para os aparelhos baixarem a versão nova. Ela aparece na segunda vez que o app for aberto.

## Arquivos

| Arquivo | Para que serve |
|---|---|
| `index.html` | O app (tela, tarefas, entrar e criar conta) |
| `api/auth.js` | Criar conta, entrar, sair, adicionar aparelho |
| `api/data.js` | Ler e salvar tarefas e cadernos da conta |
| `api/_lib.js` | Banco de dados, sessão por cookie assinado, criação das tabelas |
| `api/webauthn.js` | Lista de endereços extras que podem usar as chaves-senha (`/.well-known/webauthn`) |
| `sw.js` | Faz o app abrir sem internet |
| `manifest.webmanifest`, `icons/` | Nome, cores e ícones do app instalado |
| `vercel.json` | Cabeçalhos para o Vercel |
