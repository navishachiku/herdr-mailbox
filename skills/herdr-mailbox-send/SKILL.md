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

Decision and discussion cards are answered by the person at the mailbox screen; to ask the receiving agent itself, or something that can be looked up, send a note. A card is only for a choice that no rule or earlier answer settles and only the user can make. Only the owner of a mailbox sends cards to it; any other agent that has a question for the owner sends the owner a note.

| You want to | `--type` | Required |
| --- | --- | --- |
| Report, hand off, inform, or ask the receiving agent itself; it reads the letter in its conversation and replies by letter only when the letter has something to answer | `note` | one line of text |
| Ask for a pick among 2 to 4 options | `decision` | `--question`, 2 to 4 `--option`, one `--tradeoff` per option in the same order, `--why-open`, a source, `--recommend <letter>` (optional: give it when you have checked, leave it off when you have not) |
| Ask for an opinion with no fixed options | `discussion` | `--question`, a source, optionally `--idea` |

```sh
mailbox send --to agent-a --type note "The sum of 1 to 100 is 5050."
mailbox send --to agent-a --type decision --question "Install the skill too?" --option "Yes" --option "No" \
  --tradeoff "Agents can send letters; one more skill to keep updated" --tradeoff "Nothing new to maintain; agents must be told by hand" \
  --why-open "No rule says whether agents get the skill" --recommend A --source-uid 01J8ZQ4M7K2X9T5V3R6W0B1N8C
mailbox send --to agent-a --type discussion --question "Split the README?" --idea "One file is enough" --source "the docs owner"
```

A card that asks the user to do something by hand lists each action as `--step "<what the user does>"` with a matching `--why-not-agent "<why no agent can do it>"` in the same order (repeat both flags); a step without its reason is refused. Do first whatever an agent can do, such as opening a window or running a command, and ask only for what the user alone can do, such as typing a password. Do not write steps as a list in the question, idea or other text: the mailbox may refuse a card that does.

A card's source is where the question came from. `--source-uid <uid>` takes the uid of the letter in your own mailbox that raised it, and the card then shows that letter's sender as it signed it; when no letter did, `--source "<text>"` takes a few words saying who or what did.

`--to` takes the receiver's agent name, a pane address such as `w1:p2`, or an id starting with `MB-`. Options must be mutually exclusive. Count questions of either kind (with or without fixed options): send 1 to 7 questions as one letter each (a decision letter for a pick-one question, a `--type discussion` letter for one without fixed options). With 8 or more questions at once, send a single `--type discussion` letter instead: write the questions into an interactive answer page (one HTML file where the user answers and copies the reply), attach it with `--attach`, say the question count and ask the user to paste the copied reply into the Reply field. A `--tradeoff` says what choosing that option gives up or risks, not what it is; `--why-open` says why no existing rule, earlier decision or answer already settles the question. If one does, apply it and do not ask; a card without both is refused. The receiver is whoever the task names; when it names none, ask the user once.

When the receiver needs to look at a file to answer or follow the letter (a report, screenshot, spec or diff), attach it with `--attach <file>` (up to 5, repeat the flag) instead of pasting its path into the text; the receiver opens it from the letter.

### Step 3 — Length limits

A question is up to 200 characters, one option 80, one `--tradeoff` 80, `--why-open` 150, a discussion idea 300, a note 500. Longer is rejected with `too_long`. Write the full text to a `.md` file (a `.txt` attachment is refused), send it with `--attach <file>`, and keep one summary sentence in the letter. Do not cut the content yourself.

### Step 4 — Read the receipt

The command prints one JSON line and exits 0 only when it says `ok: true`. Look at:

- `uid`: this letter's id; use it for `edit`, `withdraw` and when you mention the letter
- `status`: where the letter is now
- `pending`: your letters to that mailbox that are not closed yet

If the command prints plain text such as `unknown agent or pane: agent-a` and exits 1, there is no receipt: the receiver name does not resolve and nothing was sent. The receiver may be in the middle of a handover, so send the same letter to the same name once more a little later. Only if it still does not resolve, tell the user the name you used and ask for the agent's actual name or pane address. Treat `agent_not_found` from the `herdr agent prompt` of Step 1 the same way. Do not send to another receiver or by another tool. Otherwise, when `ok` is `false`, read `error`: `too_long` → Step 3; `missing_tradeoff` or `missing_why_open` → the message says what to add; if you cannot fill them in honestly, the question is probably already decided by a rule, so do not send it; `duplicate_open_question` → you already asked this and it is unanswered, do not resend, look it up with `mailbox status`; `daemon_unavailable` → the mailbox service did not start; send it the way Step 1 describes for a missing mailbox, and tell the user.

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

## When the user is away (owner of a mailbox only)

If you own a mailbox and take over for a user who is away, run `mailbox away on` when you start and `mailbox away off` when you stop. While away, the cards you send are kept without a notification; `away off` raises one notification for the cards still waiting. A sender that is not the owner has nothing to do here.

## Gotchas

- Do not send a reply that has nothing new in it, such as one that only says you received a letter. The line at the end of a delivered letter says the same: reply only when you need to answer.
- Refer to a letter by its `uid` only. Short serials such as `Q003` that the receiver sees on screen are refused by every command.
- A decision letter may go without a recommendation; do not fake one, and do not replace it with "up to you".
- The sender defaults to your own pane (`HERDR_PANE_ID`); `--from` is rarely needed. Your signature is added by the program, so do not write one in the letter.
