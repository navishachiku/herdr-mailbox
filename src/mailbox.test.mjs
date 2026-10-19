import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Mailboxes, DEDUP_MS } from './core.mjs';
import { emptyState } from './store.mjs';
import { sessionKey } from './paths.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mb-'));

// A mailbox core with a fake clock and a state that is never written to disk.
function fresh() {
  const dir = tmp();
  const clock = { t: 1_800_000_000_000 };
  const core = new Mailboxes({ state: emptyState(), save: () => {}, now: () => clock.t, attachDir: path.join(dir, 'att') });
  return { core, clock, dir };
}
const TO = 'w1:p1';
const decision = (o = {}) => ({ op: 'send', to: TO, from: 'w2:p2', type: 'decision', question: 'Install it?', options: ['yes', 'no'], recommend: 'a', ...o });
const note = (text, o = {}) => ({ op: 'send', to: TO, from: 'w2:p2', type: 'note', text, ...o });

test('receipt carries uid, status and the sender pending list for every type', () => {
  const { core } = fresh();
  const n = core.handle(note('tests pass'));
  const d = core.handle(decision());
  const q = core.handle({ op: 'send', to: TO, from: 'w2:p2', type: 'discussion', question: 'Split the readme?', idea: 'one file' });
  assert.deepEqual([n.status, d.status, q.status], ['queued', 'pending', 'pending']);
  assert.ok(n.uid && d.uid && q.uid && new Set([n.uid, d.uid, q.uid]).size === 3);
  assert.deepEqual(q.pending.map(p => p.uid), [n.uid, d.uid, q.uid]);
});

test('pending list holds only this sender in this mailbox', () => {
  const { core } = fresh();
  core.handle(note('from other', { from: 'w3:p3' }));
  core.handle(note('other box', { to: 'w9:p9' }));
  const mine = core.handle(note('mine'));
  assert.deepEqual(mine.pending.map(p => p.uid), [mine.uid]);
});

test('decision needs 2 to 4 options and a recommendation', () => {
  const { core } = fresh();
  const one = core.handle(decision({ options: ['a'] }));
  const five = core.handle(decision({ options: ['a', 'b', 'c', 'd', 'e'] }));
  const none = core.handle(decision({ recommend: undefined }));
  assert.deepEqual([one.error, five.error, none.error], ['bad_options', 'bad_options', 'missing_recommend']);
  assert.match(none.message, /--recommend/);
  assert.equal(core.handle(decision({ options: ['a', 'b', 'c', 'd'], recommend: 'D' })).ok, true);
});

test('over-limit text is refused with an attachment hint; the limit itself is accepted', () => {
  const { core } = fresh();
  const cases = [
    decision({ question: 'q'.repeat(201) }),
    decision({ options: ['a', 'b'.repeat(81)] }),
    { op: 'send', to: TO, from: 'w2:p2', type: 'discussion', question: 'q', idea: 'i'.repeat(301) },
    note('n'.repeat(501)),
  ];
  for (const c of cases) {
    const r = core.handle(c);
    assert.equal(r.error, 'too_long');
    assert.match(r.message, /--attach/);
  }
  assert.equal(core.handle(note('n'.repeat(500))).ok, true);
  assert.equal(core.handle(decision({ question: 'q'.repeat(200), options: ['a', 'b'.repeat(80)] })).ok, true);
});

test('the attachment is a snapshot taken at send time', () => {
  const { core, dir } = fresh();
  const file = path.join(dir, 'plan.md');
  fs.writeFileSync(file, 'version one');
  const r = core.handle(note('see file', { attach: file }));
  fs.writeFileSync(file, 'version two');
  assert.equal(fs.readFileSync(core.state.letters[r.uid].content.attach.path, 'utf8'), 'version one');
  fs.rmSync(file);
  assert.equal(fs.readFileSync(core.state.letters[r.uid].content.attach.path, 'utf8'), 'version one');
});

test('identical letter from the same sender within 30 seconds is not created again', () => {
  const { core, clock } = fresh();
  const a = core.handle(note('same'));
  clock.t += DEDUP_MS - 1;
  const b = core.handle(note('same'));
  assert.deepEqual([b.uid, b.duplicate, b.reason], [a.uid, true, 'duplicate']);
  assert.equal(Object.keys(core.state.letters).length, 1);
});

test('after 30 seconds, or with different content, a new letter is created', () => {
  const { core, clock } = fresh();
  const a = core.handle(note('same'));
  clock.t += DEDUP_MS;
  assert.notEqual(core.handle(note('same')).uid, a.uid);
  assert.notEqual(core.handle(note('same too')).uid, a.uid);
});

test('an identical unanswered decision from the same sender is returned at any age', () => {
  const { core, clock } = fresh();
  const a = core.handle(decision());
  clock.t += 3_600_000;
  const b = core.handle(decision());
  assert.deepEqual([b.uid, b.duplicate, b.reason], [a.uid, true, 'duplicate_open_question']);
});

test('an identical unanswered decision from another sender is created as its own question', () => {
  const { core } = fresh();
  const a = core.handle(decision());
  const b = core.handle(decision({ from: 'w5:p5' }));
  assert.equal(b.ok, true);
  assert.notEqual(b.uid, a.uid);
  assert.equal(b.duplicate, undefined);
  assert.equal(Object.keys(core.state.letters).length, 2);
});

test('an answered or withdrawn decision is not a duplicate', () => {
  const { core, clock } = fresh();
  const a = core.handle(decision());
  core.handle({ op: 'answer', uid: a.uid, version: 1, choice: 'B' });
  clock.t += 3_600_000;
  const b = core.handle(decision());
  assert.notEqual(b.uid, a.uid);
  core.handle({ op: 'withdraw', uid: b.uid, from: 'w2:p2', reason: 'x' });
  assert.notEqual(core.handle(decision()).uid, b.uid);
});

test('edit and withdraw before the user answers keep the serial and mark the letter', () => {
  const { core } = fresh();
  const a = core.handle(decision());
  const e = core.handle({ op: 'edit', uid: a.uid, from: 'w2:p2', question: 'Install it now?' });
  assert.deepEqual([e.ok, e.serial, e.version], [true, a.serial, 2]);
  assert.equal(core.state.letters[a.uid].edited, true);
  assert.equal(core.state.letters[a.uid].content.question, 'Install it now?');
  const w = core.handle({ op: 'withdraw', uid: a.uid, from: 'w2:p2', reason: 'not needed' });
  assert.deepEqual([w.status, w.serial], ['withdrawn', a.serial]);
  assert.equal(w.pending.length, 0);
});

test('only the sender can edit, and withdraw needs a reason', () => {
  const { core } = fresh();
  const a = core.handle(decision());
  assert.equal(core.handle({ op: 'edit', uid: a.uid, from: 'w9:p9', question: 'x' }).error, 'not_sender');
  assert.equal(core.handle({ op: 'withdraw', uid: a.uid, from: 'w2:p2' }).error, 'missing_reason');
});

test('once the user has answered, edit, withdraw and supersede are refused until it is sent', () => {
  const { core } = fresh();
  const a = core.handle(decision());
  core.handle({ op: 'answer', uid: a.uid, version: 1, text: 'only a note' });
  const edit = core.handle({ op: 'edit', uid: a.uid, from: 'w2:p2', question: 'changed' });
  const wd = core.handle({ op: 'withdraw', uid: a.uid, from: 'w2:p2', reason: 'x' });
  const sup = core.handle(decision({ question: 'newer', supersedes: a.uid }));
  assert.deepEqual([edit.error, wd.error, sup.error], ['user_answered', 'user_answered', 'user_answered']);
  assert.match(edit.message, /already answered/);
  assert.equal(Object.keys(core.state.letters).length, 1);
});

test('clearing the answer unlocks the question again', () => {
  const { core } = fresh();
  const a = core.handle(decision());
  core.handle({ op: 'answer', uid: a.uid, version: 1, choice: 'A' });
  core.handle({ op: 'answer', uid: a.uid, version: 1 });
  assert.equal(core.handle({ op: 'edit', uid: a.uid, from: 'w2:p2', question: 'changed' }).ok, true);
});

test('a new question that supersedes a sent one marks the old one superseded', () => {
  const { core } = fresh();
  const a = core.handle(decision());
  core.handle({ op: 'answer', uid: a.uid, version: 1, choice: 'P' });
  core.handle({ op: 'submit', items: [{ uid: a.uid, version: 1 }] });
  assert.equal(core.state.letters[a.uid].status, 'submitted');
  const b = core.handle(decision({ question: 'Install it, really?', supersedes: a.uid }));
  assert.equal(b.ok, true);
  assert.equal(core.state.letters[a.uid].status, 'superseded');
  assert.equal(core.state.letters[a.uid].supersededBy, b.uid);
});

test('a serial number is refused with a hint to use the uid', () => {
  const { core } = fresh();
  const a = core.handle(decision());
  const byEdit = core.handle({ op: 'edit', uid: a.serial, from: 'w2:p2', question: 'x' });
  const bySup = core.handle(decision({ question: 'y', supersedes: a.serial }));
  assert.deepEqual([byEdit.error, bySup.error], ['serial_not_accepted', 'serial_not_accepted']);
  assert.match(byEdit.message, /uid/);
});

// End to end: the real CLI and a real daemon in an isolated state directory.
function sandbox({ root = fs.mkdtempSync(path.join('/tmp', 'mbe-')), session = 'herdr.sock' } = {}) {
  const socket = path.join(root, session);
  const env = { ...process.env, HERDR_MAILBOX_STATE_DIR: root, HERDR_SOCKET_PATH: socket, HERDR_PANE_ID: 'w2:p2' };
  delete env.HERDR_PLUGIN_STATE_DIR;
  // The daemon keeps its files in a directory named after the herdr session.
  const dir = path.join(root, sessionKey(socket));
  const cli = (...args) => {
    const r = spawnSync(process.execPath, [path.join(here, 'mailbox.mjs'), ...args], { env, encoding: 'utf8' });
    return { code: r.status, out: r.stdout.trim() ? JSON.parse(r.stdout) : null, err: r.stderr };
  };
  const raw = msg => new Promise((resolve, reject) => {
    const c = net.connect(path.join(dir, 'd.sock'));
    let buf = '';
    c.on('connect', () => c.write(`${JSON.stringify({ proto: 1, ...msg })}\n`));
    c.on('data', d => { buf += d; });
    c.on('end', () => resolve(JSON.parse(buf)));
    c.on('error', reject);
  });
  const pid = () => Number(fs.readFileSync(path.join(dir, 'daemon.pid'), 'utf8'));
  const stop = () => { try { process.kill(pid(), 'SIGKILL'); } catch { /* not running */ } };
  const cleanup = () => { stop(); fs.rmSync(root, { recursive: true, force: true }); };
  return { root, dir, env, cli, raw, pid, stop, cleanup };
}

test('the CLI starts the daemon when it is not running, then sends', () => {
  const s = sandbox();
  try {
    assert.equal(fs.existsSync(path.join(s.dir, 'd.sock')), false);
    const r = s.cli('send', '--to', TO, '--type', 'note', 'hello');
    assert.equal(r.code, 0);
    assert.equal(r.out.status, 'queued');
    assert.ok(s.pid() > 0);
  } finally { s.cleanup(); }
});

test('when the daemon cannot start the CLI reports failure and sends nothing', () => {
  const s = sandbox();
  try {
    s.env.HERDR_MAILBOX_DAEMON_ENTRY = path.join(s.dir, 'missing.mjs');
    s.env.HERDR_BIN_PATH = path.join(s.dir, 'no-herdr');
    const r = s.cli('send', '--to', TO, '--type', 'note', 'hello');
    assert.equal(r.code, 1);
    assert.equal(r.out.error, 'daemon_unavailable');
    assert.equal(fs.existsSync(path.join(s.dir, 'state.json')), false);
  } finally { s.cleanup(); }
});

test('a killed daemon comes back with the letter and the answer draft', async () => {
  const s = sandbox();
  try {
    const sent = s.cli('send', '--to', TO, '--type', 'decision', '--question', 'Install it?', '--option', 'yes', '--option', 'no', '--recommend', 'A');
    assert.equal(sent.code, 0);
    const uid = sent.out.uid;
    assert.equal((await s.raw({ op: 'answer', uid, version: 1, choice: 'B', text: 'with a note' })).userAnswered, true);
    process.kill(s.pid(), 'SIGKILL');
    await new Promise(r => setTimeout(r, 200));
    const status = s.cli('status');
    assert.equal(status.code, 0);
    assert.deepEqual(status.out.mailboxes[0].pending.map(p => [p.uid, p.userAnswered]), [[uid, true]]);
    const saved = JSON.parse(fs.readFileSync(path.join(s.dir, 'state.json'), 'utf8'));
    assert.deepEqual(saved.letters[uid].draft, { choice: 'B', text: 'with a note' });
    assert.equal(s.cli('edit', uid, '--question', 'x').out.error, 'user_answered');
  } finally { s.cleanup(); }
});

test('a daemon of another protocol version makes the CLI refuse and say to restart', async () => {
  const s = sandbox();
  const old = spawn(process.execPath, [path.join(here, 'daemon.mjs')], { env: { ...s.env, HERDR_MAILBOX_DAEMON_PROTO: '99' }, stdio: 'ignore' });
  try {
    for (let i = 0; i < 50 && !fs.existsSync(path.join(s.dir, 'd.sock')); i++) await new Promise(r => setTimeout(r, 50));
    const r = s.cli('send', '--to', TO, '--type', 'note', 'hello');
    assert.equal(r.code, 1);
    assert.equal(r.out.error, 'incompatible_daemon');
    assert.match(r.out.message, /restart the daemon/);
    assert.equal(fs.existsSync(path.join(s.dir, 'state.json')), false);
  } finally { old.kill('SIGKILL'); s.cleanup(); }
});

test('resending a letter that superseded an older one returns the original receipt', () => {
  const { core } = fresh();
  const old = core.handle(decision());
  const first = core.handle(decision({ question: 'Install it, really?', supersedes: old.uid }));
  const again = core.handle(decision({ question: 'Install it, really?', supersedes: old.uid }));
  assert.deepEqual([again.ok, again.uid, again.duplicate], [true, first.uid, true]);
});

test('six first sends at once start one daemon and lose no letter', async () => {
  const s = sandbox();
  try {
    const run = i => new Promise(resolve => {
      const c = spawn(process.execPath, [path.join(here, 'mailbox.mjs'), 'send', '--to', TO, '--type', 'note', `m${i}`], { env: s.env });
      let out = '';
      c.stdout.on('data', d => { out += d; });
      c.on('close', code => resolve({ code, out: JSON.parse(out) }));
    });
    const results = await Promise.all([0, 1, 2, 3, 4, 5].map(run));
    assert.ok(results.every(r => r.code === 0));
    assert.equal(new Set(results.map(r => r.out.serial)).size, 6);
    const ps = spawnSync('ps', ['-eo', 'pid=,command='], { encoding: 'utf8' }).stdout.split('\n').filter(l => l.includes(path.join(here, 'daemon.mjs')));
    assert.equal(ps.length, 1);
    assert.equal(Object.keys(JSON.parse(fs.readFileSync(path.join(s.dir, 'state.json'), 'utf8')).letters).length, 6);
  } finally { s.cleanup(); }
});

test('a failed save returns a failure, keeps nothing in memory, and a resend lands', () => {
  const dir = tmp();
  let failing = true;
  const core = new Mailboxes({ state: emptyState(), save: () => { if (failing) throw Object.assign(new Error('disk full'), { code: 'ENOSPC' }); }, now: () => 1_800_000_000_000, attachDir: path.join(dir, 'att') });
  const first = core.handle(note('hello'));
  assert.deepEqual([first.ok, first.error], [false, 'save_failed']);
  assert.equal(Object.keys(core.state.letters).length, 0);
  failing = false;
  const again = core.handle(note('hello'));
  assert.deepEqual([again.ok, again.duplicate, again.serial], [true, undefined, 'N001']);
});

test('the state directory, state file and socket are owner-only', () => {
  const s = sandbox();
  const base = path.join(s.root, 'sub');
  s.env.HERDR_MAILBOX_STATE_DIR = base;
  const dir = path.join(base, sessionKey(s.env.HERDR_SOCKET_PATH));
  try {
    assert.equal(s.cli('send', '--to', TO, '--type', 'note', 'hello').code, 0);
    const mode = f => fs.statSync(f).mode & 0o777;
    assert.deepEqual([mode(base), mode(dir)], [0o700, 0o700]);
    assert.deepEqual(['state.json', 'd.sock', 'daemon.pid'].map(f => mode(path.join(dir, f))), [0o600, 0o600, 0o600]);
  } finally { try { process.kill(Number(fs.readFileSync(path.join(dir, 'daemon.pid'), 'utf8')), 'SIGKILL'); } catch { /* gone */ } s.cleanup(); }
});

test('two herdr sessions with the same pane address keep separate mailboxes and daemons', async () => {
  const a = sandbox();
  const b = sandbox({ root: a.root, session: 'other.sock' });
  try {
    const sentA = a.cli('send', '--to', 'w1:p2', '--type', 'note', 'for session A');
    assert.equal(b.cli('status').out.mailboxes.length, 0);
    const sentB = b.cli('send', '--to', 'w1:p2', '--type', 'note', 'for session B');
    assert.deepEqual([sentA.out.serial, sentB.out.serial], ['N001', 'N001']);
    assert.deepEqual(a.cli('status').out.mailboxes[0].pending.map(p => p.summary), ['for session A']);
    assert.deepEqual(b.cli('status').out.mailboxes[0].pending.map(p => p.summary), ['for session B']);
    assert.notEqual(a.pid(), b.pid());
    assert.notEqual(a.dir, b.dir);
  } finally { b.stop(); a.cleanup(); }
});
