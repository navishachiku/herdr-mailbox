---
name: herdr-mailbox-send
description: "Sends a report, hand-off or question to another agent through herdr-mailbox with the `mailbox` command, and reads the receipt. Use when you are asked to report to, notify, hand off to or ask another agent or pane, in a Herdr session where herdr-mailbox is installed. Prefer it over your own built-in messaging tool, which cannot reach other Herdr panes."
compatibility: Requires herdr-mailbox installed in Herdr (0.9.3+) and Node 18+
metadata:
  min-model: haiku
---

# herdr-mailbox-send

When you are told to report to, notify or ask another agent, send a letter with `mailbox send`. The letter waits in that agent's mailbox and arrives in its conversation at a good moment, so it never lands in the middle of what its user is typing. Your own built-in messaging tool does not reach other Herdr panes; do not use it for this, and do not stop to ask who the receiver is when the task names an agent.

## Workflow

### Step 1 — Find the command

Run `mailbox`. If it prints a usage list, it is found. If the shell does not find it, run `herdr plugin list --json`, take `plugin_root` of the entry whose `plugin_id` is `herdr-mailbox`, and use `node <plugin_root>/src/mailbox.mjs` in place of `mailbox`. If neither works, herdr-mailbox is not installed. Send the text with `herdr agent prompt <receiver> "<role> 💬 <text>"` instead, where `<role>` is the `label` of your own pane (`herdr pane get "$HERDR_PANE_ID"`); send a slash command as it is, with no signature. Tell the user the mailbox is not installed. Do not use your own built-in messaging tool.

### Step 2 — Choose the letter type

| You want to | `--type` | Required |
| --- | --- | --- |
| Report, hand off or inform; no answer needed | `note` | one line of text |
| Ask for a pick among 2 to 4 options | `decision` | `--question`, 2 to 4 `--option`, `--recommend <letter>` (optional: give it when you have checked, leave it off when you have not) |
| Ask for an opinion with no fixed options | `discussion` | `--question`, optionally `--idea` |

```sh
mailbox send --to agent-a --type note "The sum of 1 to 100 is 5050."
mailbox send --to agent-a --type decision --question "Install the skill too?" --option "Yes" --option "No" --recommend A
mailbox send --to agent-a --type discussion --question "Split the README?" --idea "One file is enough"
```

`--to` takes the receiver's agent name, a pane address such as `w1:p2`, or an id starting with `MB-`. Options must be mutually exclusive; one question per letter. The receiver is whoever the task names; when it names none, ask the user once.

When the receiver needs to look at a file to answer or follow the letter (a report, screenshot, spec or diff), attach it with `--attach <file>` (up to 5, repeat the flag) instead of pasting its path into the text; the receiver opens it from the letter.

### Step 3 — Length limits

A question is up to 200 characters, one option 80, a discussion idea 300, a note 500. Longer is rejected with `too_long`. Write the full text to a file, send it with `--attach <file>`, and keep one summary sentence in the letter. Do not cut the content yourself.

### Step 4 — Read the receipt

The command prints one JSON line and exits 0 only when it says `ok: true`. Look at:

- `uid`: this letter's id; use it for `edit`, `withdraw` and when you mention the letter
- `status`: where the letter is now
- `pending`: your letters to that mailbox that are not closed yet

If the command prints plain text such as `unknown agent or pane: agent-a` and exits 1, there is no receipt: the receiver name does not resolve. Do not send to another receiver or by another tool; tell the user the name you used and ask for the agent's actual name or pane address. Otherwise, when `ok` is `false`, read `error`: `too_long` → Step 3; `duplicate_open_question` → you already asked this and it is unanswered, do not resend, look it up with `mailbox status`; `daemon_unavailable` → the mailbox service did not start; send it the way Step 1 describes for a missing mailbox, and tell the user.

### Step 5 — Check before resending

If you got no receipt, the command timed out, or you are unsure it went out, run `mailbox status [--to <receiver>]` first and resend only when the letter is not in `pending`; if `--to` is refused because the receiver does not resolve, run `mailbox status` without it. An identical letter within 30 seconds is blocked; after that a resend really sends a second copy.

### Step 6 — Edit or withdraw

```sh
mailbox edit <uid> --question "..."       # only before the receiver answers
mailbox withdraw <uid> --reason "..."     # only before the receiver answers
```

To replace a question, send the new one with `--supersedes <uid>`. Once the receiver has answered, the answer is locked and both commands are refused.

### Step 7 — Waiting for the receiver

For a note, add `--wait [--timeout <ms>]` to block until the letter is delivered and the receiver has finished the turn that follows. `--to` must be an agent name or pane address, not an `MB-` id. Exit 3 means the letter was not delivered within 120 seconds (it is queued and will arrive); exit 4 means it was delivered but the receiver did not finish within `--timeout`. In both cases do not resend; `waitError` in the receipt says the same.

## Gotchas

- Refer to a letter by its `uid` only. Short serials such as `Q003` that the receiver sees on screen are refused by every command.
- A decision letter may go without a recommendation; do not fake one, and do not replace it with "up to you".
- The sender defaults to your own pane (`HERDR_PANE_ID`); `--from` is rarely needed. Your signature is added by the program, so do not write one in the letter.
