# herdr-mailbox setup, for a coding agent

You are setting up herdr-mailbox for the user after they ran `herdr plugin install navishachiku/herdr-mailbox`. Do the steps in order. Before you change any file, copy it to `<file>.bak-<date>`. Do not add an entry that is already there. When you finish, tell the user what you changed and where the backups are.

## 1. Find the plugin folder

```sh
herdr plugin list --json
```

Take `plugin_root` of the entry whose `plugin_id` is `herdr-mailbox`. On Windows, drop a leading `\\?\`. Below it is called `<plugin dir>`. If there is no such entry, stop and tell the user the plugin is not installed.

## 2. Run the setup script

One script puts `mailbox` on the PATH, merges the Claude Code hooks into `~/.claude/settings.json` (on Windows `%USERPROFILE%\.claude\settings.json`) and, only if Codex is installed, adds the Codex rule. It backs up each existing file to `<file>.bak-<date>` before changing it, keeps every hook that is already there, and does nothing twice when rerun.

```sh
node "<plugin dir>/src/setup.mjs" install
```

Check: in a new shell, `mailbox` prints its usage. To undo everything the script added, run `node "<plugin dir>/src/setup.mjs" uninstall`.

## 3. Herdr's Claude integration

The mailbox needs herdr's own Claude integration to tell which conversation is in a pane. Run `herdr integration install claude`; it is safe to run again.

## 4. The shortcut

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
