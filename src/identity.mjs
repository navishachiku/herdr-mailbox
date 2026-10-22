// Who a mailbox belongs to. A mailbox is bound to one conversation in one pane; reconcile keeps that binding
// true as herdr moves panes, restarts or changes the conversation, and anything that no longer matches is
// disconnected until another agent claims it. Delivery asks canDeliver() before sending anything.
import * as herdr from './herdr.mjs';
import { newMailboxId } from './core.mjs';
import { table } from './messages.mjs';
import { timings } from './timings.mjs';

const text = table({
  en: {
    claimed: 'This mailbox has already been claimed.',
    ownerChanged: id => `The receiver of ${id} changed since your last message; replies now go to the new receiver.`,
    needsReconfirm: 'The receiver changed; the user must confirm this answer again before it is sent.',
  },
  'zh-TW': {
    claimed: '這個信箱已被認領。',
    ownerChanged: id => `${id} 的接收者在你上次寄信後已變更；之後的回覆會送給新接收者。`,
    needsReconfirm: '接收者已變更，這個答案需要使用者再確認一次才會送出。',
  },
});

const fail = (error, message, extra) => ({ ok: false, error, message, ...extra });
// Writes that only the receiver (through the CLI) or the user (through the screen) may perform.
const OWNER_OPS = new Set(['answer', 'submit', 'bulk', 'deliver-now', 'resolve-batch', 'close', 'deliver']);
// Of those, the receiver agent may run only these; answering and sending for the user is the screen's job.
const AGENT_OPS = new Set(['close', 'deliver']);
const KEEP_REGISTRATIONS = 5;

let api;
// Since when each mailbox has shown a conversation nobody registered; in memory only, a restart simply restarts the wait.
const unverified = new Map();
// Since when each mailbox's pane has been missing from herdr's list; a pane that comes back in time costs nothing.
const missing = new Map();
// Mailboxes whose pane reports no conversation (the agent has not resumed, or only a shell is left): they stay
// connected, but nothing may be typed into the pane.
const noConversation = new Set();

const answered = l => Boolean(l.draft && (l.draft.choice || l.draft.text?.trim()));
const registrationsOf = pane => api.state.registrations[pane] ?? [];

function latestRegistration(pane, match) {
  return registrationsOf(pane).filter(match).at(-1);
}

function disconnect(box, reason) {
  box.state = 'disconnected';
  box.disconnect = { reason, at: api.now() };
  unverified.delete(box.id);
  missing.delete(box.id);
  noConversation.delete(box.id);
}

// Hands the mailbox to a new receiver: the generation moves on and answers the user already gave must be confirmed again.
function takeOver(box, owner) {
  const from = box.owner;
  box.owner = { ...owner, generation: (from?.generation ?? 0) + 1 };
  box.state = 'connected';
  box.disconnect = null;
  box.paused = null;
  unverified.delete(box.id);
  for (const l of Object.values(api.state.letters)) {
    if (l.mailbox === box.id && l.status === 'pending' && answered(l)) l.draft.reconfirm = true;
  }
  api.emit('owner-changed', { mailbox: box.id, from, to: box.owner });
}

function boxesOf(pane) {
  return Object.values(api.state.mailboxes).filter(b => b.owner?.pane === pane);
}

// canDeliver(mbId): the pane and transcript a letter may go to right now, or why it may not.
export function canDeliver(mbId) {
  const box = api?.state.mailboxes[mbId];
  if (!box) return { ok: false, reason: 'unknown_mailbox' };
  if (box.state !== 'connected') return { ok: false, reason: box.disconnect?.reason ?? 'unbound' };
  if (noConversation.has(mbId)) return { ok: false, reason: 'waiting_conversation' };
  if (unverified.has(mbId) || missing.has(mbId)) return { ok: false, reason: 'verifying' };
  return { ok: true, pane: box.owner.pane, transcript: box.owner.transcript };
}
export const whoami = canDeliver;

// Shared by delivery and the screen: null when the caller may write to this mailbox, else the failure to return.
// The screen (viaPlugin) carries the generation it displayed; a receiver agent must be the bound pane and conversation.
export function checkOwner(mbId, req, ctx) {
  const box = api.state.mailboxes[mbId];
  if (!box) return null;
  const caller = ctx?.caller ?? {};
  if (caller.viaPlugin) {
    // A mailbox with no owner yet (unbound, or migrated) has generation 0 on the screen.
    if (req.generation !== (box.owner?.generation ?? 0)) return fail('stale_owner', 'the mailbox changed hands; reload it');
    return null;
  }
  if (AGENT_OPS.has(req.op) && box.state === 'connected' && caller.pane === box.owner.pane && caller.sid && caller.sid === box.owner.convo) return null;
  return fail('not_owner', 'only the current receiver of this mailbox can do that');
}

function mailboxesOfRequest(req) {
  if (req.mailbox) return [req.mailbox];
  const uids = req.op === 'submit' ? (req.items ?? []).map(i => i.uid) : [req.uid];
  return [...new Set(uids.map(uid => api.state.letters[uid]?.mailbox).filter(Boolean))];
}

function guard(op, req, ctx) {
  if (!OWNER_OPS.has(op)) return null;
  for (const id of mailboxesOfRequest(req)) {
    const denied = checkOwner(id, req, ctx);
    if (denied) return denied;
  }
  if (op === 'answer' && !req.confirm && api.state.letters[req.uid]?.draft?.reconfirm) return fail('needs_reconfirm', text.needsReconfirm);
  if (op === 'submit' && (req.items ?? []).some(i => api.state.letters[i.uid]?.draft?.reconfirm)) return fail('needs_reconfirm', text.needsReconfirm);
  return null;
}

function route(to) {
  if (String(to).startsWith('MB-')) {
    return api.state.mailboxes[to] ? { kind: 'mailbox', id: to } : fail('unknown_mailbox', `no mailbox ${to}`);
  }
  const boxes = boxesOf(to);
  const box = boxes.find(b => b.state === 'connected') ?? boxes.at(-1);
  return box ? { kind: 'mailbox', id: box.id } : { kind: 'direct', pane: to };
}

function annotate(kind, mbId, sender) {
  const box = api.state.mailboxes[mbId];
  if (!box) return {};
  const extra = {};
  if (box.state === 'disconnected') {
    extra.mailboxState = { state: 'disconnected', reason: box.disconnect?.reason, claim: `mailbox claim ${box.id}` };
  }
  if (kind === 'send' && box.owner) {
    const seen = (api.state.senders[box.id] ??= {});
    const last = seen[sender];
    if (last !== undefined && last < box.owner.generation) {
      extra.ownerChanged = { from: { generation: last }, to: { pane: box.owner.pane, generation: box.owner.generation }, message: text.ownerChanged(box.id) };
    }
    seen[sender] = box.owner.generation;
  }
  return extra;
}

async function bind(req, ctx) {
  let pane;
  try { pane = await herdr.paneGet(req.pane); } catch { return fail('pane_not_found', `no pane ${req.pane}`); }
  const convo = pane.agent_session?.value;
  // An agent that herdr detects but has no conversation id for yet (a start-up prompt is still open) is not a non-agent.
  if (!convo) return fail(pane.agent ? 'agent_not_ready' : 'not_agent', `pane ${req.pane} has no agent conversation`);
  const caller = ctx.caller ?? {};
  const allowed = caller.viaPlugin || (caller.pane === req.pane && caller.sid && caller.sid === convo);
  if (!allowed) return fail('not_owner', 'only the user or the main conversation of this pane can bind its mailbox');
  const owner = {
    pane: req.pane, terminalId: pane.terminal_id, convo,
    transcript: latestRegistration(req.pane, r => r.sid === convo)?.transcript ?? null,
  };
  const boxes = boxesOf(req.pane);
  const box = boxes.find(b => b.state === 'connected') ?? boxes.at(-1);
  if (!box) {
    const id = newMailboxId(api.state.mailboxes);
    api.state.mailboxes[id] = { id, counter: 0, owner: { ...owner, generation: 1 }, state: 'connected', disconnect: null, paused: null, screen: { open: false } };
    api.save();
    return { ok: true, mailbox: id, created: true };
  }
  if (box.state === 'connected' && box.owner.convo === convo) Object.assign(box.owner, { ...owner, transcript: owner.transcript ?? box.owner.transcript });
  else takeOver(box, owner);
  api.save();
  return { ok: true, mailbox: box.id, created: false };
}

function register(req) {
  if (!req.pane || !req.sid) return fail('bad_request', 'register needs pane and sid');
  const list = (api.state.registrations[req.pane] ??= []);
  list.push({ sid: req.sid, source: req.source, transcript: req.transcript ?? null, at: api.now() });
  if (list.length > KEEP_REGISTRATIONS) list.splice(0, list.length - KEEP_REGISTRATIONS);
  api.save();
  return { ok: true };
}

async function claim(req, ctx) {
  const box = api.state.mailboxes[req.mailbox];
  if (!box) return fail('unknown_mailbox', `no mailbox ${req.mailbox}`);
  if (box.state !== 'disconnected') return fail('already_claimed', text.claimed);
  const caller = ctx.caller ?? {};
  if (!caller.pane) return fail('bad_caller', 'claim must run inside the agent pane that takes over');
  let pane;
  try { pane = await herdr.paneGet(caller.pane); } catch { return fail('pane_not_found', `no pane ${caller.pane}`); }
  const convo = pane.agent_session?.value;
  if (!convo) return fail('not_agent', `pane ${caller.pane} has no agent conversation`);
  if (caller.sid && caller.sid !== convo) return fail('not_owner', 'a nested conversation cannot claim for this pane');
  takeOver(box, {
    pane: caller.pane, terminalId: pane.terminal_id, convo,
    transcript: latestRegistration(caller.pane, r => r.sid === convo)?.transcript ?? null,
  });
  api.save();
  return { ok: true, mailbox: box.id, owner: { pane: box.owner.pane, generation: box.owner.generation } };
}

// Brings one connected mailbox in line with what herdr reports. Returns whether anything changed.
function reconcileOne(box, panes) {
  const o = box.owner;
  // Where is the receiver? By pane id first; a pane moved to another space keeps its terminal.
  let pane = panes.find(p => p.pane_id === o.pane);
  if (!pane) {
    pane = panes.find(p => p.terminal_id === o.terminalId);
    if (!pane) {
      const since = missing.get(box.id) ?? api.now();
      missing.set(box.id, since);
      if (api.now() - since >= timings.registerGraceMs) { disconnect(box, 'pane_closed'); return true; }
      return false;
    }
    if (api.state.registrations[o.pane] && !api.state.registrations[pane.pane_id]) {
      api.state.registrations[pane.pane_id] = api.state.registrations[o.pane];
      delete api.state.registrations[o.pane];
    }
    missing.delete(box.id);
    o.pane = pane.pane_id;
    return reconcileConversation(box, pane, true);
  }
  missing.delete(box.id);
  const current = pane.agent_session?.value;
  if (pane.terminal_id !== o.terminalId) {
    // herdr restarted: same session and pane id, so the conversation decides. Right after a restart herdr may
    // not report the conversation yet; an empty report is not a mismatch, only a different one is.
    if (current && current !== o.convo) { disconnect(box, 'restart_mismatch'); return true; }
    o.terminalId = pane.terminal_id;
    return reconcileConversation(box, pane, true);
  }
  return reconcileConversation(box, pane, false);
}

function reconcileConversation(box, pane, changed) {
  const o = box.owner;
  const current = pane.agent_session?.value;
  if (current) noConversation.delete(box.id);
  if (current === o.convo) { unverified.delete(box.id); return changed; }
  // No conversation reported (the agent has not resumed yet): nothing to compare, so no clock runs, but no delivery either.
  if (!current) { noConversation.add(box.id); return changed; }
  const seen = latestRegistration(o.pane, r => r.sid === current);
  if (seen?.source === 'clear') {
    // Clearing the conversation keeps the same receiver (decision in the task notes).
    o.convo = current;
    o.transcript = seen.transcript ?? o.transcript;
    unverified.delete(box.id);
    return true;
  }
  if (seen) { disconnect(box, 'other_conversation'); return true; }
  // herdr names a conversation that is not the bound one and has no registration yet (or none at all). Only a
  // clear registration moves the binding; otherwise the grace period lets the hook register or herdr return to
  // the bound conversation, and when it runs out the mailbox disconnects.
  const since = unverified.get(box.id) ?? api.now();
  unverified.set(box.id, since);
  if (api.now() - since >= timings.registerGraceMs) { disconnect(box, 'other_conversation'); return true; }
  return changed;
}

async function reconcile() {
  let panes;
  try { panes = await herdr.paneList(); } catch { return; } // herdr unreachable: judge nothing
  let changed = false;
  for (const box of Object.values(api.state.mailboxes)) {
    if (box.state === 'connected' && box.owner) changed = reconcileOne(box, panes) || changed;
  }
  if (changed) api.save();
}

export default function registerIdentity(a) {
  api = a;
  api.hook('route', route);
  api.hook('guard', guard);
  api.hook('annotate', annotate);
  api.op('bind', bind, { mutates: true });
  api.op('register', register, { mutates: true });
  api.op('claim', claim, { mutates: true });
  api.tick('reconcile', reconcile, timings.reconcileMs);
}
