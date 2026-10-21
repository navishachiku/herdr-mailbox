#!/usr/bin/env node
// Setup for a freshly installed plugin: `node setup.mjs install` puts `mailbox` on the PATH, merges the Claude Code
// hooks into the user's settings and, when Codex is there, adds the Codex rule; `node setup.mjs uninstall` undoes
// exactly that. Every existing file is copied to <file>.bak-<date> before its first change, rerunning adds nothing
// twice, and what install created is recorded in ~/.herdr-mailbox-setup.json so uninstall can remove it again.
// It does not touch herdr's own config (integration, shortcut); AGENT-SETUP.md covers those.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const WIN = process.platform === 'win32';
const HOME = os.homedir();
const PLUGIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const posix = p => p.replaceAll('\\', '/');
const BIN_DIR = path.join(HOME, '.local', 'bin');
const MANIFEST = path.join(HOME, '.herdr-mailbox-setup.json');
const SETTINGS = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(HOME, '.claude'), 'settings.json');
const CODEX_DIR = process.env.CODEX_HOME || path.join(HOME, '.codex');
const RULES = path.join(CODEX_DIR, 'rules', 'default.rules');
const RULE = 'prefix_rule(pattern=["mailbox"], decision="allow")';
const RC_BEGIN = '# >>> herdr-mailbox >>>';
const RC_END = '# <<< herdr-mailbox <<<';
const HOOKS = [
  ['SessionStart', 'session-start.mjs', 'startup|resume|clear|compact'],
  ['UserPromptSubmit', 'prompt-submit.mjs'],
  ['PreToolUse', 'send-guard.mjs', 'Bash'],
];
const hookCommand = file => `node "${posix(path.join(PLUGIN, 'src', file))}"`;

const manifest = (() => {
  try { return JSON.parse(fs.readFileSync(MANIFEST, 'utf8')); } catch { return {}; }
})();
manifest.createdFiles ??= [];
manifest.createdDirs ??= [];
// What this install added itself; uninstall removes only these, so an identical entry the user made by hand stays.
manifest.added ??= { hooks: [] };
const say = msg => console.log(msg);
const die = msg => { console.error(`setup: ${msg}`); process.exit(1); };
const save = () => fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');

const mkdirp = dir => {
  const missing = [];
  for (let d = dir; !fs.existsSync(d); d = path.dirname(d)) missing.push(d);
  fs.mkdirSync(dir, { recursive: true });
  for (const d of missing.reverse()) if (!manifest.createdDirs.includes(d)) manifest.createdDirs.push(d);
};
const backup = file => {
  if (!fs.existsSync(file)) return;
  const day = new Date().toISOString().slice(0, 10).replaceAll('-', '');
  let target = `${file}.bak-${day}`;
  for (let n = 2; fs.existsSync(target); n++) target = `${file}.bak-${day}-${n}`;
  fs.copyFileSync(file, target);
  say(`backup: ${target}`);
};
// Writes only when the content changes, backing up an existing file first and recording a new one.
const writeFile = (file, text) => {
  const existed = fs.existsSync(file);
  if (existed && fs.readFileSync(file, 'utf8') === text) return false;
  if (existed) { if (!manifest.createdFiles.includes(file)) backup(file); }
  else { mkdirp(path.dirname(file)); manifest.createdFiles.push(file); }
  fs.writeFileSync(file, text);
  return true;
};
const readText = file => fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
// Removes a file or folder the install created, folders only when they ended up empty.
const dropCreated = () => {
  for (const f of manifest.createdFiles) if (fs.existsSync(f)) {
    if (['', '{}'].includes(readText(f).trim())) fs.rmSync(f);
  }
  for (const d of [...manifest.createdDirs].reverse()) {
    try { fs.rmdirSync(d); } catch { /* not empty or already gone: someone else's now */ }
  }
};

// --- mailbox on the PATH ---
const entry = path.join(PLUGIN, 'src', 'mailbox.mjs');
const cmdFile = path.join(BIN_DIR, 'mailbox.cmd');
const cmdText = `@node "${path.join(PLUGIN, 'src', 'mailbox.mjs')}" %*\r\n`;
const link = path.join(BIN_DIR, 'mailbox');

const psUserPath = script => {
  const r = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8' });
  if (r.status !== 0) die(`powershell failed: ${r.stderr.trim()}`);
  return r.stdout.replace(/\r?\n$/, '');
};
const REG = "$k=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment',$true);";
const getUserPath = () => psUserPath(`${REG} $k.GetValue('Path','',[Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)`);
// Registry write keeps the value kind (REG_EXPAND_SZ); setting and clearing a dummy variable then broadcasts the change.
const setUserPath = value => {
  const r = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command',
    `${REG} $kind=if($k.GetValueNames() -contains 'Path'){$k.GetValueKind('Path')}else{'ExpandString'}; $k.SetValue('Path',$env:MB_NEW_PATH,$kind); ` +
    "[Environment]::SetEnvironmentVariable('HERDR_MAILBOX_SETUP','1','User'); [Environment]::SetEnvironmentVariable('HERDR_MAILBOX_SETUP',$null,'User')"],
    { encoding: 'utf8', env: { ...process.env, MB_NEW_PATH: value } });
  if (r.status !== 0) die(`powershell failed: ${r.stderr.trim()}`);
};
const sameDir = (a, b) => a.replace(/[\\/]+$/, '').toLowerCase() === b.replace(/[\\/]+$/, '').toLowerCase();

const rcFile = () => {
  const shell = path.basename(process.env.SHELL || '');
  if (shell === 'zsh') return path.join(HOME, '.zshrc');
  if (shell === 'bash') return path.join(HOME, process.platform === 'darwin' ? '.bash_profile' : '.bashrc');
  return path.join(HOME, '.profile');
};
const rcBlock = `${RC_BEGIN}\nexport PATH="$HOME/.local/bin:$PATH"\n${RC_END}\n`;
const stripBlock = text => text.replace(new RegExp(`${RC_BEGIN}[\\s\\S]*?${RC_END}\\n?`), '');

const installPath = () => {
  if (WIN) {
    const text = readText(cmdFile);
    if (text && text !== cmdText) die(`${cmdFile} exists and is not ours; remove it first`);
    if (writeFile(cmdFile, cmdText)) { manifest.added.cmd = true; say(`created ${cmdFile}`); }
    const parts = getUserPath().split(';').filter(Boolean);
    if (!parts.some(p => sameDir(p, BIN_DIR))) {
      setUserPath([...parts, BIN_DIR].join(';'));
      manifest.userPath = true;
      say(`added ${BIN_DIR} to the user PATH`);
    }
    return;
  }
  fs.chmodSync(entry, 0o755);
  let st = null;
  try { st = fs.lstatSync(link); } catch { /* absent */ }
  if (st && !(st.isSymbolicLink() && path.resolve(BIN_DIR, fs.readlinkSync(link)) === entry)) die(`${link} exists and is not ours; remove it first`);
  if (!st) {
    mkdirp(BIN_DIR);
    fs.symlinkSync(entry, link);
    manifest.added.link = true;
    manifest.createdFiles.push(link);
    say(`linked ${link}`);
  }
  if (process.env.PATH.split(path.delimiter).includes(BIN_DIR) && !manifest.rc) return;
  const rc = rcFile();
  const text = readText(rc);
  if (text.includes(RC_BEGIN)) return;
  writeFile(rc, text && !text.endsWith('\n') ? `${text}\n${rcBlock}` : text + rcBlock);
  manifest.rc = rc;
  say(`added ${BIN_DIR} to PATH in ${rc}`);
};
const uninstallPath = () => {
  if (WIN) {
    if (manifest.added.cmd && readText(cmdFile) === cmdText) { fs.rmSync(cmdFile); say(`removed ${cmdFile}`); }
    if (manifest.userPath) {
      setUserPath(getUserPath().split(';').filter(p => p && !sameDir(p, BIN_DIR)).join(';'));
      manifest.userPath = false;
      say(`removed ${BIN_DIR} from the user PATH`);
    }
    return;
  }
  try {
    if (manifest.added.link && path.resolve(BIN_DIR, fs.readlinkSync(link)) === entry) { fs.rmSync(link); say(`removed ${link}`); }
  } catch { /* no link, or not a link */ }
  if (manifest.rc && fs.existsSync(manifest.rc)) {
    const text = readText(manifest.rc);
    if (text.includes(RC_BEGIN)) { fs.writeFileSync(manifest.rc, stripBlock(text)); say(`removed the PATH block from ${manifest.rc}`); }
    delete manifest.rc;
  }
};

// --- Claude Code hooks ---
const readSettings = () => {
  if (!fs.existsSync(SETTINGS)) return {};
  try { return JSON.parse(fs.readFileSync(SETTINGS, 'utf8')); } catch (e) { return die(`${SETTINGS} is not valid JSON (${e.message}); fix it and rerun`); }
};
const writeSettings = s => writeFile(SETTINGS, JSON.stringify(s, null, 2) + '\n');
const hasCommand = (groups, command) => (groups ?? []).some(g => (g.hooks ?? []).some(h => h.command === command));

const installHooks = () => {
  const settings = readSettings();
  // Kept so uninstall can put the user's own formatting back byte for byte.
  if (fs.existsSync(SETTINGS) && manifest.settingsOriginal === undefined) manifest.settingsOriginal = readText(SETTINGS);
  settings.hooks ??= {};
  for (const [event, file, matcher] of HOOKS) {
    const command = hookCommand(file);
    if (hasCommand(settings.hooks[event], command)) continue;
    manifest.added.hooks.push(command);
    (settings.hooks[event] ??= []).push({ ...(matcher && { matcher }), hooks: [{ type: 'command', command, timeout: 10 }] });
  }
  if (writeSettings(settings)) say(`merged the mailbox hooks into ${SETTINGS}`);
};
const uninstallHooks = () => {
  if (!fs.existsSync(SETTINGS)) return;
  const settings = readSettings();
  const ours = new Set(manifest.added.hooks);
  for (const event of Object.keys(settings.hooks ?? {})) {
    settings.hooks[event] = settings.hooks[event]
      .map(g => ({ ...g, hooks: (g.hooks ?? []).filter(h => !ours.has(h.command)) }))
      .filter(g => g.hooks.length);
    if (!settings.hooks[event].length) delete settings.hooks[event];
  }
  if (!Object.keys(settings.hooks ?? {}).length) delete settings.hooks;
  const original = manifest.settingsOriginal;
  const restored = original !== undefined && JSON.stringify(settings) === JSON.stringify(JSON.parse(original));
  if ((restored ? writeFile(SETTINGS, original) : writeSettings(settings))) say(`removed the mailbox hooks from ${SETTINGS}`);
};

// --- Codex rule ---
const codexPresent = () => fs.existsSync(CODEX_DIR)
  || spawnSync(WIN ? 'where' : 'which', ['codex'], { stdio: 'ignore' }).status === 0;
const ruleLines = () => readText(RULES).split('\n');
const installCodex = () => {
  if (!codexPresent()) return say('Codex not found, skipped the Codex rule');
  const text = readText(RULES);
  if (ruleLines().some(l => l.trim() === RULE)) return;
  if (writeFile(RULES, (text && !text.endsWith('\n') ? `${text}\n` : text) + `${RULE}\n`)) manifest.added.rule = true, say(`added the mailbox rule to ${RULES}`);
};
const uninstallCodex = () => {
  if (!manifest.added.rule || !fs.existsSync(RULES) || !ruleLines().some(l => l.trim() === RULE)) return;
  fs.writeFileSync(RULES, ruleLines().filter(l => l.trim() !== RULE).join('\n'));
  say(`removed the mailbox rule from ${RULES}`);
};

const cmd = process.argv[2];
if (cmd === 'install') {
  installPath(); installHooks(); installCodex();
  save();
  say('done. Open a new terminal, restart Claude Code sessions that should get mail, and press prefix+shift+r in herdr.');
} else if (cmd === 'uninstall') {
  uninstallPath(); uninstallHooks(); uninstallCodex();
  dropCreated();
  fs.rmSync(MANIFEST, { force: true });
  say('done. Backups (*.bak-*) were left in place.');
} else {
  die('usage: node setup.mjs <install|uninstall>');
}
