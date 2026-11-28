import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { guardDaemon } from './test-support/daemon-sandbox.cjs';
import { fileURLToPath } from 'node:url';
import { sessionKey } from './paths.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

// A fake herdr world with a receiver (w1:p1, mailbox bound) and a sender (w1:p2); `hook` runs send-guard.mjs on one payload.
async function guardWorld(t) {
  const root = fs.mkdtempSync('/tmp/mbguard-');
  const socket = path.join(root, 'herdr.sock');
  const dir = path.join(root, sessionKey(socket));
  const worldFile = path.join(root, 'world.json');
  const log = path.join(root, 'herdr.jsonl');
  const transcript = path.join(root, 'receiver.jsonl');
  fs.writeFileSync(transcript, '');
  const world = {
    panes: ['w1:p1', 'w1:p2', 'w1:p3', 'w1:p4'].map(id => ({ pane_id: id, terminal_id: `terminal-${id}`,
      workspace_id: 'w1', tab_id: 'w1:t1', label: id === 'w1:p2' ? 'Sender' : 'Receiver',
      agent: 'claude', agent_status: 'idle', agent_session: { value: `sid-${id}` } })),
    screens: { 'w1:p1': '────────────\n❯ \n────────────', 'w1:p3': '────────────\n❯ draft in progress\n────────────' },
    transcripts: { 'w1:p1': transcript },
  };
  const write = () => fs.writeFileSync(worldFile, JSON.stringify(world));
  write();
  const env = { ...process.env, HERDR_MAILBOX_STATE_DIR: root, HERDR_SOCKET_PATH: socket,
    HERDR_BIN_PATH: path.join(here, 'test-support', 'fake-herdr.mjs'), HERDR_PANE_ID: 'w1:p2',
    HERDR_MAILBOX_SID: 'sid-w1:p2', FAKE_HERDR_STATE: worldFile, FAKE_HERDR_LOG: log,
    LC_ALL: 'en_US.UTF-8', LC_MESSAGES: 'en_US.UTF-8', LANG: 'en_US.UTF-8',
    HERDR_MAILBOX_TIMINGS: JSON.stringify({ tickMs: 80, mergeMs: 60000, reconcileMs: 250 }) };
  for (const key of ['HERDR_PLUGIN_STATE_DIR', 'HERDR_PLUGIN_ID', 'HERDR_MAILBOX_DAEMON_ENTRY', 'HERDR_MAILBOX_DAEMON_PROTO']) delete env[key];
  guardDaemon(env, root);
  t.after(() => {
    try { process.kill(Number(fs.readFileSync(path.join(dir, 'daemon.pid'), 'utf8')), 'SIGKILL'); } catch { /* not running */ }
    fs.rmSync(root, { recursive: true, force: true });
  });
  const run = (payload, extraEnv = {}) => spawnSync(process.execPath, [path.join(here, 'send-guard.mjs')], { env: { ...env, ...extraEnv }, encoding: 'utf8', timeout: 15000, input: JSON.stringify(payload) });
  const hook = (command, extra = {}) => run({ hook_event_name: 'PreToolUse', session_id: 'sid-w1:p2', tool_name: 'Bash',
    tool_use_id: 'tool-guard-test', tool_input: { command, description: 'Report to the receiver' }, ...extra });
  // Check the entry point before starting a daemon, so a missing hook is reported distinctly.
  const probe = hook('herdr agent prompt w1:p1 "report with spaces"');
  assert.equal(probe.status, 0, probe.stderr);
  const started = spawnSync(process.execPath, [path.join(here, 'mailbox.mjs'), 'status'], { env, encoding: 'utf8', timeout: 15000 });
  assert.equal(started.status, 0, `${started.stdout} ${started.stderr}`);
  const raw = req => new Promise((resolve, reject) => {
    const c = net.connect(path.join(dir, 'd.sock'));
    let buf = '';
    c.setTimeout(15000, () => c.destroy(new Error('daemon request timed out')));
    c.on('connect', () => c.write(`${JSON.stringify({ proto: 1, caller: { viaPlugin: true }, ...req })}\n`));
    c.on('data', data => { buf += data; });
    c.on('end', () => { try { resolve(JSON.parse(buf)); } catch (e) { reject(e); } });
    c.on('error', reject);
  });
  assert.equal((await raw({ op: 'register', pane: 'w1:p1', sid: 'sid-w1:p1', source: 'startup', transcript })).ok, true);
  assert.equal((await raw({ op: 'bind', pane: 'w1:p1' })).ok, true);
  return { world, write, run, hook, log };
}

// One integration test is the entire shared budget for the send guard and input-box workaround.
test('201/AC-11 201/AC-12 PreToolUse rewrites mailbox and unbound sends and protects wait dispatches', async t => {
  const { world, write, hook, log } = await guardWorld(t);
  for (const [command, context] of [
    ['herdr agent prompt w1:p1 "report with spaces"', { agent_id: 'child-agent', agent_type: 'general-purpose' }],
    ['herdr agent prompt w1:p1 "report with spaces" --wait', {}],
    ['herdr agent prompt w1:p1 "report with spaces" --wait --timeout 600000', {}],
  ]) {
    const result = hook(command, context);
    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout).hookSpecificOutput;
    assert.equal(output.hookEventName, 'PreToolUse');
    assert.equal(output.permissionDecision, 'allow');
    const rewritten = output.updatedInput.command;
    assert.ok(rewritten.includes(path.join(here, 'mailbox.mjs')));
    assert.match(rewritten, /send\s+--to\s+['"]?w1:p1['"]?\s+--type\s+note/);
    assert.equal(/--wait/.test(rewritten), command.includes('--wait'), 'a --wait dispatch keeps waiting through the mailbox');
    assert.equal(/--timeout 600000/.test(rewritten), command.includes('--timeout 600000'), 'the wait limit is carried over');
    assert.doesNotMatch(rewritten, /💬/, 'the guard no longer signs: the mailbox does');
    assert.ok(rewritten.includes('report with spaces'));
    assert.doesNotMatch(rewritten, /herdr agent prompt/);
  }
  // A command that is not a delivery call is left as written.
  const other = hook('node /tmp/other-tool/send.mjs --to w1:p1 "report with spaces"');
  assert.equal(other.status, 0, other.stderr);
  assert.equal(other.stdout.trim(), '', 'an unrecognized send command is not rewritten');
  const longText = 'A'.repeat(750);
  for (const command of [
    `herdr agent prompt w1:p3 "${longText}"`,
    `herdr agent prompt w1:p3 "${longText}" --wait`,
  ]) {
    for (const screen of ['────────────\n❯ draft in progress\n────────────', 'unrecognized screen']) {
      world.screens['w1:p3'] = screen;
      write();
      const blocked = hook(command, { agent_id: 'team-agent', agent_type: 'teammate' });
      assert.equal(blocked.status, 2);
      assert.ok(blocked.stderr.trim().length > 0, 'blocked direct send must explain the reason');
    }
    world.screens['w1:p3'] = '────────────\n❯ \n────────────';
    write();
    const allowed = hook(command, { agent_id: 'team-agent', agent_type: 'teammate' });
    assert.equal(allowed.status, 0, allowed.stderr);
    if (allowed.stdout.trim()) {
      const updated = JSON.parse(allowed.stdout).hookSpecificOutput?.updatedInput;
      assert.ok(!updated || updated.command === command, 'empty unbound sends stay unchanged, including text over 500 characters');
    }
  }
  const calls = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
  assert.equal(calls.filter(c => c.argv[0] === 'agent' && c.argv[1] === 'prompt').length, 0);
});

// 567: the same guard serves Codex (Claude-shaped hook) and agy (its own payload and answer shape).
test('567/AC-1 a Codex payload is rewritten into a mailbox send from its real pane to an owner and passes through to a pane with no mailbox', async t => {
  const { world, write, run } = await guardWorld(t);
  // The sending Codex pane is found by its working directory (the inherited pane id is the server's); the pane with no
  // mailbox is a Codex pane too: its input box cannot be read, so it passes through untouched.
  Object.assign(world.panes.find(pane => pane.pane_id === 'w1:p2'), { agent: 'codex', cwd: '/work/codex-sender' });
  world.panes.find(pane => pane.pane_id === 'w1:p4').agent = 'codex';
  write();
  const bin = fs.mkdtempSync('/tmp/mbbin-');
  fs.writeFileSync(path.join(bin, 'mailbox'), '#!/bin/sh\n', { mode: 0o755 });
  t.after(() => fs.rmSync(bin, { recursive: true, force: true }));
  const codex = (command, extraEnv) => run({ session_id: 'codex-session', turn_id: 'turn-1', transcript_path: null, cwd: '/work/codex-sender', hook_event_name: 'PreToolUse',
    model: 'gpt', permission_mode: 'default', tool_name: 'Bash', tool_input: { command }, tool_use_id: 'call-1' }, { HERDR_PANE_ID: 'w1:p3', ...extraEnv });
  const owner = codex('herdr agent prompt w1:p1 "report from codex"', { PATH: `${bin}${path.delimiter}${process.env.PATH}` });
  assert.equal(owner.status, 0, owner.stderr);
  const output = JSON.parse(owner.stdout).hookSpecificOutput;
  assert.equal(output.permissionDecision, 'allow');
  assert.match(output.updatedInput.command, /^mailbox send --from 'w1:p2' --to 'w1:p1' --type note 'report from codex'$/, 'the bare mailbox command the Codex rule allows, naming the real pane');
  const noBin = codex('herdr agent prompt w1:p1 "report from codex"', { PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin`, HOME: bin });
  assert.match(JSON.parse(noBin.stdout).hookSpecificOutput.updatedInput.command, /^node '.*mailbox\.mjs' send --from 'w1:p2' /, 'without mailbox on the PATH the explicit node call is used');
  const plain = codex('herdr agent prompt w1:p4 "to someone without a mailbox"');
  assert.equal(plain.status, 0, plain.stderr);
  assert.equal(plain.stdout.trim(), '', 'a pane with no mailbox is left to herdr');
});

test('567/AC-2 an agy payload is answered in agy shape: overwrite to the mailbox, deny on a draft, silence otherwise', async t => {
  const { world, write, run } = await guardWorld(t);
  const agy = (CommandLine, name = 'run_command', extraEnv) => run({ conversationId: 'agy-conv', hookEventName: 'PreToolUse', stepIdx: 3,
    toolCall: { name, args: { CommandLine, Cwd: '/tmp', WaitMsBeforeAsync: 500 } } }, extraEnv);
  const owner = agy('herdr agent prompt w1:p1 "report from agy"');
  assert.equal(owner.status, 0, owner.stderr);
  const answer = JSON.parse(owner.stdout);
  assert.equal(answer.decision, 'allow');
  assert.match(answer.overwrite.CommandLine, /^node '.*mailbox\.mjs' send --to 'w1:p1' --type note 'report from agy'$/, 'agy runs the explicit node call: its sandbox refuses the bare mailbox command');
  assert.doesNotMatch(answer.overwrite.CommandLine, /herdr agent prompt/);
  assert.equal(owner.stdout.includes('hookSpecificOutput'), false, 'agy does not get the Claude answer shape');
  // No mailbox and a draft in the box: denied in agy's own shape, with the reason.
  const blocked = agy('herdr agent prompt w1:p3 "over a draft"');
  assert.equal(JSON.parse(blocked.stdout).decision, 'deny');
  assert.match(JSON.parse(blocked.stdout).reason, /typing/);
  // Not a delivery call, or not a shell tool: nothing is said.
  assert.equal(agy('ls -la').stdout.trim(), '');
  assert.equal(agy('herdr agent prompt w1:p1 "x"', 'view_file').stdout.trim(), '');
  world.screens['w1:p3'] = '────────────\n❯ \n────────────';
  write();
  assert.equal(agy('herdr agent prompt w1:p3 "empty box"').stdout.trim(), '', 'a pane with no mailbox is left to herdr');
});
