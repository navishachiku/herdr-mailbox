// 228 setup script. Every run uses a throwaway home; the Windows registry PATH is covered by the real-machine run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SETUP = path.join(here, 'setup.mjs');
const posix = process.platform !== 'win32';

const newHome = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mbsetup-')));
// node alone in its own folder, so a codex installed next to the real node is not found.
const nodeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mbnode-'));
fs.symlinkSync(process.execPath, path.join(nodeDir, path.basename(process.execPath)));
// PATH without codex and without ~/.local/bin, so detection and the PATH step are decided by the home alone.
const run = (home, cmd, extra = {}) => spawnSync(process.execPath, [SETUP, cmd], {
  encoding: 'utf8',
  env: { ...process.env, HOME: home, USERPROFILE: home, SHELL: '/bin/zsh',
    PATH: [nodeDir, '/usr/bin', '/bin'].join(path.delimiter), ...extra },
});
// Every file under the home with its content, for before/after comparison.
const snapshot = dir => {
  const out = {};
  const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isSymbolicLink()) out[p] = `-> ${fs.readlinkSync(p)}`;
    else if (e.isDirectory()) { out[p + '/'] = ''; walk(p); }
    else out[p] = fs.readFileSync(p, 'utf8');
  } };
  walk(dir);
  return out;
};
const commands = settings => Object.values(settings.hooks).flat().flatMap(g => g.hooks.map(h => h.command));
const ours = c => /(session-start|prompt-submit|send-guard)\.mjs/.test(c);

test('228/AC-1 install puts mailbox on the PATH of a new shell', { skip: !posix }, () => {
  const home = newHome();
  const r = run(home, 'install');
  assert.equal(r.status, 0, r.stderr);
  const link = path.join(home, '.local', 'bin', 'mailbox');
  assert.equal(fs.realpathSync(link), path.join(home, '.herdr-mailbox', 'run.mjs'));
  assert.match(fs.readFileSync(path.join(home, '.zshrc'), 'utf8'), /\.local\/bin/);
  // A new shell reads the rc file, then finds the command.
  const sh = spawnSync('zsh', ['-c', `source ${home}/.zshrc; command -v mailbox`],
    { encoding: 'utf8', env: { ...process.env, HOME: home, PATH: '/usr/bin:/bin' } });
  assert.equal(sh.stdout.trim(), link);
});

test('228/AC-2 AC-4 install keeps existing hooks, adds ours once, and rerunning changes nothing', () => {
  const home = newHome();
  const file = path.join(home, '.claude', 'settings.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const mine = { model: 'x', hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'echo mine' }] }],
    Stop: [{ hooks: [{ type: 'command', command: 'echo stop' }] }] } };
  fs.writeFileSync(file, JSON.stringify(mine));
  assert.equal(run(home, 'install').status, 0);
  const once = snapshot(home);
  const settings = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(settings.model, 'x');
  assert.deepEqual(settings.hooks.Stop, mine.hooks.Stop);
  assert.equal(settings.hooks.SessionStart[0].hooks[0].command, 'echo mine');
  assert.equal(commands(settings).filter(ours).length, 3);
  assert.ok(fs.readdirSync(path.dirname(file)).some(f => f.startsWith('settings.json.bak-')));
  assert.equal(run(home, 'install').status, 0);
  assert.deepEqual(snapshot(home), once);
});

test('228/AC-3 install adds the Codex rule only when Codex is there', () => {
  const without = newHome();
  assert.equal(run(without, 'install').status, 0);
  assert.equal(fs.existsSync(path.join(without, '.codex')), false);
  const withCodex = newHome();
  const rules = path.join(withCodex, '.codex', 'rules', 'default.rules');
  fs.mkdirSync(path.dirname(rules), { recursive: true });
  fs.writeFileSync(rules, 'prefix_rule(pattern=["ls"], decision="allow")\n');
  assert.equal(run(withCodex, 'install').status, 0);
  assert.equal(run(withCodex, 'install').status, 0);
  const text = fs.readFileSync(rules, 'utf8');
  assert.match(text, /pattern=\["ls"\]/);
  assert.equal(text.split('pattern=["mailbox"]').length - 1, 1);
});

test('228/AC-5 uninstall leaves the home as it was before install', () => {
  const home = newHome();
  fs.mkdirSync(path.join(home, '.claude'));
  fs.writeFileSync(path.join(home, '.claude', 'settings.json'), JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo stop' }] }] } }, null, 2) + '\n');
  fs.mkdirSync(path.join(home, '.codex', 'rules'), { recursive: true });
  fs.writeFileSync(path.join(home, '.codex', 'rules', 'default.rules'), 'prefix_rule(pattern=["ls"], decision="allow")\n');
  fs.writeFileSync(path.join(home, '.zshrc'), 'export A=1\n');
  const before = snapshot(home);
  assert.equal(run(home, 'install').status, 0);
  assert.notDeepEqual(snapshot(home), before);
  assert.equal(run(home, 'uninstall').status, 0);
  const after = Object.fromEntries(Object.entries(snapshot(home)).filter(([p]) => !p.includes('.bak-')));
  assert.deepEqual(after, before);
  // On a bare home, uninstall removes even the files and folders install created.
  const bare = newHome();
  assert.equal(run(bare, 'install').status, 0);
  assert.equal(run(bare, 'uninstall').status, 0);
  assert.deepEqual(Object.keys(snapshot(bare)).filter(p => !p.includes('.bak-')), []);
});

test('228/AC-5 regression: entries the user made by hand before install survive uninstall', { skip: !posix }, () => {
  const home = newHome();
  fs.mkdirSync(path.join(home, '.local', 'bin'), { recursive: true });
  fs.symlinkSync(path.join(here, 'mailbox.mjs'), path.join(home, '.local', 'bin', 'mailbox'));
  fs.mkdirSync(path.join(home, '.codex', 'rules'), { recursive: true });
  fs.writeFileSync(path.join(home, '.codex', 'rules', 'default.rules'), 'prefix_rule(pattern=["mailbox"], decision="allow")\n');
  const command = `node "${path.join(here, 'send-guard.mjs')}"`;
  fs.mkdirSync(path.join(home, '.claude'));
  fs.writeFileSync(path.join(home, '.claude', 'settings.json'), JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command, timeout: 10 }] }] } }, null, 2) + '\n');
  const before = snapshot(home);
  assert.equal(run(home, 'install').status, 0);
  assert.equal(run(home, 'uninstall').status, 0);
  const after = Object.fromEntries(Object.entries(snapshot(home)).filter(([p]) => !p.includes('.bak-')));
  assert.deepEqual(after, before);
});

test('228/AC-5 regression: settings.json comes back byte for byte whatever its formatting', () => {
  const home = newHome();
  const file = path.join(home, '.claude', 'settings.json');
  fs.mkdirSync(path.dirname(file));
  const original = '{"hooks":{"Stop":[{"hooks":[{"type":"command","command":"echo stop"}]}]},\n    "model": "x"}';
  fs.writeFileSync(file, original);
  assert.equal(run(home, 'install').status, 0);
  assert.equal(run(home, 'uninstall').status, 0);
  assert.equal(fs.readFileSync(file, 'utf8'), original);
});

// 249 install action. The stable entry is what keeps hooks and the PATH link working after a plugin update.
const stableTest = home => path.join(home, '.herdr-mailbox');

test('249/AC-1 AC-2 the manifest declares the action, and install adds the agy rule once with a backup', () => {
  const toml = fs.readFileSync(path.join(here, '..', 'herdr-plugin.toml'), 'utf8');
  assert.match(toml, /\[\[actions\]\]\s*id = "setup"[\s\S]*?command = \["node", "src\/setup\.mjs", "install"\]/);
  const home = newHome();
  const agy = path.join(home, '.gemini', 'antigravity-cli', 'settings.json');
  fs.mkdirSync(path.dirname(agy), { recursive: true });
  fs.writeFileSync(agy, JSON.stringify({ model: 'm', permissions: { allow: ['command(ls)'], deny: ['command(sudo)'] } }, null, 2));
  assert.equal(run(home, 'install').status, 0);
  assert.equal(run(home, 'install').status, 0);
  const s = JSON.parse(fs.readFileSync(agy, 'utf8'));
  assert.deepEqual(s.permissions.allow, ['command(ls)', 'command(mailbox)']);
  assert.deepEqual(s.permissions.deny, ['command(sudo)']);
  assert.equal(fs.readdirSync(path.dirname(agy)).filter(f => f.startsWith('settings.json.bak-')).length, 1);
  assert.equal(run(home, 'uninstall').status, 0);
  assert.deepEqual(JSON.parse(fs.readFileSync(agy, 'utf8')).permissions.allow, ['command(ls)']);
});

test('249/AC-3 hooks follow the pointer, and the plugin re-points it from its own folder after an update', () => {
  const home = newHome();
  assert.equal(run(home, 'install').status, 0);
  const settings = JSON.parse(fs.readFileSync(path.join(home, '.claude', 'settings.json'), 'utf8'));
  assert.ok(commands(settings).every(c => c.includes(stableTest(home))), 'hooks point into the stable folder');
  // Two fake plugin folders stand for the old and the new install; the old one is still on disk.
  const fake = name => {
    const dir = path.join(home, name, 'src');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'mailbox.mjs'), `console.log('${name}');\n`);
    fs.writeFileSync(path.join(dir, 'session-start.mjs'), `console.log('${name}');\n`);
    return path.join(home, name);
  };
  const [oldRoot, newRoot] = [fake('old'), fake('new')];
  const hook = () => spawnSync(process.execPath, [path.join(stableTest(home), 'run.mjs'), '--hook', 'session-start.mjs'], { encoding: 'utf8' }).stdout.trim();
  fs.writeFileSync(path.join(stableTest(home), 'root'), oldRoot);
  assert.equal(hook(), 'old');
  fs.writeFileSync(path.join(stableTest(home), 'root'), newRoot);
  assert.equal(hook(), 'new');
  // The real plugin's startup/focus code corrects a pointer left on an old folder.
  fs.writeFileSync(path.join(stableTest(home), 'root'), oldRoot);
  spawnSync(process.execPath, ['--input-type=module', '-e', `import('${path.join(here, 'stable.mjs')}').then(m => m.refreshPointer())`], { env: { ...process.env, HOME: home, USERPROFILE: home } });
  assert.equal(fs.readFileSync(path.join(stableTest(home), 'root'), 'utf8').trim(), path.resolve(here, '..'));
});

test('249/AC-4 the README install section lists the plugin install, the action and the three integrations', () => {
  const readme = fs.readFileSync(path.join(here, '..', 'README.md'), 'utf8');
  const install = readme.slice(readme.indexOf('## Install'), readme.indexOf('## Sending a letter'));
  for (const text of ['herdr plugin install navishachiku/herdr-mailbox', 'herdr plugin action invoke setup --plugin herdr-mailbox',
    'herdr integration install claude', 'herdr integration install codex', 'herdr integration install antigravity-cli'])
    assert.ok(install.includes(text), text);
});

test('249/AC-3 regression: a home set up by the old install is switched to the stable hooks without doubling them', () => {
  const home = newHome();
  const file = path.join(home, '.claude', 'settings.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const olds = ['session-start', 'prompt-submit', 'send-guard'].map(n => `node "/old/plugin/src/${n}.mjs"`);
  fs.writeFileSync(file, JSON.stringify({ hooks: {
    SessionStart: [{ matcher: 'startup|resume|clear|compact', hooks: [{ type: 'command', command: olds[0], timeout: 10 }] }],
    UserPromptSubmit: [{ hooks: [{ type: 'command', command: olds[1], timeout: 10 }] }],
    PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: olds[2], timeout: 10 }] }] } }));
  fs.writeFileSync(path.join(home, '.herdr-mailbox-setup.json'), JSON.stringify({ createdFiles: [], createdDirs: [], added: { hooks: olds } }));
  assert.equal(run(home, 'install').status, 0);
  const cmds = commands(JSON.parse(fs.readFileSync(file, 'utf8')));
  assert.equal(cmds.length, 3);
  assert.ok(cmds.every(c => c.includes('.herdr-mailbox') && c.includes('--hook')));
});
