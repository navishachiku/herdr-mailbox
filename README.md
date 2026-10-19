# herdr-mailbox

![License](https://img.shields.io/badge/license-MIT-blue)
![Herdr 0.9.3+](https://img.shields.io/badge/herdr-0.9.3%2B-8a2be2)
![Platforms](https://img.shields.io/badge/platforms-macOS%20%E2%80%A2%20Linux-informational)
![Runtime](https://img.shields.io/badge/runtime-Node%2018%2B-5fa04e)

<p align="center">
  <a href="#install">install</a> · <a href="#limits">limits</a> · <a href="#sending-a-letter">sending a letter</a>
</p>

> Ever had a receiving agent's conversation washed away by every worker report?

In a Herdr multi-agent workflow, workers report into one agent's conversation one message at a time. Each one wakes that agent for a turn, and questions you have not answered yet get pushed out of view.

Mailbox gives each receiving agent a mailbox. Other agents send letters to it, and every send returns a receipt at once.

- **Three kinds of letter** — a note, a decision question (2 to 4 options, a recommended one is required) and a discussion question.
- **A receipt for every send** — the letter's uid, its status, and the letters you sent to that mailbox that are still open.
- **No double sends** — an identical letter within 30 seconds is not created again, and neither is an identical unanswered decision question from the same sender.
- **Change your mind, until the user answers** — edit, withdraw or supersede a question; once the user has answered, the answer is locked in.
- **Long text goes in a file** — over the limit, the send is refused and asks for `--attach`; the file is copied into the mailbox when you send.
- **Letters survive restarts** — the state is written to disk before a receipt is returned.

This release is the mailbox core. Delivery to the receiver, receiver identity and the mailbox screen are separate pieces that are not part of it yet.

## Install

Requires Herdr 0.9.3 or newer and Node 18 or newer.

```sh
herdr plugin link <path to this repository>
```

The `mailbox` command is `src/mailbox.mjs`. Run it with `node` or link it onto your `PATH`.

## Limits

| Field | Limit |
| --- | --- |
| Question | 200 characters |
| Each option | 80 characters |
| Discussion idea | 300 characters |
| Note text | 500 characters |

Over the limit, put the text in a file and pass `--attach <file>`.

- Letters are named by uid. The short serial shown to people (for example `Q003`) is refused by every command.
- The CLI never types a message into a pane itself. If the daemon cannot be started, the send fails.
- If the running daemon speaks another protocol version than the command, the command refuses and asks you to restart the daemon.

## Sending a letter

```sh
mailbox send --to <address|MB-id> --type note "tests pass"

mailbox send --to <address|MB-id> --type decision \
  --question "Install the skill too?" --option "Yes" --option "No" --recommend A

mailbox send --to <address|MB-id> --type discussion \
  --question "Split the README?" --idea "One file is enough"
```

Optional on any send: `--priority high|medium|low`, `--tag <t>`, `--attach <file>`, and `--supersedes <uid>` on a question.

```sh
mailbox status [--to <address|MB-id>]        # your letters that are still open
mailbox edit <uid> --question "..."          # only while the user has not answered
mailbox withdraw <uid> --reason "..."        # only while the user has not answered
```

The sender is the pane in `HERDR_PANE_ID`, or `--from`.

### How it works

A small daemon owns the state file and handles one request at a time. The CLI talks to it over a local socket and starts it when it is not running. State lives under Herdr's plugin state directory, outside the plugin code directory, with a schema version. Each Herdr session gets its own subdirectory, daemon and mailboxes, so the same pane address in two sessions never shares letters.

### Tests

```sh
npm test
```

Runs the real CLI and daemon in a throwaway state directory.

## License

MIT
