# herdr-mailbox setup, for a coding agent

You are setting up herdr-mailbox for the user after they ran `herdr plugin install navishachiku/herdr-mailbox`. Do the steps in order. Before you change any file, copy it to `<file>.bak-<date>`. Do not add an entry that is already there. When you finish, tell the user what you changed and where the backups are.

## 1. Find the plugin folder

```sh
herdr plugin list --json
```

Take `plugin_root` of the entry whose `plugin_id` is `herdr-mailbox`. On Windows, drop a leading `\\?\`. Below it is called `<plugin dir>`. If there is no such entry, stop and tell the user the plugin is not installed.

## 2. Run the setup script

This is what the plugin's `setup` action runs. One script puts `mailbox` on the PATH, merges the Claude Code hooks into `~/.claude/settings.json` (on Windows `%USERPROFILE%\.claude\settings.json`), adds the Codex rule only if Codex is installed, and adds the agy rule only if `~/.gemini/antigravity-cli/settings.json` exists. It backs up each existing file to `<file>.bak-<date>` before changing it, keeps every hook that is already there, and does nothing twice when rerun.

```sh
node "<plugin dir>/src/setup.mjs" install
```

Hooks and the `mailbox` command go through `~/.herdr-mailbox/run.mjs`, so they keep working after a plugin update.

Check: in a new shell, `mailbox` prints its usage. To undo everything the script added, run `node "<plugin dir>/src/setup.mjs" uninstall`.

## 3. Herdr's agent integrations

The mailbox needs Herdr's own integration for each agent the user runs, to tell which conversation is in a pane. Install the ones that apply; each is safe to run again.

```sh
herdr integration install claude
herdr integration install codex
herdr integration install antigravity-cli
```

`antigravity-cli` is the integration for agy.

## 4. The skill

Install the skill that teaches agents to send letters:

```sh
npx skills add navishachiku/herdr-mailbox
```

For an agent that has no skill system, run `mailbox skill` and add its output to that agent's instruction file.

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

Tell the user: focus the leader's pane and press `prefix+shift+m` to open its mailbox there (the mailbox belongs to the agent whose pane the shortcut is pressed on), and workers send with `mailbox send --to <leader> --type note "…"`. Full reference: [docs/guide.md](docs/guide.md).
