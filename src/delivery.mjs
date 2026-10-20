// Delivery: puts letters into receivers' input boxes, one batch at a time per receiver.
// Notes wait for the merge interval, an idle receiver and an empty input box; decision replies skip the first two.
// A batch is written to disk as "sending" before the prompt goes out and is confirmed only when its id shows up
// in the receiver's transcript, so a crash or a lost prompt leaves "unconfirmed", never a silent resend.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import * as herdr from './herdr.mjs';
import { signatureFor, withSignature } from './signature.mjs';
import { classify, pastedLines, typedText } from './input-box.mjs';
import { canDeliver } from './identity.mjs';
import { conciseNotes, conciseReplies, fileNotice, forwardQuestion, directNote, hookContext, notesBatch, repliesBatch } from './format.mjs';
import { findByConversation, landed, sizeOf } from './transcript.mjs';
import { ATTACH_DIR, STATE_DIR } from './paths.mjs';
import { timings, mergeMs } from './timings.mjs';

const fail = (error, message, extra) => ({ ok: false, error, message, ...extra });
const newBatchId = taken => {
  for (;;) {
    const id = `BT-${crypto.randomBytes(3).toString('hex')}`;
    if (!taken[id]) return id;
  }
};

let api;
// Since when each receiver pane has been working without a break; in memory, a restart just restarts the count.
const workingSince = new Map();

const batchesOf = mbId => Object.values(api.state.batches).filter(b => b.mailbox === mbId);
const hasSending = list => list.some(b => b.status === 'sending');

function setPaused(box, reason, retry = true) {
  const keep = box.paused?.reason === reason ? box.paused.since : api.now();
  box.paused = { reason, since: keep, ...(retry ? { nextAt: api.now() + timings.retryMs } : {}) };
}

// Who the senders are, as the receiver should see them: label, signature line (workspace shown in brackets when the
// sender lives in another one) and the sender's own connected mailbox, the address replies should go to.
async function peopleOf(senders, receiverPane) {
  const people = {};
  let receiverSpace;
  if (receiverPane) { try { receiverSpace = (await herdr.paneGet(receiverPane)).workspace_id; } catch { /* unknown */ } }
  for (const pane of new Set(senders)) {
    let label = pane;
    let space;
    try { const p = await herdr.paneGet(pane); label = p.label || pane; space = p.workspace_id; } catch { /* pane gone: the id is all we have */ }
    const mine = Object.values(api.state.mailboxes).find(b => b.state === 'connected' && b.owner?.pane === pane);
    let sig = receiverPane ? await signatureFor(pane, receiverPane) : null;
    if (sig && space && receiverSpace && space !== receiverSpace) {
      const [head, ...rest] = sig.split('/');
      sig = rest.length ? `[${head}] ${rest.join('/')}` : sig;
    }
    people[pane] = { label, sig: sig || label, mailbox: mine?.id };
  }
  return people;
}

const newMarker = () => {
  for (;;) {
    const marker = `BT-${crypto.randomBytes(3).toString('hex')}`;
    if (!Object.values(api.state.batches).some(b => b.marker === marker || b.id === marker)) return marker;
  }
};

// Whitespace differs between what was typed and what the screen draws (wrapped rows, collapsed newlines).
const squash = text => text.replace(/\s+/g, '');

const bytes = text => Buffer.byteLength(text, 'utf8');

// A batch over the size limit is saved whole as a file and only a notice goes into the conversation.
function writeBatchFile(id, text) {
  const dir = path.join(STATE_DIR, 'batches');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, `${id}.md`);
  fs.writeFileSync(file, text, { mode: 0o600 });
  return file;
}

// herdr refused the prompt for a reason that means nothing was typed.
const notSent = e => /agent_blocked|pane_not_found|agent_not_found/.test(`${e.stderr ?? ''}${e.message ?? ''}`);

// Writes the batch to disk, then types it. `back` puts the members back in line when herdr says nothing was sent.
// Letters are only ever typed through agent prompt, never pane run: a plain shell would execute them.
async function send(batch, target, text, back) {
  api.state.batches[batch.id] = batch;
  api.save();
  try {
    await herdr.prompt(target, text);
  } catch (e) {
    if (!notSent(e)) { batch.sentAt = api.now(); api.save(); return; } // outcome unknown: the transcript decides
    batch.status = 'failed';
    back();
    api.save();
    return false;
  }
  batch.sentAt = api.now();
  api.save();
  return true;
}

// make: { full(id), notice(id, file), concise?(marker) }. A concise text (Claude receivers) carries a marker that
// stands in for the batch id; too long, and the full text goes to a file with a notice that carries the id.
function newBatch(box, kind, letters, pane, transcript, convo, make) {
  const id = newBatchId(api.state.batches);
  const marker = make.concise ? newMarker() : null;
  let text = make.concise ? make.concise(marker) : make.full(id);
  let file = null;
  if (bytes(text) > timings.batchFileBytes) {
    file = writeBatchFile(id, make.full(id));
    text = make.notice(id, file);
  }
  return {
    id, mailbox: box?.id ?? null, pane, kind, members: letters.map(l => l.uid), status: 'sending',
    ...(file ? { file } : { text }), ...(marker && !file ? { marker } : {}), sendText: text, tail: squash(text).slice(-40), lines: text.split('\n').length,
    transcript: transcript ?? null, convo: convo ?? null, transcriptOffset: transcript ? sizeOf(transcript) : 0, createdAt: api.now(),
  };
}

async function sendMailboxBatch(box, kind, letters, owner) {
  const people = await peopleOf(letters.map(l => l.sender), owner.pane);
  const sigs = Object.fromEntries(Object.entries(people).map(([pane, who]) => [pane, who.sig]));
  // A sender writing to its own mailbox needs no reply address.
  for (const who of Object.values(people)) if (who.mailbox === box.id) who.mailbox = undefined;
  const batch = newBatch(box, kind, letters, owner.pane, owner.transcript, owner.convo, {
    full: id => (kind === 'replies' ? repliesBatch({ id, letters, people }) : notesBatch({ id, letters, people })),
    notice: (id, file) => fileNotice({ id, letters, people, file, replies: kind === 'replies' }),
    // Claude gets only who wrote what; the rest is added back by the UserPromptSubmit hook.
    ...(owner.agent === 'claude' ? { concise: marker => (kind === 'replies' ? conciseReplies({ marker, letters, sigs }) : conciseNotes({ marker, letters, sigs })) } : {}),
  });
  const text = batch.sendText;
  delete batch.sendText;
  const was = letters.map(l => [l, l.status]);
  for (const l of letters) { l.status = 'delivered'; l.batch = batch.id; }
  box.paused = null;
  if (kind === 'notes') box.deliverNow = false;
  const sent = await send(batch, owner.pane, text, () => {
    for (const [l, status] of was) { l.status = status; delete l.batch; }
    setPaused(box, 'blocked');
  });
  return sent;
}

// Is the receiver's input box safe to type into? Records why not on the mailbox.
async function inputIsEmpty(box, pane) {
  let state = 'unknown';
  try { state = classify(await herdr.readScreen(pane)); } catch { /* unreadable counts as unknown */ }
  if (state === 'empty') return true;
  setPaused(box, state);
  return false;
}

async function deliverMailbox(box, panes) {
  const mine = batchesOf(box.id);
  if (hasSending(mine)) return;
  const letters = Object.values(api.state.letters).filter(l => l.mailbox === box.id && !l.batch)
    .sort((a, b) => a.createdAt - b.createdAt);
  const replies = letters.filter(l => l.status === 'submitted');
  const notes = letters.filter(l => l.status === 'queued' && l.type === 'note');
  const kind = replies.length ? 'replies' : 'notes';
  const batch = kind === 'replies' ? replies : notes;
  if (!batch.length) { if (box.paused) box.paused = null; return; }
  if (kind === 'notes' && !box.deliverNow && api.now() - batch[0].createdAt < mergeMs()) return;
  if (box.paused?.nextAt > api.now()) return;
  const who = canDeliver(box.id);
  if (!who.ok) { setPaused(box, who.reason === 'waiting_conversation' ? 'waiting_conversation' : 'identity', false); return; }
  if (kind === 'notes') {
    const status = panes.find(p => p.pane_id === who.pane)?.agent_status;
    const long = workingSince.has(who.pane) && api.now() - workingSince.get(who.pane) >= timings.workingMs;
    if (!['idle', 'done'].includes(status) && !long) { setPaused(box, 'working', false); return; }
  }
  if (!await inputIsEmpty(box, who.pane)) return;
  const convo = panes.find(p => p.pane_id === who.pane)?.agent_session?.value ?? box.owner.convo;
  await sendMailboxBatch(box, kind, batch, { pane: who.pane, convo, agent: panes.find(p => p.pane_id === who.pane)?.agent, transcript: who.transcript ?? findByConversation(convo) });
}

// The transcript of a pane that has no mailbox: what its conversation last registered, else the file named by its id.
function transcriptOfPane(pane) {
  const convo = pane.agent_session?.value;
  return (api.state.registrations[pane.pane_id] ?? []).filter(r => r.sid === convo).at(-1)?.transcript ?? findByConversation(convo);
}

async function deliverDirect(panes) {
  const direct = Object.values(api.state.batches).filter(b => b.kind === 'direct');
  const busy = new Set(direct.filter(b => b.status === 'sending').map(b => b.pane));
  for (const b of direct.filter(x => x.status === 'pending').sort((x, y) => x.createdAt - y.createdAt)) {
    if (busy.has(b.pane) || (b.nextAt ?? 0) > api.now()) continue;
    const pane = panes.find(p => p.pane_id === b.pane);
    if (!pane?.agent) { b.status = 'failed'; api.save(); continue; }
    let state = 'unknown';
    try { state = classify(await herdr.readScreen(b.pane)); } catch { /* unknown */ }
    // Only Claude's input box can be read. Another agent (Codex) always reads as unknown, so there
    // unknown goes through and herdr's agent_blocked is the guard; text seen in the box still holds the message.
    const hold = pane.agent === 'claude' ? state !== 'empty' : state === 'typing';
    if (hold) { b.nextAt = api.now() + timings.retryMs; api.save(); continue; }
    busy.add(b.pane);
    const transcript = transcriptOfPane(pane);
    Object.assign(b, { status: 'sending', transcript, convo: pane.agent_session?.value ?? null, transcriptOffset: transcript ? sizeOf(transcript) : 0 });
    await send(b, b.pane, b.text, () => { b.status = 'pending'; b.nextAt = api.now() + timings.retryMs; });
  }
}

// A receiver's first message can create its transcript after the prompt went out, so while a batch is waiting the file
// is looked up again on every poll: first by the opening registration, then by the conversation id. A file that did not
// exist when the batch was sent is read from the start.
function findTranscript(b) {
  if (b.transcript && fs.existsSync(b.transcript)) return;
  const registered = (api.state.registrations[b.pane] ?? []).filter(r => r.sid === b.convo).at(-1)?.transcript;
  const file = registered && fs.existsSync(registered) ? registered : findByConversation(b.convo);
  if (file) Object.assign(b, { transcript: file, transcriptOffset: 0 });
}

// The paste sometimes lands without the Enter taking effect. Once, a little after sending, press Enter again, but
// only when the input box still holds this batch (its marker or id): anything else in the box is a person typing.
async function nudge(b) {
  if (b.nudged || b.status !== 'sending' || !b.sentAt || api.now() - b.sentAt < timings.nudgeMs) return;
  if (landed(b.transcript, b.transcriptOffset, b.marker ?? b.id)) return;
  b.nudged = true;
  try {
    // A long paste that is not folded runs past the visible 40 rows, so look further back for the input box.
    const screen = await herdr.readScreen(b.pane, { source: 'recent', lines: 200 });
    const typed = typedText(screen);
    // The box must hold this batch and end where it ends: anything typed after it belongs to a person. A folded
    // paste shows no text, so it counts as this batch only when it is alone in the box and its line count fits.
    const folded = pastedLines(screen);
    const mine = folded !== null ? Math.abs(folded - b.lines) <= 1
      : typed.includes(b.marker ?? b.id) && (!b.tail || squash(typed).endsWith(b.tail));
    if (mine) await herdr.pressEnter(b.pane);
  } catch { /* unreadable or refused: the transcript decides */ }
  api.save();
}

async function settle() {
  let changed = false;
  for (const b of Object.values(api.state.batches)) {
    if (b.status !== 'sending' || !b.sentAt) continue;
    findTranscript(b);
    await nudge(b);
    if (landed(b.transcript, b.transcriptOffset, b.marker ?? b.id)) b.status = 'confirmed';
    else if (api.now() - b.sentAt >= timings.confirmMs) b.status = 'unconfirmed';
    else continue;
    changed = true;
  }
  if (changed) api.save();
}

function trackWorking(panes) {
  const live = new Set();
  for (const box of Object.values(api.state.mailboxes)) {
    const pane = box.state === 'connected' && panes.find(p => p.pane_id === box.owner?.pane);
    if (pane?.agent_status === 'working') { live.add(pane.pane_id); if (!workingSince.has(pane.pane_id)) workingSince.set(pane.pane_id, api.now()); }
  }
  for (const key of workingSince.keys()) if (!live.has(key)) workingSince.delete(key);
}

async function tick() {
  await settle();
  let panes;
  try { panes = await herdr.paneList(); } catch { return; } // herdr unreachable: send nothing
  trackWorking(panes);
  for (const box of Object.values(api.state.mailboxes)) {
    if (box.owner) await deliverMailbox(box, panes);
  }
  await deliverDirect(panes);
  api.save();
}

// Questions and notes for an agent without a mailbox. The text is fixed now and typed when the box is empty.
async function direct(req, content) {
  const to = req.to;
  let pane;
  try { pane = await herdr.paneGet(to); } catch { return fail('pane_not_found', `no pane ${to}`); }
  if (!pane.agent) return fail('no_agent', `pane ${to} runs no agent, so a letter cannot be typed into it`);
  const from = req.from ?? 'unknown';
  const people = await peopleOf([from]);
  const downgraded = content.type !== 'note';
  const id = newBatchId(api.state.batches);
  // The receiver has no mailbox to keep the attachment in, so the snapshot taken now is what the text points to.
  const attachments = [];
  try {
    for (const [i, file] of [].concat(req.attach ?? []).entries()) {
      const data = fs.readFileSync(file);
      const dir = path.join(ATTACH_DIR, id, String(i + 1));
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      attachments.push(path.join(dir, path.basename(file)));
      fs.writeFileSync(attachments[i], data, { mode: 0o600 });
    }
  } catch (e) { return fail('bad_attach', `cannot store the attachment: ${e.code || e.message}`); }
  let text;
  if (downgraded) {
    text = forwardQuestion({ letterType: content.type, content, from, label: people[from].label, attachments });
  } else {
    const signature = await signatureFor(from, to);
    const body = content.text || '';
    text = directNote({ text: signature ? withSignature(body, signature) : body, people, from, attachments });
  }
  api.state.batches[id] = { id, mailbox: null, pane: pane.pane_id, kind: 'direct', members: [], status: 'pending', text, createdAt: api.now() };
  api.save();
  return { ok: true, status: downgraded ? 'downgraded' : 'direct', batch: id, to: pane.pane_id, pending: [] };
}

function pausedOf(mbId) {
  const p = api.state.mailboxes[mbId]?.paused;
  return p ? { reason: p.reason, since: p.since } : null;
}

// The sender's own letters, by the batch they are in: what is waiting, being sent, confirmed, unconfirmed or failed.
function batchesFor(mbId, sender) {
  return batchesOf(mbId).sort((a, b) => a.createdAt - b.createdAt)
    .map(b => ({ id: b.id, kind: b.kind, status: b.status, members: b.members.filter(uid => api.state.letters[uid]?.sender === sender) }))
    .filter(b => b.members.length).slice(-20);
}

function annotate(kind, mbId, sender) {
  const paused = pausedOf(mbId);
  const batches = kind === 'status' ? batchesFor(mbId, sender) : [];
  return { ...(paused ? { paused } : {}), ...(batches.length ? { batches } : {}) };
}

function deliverNow(req) {
  const box = api.state.mailboxes[req.mailbox];
  if (!box) return fail('unknown_mailbox', `no mailbox ${req.mailbox}`);
  box.deliverNow = true;
  if (box.paused?.nextAt) box.paused.nextAt = 0;
  api.save();
  return { ok: true, mailbox: box.id };
}

// The one way out of "unconfirmed": a person says it arrived, or asks for the same letters to go again.
function resolveBatch(req) {
  const batch = api.state.batches[req.batch];
  if (!batch || (req.mailbox && batch.mailbox !== req.mailbox)) return fail('unknown_batch', `no batch ${req.batch}`);
  if (batch.status !== 'unconfirmed') return fail('not_unconfirmed', `the batch is ${batch.status}`);
  if (req.action === 'delivered') {
    batch.status = 'confirmed';
  } else if (req.action === 'resend') {
    batch.status = 'failed';
    batch.resolved = 'resend';
    for (const uid of batch.members) {
      const l = api.state.letters[uid];
      if (!l || l.batch !== batch.id) continue;
      l.status = l.type === 'note' ? 'queued' : 'submitted';
      delete l.batch;
    }
    const box = api.state.mailboxes[batch.mailbox];
    if (box) { box.deliverNow = true; if (box.paused?.nextAt) box.paused.nextAt = 0; }
  } else {
    return fail('bad_action', 'action must be delivered or resend');
  }
  api.save();
  return { ok: true, batch: batch.id, status: batch.status };
}

// The hook asks with the marker from the first line of the prompt and gets back what the concise text left out.
// Only the pane the batch was typed into may ask.
async function batchByMarker(req, ctx) {
  const batch = Object.values(api.state.batches).find(b => b.marker && b.marker === req.marker);
  if (!batch || ctx.caller?.pane !== batch.pane) return fail('unknown_marker', 'no batch with that marker for this pane');
  const letters = batch.members.map(uid => api.state.letters[uid]).filter(Boolean);
  const people = await peopleOf(letters.map(l => l.sender), batch.pane);
  const items = letters.map(l => ({ uid: l.uid, serial: l.serial, sender: l.sender, label: people[l.sender].sig, mailbox: people[l.sender].mailbox }));
  return { ok: true, context: hookContext({ batch, items }) };
}

async function deliveryState(req) {
  const box = api.state.mailboxes[req.mailbox];
  if (!box) return fail('unknown_mailbox', `no mailbox ${req.mailbox}`);
  let inputState = 'unknown';
  if (box.owner && box.state === 'connected') {
    try { inputState = classify(await herdr.readScreen(box.owner.pane)); } catch { /* unknown */ }
  }
  const queued = Object.values(api.state.letters).filter(l => l.mailbox === box.id && l.status === 'queued' && !l.batch).map(l => l.uid);
  return { ok: true, paused: pausedOf(box.id), queued, inputState, batches: batchesOf(box.id).sort((a, b) => a.createdAt - b.createdAt) };
}

export default function registerDelivery(a) {
  api = a;
  api.hook('direct', direct);
  api.hook('annotate', annotate);
  api.op('deliver-now', deliverNow, { mutates: true });
  api.op('deliver', deliverNow, { mutates: true });
  api.op('resolve-batch', resolveBatch, { mutates: true });
  api.op('delivery-state', deliveryState);
  api.op('batch-by-marker', batchByMarker);
  // A restart in the middle of a send leaves the outcome unknown; it is never sent again by itself.
  api.on('start', () => {
    let changed = false;
    for (const b of Object.values(api.state.batches)) if (b.status === 'sending') { b.status = 'unconfirmed'; changed = true; }
    if (changed) api.save();
  });
  api.tick('deliver', tick, timings.tickMs);
}
