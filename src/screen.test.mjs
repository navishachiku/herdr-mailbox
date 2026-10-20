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

test('202/AC-3 clicking an option, Recommend or Explain fills the answer slot with the letter, P or E', async () => {
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

test('202/AC-3 filling only the note shows N: a draft with text and no letter counts as answered', async () => {
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

test('202/AC-4 while the receiver input box has text the view reports it, and the rendered Submit button is disabled', async () => {
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

test('202/AC-5 Confirm sends only the answered questions', async () => {
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

test('202/AC-5 pressing Confirm twice sends the answers once', async () => {
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

test('202/AC-6 Recommend-all applies to unanswered decision questions among the uids it is given', async () => {
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

test('202/AC-6 Recommend-all with nothing unanswered changes nothing', async () => {
  const w = world();
  try {
    const mb = await ready(w);
    const q = await decision(w);
    await w.op('answer', { uid: q.uid, version: q.version, choice: 'C', text: 'my words' });
    await w.op('bulk', { mailbox: mb, action: 'recommend', uids: [q.uid] });
    assert.deepEqual(find(await w.op('view', { mailbox: mb }), q.uid).draft, { choice: 'C', text: 'my words' });
  } finally { w.cleanup(); }
});

test('202/AC-6 a bulk supplement reaches only the snapshot targets and preserves individual notes', async () => {
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

test('202/AC-7 an answer to a question the sender has since edited is refused and the view shows the new text', async () => {
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

test('202/AC-7 Confirm with the old version is refused for that question and nothing is sent for it', async () => {
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

test('202/AC-8 closing the screen keeps the unanswered questions and the answer drafts for the next open', async () => {
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

test('202/AC-9 saved width and card mode apply to every later open, including from another pane', async () => {
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

test('202/AC-9 a width outside 24 to 80 is refused and the saved value stays', async () => {
  const w = world();
  try {
    await ready(w);
    const bad = await w.op('prefs-set', { width: 100 });
    assert.equal(bad.ok, false);
    assert.equal((await w.op('prefs-get')).width, 48);
  } finally { w.cleanup(); }
});

// Overlay state belongs to the screen: actions return it, render draws it, and input is routed back to it.
async function overlayScreen(model, options, call) {
  const { render } = await import('./screen/render.mjs');
  const { perform } = await import('./screen/actions.mjs');
  let overlay = null;
  const commands = [];
  const requests = [];
  const act = async action => {
    const result = await perform(action, {
      call: async req => { requests.push(req); return call(req); },
      run: async args => { commands.push(args); return JSON.stringify({ result: { ok: true } }); },
      model, overlay, scroll: options.scroll, drafts: options.drafts,
      generation: model.mailbox.generation,
    });
    if (Object.hasOwn(result, 'overlay')) overlay = result.overlay;
    return result;
  };
  return {
    act, commands, requests,
    frame: () => render(model, { ...options, overlay }),
    overlay: () => overlay,
    input: event => act({ type: 'overlay-input', event }),
  };
}

test('202/AC-38 attachments open and scroll inside the mailbox pane without a popup and close back to the unchanged mailbox', async () => {
  const { parseInput } = await import('./screen/input.mjs');
  const model = interactionModel();
  model.notes = [];
  model.batches = [];
  const full = `${Array.from({ length: 45 }, (_, i) => `attachment-row-${String(i).padStart(3, '0')}`).join('\n')}\nTHE END\n`;
  const drafts = { Q1: 'Unsaved reply' };
  const savedDrafts = structuredClone(drafts);
  const options = { cols: 80, rows: 32, locale: 'en', now: 0, scroll: 3, drafts };
  const ui = await overlayScreen(model, options, async req => {
    assert.equal(req.op, 'attachment');
    assert.equal(req.uid, 'Q1');
    return { ok: true, name: 'plan.md', text: full, truncated: false };
  });
  const before = ui.frame();
  const result = await ui.act(hit(before, 'attachment', a => a.uid === 'Q1'));
  assert.equal(result.ok, true);
  assert.equal(ui.commands.some(args => args.includes('popup')), false, 'attachment opening never asks herdr for a popup');
  assert.equal(ui.overlay()?.kind, 'attachment');
  assert.equal(ui.overlay().text, full, 'the in-pane reader keeps the complete attachment');
  const opened = ui.frame();
  assert.ok(opened.lines.some(line => line.includes('plan.md')));
  assert.ok(opened.lines.some(line => line.includes('attachment-row-000')));
  assert.equal(opened.lines.some(line => line.includes('THE END')), false, 'the attachment is longer than its viewport');
  assert.equal(opened.hits.some(h => ['choose', 'submit', 'void', 'note-text'].includes(h.action.type)), false, 'attachment input cannot reach the background card');
  const [down] = parseInput('\x1b[B');
  assert.equal((await ui.input(down)).ok, true);
  const afterKey = ui.frame();
  assert.notDeepEqual(afterKey.lines, opened.lines, 'the down arrow scrolls the attachment');
  const [wheel] = parseInput('\x1b[<65;10;10M');
  assert.equal(wheel.kind, 'wheel');
  assert.equal((await ui.input(wheel)).ok, true);
  assert.notDeepEqual(ui.frame().lines, afterKey.lines, 'the wheel scrolls the attachment too');
  for (let i = 0; i < 50 && !ui.frame().lines.some(line => line.includes('THE END')); i++) await ui.input(wheel);
  assert.ok(ui.frame().lines.some(line => line.includes('THE END')), 'the reader can scroll all the way to the full text ending');
  assert.equal((await ui.act(hit(ui.frame(), 'overlay-close'))).ok, true);
  assert.equal(ui.overlay(), null);
  const restored = ui.frame();
  assert.equal(restored.scroll, before.scroll);
  assert.deepEqual(restored.lines, before.lines);
  assert.deepEqual(restored.hits, before.hits);
  assert.deepEqual(drafts, savedDrafts, 'closing preserves the unsaved reply');
  assert.equal(ui.requests.some(req => ['answer', 'submit'].includes(req.op)), false);
});

test('202/AC-38 a two-line attachment wrapping to one hundred rows scrolls to its final row with PageDown or the wheel', async () => {
  const { render } = await import('./screen/render.mjs');
  const { perform } = await import('./screen/actions.mjs');
  const { parseInput } = await import('./screen/input.mjs');
  const model = interactionModel();
  model.notes = [];
  model.batches = [];
  model.questions = [model.questions[0]];
  // At 50 columns the reader fits 48 text columns: 50 wrapped rows from each of two raw lines.
  const ending = 'LAST WRAPPED ROW';
  const full = `${'a'.repeat(48 * 50)}\n${'b'.repeat(48 * 49)}${ending}`;
  assert.equal(full.split('\n').length, 2);
  const options = { cols: 50, rows: 30, locale: 'en', now: 0 };
  const action = hit(render(model, options), 'attachment');
  for (const input of ['\x1b[6~', '\x1b[<65;10;10M']) {
    const [event] = parseInput(input);
    assert.ok(event.kind === 'wheel' || (event.kind === 'key' && event.name === 'pagedown'));
    const env = {
      call: async req => {
        assert.equal(req.op, 'attachment');
        return { ok: true, name: 'wrapped.md', text: full, truncated: false };
      },
      run: async () => assert.fail('the attachment reader must stay inside the mailbox pane'),
      generation: model.mailbox.generation,
    };
    const opened = await perform(action, env);
    assert.equal(opened.ok, true);
    let overlay = opened.overlay;
    assert.equal(overlay.kind, 'attachment');
    let frame = render(model, { ...options, overlay });
    assert.equal(frame.lines.some(line => line.includes(ending)), false, 'the final wrapped row starts offscreen');
    assert.ok(frame.lines.some(line => /\b\d+\/100\b/.test(line)), 'the reader counts the wrapped rows, not just two raw lines');
    for (let i = 0; i < 50 && !frame.lines.some(line => line.includes(ending)); i++) {
      const next = await perform({ type: 'overlay-input', event }, { ...env, overlay });
      assert.equal(next.ok, true);
      overlay = next.overlay;
      frame = render(model, { ...options, overlay });
      // Mirror main's public render result: subsequent input starts at the clamped visible top.
      overlay = { ...overlay, top: frame.overlayTop };
    }
    assert.ok(frame.lines.some(line => line.includes(ending)), `${event.name ?? event.kind} reaches the final row of the wrapped attachment`);
    assert.ok(frame.lines.some(line => /\b100\/100\b/.test(line)), 'all one hundred display rows can be reached');
  }
});

test('202/AC-10 when the receiver pane is gone the mailbox keeps its content and shows the disconnected state with the claim hint', async () => {
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

test('202/AC-11 after herdr restarts, the focus event reopens the screen with the same content', async () => {
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

test('202/AC-11 after herdr restarts, focus closes the stale shell with the same pane id before reopening the screen', async () => {
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

test('202/AC-11 focus backfills a legacy screen terminal without reopening, then replaces the stale shell when that terminal changes', async () => {
  const w = world();
  try {
    const mb = await ready(w);
    assert.equal(w.cli('open').code, 0);
    const panes = JSON.parse(fs.readFileSync(w.env.FAKE_HERDR_STATE, 'utf8')).panes;
    const stateFile = path.join(w.dir, 'state.json');
    w.stop();
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    const legacy = state.mailboxes[mb].screen;
    const screenPane = panes.find(p => p.pane_id === legacy.pane);
    assert.ok(screenPane, 'the screen pane is still present');
    assert.equal(legacy.terminalId, panes.find(p => p.pane_id === RECV).terminal_id);
    delete legacy.paneTerminal;
    fs.writeFileSync(stateFile, JSON.stringify(state));
    assert.equal(w.cli('status').code, 0);
    fs.writeFileSync(w.env.FAKE_HERDR_LOG, '');
    // Use the focus event's public op to check its response as well as the persisted migration.
    const focused = await w.op('screen-ensure', { pane: RECV });
    assert.deepEqual(focused, { ok: true, action: 'none' });
    const saved = JSON.parse(fs.readFileSync(stateFile, 'utf8')).mailboxes[mb].screen;
    assert.equal(saved.pane, screenPane.pane_id);
    assert.equal(saved.paneTerminal, screenPane.terminal_id);
    assert.equal(saved.terminalId, legacy.terminalId);
    assert.equal(w.log().some(({ argv }) => argv[0] === 'pane' && ['close', 'split', 'run'].includes(argv[1])), false);
    w.setFake(f => {
      f.panes = panes.map(p => p.pane_id === screenPane.pane_id
        ? { ...p, terminal_id: `${p.terminal_id}-restarted` } : p);
    });
    fs.writeFileSync(w.env.FAKE_HERDR_LOG, '');
    const ev = spawnSync(process.execPath, [path.join(here, 'on-focus.mjs')], {
      env: { ...w.env, HERDR_PANE_ID: RECV, HERDR_PLUGIN_EVENT_JSON: JSON.stringify({ event: 'pane.focused', data: { pane_id: RECV } }) }, encoding: 'utf8',
    });
    assert.equal(ev.status, 0, ev.stderr);
    const calls = w.log().map(entry => entry.argv);
    const closed = calls.findIndex(args => args[0] === 'pane' && args[1] === 'close' && args.includes(screenPane.pane_id));
    const split = calls.findIndex(args => args[0] === 'pane' && args[1] === 'split' && args[2] === RECV);
    assert.ok(closed >= 0, 'the shell with the changed terminal is closed');
    assert.ok(split > closed, 'the stale shell is closed before splitting the receiver');
    assertScreenOpen(w, RECV, 48);
  } finally { w.cleanup(); }
});

test('202/AC-12 Deliver now skips the merge wait but still waits for an empty input box', async () => {
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

test('202/AC-12 Deliver now with text in the input box sends nothing until it is empty', async () => {
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

test('202/AC-13 the view names why plain messages are paused: typing, or an input box that cannot be read', async () => {
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

test('202/AC-14 an unconfirmed batch is listed and "mark delivered" closes it without sending again', async () => {
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

test('202/AC-14 an unconfirmed batch is never resent on its own, only when "resend" is chosen', async () => {
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

test('202/AC-15 typing in the screen text box does not move focus; a button press hands focus back to the receiver', async () => {
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

test('202/AC-2 AC-16 smoke: both card modes render a full view without throwing', async () => {
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

// A view-shaped fixture keeps visual assertions independent of daemon socket availability.
function interactionModel() {
  const question = (uid, draft = null) => ({
    uid, serial: uid, type: 'decision', status: 'pending', priority: 'medium',
    sender: SENDER, senderLabel: 'worker', version: 1, tags: [], draft,
    content: { question: 'Which option?', options: ['First', 'Second'], recommend: 'A', attach: { name: 'plan.md' } },
  });
  return {
    ok: true,
    mailbox: { id: 'MB-test', state: 'connected', generation: 1, pane: RECV, label: 'receiver', screen: { open: true } },
    notes: [{ uid: 'note', senderLabel: 'worker', text: 'A queued note' }],
    questions: [question('Q1'), question('Q2', { choice: 'A', text: 'A reason' }), question('Q3', { choice: 'B', text: 'Check again', reconfirm: true })],
    batches: [{ id: 'batch-test', status: 'unconfirmed', kind: 'notes', members: 1 }],
    inputState: 'empty', paused: null, deliverAt: null,
    prefs: { width: 48, cardMode: 'detailed' },
  };
}

// Decode visible terminal columns and their SGR sequences, including wide glyphs.
async function styledCells(line) {
  const { charWidth } = await import('./screen/text.mjs');
  const cells = [];
  let style = '';
  for (const token of line.match(/\x1b\[[0-9;]*m|[^\x1b]/gu) ?? []) {
    if (token.startsWith('\x1b[')) {
      style = /^\x1b\[(?:0)?m$/.test(token) ? '' : style + token;
    } else {
      for (let i = 0; i < charWidth(token); i++) cells.push({ text: token, style });
    }
  }
  return cells;
}

test('202/AC-18 screen startup enables all-motion and SGR mouse reporting', () => {
  const w = world();
  try {
    const script = `
      import { enter } from ${JSON.stringify(new URL('./screen/term.mjs', import.meta.url).href)};
      enter(process.stdout, { resume() {}, setRawMode() {} });
    `;
    const result = spawnSync(process.execPath, ['--input-type=module', '--eval', script], { env: w.env, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.ok(result.stdout.includes('\x1b[?1003h'), 'all mouse movement is reported');
    assert.ok(result.stdout.includes('\x1b[?1006h'), 'mouse coordinates use SGR reporting');
  } finally { w.cleanup(); }
});

test('202/AC-18 moving onto each clickable hit changes its SGR style and moving away restores it', async () => {
  const { render } = await import('./screen/render.mjs');
  const { parseInput } = await import('./screen/input.mjs');
  const model = interactionModel();
  for (const cardMode of ['detailed', 'compact']) {
    const options = { cols: 80, rows: 100, cardMode, now: 0 };
    const before = render(model, options);
    assert.ok(before.hits.length > 0);
    for (const target of before.hits) {
      const events = parseInput(`\x1b[<35;${target.c0 + 1};${target.row + 1}M`);
      assert.equal(events.length, 1, 'a mouse movement produces an input event');
      const { x, y } = events[0];
      assert.equal(x, target.c0 + 1);
      assert.equal(y, target.row + 1);
      // Hover takes the same 1-based coordinates as decoded terminal mouse input.
      const over = render(model, { ...options, hover: { x, y } });
      const styles = async ui => (await styledCells(ui.styled[target.row])).slice(target.c0, target.c1).map(cell => cell.style);
      assert.notDeepEqual(await styles(over), await styles(before), `${cardMode}: ${target.action.type} visibly responds to hover`);
      const away = parseInput('\x1b[<35;1;1M')[0];
      assert.ok(away && !before.hits.some(h => h.row === away.y - 1 && h.c0 <= away.x - 1 && away.x - 1 < h.c1), 'the pointer moves outside all hits');
      const restored = render(model, { ...options, hover: { x: away.x, y: away.y } });
      assert.deepEqual(await styles(restored), await styles(before), 'moving away restores the original SGR style');
    }
  }
});

test('202/AC-21 clickable hits have padding and spacing, while options of the same question may touch vertically and each occupy one row', async () => {
  const { render } = await import('./screen/render.mjs');
  for (const cardMode of ['detailed', 'compact']) {
    for (const cols of [32, 48, 80]) {
      const ui = render(interactionModel(), { cols, rows: 100, cardMode, now: 0 });
      assert.ok(ui.hits.length > 0);
      for (let i = 0; i < ui.hits.length; i++) {
        for (const other of ui.hits.slice(i + 1)) {
          const target = ui.hits[i];
          const overlaps = target.c0 < other.c1 && other.c0 < target.c1;
          const sameQuestionOptions = target.action.type === 'choose' && other.action.type === 'choose'
            && target.action.uid === other.action.uid;
          if (target.row !== other.row && overlaps && !sameQuestionOptions) {
            assert.ok(Math.abs(target.row - other.row) - 1 >= 1, `${cardMode}/${cols}: ${target.action.type} and ${other.action.type} leave a row between overlapping column ranges`);
          }
        }
      }
      for (const target of ui.hits) {
        const label = `${cardMode}/${cols}: ${target.action.type}`;
        assert.ok(Number.isInteger(target.row) && target.row >= 0 && target.row < ui.lines.length, `${label} occupies a visible row`);
        assert.ok(target.c0 >= 0 && target.c1 <= cols && target.c1 - target.c0 >= 3, `${label} has room for text and padding`);
        const cells = await styledCells(ui.styled[target.row]);
        const text = cells.slice(target.c0, target.c1).map(cell => cell.text).join('');
        assert.equal(cells[target.c0]?.text, ' ', `${label} has left padding inside the hit`);
        assert.equal(cells[target.c1 - 1]?.text, ' ', `${label} has right padding inside the hit`);
        assert.ok(text.trim().length > 0, `${label} contains visible text`);
      }
      const options = ui.hits.filter(h => h.action.type === 'choose');
      assert.ok(options.length > 0, 'option hit ranges are present');
      for (const option of options) {
        // Hits use a single row; repeated ranges for one option must not extend it onto another row.
        const rows = new Set(options.filter(h => h.action.uid === option.action.uid && h.action.choice === option.action.choice).map(h => h.row));
        assert.deepEqual([...rows], [option.row], `${cardMode}/${cols}: ${option.action.uid}/${option.action.choice} occupies exactly one row`);
        for (const neighbor of options.filter(h => h.action.uid === option.action.uid && h.action.choice !== option.action.choice && h.row !== option.row)) {
          assert.equal(rows.has(neighbor.row), false, 'an option hit does not extend into a neighboring option row');
        }
      }
      for (const row of new Set(ui.hits.map(h => h.row))) {
        const hits = ui.hits.filter(h => h.row === row).sort((a, b) => a.c0 - b.c0);
        for (let i = 1; i < hits.length; i++) {
          assert.ok(hits[i].c0 - hits[i - 1].c1 >= 1, `${cardMode}/${cols}: adjacent hits leave a column between their ranges`);
        }
      }
    }
  }
});

test('202/AC-20 a new offscreen question is revealed when idle or by clicking its hint while interaction keeps the scroll position', async () => {
  const { render } = await import('./screen/render.mjs');
  const { perform } = await import('./screen/actions.mjs');
  const { parseInput } = await import('./screen/input.mjs');
  const w = world();
  try {
    const model = interactionModel();
    model.notes = [];
    model.batches = [];
    const seed = model.questions[0];
    model.questions = Array.from({ length: 20 }, (_, i) => ({
      ...seed, uid: `old-${i}`, serial: `Q${i + 1}`,
      content: { ...seed.content, question: `Existing question ${i + 1}?` },
    }));
    const options = { cols: 80, rows: 40, locale: 'en', cardMode: 'compact', scroll: 0, now: 100_000 };
    const before = render(model, options);
    assert.ok(before.scrollMax > 0, 'the existing questions overflow the viewport');
    const fresh = {
      ...seed, uid: 'new-question', serial: 'Q21',
      content: { ...seed.content, question: 'New arrival needs a decision?' },
    };
    const next = { ...model, questions: [...model.questions, fresh] };
    // Render receives the previously seen ids and the timestamp of the last parsed input; null means idle.
    const previousQuestionIds = model.questions.map(q => q.uid);
    const idle = render(next, { ...options, previousQuestionIds, lastInteractionAt: null });
    assert.ok(idle.scroll > before.scroll, 'an idle screen scrolls to the new card');
    assert.ok(idle.lines.some(line => line.includes(fresh.content.question)), 'the new question text is visible when idle');
    assert.ok(idle.hits.some(h => h.action.uid === fresh.uid), 'the new card has a visible clickable control');
    for (const input of ['\x1b[<35;4;4M', 'typing a reply']) {
      const events = parseInput(input);
      assert.ok(events.some(e => e.kind === 'move' || e.kind === 'text'), 'mouse movement and typing count as interaction');
      const activeOptions = { ...options, previousQuestionIds, lastInteractionAt: events.length ? options.now : null };
      const active = render(next, activeOptions);
      assert.equal(active.scroll, before.scroll, 'recent interaction preserves the scroll position');
      assert.equal(active.lines.some(line => line.includes(fresh.content.question)), false, 'the new card remains offscreen until requested');
      let hint;
      for (const h of active.hits) {
        const cells = await styledCells(active.styled[h.row]);
        if (cells.slice(h.c0, h.c1).map(cell => cell.text).join('').includes('↓ 1 new question')) { hint = h; break; }
      }
      assert.ok(hint, 'a clickable English hint says ↓ 1 new question');
      const [event] = parseInput(`\x1b[<0;${hint.c0 + 1};${hint.row + 1}M`);
      assert.equal(event.kind, 'click');
      const clicked = active.hits.find(h => h.row === event.y - 1 && h.c0 <= event.x - 1 && event.x - 1 < h.c1);
      assert.ok(clicked, 'the hint is reachable through terminal mouse coordinates');
      const result = await perform(clicked.action, {
        call: async req => req.op === 'view' ? next : { ok: true },
        run: async args => {
          const r = spawnSync(process.execPath, [FAKE, ...args], { env: w.env, encoding: 'utf8' });
          assert.equal(r.status, 0, r.stderr);
          return r.stdout;
        },
        model: next, scroll: active.scroll, selfPane: 'w1:p3', ownerPane: RECV, generation: 1,
      });
      assert.equal(result.ok, true);
      // A local navigation action returns the new scroll offset for the next render.
      assert.ok(Number.isFinite(result.scroll) && result.scroll > active.scroll, 'clicking the hint requests a scroll to the new card');
      const revealed = render(next, { ...activeOptions, previousQuestionIds: next.questions.map(q => q.uid), scroll: result.scroll });
      assert.ok(revealed.lines.some(line => line.includes(fresh.content.question)), 'clicking the hint reveals the new question');
      assert.ok(revealed.hits.some(h => h.action.uid === fresh.uid), 'the revealed card can be acted on');
    }
  } finally { w.cleanup(); }
});

async function performVoid(w, ui, action, confirm, requests = []) {
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
    confirm, selfPane: 'w1:p3', ownerPane: RECV, generation: ui.model.mailbox.generation,
  });
}

test('202/AC-22 Void answers a decision or discussion with X, immediately sends Voided and removes only that card', async () => {
  const { render } = await import('./screen/render.mjs');
  const fixture = interactionModel();
  fixture.questions[2] = { ...fixture.questions[2], type: 'discussion', content: { question: 'Discuss this?', idea: 'An idea' } };
  const preview = render(fixture, { cols: 80, rows: 100 });
  for (const q of fixture.questions) hit(preview, 'void', a => a.uid === q.uid);
  const w = world();
  try {
    const mb = await ready(w);
    const decisionQuestion = await decision(w, { question: 'Void this decision?' });
    const discussionQuestion = await discussion(w, { question: 'Void this discussion?' });
    const keep = await decision(w, { question: 'Keep this question pending?' });
    for (const q of [decisionQuestion, discussionQuestion]) {
      const ui = await screen(w, mb);
      const requests = [];
      const result = await performVoid(w, ui, hit(ui, 'void', a => a.uid === q.uid), undefined, requests);
      assert.equal(result.ok, true);
      const answer = requests.findIndex(req => req.op === 'answer' && req.uid === q.uid && req.choice === 'X');
      assert.ok(answer >= 0, 'Void uses the normal answer channel with code X');
      assert.ok(requests.slice(answer + 1).some(req => req.op === 'submit' && req.items.some(item => item.uid === q.uid)), 'Void submits immediately after answering');
      const after = await screen(w, mb);
      const sentQuestion = find(after.model, q.uid);
      assert.ok(sentQuestion && ['submitted', 'delivered'].includes(sentQuestion.status), 'the question is sent');
      assert.equal(sentQuestion.draft.choice, 'X');
      assert.equal(after.hits.some(h => h.action.uid === q.uid), false, 'the sent card is no longer actionable');
      assert.equal(after.lines.some(line => line.includes(sentQuestion.content.question)), false, 'the sent question leaves the decision area');
      assert.equal(find(after.model, keep.uid).status, 'pending');
      const prompt = await until(() => w.prompts().find(entry => JSON.stringify(entry).includes(sentQuestion.content.question)));
      assert.ok(prompt, 'the receiver gets the voided answer without another Submit click');
      assert.match(JSON.stringify(prompt), /Voided|作廢/);
    }
  } finally { w.cleanup(); }
});

test('202/AC-23 Void all confirms the count and sends X for every unsent question including existing drafts', async () => {
  const { render } = await import('./screen/render.mjs');
  hit(render(interactionModel(), { cols: 80, rows: 100 }), 'void-all');
  const w = world();
  try {
    const mb = await ready(w);
    const open = await decision(w, { question: 'Unanswered decision to void?' });
    const drafted = await decision(w, { question: 'Drafted decision to void?' });
    const talk = await discussion(w, { question: 'Drafted discussion to void?' });
    await w.op('answer', { uid: drafted.uid, version: drafted.version, choice: 'B', text: 'Existing choice' });
    await w.op('answer', { uid: talk.uid, version: talk.version, text: 'Existing discussion draft' });
    await note(w, 'Keep this queued note');
    const ui = await screen(w, mb);
    const requests = [];
    let confirmations = 0;
    const result = await performVoid(w, ui, hit(ui, 'void-all'), async message => {
      confirmations++;
      assert.match(message, /\b3\b/, 'confirmation states the number of questions, including drafts');
      assert.match(message, /void|作廢/i);
      assert.equal(requests.some(req => ['answer', 'submit'].includes(req.op)), false, 'no questions change before confirmation');
      assert.deepEqual((await w.op('view', { mailbox: mb })).questions, ui.model.questions);
      assert.equal(w.prompts().length, 0);
      return true;
    }, requests);
    assert.equal(confirmations, 1, 'Void all asks for confirmation');
    assert.equal(result.ok, true);
    const after = await screen(w, mb);
    for (const q of [open, drafted, talk]) {
      const sent = find(after.model, q.uid);
      assert.ok(sent && ['submitted', 'delivered'].includes(sent.status));
      assert.equal(sent.draft.choice, 'X', 'X replaces existing answer drafts too');
      assert.equal(after.hits.some(h => h.action.uid === q.uid), false);
      assert.equal(after.lines.some(line => line.includes(sent.content.question)), false);
      const prompt = await until(() => w.prompts().find(entry => JSON.stringify(entry).includes(sent.content.question)));
      assert.ok(prompt, 'each voided question is delivered to the receiver');
      assert.match(JSON.stringify(prompt), /Voided|作廢/);
    }
    assert.deepEqual(after.model.notes, ui.model.notes, 'Void all leaves queued notes alone');
  } finally { w.cleanup(); }
});

test('202/AC-23 cancelling Void all preserves unanswered questions, drafts and delivery state', async () => {
  const { render } = await import('./screen/render.mjs');
  hit(render(interactionModel(), { cols: 80, rows: 100 }), 'void-all');
  const w = world();
  try {
    const mb = await ready(w);
    await decision(w, { question: 'Keep this unanswered decision?' });
    const q = await discussion(w, { question: 'Keep this discussion draft?' });
    await w.op('answer', { uid: q.uid, version: q.version, text: 'Preserve my draft' });
    const ui = await screen(w, mb);
    const requests = [];
    let confirmations = 0;
    let confirmationMessage;
    await performVoid(w, ui, hit(ui, 'void-all'), async message => {
      confirmations++;
      confirmationMessage = message;
      return false;
    }, requests);
    assert.equal(confirmations, 1);
    assert.match(confirmationMessage, /\b2\b/, 'the cancellation prompt includes the target count');
    assert.equal(requests.some(req => ['answer', 'submit'].includes(req.op)), false, 'cancelling makes no answer or submit requests');
    await sleep(300);
    const after = await w.op('view', { mailbox: mb });
    assert.deepEqual(after.questions, ui.model.questions);
    assert.deepEqual(after.notes, ui.model.notes);
    assert.deepEqual(after.batches, ui.model.batches);
    assert.equal(w.prompts().length, 0, 'cancelling sends nothing to the receiver');
  } finally { w.cleanup(); }
});

// Hold the op response so the optimistic frame is checked before any result can complete it.
async function feedbackRequest(model, action, call, pendingLabel, run = async () => ({ ok: true })) {
  const { render } = await import('./screen/render.mjs');
  const { perform } = await import('./screen/actions.mjs');
  let now = 100_000;
  let feedback = null;
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const pending = perform(action, {
    call: async req => { await gate; return call(req); }, run,
    now: () => now, onFeedback: next => { feedback = next; },
    selfPane: 'w1:p3', ownerPane: RECV, generation: model.mailbox.generation,
  });
  let result;
  try {
    await Promise.resolve();
    now += 199;
    const ui = render(model, { cols: 80, rows: 100, locale: 'en', now, feedback });
    assert.ok(ui.lines.some(line => line.includes(pendingLabel)), 'feedback is visible within 200 ms while the op is still pending');
    assert.equal(ui.hits.some(h => h.action.type === action.type && (!action.uid || h.action.uid === action.uid)), false, 'the pending button is disabled');
  } finally {
    release();
    result = await pending;
  }
  return { result, feedback, completedAt: now };
}

test('202/AC-24 Deliver now disables immediately, shows waiting reasons and keeps Delivered for two seconds after confirmation', async () => {
  const { render } = await import('./screen/render.mjs');
  const fixture = interactionModel();
  const preview = render(fixture, { cols: 80, rows: 100, now: 100_000 });
  const optimistic = await feedbackRequest(fixture, hit(preview, 'deliver-now'), async () => ({ ok: true }), 'Delivering…');
  assert.equal(optimistic.result.ok, true);
  assert.equal(render(fixture, { cols: 80, rows: 100, now: optimistic.completedAt, feedback: optimistic.feedback }).lines.some(line => /\bDelivered\b/.test(line)), false, 'request acceptance alone is not delivery confirmation');
  const w = world({ timings: { tickMs: 1, retryMs: 1, confirmMs: 50 } });
  try {
    const mb = await ready(w);
    await note(w, 'Deliver this note');
    w.setFake(f => { f.screens[RECV] = TYPING; });
    const ui = await screen(w, mb);
    assert.equal((await click(w, ui, hit(ui, 'deliver-now'))).ok, true);
    let state;
    for (const [input, reason] of [[TYPING, 'typing'], [UNKNOWN, 'unknown']]) {
      w.setFake(f => { f.screens[RECV] = input; });
      state = await until(async () => {
        const next = await w.op('delivery-state', { mailbox: mb });
        return next.paused?.reason === reason && next;
      });
      assert.equal(state.paused.reason, reason);
      const waiting = render(await w.op('view', { mailbox: mb }), {
        cols: 80, rows: 100, locale: 'en', now: 101_000,
        feedback: optimistic.feedback, deliveryState: state,
      });
      assert.ok(waiting.lines.some(line => line.includes('Waiting:') && line.includes(reason)), `the waiting label includes ${reason}`);
      assert.equal(waiting.hits.some(h => h.action.type === 'deliver-now'), false);
      assert.equal(w.prompts().length, 0, 'waiting is not treated as delivered');
    }
    w.setFake(f => { f.screens[RECV] = EMPTY; });
    state = await until(async () => {
      const next = await w.op('delivery-state', { mailbox: mb });
      return next.batches.some(b => b.status === 'confirmed') && next;
    });
    assert.ok(state.batches.some(b => b.status === 'confirmed'), 'the daemon confirms transcript landing');
    // A later queued note keeps the normal delivery button available once the success feedback expires.
    await note(w, 'Next note stays queued');
    const model = await w.op('view', { mailbox: mb });
    const options = { cols: 80, rows: 100, locale: 'en', feedback: optimistic.feedback, deliveryState: state, deliveryConfirmedAt: 102_000 };
    for (const now of [102_000, 103_999]) {
      const delivered = render(model, { ...options, now });
      assert.ok(delivered.lines.some(line => /\bDelivered\b/.test(line)), 'delivery confirmation remains visible for two seconds');
      assert.equal(delivered.hits.some(h => h.action.type === 'deliver-now'), false);
    }
    const restored = render(model, { ...options, now: 104_000 });
    assert.equal(restored.lines.some(line => /\bDelivered\b/.test(line)), false);
    hit(restored, 'deliver-now');
  } finally { w.cleanup(); }
});

test('202/AC-24 Deliver now stops showing Delivering once the batch turns unconfirmed and restores the button with the unresolved prompt', async () => {
  const { render } = await import('./screen/render.mjs');
  const { perform } = await import('./screen/actions.mjs');
  const model = interactionModel();
  model.questions = [];
  model.batches = [];
  const options = { cols: 80, rows: 40, locale: 'en' };
  const before = render(model, { ...options, now: 100_000 });
  let feedback;
  const requests = [];
  const result = await perform(hit(before, 'deliver-now'), {
    call: async req => { requests.push(req); return { ok: true }; },
    run: async () => ({ ok: true }), generation: model.mailbox.generation,
    now: () => 100_000, onFeedback: next => { feedback = next; },
  });
  assert.equal(result.ok, true);
  assert.equal(requests[0].op, 'deliver-now');
  const batch = { id: 'batch-unconfirmed-after-deliver', status: 'sending', kind: 'notes', members: 1, createdAt: 100_001, sentAt: 100_001 };
  const deliveryState = { ok: true, paused: null, queued: model.notes.map(n => n.uid), inputState: 'empty', batches: [batch] };
  model.batches = [batch];
  const sending = render(model, { ...options, now: 100_002, feedback, deliveryState, deliveryConfirmedAt: null });
  assert.ok(sending.lines.some(line => line.includes('Delivering…')));
  assert.equal(sending.hits.some(h => h.action.type === 'deliver-now'), false, 'the in-flight delivery starts disabled');
  // The tracked batch failed to confirm; a queued note keeps the normal delivery button available to retry.
  batch.status = 'unconfirmed';
  for (const now of [100_500, 700_000]) {
    const unresolved = render(model, { ...options, now, feedback, deliveryState, deliveryConfirmedAt: null });
    assert.equal(unresolved.lines.some(line => line.includes('Delivering…')), false, 'an unconfirmed batch no longer leaves Deliver now stuck delivering');
    hit(unresolved, 'deliver-now');
    assert.ok(unresolved.lines.some(line => line.includes(batch.id) && /unconfirmed/i.test(line)), 'the unresolved batch is shown instead of an endless delivering state');
    hit(unresolved, 'resolve-batch', a => a.batch === batch.id && a.action === 'delivered');
    hit(unresolved, 'resolve-batch', a => a.batch === batch.id && a.action === 'resend');
  }
});

test('202/AC-27 Submit and stale Void disable while processing, then show completion or the failure reason', async () => {
  const { render } = await import('./screen/render.mjs');
  const fixture = interactionModel();
  const preview = render(fixture, { cols: 80, rows: 100 });
  await feedbackRequest(fixture, hit(preview, 'submit'), async () => ({ ok: true }), 'Processing…');
  const w = world();
  try {
    const mb = await ready(w);
    const q = await decision(w, { question: 'Submit with visible feedback?' });
    await w.op('answer', { uid: q.uid, version: q.version, choice: 'A' });
    const ui = await screen(w, mb);
    const call = req => w.raw({ ...req, caller: { pane: RECV, viaPlugin: true } });
    const run = async args => {
      const r = spawnSync(process.execPath, [FAKE, ...args], { env: w.env, encoding: 'utf8' });
      assert.equal(r.status, 0, r.stderr);
      return r.stdout;
    };
    const success = await feedbackRequest(ui.model, hit(ui, 'submit'), call, 'Processing…', run);
    assert.equal(success.result.ok, true);
    assert.ok(['submitted', 'delivered'].includes(find(await w.op('view', { mailbox: mb }), q.uid).status));
    for (const elapsed of [0, 1999]) {
      const completed = render(ui.model, { cols: 80, rows: 100, now: success.completedAt + elapsed, feedback: success.feedback });
      assert.ok(completed.lines.some(line => line.includes('Completed')), 'completion remains visible for two seconds');
      assert.equal(completed.hits.some(h => h.action.type === 'submit'), false);
    }
    const restored = render(ui.model, { cols: 80, rows: 100, now: success.completedAt + 2000, feedback: success.feedback });
    assert.equal(restored.lines.some(line => line.includes('Completed')), false);
    hit(restored, 'submit');
    const stale = await decision(w, { question: 'Old question for failed Void?' });
    const old = await screen(w, mb);
    const action = hit(old, 'void', a => a.uid === stale.uid);
    assert.equal((await w.raw({ op: 'edit', uid: stale.uid, from: SENDER, question: 'Changed question for failed Void?' })).ok, true);
    const failed = await feedbackRequest(old.model, action, call, 'Processing…', run);
    assert.equal(failed.result.ok, false);
    assert.equal(failed.result.error, 'stale_version');
    const error = render(failed.result.model ?? old.model, { cols: 80, rows: 100, now: failed.completedAt, feedback: failed.feedback });
    assert.ok(error.lines.some(line => /Failed:/.test(line) && /stale_version|question changed/i.test(line)), 'failure feedback includes the daemon reason');
    const unchanged = find(await w.op('view', { mailbox: mb }), stale.uid);
    assert.equal(unchanged.status, 'pending');
    assert.equal(unchanged.draft, null);
  } finally { w.cleanup(); }
});

test('202/AC-25 AC-26 long options wrap completely with aligned continuations and a bright yellow recommendation star before aligned letters', async () => {
  const { render } = await import('./screen/render.mjs');
  const yellowForeground = style => {
    let foreground = null;
    let bold = false;
    for (const match of style.matchAll(/\x1b\[([0-9;]*)m/g)) {
      const codes = match[1].split(';').map(Number);
      for (let i = 0; i < codes.length; i++) {
        const code = codes[i];
        if (code === 0) { foreground = null; bold = false; }
        else if (code === 1) bold = true;
        else if (code === 22) bold = false;
        else if (code === 38 || code === 48) {
          const mode = codes[++i];
          let rgb;
          if (mode === 2) { rgb = codes.slice(i + 1, i + 4); i += 3; }
          else if (mode === 5) {
            const index = codes[++i];
            if (index === 11) rgb = [255, 255, 0];
            else if (index >= 16 && index <= 231) {
              const levels = [0, 95, 135, 175, 215, 255];
              const n = index - 16;
              rgb = [levels[Math.floor(n / 36)], levels[Math.floor(n / 6) % 6], levels[n % 6]];
            }
          }
          if (code === 38) foreground = rgb ?? null;
        } else if (code === 33 || code === 93) foreground = code;
        else if ((code >= 30 && code <= 37) || (code >= 90 && code <= 97) || code === 39) foreground = null;
      }
    }
    if (typeof foreground === 'number') return foreground === 93 || (foreground === 33 && bold);
    return Array.isArray(foreground) && foreground[0] >= 180 && foreground[1] >= 140
      && foreground[2] < Math.min(foreground[0], foreground[1]) * 0.75;
  };
  for (const cardMode of ['detailed']) {
    for (const cols of [32, 48]) {
      const model = interactionModel();
      model.notes = [];
      model.batches = [];
      const options = ['abcdefghijklmnopqrstuvwxyz'.repeat(3), 'zyxwvutsrqponmlkjihgfedcba'.repeat(3)];
      model.questions = [{ ...model.questions[0], content: { question: 'Choose a long option?', options, recommend: 'A' } }];
      const ui = render(model, { cols, rows: 100, cardMode, now: 0 });
      const optionHits = ui.hits.filter(h => h.action.type === 'choose');
      const first = ['A', 'B'].map(choice => {
        const hits = optionHits.filter(h => h.action.choice === choice).sort((a, b) => a.row - b.row);
        assert.ok(hits.length > 0, `${choice} is clickable`);
        return hits[0];
      });
      const rows = await Promise.all(ui.styled.map(styledCells));
      const letters = first.map((h, i) => rows[h.row].findIndex((cell, col) => col >= h.c0 && col < h.c1 && cell.text === 'AB'[i]));
      const star = rows[first[0].row].findIndex(cell => cell.text === '★');
      assert.ok(star >= 0 && star < letters[0], 'the recommendation star precedes its option letter');
      assert.ok(yellowForeground(rows[first[0].row][star].style), 'the star has a bright yellow foreground, not merely a yellow background');
      assert.equal(letters[1], letters[0], 'recommended and other option letters share a column');
      assert.equal(rows[first[1].row][star]?.text, ' ', 'the other option reserves a blank at the star column');
      assert.equal(rows[first[1].row].some(cell => cell.text === '★'), false);
      for (let i = 0; i < options.length; i++) {
        const start = first[i].row;
        const nextControl = ui.hits.filter(h => h.row > start && h.action.type !== 'choose').map(h => h.row);
        const end = first[i + 1]?.row ?? Math.min(...nextControl);
        const textCol = rows[start].findIndex((cell, col) => col > letters[i] && /[a-z]/.test(cell.text));
        assert.ok(textCol > letters[i], 'option text follows the option letter');
        const chunks = [];
        for (let row = start; row < end; row++) {
          const text = rows[row].slice(textCol).map(cell => cell.text).join('').trim();
          if (!text) continue;
          if (row > start) {
            const left = rows[row].findIndex((cell, col) => col > 0 && cell.text !== ' ');
            assert.equal(left, textCol, 'each continuation starts at the first line text column');
          }
          assert.equal(text.includes('…'), false, 'long options are never truncated with an ellipsis');
          chunks.push(text);
        }
        assert.ok(chunks.length > 1, 'the long option actually wraps');
        assert.equal(chunks.join(''), options[i], 'all option characters remain visible in order');
      }
    }
  }
});

test('202/AC-29 marking the second batch delivered hits the correct action and removes only its prompt, then leaves No messages after both are resolved', async () => {
  const { render } = await import('./screen/render.mjs');
  const { perform } = await import('./screen/actions.mjs');
  const { parseInput } = await import('./screen/input.mjs');
  for (const cols of [32, 48, 80]) {
    const model = interactionModel();
    model.notes = [];
    model.questions = [];
    model.batches = ['batch-first', 'batch-second'].map(id => ({ id, status: 'unconfirmed', kind: 'notes', members: 1 }));
    const options = { cols, rows: 40, locale: 'en', now: 0 };
    const before = render(model, options);
    const requests = [];
    const env = {
      call: async req => {
        requests.push(req);
        if (req.op === 'view') return model;
        assert.equal(req.op, 'resolve-batch');
        assert.equal(req.action, 'delivered');
        const batch = model.batches.find(b => b.id === req.batch);
        assert.ok(batch, 'the requested batch exists');
        batch.status = 'confirmed';
        return { ok: true };
      },
      run: async () => ({ ok: true }), generation: model.mailbox.generation,
    };
    // Find the visible second label first, then use the same coordinate hit lookup as the screen.
    const labels = [];
    for (let row = 0; row < before.lines.length; row++) {
      const cells = await styledCells(before.styled[row]);
      const label = 'Mark delivered';
      const col = cells.findIndex((_, i) => cells.slice(i, i + label.length).map(cell => cell.text).join('') === label);
      if (col >= 0) labels.push({ row, col });
    }
    assert.equal(labels.length, 2, 'both Mark delivered labels are visible');
    const [event] = parseInput(`\x1b[<0;${labels[1].col + 1};${labels[1].row + 1}M`);
    assert.equal(event.kind, 'click');
    const clicked = before.hits.find(h => h.row === event.y - 1 && h.c0 <= event.x - 1 && event.x - 1 < h.c1);
    assert.ok(clicked, 'the second label is clickable at its displayed position');
    assert.equal(clicked.action.type, 'resolve-batch');
    assert.equal(clicked.action.batch, 'batch-second');
    assert.equal(clicked.action.action, 'delivered', 'the label must not hit the first batch Resend action');
    const firstActions = before.hits.filter(h => h.action.batch === 'batch-first').map(h => h.action);
    assert.equal((await perform(clicked.action, env)).ok, true);
    assert.equal(requests[0].batch, 'batch-second');
    assert.equal(requests[0].action, 'delivered');
    const afterSecond = render(model, options);
    assert.equal(afterSecond.lines.some(line => line.includes('batch-second')), false, 'the resolved batch prompt disappears on the next render');
    assert.equal(afterSecond.hits.some(h => h.action.batch === 'batch-second'), false, 'both controls of the resolved batch disappear');
    assert.ok(afterSecond.lines.some(line => line.includes('batch-first') && line.includes('unconfirmed')), 'the first prompt remains');
    assert.deepEqual(afterSecond.hits.filter(h => h.action.batch === 'batch-first').map(h => h.action), firstActions, 'both first-batch controls stay unchanged');
    assert.equal((await perform(hit(afterSecond, 'resolve-batch', a => a.batch === 'batch-first' && a.action === 'delivered'), env)).ok, true);
    const empty = render(model, options);
    assert.equal(empty.hits.some(h => h.action.type === 'resolve-batch'), false);
    assert.equal(empty.lines.some(line => /batch-first|batch-second|unconfirmed|Mark delivered|Resend/.test(line)), false, 'no old prompt or button text remains');
    const messages = empty.lines.findIndex(line => line.trim().startsWith('Messages ·'));
    const questions = empty.lines.findIndex(line => line.trim().startsWith('Questions ·'));
    assert.ok(messages >= 0 && questions > messages);
    assert.deepEqual(empty.lines.slice(messages + 1, questions).map(line => line.trim()).filter(Boolean), ['No messages'], 'the empty message area contains only its empty-state line');
  }
});

test('202/AC-30 a queued click keeps the action from the displayed frame even when the layout changes before dispatch', async () => {
  // Main's input queue must use this entry point: enqueue captures the displayed hit, onEvent handles it later.
  const { createEventQueue } = await import('./screen/events.mjs');
  const { render } = await import('./screen/render.mjs');
  const { perform } = await import('./screen/actions.mjs');
  const { parseInput } = await import('./screen/input.mjs');
  const model = interactionModel();
  model.notes = [];
  model.questions = [];
  model.batches = [{ id: 'batch-target', status: 'unconfirmed', kind: 'notes', members: 2 }];
  const options = { cols: 48, rows: 40, locale: 'en', now: 0 };
  const frameA = render(model, options);
  const target = frameA.hits.find(h => h.action.batch === 'batch-target' && h.action.action === 'delivered');
  assert.ok(target);
  const [clickEvent] = parseInput(`\x1b[<0;${target.c0 + 1};${target.row + 1}M`);
  let currentUI = frameA;
  let unblock;
  const barrier = new Promise(resolve => { unblock = resolve; });
  const requests = [];
  const queue = createEventQueue({
    getUI: () => currentUI,
    onEvent: async (event, capturedAction) => {
      if (event.kind === 'key') { await barrier; return; }
      if (event.kind === 'click') {
        assert.ok(capturedAction, 'the queue supplies the action captured at event receipt');
        const result = await perform(capturedAction, {
          call: async req => { requests.push(req); return { ok: true }; },
          run: async () => ({ ok: true }), generation: model.mailbox.generation,
        });
        assert.equal(result.ok, true);
      }
    },
  });
  const first = queue.enqueue({ kind: 'key', name: 'enter' });
  await Promise.resolve();
  const pendingClick = queue.enqueue(clickEvent);
  try {
    model.batches.unshift({ id: 'batch-inserted', status: 'unconfirmed', kind: 'notes', members: 1 });
    currentUI = render(model, options);
    const moved = currentUI.hits.find(h => h.row === clickEvent.y - 1 && h.c0 <= clickEvent.x - 1 && clickEvent.x - 1 < h.c1);
    assert.ok(moved, 'the same coordinate is still clickable in frame B');
    assert.equal(moved.action.batch, 'batch-inserted', 'the new layout puts a different batch at that coordinate');
    assert.equal(requests.length, 0, 'the click is still queued behind the earlier event');
  } finally {
    unblock();
    await Promise.all([first, pendingClick]);
  }
  assert.equal(requests.length, 1);
  assert.equal(requests[0].op, 'resolve-batch');
  assert.equal(requests[0].batch, 'batch-target', 'dispatch uses frame A rather than the newer frame B');
  assert.equal(requests[0].action, 'delivered');
});

test('202/AC-31 Resend asks for its batch and member count before sending, while cancelling restores the unchanged view', async () => {
  const { render } = await import('./screen/render.mjs');
  const { perform } = await import('./screen/actions.mjs');
  const { parseInput } = await import('./screen/input.mjs');
  for (const confirm of [true, false]) {
    const model = interactionModel();
    model.notes = [];
    model.questions = [];
    model.batches = [{ id: 'batch-resend-target', status: 'unconfirmed', kind: 'notes', members: 3 }];
    const original = structuredClone(model);
    const options = { cols: 80, rows: 40, locale: 'en', now: 0 };
    const before = render(model, options);
    const action = hit(before, 'resolve-batch', a => a.batch === 'batch-resend-target' && a.action === 'resend');
    const requests = [];
    let prompt = null;
    let answer;
    let asked;
    const asking = new Promise(resolve => { asked = resolve; });
    const pending = perform(action, {
      call: async req => {
        requests.push(req);
        assert.equal(req.op, 'resolve-batch');
        assert.equal(req.batch, 'batch-resend-target');
        assert.equal(req.action, 'resend');
        model.batches[0].status = 'sending';
        return { ok: true };
      },
      run: async () => ({ ok: true }), generation: model.mailbox.generation,
      confirm: message => {
        prompt = message;
        asked();
        return new Promise(resolve => { answer = resolve; });
      },
    });
    try {
      await Promise.race([asking, pending]);
      assert.deepEqual(requests, [], 'no resolve-batch request is sent before confirmation');
      assert.equal(typeof prompt, 'string', 'Resend opens the existing confirmation UI');
      const confirmation = render(model, { ...options, confirmPrompt: prompt });
      assert.ok(confirmation.lines.some(line => line.includes('batch-resend-target')), 'the confirmation identifies the batch');
      assert.match(prompt, /batch-resend-target/);
      assert.match(prompt, /\b3\b/, 'the confirmation includes the number of messages');
      const yes = confirmation.hits.find(h => h.action.type === 'confirm-yes');
      const no = confirmation.hits.find(h => h.action.type === 'confirm-no');
      assert.ok(yes && no, 'the confirmation offers both Yes and No');
      const target = confirm ? yes : no;
      const [event] = parseInput(`\x1b[<0;${target.c0 + 1};${target.row + 1}M`);
      const clicked = confirmation.hits.find(h => h.row === event.y - 1 && h.c0 <= event.x - 1 && event.x - 1 < h.c1);
      assert.equal(clicked?.action.type, confirm ? 'confirm-yes' : 'confirm-no');
      answer(clicked.action.type === 'confirm-yes');
      const result = await pending;
      assert.equal(result.ok, true);
      if (confirm) {
        assert.equal(requests.length, 1, 'confirmation releases exactly one resend request');
        assert.equal(requests[0].batch, 'batch-resend-target');
        assert.equal(requests[0].action, 'resend');
      } else {
        assert.deepEqual(requests, [], 'cancelling sends no resolve-batch request');
        assert.deepEqual(model, original);
        const restored = render(model, options);
        assert.deepEqual(restored.lines, before.lines);
        assert.deepEqual(restored.hits, before.hits, 'cancelling restores the original controls');
        assert.equal(restored.hits.some(h => ['confirm-yes', 'confirm-no'].includes(h.action.type)), false);
      }
    } finally {
      answer?.(false);
      await pending;
    }
  }
});

test('202/AC-33 compact options show a bright yellow star before the recommended letter and reserve the same space on other options', async () => {
  const { render } = await import('./screen/render.mjs');
  const brightYellow = style => {
    let foreground = null;
    let bold = false;
    for (const match of style.matchAll(/\x1b\[([0-9;]*)m/g)) {
      const codes = match[1].split(';').map(Number);
      for (let i = 0; i < codes.length; i++) {
        const code = codes[i];
        if (code === 0) { foreground = null; bold = false; }
        else if (code === 1) bold = true;
        else if (code === 22) bold = false;
        else if (code === 38 || code === 48) {
          const mode = codes[++i];
          let rgb;
          if (mode === 2) { rgb = codes.slice(i + 1, i + 4); i += 3; }
          else if (mode === 5) {
            const index = codes[++i];
            if (index === 11) rgb = [255, 255, 0];
            else if (index === 3) rgb = bold ? [255, 255, 0] : [128, 128, 0];
            else if (index >= 16 && index <= 231) {
              const levels = [0, 95, 135, 175, 215, 255];
              const n = index - 16;
              rgb = [levels[Math.floor(n / 36)], levels[Math.floor(n / 6) % 6], levels[n % 6]];
            }
          }
          if (code === 38) foreground = rgb ?? null;
        } else if (code === 33 || code === 93) foreground = code;
        else if ((code >= 30 && code <= 37) || (code >= 90 && code <= 97) || code === 39) foreground = null;
      }
    }
    if (typeof foreground === 'number') return foreground === 93 || (foreground === 33 && bold);
    return Array.isArray(foreground) && foreground[0] >= 180 && foreground[1] >= 140
      && foreground[2] < Math.min(foreground[0], foreground[1]) * 0.75;
  };
  for (const [layout, text] of [
    ['short', ['alpha', 'beta']],
    ['long', ['alpha '.repeat(16).trim(), 'beta '.repeat(20).trim()]],
  ]) {
    for (const cols of [32, 48, 80]) {
      for (const recommend of ['A', 'B']) {
        const model = interactionModel();
        model.notes = [];
        model.batches = [];
        model.questions = [{ ...model.questions[0], content: { question: 'Choose an option?', options: text, recommend } }];
        const ui = render(model, { cols, rows: 100, cardMode: 'compact', locale: 'en', now: 0 });
        const options = ui.hits.filter(h => h.action.type === 'choose');
        assert.equal(options.length, 2);
        const chosen = options.find(h => h.action.choice === recommend);
        const other = options.find(h => h.action.choice !== recommend);
        assert.notEqual(chosen.row, other.row, 'compact options use separate rows like detailed options');
        assert.equal(chosen.c0, other.c0, 'stacked option hits start at the same column');
        const chosenCells = (await styledCells(ui.styled[chosen.row])).slice(chosen.c0, chosen.c1);
        const otherCells = (await styledCells(ui.styled[other.row])).slice(other.c0, other.c1);
        const star = chosenCells.findIndex(cell => cell.text === '★');
        const letter = chosenCells.findIndex(cell => cell.text === recommend);
        const otherLetter = otherCells.findIndex(cell => cell.text === other.action.choice);
        assert.ok(star >= 0 && star < letter, `${layout}/${cols}: the compact option places its star before its letter`);
        assert.ok(brightYellow(chosenCells[star].style), `${layout}/${cols}: the star foreground is bright yellow`);
        assert.equal(otherCells[star]?.text, ' ', 'the other button reserves a blank at the same relative star column');
        assert.equal(otherLetter, letter, 'both letters have the same offset inside their buttons');
        assert.equal(chosenCells.filter(cell => cell.text === '★').length, 1);
        assert.equal(otherCells.some(cell => cell.text === '★'), false);
      }
    }
  }
});

test('202/AC-35 compact cards retain detailed layout for the same short content and truncate long content with full-text tooltips', async () => {
  const { render } = await import('./screen/render.mjs');
  const model = interactionModel();
  model.notes = [];
  model.batches = [];
  model.questions = [{ ...model.questions[0], content: { question: 'Choose a plan?', options: ['alpha', 'beta'], recommend: 'A' } }];
  const options = { cols: 48, rows: 100, locale: 'en', now: 0 };
  const detailed = render(model, { ...options, cardMode: 'detailed' });
  const compact = render(model, { ...options, cardMode: 'compact' });
  const landmarks = async ui => {
    const cells = await Promise.all(ui.styled.map(styledCells));
    const locate = text => {
      for (let row = 0; row < cells.length; row++) {
        const col = cells[row].findIndex((_, i) => cells[row].slice(i, i + text.length).map(cell => cell.text).join('') === text);
        if (col >= 0) return { row, col };
      }
      assert.fail(`missing visible landmark ${text}`);
    };
    const point = type => {
      const h = ui.hits.find(h => h.action.uid === 'Q1' && h.action.type === type);
      assert.ok(h, `missing ${type} control`);
      return { row: h.row, col: h.c0 };
    };
    return {
      header: locate('Q1 ·'), answer: locate('Answer:'),
      letters: ['A', 'B'].map(choice => {
        const h = ui.hits.find(h => h.action.type === 'choose' && h.action.choice === choice);
        assert.ok(h);
        return { row: h.row, col: cells[h.row].findIndex((cell, col) => col >= h.c0 && col < h.c1 && cell.text === choice) };
      }),
      star: locate('★'), recommend: point('recommend'), explain: point('explain'),
      void: point('void'), field: point('note-text'),
    };
  };
  assert.deepEqual(await landmarks(compact), await landmarks(detailed), 'short content keeps the same header, letters, star, controls, answer and field coordinates');
  const question = `${'questiontoken '.repeat(12)}questionend`;
  const texts = [`${'alpha '.repeat(10)}alphaend`, `${'beta '.repeat(12)}betaend`];
  model.questions[0].content = { question, options: texts, recommend: 'A' };
  // Long compact content may move later controls up; only the short fixture compares absolute row positions.
  const full = render(model, { ...options, cardMode: 'detailed' });
  const shortened = render(model, { ...options, cardMode: 'compact' });
  const questionLines = shortened.lines.filter(line => line.includes('questiontoken') || line.includes('questionend'));
  assert.equal(questionLines.length, 3, 'a long compact question occupies only three rows');
  assert.ok(questionLines[2].trimEnd().endsWith('…'));
  assert.ok(full.lines.filter(line => line.includes('questiontoken') || line.includes('questionend')).length > 3, 'detailed mode retains the full question');
  assert.ok(full.lines.some(line => line.includes('questionend')));
  for (const [i, choice] of ['A', 'B'].entries()) {
    const h = shortened.hits.find(h => h.action.type === 'choose' && h.action.choice === choice);
    assert.ok(h);
    const token = i ? 'beta' : 'alpha';
    assert.equal(shortened.lines.filter(line => line.includes(token)).length, 1, 'each long compact option is limited to one row');
    assert.ok(shortened.lines[h.row].trimEnd().endsWith('…'));
    assert.ok(full.lines.some(line => line.includes(`${token}end`)), 'detailed mode retains the option ending');
    const tip = shortened.tips.find(t => t.text === texts[i]);
    assert.ok(tip, 'the truncated option exposes its full original text');
    const popup = render(model, { ...options, cardMode: 'compact', tooltip: { x: tip.c0 + 1, y: tip.row + 1 } });
    assert.ok(popup.lines.some(line => line.includes(`${token}end`)), 'the option tooltip renders the previously hidden ending');
  }
  const tip = shortened.tips.find(t => t.text === question);
  assert.ok(tip, 'the truncated question exposes its full original text');
  const popup = render(model, { ...options, cardMode: 'compact', tooltip: { x: tip.c0 + 1, y: tip.row + 1 } });
  assert.ok(popup.lines.some(line => line.includes('questionend')), 'the question tooltip renders the hidden ending');
});

test('202/AC-36 every row of a wrapped option shares hover and selection without capturing another option or the gaps', async () => {
  const { render } = await import('./screen/render.mjs');
  const { parseInput } = await import('./screen/input.mjs');
  const { perform } = await import('./screen/actions.mjs');
  const model = interactionModel();
  model.notes = [];
  model.batches = [];
  const long = 'abcdefghij'.repeat(6);
  model.questions = [{ ...model.questions[0], content: { question: 'Choose an option?', options: [long, 'short'], recommend: 'A' } }];
  const options = { cols: 32, rows: 60, cardMode: 'detailed', locale: 'en', now: 0 };
  const plain = render(model, options);
  const first = plain.hits.find(h => h.action.type === 'choose' && h.action.choice === 'A');
  const other = plain.hits.find(h => h.action.type === 'choose' && h.action.choice === 'B');
  assert.ok(first && other);
  const firstCells = await styledCells(plain.styled[first.row]);
  const textCol = firstCells.findIndex((cell, col) => col >= first.c0 && /[a-z]/.test(cell.text));
  assert.ok(textCol >= first.c0);
  const rows = [first.row, first.row + 1, first.row + 2];
  const chunks = await Promise.all(rows.map(async row => (await styledCells(plain.styled[row])).slice(textCol).map(cell => cell.text).join('').trim()));
  assert.ok(chunks.every(Boolean) && other.row > rows[2], 'the first option really occupies three visible rows');
  assert.equal(chunks.join(''), long);
  const styles = async (ui, row) => (await styledCells(ui.styled[row])).slice(first.c0, first.c1).map(cell => cell.style);
  let firstHover;
  for (const row of [rows[0], rows[2]]) {
    const [move] = parseInput(`\x1b[<35;${textCol + 1};${row + 1}M`);
    assert.equal(move.kind, 'move');
    const over = render(model, { ...options, hover: { x: move.x, y: move.y } });
    for (const targetRow of rows) {
      assert.notDeepEqual(await styles(over, targetRow), await styles(plain, targetRow), 'hovering any line highlights all three option rows');
      if (firstHover) assert.deepEqual(await styles(over, targetRow), await styles(firstHover, targetRow), 'the first and third rows refer to the same hover group');
    }
    assert.equal(over.styled[other.row], plain.styled[other.row], 'the other option does not change style');
    firstHover ??= over;
  }
  const at = event => plain.hits.find(h => h.row === event.y - 1 && h.c0 <= event.x - 1 && event.x - 1 < h.c1);
  for (const row of [rows[1], rows[2]]) {
    const [event] = parseInput(`\x1b[<0;${textCol + 1};${row + 1}M`);
    assert.equal(event.kind, 'click');
    const clicked = at(event);
    assert.ok(clicked, 'continuation text is clickable');
    assert.equal(clicked.action.type, 'choose');
    assert.equal(clicked.action.uid, model.questions[0].uid);
    assert.equal(clicked.action.choice, 'A');
    const requests = [];
    const result = await perform(clicked.action, {
      call: async req => { requests.push(req); return { ok: true }; },
      run: async () => ({ ok: true }), generation: model.mailbox.generation,
    });
    assert.equal(result.ok, true);
    assert.equal(requests[0].op, 'answer');
    assert.equal(requests[0].uid, model.questions[0].uid);
    assert.equal(requests[0].choice, 'A');
  }
  const isFirstOption = h => h?.action.type === 'choose' && h.action.uid === model.questions[0].uid && h.action.choice === 'A';
  for (let row = rows[2] + 1; row < other.row; row++) {
    assert.equal(isFirstOption(at({ x: textCol + 1, y: row + 1 })), false, 'any gap between options is outside the first option');
  }
  assert.equal(isFirstOption(at({ x: first.c0, y: first.row + 1 })), false, 'the margin outside the option hit is not captured');
  const next = at({ x: other.c0 + 1, y: other.row + 1 });
  assert.equal(isFirstOption(next), false, 'the next option row is outside the first option');
  assert.equal(next?.action.choice, 'B');
});

test('202/AC-37 Settings opens and saves inside the mailbox pane, shields background cards and restores the view on Escape', async () => {
  const { parseInput } = await import('./screen/input.mjs');
  const { createEventQueue } = await import('./screen/events.mjs');
  const model = interactionModel();
  model.notes = [];
  model.batches = [];
  let prefs = { width: 48, cardMode: 'detailed', mergeSeconds: 60 };
  model.prefs = { ...prefs };
  const drafts = { Q1: 'Keep this draft' };
  const savedDrafts = structuredClone(drafts);
  const options = { cols: 80, rows: 40, locale: 'en', now: 0, scroll: 0, drafts };
  const ui = await overlayScreen(model, options, async req => {
    if (req.op === 'prefs-get') return { ok: true, ...prefs };
    assert.equal(req.op, 'prefs-set');
    prefs = { ...prefs, width: req.width ?? prefs.width, cardMode: req.cardMode ?? prefs.cardMode, mergeSeconds: req.mergeSeconds ?? prefs.mergeSeconds };
    return { ok: true, ...prefs };
  });
  const before = ui.frame();
  assert.equal((await ui.act(hit(before, 'settings'))).ok, true);
  assert.equal(ui.commands.some(args => args.includes('popup')), false, 'Settings never asks herdr to open a popup');
  assert.equal(ui.overlay()?.kind, 'settings');
  const opened = ui.frame();
  const text = opened.lines.join('\n');
  assert.match(text, /Mailbox settings|Settings/);
  assert.match(text, /Width/);
  assert.match(text, /Card mode/);
  assert.match(text, /Merge interval/);
  assert.equal(opened.hits.some(h => ['choose', 'submit', 'void', 'note-text'].includes(h.action.type)), false, 'only the modal controls are clickable');
  const change = hit(opened, 'settings-set', a => a.change?.width === 52);
  assert.equal((await ui.act(change)).ok, true);
  assert.equal(prefs.width, 52);
  assert.ok(ui.requests.some(req => req.op === 'prefs-set' && req.width === 52), 'a setting change is persisted through the daemon op');
  assert.ok(ui.frame().lines.some(line => /\b52\b/.test(line)), 'the saved value is displayed');
  // Reuse a background card coordinate: the modal hit table must not dispatch its choice action.
  const background = before.hits.find(h => h.action.type === 'choose');
  assert.ok(background);
  const queue = createEventQueue({
    getUI: () => ui.frame(),
    onEvent: async (event, action) => { if (action) await ui.act(action); },
  });
  const [outside] = parseInput(`\x1b[<0;${background.c0 + 1};${background.row + 1}M`);
  await queue.enqueue(outside);
  const [typed] = parseInput('do not edit the background draft');
  assert.equal((await ui.input(typed)).ok, true);
  assert.equal(ui.requests.some(req => ['answer', 'submit'].includes(req.op)), false, 'modal clicks and keys never write background answers');
  assert.deepEqual(drafts, savedDrafts);
  const [escape] = parseInput('\x1b');
  assert.equal(escape.name, 'escape');
  assert.equal((await ui.input(escape)).ok, true);
  assert.equal(ui.overlay(), null);
  const restored = ui.frame();
  assert.equal(restored.scroll, before.scroll);
  assert.deepEqual(restored.lines, before.lines);
  assert.deepEqual(restored.hits, before.hits);
  assert.deepEqual(drafts, savedDrafts);
  assert.equal(ui.commands.some(args => args.includes('popup')), false);
});

test('202/AC-19 clickable button labels do not use square brackets', async () => {
  const { render } = await import('./screen/render.mjs');
  for (const cardMode of ['detailed', 'compact']) {
    const ui = render(interactionModel(), { cols: 80, rows: 100, cardMode, now: 0 });
    assert.ok(ui.hits.some(h => h.action.type === 'choose'));
    assert.ok(ui.hits.some(h => h.action.type === 'settings'));
    for (const target of ui.hits) {
      const cells = await styledCells(ui.styled[target.row]);
      const label = cells.slice(target.c0, target.c1).map(cell => cell.text).join('');
      assert.doesNotMatch(label, /[\[\]]/, `${cardMode}: ${target.action.type} uses a button style rather than bracketed text`);
    }
  }
});

test('202/AC-28 resting on cut-off text shows its full text in a box under it, or above it when there is no room below', async () => {
  const { render } = await import('./screen/render.mjs');
  const model = interactionModel();
  const full = `A long note that cannot fit ${'in one narrow row '.repeat(2)}END`;
  model.notes = [{ uid: 'long', senderLabel: 'worker', text: full }];
  const options = { cols: 32, rows: 60, now: 0 };
  const plain = render(model, options);
  const tip = plain.tips.find(t => t.text.includes('END'));
  assert.ok(tip, 'the cut-off message is marked with its full text');
  assert.ok(plain.lines[tip.row].includes('…') && !plain.lines[tip.row].includes('END'), 'the row itself is cut');
  const box = render(model, { ...options, tooltip: { x: tip.c0 + 2, y: tip.row + 1 } });
  const below = box.lines.slice(tip.row + 1).join(' ').replace(/\s+/g, ' ');
  assert.ok(below.includes('in one narrow row') && below.includes('END'), 'the full text appears right under the item');
  assert.ok(box.lines.every(line => line.length <= 32), 'the box wraps to the screen width');
  const tight = render(model, { ...options, rows: tip.row + 2, tooltip: { x: tip.c0 + 2, y: tip.row + 1 } });
  assert.ok(tight.lines.slice(0, tip.row).join(' ').includes('END'), 'with no room below the box goes above');
});
