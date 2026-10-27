# herdr-mailbox

![License](https://img.shields.io/badge/license-MIT-blue)
![Herdr 0.9.3+](https://img.shields.io/badge/herdr-0.9.3%2B-8a2be2)
![Platforms](https://img.shields.io/badge/platforms-macOS%20%E2%80%A2%20Linux%20%E2%80%A2%20Windows-informational)
![Runtime](https://img.shields.io/badge/runtime-Node%2018%2B-5fa04e)

[English](./README.md) | [简体中文](./docs/zh-sc.md) | [繁體中文](./docs/zh-tc.md) | [Español](./docs/es.md) | [Português](./docs/pt.md) | [Русский](./docs/ru.md) | [日本語](./docs/jp.md) | [Français](./docs/fr.md) | [Deutsch](./docs/de.md) | [Tiếng Việt](./docs/vi.md) | [한국어](./docs/ko.md) | [ไทย](./docs/th.md) | [Italiano](./docs/it.md)

<p align="center">
  <a href="#install">install</a> · <a href="#usage">usage</a> · <a href="#sending-a-letter">sending a letter</a> · <a href="#limits">limits</a> · <a href="docs/guide.md">full guide</a>
</p>

> In a multi-agent workflow, your attention and your decisions are what matter most.

You run a multi-agent workflow in Herdr: one leader agent with several worker agents, each on its own job. Their reports and messages flood the leader's conversation. You're halfway through a sentence and a report cuts in and goes out with it; the decision question you were just asked is washed away by the next message a second later.

This plugin exists to fix exactly that: your attention stays unbroken, saved for the high-quality decisions that only you can make.

It is not Claude Code's option questions (AskUserQuestion) built again. It uses what Herdr offers to gather the reports and open questions of agents from different vendors in one place, merge them and coordinate them; and since the conversation is no longer flooded, it also saves the usage those floods would cost.

**Before**

![Without a mailbox: a worker's report is typed into the half-written prompt and sent with it, then every report and question wakes the leader and the chat fills up](docs/media/demo-before.gif)

Mailbox gives the leader a mailbox. Workers can drop in plain notes, like postcards, and also decision cards and discussion cards for you to answer. Notes go in as one batch, only when you are not typing and the leader is free; cards wait in the mailbox until you answer them with the mouse.

**After**

![With a mailbox: reports wait in the mailbox while you type, arrive as one batch, and the questions are answered with the mouse and sent back in one go](docs/media/demo.gif)

- **Your input box stays yours** — nothing is typed while you are typing, and nothing lands while the leader is still answering.
- **Notes arrive together** — notes wait up to a minute so they can go in as one batch and wake the leader once; **Send now** skips the wait.
- **Questions in one place** — decision questions become cards beside the leader; answer with the mouse and send every answer in one batch.
- **Any agent can write** — senders only run `mailbox send`, so Claude Code, Codex, agy and any agent that can run a shell command can write to the same mailbox.
- **A receipt for every send** — each send returns at once with the letter's id and status.
- **It follows the leader** — moving the pane, restarting Herdr or clearing the conversation keeps the mailbox with the same receiver.

## Install

Requires Herdr 0.9.3 or newer and Node 18 or newer.

```sh
# 1. Install the plugin
herdr plugin install navishachiku/herdr-mailbox

# 2. Run its setup action: the `mailbox` command, the Claude Code hooks, and the Codex and agy allow rules
herdr plugin action invoke setup --plugin herdr-mailbox

# 3. Herdr's own agent integrations, for each agent you use
herdr integration install claude
herdr integration install codex
herdr integration install antigravity-cli

# 4. The skill that teaches agents to send letters
npx skills add navishachiku/herdr-mailbox
```

An agent with no skill system can read the same instructions from `mailbox skill`; paste its output into the agent's instruction file.

The setup action backs up every file before it changes it (`<file>.bak-<date>`), adds nothing twice when run again, and keeps working after `herdr plugin update`. `node <plugin dir>/src/setup.mjs uninstall` reverts it. Restart the Claude Code sessions that should receive mail.

Add the shortcut to Herdr's `config.toml` (`~/.config/herdr/config.toml`; on Windows `%APPDATA%\herdr\config.toml`), then reload with `prefix+shift+r` (`prefix` is `ctrl+b` unless you changed it):

```toml
[[keys.command]]
key = "prefix+shift+m"
type = "plugin_action"
command = "herdr-mailbox.open"
description = "open the mailbox"

[ui.toast]
delivery = "herdr"
```

If the action does not work on your machine, [AGENT-SETUP.md](AGENT-SETUP.md) has the same steps for a coding agent to follow.

## Usage

Open the mailbox in the leader's window: focus the leader's pane and press `prefix+shift+m`. The mailbox belongs to the agent whose pane you press it on, so press it on the leader's, not on a worker's. The mailbox screen opens beside the leader; pressing the shortcut again from inside the screen, or `q`, closes it, and the letters stay.

- **Messages** — notes from workers wait here and go in to the leader as one batch; **Send now** sends them at once.
- **Questions** — decision and discussion cards. Click an option or write a note, then **Send** returns every answer in one batch. **Accept all**, **Ask all** and **Void all** act on many cards at once.
- **Options** — screen width, card mode, how long notes wait to be merged, and the screen language (13 languages).

When the screen is not open, a new decision or discussion question raises a Herdr notification with the question; while it is open, no notification is raised. Workers write to the leader with `mailbox send`, below.

**Claiming a mailbox**: when the leader's conversation is replaced, the mailbox disconnects and its letters stay. Run the `mailbox claim MB-xxxx` line shown on the screen in the new agent's pane, and the mailbox is connected again.

## Sending a letter

```sh
mailbox send --to <address|MB-id> --type note "tests pass"

mailbox send --to <address|MB-id> --type decision \
  --question "Install the skill too?" --option "Yes" --option "No" --recommend A
```

`--to` takes a pane id, an agent name or a mailbox id. `--recommend` is optional; a card without it shows no recommended option.

Longer material goes with the letter as a file (`--attach <file>`, up to 5 per letter); the card shows a link, and clicking it opens the file in your system's default program (an image in the image viewer, a text file in its default app). Web addresses in a question open in your default browser.

`--wait [--timeout <ms>]` makes the send return only after the leader has taken the letter and finished its turn. If it gives up waiting it exits with 3 or 4; a letter to a mailbox is queued or already delivered either way, so do not send it again. A letter to a pane that has no mailbox is signed and typed straight into it once, right away. Discussion questions, checking, editing and withdrawing letters, and every screen button are in [the full guide](docs/guide.md).

## Limits

- A question is up to 200 characters and a note up to 500; longer text goes in a file with `--attach`.
- The agent that owns the mailbox (the leader) has to be Claude Code or agy, because delivery waits until its input box is empty and only those two input boxes can be read; senders can be any agent.

## Known issues

- **Codex: it cannot own a mailbox yet.** Codex 0.163 runs its conversations in one shared background server, so Herdr's Codex integration reports every conversation to the pane that started that server, and the Codex pane itself never gets a conversation id to bind a mailbox to. Codex can still send letters, and a note sent to a Codex pane that has no mailbox is signed and typed straight into it once. Codex's pane id in `HERDR_PANE_ID` can be wrong, so a Codex sender must name its own pane with `--from <pane id>`.
- **agy: the skill is not installed where agy reads it.** The `skills` CLI cannot install into the folder agy loads skills from, so `npx skills add` does not reach it. This is a limit of that CLI; the mailbox does not work around it.
- **agy: it sees the skill but does not use the mailbox on its own.** Told only to "report to agent-a", agy reaches for its built-in messaging tool instead of `mailbox send`. Name the command in the request ("send it with `mailbox send`").

<details>
<summary>Advanced: how it works, state, tests</summary>

### How it works

A small daemon owns the state file and handles one request at a time. The CLI talks to it over a local socket and starts it when it is not running. State lives under Herdr's plugin state directory, outside the plugin code directory, with a schema version, and is written to disk before a receipt is returned. Each Herdr session gets its own subdirectory, daemon and mailboxes, so the same pane address in two sessions never shares letters.

| Piece | Role |
| --- | --- |
| `src/daemon.mjs`, `src/core.mjs` | The daemon and the letter rules: receipts, deduplication, edit and withdraw, limits. |
| `src/identity.mjs` | Binding a mailbox to a receiver, the reconcile loop, claims. |
| `src/delivery.mjs`, `src/format.mjs`, `src/input-box.mjs` | Batching, the input-box check, confirmation, batch text. |
| `src/screen/` | The mailbox screen, with settings shown inside it; attachments and links go to the system's default programs. |
| `src/open.mjs`, `src/on-focus.mjs` | The `prefix+shift+m` action and reopening the screen after a Herdr restart. |
| `src/session-start.mjs`, `src/prompt-submit.mjs`, `src/send-guard.mjs` | The Claude Code hooks. |

### Tests

```sh
npm test
```

Runs the real CLI and daemon against a fake `herdr` binary in a throwaway state directory.

</details>

## License

MIT
