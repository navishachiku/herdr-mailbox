// Who a mailbox belongs to. A mailbox is bound to one conversation in one pane; reconcile keeps that binding
// true as herdr moves panes, restarts or changes the conversation, and anything that no longer matches is
// disconnected until another agent claims it. Delivery asks canDeliver() before sending anything.
import * as herdr from './herdr.mjs';
import { newMailboxId, latestMailbox } from './core.mjs';
import { table } from './messages.mjs';
import { timings } from './timings.mjs';

const text = table({
  en: {
    claimed: 'This mailbox has already been claimed.',
    ownerChanged: id => `The receiver of ${id} changed since your last message; replies now go to the new receiver.`,
    needsReconfirm: 'The receiver changed; the user must confirm this answer again before it is sent.',
    renewed: (from, to) => `${from} was replaced by ${to}; your letter went to ${to}. Send to ${to} from now on.`,
    cardNotOwner: (id, pane) => `only the receiver of ${id} can send it decision or discussion cards: the user answers them from the mailbox screen. To ask or tell the receiver something, send a note: mailbox send --to ${pane ?? id} --type note "<text>"`,
    cardNoReceiver: id => `${id} has no connected receiver, so no card can be sent to it now; if you are its receiver, run: mailbox claim ${id}`,
    sending: list => `a batch is still being sent (${list}), so renewing now would leave it with no way to be confirmed; try again once it is confirmed or marked unconfirmed (about a minute)`,
  },
  'zh-TW': {
    claimed: '這個信箱已被認領。',
    ownerChanged: id => `${id} 的接收者在你上次寄信後已變更；之後的回覆會送給新接收者。`,
    needsReconfirm: '接收者已變更，這個答案需要使用者再確認一次才會送出。',
    renewed: (from, to) => `${from} 已改為 ${to}；你的信已送到 ${to}，之後請寄給 ${to}。`,
    cardNotOwner: (id, pane) => `只有 ${id} 的接收者能寄決策或討論卡給它：卡片由使用者在信箱畫面作答。要問或告知接收者，請改寄一般訊息：mailbox send --to ${pane ?? id} --type note "<內容>"`,
    cardNoReceiver: id => `${id} 目前沒有接上的接收者，現在不能寄卡給它；若你就是它的接收者，請執行：mailbox claim ${id}`,
    sending: list => `有批次正在傳送（${list}），現在換新會讓它無從確認；等它確認或標為未確認後（約一分鐘）再試`,
  },
});

const fail = (error, message, extra) => ({ ok: false, error, message, ...extra });
// Writes that only the receiver (through the CLI) or the user (through the screen) may perform.
const OWNER_OPS = new Set(['answer', 'submit', 'bulk', 'deliver-now', 'resolve-batch', 'close', 'deliver', 'release', 'release-next', 'renew', 'away']);
// Of those, the receiver agent may run only these; answering and sending for the user is the screen's job.
const AGENT_OPS = new Set(['close', 'deliver', 'release', 'release-next', 'renew', 'away']);
const KEEP_REGISTRATIONS = 5;

let api;
// Since when each mailbox has shown a conversation nobody registered; in memory only, a restart simply restarts the wait.
const unverified = new Map();
// Since when each mailbox's pane has been missing from herdr's list; a pane that comes back in time costs nothing.
const missing = new Map();
// Mailboxes whose pane reports no conversation (the agent has not resumed, or only a shell is left): they stay
// connected, but nothing may be typed into the pane.
const noConversation = new Set();
// Since when the pane a released mailbox names as its successor has been missing from herdr's list.
const successorMissing = new Map();

const answered = l => Boolean(l.draft && (l.draft.choice || l.draft.text?.trim()));
const registrationsOf = pane => api.state.registrations[pane] ?? [];

function latestRegistration(pane, match) {
  return registrationsOf(pane).filter(match).at(-1);
}

// Moving a conversation to the background makes Claude Code start a forked conversation in the same pane (a
// SessionStart with source "fork"); the receiver keeps working there, so the pane's fork conversations are
// candidates for the receiver's own, and a mailbox command run from one still comes from the receiver.
const isForkOf = (pane, sid) => Boolean(sid) && registrationsOf(pane).some(r => r.sid === sid && r.source === 'fork');
const isReceiverSid = (box, pane, sid) => Boolean(sid) && (sid === box.owner.convo || isForkOf(pane, sid));

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
  delete box.handover;
  successorMissing.delete(box.id);
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

function latestHandoverTo(pane) {
  let latest;
  for (const box of Object.values(api.state.mailboxes)) {
    if (box.state !== 'disconnected' || box.handover?.pane !== pane) continue;
    if (!latest || box.handover.order > latest.handover.order) latest = box;
  }
  return latest;
}

// The mailbox a pane's letters go to and the pane binds to: its connected mailbox, then a mailbox released to it,
// then its own disconnected one. One order for route and bind, so a handed-over mailbox keeps its MB id.
function mailboxOfPane(pane) {
  const boxes = boxesOf(pane);
  return boxes.find(b => b.state === 'connected') ?? latestHandoverTo(pane) ?? boxes.at(-1);
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
  const updatingHandover = req.op === 'release-next' && box.state === 'disconnected';
  const canReleaseAgain = updatingHandover && box.disconnect?.reason === 'released';
  if (AGENT_OPS.has(req.op) && (box.state === 'connected' || canReleaseAgain)
    && caller.pane === box.owner?.pane && isReceiverSid(box, caller.pane, caller.sid)) return null;
  if (updatingHandover) return fail('not_owner', `only the previous receiver can change the successor; to take over this mailbox, run mailbox claim ${mbId} in your pane, then mailbox release ${mbId} --next <pane>`);
  return fail('not_owner', 'only the current receiver of this mailbox can do that');
}

function mailboxesOfRequest(req) {
  if (req.mailbox) return [req.mailbox];
  const uids = req.op === 'submit' ? (req.items ?? []).map(i => i.uid) : [req.uid];
  return [...new Set(uids.map(uid => api.state.letters[uid]?.mailbox).filter(Boolean))];
}

// A decision or discussion card goes into a mailbox only from that mailbox's receiver: the pane that owns it and, when
// the caller says which conversation it is (Claude exports it; Codex does not), that pane's receiver conversation.
function cardGuard(req, ctx) {
  const dest = route(req.to);
  if (dest.ok === false || dest.kind !== 'mailbox') return null;
  const box = api.state.mailboxes[dest.id];
  if (!box) return null;
  if (box.state !== 'connected' || !box.owner) return fail('not_owner', text.cardNoReceiver(box.id));
  const sid = ctx?.caller?.sid;
  if (req.from === box.owner.pane && (!sid || isReceiverSid(box, req.from, sid))) return null;
  return fail('not_owner', text.cardNotOwner(box.id, box.owner.pane));
}

function guard(op, req, ctx) {
  if (op === 'send' && (req.type === 'decision' || req.type === 'discussion')) return cardGuard(req, ctx);
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
    const box = latestMailbox(api.state, to);
    if (!box) return fail('unknown_mailbox', `no mailbox ${to}`);
    // A renewed mailbox keeps forwarding for good: its letters go to the mailbox that replaced it, and the sender is told.
    return { kind: 'mailbox', id: box.id, ...(box.id !== to ? { renewed: { from: to, to: box.id, message: text.renewed(to, box.id) } } : {}) };
  }
  const box = mailboxOfPane(to);
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
  const allowed = caller.viaPlugin || (caller.pane === req.pane && caller.sid && (caller.sid === convo || isForkOf(req.pane, caller.sid)));
  if (!allowed) return fail('not_owner', 'only the user or the main conversation of this pane can bind its mailbox');
  const owner = {
    pane: req.pane, terminalId: pane.terminal_id, convo,
    transcript: latestRegistration(req.pane, r => r.sid === convo)?.transcript ?? null,
  };
  const box = mailboxOfPane(req.pane);
  if (!box) {
    const id = newMailboxId(api.state.mailboxes);
    api.state.mailboxes[id] = { id, counter: 0, owner: { ...owner, generation: 1 }, state: 'connected', disconnect: null, paused: null, screen: { open: false } };
    api.save();
    return { ok: true, mailbox: id, created: true };
  }
  if (box.state === 'connected' && box.owner.aliases?.includes(convo)) { /* herdr still names the conversation the receiver was moved out of */ }
  else if (box.state === 'connected' && box.owner.convo === convo) Object.assign(box.owner, { ...owner, transcript: owner.transcript ?? box.owner.transcript });
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
  if (caller.sid && caller.sid !== convo && !isForkOf(caller.pane, caller.sid)) return fail('not_owner', 'a nested conversation cannot claim for this pane');
  takeOver(box, {
    pane: caller.pane, terminalId: pane.terminal_id, convo,
    transcript: latestRegistration(caller.pane, r => r.sid === convo)?.transcript ?? null,
  });
  api.save();
  return { ok: true, mailbox: box.id, owner: { pane: box.owner.pane, generation: box.owner.generation } };
}

// The receiver hands the mailbox over on purpose: it disconnects at once, so the next agent can claim it without
// waiting for this pane to be judged gone. Letters and drafts stay, as with any disconnect.
async function release(req) {
  const box = api.state.mailboxes[req.mailbox];
  if (!box) return fail('unknown_mailbox', `no mailbox ${req.mailbox}`);
  const withSuccessor = req.op === 'release-next';
  const alreadyReleased = box.state === 'disconnected' && box.disconnect?.reason === 'released';
  if (box.state !== 'connected' && !(withSuccessor && alreadyReleased)) return fail('not_connected', 'this mailbox is not connected, so there is nothing to release');
  if (withSuccessor) {
    let pane;
    try { if (req.nextPane) pane = await herdr.paneGet(req.nextPane); } catch { /* refuse an unresolvable pane */ }
    if (!pane?.pane_id) return fail('pane_not_found', `no pane ${req.nextPane}; pass an existing pane id to --next`);
    const previous = latestHandoverTo(pane.pane_id);
    box.handover = { pane: pane.pane_id, terminalId: pane.terminal_id, order: (previous?.handover.order ?? 0) + 1 };
    successorMissing.delete(box.id);
  }
  if (!alreadyReleased) disconnect(box, 'released');
  api.save();
  return { ok: true, mailbox: box.id, claim: `mailbox claim ${box.id}` };
}

// The receiver, or the user from the screen, starts over: the pane gets a new mailbox, and the old id stays behind as
// a record that points to it (see route). What is still unsent moves to the new mailbox with its drafts; batches and
// everything already delivered stay with the old one, so the new mailbox starts without that history.
// A batch that is being sent is still waiting to be confirmed against the old mailbox, so renewing waits for it.
const UNSENT = l => ['queued', 'pending', 'submitted'].includes(l.status) || (l.status === 'voided' && !l.voidAnnounced);

function renew(req) {
  const box = api.state.mailboxes[req.mailbox];
  if (!box) return fail('unknown_mailbox', `no mailbox ${req.mailbox}`);
  if (box.state !== 'connected') return fail('not_connected', 'only a connected mailbox can be renewed; claim it first');
  const sending = Object.values(api.state.batches).filter(b => b.mailbox === box.id && b.status === 'sending');
  if (sending.length) return fail('batch_sending', text.sending(sending.map(b => `${b.id} -> ${b.pane}`).join(', ')), { batches: sending.map(b => b.id) });
  const id = newMailboxId(api.state.mailboxes);
  api.state.mailboxes[id] = {
    id, counter: box.counter, owner: { ...box.owner }, state: 'connected', disconnect: null, paused: null, screen: box.screen ?? { open: false },
    ...(box.deliverNow ? { deliverNow: true } : {}),
    ...(box.away ? { away: box.away } : {}),
  };
  let moved = 0;
  for (const l of Object.values(api.state.letters)) {
    if (l.mailbox === box.id && UNSENT(l)) { l.mailbox = id; moved += 1; }
  }
  Object.assign(box, { state: 'renewed', renewedTo: id, renewedAt: api.now(), owner: null, paused: null, deliverNow: false, screen: { open: false, pane: null, terminalId: null, paneTerminal: null } });
  unverified.delete(box.id);
  missing.delete(box.id);
  if (noConversation.delete(box.id)) noConversation.add(id);
  api.save();
  return { ok: true, mailbox: id, from: box.id, moved };
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
  // A conversation the mailbox followed away from (see adoptConversation in delivery) still counts: herdr keeps
  // reporting the id it first saw for a conversation that was moved to the background.
  if (current === o.convo || o.aliases?.includes(current)) { unverified.delete(box.id); return changed; }
  // No conversation reported (the agent has not resumed yet): nothing to compare, so no clock runs, but no delivery either.
  if (!current) { noConversation.add(box.id); return changed; }
  const seen = latestRegistration(o.pane, r => r.sid === current);
  if (seen?.source === 'clear' || seen?.source === 'fork') {
    // Clearing the conversation keeps the same receiver (decision in the task notes); so does herdr starting to
    // report the conversation the receiver was moved into.
    // A fork is only a candidate until a marker lands in its file (see adoptLanding in delivery), so the bound file stays.
    if (seen.source === 'fork') o.aliases = [...new Set([...(o.aliases ?? []), o.convo])].filter(a => a !== current);
    o.convo = current;
    if (seen.source !== 'fork') o.transcript = seen.transcript ?? o.transcript;
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

// Keeps a released mailbox's successor pointing at the pane that was named, judged as reconcileOne judges an owner:
// a pane moved to another space is found by its terminal; a pane gone past the grace period, or a pane id now held
// by another terminal, drops the successor. No time limit otherwise: a new agent may wait long at a start-up prompt.
// Letters already queued stay in the mailbox for whoever claims it.
function reconcileSuccessor(box, panes) {
  const h = box.handover;
  const drop = () => { delete box.handover; successorMissing.delete(box.id); return true; };
  const pane = panes.find(p => p.pane_id === h.pane);
  if (pane) {
    successorMissing.delete(box.id);
    if (h.terminalId === undefined) { h.terminalId = pane.terminal_id; return true; }
    return pane.terminal_id === h.terminalId ? false : drop();
  }
  const moved = h.terminalId !== undefined && panes.find(p => p.terminal_id === h.terminalId);
  if (moved) { successorMissing.delete(box.id); h.pane = moved.pane_id; return true; }
  const since = successorMissing.get(box.id) ?? api.now();
  successorMissing.set(box.id, since);
  return api.now() - since >= timings.registerGraceMs ? drop() : false;
}

async function reconcile() {
  let panes;
  try { panes = await herdr.paneList(); } catch { return; } // herdr unreachable: judge nothing
  let changed = false;
  for (const box of Object.values(api.state.mailboxes)) {
    if (box.state === 'connected' && box.owner) changed = reconcileOne(box, panes) || changed;
    else if (box.state === 'disconnected' && box.handover) changed = reconcileSuccessor(box, panes) || changed;
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
  api.op('release', release, { mutates: true });
  api.op('release-next', release, { mutates: true });
  api.op('renew', renew, { mutates: true });
  api.tick('reconcile', reconcile, timings.reconcileMs);
}
