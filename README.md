# herdr-mailbox

![License](https://img.shields.io/badge/license-MIT-blue)
![Herdr 0.9.3+](https://img.shields.io/badge/herdr-0.9.3%2B-8a2be2)
![Platforms](https://img.shields.io/badge/platforms-macOS%20%E2%80%A2%20Linux-informational)
![Runtime](https://img.shields.io/badge/runtime-Node%2018%2B-5fa04e)

<p align="center">
  <a href="#install">install</a> · <a href="#sending-a-letter">sending a letter</a> · <a href="#the-mailbox-screen">the mailbox screen</a> · <a href="#delivery">delivery</a> · <a href="#limits">limits</a>
</p>

> Ever had a receiving agent's conversation washed away by every worker report?

In a Herdr multi-agent workflow, workers report into one agent's conversation one message at a time. Each report wakes that agent for a turn, and the questions you have not answered yet get pushed out of view.

Mailbox gives each receiving agent a mailbox. Other agents send letters to it, every send returns a receipt at once, and the mailbox delivers the letters to the agent in batches, when its input box is empty.

- **Three kinds of letter** — a note, a decision question (2 to 4 options, a recommended one is required) and a discussion question.
- **A receipt for every send** — the letter's uid, its status, and the letters you sent to that mailbox that are still open.
- **Batched delivery** — notes wait and arrive together; nothing is typed while someone is typing.
- **A mailbox screen** — press `prefix+shift+m` for a panel beside the agent where you answer questions with the mouse and send all answers back in one batch.
- **It follows the agent** — moving the pane, restarting Herdr or clearing the conversation keeps the mailbox with the same receiver.
- **No double sends** — an identical letter within 30 seconds is not created again, and neither is an identical unanswered decision question from the same sender.
- **Change your mind, until you answer** — edit, withdraw or supersede a question; once you have answered, the answer is locked in.

## Install

Requires Herdr 0.9.3 or newer and Node 18 or newer.

```sh
herdr plugin install navishachiku/herdr-mailbox
```

Bind a key in `~/.config/herdr/config.toml` and reload with `prefix+shift+r`:

```toml
[[keys.command]]
key = "prefix+shift+m"
type = "plugin_action"
command = "herdr-mailbox.open"
description = "open the mailbox"

# Notifications are off by default; the screen's notices need this.
[ui.toast]
delivery = "herdr"
```

`prefix` is `ctrl+b` unless you changed it.

### The `mailbox` command

Agents call `mailbox send …`, so `mailbox` has to be on the `PATH`. If you deploy Herdr with jockey and keep the `herdr-mailbox` option, it puts a small launcher at `~/.local/bin/mailbox` that finds the installed plugin and runs its `src/mailbox.mjs`. Windows is not supported.

By hand, link the entry file onto your `PATH` yourself (`<plugin dir>` is the `plugin_root` that `herdr plugin list --json` reports for `herdr-mailbox`):

```sh
chmod +x <plugin dir>/src/mailbox.mjs
ln -s <plugin dir>/src/mailbox.mjs ~/.local/bin/mailbox
```

Without a link, run it as `node <plugin dir>/src/mailbox.mjs`.

### Claude Code hooks

Three hooks in `~/.claude/settings.json` connect Claude Code to the mailbox. The hooks run files inside the plugin folder, which is the folder of the `plugin_root` that `herdr plugin list --json` reports for `plugin_id` `herdr-mailbox`.

| Hook | Matcher | File | What it does |
| --- | --- | --- | --- |
| `SessionStart` | `startup\|resume\|clear\|compact` | `src/session-start.mjs` | Records which conversation lives in the pane, so the mailbox can tell a cleared conversation from a different one. |
| `UserPromptSubmit` | none | `src/prompt-submit.mjs` | A Claude receiver gets mailbox batches as short text (who wrote what, plus a batch code in the first line). This hook looks the code up and adds the rest as background context: the warning that the messages come from other agents and are not the user's instructions, each letter's uid and serial, the sender's window and the sender's mailbox for replies. **Without this hook registered, the receiver never sees that warning or the reply addresses.** |
| `PreToolUse` | `Bash` | `src/send-guard.mjs` | Rewrites a plain `herdr agent prompt <target> "<text>"` into `mailbox send --to <target> --type note "<text>"`, and protects `--wait` dispatches from landing on top of someone's typing. |

```json
{
  "hooks": {
    "SessionStart": [
      { "matcher": "startup|resume|clear|compact",
        "hooks": [{ "type": "command", "command": "node <plugin dir>/src/session-start.mjs", "timeout": 10 }] }
    ],
    "UserPromptSubmit": [
      { "hooks": [{ "type": "command", "command": "node <plugin dir>/src/prompt-submit.mjs", "timeout": 10 }] }
    ],
    "PreToolUse": [
      { "matcher": "Bash",
        "hooks": [{ "type": "command", "command": "node <plugin dir>/src/send-guard.mjs", "timeout": 10 }] }
    ]
  }
}
```

All three hooks exit quietly on any error, so a broken hook never fails a tool call. The send guard rewrites only the plain form above (one literal argument, no `$` or backticks, nothing else in the command); any other `herdr agent prompt` to an agent is blocked with the `mailbox send` command to use instead.

### Codex

Codex runs shell commands in a sandbox where the mailbox daemon cannot start. Allow the `mailbox` command (see above) with an execution rule in `~/.codex/rules/default.rules`:

```
prefix_rule(pattern=["mailbox"], decision="allow")
```

The rule matches the command prefix, so `send`, `status`, `edit` and `withdraw` are all allowed. Codex has no hook to rewrite `herdr agent prompt`, so a Codex agent has to call `mailbox send` itself.

## Sending a letter

```sh
mailbox send --to <address|MB-id> --type note "tests pass"

mailbox send --to <address|MB-id> --type decision \
  --question "Install the skill too?" --option "Yes" --option "No" --recommend A

mailbox send --to <address|MB-id> --type discussion \
  --question "Split the README?" --idea "One file is enough"
```

`--to` takes a pane id, an agent name or a mailbox id (`MB-…`). Optional on any send: `--priority high|medium|low`, `--tag <t>`, `--attach <file>`, and `--supersedes <uid>` on a question.

Every send prints one JSON line and exits 0 only when it says `ok`:

```json
{"ok":true,"uid":"01M5AK72N73NXCHN7M5YXNMSES","serial":"N001","status":"queued","version":1,"pending":[…]}
```

```sh
mailbox status [--to <address|MB-id>]        # your letters that are still open; with --to also that mailbox's id
mailbox edit <uid> --question "..."          # only while the user has not answered
mailbox withdraw <uid> --reason "..."        # only while the user has not answered
```

The sender is the pane in `HERDR_PANE_ID`, or `--from`. Letters are named by uid; the short serial shown on the screen (for example `Q003`) is refused by every command. When the same send may or may not have gone through, run `mailbox status` before sending again.

Messages are signed `[workspace/]position/role 💬 ` from the sender pane's labels. When the sender owns a mailbox itself, the delivered text ends with the id to reply to.

## The mailbox screen

`prefix+shift+m` on a receiving agent's pane opens the screen in a split to its right, 48 columns wide by default, without taking focus. If it is already open, `prefix+shift+m` focuses it, and pressed from inside the screen it closes it. `q` in the screen and `mailbox close` also close it. Closing hides the screen only; letters and drafts stay. The text follows the system language (English or Traditional Chinese).

- **Messages** — up to four queued notes, why delivery is paused (typing, unreadable input box, receiver working or unverified), and **Send now**. A batch whose arrival could not be confirmed shows **Mark delivered** and **Resend (may duplicate)**.
- **Questions** — cards sorted by priority, then arrival. A card shows the question, its options with the recommended one marked, and a note field. Click an option, or use **Accept** or **Ask**. A note alone, with no option, is an answer too. **Void** sends a question back at once as "no answer needed".
- **Batch answers** — **Accept all** and **Ask all** apply to the decision questions still unanswered, and **Reset all** clears the drafts. **Void all** does the same for every unsent question, drafts included, after you confirm how many.
- **Send** — sends your answers back to the agent as a single batch. It is greyed out, with the reason, while the agent's input box has text or cannot be read, so an answer never lands on top of a draft.
- **Attachments** — a letter with an attachment shows a link that opens the full text in a box inside the mailbox screen; arrow keys and the wheel scroll, **Close** or `Esc` closes.
- **Options** — the **Options** button opens **Mailbox settings** in a box inside the mailbox screen: width (24 to 80 columns in steps of 4; applies the next time the screen opens), card mode (detailed or compact), the merge interval for notes in seconds (default 60), and **Tooltip stays (s)**, how long the full text of cut-off text stays shown while the pointer rests on it (5 to 60 seconds in steps of 5, default 15). Changes are saved at once and shared by every Herdr session; **Close** or `Esc` closes the box. No Herdr popup is used, so the screen looks the same in a terminal and in the web interface.

The screen is written for the mouse: clicking a text field gives it the keyboard, and Enter or leaving the field saves it. Pane focus returns to the receiver after a button press. The screen redraws only the rows that changed, so a delivery on the left does not disturb a field you are typing in. After a Herdr restart the screen reopens the next time you focus its receiver. A pressed button turns into a disabled "Processing…" at once; sending and voiding then show the result for two seconds, or why they failed. Text cut off with "…" shows in full in a box when the pointer rests on it for half a second; the box stays until the pointer moves to something else, you click or press a key, or the **Tooltip stays (s)** time runs out.

## Receiver identity

A mailbox belongs to a receiver, not to a pane address. The daemon checks each connected mailbox every few seconds:

| What happened | What the mailbox does |
| --- | --- |
| The pane moved to another space or tab | Follows it by its terminal. |
| Herdr restarted and the same conversation is in the same pane | Reconnects. The screen reopens the next time you focus the receiver. |
| `/clear` (the conversation was cleared) | Same receiver; continues. |
| `resume` or `compact` of the same conversation | Nothing changes. |
| A different conversation started in the pane | Disconnects. |
| The pane closed | Disconnects. |
| A nested Claude started in the same pane | Ignored; only the pane's main conversation counts. |

A disconnected mailbox keeps its letters and shows a banner with the command to take it over:

```sh
mailbox claim MB-xxxx
```

Any other receiver can claim a disconnected mailbox. A mailbox that is still connected refuses with `already_claimed`. After a claim, the answers you had given on the screen ask for one more confirmation (**Confirm answer**) before they can be sent, and senders get a notice on their next receipt that the receiver changed.

## Delivery

Notes are not typed into the agent one by one. A batch is built when all of these hold:

- the oldest queued note has waited 60 seconds (or you pressed deliver now);
- the receiver is the mailbox's current owner and is `idle` or `done`, or has been `working` for over 5 minutes;
- its input box is empty. A box with text, or a screen that cannot be read as a Claude input box, pauses delivery and the mailbox asks again every 30 seconds;
- no earlier batch to this mailbox is still waiting to be confirmed.

Your answers to decision questions are delivered as soon as you press **Send**, but still wait for an empty input box.

A batch begins with a header (how many letters, from whom, a batch id) saying the text comes from other agents and not from the user. Control characters are stripped, and lines that imitate the header are quoted. A batch over 100,000 bytes is written to a file and the agent gets one short message with its path.

After typing a batch the mailbox looks for it in the agent's transcript. Found within 20 seconds it is `confirmed`; otherwise `unconfirmed`, and the screen offers **Mark delivered** and **Resend (may duplicate)**. Unconfirmed batches are never resent on their own.

A receiver with no mailbox yet is not an error: the letter is delivered straight to the pane once its input box is empty, with questions turned into plain text that asks for the user's decision.

## Limits

| Field | Limit |
| --- | --- |
| Question | 200 characters |
| Each option | 80 characters |
| Discussion idea | 300 characters |
| Note text | 500 characters |

Over the limit, put the text in a file and pass `--attach <file>`; the file is copied into the mailbox when you send.

- The CLI never types a message into a pane itself. If the daemon cannot be started, the send fails.
- If the running daemon speaks another protocol version than the command, the command refuses and asks you to restart the daemon.
- `mailbox send --wait [--timeout <ms>]` returns after the receiver has taken the letter and finished its turn (it waits for this letter's batch to be delivered, then for the receiver to go idle again; exit 3: not delivered within 120s, the letter is queued and still arrives; exit 4: delivered but the receiver outlasted `--timeout`; do not resend on either); it needs an agent or pane address, not an `MB-` id. The letter is signed by the program either way, and a role prefix the sender typed (`TL 💬`, `PM:`) is dropped before sending.
- macOS limits a Unix socket path to about 104 characters, so the state directory must not be nested deeply.

<details>
<summary>Advanced: how it works, state, tests</summary>

### How it works

A small daemon owns the state file and handles one request at a time. The CLI talks to it over a local socket and starts it when it is not running. State lives under Herdr's plugin state directory, outside the plugin code directory, with a schema version, and is written to disk before a receipt is returned. Each Herdr session gets its own subdirectory, daemon and mailboxes, so the same pane address in two sessions never shares letters.

| Piece | Role |
| --- | --- |
| `src/daemon.mjs`, `src/core.mjs` | The daemon and the letter rules: receipts, deduplication, edit and withdraw, limits. |
| `src/identity.mjs` | Binding a mailbox to a receiver, the reconcile loop, claims. |
| `src/delivery.mjs`, `src/format.mjs`, `src/input-box.mjs` | Batching, the input-box check, confirmation, batch text. |
| `src/screen/` | The mailbox screen, with settings and attachments shown inside it. |
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
