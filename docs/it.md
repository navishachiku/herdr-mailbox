# herdr-mailbox

![License](https://img.shields.io/badge/license-MIT-blue)
![Herdr 0.9.3+](https://img.shields.io/badge/herdr-0.9.3%2B-8a2be2)
![Platforms](https://img.shields.io/badge/platforms-macOS%20%E2%80%A2%20Linux%20%E2%80%A2%20Windows-informational)
![Runtime](https://img.shields.io/badge/runtime-Node%2018%2B-5fa04e)

[English](../README.md) | [简体中文](./zh-sc.md) | [繁體中文](./zh-tc.md) | [Español](./es.md) | [Português](./pt.md) | [Русский](./ru.md) | [日本語](./jp.md) | [Français](./fr.md) | [Deutsch](./de.md) | [Tiếng Việt](./vi.md) | [한국어](./ko.md) | [ไทย](./th.md) | [Italiano](./it.md)

<p align="center">
  <a href="#installazione">installazione</a> · <a href="#utilizzo">utilizzo</a> · <a href="#inviare-una-lettera">inviare una lettera</a> · <a href="#limiti">limiti</a> · <a href="./guide.md">guida completa</a>
</p>

> In un multi-agent workflow, ciò che conta di più sono la tua attenzione e le tue decisioni.

Usi un multi-agent workflow in Herdr: un agent leader con diversi agent worker, ognuno col suo compito. I loro report e messaggi sommergono la conversazione del leader. Sei a metà di una frase e un report si infila e parte insieme a lei; la domanda di decisione che ti avevano appena fatto viene spazzata via un secondo dopo dal messaggio successivo.

Questo plugin esiste proprio per risolvere questo: la tua attenzione resta ininterrotta, riservata alle decisioni di qualità che solo tu puoi prendere.

Non è una riedizione delle domande a opzioni di Claude Code (AskUserQuestion). Sfrutta ciò che offre Herdr per raccogliere in un unico posto i report e le domande in sospeso di agent di produttori diversi, unirli e coordinarli; e dato che la conversazione non viene più sommersa, risparmia anche l'utilizzo che quelle ondate costerebbero.

**Prima**

![Senza mailbox: il report di un worker viene digitato nel prompt scritto a metà e inviato con lui; poi ogni report e ogni domanda svegliano il leader e la chat si riempie](./media/demo-before.gif)

Mailbox dà una casella di posta al leader. Oltre ai messaggi normali, che sono come cartoline, i worker possono lasciarti schede di decisione e schede di discussione a cui rispondere. I messaggi normali entrano in un unico gruppo, solo quando non stai scrivendo e il leader è libero; le schede restano nella casella finché non rispondi con il mouse.

**Dopo**

![Con la mailbox: i report aspettano nella casella mentre scrivi, arrivano in un unico gruppo, e alle domande si risponde con il mouse e le risposte tornano tutte insieme](./media/demo.gif)

- **La tua casella di input resta tua** — niente viene digitato mentre scrivi tu, e niente arriva mentre il leader sta ancora rispondendo.
- **I messaggi normali arrivano insieme** — aspettano fino a un minuto per entrare in un unico gruppo e svegliare il leader una volta sola; **Invia ora** salta l'attesa.
- **Le domande in un solo posto** — le domande di decisione diventano schede accanto al leader; rispondi con il mouse e invia tutte le risposte in un colpo solo.
- **Qualsiasi agent può scrivere** — chi invia esegue soltanto `mailbox send`, quindi Claude Code, Codex, agy e qualsiasi agent capace di lanciare un comando di shell scrivono nella stessa casella.
- **Una ricevuta per ogni invio** — ogni invio restituisce subito l'id della lettera e il suo stato.
- **Segue il leader** — spostare il pane, riavviare Herdr o cancellare la conversazione lascia la casella con lo stesso destinatario.

## Installazione

Richiede Herdr 0.9.3 o successivo e Node 18 o successivo.

```sh
# 1. Installa il plugin
herdr plugin install navishachiku/herdr-mailbox

# 2. Esegui la sua azione setup: il comando `mailbox`, gli hook di Claude Code e le regole di autorizzazione di Codex e agy
herdr plugin action invoke setup --plugin herdr-mailbox

# 3. Le integrazioni degli agent proprie di Herdr, una per ogni agent che usi
herdr integration install claude
herdr integration install codex
herdr integration install antigravity-cli

# 4. La skill che insegna agli agent a inviare lettere
npx skills add navishachiku/herdr-mailbox
```

Un agent senza un sistema di skill può leggere le stesse istruzioni da `mailbox skill`; incolla il suo output nel file di istruzioni di quell'agent.

L'azione setup fa un backup di ogni file prima di modificarlo (`<file>.bak-<date>`), non aggiunge nulla due volte se rieseguita e continua a funzionare dopo `herdr plugin update`. `node <plugin dir>/src/setup.mjs uninstall` la annulla. Riavvia le sessioni di Claude Code che devono ricevere posta.

Aggiungi la scorciatoia al `config.toml` di Herdr (`~/.config/herdr/config.toml`; su Windows `%APPDATA%\herdr\config.toml`), poi ricarica con `prefix+shift+r` (`prefix` è `ctrl+b`, se non l'hai cambiato):

```toml
[[keys.command]]
key = "prefix+shift+m"
type = "plugin_action"
command = "herdr-mailbox.open"
description = "open the mailbox"

[ui.toast]
delivery = "herdr"
```

Se l'azione non funziona sulla tua macchina, [AGENT-SETUP.md](../AGENT-SETUP.md) riporta gli stessi passi da far seguire a un coding agent.

## Utilizzo

Apri la mailbox nella finestra del leader: seleziona il pane del leader e premi `prefix+shift+m`. La mailbox appartiene all'agent del pane su cui premi la scorciatoia, quindi premila su quello del leader, non su quello di un worker. La schermata della mailbox si apre accanto al leader; premere di nuovo la scorciatoia dall'interno della schermata, oppure `q`, la chiude, e le lettere restano.

- **Messaggi** — i messaggi normali dei worker aspettano qui ed entrano nel leader in un unico gruppo; **Invia ora** li invia subito.
- **Domande** — schede di decisione e di discussione. Clicca un'opzione o scrivi una nota, poi **Invia** restituisce tutte le risposte in un unico gruppo. **Accetta tutte**, **Chiedi tutte** e **Annulla tutte** agiscono su più schede insieme.
- **Opzioni** — larghezza della schermata, modalità delle schede, quanto aspettano i messaggi normali prima di essere uniti e la lingua della schermata (13 lingue).

Se la schermata non è aperta, una nuova domanda di decisione o di discussione mostra una notifica di Herdr con la domanda; con la schermata aperta non compare alcuna notifica. I worker scrivono al leader con `mailbox send`, descritto qui sotto.

**Rivendicare una mailbox**: quando la conversazione del leader viene sostituita, la mailbox si disconnette e le sue lettere restano. Esegui nel pane del nuovo agent la riga `mailbox claim MB-xxxx` mostrata nella schermata, e la mailbox torna connessa.

## Inviare una lettera

```sh
mailbox send --to <address|MB-id> --type note "tests pass"

mailbox send --to <address|MB-id> --type decision \
  --question "Install the skill too?" --option "Yes" --option "No" --recommend A
```

`--to` accetta un id di pane, un nome di agent o un id di mailbox. `--recommend` è facoltativo; una scheda senza non mostra alcuna opzione consigliata.

Il materiale più lungo viaggia con la lettera come file (`--attach <file>`, fino a 5 per lettera); la scheda mostra un link e, cliccandolo, il file si apre con il programma predefinito del sistema (un'immagine nel visualizzatore di immagini, un file di testo nella sua app predefinita). Gli indirizzi web in una domanda si aprono nel browser predefinito.

`--wait [--timeout <ms>]` fa sì che l'invio ritorni solo dopo che il leader ha preso la lettera e finito il suo turno. Se smette di aspettare esce con 3 o 4; in entrambi i casi una lettera a una mailbox è già in coda o consegnata, quindi non inviarla di nuovo. Una lettera a un pane senza mailbox viene firmata e digitata direttamente al suo interno una sola volta, subito. Le domande di discussione, la consultazione, la modifica e il ritiro delle lettere, e ogni pulsante della schermata sono nella [guida completa](./guide.md).

## Limiti

- Una domanda può avere al massimo 200 caratteri e un messaggio normale 500; i testi più lunghi vanno in un file con `--attach`.
- L'agent che possiede la mailbox (il leader) deve essere Claude Code o agy, perché la consegna aspetta che la sua casella di input sia vuota e solo quelle due caselle di input si possono leggere; chi invia può essere qualsiasi agent.

## Problemi noti

- **Codex: non può ancora possedere una mailbox.** Codex 0.163 esegue le sue conversazioni in un unico server in background condiviso, quindi l'integrazione Codex di Herdr attribuisce ogni conversazione al pane che ha avviato quel server, e il pane di Codex stesso non riceve mai un id di conversazione a cui collegare una mailbox. Codex può comunque inviare lettere, e un messaggio normale inviato a un pane di Codex senza mailbox viene firmato e digitato direttamente al suo interno una sola volta. L'id di pane di Codex in `HERDR_PANE_ID` può essere sbagliato, quindi un mittente Codex deve indicare il proprio pane con `--from <pane id>`.
- **agy: la skill non viene installata dove agy la legge.** La CLI `skills` non riesce a installare nella cartella da cui agy carica le skill, quindi `npx skills add` non la raggiunge. È un limite di quella CLI; la mailbox non lo aggira.
- **agy: vede la skill ma non usa la mailbox di sua iniziativa.** Se gli dici solo «fai rapporto ad agent-a», agy ricorre al suo strumento di messaggistica integrato invece di `mailbox send`. Nomina il comando nella richiesta («invialo con `mailbox send`»).

<details>
<summary>Avanzate: come funziona, stato, test</summary>

### Come funziona

Un piccolo daemon possiede il file di stato e gestisce una richiesta alla volta. La CLI gli parla tramite un socket locale e lo avvia quando non è in esecuzione. Lo stato vive nella directory di stato dei plugin di Herdr, fuori dalla directory del codice del plugin, con una versione dello schema, e viene scritto su disco prima che venga restituita la ricevuta. Ogni sessione di Herdr ha la propria sottodirectory, il proprio daemon e le proprie mailbox, quindi lo stesso indirizzo di pane in due sessioni non condivide mai le lettere.

| Componente | Ruolo |
| --- | --- |
| `src/daemon.mjs`, `src/core.mjs` | Il daemon e le regole delle lettere: ricevute, deduplicazione, modifica e ritiro, limiti. |
| `src/identity.mjs` | Collegare una mailbox a un destinatario, il ciclo di riconciliazione, rivendicazioni. |
| `src/delivery.mjs`, `src/format.mjs`, `src/input-box.mjs` | Raggruppamento in lotti, controllo della casella di input, conferma, testo del lotto. |
| `src/screen/` | La schermata della mailbox, con le impostazioni mostrate al suo interno; allegati e link vanno ai programmi predefiniti del sistema. |
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
