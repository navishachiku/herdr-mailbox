#!/usr/bin/env node
// Stable entry, copied to ~/.herdr-mailbox/run.mjs by setup. `run.mjs --hook <file>` runs a Claude Code hook,
// anything else is the `mailbox` command; both run the copy of the plugin that `root` points at. When that folder
// is gone it asks herdr where the plugin is now. Stdin, stdout and the exit code pass straight through.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const pointed = () => { try { return fs.readFileSync(path.join(here, 'root'), 'utf8').trim(); } catch { return ''; } };
const asked = () => {
  const r = spawnSync(process.env.HERDR_BIN_PATH || 'herdr', ['plugin', 'list', '--json'], { encoding: 'utf8' });
  try {
    const p = JSON.parse(r.stdout).result.plugins.find(x => x.plugin_id === 'herdr-mailbox');
    return p ? p.plugin_root.replace(/^\\\\\?\\/, '') : '';
  } catch { return ''; }
};
let root = pointed();
if (!root || !fs.existsSync(path.join(root, 'src', 'mailbox.mjs'))) root = asked();
if (!root) { console.error('herdr-mailbox: plugin folder not found; run the Set up mailbox action again'); process.exit(1); }

const args = process.argv.slice(2);
const script = args[0] === '--hook' ? path.join(root, 'src', path.basename(args[1] ?? '')) : path.join(root, 'src', 'mailbox.mjs');
const r = spawnSync(process.execPath, [script, ...args.slice(args[0] === '--hook' ? 2 : 0)], { stdio: 'inherit' });
process.exit(r.status ?? 1);
