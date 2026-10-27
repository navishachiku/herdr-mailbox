# herdr-mailbox

![License](https://img.shields.io/badge/license-MIT-blue)
![Herdr 0.9.3+](https://img.shields.io/badge/herdr-0.9.3%2B-8a2be2)
![Platforms](https://img.shields.io/badge/platforms-macOS%20%E2%80%A2%20Linux%20%E2%80%A2%20Windows-informational)
![Runtime](https://img.shields.io/badge/runtime-Node%2018%2B-5fa04e)

[English](../README.md) | [简体中文](./zh-sc.md) | [繁體中文](./zh-tc.md) | [Español](./es.md) | [Português](./pt.md) | [Русский](./ru.md) | [日本語](./jp.md) | [Français](./fr.md) | [Deutsch](./de.md) | [Tiếng Việt](./vi.md) | [한국어](./ko.md) | [ไทย](./th.md) | [Italiano](./it.md)

<p align="center">
  <a href="#installation">Installation</a> · <a href="#verwendung">Verwendung</a> · <a href="#einen-brief-senden">Brief senden</a> · <a href="#grenzen">Grenzen</a> · <a href="./guide.md">vollständige Anleitung</a>
</p>

> In einem multi-agent workflow zählen vor allem deine Aufmerksamkeit und deine Entscheidungen.

Du betreibst in Herdr einen multi-agent workflow: ein leader-Agent mit mehreren worker-Agents, jeder mit seiner eigenen Aufgabe. Ihre Berichte und Nachrichten überfluten die Unterhaltung des leaders. Du bist mitten im Satz, da platzt ein Bericht herein und wird gleich mitgeschickt; die Entscheidungsfrage, die dir eben gestellt wurde, ist eine Sekunde später von der nächsten Nachricht weggespült.

Genau dafür gibt es dieses Plugin: Deine Aufmerksamkeit bleibt ungestört und für die wirklich wichtigen Entscheidungen reserviert, die nur du treffen kannst.

Es baut nicht die Optionsfragen von Claude Code (AskUserQuestion) noch einmal nach. Es nutzt, was Herdr bietet, um die Berichte und offenen Fragen von Agents verschiedener Anbieter an einem Ort zu sammeln, zusammenzuführen und abzustimmen; und weil die Unterhaltung nicht mehr überflutet wird, spart es auch den Verbrauch, den diese Fluten kosten würden.

**Vorher**

![Ohne Mailbox: Der Bericht eines workers wird in den halb geschriebenen Prompt getippt und mit abgeschickt, danach weckt jeder Bericht und jede Frage den leader, und der Chat läuft voll](./media/demo-before.gif)

Mailbox gibt dem leader einen Briefkasten. Die worker können dort normale Nachrichten einwerfen, wie Postkarten, und außerdem Entscheidungskarten und Diskussionskarten, die du beantwortest. Normale Nachrichten gehen als ein Paket hinein, nur wenn du nicht tippst und der leader Zeit hat; Karten bleiben im Briefkasten liegen, bis du sie mit der Maus beantwortest.

**Nachher**

![Mit Mailbox: Berichte warten im Briefkasten, während du tippst, kommen als ein Paket an, und die Fragen werden mit der Maus beantwortet und in einem Rutsch zurückgeschickt](./media/demo.gif)

- **Dein Eingabefeld gehört dir** — während du tippst, wird nichts hineingeschrieben, und solange der leader noch antwortet, kommt auch nichts an.
- **Normale Nachrichten kommen zusammen** — normale Nachrichten warten bis zu einer Minute, damit sie als ein Paket hineingehen und den leader nur einmal wecken; mit **Jetzt senden** entfällt das Warten.
- **Fragen an einem Ort** — Entscheidungsfragen werden zu Karten neben dem leader; beantworte sie mit der Maus, und alle Antworten gehen in einem Paket zurück.
- **Jeder Agent kann schreiben** — Absender führen nur `mailbox send` aus, also können Claude Code, Codex, agy und jeder Agent, der einen Shell-Befehl ausführen kann, in denselben Briefkasten schreiben.
- **Eine Quittung für jeden Versand** — jeder Versand liefert sofort die ID und den Status des Briefs zurück.
- **Er folgt dem leader** — Pane verschieben, Herdr neu starten oder die Unterhaltung leeren: Der Briefkasten bleibt beim selben Empfänger.

## Installation

Benötigt Herdr 0.9.3 oder neuer und Node 18 oder neuer.

```sh
# 1. Das Plugin installieren
herdr plugin install navishachiku/herdr-mailbox

# 2. Seine setup-Aktion ausführen: der Befehl `mailbox`, die Claude-Code-Hooks und die Freigaberegeln für Codex und agy
herdr plugin action invoke setup --plugin herdr-mailbox

# 3. Herdrs eigene Agent-Integrationen, für jeden Agent, den du nutzt
herdr integration install claude
herdr integration install codex
herdr integration install antigravity-cli

# 4. Der Skill, der Agents das Senden von Briefen beibringt
npx skills add navishachiku/herdr-mailbox
```

Ein Agent ohne Skill-System kann dieselbe Anleitung über `mailbox skill` lesen; füge die Ausgabe in die Anweisungsdatei des Agents ein.

Die setup-Aktion sichert jede Datei, bevor sie sie ändert (`<file>.bak-<date>`), fügt bei erneutem Ausführen nichts doppelt hinzu und funktioniert auch nach `herdr plugin update` weiter. `node <plugin dir>/src/setup.mjs uninstall` macht sie rückgängig. Starte die Claude-Code-Sessions neu, die Post empfangen sollen.

Trage das Tastenkürzel in Herdrs `config.toml` ein (`~/.config/herdr/config.toml`; unter Windows `%APPDATA%\herdr\config.toml`) und lade dann mit `prefix+shift+r` neu (`prefix` ist `ctrl+b`, sofern du es nicht geändert hast):

```toml
[[keys.command]]
key = "prefix+shift+m"
type = "plugin_action"
command = "herdr-mailbox.open"
description = "open the mailbox"

[ui.toast]
delivery = "herdr"
```

Funktioniert die Aktion auf deinem Rechner nicht, findest du in [AGENT-SETUP.md](../AGENT-SETUP.md) dieselben Schritte, die ein Coding-Agent für dich ausführen kann.

## Verwendung

Öffne den Briefkasten im Fenster des leaders: Wähle das Pane des leaders und drücke `prefix+shift+m`. Der Briefkasten gehört dem Agent, in dessen Pane du das Kürzel drückst, also drücke es im Pane des leaders, nicht in dem eines workers. Der Briefkasten-Bildschirm öffnet sich neben dem leader; erneutes Drücken des Kürzels im Bildschirm oder `q` schließt ihn, und die Briefe bleiben erhalten.

- **Nachrichten** — normale Nachrichten der worker warten hier und gehen als ein Paket an den leader; **Jetzt senden** schickt sie sofort.
- **Fragen** — Entscheidungs- und Diskussionskarten. Klicke eine Option an oder schreibe eine Notiz, dann schickt **Senden** alle Antworten in einem Paket zurück. **Alle annehmen**, **Alle nachfragen** und **Alle verwerfen** wirken auf viele Karten auf einmal.
- **Optionen** — Breite des Bildschirms, Kartenmodus, wie lange normale Nachrichten bis zum Zusammenführen warten, und die Sprache des Bildschirms (13 Sprachen).

Ist der Bildschirm nicht geöffnet, löst eine neue Entscheidungs- oder Diskussionsfrage eine Herdr-Benachrichtigung mit der Frage aus; bei geöffnetem Bildschirm gibt es keine. Die worker schreiben dem leader mit `mailbox send`, siehe unten.

**Einen Briefkasten übernehmen**: Wird die Unterhaltung des leaders ersetzt, trennt sich der Briefkasten, und seine Briefe bleiben erhalten. Führe die auf dem Bildschirm angezeigte Zeile `mailbox claim MB-xxxx` im Pane des neuen Agents aus, und der Briefkasten ist wieder verbunden.

## Einen Brief senden

```sh
mailbox send --to <address|MB-id> --type note "tests pass"

mailbox send --to <address|MB-id> --type decision \
  --question "Install the skill too?" --option "Yes" --option "No" --recommend A
```

`--to` akzeptiert eine Pane-ID, einen Agent-Namen oder eine Mailbox-ID. `--recommend` ist optional; eine Karte ohne diese Angabe zeigt keine empfohlene Option.

Längere Inhalte hängst du als Datei an den Brief an (`--attach <file>`, bis zu 5 pro Brief); die Karte zeigt einen Link, und ein Klick öffnet die Datei im Standardprogramm deines Systems (ein Bild im Bildbetrachter, eine Textdatei in ihrer Standard-App). Webadressen in einer Frage öffnen sich im Standardbrowser.

Mit `--wait [--timeout <ms>]` kehrt der Versand erst zurück, wenn der leader den Brief angenommen und seinen Zug beendet hat. Gibt er das Warten auf, endet er mit 3 oder 4; ein Brief an einen Briefkasten ist in beiden Fällen eingereiht oder schon zugestellt, also schicke ihn nicht noch einmal. Ein Brief an ein Pane ohne Briefkasten wird signiert und sofort einmal direkt hineingetippt. Diskussionsfragen, das Abfragen, Bearbeiten und Zurückziehen von Briefen und jede Schaltfläche des Bildschirms stehen in der [vollständigen Anleitung](./guide.md).

## Grenzen

- Eine Frage darf höchstens 200 Zeichen lang sein, eine normale Nachricht höchstens 500; längerer Text gehört mit `--attach` in eine Datei.
- Der Agent, dem der Briefkasten gehört (der leader), muss Claude Code oder agy sein, weil die Zustellung wartet, bis sein Eingabefeld leer ist, und sich nur diese beiden Eingabefelder auslesen lassen; Absender können beliebige Agents sein.

## Bekannte Probleme

- **Codex: kann noch keinen Briefkasten besitzen.** Codex 0.163 führt seine Unterhaltungen in einem gemeinsamen Hintergrundserver aus, daher meldet Herdrs Codex-Integration jede Unterhaltung an das Pane, das diesen Server gestartet hat, und das Codex-Pane selbst bekommt nie eine Unterhaltungs-ID, an die sich ein Briefkasten binden ließe. Codex kann trotzdem Briefe senden, und eine normale Nachricht an ein Codex-Pane ohne Briefkasten wird signiert und einmal direkt hineingetippt. Die Pane-ID von Codex in `HERDR_PANE_ID` kann falsch sein, deshalb muss ein Codex-Absender sein eigenes Pane mit `--from <pane id>` angeben.
- **agy: der Skill landet nicht dort, wo agy ihn liest.** Die `skills`-CLI kann nicht in den Ordner installieren, aus dem agy Skills lädt, daher erreicht `npx skills add` ihn nicht. Das ist eine Grenze dieser CLI; der Briefkasten umgeht sie nicht.
- **agy: sieht den Skill, nutzt den Briefkasten aber nicht von selbst.** Sagt man ihm nur „berichte an agent-a“, greift agy zu seinem eingebauten Nachrichtenwerkzeug statt zu `mailbox send`. Nenne den Befehl in der Anfrage („schick es mit `mailbox send`“).

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
