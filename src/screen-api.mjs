// What the mailbox screen needs from the daemon: the view it draws, bulk answers, preferences, the attachment
// text for the in-screen reader, and the bookkeeping for the screen pane itself (open, close, reopen after a herdr restart).
// Answers and submits reuse core's answer and submit; identity's guard checks the generation on every write.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as herdr from './herdr.mjs';
import { classify } from './input-box.mjs';
import { readPrefs, writePrefs } from './prefs.mjs';
import { timings } from './timings.mjs';

const fail = (error, message, extra) => ({ ok: false, error, message, ...extra });
const MAIN = fileURLToPath(new URL('./screen/main.mjs', import.meta.url));
const PRIORITY = { high: 0, medium: 1, low: 2 };
const ATTACHMENT_LIMIT = 1_000_000;
const RECENT_MS = 60_000;

let api;

const answered = l => Boolean(l.draft && (l.draft.choice || l.draft.text?.trim()));
const boxOf = req => {
  if (req.mailbox) return api.state.mailboxes[req.mailbox];
  const boxes = Object.values(api.state.mailboxes);
  return boxes.find(b => b.screen?.pane === req.pane) ?? boxes.find(b => b.owner?.pane === req.pane);
};

async function panesOrNull() {
  try { return await herdr.paneList(); } catch { return null; }
}

async function view(req) {
  const box = boxOf(req);
  if (!box) return fail('unknown_mailbox', `no mailbox ${req.mailbox ?? req.pane}`);
  const panes = (await panesOrNull()) ?? [];
  const label = id => panes.find(p => p.pane_id === id)?.label || id;
  const mine = Object.values(api.state.letters).filter(l => l.mailbox === box.id);
  const base = l => ({ uid: l.uid, serial: l.serial, type: l.type, status: l.status, sender: l.sender, senderLabel: label(l.sender), createdAt: l.createdAt });
  const notes = mine.filter(l => l.status === 'queued' && l.type === 'note' && !l.batch)
    .sort((a, b) => a.createdAt - b.createdAt)
    .map(l => ({ ...base(l), text: l.content.text ?? '', attach: l.content.attach?.name ?? null }));
  // A question the user just sent stays listed as submitted. Delivery marks the letter delivered the moment its batch
  // goes out, so for a short while after that the screen still reports it as sent rather than dropping it.
  const sentAt = l => api.state.batches[l.batch]?.createdAt ?? 0;
  const justSent = l => l.status === 'delivered' && api.now() - sentAt(l) < RECENT_MS;
  const questions = mine.filter(l => l.type !== 'note' && (['pending', 'submitted'].includes(l.status) || justSent(l)))
    .sort((a, b) => (PRIORITY[a.priority] ?? 1) - (PRIORITY[b.priority] ?? 1) || a.createdAt - b.createdAt)
    .map(l => ({ ...base(l), status: l.status === 'delivered' ? 'submitted' : l.status, priority: l.priority, version: l.version, edited: l.edited, tags: l.tags ?? [], content: l.content, draft: l.draft ?? null }));
  let inputState = 'unknown';
  if (box.owner && box.state === 'connected') {
    try { inputState = classify(await herdr.readScreen(box.owner.pane)); } catch { /* unreadable counts as unknown */ }
  }
  const batches = Object.values(api.state.batches)
    .filter(b => b.mailbox === box.id && ['unconfirmed', 'sending'].includes(b.status))
    .sort((a, b) => a.createdAt - b.createdAt)
    .map(b => ({ id: b.id, status: b.status, kind: b.kind, members: b.members.length, createdAt: b.createdAt }));
  const prefs = readPrefs();
  return {
    ok: true,
    mailbox: {
      id: box.id, state: box.state, generation: box.owner?.generation ?? 0, pane: box.owner?.pane ?? null,
      label: box.owner ? label(box.owner.pane) : box.id,
      disconnect: box.disconnect ?? null, claim: box.state === 'disconnected' ? `mailbox claim ${box.id}` : null,
      screen: box.screen ?? { open: false },
    },
    notes, questions, batches, inputState,
    paused: box.paused ? { reason: box.paused.reason, since: box.paused.since } : null,
    deliverAt: notes.length ? notes[0].createdAt + timings.mergeMs : null,
    prefs,
  };
}

// Applies one answer to every uid it is given that is still an unanswered pending question. Uids that arrived
// after the caller's snapshot are simply not in the list, so they stay untouched.
function bulk(req) {
  const box = boxOf(req);
  if (!box) return fail('unknown_mailbox', `no mailbox ${req.mailbox}`);
  if (!['recommend', 'explain'].includes(req.action)) return fail('bad_action', 'action must be recommend or explain');
  const choice = req.action === 'recommend' ? 'P' : 'E';
  // The batch note goes only onto questions that are still unanswered, so a note already written on a question stays.
  const note = String(req.text ?? req.note ?? '');
  const applied = [];
  for (const uid of req.uids ?? []) {
    const l = api.state.letters[uid];
    if (!l || l.mailbox !== box.id || l.status !== 'pending' || answered(l)) continue;
    if (l.type === 'discussion' && choice === 'P') continue;
    l.draft = { choice, text: note };
    l.updatedAt = api.now();
    applied.push(uid);
  }
  if (applied.length) api.save();
  return { ok: true, applied };
}

function prefsGet() {
  return { ok: true, ...readPrefs() };
}

function prefsSet(req) {
  const { op, proto, caller, ...change } = req;
  const next = writePrefs(change);
  return next.error ? fail('bad_pref', `${next.error} is out of range`) : { ok: true, ...next };
}

async function attachment(req) {
  const l = api.state.letters[req.uid];
  const att = l?.content?.attach;
  if (!att?.path) return fail('no_attachment', 'that letter has no attachment');
  try {
    const data = fs.readFileSync(att.path);
    return { ok: true, name: att.name, text: data.subarray(0, ATTACHMENT_LIMIT).toString('utf8'), truncated: data.length > ATTACHMENT_LIMIT };
  } catch (e) { return fail('bad_attach', `cannot read the attachment: ${e.code || e.message}`); }
}

function screenFind(req) {
  const box = boxOf(req);
  if (!box) return { ok: true, mailbox: null };
  return { ok: true, mailbox: box.id, generation: box.owner?.generation ?? 0, role: box.screen?.pane === req.pane ? 'screen' : 'owner' };
}

const quote = s => (/^[\w./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`);
const paneIdIn = out => /"pane_id"\s*:\s*"([^"]+)"/.exec(out)?.[1];

// Splits a column to the right of the receiver and starts the screen in it. The receiver keeps focus.
async function openScreen(box, panes) {
  const owner = panes.find(p => p.pane_id === box.owner?.pane);
  if (!owner) return fail('receiver_gone', 'the receiver pane is not there to open next to');
  const { width } = readPrefs();
  let cols;
  try {
    const layout = JSON.parse(await herdr.run(['pane', 'layout', '--pane', owner.pane_id])).result.layout;
    cols = layout.panes.find(p => p.pane_id === owner.pane_id)?.rect?.width;
  } catch { /* handled below */ }
  const env = [`HERDR_MAILBOX_ID=${box.id}`, `HERDR_MAILBOX_TARGET=${owner.pane_id}`];
  let screenPane;
  if (cols > width) {
    const ratio = Number((1 - width / cols).toFixed(4));
    const out = await herdr.run(['pane', 'split', owner.pane_id, '--direction', 'right', '--ratio', String(ratio), '--no-focus', ...env.flatMap(e => ['--env', e])]);
    screenPane = paneIdIn(out);
    if (!screenPane) return fail('split_failed', 'herdr did not report the new pane');
    await herdr.run(['pane', 'run', screenPane, `node ${quote(MAIN)}`]);
  } else {
    // The layout could not be read: let herdr place the pane itself, at its own default width.
    const out = await herdr.run(['plugin', 'pane', 'open', '--plugin', 'herdr-mailbox', '--entrypoint', 'screen', '--placement', 'split',
      '--direction', 'right', '--target-pane', owner.pane_id, '--no-focus', ...env.flatMap(e => ['--env', e])]);
    screenPane = paneIdIn(out) ?? null;
  }
  // The screen pane's own terminal id tells a live screen from the empty shell herdr restores in its place.
  const fresh = (await panesOrNull())?.find(p => p.pane_id === screenPane);
  box.screen = { open: true, pane: screenPane, terminalId: owner.terminal_id, paneTerminal: fresh?.terminal_id ?? null };
  api.save();
  return { ok: true, mailbox: box.id, pane: screenPane, opened: true };
}

async function closeScreen(box, panes) {
  const pane = box.screen?.pane;
  box.screen = { open: false, pane: null, terminalId: null, paneTerminal: null };
  api.save();
  if (pane && panes?.some(p => p.pane_id === pane)) await herdr.run(['pane', 'close', pane]).catch(() => {});
}

// 'alive': the screen pane is there and is the same terminal; 'stale': the pane id is there but its terminal is not
// the one the screen started in (herdr restored an empty shell); 'gone': no such pane.
// A record from before the screen's terminal id was kept has nothing to compare. If the receiver's terminal is the
// recorded one, herdr has not restarted since the screen opened, so the pane is the real screen and its terminal
// id is recorded now; if the receiver's terminal changed, the pane is a leftover shell.
function screenState(box, panes) {
  const pane = box.screen?.pane && panes.find(p => p.pane_id === box.screen.pane);
  if (!pane) return 'gone';
  if (box.screen.paneTerminal) return pane.terminal_id !== box.screen.paneTerminal ? 'stale' : 'alive';
  const owner = panes.find(p => p.pane_id === box.owner?.pane);
  if (!owner) return 'alive';
  if (owner.terminal_id !== box.screen.terminalId) return 'stale';
  box.screen.paneTerminal = pane.terminal_id;
  api.save();
  return 'alive';
}

// The shortcut: open the screen, focus it when it is open elsewhere, close it when asked from inside it.
async function screenOpen(req) {
  const box = boxOf(req);
  if (!box?.owner) return fail('no_mailbox', `${req.pane} has no mailbox; open it from an agent pane`);
  const panes = await panesOrNull();
  if (!panes) return fail('herdr_unreachable', 'herdr did not answer');
  const state = screenState(box, panes);
  if (state === 'stale') await herdr.run(['pane', 'close', box.screen.pane]).catch(() => {});
  const alive = state === 'alive';
  if (alive && req.pane === box.screen.pane) { await closeScreen(box, panes); return { ok: true, mailbox: box.id, closed: true }; }
  if (alive) {
    await herdr.run(['pane', 'focus', '--pane', box.owner.pane, '--direction', 'right']).catch(() => {});
    return { ok: true, mailbox: box.id, pane: box.screen.pane, focused: true };
  }
  return openScreen(box, panes);
}

// Brings one receiver's screen back if herdr restarted while it was open. A pane that vanished while herdr kept
// running (same terminal id) was closed by hand, so it stays closed. A pane id that is still there but now holds
// a different terminal is the empty shell herdr restored: it is closed and the screen is opened again.
async function ensureOne(box, panes) {
  if (!box?.screen?.open || box.state !== 'connected') return { ok: true, action: 'none' };
  const state = screenState(box, panes);
  if (state === 'alive') return { ok: true, action: 'none' };
  const owner = panes.find(p => p.pane_id === box.owner.pane);
  if (!owner) return { ok: true, action: 'none' };
  if (state === 'gone' && owner.terminal_id === box.screen.terminalId) {
    box.screen = { open: false, pane: null, terminalId: null, paneTerminal: null };
    api.save();
    return { ok: true, action: 'closed-by-hand' };
  }
  if (state === 'stale') await herdr.run(['pane', 'close', box.screen.pane]).catch(() => {});
  const res = await openScreen(box, panes);
  return res.ok ? { ...res, action: 'reopened' } : res;
}

// pane.focused names a pane; tab.focused names a tab, and every receiver in that tab is checked. With neither,
// the focused tab is used.
async function screenEnsure(req) {
  const panes = await panesOrNull();
  if (!panes) return { ok: true, action: 'none' };
  const inScope = req.pane ? new Set([req.pane]) : new Set(panes.filter(p => (req.tab ? p.tab_id === req.tab : p.focused)).map(p => p.pane_id));
  const results = [];
  for (const box of Object.values(api.state.mailboxes)) {
    if (box.owner && inScope.has(box.owner.pane)) results.push(await ensureOne(box, panes));
  }
  return results.find(r => r.ok === false) ?? results.find(r => r.action !== 'none') ?? { ok: true, action: 'none' };
}

async function close(req) {
  const box = boxOf(req);
  if (!box) return fail('unknown_mailbox', `no mailbox ${req.mailbox}`);
  await closeScreen(box, await panesOrNull());
  return { ok: true, mailbox: box.id };
}

export default function registerScreen(a) {
  api = a;
  api.op('view', view);
  api.op('bulk', bulk, { mutates: true });
  api.op('prefs-get', prefsGet);
  api.op('prefs-set', prefsSet);
  api.op('attachment', attachment);
  api.op('screen-find', screenFind);
  api.op('screen-open', screenOpen, { mutates: true });
  api.op('screen-ensure', screenEnsure, { mutates: true });
  api.op('close', close, { mutates: true });
}
