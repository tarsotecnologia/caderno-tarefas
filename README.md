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
5. Em qualquer outro aparelho: no que já está na conta, toque em **Adicionar aparelho → Outro aparelho**.
   Aparece um código (vale 10 minutos, uma vez). No aparelho novo, toque em
   **Tenho um código de outro aparelho** e digite.

### O que o app faz

- **Hoje, Semana, Todas, Buscar**: a Semana mostra atrasadas e os próximos 7 dias; a Busca procura
  em todos os cadernos, nas anotações e nas checklists, inclusive em tarefas feitas.
- **Checklist** dentro da tarefa (setinha → Checklist), com o progresso `☑ 2/3` na linha.
- **Repetir** (todo dia, dias úteis, semana, mês, ano). No ditado: "todo dia", "toda segunda",
  "todo mês dia 10", "de segunda a sexta".
- **Lembrete** com horário (setinha → Lembrete). Veja "Lembretes" abaixo.
- **Cadernos compartilhados**: no caderno, **Compartilhar** gera um convite (vale 48 horas, uma
  pessoa). Quem recebe toca em **Tenho um convite**, no fim da lista de cadernos. Todos veem e
  editam as mesmas tarefas; cada um continua com a própria conta e os próprios cadernos.

## Lembretes (notificações)

1. Gere as chaves (uma vez): `npx web-push generate-vapid-keys`.
2. No Vercel (Settings → Environment Variables, Production), crie e faça **Redeploy**:

| Variável | Valor |
|---|---|
| `VAPID_PUBLIC_KEY` | a "Public Key" gerada |
| `VAPID_PRIVATE_KEY` | a "Private Key" gerada (segredo) |
| `VAPID_SUBJECT` | `mailto:` + seu e-mail |
| `CRON_SECRET` | uma senha longa qualquer (segredo) |

3. Algo precisa chamar o envio a cada 5 minutos. O plano gratuito do Vercel só roda cron 1 vez por
   dia, então use um serviço gratuito como o [cron-job.org](https://cron-job.org):
   - URL: `https://SEU-ENDERECO/api/push?cron=1`, método GET, a cada 5 minutos
   - Cabeçalho: `Authorization: Bearer` + o valor de `CRON_SECRET`
   (No plano Pro do Vercel dá para usar `crons` no `vercel.json` no lugar disso.)
4. Em cada aparelho, toque em **Ativar lembretes** e permita as notificações. No iPhone e no iPad
   isso só funciona com o app **adicionado à Tela de Início** (iOS/iPadOS 16.4 ou mais novo).

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
| `api/data.js` | Ler e salvar tarefas e cadernos da conta; cadernos compartilhados |
| `api/push.js` | Lembretes: inscrição dos aparelhos e envio das notificações |
| `api/_lib.js` | Banco de dados, sessão por cookie assinado, criação das tabelas |
| `api/webauthn.js` | Lista de endereços extras que podem usar as chaves-senha (`/.well-known/webauthn`) |
| `sw.js` | Faz o app abrir sem internet e mostra as notificações |
| `manifest.webmanifest`, `icons/` | Nome, cores e ícones do app instalado |
| `vercel.json` | Cabeçalhos para o Vercel |
