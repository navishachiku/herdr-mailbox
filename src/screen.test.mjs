// 202 mailbox screen. Everything goes through the daemon ops (view, bulk, prefs, answer, submit) and the fake herdr's call log.
// The view shape below (notes, questions, mailbox, paused, inputState, batches) is the reading of design.md "202 畫面".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { sessionKey } from './paths.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const FAKE = path.join(here, 'test-support', 'fake-herdr.mjs');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const RECV = 'w1:p1';
const SENDER = 'w2:p2';
const RULE = '─'.repeat(40);
const EMPTY = `${RULE}\n❯ \n${RULE}\n`;
const TYPING = `${RULE}\n❯ half a sentence\n${RULE}\n`;
const UNKNOWN = 'some other full-screen program\n';

// A throwaway herdr world: a fake herdr with a receiver pane and a sender pane, and a daemon with short timings.
function world({ timings = {} } = {}) {
  const root = fs.mkdtempSync(path.join('/tmp', 'mbs-'));
  const socket = path.join(root, 'herdr.sock');
  const dir = path.join(root, sessionKey(socket));
  const stateFile = path.join(root, 'fake-herdr.json');
  const logFile = path.join(root, 'fake-herdr.log');
  const transcript = path.join(root, 'recv.jsonl');
  fs.writeFileSync(transcript, '');
  fs.writeFileSync(logFile, '');
  const pane = (id, label, sid) => ({ pane_id: id, terminal_id: `t-${id}`, width: 200, height: 50, workspace_id: 'w1', tab_id: 'w1:t1', label, agent: 'claude', agent_status: 'idle', agent_session: { value: sid } });
  const fake = {
    panes: [pane(RECV, 'PM', 'sid-1'), pane(SENDER, 'worker', 'sid-2')],
    screens: { [RECV]: EMPTY },
    promptResult: {},
    transcripts: { [RECV]: transcript },
  };
  const writeFake = () => fs.writeFileSync(stateFile, JSON.stringify(fake));
  writeFake();
  const env = {
    ...process.env, HERDR_MAILBOX_STATE_DIR: root, HERDR_SOCKET_PATH: socket, HERDR_PANE_ID: RECV,
    HERDR_MAILBOX_SID: 'sid-1', HERDR_PLUGIN_ID: 'herdr-mailbox', LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8',
    HERDR_BIN_PATH: FAKE, FAKE_HERDR_STATE: stateFile, FAKE_HERDR_LOG: logFile,
    HERDR_MAILBOX_TIMINGS: JSON.stringify({ tickMs: 50, reconcileMs: 50, mergeMs: 600_000, retryMs: 100, confirmMs: 400, registerGraceMs: 300, ...timings }),
  };
  delete env.HERDR_PLUGIN_STATE_DIR;
  const cliAs = (caller, ...args) => {
    const r = spawnSync(process.execPath, [path.join(here, 'mailbox.mjs'), ...args], { env: { ...env, HERDR_PANE_ID: caller, HERDR_MAILBOX_SID: caller === RECV ? 'sid-1' : 'sid-2' }, encoding: 'utf8', timeout: 10000 });
    return { code: r.status, out: r.stdout.trim() ? JSON.parse(r.stdout) : null, err: r.stderr };
  };
  const cli = (...args) => cliAs(RECV, ...args);
  const raw = msg => new Promise((resolve, reject) => {
    const c = net.connect(path.join(dir, 'd.sock'));
    let buf = '';
    c.on('connect', () => c.write(`${JSON.stringify({ proto: 1, ...msg })}\n`));
    c.on('data', d => { buf += d; });
    c.setTimeout(5000, () => c.destroy(new Error('daemon response timed out')));
    c.on('end', () => { try { resolve(JSON.parse(buf)); } catch (err) { reject(err); } });
    c.on('error', reject);
  });
  // Ops from the screen come from the plugin, as the PO.
  let mailbox;
  const op = async (name, req = {}) => {
    // Screen writes carry the generation shown by the latest view.
    if (['answer', 'submit', 'bulk', 'deliver-now', 'resolve-batch'].includes(name) && req.generation === undefined) {
      const view = await raw({ op: 'view', mailbox: req.mailbox ?? mailbox, caller: { pane: RECV, viaPlugin: true } });
      req = { ...req, generation: view.mailbox.generation };
    }
    const result = await raw({ op: name, caller: { pane: RECV, viaPlugin: true }, ...req });
    if (name === 'bind' && result.ok) mailbox = mbOf(result);
    return result;
  };
  const log = () => fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
  const calls = needle => log().filter(e => JSON.stringify(e).includes(needle));
  const prompts = () => log().filter(e => /agent/.test(JSON.stringify(e)) && /prompt/.test(JSON.stringify(e)));
  const setFake = fn => { fn(fake); writeFake(); };
  const stop = () => { try { process.kill(Number(fs.readFileSync(path.join(dir, 'daemon.pid'), 'utf8')), 'SIGKILL'); } catch { /* not running */ } };
  const cleanup = () => { stop(); fs.rmSync(root, { recursive: true, force: true }); };
  return { root, dir, env, cli, cliAs, raw, op, log, calls, prompts, setFake, stop, cleanup, transcript };
}

const mbOf = r => r.mailbox?.id ?? r.mailbox ?? r.id;

async function ready(w) {
  const started = w.cli('status');
  assert.equal(started.code, 0, `daemon startup failed: ${JSON.stringify(started.out)} ${started.err}`);
  const registered = await w.op('register', { pane: RECV, sid: 'sid-1', source: 'startup', transcript: w.transcript });
  assert.equal(registered.ok, true, `register failed: ${JSON.stringify(registered)}`);
  const b = await w.op('bind', { pane: RECV });
  assert.equal(b.ok, true, `bind failed: ${JSON.stringify(b)}`);
  return mbOf(b);
}
const send = (w, o) => w.raw({ op: 'send', to: RECV, from: SENDER, ...o });
const decision = (w, o = {}) => send(w, { type: 'decision', question: 'Install it?', options: ['yes', 'no', 'later'], recommend: 'A', ...o });
const discussion = (w, o = {}) => send(w, { type: 'discussion', question: 'Split the readme?', idea: 'one file', ...o });
const note = (w, text) => send(w, { type: 'note', text });
const find = (v, uid) => v.questions.find(q => q.uid === uid);
async function until(fn, ms = 3000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) return v;
    await sleep(50);
  }
}

async function screen(w, mailbox) {
  const model = await w.op('view', { mailbox });
  const { render } = await import('./screen/render.mjs');
  return { model, ...render(model, { cols: 80, rows: 100, cardMode: 'detailed' }) };
}

function hit(ui, type, predicate = () => true) {
  const found = ui.hits.find(h => h.action?.type === type && predicate(h.action));
  assert.ok(found, `missing ${type} hit`);
  return found.action;
}

async function click(w, ui, action, requests = []) {
  const { perform } = await import('./screen/actions.mjs');
  return perform(action, {
    call: req => {
      requests.push(req);
      return w.raw({ ...req, caller: { pane: RECV, viaPlugin: true } });
    },
    run: async args => {
      const r = spawnSync(process.execPath, [FAKE, ...args], { env: w.env, encoding: 'utf8' });
      assert.equal(r.status, 0, r.stderr);
      return r.stdout;
    },
    selfPane: 'w1:p3', ownerPane: RECV, generation: ui.model.mailbox.generation,
  });
}

function answerLine(ui, uid) {
  const question = find(ui.model, uid);
  const start = ui.lines.findIndex(line => line.includes(question.content.question));
  assert.ok(start >= 0, 'the question card is visible');
  const next = ui.lines.findIndex((line, i) => i > start && ui.model.questions.some(q => q.uid !== uid && line.includes(q.content.question)));
  const line = ui.lines.slice(start, next < 0 ? undefined : next).find(line => /\bAnswer\s*:/i.test(line));
  assert.ok(line, 'the question has its own answer field');
  return line;
}

function assertScreenOpen(w, owner, width) {
  const calls = w.log().map(entry => entry.argv);
  const layout = calls.findIndex(args => args[0] === 'pane' && args[1] === 'layout' && args.includes(owner));
  const split = calls.findIndex((args, i) => i > layout && args[0] === 'pane' && args[1] === 'split' && args[2] === owner);
  assert.ok(layout >= 0 && split > layout, 'layout is read before splitting the receiver');
  const args = calls[split];
  assert.equal(args[args.indexOf('--direction') + 1], 'right');
  assert.ok(args.includes('--no-focus'));
  assert.ok(args.includes('--ratio'));
  const ratio = Number(args[args.indexOf('--ratio') + 1]);
  assert.ok(ratio > 0 && ratio < 1);
  assert.equal(Math.round(200 * (1 - ratio)), width);
  assert.ok(args.includes(`HERDR_MAILBOX_TARGET=${owner}`));
  assert.ok(args.some(arg => arg.startsWith('HERDR_MAILBOX_ID=MB-')));
  const run = calls.find((argv, i) => i > split && argv[0] === 'pane' && argv[1] === 'run');
  assert.ok(run, 'the newly split screen is started');
  assert.notEqual(run[2], owner);
  assert.match(run.slice(3).join(' '), /node .*src\/screen\/main\.mjs/);
  assert.equal(calls.slice(layout).some(argv => argv[0] === 'pane' && argv[1] === 'focus'), false);
  assert.equal(calls.slice(layout).some(argv => argv.includes('--focus')), false);
}

test('202/AC-1 the open action splits a 48-column pane to the right of the receiver without taking focus', async () => {
  const w = world();
  try {
    await ready(w);
    const r = w.cli('open');
    assert.equal(r.code, 0, r.err);
    assertScreenOpen(w, RECV, 48);
  } finally { w.cleanup(); }
});

test('202/AC-4 clicking an option, Recommend or Explain fills the answer slot with the letter, P or E', async () => {
  const w = world();
  try {
    const mb = await ready(w);
    const q = await decision(w);
    for (const [type, choice] of [['choose', 'A'], ['recommend', 'P'], ['explain', 'E']]) {
      const before = await screen(w, mb);
      const action = hit(before, type, a => a.uid === q.uid && (type !== 'choose' || a.choice === choice));
      await click(w, before, action);
      const after = await screen(w, mb);
      assert.equal(find(after.model, q.uid).draft.choice, choice);
      assert.match(answerLine(after, q.uid), new RegExp(`\\bAnswer\\s*:\\s*${choice}\\b`, 'i'));
    }
  } finally { w.cleanup(); }
});

test('202/AC-4 filling only the note shows N: a draft with text and no letter counts as answered', async () => {
  const w = world();
  try {
    const mb = await ready(w);
    const q = await discussion(w);
    const before = await screen(w, mb);
    const action = hit(before, 'note-text', a => a.uid === q.uid);
    await click(w, before, { ...action, text: 'only a note' });
    const after = await screen(w, mb);
    assert.equal(find(after.model, q.uid).draft.text, 'only a note');
    assert.match(answerLine(after, q.uid), /\bAnswer\s*:\s*N\b/i);
  } finally { w.cleanup(); }
});

test('202/AC-5 while the receiver input box has text the view reports it, and the rendered Submit button is disabled', async () => {
  const w = world();
  try {
    const mb = await ready(w);
    const q = await decision(w);
    await w.op('answer', { uid: q.uid, version: q.version, choice: 'A' });
    w.setFake(f => { f.screens[RECV] = TYPING; });
    const typing = await until(async () => { const v = await w.op('view', { mailbox: mb }); return v.inputState === 'typing' && v; });
    assert.equal(typing.inputState, 'typing');
    const { render } = await import('./screen/render.mjs');
    const disabled = render(typing, { cols: 48, rows: 40, cardMode: 'detailed' });
    const text = disabled.lines.join('\n');
    assert.equal(disabled.hits.some(hit => hit.action?.type === 'submit'), false);
    assert.match(text, /Confirm|確認送出/);
    assert.match(text, /disabled|停用/);
    w.setFake(f => { f.screens[RECV] = EMPTY; });
    const empty = await until(async () => { const v = await w.op('view', { mailbox: mb }); return v.inputState === 'empty' && v; });
    const enabled = render(empty, { cols: 48, rows: 40, cardMode: 'detailed' });
    assert.equal(enabled.hits.some(hit => hit.action?.type === 'submit'), true);
    assert.doesNotMatch(enabled.lines.join('\n'), /disabled|停用/);
  } finally { w.cleanup(); }
});

test('202/AC-6 Confirm sends only the answered questions', async () => {
  const w = world();
  try {
    const mb = await ready(w);
    const a = await decision(w, { question: 'Answered one?' });
    const b = await decision(w, { question: 'Left alone?' });
    await w.op('answer', { uid: a.uid, version: a.version, choice: 'B' });
    const view = await w.op('view', { mailbox: mb });
    const r = await w.op('submit', { mailbox: mb, generation: view.mailbox.generation, items: view.questions.map(q => ({ uid: q.uid, version: q.version })) });
    assert.equal(r.results.find(x => x.uid === a.uid).ok, true);
    assert.equal(r.results.find(x => x.uid === b.uid).ok, false);
    const after = await w.op('view', { mailbox: mb });
    assert.deepEqual([find(after, a.uid)?.status, find(after, b.uid).status], ['submitted', 'pending']);
    const sent = await until(() => w.prompts().length >= 1 && w.prompts());
    assert.match(JSON.stringify(sent[0]), /Answered one\?/);
    assert.doesNotMatch(JSON.stringify(sent[0]), /Left alone\?/);
  } finally { w.cleanup(); }
});

test('202/AC-6 pressing Confirm twice sends the answers once', async () => {
  const w = world();
  try {
    const mb = await ready(w);
    const q = await decision(w);
    await w.op('answer', { uid: q.uid, version: q.version, choice: 'A' });
    const g = (await w.op('view', { mailbox: mb })).mailbox.generation;
    const req = { mailbox: mb, generation: g, items: [{ uid: q.uid, version: q.version }] };
    const [one, two] = await Promise.all([w.op('submit', req), w.op('submit', req)]);
    assert.deepEqual([one, two].map(r => r.results[0].ok).sort(), [false, true]);
    await until(() => w.prompts().length >= 1);
    await sleep(600);
    assert.equal(w.prompts().length, 1);
  } finally { w.cleanup(); }
});

test('202/AC-7 Recommend-all applies to unanswered decision questions among the uids it is given', async () => {
  const w = world();
  try {
    const mb = await ready(w);
    const answered = await decision(w, { question: 'Already answered?', recommend: 'A' });
    const open = await decision(w, { question: 'Still open?', recommend: 'C' });
    const talk = await discussion(w);
    await w.op('answer', { uid: answered.uid, version: answered.version, choice: 'B' });
    const late = await decision(w, { question: 'Arrived after the screen snapshot?' });
    const r = await w.op('bulk', { mailbox: mb, action: 'recommend', uids: [answered.uid, open.uid, talk.uid] });
    assert.equal(r.ok, true);
    const v = await w.op('view', { mailbox: mb });
    assert.equal(find(v, answered.uid).draft.choice, 'B');
    assert.equal(find(v, open.uid).draft.choice, 'P');
    assert.equal(find(v, talk.uid).draft, null);
    assert.equal(find(v, late.uid).draft, null);
  } finally { w.cleanup(); }
});

test('202/AC-7 Recommend-all with nothing unanswered changes nothing', async () => {
  const w = world();
  try {
    const mb = await ready(w);
    const q = await decision(w);
    await w.op('answer', { uid: q.uid, version: q.version, choice: 'C', text: 'my words' });
    await w.op('bulk', { mailbox: mb, action: 'recommend', uids: [q.uid] });
    assert.deepEqual(find(await w.op('view', { mailbox: mb }), q.uid).draft, { choice: 'C', text: 'my words' });
  } finally { w.cleanup(); }
});

test('202/AC-7 a bulk supplement reaches only the snapshot targets and preserves individual notes', async () => {
  const w = world();
  try {
    const mb = await ready(w);
    const open = await decision(w, { question: 'Apply the shared note?' });
    const individual = await decision(w, { question: 'Keep the individual note?' });
    const answered = await decision(w, { question: 'Keep the existing answer?' });
    const talk = await discussion(w);
    await w.op('answer', { uid: individual.uid, version: individual.version, text: 'individual note' });
    await w.op('answer', { uid: answered.uid, version: answered.version, choice: 'B', text: 'existing answer note' });
    const ui = await screen(w, mb);
    const action = hit(ui, 'bulk-recommend');
    assert.deepEqual(action.uids, [open.uid]);
    const late = await decision(w, { question: 'Arrived after the supplement targets were shown?' });
    const result = await click(w, ui, { ...action, text: 'shared supplement' });
    assert.equal(result.ok, true);
    const after = await w.op('view', { mailbox: mb });
    assert.deepEqual(find(after, open.uid).draft, { choice: 'P', text: 'shared supplement' });
    assert.deepEqual(find(after, individual.uid).draft, { choice: null, text: 'individual note' });
    assert.deepEqual(find(after, answered.uid).draft, { choice: 'B', text: 'existing answer note' });
    assert.equal(find(after, talk.uid).draft, null);
    assert.equal(find(after, late.uid).draft, null);
  } finally { w.cleanup(); }
});

test('202/AC-8 an answer to a question the sender has since edited is refused and the view shows the new text', async () => {
  const w = world();
  try {
    const mb = await ready(w);
    const q = await decision(w, { question: 'Old wording?' });
    const oldScreen = await screen(w, mb);
    const oldAction = hit(oldScreen, 'choose', a => a.uid === q.uid && a.choice === 'A');
    const edited = await w.raw({ op: 'edit', uid: q.uid, from: SENDER, question: 'New wording?' });
    assert.equal(edited.ok, true);
    const calls = [];
    await click(w, oldScreen, oldAction, calls);
    const write = calls.findIndex(req => req.op === 'answer');
    assert.ok(write >= 0);
    assert.equal(calls[write].version, q.version);
    assert.ok(calls.slice(write + 1).some(req => req.op === 'view' && req.mailbox === mb), 'stale answer reloads the view');
    const now = find(await w.op('view', { mailbox: mb }), q.uid);
    assert.equal(now.content.question, 'New wording?');
    assert.equal(now.draft, null);
  } finally { w.cleanup(); }
});

test('202/AC-8 Confirm with the old version is refused for that question and nothing is sent for it', async () => {
  const w = world();
  try {
    const mb = await ready(w);
    const q = await decision(w);
    await w.op('answer', { uid: q.uid, version: q.version, choice: 'A' });
    const ui = await screen(w, mb);
    const action = hit(ui, 'submit');
    const refused = await w.op('submit', { mailbox: mb, generation: ui.model.mailbox.generation, items: [{ uid: q.uid, version: q.version + 1 }] });
    assert.equal(refused.results[0].ok, false);
    assert.equal(refused.results[0].error, 'stale_version');
    const requests = [];
    const { perform } = await import('./screen/actions.mjs');
    for (const error of ['stale_version', 'stale_owner']) {
      requests.length = 0;
      await perform(action, {
        call: async req => {
          requests.push(req);
          if (req.op === 'view') return ui.model;
          return error === 'stale_version'
            ? { ok: true, results: [{ uid: q.uid, ok: false, error }] }
            : { ok: false, error };
        },
        run: async () => ({ ok: true }),
        selfPane: 'w1:p3', ownerPane: RECV, generation: ui.model.mailbox.generation,
      });
      assert.equal(requests[0].op, 'submit');
      assert.ok(requests.slice(1).some(req => req.op === 'view' && req.mailbox === mb), `${error} reloads the view`);
    }
    await sleep(300);
    assert.equal(w.prompts().length, 0);
  } finally { w.cleanup(); }
});

test('202/AC-9 closing the screen keeps the unanswered questions and the answer drafts for the next open', async () => {
  const w = world();
  try {
    const mb = await ready(w);
    const a = await decision(w);
    const b = await discussion(w);
    await w.op('answer', { uid: a.uid, version: a.version, choice: 'B', text: 'because' });
    const closed = w.cli('close');
    assert.equal(closed.code, 0, closed.err);
    assert.equal(w.cli('open').code, 0);
    const v = await w.op('view', { mailbox: mb });
    assert.deepEqual(find(v, a.uid).draft, { choice: 'B', text: 'because' });
    assert.equal(find(v, b.uid).status, 'pending');
  } finally { w.cleanup(); }
});

test('202/AC-10 saved width and card mode apply to every later open, including from another pane', async () => {
  const w = world();
  try {
    await ready(w);
    const set = await w.op('prefs-set', { width: 32, cardMode: 'compact' });
    assert.equal(set.ok, true);
    assert.deepEqual([(await w.op('prefs-get')).width, (await w.op('prefs-get')).cardMode], [32, 'compact']);
    assert.equal(w.cli('open').code, 0);
    assert.equal(w.cli('close').code, 0);
    assert.equal((await w.op('register', { pane: SENDER, sid: 'sid-2', source: 'startup' })).ok, true);
    assert.equal((await w.op('bind', { pane: SENDER })).ok, true);
    const other = w.cliAs(SENDER, 'open');
    assert.equal(other.code, 0, other.err);
    const saved = await w.op('prefs-get');
    assert.equal(saved.cardMode, 'compact');
    assertScreenOpen(w, SENDER, 32);
  } finally { w.cleanup(); }
});

test('202/AC-10 a width outside 24 to 80 is refused and the saved value stays', async () => {
  const w = world();
  try {
    await ready(w);
    const bad = await w.op('prefs-set', { width: 100 });
    assert.equal(bad.ok, false);
    assert.equal((await w.op('prefs-get')).width, 48);
  } finally { w.cleanup(); }
});

test('202/AC-11 a question with an attachment exposes the full attachment text for the popup', async () => {
  const w = world();
  try {
    const mb = await ready(w);
    const file = path.join(w.root, 'plan.md');
    const full = `${'long attachment line\n'.repeat(400)}THE END\n`;
    fs.writeFileSync(file, full);
    const q = await decision(w, { attach: file });
    const att = find(await w.op('view', { mailbox: mb }), q.uid).content.attach;
    assert.equal(att.name, 'plan.md');
    assert.equal(fs.readFileSync(att.path, 'utf8'), full);
    const { perform } = await import('./screen/actions.mjs');
    const view = await w.op('view', { mailbox: mb });
    await perform({ type: 'attachment', uid: q.uid }, {
      call: req => w.op(req.op, req),
      run: async args => {
        const result = spawnSync(process.execPath, [FAKE, ...args], { env: w.env, encoding: 'utf8' });
        assert.equal(result.status, 0, result.stderr);
        return result.stdout;
      },
      selfPane: 'w1:p3', ownerPane: RECV, generation: view.mailbox.generation,
    });
    const opened = w.log().filter(entry => entry.argv.slice(0, 3).join(' ') === 'plugin pane open');
    assert.equal(opened.length, 1);
    assert.deepEqual(opened[0].argv, [
      'plugin', 'pane', 'open', '--plugin', 'herdr-mailbox', '--entrypoint', 'attachment',
      '--placement', 'popup', '--env', `HERDR_MAILBOX_UID=${q.uid}`,
    ]);
  } finally { w.cleanup(); }
});

test('202/AC-12 when the receiver pane is gone the mailbox keeps its content and shows the disconnected state with the claim hint', async () => {
  const w = world();
  try {
    const mb = await ready(w);
    const q = await decision(w);
    await note(w, 'keep me');
    w.setFake(f => { f.panes = f.panes.filter(p => p.pane_id !== RECV); });
    const v = await until(async () => { const x = await w.op('view', { mailbox: mb }); return x.mailbox.state === 'disconnected' && x; });
    assert.equal(v.mailbox.state, 'disconnected');
    assert.match(v.mailbox.claim, /mailbox claim MB-/);
    assert.ok(find(v, q.uid));
    assert.equal(v.notes.length, 1);
    const ui = await screen(w, mb);
    assert.match(ui.lines.join('\n'), /disconnected/i);
    assert.ok(ui.lines.some(line => line.includes(v.mailbox.claim)));
  } finally { w.cleanup(); }
});

test('202/AC-13 after herdr restarts, the focus event reopens the screen with the same content', async () => {
  const w = world();
  try {
    const mb = await ready(w);
    const q = await decision(w);
    await w.op('answer', { uid: q.uid, version: q.version, choice: 'B' });
    assert.equal(w.cli('open').code, 0);
    const before = await w.op('view', { mailbox: mb });
    w.stop();
    // Restart: new terminal ids, same pane ids and conversations; the plugin pane from before is gone.
    w.setFake(f => { f.panes = f.panes.filter(p => [RECV, SENDER].includes(p.pane_id)); f.panes.forEach(p => { p.terminal_id = `${p.terminal_id}-restarted`; }); });
    fs.writeFileSync(w.root + '/fake-herdr.log', '');
    const ev = spawnSync(process.execPath, [path.join(here, 'on-focus.mjs')], {
      env: { ...w.env, HERDR_PANE_ID: RECV, HERDR_PLUGIN_EVENT_JSON: JSON.stringify({ event: 'pane.focused', data: { pane_id: RECV } }) }, encoding: 'utf8',
    });
    assert.equal(ev.status, 0, ev.stderr);
    assertScreenOpen(w, RECV, 48);
    const after = await w.op('view', { mailbox: mb });
    assert.deepEqual(after.questions, before.questions);
    assert.deepEqual(after.notes, before.notes);
  } finally { w.cleanup(); }
});

test('202/AC-13 after herdr restarts, focus closes the stale shell with the same pane id before reopening the screen', async () => {
  const w = world();
  try {
    await ready(w);
    assert.equal(w.cli('open').code, 0);
    const panes = JSON.parse(fs.readFileSync(w.env.FAKE_HERDR_STATE, 'utf8')).panes;
    const stale = panes.find(p => ![RECV, SENDER].includes(p.pane_id));
    assert.ok(stale, 'the first open created a screen pane');
    w.stop();
    // Herdr restores the screen as an empty shell at the same pane id with a new terminal id.
    w.setFake(f => {
      f.panes = panes.map(p => ({ ...p, terminal_id: `${p.terminal_id}-restarted` }));
    });
    fs.writeFileSync(w.env.FAKE_HERDR_LOG, '');
    const ev = spawnSync(process.execPath, [path.join(here, 'on-focus.mjs')], {
      env: { ...w.env, HERDR_PANE_ID: RECV, HERDR_PLUGIN_EVENT_JSON: JSON.stringify({ event: 'pane.focused', data: { pane_id: RECV } }) }, encoding: 'utf8',
    });
    assert.equal(ev.status, 0, ev.stderr);
    const calls = w.log().map(entry => entry.argv);
    const closed = calls.findIndex(args => args[0] === 'pane' && args[1] === 'close' && args.includes(stale.pane_id));
    const split = calls.findIndex(args => args[0] === 'pane' && args[1] === 'split' && args[2] === RECV);
    assert.ok(closed >= 0, 'the stale screen shell is closed');
    assert.ok(split > closed, 'the stale shell is closed before splitting the receiver');
    assertScreenOpen(w, RECV, 48);
  } finally { w.cleanup(); }
});

test('202/AC-14 Deliver now skips the merge wait but still waits for an empty input box', async () => {
  const w = world();
  try {
    const mb = await ready(w);
    await note(w, 'first');
    await note(w, 'second');
    await sleep(300);
    assert.equal(w.prompts().length, 0);
    const ui = await screen(w, mb);
    await click(w, ui, hit(ui, 'deliver-now'));
    const sent = await until(() => w.prompts().length === 1 && w.prompts());
    assert.match(JSON.stringify(sent[0]), /first/);
    assert.match(JSON.stringify(sent[0]), /second/);
  } finally { w.cleanup(); }
});

test('202/AC-14 Deliver now with text in the input box sends nothing until it is empty', async () => {
  const w = world();
  try {
    const mb = await ready(w);
    await note(w, 'wait for me');
    w.setFake(f => { f.screens[RECV] = TYPING; });
    await w.op('deliver-now', { mailbox: mb, generation: (await w.op('view', { mailbox: mb })).mailbox.generation });
    await sleep(500);
    assert.equal(w.prompts().length, 0);
    w.setFake(f => { f.screens[RECV] = EMPTY; });
    assert.ok(await until(() => w.prompts().length === 1));
  } finally { w.cleanup(); }
});

test('202/AC-15 the view names why plain messages are paused: typing, or an input box that cannot be read', async () => {
  const w = world();
  try {
    const mb = await ready(w);
    await note(w, 'held back');
    w.setFake(f => { f.screens[RECV] = TYPING; });
    await w.op('deliver-now', { mailbox: mb, generation: (await w.op('view', { mailbox: mb })).mailbox.generation });
    const typing = await until(async () => { const v = await w.op('view', { mailbox: mb }); return v.paused?.reason === 'typing' && v; });
    assert.equal(typing.paused.reason, 'typing');
    assert.match((await screen(w, mb)).lines.join('\n'), /typing/i);
    w.setFake(f => { f.screens[RECV] = UNKNOWN; });
    const unknown = await until(async () => { const v = await w.op('view', { mailbox: mb }); return v.paused?.reason === 'unknown' && v; });
    assert.equal(unknown.paused.reason, 'unknown');
    assert.match((await screen(w, mb)).lines.join('\n'), /unknown|cannot read|unreadable/i);
  } finally { w.cleanup(); }
});

function assertUnconfirmed(ui, batchId) {
  const text = ui.lines.join('\n');
  assert.ok(text.includes(batchId));
  assert.match(text, /unconfirmed/i);
  const delivered = ui.hits.find(h => h.action?.type === 'resolve-batch' && h.action.batch === batchId && h.action.action === 'delivered');
  const resend = ui.hits.find(h => h.action?.type === 'resolve-batch' && h.action.batch === batchId && h.action.action === 'resend');
  assert.ok(delivered && resend, 'both resolution buttons are available');
  assert.match(ui.lines[delivered.row], /mark.*delivered/i);
  assert.match(ui.lines[resend.row], /resend/i);
  assert.match(ui.lines[resend.row], /duplicate/i);
}

// A batch whose landing was never seen: the fake accepts the prompt but writes nothing to the transcript.
async function unconfirmed(w, mb) {
  w.setFake(f => { f.promptResult[RECV] = 'lost'; });
  await note(w, 'did this land?');
  await w.op('deliver-now', { mailbox: mb, generation: (await w.op('view', { mailbox: mb })).mailbox.generation });
  const v = await until(async () => { const x = await w.op('view', { mailbox: mb }); return x.batches.some(b => b.status === 'unconfirmed') && x; });
  return v.batches.find(b => b.status === 'unconfirmed');
}

test('202/AC-16 an unconfirmed batch is listed and "mark delivered" closes it without sending again', async () => {
  const w = world();
  try {
    const mb = await ready(w);
    const batch = await unconfirmed(w, mb);
    assert.ok(batch, 'the unconfirmed batch is shown');
    const before = w.prompts().length;
    const ui = await screen(w, mb);
    assertUnconfirmed(ui, batch.id);
    await click(w, ui, hit(ui, 'resolve-batch', a => a.batch === batch.id && a.action === 'delivered'));
    await sleep(400);
    assert.equal(w.prompts().length, before);
    assert.equal((await w.op('view', { mailbox: mb })).batches.some(b => b.status === 'unconfirmed'), false);
  } finally { w.cleanup(); }
});

test('202/AC-16 an unconfirmed batch is never resent on its own, only when "resend" is chosen', async () => {
  const w = world();
  try {
    const mb = await ready(w);
    const batch = await unconfirmed(w, mb);
    const before = w.prompts().length;
    await sleep(600);
    assert.equal(w.prompts().length, before);
    w.setFake(f => { f.promptResult[RECV] = 'ok'; });
    const ui = await screen(w, mb);
    assertUnconfirmed(ui, batch.id);
    await click(w, ui, hit(ui, 'resolve-batch', a => a.batch === batch.id && a.action === 'resend'));
    assert.ok(await until(() => w.prompts().length === before + 1));
  } finally { w.cleanup(); }
});

test('202/AC-17 typing in the screen text box does not move focus; a button press hands focus back to the receiver', async () => {
  const { perform } = await import('./screen/actions.mjs');
  const calls = [];
  const env = {
    call: async () => ({ ok: true }),
    run: async args => { calls.push(args); return { ok: true }; },
    selfPane: 'w1:p3', ownerPane: RECV, generation: 1,
  };
  await perform({ type: 'text-input', text: 'typing a long reply' }, env);
  assert.deepEqual(calls, [], 'typing keeps focus in the screen');
  await perform({ type: 'submit', mailbox: 'MB-test', items: [] }, env);
  assert.deepEqual(calls, [['pane', 'focus', '--pane', env.selfPane, '--direction', 'left']]);
});

test('202/AC-2 AC-3 AC-18 smoke: both card modes render a full view without throwing', async () => {
  const w = world();
  try {
    const mb = await ready(w);
    await note(w, 'a note');
    await decision(w);
    await discussion(w);
    const v = await w.op('view', { mailbox: mb });
    const { render } = await import('./screen/render.mjs');
    for (const cardMode of ['detailed', 'compact']) {
      const result = render(v, { cols: 48, rows: 40, cardMode });
      assert.ok(Array.isArray(result.lines));
      assert.ok(result.lines.every(line => typeof line === 'string'));
      assert.ok(result.lines.join('\n').length > 0);
      assert.ok(Array.isArray(result.hits));
    }
  } finally { w.cleanup(); }
});
