import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { sessionKey } from './paths.mjs';
import { guardDaemon } from './test-support/daemon-sandbox.cjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const FAKE = path.join(here, 'test-support', 'fake-herdr.mjs');
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function until(fn, what, ms = 8000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) assert.fail(`timed out waiting for ${what}`);
    await sleep(50);
  }
}

const pane = (id, terminal, sid, extra = {}) => ({
  pane_id: id, terminal_id: terminal, workspace_id: id.split(':')[0], tab_id: `${id.split(':')[0]}:t1`, label: id,
  agent: 'claude', agent_status: 'idle', agent_session: { value: sid }, ...extra,
});

// Real CLI and daemon against the fake herdr. The receiver is w1:p1 in conversation sid-1; w2:p2 sends;
// w4:p4 and w5:p5 are agents that may claim.
function rig(timings = {}) {
  const root = fs.mkdtempSync(path.join('/tmp', 'mbid-'));
  const socket = path.join(root, 'herdr.sock');
  const stateFile = path.join(root, 'herdr-state.json');
  const dir = path.join(root, sessionKey(socket));
  const env = {
    ...process.env, HERDR_MAILBOX_STATE_DIR: root, HERDR_SOCKET_PATH: socket, HERDR_BIN_PATH: FAKE,
    FAKE_HERDR_STATE: stateFile, FAKE_HERDR_LOG: path.join(root, 'herdr.log'), HERDR_PANE_ID: 'w2:p2',
    HERDR_MAILBOX_TIMINGS: JSON.stringify({ reconcileMs: 100, registerGraceMs: 600, tickMs: 100, ...timings }),
  };
  delete env.HERDR_PLUGIN_STATE_DIR;
  delete env.HERDR_PLUGIN_ID;
  delete env.HERDR_MAILBOX_SID;
  guardDaemon(env, root);
  const fake = {
    panes: [pane('w1:p1', 't1', 'sid-1'), pane('w2:p2', 't2', 'sid-2'), pane('w4:p4', 't4', 'sid-4'), pane('w5:p5', 't5', 'sid-5')],
    screens: {}, promptResult: {}, transcripts: {},
  };
  const write = () => fs.writeFileSync(stateFile, JSON.stringify(fake));
  write();
  const cli = (args, extra = {}) => {
    const r = spawnSync(process.execPath, [path.join(here, 'mailbox.mjs'), ...args], { env: { ...env, ...extra }, encoding: 'utf8' });
    return { code: r.status, out: r.stdout.trim() ? JSON.parse(r.stdout) : null, err: r.stderr };
  };
  const cliAsync = (args, extra = {}) => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(here, 'mailbox.mjs'), ...args], { env: { ...env, ...extra } });
    let out = '';
    let err = '';
    child.stdout.on('data', data => { out += data; });
    child.stderr.on('data', data => { err += data; });
    child.on('error', reject);
    child.on('close', code => {
      try { resolve({ code, out: out.trim() ? JSON.parse(out) : null, err }); }
      catch (error) { reject(error); }
    });
  });
  // The SessionStart hook: stdin JSON in, nothing out.
  const sessionStart = (paneId, sid, source) => spawnSync(process.execPath, [path.join(here, 'session-start.mjs')], {
    env: { ...env, HERDR_PANE_ID: paneId, CLAUDE_ENV_FILE: path.join(root, 'claude-env') }, encoding: 'utf8',
    input: JSON.stringify({ hook_event_name: 'SessionStart', session_id: sid, source, transcript_path: path.join(root, `${sid}.jsonl`) }),
  });
  const raw = msg => new Promise((resolve, reject) => {
    const c = net.connect(path.join(dir, 'd.sock'));
    let buf = '';
    c.on('connect', () => c.write(`${JSON.stringify({ proto: 1, ...msg })}\n`));
    c.on('data', d => { buf += d; });
    c.on('end', () => resolve(JSON.parse(buf)));
    c.on('error', reject);
  });
  const state = () => JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8'));
  const stop = () => { try { process.kill(Number(fs.readFileSync(path.join(dir, 'daemon.pid'), 'utf8')), 'SIGKILL'); } catch { /* not running */ } };
  const cleanup = () => { stop(); fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); };
  const R = { root, env, fake, write, cli, cliAsync, sessionStart, raw, state, cleanup };
  // The main conversation of w1:p1 registers and binds its mailbox; returns the mailbox id.
  R.bindReceiver = async () => {
    const started = cli(['status']); // starts the daemon
    assert.equal(started.code, 0, JSON.stringify(started));
    const registered = sessionStart('w1:p1', 'sid-1', 'startup');
    assert.equal(registered.status, 0, registered.stderr);
    assert.equal(registered.stdout, '');
    const r = await raw({ op: 'bind', pane: 'w1:p1', caller: { pane: 'w1:p1', sid: 'sid-1', viaPlugin: false } });
    assert.equal(r.ok, true, JSON.stringify(r));
    return Object.keys(R.state().mailboxes)[0];
  };
  R.mb = id => R.state().mailboxes[id];
  // Screen writes carry the generation displayed to the user.
  R.screen = (id, msg) => R.raw({ ...msg, mailbox: id, generation: R.mb(id).owner.generation, caller: { viaPlugin: true } });
  R.disconnect = async id => {
    R.fake.panes = R.fake.panes.filter(p => p.pane_id !== 'w1:p1');
    R.write();
    await until(() => R.mb(id).state === 'disconnected', 'the mailbox to disconnect');
  };
  return R;
}

// Cards come from the receiver itself, so the default sender is the receiver pane.
const sendDecision = (R, id, from = 'w1:p1', sid = 'sid-1') => R.cli(['send', '--to', id, '--type', 'decision', '--question', 'Install it?', '--option', 'yes', '--option', 'no', '--tradeoff', 'faster but costs more', '--tradeoff', 'cheaper but slower', '--why-open', 'no rule covers it', '--recommend', 'a', '--source', 'test'], { HERDR_PANE_ID: from, HERDR_MAILBOX_SID: sid });
const sendNote = (R, id, text, extra) => R.cli(['send', '--to', id, '--type', 'note', text], extra);

test('200/AC-1 moving the receiver pane to another space keeps the mailbox, its letters and its draft', async () => {
  const R = rig();
  try {
    const id = await R.bindReceiver();
    const q = sendDecision(R, id).out;
    const note = sendNote(R, id, 'tests pass').out;
    await R.screen(id, { op: 'answer', uid: q.uid, version: 1, choice: 'B' });
    const before = JSON.stringify([R.state().letters[q.uid], R.state().letters[note.uid]]);
    R.fake.panes[0].pane_id = 'w3:p1'; // same terminal, new address
    R.write();
    await until(() => R.mb(id).owner.pane === 'w3:p1', 'the owner to follow the terminal');
    assert.equal(R.mb(id).state, 'connected');
    assert.equal(JSON.stringify([R.state().letters[q.uid], R.state().letters[note.uid]]), before);
    assert.equal(R.state().letters[q.uid].draft.choice, 'B');
  } finally { R.cleanup(); }
});

test('200/AC-2 after a herdr restart the same pane in the same conversation is reattached', async () => {
  const R = rig();
  try {
    const id = await R.bindReceiver();
    R.fake.panes[0].terminal_id = 't-new'; // restart: new terminal, same pane id, same conversation
    R.write();
    await until(() => R.mb(id).owner.terminalId === 't-new', 'the new terminal id to be adopted');
    assert.equal(R.mb(id).state, 'connected');
    assert.equal(R.mb(id).owner.convo, 'sid-1');
    assert.equal(R.mb(id).disconnect, null);
  } finally { R.cleanup(); }
});

test('200/AC-2 after a restart an empty agent session may recover within the grace period without disconnecting', async () => {
  const R = rig();
  const timings = { ...JSON.parse(R.env.HERDR_MAILBOX_TIMINGS), registerGraceMs: 2000 };
  R.env.HERDR_MAILBOX_TIMINGS = JSON.stringify(timings);
  try {
    const id = await R.bindReceiver();
    const listCalls = () => fs.existsSync(R.env.FAKE_HERDR_LOG)
      ? fs.readFileSync(R.env.FAKE_HERDR_LOG, 'utf8').trim().split('\n').filter(Boolean)
        .map(line => JSON.parse(line)).filter(call => call.argv[0] === 'pane' && call.argv[1] === 'list').length
      : 0;
    const before = listCalls();
    const emptyAt = Date.now();
    R.fake.panes[0].terminal_id = 't-new';
    R.fake.panes[0].agent_session = { value: null };
    R.write();
    // Observe two reconciles so restoring the sid cannot hide an immediate mismatch rejection.
    await until(() => listCalls() >= before + 2, 'reconcile to observe the empty session');
    await R.raw({ op: 'ping' }); // queued behind reconciliation
    assert.equal(R.mb(id).state, 'connected');
    assert.equal(R.mb(id).disconnect, null);
    if (Date.now() - emptyAt >= timings.registerGraceMs) throw new Error('test did not restore the session within the grace period');
    R.fake.panes[0].agent_session = { value: 'sid-1' };
    R.write();
    await until(() => R.mb(id).owner.terminalId === 't-new', 'the recovered receiver to reattach');
    assert.equal(R.mb(id).state, 'connected');
    assert.equal(R.mb(id).owner.convo, 'sid-1');
    assert.equal(R.mb(id).disconnect, null);
  } finally { R.cleanup(); }
});

// PM approved a third AC-2 case for temporary absence during restart.
test('200/AC-2 restart tolerates an empty conversation beyond the grace period and a missing pane that returns within it', async () => {
  const R = rig();
  const timings = { ...JSON.parse(R.env.HERDR_MAILBOX_TIMINGS), registerGraceMs: 2000 };
  R.env.HERDR_MAILBOX_TIMINGS = JSON.stringify(timings);
  try {
    const id = await R.bindReceiver();
    const listCalls = () => fs.existsSync(R.env.FAKE_HERDR_LOG)
      ? fs.readFileSync(R.env.FAKE_HERDR_LOG, 'utf8').trim().split('\n').filter(Boolean)
        .map(line => JSON.parse(line)).filter(call => call.argv[0] === 'pane' && call.argv[1] === 'list').length
      : 0;
    const beforeEmpty = listCalls();
    R.fake.panes[0].terminal_id = 't-empty-restart';
    R.fake.panes[0].agent_session = { value: null };
    R.write();
    await until(() => listCalls() >= beforeEmpty + 2, 'reconcile to observe the empty restart identity');
    // An empty identity is not evidence of another conversation, even after a full grace period.
    await sleep(timings.registerGraceMs + 2 * timings.reconcileMs);
    await R.raw({ op: 'ping' });
    assert.equal(R.mb(id).state, 'connected');
    assert.equal(R.mb(id).disconnect, null);
    assert.equal(R.mb(id).owner.convo, 'sid-1');
    R.fake.panes[0].agent_session = { value: 'sid-1' };
    R.write();
    await until(() => R.mb(id).owner.terminalId === 't-empty-restart', 'the original conversation to reattach');
    assert.equal(R.mb(id).state, 'connected');
    assert.equal(R.mb(id).disconnect, null);

    const receiver = { ...R.fake.panes[0], terminal_id: 't-pane-restart' };
    const beforeMissing = listCalls();
    const missingAt = Date.now();
    R.fake.panes = R.fake.panes.filter(p => p.pane_id !== receiver.pane_id);
    R.write();
    await until(() => listCalls() >= beforeMissing + 2, 'reconcile to observe the temporarily missing pane');
    await R.raw({ op: 'ping' });
    assert.equal(R.mb(id).state, 'connected');
    assert.equal(R.mb(id).disconnect, null);
    if (Date.now() - missingAt >= timings.registerGraceMs) throw new Error('test did not restore the pane within the grace period');
    R.fake.panes.push(receiver);
    R.write();
    await until(() => R.mb(id).owner.terminalId === 't-pane-restart', 'the original pane to reattach');
    assert.equal(R.mb(id).state, 'connected');
    assert.equal(R.mb(id).owner.pane, 'w1:p1');
    assert.equal(R.mb(id).owner.convo, 'sid-1');
    assert.equal(R.mb(id).disconnect, null);
  } finally { R.cleanup(); }
});

test('200/AC-3 after a restart with another conversation the mailbox is disconnected and says how to claim', async () => {
  const R = rig();
  try {
    const id = await R.bindReceiver();
    R.fake.panes[0].terminal_id = 't-new';
    R.fake.panes[0].agent_session = { value: 'sid-other' };
    R.write();
    await until(() => R.mb(id).state === 'disconnected', 'the mailbox to disconnect');
    assert.equal(R.mb(id).disconnect.reason, 'restart_mismatch');
    const status = R.cli(['status', '--to', id]).out;
    assert.equal(status.mailboxState.state, 'disconnected');
    assert.equal(status.mailboxState.claim, `mailbox claim ${id}`);
    const receipt = sendNote(R, id, 'anyone there').out;
    assert.equal(receipt.mailboxState.claim, `mailbox claim ${id}`);
    assert.equal(receipt.mailboxState.state, 'disconnected');
    assert.equal(R.cli(['status', '--to', id]).out.mailboxState.reason, 'restart_mismatch');
  } finally { R.cleanup(); }
});

test('200/AC-3 after a restart with a different pane and terminal the mailbox disconnects and says how to claim', async () => {
  const R = rig();
  try {
    const id = await R.bindReceiver();
    // The conversation alone cannot identify the receiver after both location handles change.
    R.fake.panes[0] = pane('w3:p3', 't-new', 'sid-1');
    R.write();
    await until(() => R.mb(id).state === 'disconnected', 'the unmatched receiver to disconnect');
    const status = R.cli(['status', '--to', id]);
    assert.equal(status.code, 0);
    assert.equal(status.out.mailboxState.state, 'disconnected');
    assert.equal(status.out.mailboxState.claim, `mailbox claim ${id}`);
    const receipt = sendNote(R, id, 'waiting for a new receiver');
    assert.equal(receipt.code, 0);
    assert.equal(receipt.out.mailboxState.state, 'disconnected');
    assert.equal(receipt.out.mailboxState.claim, `mailbox claim ${id}`);
  } finally { R.cleanup(); }
});

test('200/AC-4 a resume or compact of the same conversation keeps the binding; a clear moves it to the new conversation', async () => {
  const R = rig();
  try {
    const id = await R.bindReceiver();
    for (const source of ['compact', 'resume']) {
      // Exercise the identity grace period before herdr reports the resumed conversation again.
      R.fake.panes[0].agent_session = { value: `sid-transient-${source}` };
      R.write();
      await sleep(200); // reconcileMs < this delay < registerGraceMs
      R.fake.panes[0].agent_session = { value: 'sid-1' };
      R.write();
      const registered = R.sessionStart('w1:p1', 'sid-1', source);
      assert.equal(registered.status, 0, registered.stderr);
      await until(() => R.state().registrations['w1:p1'].some(r => r.sid === 'sid-1' && r.source === source), `${source} registration`);
      await sleep(200);
      assert.equal(R.mb(id).state, 'connected');
      assert.equal(R.mb(id).owner.convo, 'sid-1');
    }
    R.sessionStart('w1:p1', 'sid-1b', 'clear');
    R.fake.panes[0].agent_session = { value: 'sid-1b' };
    R.write();
    await until(() => R.mb(id).owner.convo === 'sid-1b', 'the clear to be followed');
    assert.equal(R.mb(id).state, 'connected');
  } finally { R.cleanup(); }
});

test('200/AC-5 an unrelated conversation in the receiver pane disconnects the mailbox', async () => {
  const R = rig();
  try {
    const id = await R.bindReceiver();
    R.sessionStart('w1:p1', 'sid-new', 'startup');
    R.fake.panes[0].agent_session = { value: 'sid-new' };
    R.write();
    await until(() => R.mb(id).state === 'disconnected', 'the mailbox to disconnect');
    assert.equal(R.mb(id).disconnect.reason, 'other_conversation');
    assert.equal(R.mb(id).owner.convo, 'sid-1');
    const receipt = sendNote(R, id, 'wait until the mailbox is claimed');
    assert.equal(receipt.code, 0);
    assert.equal(receipt.out.mailboxState.state, 'disconnected');
    assert.equal(R.cli(['status', '--to', id]).out.mailboxState.state, 'disconnected');
  } finally { R.cleanup(); }
});

test('200/AC-5 a previous resume registration does not keep an unregistered different conversation connected beyond the grace period', async () => {
  const R = rig();
  try {
    const id = await R.bindReceiver();
    const registered = R.sessionStart('w1:p1', 'sid-1', 'resume');
    assert.equal(registered.status, 0, registered.stderr);
    await until(() => R.state().registrations['w1:p1'].some(r => r.sid === 'sid-1' && r.source === 'resume'), 'the previous resume registration');
    R.fake.panes[0].agent_session = { value: 'sid-unregistered' };
    R.write();
    const { registerGraceMs, reconcileMs } = JSON.parse(R.env.HERDR_MAILBOX_TIMINGS);
    await sleep(registerGraceMs + 2 * reconcileMs);
    await until(() => R.mb(id).state === 'disconnected', 'the unregistered conversation to exceed its grace period');
    assert.equal(R.mb(id).disconnect.reason, 'other_conversation');
    assert.equal(R.mb(id).owner.convo, 'sid-1');
    const receipt = sendNote(R, id, 'keep this queued for the claimed receiver');
    assert.equal(receipt.code, 0);
    assert.equal(receipt.out.mailboxState.state, 'disconnected');
    const status = R.cli(['status', '--to', id]);
    assert.equal(status.code, 0);
    assert.equal(status.out.mailboxState.state, 'disconnected');
    assert.equal(status.out.mailboxState.reason, 'other_conversation');
  } finally { R.cleanup(); }
});

test('200/AC-6 closing the receiver pane disconnects the mailbox and keeps letters, questions and the draft', async () => {
  const R = rig();
  try {
    const id = await R.bindReceiver();
    const q = sendDecision(R, id).out;
    const note = sendNote(R, id, 'queued note').out;
    await R.screen(id, { op: 'answer', uid: q.uid, version: 1, choice: 'A' });
    await R.disconnect(id);
    assert.equal(R.mb(id).disconnect.reason, 'pane_closed');
    const letters = R.state().letters;
    assert.equal(letters[q.uid].status, 'pending');
    assert.equal(letters[q.uid].draft.choice, 'A');
    assert.equal(letters[note.uid].status, 'queued');
    assert.equal(letters[note.uid].mailbox, id);
  } finally { R.cleanup(); }
});

test('200/AC-7 two agents claiming one disconnected mailbox at once: one wins, the other hears already claimed', async () => {
  const R = rig();
  try {
    const id = await R.bindReceiver();
    await R.disconnect(id);
    const env = pane => ({ HERDR_PANE_ID: pane, HERDR_MAILBOX_SID: pane === 'w4:p4' ? 'sid-4' : 'sid-5' });
    const results = await Promise.all(['w4:p4', 'w5:p5'].map(p => R.cliAsync(['claim', id], env(p))));
    const ok = results.filter(r => r.out.ok);
    const lost = results.filter(r => !r.out.ok);
    assert.equal(ok.length, 1);
    assert.equal(lost.length, 1);
    assert.equal(lost[0].out.error, 'already_claimed');
    assert.notEqual(lost[0].code, 0);
  } finally { R.cleanup(); }
});

test('200/AC-8 after a claim the new receiver owns the letters and the old receiver can no longer operate the mailbox', async () => {
  const R = rig();
  try {
    const id = await R.bindReceiver();
    const note = sendNote(R, id, 'still waiting').out;
    const question = sendDecision(R, id).out;
    const gen = R.mb(id).owner.generation;
    await R.disconnect(id);
    const claim = R.cli(['claim', id], { HERDR_PANE_ID: 'w4:p4', HERDR_MAILBOX_SID: 'sid-4' });
    assert.equal(claim.out.ok, true, JSON.stringify(claim.out));
    assert.equal(R.mb(id).state, 'connected');
    assert.equal(R.mb(id).owner.pane, 'w4:p4');
    assert.equal(R.mb(id).owner.generation, gen + 1);
    assert.equal(R.state().letters[note.uid].mailbox, id);
    assert.equal(R.state().letters[question.uid].status, 'pending');
    assert.equal(R.state().letters[question.uid].mailbox, id);
    const old = await R.raw({ op: 'close', mailbox: id, caller: { pane: 'w1:p1', sid: 'sid-1', viaPlugin: false } });
    assert.equal(old.error, 'not_owner');
    const stale = await R.raw({ op: 'close', mailbox: id, generation: gen, caller: { viaPlugin: true } });
    assert.equal(stale.error, 'stale_owner');
  } finally { R.cleanup(); }
});

test('200/AC-9 a claim keeps the PO draft but a submit needs the PO to confirm again', async () => {
  const R = rig();
  try {
    const id = await R.bindReceiver();
    const q = sendDecision(R, id).out;
    await R.screen(id, { op: 'answer', uid: q.uid, version: 1, choice: 'B' });
    await R.disconnect(id);
    R.cli(['claim', id], { HERDR_PANE_ID: 'w4:p4', HERDR_MAILBOX_SID: 'sid-4' });
    assert.equal(R.state().letters[q.uid].draft.choice, 'B');
    assert.equal(R.state().letters[q.uid].draft.reconfirm, true);
    const refused = await R.screen(id, { op: 'submit', items: [{ uid: q.uid, version: 1 }] });
    assert.equal(refused.results?.[0]?.error ?? refused.error, 'needs_reconfirm');
    assert.equal(R.state().letters[q.uid].status, 'pending');
    await R.screen(id, { op: 'answer', uid: q.uid, version: 1, choice: 'B', confirm: true });
    const sent = await R.screen(id, { op: 'submit', items: [{ uid: q.uid, version: 1 }] });
    assert.equal(sent.results?.[0]?.ok ?? sent.ok, true);
  } finally { R.cleanup(); }
});

test('200/AC-10 a sender who writes after the receiver changed is told once, in the receipt', async () => {
  const R = rig();
  try {
    const id = await R.bindReceiver();
    assert.equal(sendNote(R, id, 'first').out.ownerChanged, undefined);
    await R.disconnect(id);
    R.cli(['claim', id], { HERDR_PANE_ID: 'w4:p4', HERDR_MAILBOX_SID: 'sid-4' });
    const after = sendNote(R, id, 'second').out;
    assert.ok(after.ownerChanged, JSON.stringify(after));
    assert.notDeepEqual(after.ownerChanged.from, after.ownerChanged.to);
    assert.equal(sendNote(R, id, 'third').out.ownerChanged, undefined);
  } finally { R.cleanup(); }
});

test('200/AC-11 a nested Claude sharing the pane cannot rebind the mailbox or act as its receiver', async () => {
  const R = rig();
  try {
    const id = await R.bindReceiver();
    R.sessionStart('w1:p1', 'sid-nested', 'startup'); // herdr still reports the main conversation
    await sleep(500);
    assert.equal(R.mb(id).state, 'connected');
    assert.equal(R.mb(id).owner.convo, 'sid-1');
    const nested = { pane: 'w1:p1', sid: 'sid-nested', viaPlugin: false };
    assert.equal((await R.raw({ op: 'close', mailbox: id, caller: nested })).error, 'not_owner');
    assert.equal((await R.raw({ op: 'bind', pane: 'w1:p1', caller: nested })).error, 'not_owner');
    assert.equal(R.mb(id).owner.convo, 'sid-1');
  } finally { R.cleanup(); }
});

test('206/AC-2 status --to a pane names its own mailbox even when nothing is pending', async () => {
  const R = rig();
  try {
    const id = await R.bindReceiver();
    const res = R.cli(['status', '--to', 'w1:p1']);
    assert.equal(res.code, 0, JSON.stringify(res));
    assert.equal(res.out.mailbox, id);
    assert.deepEqual(res.out.mailboxes, []);
  } finally { R.cleanup(); }
});

test('206/AC-2 status --to a pane without a mailbox reports no mailbox', async () => {
  const R = rig();
  try {
    await R.bindReceiver();
    const res = R.cli(['status', '--to', 'w4:p4']);
    assert.equal(res.code, 0, JSON.stringify(res));
    assert.equal(res.out.mailbox, undefined);
  } finally { R.cleanup(); }
});

test('309/AC-1 the receiver releases its mailbox and another agent claims it at once, while the old pane is still there', async () => {
  const R = rig();
  try {
    const id = await R.bindReceiver();
    const note = sendNote(R, id, 'queued before the handover').out;
    const gen = R.mb(id).owner.generation;
    const released = R.cli(['release'], { HERDR_PANE_ID: 'w1:p1', HERDR_MAILBOX_SID: 'sid-1' });
    assert.equal(released.out.ok, true, JSON.stringify(released));
    assert.equal(R.mb(id).state, 'disconnected');
    assert.ok(R.fake.panes.some(p => p.pane_id === 'w1:p1'), 'the old pane is still open');
    const claim = R.cli(['claim', id], { HERDR_PANE_ID: 'w4:p4', HERDR_MAILBOX_SID: 'sid-4' });
    assert.equal(claim.out.ok, true, JSON.stringify(claim));
    assert.equal(R.mb(id).owner.pane, 'w4:p4');
    assert.equal(R.mb(id).owner.generation, gen + 1);
    assert.equal(R.state().letters[note.uid].mailbox, id);
    assert.equal(Object.keys(R.state().mailboxes).length, 1);
  } finally { R.cleanup(); }
});

test('309/AC-2 only the current receiver can release; anyone else is refused and the mailbox stays connected', async () => {
  const R = rig();
  try {
    const id = await R.bindReceiver();
    const other = R.cli(['release', id], { HERDR_PANE_ID: 'w4:p4', HERDR_MAILBOX_SID: 'sid-4' });
    assert.equal(other.out.error, 'not_owner');
    assert.equal(R.mb(id).state, 'connected');
    const twice = R.cli(['release'], { HERDR_PANE_ID: 'w1:p1', HERDR_MAILBOX_SID: 'sid-1' });
    assert.equal(twice.out.ok, true);
    const again = R.cli(['release', id], { HERDR_PANE_ID: 'w1:p1', HERDR_MAILBOX_SID: 'sid-1' });
    assert.equal(again.out.ok, false);
  } finally { R.cleanup(); }
});

// The receiver pane runs `mailbox renew`; the sender is w2:p2.
const RECEIVER = { HERDR_PANE_ID: 'w1:p1', HERDR_MAILBOX_SID: 'sid-1' };
const EMPTY_BOX = '────────────\n❯ \n────────────';

test('672.3/AC-1 release --next queues notes addressed to the successor before it claims', async () => {
  const R = rig();
  try {
    const id = await R.bindReceiver();
    Object.assign(R.fake.panes[2], { label: 'successor', agent_session: null, agent_status: 'unknown' });
    R.fake.screens['w4:p4'] = EMPTY_BOX;
    R.write();
    const released = R.cli(['release', '--next', 'successor'], RECEIVER);
    const note = sendNote(R, 'successor', 'wait for the successor');
    assert.equal(note.out.status, 'queued', JSON.stringify({ released, note }));
    assert.equal(released.out.ok, true);
    assert.equal(R.mb(id).handover.pane, 'w4:p4', 'an agent name resolves to its pane');
    assert.equal(R.mb(id).state, 'disconnected');
    assert.equal(R.state().letters[note.out.uid].mailbox, id);
    const log = fs.readFileSync(R.env.FAKE_HERDR_LOG, 'utf8').trim().split('\n').map(line => JSON.parse(line).argv);
    assert.ok(!log.some(args => args.slice(0, 3).join(' ') === 'agent prompt w4:p4'));
    const toPrevious = sendNote(R, 'w1:p1', 'a note for the previous receiver');
    assert.equal(R.state().letters[toPrevious.out.uid].mailbox, id);
  } finally { R.cleanup(); }
});

test('672.3/AC-1 claiming delivers the queued note and clears the successor', async () => {
  const R = rig({ mergeMs: 0 });
  try {
    const id = await R.bindReceiver();
    const transcript = path.join(R.root, 'sid-4.jsonl');
    R.fake.screens['w4:p4'] = EMPTY_BOX;
    R.fake.transcripts['w4:p4'] = transcript;
    R.write();
    assert.equal(R.sessionStart('w4:p4', 'sid-4', 'startup').status, 0);
    assert.equal(R.cli(['release', id, '--next', 'w4:p4'], RECEIVER).code, 0);
    const note = sendNote(R, 'w4:p4', 'queued before claim').out;
    assert.equal(note.status, 'queued');
    assert.equal(fs.existsSync(transcript), false);

    const successor = { HERDR_PANE_ID: 'w4:p4', HERDR_MAILBOX_SID: 'sid-4' };
    assert.equal(R.cli(['claim', id], successor).out.ok, true);
    assert.equal(R.mb(id).owner.pane, 'w4:p4');
    assert.equal(R.mb(id).handover, undefined);
    const batch = await until(() => Object.values(R.state().batches)
      .find(b => b.members.includes(note.uid) && b.status === 'confirmed'), 'the queued note to reach the successor transcript');
    assert.equal(batch.pane, 'w4:p4');
    assert.match(fs.readFileSync(transcript, 'utf8'), /queued before claim/);
  } finally { R.cleanup(); }
});

test('672.3/AC-1 panes without a mailbox or a pending handover still receive direct notes', async () => {
  const R = rig();
  try {
    await R.bindReceiver();
    R.fake.screens['w5:p5'] = EMPTY_BOX;
    R.write();
    assert.equal(R.cli(['release', '--next', 'w4:p4'], RECEIVER).code, 0);
    const note = sendNote(R, 'w5:p5', 'ordinary direct note');
    assert.equal(note.out.status, 'direct', JSON.stringify(note));
    assert.equal(note.out.to, 'w5:p5');
  } finally { R.cleanup(); }
});

test('672.3/AC-1 the previous receiver can add and replace the successor after release', async () => {
  const R = rig();
  try {
    const id = await R.bindReceiver();
    assert.equal(R.cli(['release'], RECEIVER).out.ok, true);
    assert.equal(R.cli(['release', id, '--next', 'w4:p4']).out?.error, 'not_owner');
    assert.equal(R.sessionStart('w1:p1', 'sid-nested', 'startup').status, 0);
    const nested = { ...RECEIVER, HERDR_MAILBOX_SID: 'sid-nested' };
    const refused = R.cli(['release', id, '--next', 'w4:p4'], nested).out;
    assert.equal(refused.error, 'not_owner');
    assert.ok(refused.message.includes(`mailbox claim ${id}`));
    assert.equal(R.mb(id).handover, undefined);
    assert.equal(R.cli(['release', '--next', 'w4:p4'], RECEIVER).out.ok, true);
    const first = sendNote(R, 'w4:p4', 'after adding a successor').out;
    assert.equal(first.status, 'queued');
    assert.equal(R.state().letters[first.uid].mailbox, id);

    assert.equal(R.sessionStart('w1:p1', 'sid-fork', 'fork').status, 0);
    const fork = { ...RECEIVER, HERDR_MAILBOX_SID: 'sid-fork' };
    assert.equal(R.cli(['release', id, '--next', 'w5:p5'], fork).out.ok, true);
    assert.equal(R.cli(['status', '--to', 'w4:p4']).out.mailbox, undefined);
    const second = sendNote(R, 'w5:p5', 'after changing the successor').out;
    assert.equal(second.status, 'queued');
    assert.equal(R.state().letters[second.uid].mailbox, id);
    assert.equal(R.cli(['claim', id], RECEIVER).out.ok, true);
    assert.equal(R.cli(['status', '--to', 'w5:p5']).out.mailbox, undefined);
  } finally { R.cleanup(); }
});

test('672.3/AC-1 release --next refuses a missing pane and leaves the mailbox connected', async () => {
  const R = rig();
  try {
    const id = await R.bindReceiver();
    const before = R.mb(id);
    const refused = R.cli(['release', id, '--next', 'w9:p9'], RECEIVER);
    assert.equal(refused.code, 1);
    assert.equal(refused.out.error, 'pane_not_found');
    assert.deepEqual(R.mb(id), before);
  } finally { R.cleanup(); }
});

test('672.3/AC-1 the most recently released mailbox wins when two name the same successor', async () => {
  const R = rig();
  try {
    const newer = await R.bindReceiver();
    const other = { HERDR_PANE_ID: 'w5:p5', HERDR_MAILBOX_SID: 'sid-5' };
    const bound = await R.raw({ op: 'bind', pane: other.HERDR_PANE_ID, caller: { pane: other.HERDR_PANE_ID, sid: other.HERDR_MAILBOX_SID } });
    assert.equal(bound.ok, true);
    const older = bound.mailbox;
    assert.equal(R.cli(['release', older, '--next', 'w4:p4'], other).code, 0);
    assert.equal(R.cli(['release', newer, '--next', 'w4:p4'], RECEIVER).code, 0);
    const note = sendNote(R, 'w4:p4', 'route by release order').out;
    assert.equal(note.status, 'queued');
    assert.equal(R.state().letters[note.uid].mailbox, newer);

    // Binding takes over the newer handover and ends the older one that names the same pane.
    const successor = await R.raw({ op: 'bind', pane: 'w4:p4', caller: { pane: 'w4:p4', sid: 'sid-4' } });
    assert.equal(successor.mailbox, newer);
    assert.equal(R.mb(older).handover, undefined);
    const toOwnMailbox = sendNote(R, 'w4:p4', 'the receiver has its own mailbox').out;
    assert.equal(toOwnMailbox.status, 'queued');
    assert.equal(R.state().letters[toOwnMailbox.uid].mailbox, newer);
  } finally { R.cleanup(); }
});

test('672.3/AC-1 a handover to a pane comes before that pane\'s own disconnected mailbox', async () => {
  const R = rig();
  try {
    const id = await R.bindReceiver();
    const own = { HERDR_PANE_ID: 'w4:p4', HERDR_MAILBOX_SID: 'sid-4' };
    const stale = (await R.raw({ op: 'bind', pane: 'w4:p4', caller: { pane: 'w4:p4', sid: 'sid-4' } })).mailbox;
    assert.equal(R.cli(['release', id, '--next', 'w4:p4'], RECEIVER).code, 0);
    const toConnected = sendNote(R, 'w4:p4', 'a connected mailbox comes first').out;
    assert.equal(R.state().letters[toConnected.uid].mailbox, stale);
    assert.equal(R.cli(['release', stale], own).code, 0);
    const note = sendNote(R, 'w4:p4', 'to the handover, not the stale mailbox').out;
    assert.equal(note.status, 'queued');
    assert.equal(R.state().letters[note.uid].mailbox, id);
  } finally { R.cleanup(); }
});

test('672.3/AC-1 claiming one handover ends the others that name the same pane', async () => {
  const R = rig();
  try {
    const older = await R.bindReceiver();
    const other = { HERDR_PANE_ID: 'w5:p5', HERDR_MAILBOX_SID: 'sid-5' };
    const newer = (await R.raw({ op: 'bind', pane: 'w5:p5', caller: { pane: 'w5:p5', sid: 'sid-5' } })).mailbox;
    assert.equal(R.cli(['release', older, '--next', 'w4:p4'], RECEIVER).code, 0);
    assert.equal(R.cli(['release', newer, '--next', 'w4:p4'], other).code, 0);
    const successor = { HERDR_PANE_ID: 'w4:p4', HERDR_MAILBOX_SID: 'sid-4' };
    assert.equal(R.cli(['claim', newer], successor).out.ok, true);
    assert.equal(R.mb(older).handover, undefined);
    // Once the successor's own mailbox disconnects, its notes go there, not to the older handover.
    assert.equal(R.cli(['release', newer], successor).code, 0);
    const note = sendNote(R, 'w4:p4', 'after the successor released its mailbox').out;
    assert.equal(R.state().letters[note.uid].mailbox, newer);
  } finally { R.cleanup(); }
});

test('672.3/AC-1 mailbox open in the successor takes over the handed-over mailbox with its queued notes', async () => {
  const R = rig();
  try {
    const id = await R.bindReceiver();
    assert.equal(R.cli(['release', id, '--next', 'w4:p4'], RECEIVER).code, 0);
    const note = sendNote(R, 'w4:p4', 'queued before open').out;
    const opened = await R.raw({ op: 'bind', pane: 'w4:p4', caller: { pane: 'w4:p4', sid: 'sid-4' } });
    assert.deepEqual([opened.ok, opened.mailbox, opened.created], [true, id, false]);
    assert.equal(Object.keys(R.state().mailboxes).length, 1, 'no second mailbox');
    assert.deepEqual([R.mb(id).state, R.mb(id).owner.pane, R.mb(id).handover], ['connected', 'w4:p4', undefined]);
    assert.equal(R.state().letters[note.uid].mailbox, id);
  } finally { R.cleanup(); }
});

test('672.3/AC-1 the successor follows its terminal, and is dropped when the pane id changes terminal or closes', async () => {
  const R = rig({ registerGraceMs: 1500 });
  try {
    const id = await R.bindReceiver();
    assert.equal(R.cli(['release', id, '--next', 'w4:p4'], RECEIVER).code, 0);
    assert.equal(R.mb(id).handover.terminalId, 't4');
    // Moved to another space: same terminal, new pane id.
    R.fake.panes[2] = pane('w6:p4', 't4', 'sid-4');
    R.write();
    await until(() => R.mb(id).handover?.pane === 'w6:p4', 'the successor to follow its terminal');
    assert.equal(sendNote(R, 'w6:p4', 'after the move').out.status, 'queued');
    // The pane id now belongs to another terminal: dropped at once.
    R.fake.panes[2] = pane('w6:p4', 't9', 'sid-9');
    R.write();
    await until(() => R.mb(id).handover === undefined, 'a reused pane id to drop the successor', 1000);
    R.fake.screens['w6:p4'] = EMPTY_BOX;
    R.write();
    assert.equal(sendNote(R, 'w6:p4', 'not for the mailbox').out.status, 'direct');

    // Closed: kept through the grace period, then dropped; the queued note stays for whoever claims.
    assert.equal(R.cli(['release', id, '--next', 'w5:p5'], RECEIVER).code, 0);
    const queued = sendNote(R, 'w5:p5', 'queued before the close').out;
    R.fake.panes = R.fake.panes.filter(p => p.pane_id !== 'w5:p5');
    R.write();
    await sleep(700);
    assert.equal(R.mb(id).handover?.pane, 'w5:p5', 'still named within the grace period');
    await until(() => R.mb(id).handover === undefined, 'a closed successor to be dropped', 4000);
    assert.deepEqual([R.mb(id).state, R.state().letters[queued.uid].mailbox], ['disconnected', id]);
  } finally { R.cleanup(); }
});

test('441/AC-1,2 renew gives the pane a new mailbox: unsent letters and drafts move, old batches stay behind, and letters to the old id arrive in the new one with a notice', async () => {
  const R = rig({ confirmMs: 300 });
  try {
    const id = await R.bindReceiver();
    R.fake.screens['w1:p1'] = EMPTY_BOX;
    R.write();
    // A batch that ends unconfirmed stays with the old mailbox.
    const first = sendNote(R, id, 'delivered long ago').out;
    assert.equal((await R.screen(id, { op: 'deliver-now' })).ok, true);
    await until(() => Object.values(R.state().batches).some(b => b.status === 'unconfirmed'), 'an unconfirmed batch');
    // Still unsent: a queued note and a question whose draft the user already filled in.
    const queued = sendNote(R, id, 'still waiting').out;
    const q = sendDecision(R, id).out;
    await R.screen(id, { op: 'answer', uid: q.uid, version: 1, choice: 'B', text: 'because' });
    assert.equal(R.cli(['renew', id]).out.error, 'not_owner', 'a sender that is not the receiver cannot renew');
    assert.equal(R.mb(id).state, 'connected');

    const renewed = R.cli(['renew'], RECEIVER);
    assert.equal(renewed.out.ok, true, JSON.stringify(renewed));
    const fresh = renewed.out.mailbox;
    assert.match(fresh, /^MB-[0-9a-f]{4}$/);
    assert.notEqual(fresh, id);
    assert.equal(R.mb(fresh).state, 'connected');
    assert.equal(R.mb(fresh).owner.pane, 'w1:p1');
    assert.equal(R.mb(id).renewedTo, fresh, 'the old id keeps a pointer to the new one');
    const letters = R.state().letters;
    assert.deepEqual([queued.uid, q.uid].map(uid => letters[uid].mailbox), [fresh, fresh], 'unsent letters moved');
    assert.deepEqual(letters[q.uid].draft, { choice: 'B', text: 'because' }, 'the draft came along');
    assert.equal(letters[first.uid].mailbox, id, 'a delivered letter stays with its batch');
    const view = await R.raw({ op: 'view', mailbox: fresh });
    assert.deepEqual(view.notes.map(n => n.uid), [queued.uid]);
    assert.deepEqual(view.questions.map(x => x.uid), [q.uid]);
    assert.deepEqual(view.batches, [], 'old batches are not shown');
    assert.equal((await R.raw({ op: 'view', mailbox: id })).mailbox.id, fresh, 'asking for the old id shows the new mailbox');
    assert.equal(Object.values(R.state().batches).filter(b => b.mailbox === id && b.status === 'unconfirmed').length, 1, 'the old batch record is kept');

    const late = sendNote(R, id, 'to the old id');
    assert.equal(late.out.ok, true, JSON.stringify(late));
    assert.equal(R.state().letters[late.out.uid].mailbox, fresh);
    assert.equal(late.out.renewed.to, fresh);
    assert.match(late.out.renewed.message, new RegExp(fresh));
    const byPane = R.cli(['send', '--to', 'w1:p1', '--type', 'note', 'to the pane']);
    assert.equal(R.state().letters[byPane.out.uid].mailbox, fresh, 'a pane address finds the new mailbox, not the archived one');
    assert.equal(byPane.out.renewed, undefined);
  } finally { R.cleanup(); }
});

test('441/AC-3 after two renewals a letter to the oldest id arrives in the newest mailbox, and each send says so', async () => {
  const R = rig();
  try {
    const oldest = await R.bindReceiver();
    const second = R.cli(['renew'], RECEIVER).out.mailbox;
    const third = R.cli(['renew'], RECEIVER).out.mailbox;
    assert.equal(new Set([oldest, second, third]).size, 3);
    const sent = sendNote(R, oldest, 'sent to the oldest id');
    assert.equal(sent.out.ok, true, JSON.stringify(sent));
    assert.equal(R.state().letters[sent.out.uid].mailbox, third);
    assert.equal(sent.out.renewed.to, third);
    assert.equal(sendNote(R, second, 'sent to the middle id').out.renewed.to, third);
    assert.equal(R.cli(['status', '--to', oldest]).out.mailbox, third);
  } finally { R.cleanup(); }
});

test('441/AC-5 renew is refused while a batch is being sent, with the reason, and nothing changes', async () => {
  const R = rig({ confirmMs: 60_000 });
  try {
    const id = await R.bindReceiver();
    R.fake.screens['w1:p1'] = EMPTY_BOX;
    R.write();
    const note = sendNote(R, id, 'on its way').out;
    assert.equal((await R.screen(id, { op: 'deliver-now' })).ok, true);
    const batch = await until(() => Object.values(R.state().batches).find(b => b.status === 'sending'), 'a batch in flight');
    const before = JSON.stringify(R.state().mailboxes);
    const refused = R.cli(['renew'], RECEIVER);
    assert.equal(refused.out.ok, false);
    assert.equal(refused.out.error, 'batch_sending');
    assert.ok(refused.out.message.includes(batch.id), refused.out.message);
    assert.equal(JSON.stringify(R.state().mailboxes), before, 'the number and the state of the mailboxes did not change');
    assert.equal(R.state().letters[note.uid].mailbox, id);
    assert.equal((await R.screen(id, { op: 'renew' })).error, 'batch_sending', 'the screen is refused the same way');
  } finally { R.cleanup(); }
});

test('566/AC-1 a decision or discussion card from anyone but the receiver of the mailbox is refused with a pointer to a plain note; the receiver\'s own card is accepted', async () => {
  const R = rig();
  try {
    const id = await R.bindReceiver();
    // Another pane, and the receiver's pane in a conversation that is not the receiver's, are both refused.
    const refusals = [sendDecision(R, id, 'w2:p2', 'sid-2'), sendDecision(R, id, 'w1:p1', 'sid-9'),
      R.cli(['send', '--to', id, '--type', 'discussion', '--question', 'Which way?', '--source', 'test'], { HERDR_PANE_ID: 'w2:p2', HERDR_MAILBOX_SID: 'sid-2' })];
    for (const refused of refusals) {
      assert.equal(refused.code, 1);
      assert.equal(refused.out.error, 'not_owner');
      assert.match(refused.out.message, /--type note/);
    }
    assert.deepEqual(Object.keys(R.state().letters), []);
    const own = sendDecision(R, id);
    assert.equal(own.code, 0, JSON.stringify(own));
    assert.equal(own.out.status, 'pending');
  } finally { R.cleanup(); }
});
