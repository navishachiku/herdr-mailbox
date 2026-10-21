# herdr-mailbox

![License](https://img.shields.io/badge/license-MIT-blue)
![Herdr 0.9.3+](https://img.shields.io/badge/herdr-0.9.3%2B-8a2be2)
![Platforms](https://img.shields.io/badge/platforms-macOS%20%E2%80%A2%20Linux%20%E2%80%A2%20Windows-informational)
![Runtime](https://img.shields.io/badge/runtime-Node%2018%2B-5fa04e)

[English](../README.md) | [简体中文](./zh-sc.md) | [繁體中文](./zh-tc.md) | [Español](./es.md) | [Português](./pt.md) | [Русский](./ru.md) | [日本語](./jp.md) | [Français](./fr.md) | [Deutsch](./de.md) | [Tiếng Việt](./vi.md) | [한국어](./ko.md) | [ไทย](./th.md) | [Italiano](./it.md)

<p align="center">
  <a href="#instalação">instalação</a> · <a href="#enviar-uma-carta">enviar uma carta</a> · <a href="#limites">limites</a> · <a href="./guide.md">guia completo</a>
</p>

> Você está digitando, um worker se intromete, o leader acorda pela terceira vez, e aquela pergunta de agora há pouco, onde foi parar?

Você roda um multi-agent workflow no Herdr: um leader com alguns workers de Claude Code e Codex, cada um cuidando da sua parte. Sempre que um deles termina alguma coisa, joga o resultado na conversa do leader. Você está no meio de uma frase e um relatório se intromete e vai embora junto com ela; a pergunta de decisão que acabaram de te fazer é varrida pela mensagem seguinte.

**Antes**

![Sem caixa de correio: o relatório de um worker é digitado no prompt pela metade e enviado junto com ele; depois cada relatório e cada pergunta acordam o leader e o chat vai enchendo](./media/demo-before.gif)

O Mailbox dá uma caixa de correio ao leader. Além de mensagens comuns, que são como cartões-postais, os workers podem deixar cartões de decisão e cartões de discussão para você responder. As mensagens comuns entram num único lote, só quando você não está digitando e o leader está livre; os cartões ficam esperando na caixa até você responder com o mouse.

**Depois**

![Com caixa de correio: os relatórios esperam na caixa enquanto você digita, chegam num único lote, e as perguntas são respondidas com o mouse e devolvidas de uma só vez](./media/demo.gif)

- **Seu campo de texto continua sendo seu** — nada é digitado enquanto você digita, e nada chega enquanto o leader ainda está respondendo.
- **As mensagens comuns chegam juntas** — elas esperam até um minuto para entrar num único lote e acordar o leader uma vez só; **Send now** pula a espera.
- **Perguntas num só lugar** — as perguntas de decisão viram cartões ao lado do leader; responda com o mouse e envie todas as respostas de uma vez.
- **Qualquer agente pode escrever** — quem envia só executa `mailbox send`, então Claude Code, Codex e qualquer agente que consiga rodar um comando de shell escrevem na mesma caixa de correio.
- **Um recibo para cada envio** — cada envio devolve na hora o id da carta e o status dela.
- **Acompanha o leader** — mover o pane, reiniciar o Herdr ou limpar a conversa mantém a caixa de correio com o mesmo destinatário.

## Instalação

Requer Herdr 0.9.3 ou mais recente e Node 18 ou mais recente.

```sh
herdr plugin install navishachiku/herdr-mailbox
```

O resto da configuração (o comando `mailbox`, os hooks do Claude Code, o atalho e, se você usa Codex, uma regra) fica com o seu coding agent. Para o comando, os hooks e a regra do Codex ele executa `node <plugin dir>/src/setup.mjs install`; `uninstall` desfaz. Cole isto para ele:

```
Set up herdr-mailbox by following https://github.com/navishachiku/herdr-mailbox/blob/main/AGENT-SETUP.md
```

Quando ele terminar, recarregue o Herdr com `prefix+shift+r` e aperte `prefix+shift+m` no pane do leader para abrir a tela da caixa de correio ao lado (`prefix` é `ctrl+b`, a menos que você tenha mudado). Os passos que o agent segue estão em [AGENT-SETUP.md](../AGENT-SETUP.md).

## Enviar uma carta

```sh
mailbox send --to <address|MB-id> --type note "tests pass"

mailbox send --to <address|MB-id> --type decision \
  --question "Install the skill too?" --option "Yes" --option "No" --recommend A
```

Material mais longo vai junto com a carta como arquivo (`--attach <file>`); o cartão mostra um link e o arquivo abre ali mesmo, dentro da tela da caixa de correio.

![Um cartão de decisão com um relatório de testes anexado: ao clicar no link, o relatório abre numa caixa dentro da tela da caixa de correio](./media/attachment.png)

`--to` aceita um id de pane, um nome de agente ou um id de caixa de correio. Pressione `prefix+shift+m` no pane do leader para abrir a tela da caixa de correio ao lado dele. Perguntas de discussão, como editar e retirar cartas, e cada botão da tela estão no [guia completo](./guide.md).

## Limites

- Uma pergunta tem até 200 caracteres e uma mensagem comum até 500; textos mais longos vão num arquivo com `--attach`.
- O agente dono da caixa de correio (o leader) precisa ser o Claude Code, porque a entrega espera o campo de texto dele ficar vazio; quem envia pode ser qualquer agente.

<details>
<summary>Avançado: como funciona, estado, testes</summary>

### Como funciona

Um pequeno daemon é dono do arquivo de estado e trata um pedido por vez. A CLI conversa com ele por um socket local e o inicia quando ele não está rodando. O estado fica no diretório de estado de plugins do Herdr, fora do diretório do código do plugin, com uma versão de esquema, e é gravado em disco antes de o recibo ser devolvido. Cada sessão do Herdr tem seu próprio subdiretório, daemon e caixas de correio, então o mesmo endereço de pane em duas sessões nunca compartilha cartas.

| Peça | Papel |
| --- | --- |
| `src/daemon.mjs`, `src/core.mjs` | O daemon e as regras das cartas: recibos, deduplicação, editar e retirar, limites. |
| `src/identity.mjs` | Vincular uma caixa de correio a um destinatário, o laço de reconciliação, reivindicações. |
| `src/delivery.mjs`, `src/format.mjs`, `src/input-box.mjs` | Agrupamento em lotes, verificação do campo de texto, confirmação, texto do lote. |
| `src/screen/` | A tela da caixa de correio, com configurações e anexos exibidos dentro dela. |
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
