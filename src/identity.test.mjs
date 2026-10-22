import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { sessionKey } from './paths.mjs';

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
function rig() {
  const root = fs.mkdtempSync(path.join('/tmp', 'mbid-'));
  const socket = path.join(root, 'herdr.sock');
  const stateFile = path.join(root, 'herdr-state.json');
  const dir = path.join(root, sessionKey(socket));
  const env = {
    ...process.env, HERDR_MAILBOX_STATE_DIR: root, HERDR_SOCKET_PATH: socket, HERDR_BIN_PATH: FAKE,
    FAKE_HERDR_STATE: stateFile, FAKE_HERDR_LOG: path.join(root, 'herdr.log'), HERDR_PANE_ID: 'w2:p2',
    HERDR_MAILBOX_TIMINGS: JSON.stringify({ reconcileMs: 100, registerGraceMs: 600, tickMs: 100 }),
  };
  delete env.HERDR_PLUGIN_STATE_DIR;
  delete env.HERDR_PLUGIN_ID;
  delete env.HERDR_MAILBOX_SID;
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

const sendDecision = (R, id) => R.cli(['send', '--to', id, '--type', 'decision', '--question', 'Install it?', '--option', 'yes', '--option', 'no', '--recommend', 'a']);
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
