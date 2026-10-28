# herdr-mailbox

![License](https://img.shields.io/badge/license-MIT-blue)
![Herdr 0.9.3+](https://img.shields.io/badge/herdr-0.9.3%2B-8a2be2)
![Platforms](https://img.shields.io/badge/platforms-macOS%20%E2%80%A2%20Linux%20%E2%80%A2%20Windows-informational)
![Runtime](https://img.shields.io/badge/runtime-Node%2018%2B-5fa04e)

[English](../README.md) | [简体中文](./zh-sc.md) | [繁體中文](./zh-tc.md) | [Español](./es.md) | [Português](./pt.md) | [Русский](./ru.md) | [日本語](./jp.md) | [Français](./fr.md) | [Deutsch](./de.md) | [Tiếng Việt](./vi.md) | [한국어](./ko.md) | [ไทย](./th.md) | [Italiano](./it.md)

<p align="center">
  <a href="#instalação">instalação</a> · <a href="#uso">uso</a> · <a href="#enviar-uma-carta">enviar uma carta</a> · <a href="#limites">limites</a> · <a href="./guide.md">guia completo</a>
</p>

> Num multi-agent workflow, a sua atenção e as suas decisões são o que mais importa.

Você roda um multi-agent workflow no Herdr: um agente leader com vários agentes worker, cada um cuidando da sua parte. Os relatórios e as mensagens deles inundam a conversa do leader. Você está no meio de uma frase e um relatório se intromete e vai embora junto com ela; a pergunta de decisão que acabaram de te fazer é varrida pela mensagem seguinte um segundo depois.

Este plugin existe para resolver exatamente isso: sua atenção fica sem interrupções, reservada para as decisões de qualidade que só você pode tomar.

Não é uma reconstrução das perguntas de opções do Claude Code (AskUserQuestion). Ele usa o que o Herdr oferece para reunir num só lugar os relatórios e as perguntas pendentes de agentes de fornecedores diferentes, juntá-los e coordená-los; e, como a conversa não fica mais inundada, também economiza o uso que essas enxurradas custariam.

**Antes**

![Sem caixa de correio: o relatório de um worker é digitado no prompt pela metade e enviado junto com ele; depois cada relatório e cada pergunta acordam o leader e o chat vai enchendo](./media/demo-before.gif)

O Mailbox dá uma caixa de correio ao leader. Além de mensagens comuns, que são como cartões-postais, os workers podem deixar cartões de decisão e cartões de discussão para você responder. As mensagens comuns entram num único lote, só quando você não está digitando e o leader está livre; os cartões ficam esperando na caixa até você responder com o mouse.

**Depois**

![Com caixa de correio: os relatórios esperam na caixa enquanto você digita, chegam num único lote, e as perguntas são respondidas com o mouse e devolvidas de uma só vez](./media/demo.gif)

- **Seu campo de texto continua sendo seu** — nada é digitado enquanto você digita, e nada chega enquanto o leader ainda está respondendo.
- **As mensagens comuns chegam juntas** — elas esperam até um minuto para entrar num único lote e acordar o leader uma vez só; **Enviar já** pula a espera.
- **Perguntas num só lugar** — as perguntas de decisão viram cartões ao lado do leader; responda com o mouse e envie todas as respostas de uma vez.
- **Qualquer agente pode escrever** — quem envia só executa `mailbox send`, então Claude Code, Codex, agy e qualquer agente que consiga rodar um comando de shell escrevem na mesma caixa de correio.
- **Um recibo para cada envio** — cada envio devolve na hora o id da carta e o status dela.
- **Acompanha o leader** — mover o pane, reiniciar o Herdr ou limpar a conversa mantém a caixa de correio com o mesmo destinatário.

## Instalação

Requer Herdr 0.9.3 ou mais recente e Node 18 ou mais recente.

```sh
# 1. Instale o plugin
herdr plugin install navishachiku/herdr-mailbox

# 2. Execute a ação setup dele: o comando `mailbox`, os hooks do Claude Code e as regras de permissão do Codex e do agy
herdr plugin action invoke setup --plugin herdr-mailbox

# 3. As integrações de agentes do próprio Herdr, uma para cada agente que você usa
herdr integration install claude
herdr integration install codex
herdr integration install antigravity-cli

# 4. A skill que ensina os agentes a enviar cartas
npx skills add navishachiku/herdr-mailbox --global
```

Para uma instalação não interativa do plugin, adicione `--yes` ao passo 1: `herdr plugin install navishachiku/herdr-mailbox --yes`.

As integrações do Herdr identificam a conversa em cada pane para que a caixa de correio possa se vincular ao seu destinatário. Se o modo automático de um agente recusar o passo 3, execute você mesmo os comandos correspondentes num terminal. Sem a integração, o envio ainda pode funcionar, mas a caixa de correio pode não conseguir se vincular à conversa do destinatário.

Um agente sem sistema de skills pode ler as mesmas instruções com `mailbox skill`; cole a saída no arquivo de instruções desse agente.

A ação setup faz backup de cada arquivo antes de alterá-lo (`<file>.bak-<date>`), não adiciona nada duas vezes quando executada de novo e continua funcionando depois de `herdr plugin update`. `node <plugin dir>/src/setup.mjs uninstall` desfaz tudo. Reinicie as sessões do Claude Code que devem receber correspondência.

Adicione o atalho ao `config.toml` do Herdr (`~/.config/herdr/config.toml`; no Windows `%APPDATA%\herdr\config.toml`) e recarregue com `prefix+shift+r` (`prefix` é `ctrl+b`, a menos que você tenha mudado):

```toml
[[keys.command]]
key = "prefix+shift+m"
type = "plugin_action"
command = "herdr-mailbox.open"
description = "open the mailbox"

[ui.toast]
delivery = "herdr"
```

Se a ação não funcionar na sua máquina, [AGENT-SETUP.md](../AGENT-SETUP.md) traz os mesmos passos para um coding agent seguir.

## Uso

Abra a caixa de correio na janela do leader: selecione o pane do leader e aperte `prefix+shift+m`. A caixa de correio pertence ao agente do pane em que você aperta o atalho, então aperte no pane do leader, não no de um worker. A tela da caixa de correio abre ao lado do leader; apertar o atalho de novo de dentro da tela, ou `q`, fecha a tela, e as cartas continuam lá.

- **Mensagens** — as mensagens comuns dos workers esperam aqui e entram no leader num único lote; **Enviar já** envia na hora.
- **Perguntas** — cartões de decisão e de discussão. Clique numa opção ou escreva uma nota, e **Enviar** devolve todas as respostas num único lote. **Aceitar todas**, **Perguntar todas** e **Anular todas** agem sobre vários cartões de uma vez.
- **Opções** — largura da tela, modo dos cartões, quanto tempo as mensagens comuns esperam para ser juntadas e o idioma da tela (13 idiomas).

Quando a tela não está aberta, uma nova pergunta de decisão ou de discussão mostra uma notificação do Herdr com a pergunta; com a tela aberta, nenhuma notificação aparece. Os workers escrevem para o leader com `mailbox send`, explicado abaixo.

**Reivindicar uma caixa de correio**: quando a conversa do leader é substituída, a caixa de correio se desconecta e as cartas continuam lá. Execute no pane do novo agente a linha `mailbox claim MB-xxxx` mostrada na tela, e a caixa de correio volta a se conectar.

## Enviar uma carta

```sh
mailbox send --to <address|MB-id> --type note "tests pass"

mailbox send --to <address|MB-id> --type decision \
  --question "Install the skill too?" --option "Yes" --option "No" --recommend A
```

`--to` aceita um id de pane, um nome de agente ou um id de caixa de correio. `--recommend` é opcional; um cartão sem ele não mostra nenhuma opção recomendada.

Material mais longo vai junto com a carta como arquivo (`--attach <file>`, até 5 por carta); o cartão mostra um link e, ao clicar, o arquivo abre no programa padrão do sistema (uma imagem no visualizador de imagens, um arquivo de texto no aplicativo padrão). Endereços web numa pergunta abrem no navegador padrão.

`--wait [--timeout <ms>]` faz o envio só retornar depois que o leader pegar a carta e terminar o turno dele. Se desistir de esperar, ele sai com 3 ou 4; de qualquer forma, uma carta para uma caixa de correio já está na fila ou entregue, então não envie de novo. Uma carta para um pane sem caixa de correio é assinada e digitada direto nele uma única vez, na hora. Perguntas de discussão, como consultar, editar e retirar cartas, e cada botão da tela estão no [guia completo](./guide.md).

## Limites

- Uma pergunta tem até 200 caracteres e uma mensagem comum até 500; textos mais longos vão num arquivo com `--attach`.
- O agente dono da caixa de correio (o leader) precisa ser o Claude Code ou o agy, porque a entrega espera o campo de texto dele ficar vazio e só esses dois campos de texto podem ser lidos; quem envia pode ser qualquer agente.

## Problemas conhecidos

- **Codex: ainda não pode ser dono de uma caixa de correio.** O Codex 0.163 roda as conversas num único servidor compartilhado em segundo plano, então a integração do Codex no Herdr atribui cada conversa ao pane que iniciou esse servidor, e o próprio pane do Codex nunca recebe um id de conversa ao qual vincular uma caixa de correio. O Codex ainda pode enviar cartas, e uma mensagem comum enviada a um pane do Codex sem caixa de correio é assinada e digitada direto nele uma única vez. O id de pane do Codex em `HERDR_PANE_ID` pode estar errado, então um remetente Codex precisa indicar o próprio pane com `--from <pane id>`.
- **agy: a skill não é instalada onde o agy a lê.** A CLI `skills` não consegue instalar na pasta de onde o agy carrega as skills, então `npx skills add` não chega até lá. É uma limitação dessa CLI; a caixa de correio não a contorna.
- **agy: vê a skill, mas não usa a caixa de correio por conta própria.** Se você só disser "reporte para agent-a", o agy recorre à ferramenta de mensagens embutida dele em vez de `mailbox send`. Cite o comando no pedido ("envie com `mailbox send`").

<details>
<summary>Avançado: como funciona, estado, testes</summary>

### Como funciona

Um pequeno daemon é dono do arquivo de estado e trata um pedido por vez. A CLI conversa com ele por um socket local e o inicia quando ele não está rodando. O estado fica no diretório de estado de plugins do Herdr, fora do diretório do código do plugin, com uma versão de esquema, e é gravado em disco antes de o recibo ser devolvido. Cada sessão do Herdr tem seu próprio subdiretório, daemon e caixas de correio, então o mesmo endereço de pane em duas sessões nunca compartilha cartas.

| Peça | Papel |
| --- | --- |
| `src/daemon.mjs`, `src/core.mjs` | O daemon e as regras das cartas: recibos, deduplicação, editar e retirar, limites. |
| `src/identity.mjs` | Vincular uma caixa de correio a um destinatário, o laço de reconciliação, reivindicações. |
| `src/delivery.mjs`, `src/format.mjs`, `src/input-box.mjs` | Agrupamento em lotes, verificação do campo de texto, confirmação, texto do lote. |
| `src/screen/` | A tela da caixa de correio, com as configurações exibidas dentro dela; anexos e links vão para os programas padrão do sistema. |
| `src/open.mjs`, `src/on-focus.mjs` | A ação `prefix+shift+m` e a reabertura da tela depois de reiniciar o Herdr. |
| `src/session-start.mjs`, `src/prompt-submit.mjs`, `src/send-guard.mjs` | Os hooks do Claude Code. |

### Testes

```sh
npm test
```

Executa a CLI e o daemon de verdade contra um binário `herdr` falso, num diretório de estado descartável.

</details>

## Licença

MIT
