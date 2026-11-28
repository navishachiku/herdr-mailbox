import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Mailboxes, DEDUP_MS, attachmentsOf } from './core.mjs';
import { notesBatch } from './format.mjs';
import { emptyState } from './store.mjs';
import { sessionKey } from './paths.mjs';
import { readCardRules, checkStepText } from './card-rules.mjs';
import { guardDaemon } from './test-support/daemon-sandbox.cjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mb-'));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// Core-only tests start with bound mailboxes; identity and its herdr lookup are covered separately.
function boundCore(options) {
  const state = emptyState();
  for (const [i, to] of ['w1:p1', 'w9:p9'].entries()) {
    const id = `MB-000${i}`;
    state.mailboxes[id] = {
      id, counter: 0, owner: { pane: to, terminalId: `terminal-${i}`, convo: `sid-${i}`, transcript: null, generation: 1 },
      state: 'connected', disconnect: null, paused: null, screen: { open: false },
    };
  }
  const core = new Mailboxes({ ...options, state });
  core.register(api => api.hook('route', to => {
    const box = Object.values(api.state.mailboxes).find(b => b.id === to || b.owner.pane === to);
    return box ? { kind: 'mailbox', id: box.id } : { kind: 'direct', pane: to };
  }));
  return core;
}

// A mailbox core with a fake clock and a state that is never written to disk.
function fresh() {
  const dir = tmp();
  const clock = { t: 1_800_000_000_000 };
  const core = boundCore({ save: () => {}, now: () => clock.t, attachDir: path.join(dir, 'att') });
  return { core, clock, dir };
}
const TO = 'w1:p1';
const decision = (o = {}) => {
  const options = o.options ?? ['yes', 'no'];
  return { op: 'send', to: TO, from: 'w2:p2', source: 'test', type: 'decision', question: 'Install it?', options, tradeoffs: options.map((_, i) => `trade-off ${i}`), whyOpen: 'no rule covers it', recommend: 'a', ...o };
};
const note = (text, o = {}) => ({ op: 'send', to: TO, from: 'w2:p2', type: 'note', text, ...o });

test('receipt carries uid, status and the sender pending list for every type', () => {
  const { core } = fresh();
  const n = core.handle(note('tests pass'));
  const d = core.handle(decision());
  const q = core.handle({ op: 'send', to: TO, from: 'w2:p2', source: 'test', type: 'discussion', question: 'Split the readme?', idea: 'one file' });
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

test('decision needs 2 to 4 options; a recommendation is optional but must be a valid letter when given', () => {
  const { core } = fresh();
  const one = core.handle(decision({ options: ['a'] }));
  const five = core.handle(decision({ options: ['a', 'b', 'c', 'd', 'e'] }));
  const bad = core.handle(decision({ recommend: 'C' }));
  assert.deepEqual([one.error, five.error, bad.error], ['bad_options', 'bad_options', 'bad_recommend']);
  assert.equal(core.handle(decision({ options: ['a', 'b', 'c', 'd'], recommend: 'D' })).ok, true);
});

test('259/AC-1 a decision question without a recommendation is accepted, stored without one, and refuses the take-the-recommendation choice', () => {
  const { core } = fresh();
  const sent = core.handle(decision({ recommend: undefined }));
  assert.equal(sent.ok, true);
  assert.equal('recommend' in core.state.letters[sent.uid].content, false);
  assert.equal(core.handle({ op: 'answer', uid: sent.uid, version: 1, choice: 'P' }).error, 'bad_choice');
  assert.equal(core.handle({ op: 'answer', uid: sent.uid, version: 1, choice: 'B' }).ok, true);
});

test('202/AC-31 sending strips only an option own leading letter and preserves another option letter', () => {
  const { core, dir } = fresh();
  try {
    const sent = core.handle(decision({
      options: ['A 改甲', '(B) Change beta', 'C. Change gamma', 'B belongs to the fourth option'],
      recommend: 'A',
    }));
    assert.equal(sent.ok, true);
    assert.deepEqual(core.state.letters[sent.uid].content.options, [
      '改甲', 'Change beta', 'Change gamma', 'B belongs to the fourth option',
    ], 'the send entry point stores normalized options without removing a different option letter');
    const english = core.handle(decision({ options: ['A new plan', 'Keep the existing plan'] }));
    assert.equal(english.ok, true);
    assert.equal(core.state.letters[english.uid].content.options[0], 'A new plan', 'an English word followed by Latin text is not an option prefix');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('over-limit text is refused with an attachment hint; the limit itself is accepted', () => {
  const { core } = fresh();
  const cases = [
    decision({ question: 'q'.repeat(201) }),
    decision({ options: ['a', 'b'.repeat(81)] }),
    { op: 'send', to: TO, from: 'w2:p2', source: 'test', type: 'discussion', question: 'q', idea: 'i'.repeat(301) },
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
  assert.equal(fs.readFileSync(attachmentsOf(core.state.letters[r.uid].content)[0].path, 'utf8'), 'version one');
  fs.rmSync(file);
  assert.equal(fs.readFileSync(attachmentsOf(core.state.letters[r.uid].content)[0].path, 'utf8'), 'version one');
});

test('363 a .txt attachment refuses the whole letter and says to use .md; a .md attachment goes out', () => {
  const { core, dir } = fresh();
  const txt = path.join(dir, 'notes.TXT');
  const md = path.join(dir, 'notes.md');
  fs.writeFileSync(txt, 'x');
  fs.writeFileSync(md, 'x');
  for (const r of [core.handle(note('see', { attach: txt })), core.handle(note('see', { attach: [md, txt] }))]) {
    assert.equal(r.ok, false);
    assert.equal(r.error, 'bad_attach');
    assert.match(r.message, /\.md/);
  }
  assert.equal(Object.keys(core.state.letters).length, 0);
  assert.equal(core.handle(note('see', { attach: md })).ok, true);
});

test('526 replay of a real case: a decision or discussion card with 2 or more images is refused and asks for one page; one image, non-images and notes go out', () => {
  const { core, dir } = fresh();
  const make = names => names.map(n => { const f = path.join(dir, n); fs.writeFileSync(f, 'x'); return f; });
  const shots = make(['f02.png', 'f04.png', 'f08.png', 'f10.PNG']);
  const [page, sample] = make(['pages.html', 'notes.md']);
  const discussion = o => ({ op: 'send', to: TO, from: 'w2:p2', source: 'test', type: 'discussion', question: 'Which layout?', idea: 'two pages', ...o });
  for (const card of [decision({ attach: shots }), discussion({ attach: shots.slice(0, 2) }), decision({ attach: [shots[0], page, shots[1]] })]) {
    const r = core.handle(card);
    assert.equal(r.ok, false);
    assert.equal(r.error, 'too_many_images');
    assert.match(r.message, /one page/);
  }
  assert.equal(Object.keys(core.state.letters).length, 0, 'no partial letter is stored');
  assert.equal(core.handle(decision({ attach: shots[0] })).ok, true);
  assert.equal(core.handle(discussion({ attach: [shots[1], page, sample] })).ok, true);
  assert.equal(core.handle(decision({ question: 'Other?', attach: [page, sample] })).ok, true);
  assert.equal(core.handle(note('shots for you', { attach: shots })).ok, true);
  const q = core.handle(decision({ question: 'Edit me?', attach: shots[2] }));
  assert.equal(core.handle({ op: 'edit', uid: q.uid, from: 'w2:p2', attach: shots }).error, 'too_many_images');
});

test('207/AC-1 every attachment of one letter is kept and shown to the receiver, and a single-attachment letter from before still reads', () => {
  const { core, dir } = fresh();
  const files = ['a.md', 'b.md', 'c.md'].map(n => { const f = path.join(dir, n); fs.writeFileSync(f, `body of ${n}`); return f; });
  const r = core.handle(note('three files', { attach: files }));
  assert.equal(r.ok, true);
  const letter = core.state.letters[r.uid];
  const kept = attachmentsOf(letter.content);
  assert.deepEqual(kept.map(a => fs.readFileSync(a.path, 'utf8')), ['body of a.md', 'body of b.md', 'body of c.md']);
  const text = notesBatch({ id: 'B1', letters: [letter], people: {} });
  for (const a of kept) assert.ok(text.includes(a.path), `the delivered text must name ${a.path}`);
  const old = { ...letter, content: { type: 'note', text: 'old', attach: { name: 'x.md', path: '/old/x.md' } } };
  assert.ok(notesBatch({ id: 'B2', letters: [old], people: {} }).includes('/old/x.md'));
  assert.deepEqual(attachmentsOf(old.content).map(a => a.name), ['x.md']);
});

test('207/AC-2 more than 5 attachments or an unreadable one refuses the whole letter and names the culprit', () => {
  const { core, dir } = fresh();
  const ok = Array.from({ length: 6 }, (_, i) => { const f = path.join(dir, `f${i}.md`); fs.writeFileSync(f, 'x'); return f; });
  const many = core.handle(note('too many', { attach: ok }));
  assert.equal(many.error, 'too_many_attach');
  assert.match(many.message, /at most 5.*got 6/);
  const missing = path.join(dir, 'missing.md');
  const bad = core.handle(note('one is gone', { attach: [ok[0], missing] }));
  assert.equal(bad.error, 'bad_attach');
  assert.ok(bad.message.includes(missing), 'the message names the unreadable file');
  assert.equal(Object.keys(core.state.letters).length, 0, 'no partial letter is stored');
  assert.equal(core.handle(note('five is fine', { attach: ok.slice(0, 5) })).ok, true);
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
  const env = {
    ...process.env, HERDR_MAILBOX_STATE_DIR: root, HERDR_SOCKET_PATH: socket, HERDR_PANE_ID: 'w2:p2',
    HERDR_BIN_PATH: path.join(here, 'test-support', 'fake-herdr.mjs'),
    FAKE_HERDR_STATE: path.join(root, `${session}-fake.json`),
    FAKE_HERDR_LOG: path.join(root, `${session}-fake.log`),
    HERDR_MAILBOX_TIMINGS: JSON.stringify({ mergeMs: 3_600_000 }),
  };
  delete env.HERDR_PLUGIN_STATE_DIR;
  delete env.HERDR_PLUGIN_ID;
  delete env.HERDR_MAILBOX_SID;
  delete env.HERDR_MAILBOX_DAEMON_ENTRY;
  delete env.HERDR_MAILBOX_DAEMON_PROTO;
  guardDaemon(env, root);
  fs.writeFileSync(env.FAKE_HERDR_STATE, JSON.stringify({
    panes: [TO, 'w1:p2', 'w2:p2'].map((id, i) => ({
      pane_id: id, terminal_id: `terminal-${i}`, workspace_id: 'w1', tab_id: 'w1:t1',
      label: id, agent: 'claude', agent_status: 'idle', agent_session: { value: `sid-${i}` },
    })),
    screens: {}, promptResult: {}, transcripts: {},
  }));
  // The daemon keeps its files in a directory named after the herdr session.
  const dir = path.join(root, sessionKey(socket));
  const currentDir = () => path.join(env.HERDR_MAILBOX_STATE_DIR, sessionKey(socket));
  const cli = (...args) => {
    const r = spawnSync(process.execPath, [path.join(here, 'mailbox.mjs'), ...args], { env, encoding: 'utf8' });
    return { code: r.status, out: r.stdout.trim() ? JSON.parse(r.stdout) : null, err: r.stderr };
  };
  const raw = msg => new Promise((resolve, reject) => {
    // Existing answer fixtures represent writes from the mailbox screen.
    const stateFile = path.join(currentDir(), 'state.json');
    if (msg.op === 'answer' && fs.existsSync(stateFile)) {
      const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      const box = state.mailboxes[state.letters[msg.uid]?.mailbox];
      msg = { caller: { viaPlugin: true }, generation: box?.owner?.generation, ...msg };
    }
    const c = net.connect(path.join(currentDir(), 'd.sock'));
    let buf = '';
    c.on('connect', () => c.write(`${JSON.stringify({ proto: 1, ...msg })}\n`));
    c.on('data', d => { buf += d; });
    c.on('end', () => resolve(JSON.parse(buf)));
    c.on('error', reject);
  });
  const pid = () => Number(fs.readFileSync(path.join(currentDir(), 'daemon.pid'), 'utf8'));
  const stop = () => { try { process.kill(pid(), 'SIGKILL'); } catch { /* not running */ } };
  const cleanup = () => { stop(); fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); };
  const bind = async (to = TO, { cold = false } = {}) => {
    const started = cli('status');
    if (started.code !== 0) throw new Error(`mailbox setup failed: ${JSON.stringify(started)}`);
    const bound = await raw({ op: 'bind', pane: to, caller: { viaPlugin: true } });
    if (!bound.ok) throw new Error(`mailbox bind failed: ${JSON.stringify(bound)}`);
    if (cold) {
      // Preserve first-send startup coverage while retaining the bound mailbox on disk.
      process.kill(pid(), 'SIGTERM');
      const deadline = Date.now() + 3000;
      while (fs.existsSync(path.join(currentDir(), 'daemon.pid'))) {
        if (Date.now() > deadline) throw new Error('setup daemon did not stop');
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      fs.rmSync(path.join(currentDir(), 'd.sock'), { force: true });
    }
    return bound.mailbox;
  };
  return { root, dir, env, cli, raw, pid, stop, cleanup, bind };
}

test('the CLI starts the daemon when it is not running, then sends', async () => {
  const s = sandbox();
  try {
    await s.bind(TO, { cold: true });
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

test('a daemon starting after its test sandbox was cleaned up exits', () => {
  const s = sandbox();
  s.cleanup();
  try {
    const result = spawnSync(process.execPath, [path.join(here, 'daemon.mjs')], {
      env: s.env, encoding: 'utf8', timeout: 5000, killSignal: 'SIGKILL',
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(fs.existsSync(s.root), false);
  } finally { s.cleanup(); }
});

test('a daemon whose test sandbox is cleaned up while it is still loading exits', async () => {
  const s = sandbox();
  // Hold the daemon after the sandbox guard has run and before daemon.mjs loads, then clean up during that pause.
  const hold = path.join(tmp(), 'hold.mjs');
  fs.writeFileSync(hold, 'Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);\n');
  const child = spawn(process.execPath, [path.join(here, 'daemon.mjs')], {
    env: { ...s.env, NODE_OPTIONS: `${s.env.NODE_OPTIONS} --import ${JSON.stringify(pathToFileURL(hold).href)}` }, stdio: 'ignore',
  });
  const exited = new Promise(resolve => child.once('exit', code => resolve(code)));
  try {
    await sleep(400);
    s.cleanup();
    const code = await Promise.race([exited, sleep(5000).then(() => 'still running')]);
    assert.equal(code, 0);
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    s.cleanup();
    fs.rmSync(path.dirname(hold), { recursive: true, force: true });
  }
});

test('a killed daemon comes back with the letter and the answer draft', async () => {
  const s = sandbox();
  try {
    await s.bind();
    const sent = s.cli('send', '--to', TO, '--type', 'decision', '--question', 'Install it?', '--option', 'yes', '--option', 'no', '--tradeoff', 'faster, but one more thing to keep', '--tradeoff', 'nothing new, but done by hand', '--why-open', 'no rule covers it', '--recommend', 'A', '--from', TO, '--source', 'test');
    assert.equal(sent.code, 0);
    const uid = sent.out.uid;
    assert.equal((await s.raw({ op: 'answer', uid, version: 1, choice: 'B', text: 'with a note' })).userAnswered, true);
    process.kill(s.pid(), 'SIGKILL');
    await new Promise(r => setTimeout(r, 200));
    const status = s.cli('status', '--from', TO);
    assert.equal(status.code, 0);
    assert.deepEqual(status.out.mailboxes[0].pending.map(p => [p.uid, p.userAnswered]), [[uid, true]]);
    const saved = JSON.parse(fs.readFileSync(path.join(s.dir, 'state.json'), 'utf8'));
    assert.deepEqual(saved.letters[uid].draft, { choice: 'B', text: 'with a note' });
    assert.equal(s.cli('edit', uid, '--question', 'x', '--from', TO).out.error, 'user_answered');
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
    await s.bind(TO, { cold: true });
    const run = i => new Promise(resolve => {
      const c = spawn(process.execPath, [path.join(here, 'mailbox.mjs'), 'send', '--to', TO, '--type', 'note', `m${i}`], { env: s.env });
      let out = '';
      c.stdout.on('data', d => { out += d; });
      c.on('close', code => resolve({ code, out: JSON.parse(out) }));
    });
    const results = await Promise.all([0, 1, 2, 3, 4, 5].map(run));
    assert.ok(results.every(r => r.code === 0));
    assert.equal(new Set(results.map(r => r.out.serial)).size, 6);
    // Other test files may run their own daemons; count only processes in this sandbox.
    const ps = spawnSync('ps', ['eww', '-axo', 'pid=,command='], { encoding: 'utf8' }).stdout.split('\n')
      .filter(l => l.includes(path.join(here, 'daemon.mjs'))
        && l.split(/\s+/).includes(`HERDR_MAILBOX_STATE_DIR=${s.env.HERDR_MAILBOX_STATE_DIR}`));
    assert.equal(ps.length, 1);
    assert.equal(Object.keys(JSON.parse(fs.readFileSync(path.join(s.dir, 'state.json'), 'utf8')).letters).length, 6);
  } finally { s.cleanup(); }
});

test('a failed save returns a failure, keeps nothing in memory, and a resend lands', () => {
  const dir = tmp();
  let failing = true;
  const core = boundCore({ save: () => { if (failing) throw Object.assign(new Error('disk full'), { code: 'ENOSPC' }); }, now: () => 1_800_000_000_000, attachDir: path.join(dir, 'att') });
  const first = core.handle(note('hello'));
  assert.deepEqual([first.ok, first.error], [false, 'save_failed']);
  assert.equal(Object.keys(core.state.letters).length, 0);
  failing = false;
  const again = core.handle(note('hello'));
  assert.deepEqual([again.ok, again.duplicate, again.serial], [true, undefined, 'N001']);
});

test('the state directory, state file and socket are owner-only', async () => {
  const s = sandbox();
  const base = path.join(s.root, 'sub');
  s.env.HERDR_MAILBOX_STATE_DIR = base;
  const dir = path.join(base, sessionKey(s.env.HERDR_SOCKET_PATH));
  try {
    await s.bind();
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
    await a.bind('w1:p2');
    const sentA = a.cli('send', '--to', 'w1:p2', '--type', 'note', 'for session A');
    assert.equal(b.cli('status').out.mailboxes.length, 0);
    await b.bind('w1:p2');
    const sentB = b.cli('send', '--to', 'w1:p2', '--type', 'note', 'for session B');
    assert.deepEqual([sentA.out.serial, sentB.out.serial], ['N001', 'N001']);
    assert.deepEqual(a.cli('status').out.mailboxes[0].pending.map(p => p.summary), ['for session A']);
    assert.deepEqual(b.cli('status').out.mailboxes[0].pending.map(p => p.summary), ['for session B']);
    assert.notEqual(a.pid(), b.pid());
    assert.notEqual(a.dir, b.dir);
  } finally { b.stop(); a.cleanup(); }
});

// 298: the sent query and the reply line after a delivered letter
test('298/AC-2 sent lists the sender letters in that mailbox since the time, and an empty list when none match', () => {
  const { core, clock } = fresh();
  const old = core.handle(note('old report'));
  clock.t += 60_000;
  const since = clock.t;
  core.handle(note('other sender', { from: 'w3:p3' }));
  core.handle(note('other box', { to: 'w9:p9' }));
  const mine = core.handle(note('new report'));
  const r = core.handle({ op: 'sent', from: 'w2:p2', to: TO, since });
  assert.equal(r.ok, true);
  assert.deepEqual(r.letters.map(l => l.uid), [mine.uid]);
  assert.notEqual(r.letters[0].uid, old.uid);
  const none = core.handle({ op: 'sent', from: 'w2:p2', to: TO, since: clock.t + 1 });
  assert.deepEqual([none.ok, none.letters], [true, []]);
  assert.equal(core.handle({ op: 'status', from: 'w2:p2' }).mailboxes[0].pending.length, 2, 'the query changes no letter');
});

test('298/AC-2 sent is read-only: it saves nothing', () => {
  let saves = 0;
  const core = boundCore({ save: () => { saves += 1; }, now: () => 1_800_000_000_000, attachDir: tmp() });
  core.handle(note('x'));
  const before = saves;
  core.handle({ op: 'sent', from: 'w2:p2', to: TO, since: 0 });
  assert.equal(saves, before);
});

test('298/AC-3 sent through the CLI fails with a recognisable error when the daemon cannot start', () => {
  const s = sandbox();
  try {
    s.env.HERDR_MAILBOX_DAEMON_ENTRY = path.join(s.dir, 'missing.mjs');
    const r = s.cli('sent', '--from', 'w2:p2', '--to', TO, '--since', '2026-10-30T00:00:00Z');
    assert.equal(r.code, 1);
    assert.equal(r.out.ok, false);
    assert.equal(r.out.error, 'daemon_unavailable');
    assert.equal(r.out.letters, undefined);
  } finally { s.cleanup(); }
});

test('298/AC-1 the reply line says a reply is required when the body asks for one, and not otherwise, in English and Traditional Chinese', () => {
  const run = locale => spawnSync(process.execPath, ['--input-type=module', '-e',
    `import { replyLines } from ${JSON.stringify(new URL('./format.mjs', import.meta.url).href)};
     console.log(replyLines(['p'], { p: { mailbox: 'MB-1' } }).join('\\n'));`],
  { env: { ...process.env, LC_ALL: locale }, encoding: 'utf8' }).stdout.trim();
  assert.equal(run('en_US.UTF-8'), 'Reply to MB-1 whenever the message asks you to report or answer, even if the work is done; skip the reply only if the message asks for nothing and you would just confirm receipt');
  assert.equal(run('zh_TW.UTF-8'), '內文要求回報或回覆時，一定要寄 MB-1，做完了也要回；內文沒有任何要求、只是確認收到才不必回');
});

test('298/AC-2 sent through the CLI and a running daemon returns the letter just sent, by pane address', async () => {
  const s = sandbox();
  try {
    await s.bind(TO);
    const sentAt = Date.now() - 1000;
    const sendRes = s.cli('send', '--to', TO, '--from', 'w2:p2', '--type', 'note', 'report');
    const hit = s.cli('sent', '--from', 'w2:p2', '--to', TO, '--since', String(sentAt));
    assert.equal(hit.code, 0);
    assert.deepEqual(hit.out.letters.map(l => l.uid), [sendRes.out.uid]);
    const miss = s.cli('sent', '--from', 'w2:p2', '--to', TO, '--since', String(Date.now() + 60_000));
    assert.deepEqual([miss.code, miss.out.letters], [0, []]);
  } finally { s.cleanup(); }
});

test('298/AC-1 the line the hook adds for a Claude receiver says a reply is required when the body asks for one, and not otherwise, in English and Traditional Chinese', () => {
  const run = locale => spawnSync(process.execPath, ['--input-type=module', '-e',
    `import { hookContext } from ${JSON.stringify(new URL('./format.mjs', import.meta.url).href)};
     console.log(hookContext({ batch: { id: 'B1', kind: 'notes' }, items: [{ uid: 'U1', serial: 'N1', sender: 'w1:p2', label: 'Sender', mailbox: 'MB-1' }] }).split('\\n').at(-1));`],
  { env: { ...process.env, LC_ALL: locale }, encoding: 'utf8' }).stdout.trim();
  assert.ok(run('en_US.UTF-8').endsWith('; reply to MB-1 whenever the message asks you to report or answer, even if the work is done; skip the reply only if the message asks for nothing and you would just confirm receipt'));
  assert.ok(run('zh_TW.UTF-8').endsWith('；內文要求回報或回覆時，一定要寄 MB-1，做完了也要回；內文沒有任何要求、只是確認收到才不必回'));
});

test('a Codex command is signed with the Codex pane it runs in, not the pane that started the shared server', async () => {
  const { senderPane } = await import('./sender.mjs');
  const dir = fs.mkdtempSync(path.join('/tmp', 'mbsender-'));
  const state = path.join(dir, 'fake.json');
  fs.writeFileSync(state, JSON.stringify({ panes: [
    { pane_id: 'w1:p1', agent: 'codex', cwd: '/work/server-start' },
    { pane_id: 'w1:p9', agent: 'codex', cwd: '/work/here' },
    { pane_id: 'w1:p2', agent: 'claude', cwd: '/work/here' },
  ] }));
  const saved = { bin: process.env.HERDR_BIN_PATH, st: process.env.FAKE_HERDR_STATE };
  process.env.HERDR_BIN_PATH = path.join(here, 'test-support', 'fake-herdr.mjs');
  process.env.FAKE_HERDR_STATE = state;
  try {
    const env = { HERDR_PANE_ID: 'w1:p1', CODEX_THREAD_ID: 'thread-1' };
    assert.equal(await senderPane(env, '/work/here'), 'w1:p9');
    assert.equal(await senderPane({ HERDR_PANE_ID: 'w1:p2' }, '/work/here'), 'w1:p2', 'not Codex: the inherited id stands');
    assert.equal(await senderPane(env, '/work/nowhere'), null, 'no single match: the sender is unknown, never the inherited id');
    const cli = (args, extra = {}) => spawnSync(process.execPath, [path.join(here, 'mailbox.mjs'), ...args], {
      cwd: '/', env: { ...process.env, ...env, ...extra }, encoding: 'utf8', timeout: 15000 });
    const refused = cli(['send', '--to', 'w1:p2', '--type', 'note', 'x']);
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /--from/);
  } finally {
    for (const [k, v] of [['HERDR_BIN_PATH', saved.bin], ['FAKE_HERDR_STATE', saved.st]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('338/AC-6 withdrawing, editing or superseding a voided question says it was voided and not to wait', () => {
  const { core } = fresh();
  const a = core.handle(decision());
  core.handle({ op: 'answer', uid: a.uid, version: 1, choice: 'X', text: '' });
  // Between answering X and the submit, and after it, the answer is the same: voided.
  for (const stage of ['answered', 'submitted']) {
    if (stage === 'submitted') core.handle({ op: 'submit', items: [{ uid: a.uid, version: 1 }] });
    const results = [
      core.handle({ op: 'withdraw', uid: a.uid, from: 'w2:p2', reason: 'x' }),
      core.handle({ op: 'edit', uid: a.uid, from: 'w2:p2', question: 'changed' }),
      core.handle(decision({ question: 'newer', supersedes: a.uid })),
    ];
    for (const r of results) { assert.equal(r.error, 'voided', stage); assert.match(r.message, /voided/); assert.doesNotMatch(r.message, /wait/); }
  }
  assert.equal(core.state.letters[a.uid].status, 'voided');
  assert.equal(Object.keys(core.state.letters).length, 1);
});

// Card rules: an optional JSON file; without it every card is accepted.
test('550/AC-1 a configured reject phrase or an over-long sentence refuses the card and says why', () => {
  const dir = tmp();
  const rules = { rejectPhrases: ['Basically'], maxSentenceUnits: 5 };
  const core = boundCore({ save: () => {}, attachDir: path.join(dir, 'att'), cardRules: () => rules });
  const phrase = core.handle(note('tests pass, basically fine'));
  assert.equal(phrase.error, 'rejected_phrase');
  assert.match(phrase.message, /Basically/i);
  const inOption = core.handle(decision({ options: ['yes', 'Basically no'] }));
  assert.equal(inOption.error, 'rejected_phrase');
  // 5 Han characters and a run of letters count 6 units; sentence ends and line breaks reset the count.
  const long = core.handle(note('一二三四五 ok'));
  assert.equal(long.error, 'sentence_too_long');
  assert.match(long.message, /6.*5/);
  assert.equal(core.handle(note('一二三四五。一二 ok\nab cd')).ok, true);
});

test('550/AC-1 the daemon reads card-rules.json beside prefs.json and refuses a card that holds a reject phrase', async () => {
  const s = sandbox();
  try {
    await s.bind();
    fs.writeFileSync(path.join(s.root, 'card-rules.json'), JSON.stringify({ rejectPhrases: ['as you know'], maxSentenceUnits: 50 }));
    const refused = s.cli('send', '--to', TO, '--type', 'note', 'As you know, tests pass');
    assert.equal(refused.code, 1);
    assert.equal(refused.out.error, 'rejected_phrase');
    assert.equal(s.cli('send', '--to', TO, '--type', 'note', 'tests pass').code, 0);
  } finally { s.cleanup(); }
});

test('550/AC-2 without a card-rules file, or with an unusable one, every card is accepted', async () => {
  const s = sandbox();
  try {
    await s.bind();
    const text = 'As you know, basically all of this is fine and a long sentence that never ends and keeps going on and on and on and on';
    assert.equal(s.cli('send', '--to', TO, '--type', 'note', text).code, 0);
    for (const bad of ['{ not json', '[]', '{"rejectPhrases":"x","maxSentenceUnits":"7"}', '{"rejectPhrases":[3,""],"maxSentenceUnits":0}']) {
      fs.writeFileSync(path.join(s.root, 'card-rules.json'), bad);
      assert.equal(s.cli('send', '--to', TO, '--type', 'note', `${text} ${bad.length}`).code, 0, bad);
    }
  } finally { s.cleanup(); }
  // No file still has no phrase or length rule; only the step check has a built-in default (see the 640 test).
  const none = readCardRules(path.join(tmp(), 'missing.json'));
  assert.deepEqual(Object.keys(none), ['stepPatterns']);
});

test('566/AC-2 a card without a source is refused and says how to give one; a written source is accepted, two sources are not', () => {
  const { core } = fresh();
  const bare = core.handle(decision({ source: undefined }));
  assert.equal(bare.error, 'missing_source');
  assert.match(bare.message, /--source-uid/);
  assert.equal(core.handle({ op: 'send', to: TO, from: 'w2:p2', type: 'discussion', question: 'Which way?' }).error, 'missing_source');
  assert.equal(core.handle(decision({ source: 'the TL of Task-7', sourceUid: 'x' })).error, 'bad_source');
  const ok = core.handle(decision({ source: '  the TL of   Task-7 ' }));
  assert.equal(ok.ok, true);
  assert.deepEqual(core.state.letters[ok.uid].origin, { text: 'the TL of   Task-7' });
  // The same question with another source is another card, not a resend of the first.
  const again = core.handle(decision({ source: 'the PM' }));
  assert.equal(again.duplicate, undefined);
  assert.notEqual(again.uid, ok.uid);
});

test('566/AC-2 a card citing a letter that does not exist, is in another mailbox or kept no signature is refused; a letter of this mailbox is accepted', () => {
  const { core } = fresh();
  const signed = { workspaceId: 'w2', workspace: 'openpen', position: 'Task-9', role: 'TL' };
  const mine = core.handle(note('the user must pick', { signed }));
  const elsewhere = core.handle({ ...note('other mailbox'), to: 'w9:p9', signed });
  const unsigned = core.handle(note('from before signatures were kept'));
  assert.equal(core.handle(decision({ source: undefined, sourceUid: 'NOSUCHUID' })).error, 'unknown_uid');
  const other = core.handle(decision({ source: undefined, sourceUid: elsewhere.uid }));
  assert.equal(other.error, 'bad_source');
  assert.match(other.message, /not in this mailbox/);
  assert.match(core.handle(decision({ source: undefined, sourceUid: unsigned.uid })).message, /no signature/);
  const ok = core.handle(decision({ source: undefined, sourceUid: mine.uid }));
  assert.equal(ok.ok, true);
  assert.deepEqual(core.state.letters[ok.uid].origin, { uid: mine.uid, signed });
});

// Steps the owner must do by hand: each one carries the reason an agent cannot do it, and a step written into free text is refused.
test('640/AC-1,2 a card step needs its reason; a step-like line in free text is refused and points to --step', () => {
  const rules = { stepPatterns: ['^(open|press|log in)\\b'] };
  const core = boundCore({ save: () => {}, attachDir: path.join(tmp(), 'att'), cardRules: () => rules });
  const bare = core.handle(decision({ steps: ['Open the VM window', 'Type the Claude password'], whyNotAgent: ['the VM needs a window only you can see'] }));
  assert.equal(bare.error, 'missing_why_not_agent');
  assert.match(bare.message, /step 2/);
  assert.equal(core.handle(decision({ steps: ['Open the VM window'], whyNotAgent: ['  '] })).error, 'missing_why_not_agent');
  const ok = core.handle(decision({ steps: ['Type the Claude password'], whyNotAgent: ['only you know it'] }));
  assert.equal(ok.ok, true);
  assert.deepEqual(core.state.letters[ok.uid].content.steps, [{ do: 'Type the Claude password', why: 'only you know it' }]);
  // The same words in the step field pass the pattern check, which reads only free text.
  assert.equal(core.handle(decision({ question: 'Which VM?', steps: ['Open the VM window'], whyNotAgent: ['no display for an agent'] })).ok, true);
  const listed = core.handle(decision({ whyOpen: '1. Open the VM window' }));
  assert.equal(listed.error, 'step_in_text');
  assert.match(listed.message, /--step/);
  const bullet = core.handle({ op: 'send', to: TO, from: 'w2:p2', source: 'test', type: 'discussion', question: 'Which way?', idea: 'ok\n- Press Start' });
  assert.equal(bullet.error, 'step_in_text');
  // Prose that is not a list line passes, and a note between agents is not a card.
  assert.equal(core.handle({ op: 'send', to: TO, from: 'w2:p2', source: 'test', type: 'discussion', question: 'Open questions remain?' }).ok, true);
  assert.equal(core.handle(note('1. Open the VM window')).ok, true);
  // A new install has no file and still catches a step written as a list line, in English and Chinese; an empty list turns it off.
  const dir = tmp();
  const fresh = readCardRules(path.join(dir, 'missing.json'));
  assert.equal(checkStepText('1. Open the VM window', fresh, 'idea').error, 'step_in_text');
  assert.equal(checkStepText('- 請登入測試機', fresh, 'idea').error, 'step_in_text');
  assert.equal(checkStepText('- Opening hours are fixed', fresh, 'idea'), null);
  fs.writeFileSync(path.join(dir, 'off.json'), '{"stepPatterns": []}');
  assert.equal(checkStepText('1. Open the VM window', readCardRules(path.join(dir, 'off.json')), 'idea'), null);
});
