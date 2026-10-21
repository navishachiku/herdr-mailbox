# herdr-mailbox setup, for a coding agent

You are setting up herdr-mailbox for the user after they ran `herdr plugin install navishachiku/herdr-mailbox`. Do the steps in order. Before you change any file, copy it to `<file>.bak-<date>`. Do not add an entry that is already there. When you finish, tell the user what you changed and where the backups are.

## 1. Find the plugin folder

```sh
herdr plugin list --json
```

Take `plugin_root` of the entry whose `plugin_id` is `herdr-mailbox`. On Windows, drop a leading `\\?\`. Below it is called `<plugin dir>`. If there is no such entry, stop and tell the user the plugin is not installed.

## 2. Put `mailbox` on the PATH

Agents run `mailbox send …`, so the command must be found from any shell.

- **macOS, Linux**: make the entry file executable and link it into a folder on the `PATH`, usually `~/.local/bin`:

  ```sh
  chmod +x "<plugin dir>/src/mailbox.mjs"
  ln -sf "<plugin dir>/src/mailbox.mjs" ~/.local/bin/mailbox
  ```

- **Windows**: create `mailbox.cmd` in a folder on the user's `PATH` (for example `%USERPROFILE%\.local\bin`, adding that folder to the user `PATH` if it is not there) with this one line:

  ```bat
  @node "<plugin dir>\src\mailbox.mjs" %*
  ```

Check: in a new shell, `mailbox` prints its usage.

## 3. Register the Claude Code hooks

Merge these three hooks into `~/.claude/settings.json` (on Windows `%USERPROFILE%\.claude\settings.json`). Keep every hook that is already there; add these entries next to them.

```json
{
  "hooks": {
    "SessionStart": [
      { "matcher": "startup|resume|clear|compact",
        "hooks": [{ "type": "command", "command": "node \"<plugin dir>/src/session-start.mjs\"", "timeout": 10 }] }
    ],
    "UserPromptSubmit": [
      { "hooks": [{ "type": "command", "command": "node \"<plugin dir>/src/prompt-submit.mjs\"", "timeout": 10 }] }
    ],
    "PreToolUse": [
      { "matcher": "Bash",
        "hooks": [{ "type": "command", "command": "node \"<plugin dir>/src/send-guard.mjs\"", "timeout": 10 }] }
    ]
  }
}
```

Herdr's own Claude integration must be installed too, so the mailbox can tell which conversation is in a pane. Run `herdr integration install claude`; it is safe to run again.

Check: the file is valid JSON and each of the three commands appears once.

## 4. Codex (only if the user has Codex)

Codex runs commands in a sandbox where the mailbox daemon cannot start. Add this rule to `~/.codex/rules/default.rules`, creating the file if needed:

```
prefix_rule(pattern=["mailbox"], decision="allow")
```

## 5. The shortcut

Add this to Herdr's `config.toml` (`~/.config/herdr/config.toml`; on Windows `%APPDATA%\herdr\config.toml`), unless a `[[keys.command]]` for `herdr-mailbox.open` is already there. If a `[ui.toast]` section exists, set `delivery = "herdr"` in it instead of adding a second one.

```toml
[[keys.command]]
key = "prefix+shift+m"
type = "plugin_action"
command = "herdr-mailbox.open"
description = "open the mailbox"

[ui.toast]
delivery = "herdr"
```

Then tell the user to press `prefix+shift+r` in Herdr to reload, and to restart any Claude Code session that should receive mail so it picks up the hooks.

## Done

Tell the user: press `prefix+shift+m` on the leader's pane to open its mailbox, and workers send with `mailbox send --to <leader> --type note "…"`. Full reference: [docs/guide.md](docs/guide.md).
