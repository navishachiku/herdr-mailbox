# herdr-mailbox

![License](https://img.shields.io/badge/license-MIT-blue)
![Herdr 0.9.3+](https://img.shields.io/badge/herdr-0.9.3%2B-8a2be2)
![Platforms](https://img.shields.io/badge/platforms-macOS%20%E2%80%A2%20Linux%20%E2%80%A2%20Windows-informational)
![Runtime](https://img.shields.io/badge/runtime-Node%2018%2B-5fa04e)

[English](../README.md) | [简体中文](./zh-sc.md) | [繁體中文](./zh-tc.md) | [Español](./es.md) | [Português](./pt.md) | [Русский](./ru.md) | [日本語](./jp.md) | [Français](./fr.md) | [Deutsch](./de.md) | [Tiếng Việt](./vi.md) | [한국어](./ko.md) | [ไทย](./th.md) | [Italiano](./it.md)

<p align="center">
  <a href="#installazione">installazione</a> · <a href="#inviare-una-lettera">inviare una lettera</a> · <a href="#limiti">limiti</a> · <a href="./guide.md">guida completa</a>
</p>

> Stai scrivendo, un worker si intromette, il leader si sveglia per la terza volta, e quella domanda di prima, dov'è finita?

Usi un multi-agent workflow in Herdr: un leader con alcuni worker su Claude Code e Codex, ognuno col suo compito. Ogni volta che uno finisce qualcosa, lo butta nella conversazione del leader. Sei a metà di una frase e un report si infila e parte insieme a lei; la domanda di decisione che ti avevano appena fatto viene spazzata via dal messaggio successivo.

**Prima**

![Senza mailbox: il report di un worker viene digitato nel prompt scritto a metà e inviato con lui; poi ogni report e ogni domanda svegliano il leader e la chat si riempie](./media/demo-before.gif)

Mailbox dà una casella di posta al leader. Oltre ai messaggi normali, che sono come cartoline, i worker possono lasciarti schede di decisione e schede di discussione a cui rispondere. I messaggi normali entrano in un unico gruppo, solo quando non stai scrivendo e il leader è libero; le schede restano nella casella finché non rispondi con il mouse.

**Dopo**

![Con la mailbox: i report aspettano nella casella mentre scrivi, arrivano in un unico gruppo, e alle domande si risponde con il mouse e le risposte tornano tutte insieme](./media/demo.gif)

- **La tua casella di input resta tua** — niente viene digitato mentre scrivi tu, e niente arriva mentre il leader sta ancora rispondendo.
- **I messaggi normali arrivano insieme** — aspettano fino a un minuto per entrare in un unico gruppo e svegliare il leader una volta sola; **Invia ora** salta l'attesa.
- **Le domande in un solo posto** — le domande di decisione diventano schede accanto al leader; rispondi con il mouse e invia tutte le risposte in un colpo solo.
- **Qualsiasi agent può scrivere** — chi invia esegue soltanto `mailbox send`, quindi Claude Code, Codex e qualsiasi agent capace di lanciare un comando di shell scrivono nella stessa casella.
- **Una ricevuta per ogni invio** — ogni invio restituisce subito l'id della lettera e il suo stato.
- **Segue il leader** — spostare il pane, riavviare Herdr o cancellare la conversazione lascia la casella con lo stesso destinatario.

## Installazione

Richiede Herdr 0.9.3 o successivo e Node 18 o successivo.

```sh
herdr plugin install navishachiku/herdr-mailbox
```

Il resto della configurazione (il comando `mailbox`, gli hook di Claude Code, la scorciatoia e, se usi Codex, una regola) lascialo al tuo coding agent. Per il comando, gli hook e la regola di Codex esegue `node <plugin dir>/src/setup.mjs install`; `uninstall` li annulla. Incollagli questo:

```
Set up herdr-mailbox by following https://github.com/navishachiku/herdr-mailbox/blob/main/AGENT-SETUP.md
```

Quando ha finito, ricarica Herdr con `prefix+shift+r` e premi `prefix+shift+m` sul pane del leader per aprire accanto la schermata della mailbox (`prefix` è `ctrl+b`, se non l'hai cambiato). I passi che l'agent segue sono in [AGENT-SETUP.md](../AGENT-SETUP.md).

## Inviare una lettera

```sh
mailbox send --to <address|MB-id> --type note "tests pass"

mailbox send --to <address|MB-id> --type decision \
  --question "Install the skill too?" --option "Yes" --option "No" --recommend A
```

Il materiale più lungo viaggia con la lettera come file (`--attach <file>`); la scheda mostra un link e il file si apre direttamente nella schermata della mailbox.

![Una scheda di decisione con un report di test allegato: cliccando il link, il report si apre in un riquadro dentro la schermata della mailbox](./media/attachment.png)

`--to` accetta un id di pane, un nome di agent o un id di mailbox. Premi `prefix+shift+m` sul pane del leader per aprire la schermata della mailbox accanto a lui. Le domande di discussione, la modifica e il ritiro delle lettere, e ogni pulsante della schermata sono nella [guida completa](./guide.md).

## Limiti

- Una domanda può avere al massimo 200 caratteri e un messaggio normale 500; i testi più lunghi vanno in un file con `--attach`.
- L'agent che possiede la mailbox (il leader) deve essere Claude Code, perché la consegna aspetta che la sua casella di input sia vuota; chi invia può essere qualsiasi agent.

<details>
<summary>Avanzate: come funziona, stato, test</summary>

### Come funziona

Un piccolo daemon possiede il file di stato e gestisce una richiesta alla volta. La CLI gli parla tramite un socket locale e lo avvia quando non è in esecuzione. Lo stato vive nella directory di stato dei plugin di Herdr, fuori dalla directory del codice del plugin, con una versione dello schema, e viene scritto su disco prima che venga restituita la ricevuta. Ogni sessione di Herdr ha la propria sottodirectory, il proprio daemon e le proprie mailbox, quindi lo stesso indirizzo di pane in due sessioni non condivide mai le lettere.

| Componente | Ruolo |
| --- | --- |
| `src/daemon.mjs`, `src/core.mjs` | Il daemon e le regole delle lettere: ricevute, deduplicazione, modifica e ritiro, limiti. |
| `src/identity.mjs` | Collegare una mailbox a un destinatario, il ciclo di riconciliazione, rivendicazioni. |
| `src/delivery.mjs`, `src/format.mjs`, `src/input-box.mjs` | Raggruppamento in lotti, controllo della casella di input, conferma, testo del lotto. |
| `src/screen/` | La schermata della mailbox, con impostazioni e allegati mostrati al suo interno. |
| `src/open.mjs`, `src/on-focus.mjs` | L'azione `prefix+shift+m` e la riapertura della schermata dopo un riavvio di Herdr. |
| `src/session-start.mjs`, `src/prompt-submit.mjs`, `src/send-guard.mjs` | Gli hook di Claude Code. |

### Test

```sh
npm test
```

Esegue la vera CLI e il vero daemon contro un binario `herdr` finto, in una directory di stato usa e getta.

</details>

## Licenza

MIT
