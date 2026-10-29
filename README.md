# Caderno de Tarefas

App simples de tarefas para iPad, com cara de caderno pautado. É um site estático
(HTML, CSS e JavaScript puros, sem build), pronto para publicar no Vercel.

## O que tem

- Cadernos (Pessoal, Trabalho, Casa e os que você criar), aba **Hoje** e aba **Todas**
- Prazos, estrela de importante, anotações e lista de feitas com "Desfazer"
- **Ditar várias**: fale várias tarefas de uma vez pelo microfone do teclado; o app separa,
  entende prazos ("amanhã", "sexta", "dia 15", "semana que vem") e marca "urgente" com estrela
- Funciona offline e pode ser instalado na tela inicial
- **Fazer backup** e **Restaurar** (arquivo .json)

## Onde ficam as tarefas

As tarefas ficam salvas **no próprio navegador do aparelho**. Não há servidor nem conta.
Por isso:

- O que você anota no iPad não aparece no computador (e vice-versa).
- Se apagar os dados do Safari ou remover o app da tela inicial, as tarefas somem.
  Use **Fazer backup** de vez em quando (salve no app Arquivos ou no iCloud Drive).
- O app da tela inicial e o Safari guardam dados separados no iPad. Use sempre o da tela inicial.

## Publicar no Vercel pelo GitHub

1. Crie um repositório vazio no GitHub (ex.: `caderno-tarefas`).
2. Envie estes arquivos para ele:
   ```bash
   cd caderno-tarefas
   git remote add origin https://github.com/SEU-USUARIO/caderno-tarefas.git
   git push -u origin main
   ```
   Sem terminal? No GitHub, abra o repositório vazio, clique em
   **uploading an existing file** e arraste todos os arquivos e a pasta `icons`.
3. Em [vercel.com/new](https://vercel.com/new), entre com o GitHub e importe o repositório.
4. Não mude nada nas configurações (Framework Preset: **Other**, sem build command) e clique em **Deploy**.
5. Cada `git push` na branch `main` publica uma nova versão sozinho.

## Instalar no iPad

1. Abra o endereço do Vercel no **Safari**.
2. Toque em **Compartilhar → Adicionar à Tela de Início**.

## Ao atualizar o app

Depois de mudar algum arquivo, aumente a versão em `sw.js` (`cadernos-v1` → `cadernos-v2`)
para o iPad baixar a versão nova. Ela aparece na segunda vez que você abrir o app.

## Arquivos

| Arquivo | Para que serve |
|---|---|
| `index.html` | O app inteiro |
| `sw.js` | Faz o app abrir sem internet |
| `manifest.webmanifest` | Nome, cores e ícones do app instalado |
| `icons/` | Ícones da tela inicial |
| `vercel.json` | Cabeçalhos para o Vercel |
