# herdr-mailbox

![License](https://img.shields.io/badge/license-MIT-blue)
![Herdr 0.9.3+](https://img.shields.io/badge/herdr-0.9.3%2B-8a2be2)
![Platforms](https://img.shields.io/badge/platforms-macOS%20%E2%80%A2%20Linux%20%E2%80%A2%20Windows-informational)
![Runtime](https://img.shields.io/badge/runtime-Node%2018%2B-5fa04e)

[English](../README.md) | [简体中文](./zh-sc.md) | [繁體中文](./zh-tc.md) | [Español](./es.md) | [Português](./pt.md) | [Русский](./ru.md) | [日本語](./jp.md) | [Français](./fr.md) | [Deutsch](./de.md) | [Tiếng Việt](./vi.md) | [한국어](./ko.md) | [ไทย](./th.md) | [Italiano](./it.md)

<p align="center">
  <a href="#installation">Installation</a> · <a href="#einen-brief-senden">Brief senden</a> · <a href="#grenzen">Grenzen</a> · <a href="./guide.md">vollständige Anleitung</a>
</p>

> Du tippst gerade, ein worker grätscht dazwischen, der leader wird zum dritten Mal geweckt, und wo ist eigentlich die Frage von vorhin hin?

Du betreibst in Herdr einen multi-agent workflow: ein leader, dazu ein paar worker auf Claude Code und Codex, jeder mit seiner eigenen Aufgabe. Sobald einer etwas fertig hat, wirft er es in die Unterhaltung des leaders. Du bist mitten im Satz, da platzt ein Bericht herein und wird gleich mitgeschickt; die Entscheidungsfrage, die dir eben gestellt wurde, ist von der nächsten Nachricht weggespült.

**Vorher**

![Ohne Mailbox: Der Bericht eines workers wird in den halb geschriebenen Prompt getippt und mit abgeschickt, danach weckt jeder Bericht und jede Frage den leader, und der Chat läuft voll](./media/demo-before.gif)

Mailbox gibt dem leader einen Briefkasten. Die worker können dort normale Nachrichten einwerfen, wie Postkarten, und außerdem Entscheidungskarten und Diskussionskarten, die du beantwortest. Normale Nachrichten gehen als ein Paket hinein, nur wenn du nicht tippst und der leader Zeit hat; Karten bleiben im Briefkasten liegen, bis du sie mit der Maus beantwortest.

**Nachher**

![Mit Mailbox: Berichte warten im Briefkasten, während du tippst, kommen als ein Paket an, und die Fragen werden mit der Maus beantwortet und in einem Rutsch zurückgeschickt](./media/demo.gif)

- **Dein Eingabefeld gehört dir** — während du tippst, wird nichts hineingeschrieben, und solange der leader noch antwortet, kommt auch nichts an.
- **Normale Nachrichten kommen zusammen** — normale Nachrichten warten bis zu einer Minute, damit sie als ein Paket hineingehen und den leader nur einmal wecken; mit **Jetzt senden** entfällt das Warten.
- **Fragen an einem Ort** — Entscheidungsfragen werden zu Karten neben dem leader; beantworte sie mit der Maus, und alle Antworten gehen in einem Paket zurück.
- **Jeder Agent kann schreiben** — Absender führen nur `mailbox send` aus, also können Claude Code, Codex und jeder Agent, der einen Shell-Befehl ausführen kann, in denselben Briefkasten schreiben.
- **Eine Quittung für jeden Versand** — jeder Versand liefert sofort die ID und den Status des Briefs zurück.
- **Er folgt dem leader** — Pane verschieben, Herdr neu starten oder die Unterhaltung leeren: Der Briefkasten bleibt beim selben Empfänger.

## Installation

Benötigt Herdr 0.9.3 oder neuer und Node 18 oder neuer.

```sh
herdr plugin install navishachiku/herdr-mailbox
```

Den Rest der Einrichtung (den Befehl `mailbox`, die Claude-Code-Hooks, das Tastenkürzel und, falls du Codex nutzt, eine Regel) überlässt du deinem Coding-Agent. Für den Befehl, die Hooks und die Codex-Regel führt er `node <plugin dir>/src/setup.mjs install` aus; `uninstall` macht das rückgängig. Gib ihm diesen Satz:

```
Set up herdr-mailbox by following https://github.com/navishachiku/herdr-mailbox/blob/main/AGENT-SETUP.md
```

Danach lädst du Herdr mit `prefix+shift+r` neu und öffnest mit `prefix+shift+m` im Pane des Leaders den Briefkasten-Bildschirm daneben (`prefix` ist `ctrl+b`, sofern du es nicht geändert hast). Die Schritte für den Agent stehen in [AGENT-SETUP.md](../AGENT-SETUP.md).

## Einen Brief senden

```sh
mailbox send --to <address|MB-id> --type note "tests pass"

mailbox send --to <address|MB-id> --type decision \
  --question "Install the skill too?" --option "Yes" --option "No" --recommend A
```

Längere Inhalte hängst du als Datei an den Brief an (`--attach <file>`); die Karte zeigt einen Link; ein Klick öffnet die Datei im Standardprogramm deines Systems (ein Bild im Bildbetrachter, eine Textdatei in ihrer Standard-App). Webadressen in einer Frage öffnen sich im Standardbrowser.

`--to` akzeptiert eine Pane-ID, einen Agent-Namen oder eine Mailbox-ID. Drücke `prefix+shift+m` im Pane des leaders, um den Briefkasten-Bildschirm daneben zu öffnen. Diskussionsfragen, das Bearbeiten und Zurückziehen von Briefen und jede Schaltfläche des Bildschirms stehen in der [vollständigen Anleitung](./guide.md).

## Grenzen

- Eine Frage darf höchstens 200 Zeichen lang sein, eine normale Nachricht höchstens 500; längerer Text gehört mit `--attach` in eine Datei.
- Der Agent, dem der Briefkasten gehört (der leader), muss Claude Code sein, weil die Zustellung wartet, bis sein Eingabefeld leer ist; Absender können beliebige Agents sein.

<details>
<summary>Für Fortgeschrittene: Funktionsweise, Zustand, Tests</summary>

### Funktionsweise

Ein kleiner Daemon besitzt die Zustandsdatei und bearbeitet jeweils eine Anfrage. Die CLI spricht über einen lokalen Socket mit ihm und startet ihn, wenn er nicht läuft. Der Zustand liegt im Plugin-Zustandsverzeichnis von Herdr, außerhalb des Plugin-Codeverzeichnisses, mit einer Schema-Version, und wird auf die Platte geschrieben, bevor eine Quittung zurückgegeben wird. Jede Herdr-Session hat ihr eigenes Unterverzeichnis, ihren eigenen Daemon und ihre eigenen Briefkästen, sodass dieselbe Pane-Adresse in zwei Sessions nie Briefe teilt.

| Baustein | Aufgabe |
| --- | --- |
| `src/daemon.mjs`, `src/core.mjs` | Der Daemon und die Briefregeln: Quittungen, Deduplizierung, Bearbeiten und Zurückziehen, Limits. |
| `src/identity.mjs` | Einen Briefkasten an einen Empfänger binden, die Abgleichsschleife, Übernahmen. |
| `src/delivery.mjs`, `src/format.mjs`, `src/input-box.mjs` | Bündelung, Prüfung des Eingabefelds, Bestätigung, Text des Pakets. |
| `src/screen/` | Der Briefkasten-Bildschirm, mit darin angezeigten Einstellungen; Anhänge und Links gehen an die Standardprogramme des Systems. |
| `src/open.mjs`, `src/on-focus.mjs` | Die Aktion `prefix+shift+m` und das erneute Öffnen des Bildschirms nach einem Herdr-Neustart. |
| `src/session-start.mjs`, `src/prompt-submit.mjs`, `src/send-guard.mjs` | Die Claude-Code-Hooks. |

### Tests

```sh
npm test
```

Startet die echte CLI und den echten Daemon gegen eine Fake-`herdr`-Binärdatei in einem Wegwerf-Zustandsverzeichnis.

</details>

## Lizenz

MIT
