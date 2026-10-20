// The mailbox screen: a TUI that runs in a pane to the right of the receiver. It draws the daemon's view, turns
// mouse clicks and typing into actions, and keeps nothing of its own except what is being typed.
import { call as daemon } from '../ipc.mjs';
import * as herdr from '../herdr.mjs';
import { pickLocale } from '../messages.mjs';
import { render, BATCH } from './render.mjs';
import { perform } from './actions.mjs';
import { parseInput, edit } from './input.mjs';
import { enter, painter, size, forgetSize } from './term.mjs';
import { createEventQueue } from './events.mjs';
import { wrap } from './text.mjs';
import { Animator } from './anim.mjs';
import { RESULT_MS, FAILED_MS, followedBatch } from './feedback.mjs';

const SELF = process.env.HERDR_PANE_ID;
const caller = { pane: SELF, viaPlugin: true };
const call = req => daemon({ caller, ...req });
const locale = pickLocale();
const out = process.stdout;

let mailbox = process.env.HERDR_MAILBOX_ID;
if (!mailbox) mailbox = (await call({ op: 'screen-find', pane: SELF }).catch(() => ({}))).mailbox;
if (!mailbox) { console.error('mailbox screen: no mailbox for this pane'); process.exit(1); }

let model = null;
let ui = null;
let scroll = 0;
let focus = null; // { uid, pos } while a text field has the keyboard
let notice = null;
let noticeTimer = null;
let busy = false;
let failure = null; // why the last view failed, shown while there is nothing else to show
const buffers = {}; // text being typed per question, until it is saved
const paint = painter(out);
let hover = null; // { x, y } of the pointer while it is over the screen
let hoverKey = null; // which hit it is over, so moving within one element does not redraw
let hoverTimer = null;
let tooltip = null; // { x, y } while the full text of a cut-off item is shown
let tipKey = null; // which cut-off item the pointer rests on
let tipTimer = null;
let batchOpen = false;
let ghosts = []; // messages and questions that just left, kept on screen while they fade out
let lastInteractionAt = null; // last mouse movement, click or key; new questions do not scroll the view meanwhile
let feedback = null; // the operation in flight and how it went (see feedback.mjs)
let deliveryState = null; // while Deliver now is delivering: the daemon's delivery state for this mailbox
let deliveryConfirmedAt = null; // when that delivery was seen landing
let overlay = null; // settings or an attachment, open as a layer inside this pane (see actions.mjs)
let confirmPrompt = null; // { message, resolve } while the screen asks a yes / no question
let seen = null; // questions already on screen, so a new one can be told apart
const anim = new Animator(() => draw());
const ENTER_MS = 400;
const GLOW_MS = 2500;
const LEAVE_MS = 300;
const FOLD_MS = 150;

function say(text) {
  notice = text;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { notice = null; draw(); }, 5000);
}

let last = { cols: 0, rows: 0 };

function draw() {
  const { cols, rows } = size(out);
  if (cols !== last.cols || rows !== last.rows) { last = { cols, rows }; paint.reset(); }
  // Before the first answer from the daemon the screen says so, and says why when it failed, instead of staying blank.
  if (!model) {
    const lines = ['📬 Mailbox', '', ...wrap(failure || '…', cols)];
    paint.paint(lines, rows, null);
    return;
  }
  // Nothing that moves rows runs while the receiver is typing, or while one of this screen's own fields is open:
  // a row shift would move the caret, and an input method's candidate window with it.
  const fx = { ...anim.values(), noShift: model.inputState === 'typing' || focus !== null };
  ui = render(model, { cols, rows, cardMode: model.prefs?.cardMode, locale, scroll, focus, drafts: buffers, notice, hover, batchOpen, fx, ghosts,
    previousQuestionIds: seen ? [...seen] : null, lastInteractionAt, confirmPrompt: confirmPrompt?.message ?? null,
    feedback, deliveryState, deliveryConfirmedAt, tooltip, overlay });
  if (overlay?.kind === 'attachment' && ui.overlayTop !== null) overlay.top = ui.overlayTop; // keep the scroll inside the text
  // Everything now visible, or scrolled to, counts as seen; what is still behind the hint does not.
  const hidden = new Set(ui.unseen);
  seen ??= new Set();
  for (const q of model.questions) if (!hidden.has(q.uid)) seen.add(q.uid);
  scroll = ui.scroll;
  // Content moves under a still pointer (refresh, scroll): the hover target is whatever is under it now.
  hoverKey = hover ? keyAt(hover) : null;
  paint.paint(ui.styled, rows, ui.cursor);
}

// Starts the animations for what changed between two views: messages and questions that arrived, questions that
// left (sent or withdrawn), and a change of card mode. Several arrivals at once are staggered by 50 ms; when that
// would take longer than half a second they simply appear.
function animateChanges(before, after) {
  if (!before) return;
  const known = new Set([...before.notes.map(n => n.uid), ...before.questions.map(q => q.uid)]);
  const arrived = [...after.notes, ...after.questions.filter(q => q.status === 'pending')].filter(x => !known.has(x.uid));
  if (arrived.length && arrived.length * 50 <= 500) {
    arrived.forEach((x, i) => {
      // 400 ms of sliding in from the right at an even pace; then 2.5 s of a highlighted row fading back.
      anim.start(`enter:${x.uid}`, ENTER_MS, { ease: 'linear', delay: i * 50 });
      anim.start(`glow:${x.uid}`, GLOW_MS, { ease: 'linear', delay: i * 50 });
    });
  }
  // Whatever left stays on screen as a ghost while it fades and folds away. It is anchored to the next item of the
  // same list that is still there, so it is drawn back exactly where it was.
  const leave = (list, still, kindOf) => list.forEach((x, i) => {
    const kind = kindOf(x);
    if (!kind || ghosts.some(g => g.q.uid === x.uid)) return;
    const next = list.slice(i + 1).find(y => still.has(y.uid))?.uid ?? null;
    ghosts.push({ q: x, kind, next });
    const done = () => { ghosts = ghosts.filter(g => g.q.uid !== x.uid); };
    // Sent questions flash and withdrawn ones dim for 150 ms first; delivered messages go at once. Then 300 ms of
    // sliding out to the right, and only then do the emptied rows fold, so nothing below jumps while it slides.
    anim.start(`leave:${x.uid}`, LEAVE_MS, { ease: 'linear', delay: kind === 'delivered' ? 0 : 150, onEnd: () => anim.start(`fold:${x.uid}`, FOLD_MS, { ease: 'in', onEnd: done }) });
  });
  const afterQuestions = new Map(after.questions.map(q => [q.uid, q]));
  leave(before.questions, afterQuestions, q => {
    if (q.status !== 'pending' || afterQuestions.get(q.uid)?.status === 'pending') return null;
    return afterQuestions.has(q.uid) ? 'sent' : 'withdrawn';
  });
  const afterNotes = new Set(after.notes.map(n => n.uid));
  leave(before.notes, afterNotes, n => (afterNotes.has(n.uid) ? null : 'delivered'));
  if (before.prefs?.cardMode !== after.prefs?.cardMode) anim.start('mode', 200);
}

function adopt(next) {
  if (!next?.ok) {
    failure = next?.message || next?.error || 'the mailbox did not answer';
    say(failure);
    return;
  }
  failure = null;
  animateChanges(model, next);
  model = next;
  const pending = new Map(model.questions.filter(q => q.status === 'pending').map(q => [q.uid, q]));
  for (const uid of Object.keys(buffers)) {
    if (uid !== BATCH && (!pending.has(uid) || focus?.uid !== uid)) delete buffers[uid];
  }
  if (focus && focus.uid !== BATCH && !pending.has(focus.uid)) focus = null;
}

async function refresh() {
  adopt(await call({ op: 'view', mailbox }).catch(e => ({ ok: false, message: String(e.message || e) })));
  await followDelivery();
  draw();
}

// Deliver now is done only when its batch has landed: while it is delivering the screen follows the daemon's
// delivery state, and once the followed batch is confirmed the button says Delivered for 2 seconds. When the batch
// ends unconfirmed or failed, or there is nothing to follow, feedback.mjs returns the button to normal.
async function followDelivery() {
  if (feedback?.state !== 'delivering' || deliveryConfirmedAt !== null) return;
  const state = await call({ op: 'delivery-state', mailbox }).catch(() => null);
  if (!state?.ok || feedback?.state !== 'delivering') return;
  deliveryState = state;
  if (followedBatch(feedback, state)?.status === 'confirmed') {
    deliveryConfirmedAt = Date.now();
    setTimeout(draw, RESULT_MS + 20);
  }
}

// Each stage of an operation redraws at once, so the pressed element shows it is busy within the same frame.
function onFeedback(next) {
  feedback = next;
  if (next.state === 'pending') { deliveryState = null; deliveryConfirmedAt = null; }
  if (next.state === 'done') setTimeout(draw, RESULT_MS + 20);
  if (next.state === 'failed') setTimeout(draw, FAILED_MS + 20);
  draw();
}

const env = () => ({ call, run: herdr.run, now: Date.now, onFeedback, overlay, model, scroll, drafts: buffers, selfPane: SELF, ownerPane: model.mailbox.pane, generation: model.mailbox.generation });
const question = uid => model.questions.find(q => q.uid === uid);

async function act(action) {
  if (busy) return; // a second press while the first is being handled does nothing
  busy = true;
  try {
    const res = await perform(action, env());
    if (Object.hasOwn(res, 'overlay')) overlay = res.overlay;
    if (res.model) adopt(res.model); else await refresh();
    if (!res.ok) say(res.error || 'failed');
  } finally { busy = false; }
  draw();
}

// Saves what was typed in the focused field, if it changed.
async function commit() {
  if (!focus) return;
  const q = question(focus.uid);
  const text = buffers[focus.uid];
  if (!q || text === undefined || text === (q.draft?.text ?? '')) return;
  await act({ type: 'note-text', mailbox, uid: q.uid, version: q.version, choice: q.draft?.choice ?? null, text });
}

async function closeScreen() {
  await call({ op: 'close', mailbox, generation: model?.mailbox.generation }).catch(() => {});
  process.exit(0);
}

// `captured` is the control under the click in the frame that was on screen when the click arrived.
async function click(captured) {
  const action = captured ? { ...captured } : null;
  if (overlay) { if (action) await act(action); return; }
  // With the confirmation row open, only its Yes and No buttons respond.
  if (confirmPrompt && action?.type !== 'confirm-yes' && action?.type !== 'confirm-no') return;
  if (action?.type === 'batch-note') {
    if (focus && focus.uid !== BATCH) await commit();
    buffers[BATCH] ??= '';
    focus = { uid: BATCH, pos: [...buffers[BATCH]].length };
    draw();
    return;
  }
  if (action?.type === 'note-text') {
    if (focus && focus.uid !== action.uid) await commit();
    const text = buffers[action.uid] ?? action.text ?? '';
    buffers[action.uid] = text;
    focus = { uid: action.uid, pos: [...text].length };
    draw();
    return;
  }
  if (action?.type === 'batch-toggle') {
    if (!batchOpen) { batchOpen = true; anim.start('batch-open', 150); } else if (!anim.has('batch-close')) {
      if (focus?.uid === BATCH) focus = null;
      anim.start('batch-close', 120, { ease: 'in', onEnd: () => { batchOpen = false; } });
    }
    draw();
    return;
  }
  if (action?.type === 'confirm-yes' || action?.type === 'confirm-no') {
    answerConfirm(action.type === 'confirm-yes');
    return;
  }
  if (action?.type === 'void-all' || (action?.type === 'resolve-batch' && action.action === 'resend')) {
    // Void all and Resend ask first. They run outside the event queue: they wait for the Yes / No click, which the
    // queue has to deliver.
    // While the question is open the screen keeps refreshing; only the writes after Yes count as busy.
    if (busy || confirmPrompt) return;
    const ask = message => new Promise(resolve => {
      confirmPrompt = { message, resolve: yes => { if (yes) busy = true; resolve(yes); } };
      draw();
    });
    perform(action, { ...env(), confirm: ask })
      .then(res => { if (res.model) adopt(res.model); if (!res.ok) say(res.error || 'failed'); })
      .finally(async () => { busy = false; await refresh(); });
    return;
  }
  if (action?.type === 'reveal') {
    const res = await perform(action, env());
    if (Number.isFinite(res.scroll)) scroll = res.scroll;
    draw();
    return;
  }
  await commit();
  focus = null;
  if (!action) { draw(); return; }
  if (action.type === 'choose') anim.start(`pick:${action.uid}:${action.choice}`, 250, { ease: 'linear' });
  // What is typed in a question's field travels with its option buttons.
  const typed = action.uid && buffers[action.uid];
  if (typed !== undefined && ['choose', 'recommend', 'explain', 'reconfirm'].includes(action.type)) action.text = typed;
  if (action.type === 'reset') delete buffers[action.uid];
  if (action.type.startsWith('bulk-')) delete buffers[BATCH];
  await act(action);
}

function answerConfirm(yes) {
  const pending = confirmPrompt;
  confirmPrompt = null;
  pending?.resolve(yes);
  draw();
}

// Hover follows the pointer; the screen redraws only when the element under it changes. herdr sends nothing when
// the pointer leaves the pane, so the hover clears itself 3 seconds after the last mouse event.
function keyAt({ x, y }) {
  const hit = ui?.hits.find(h => h.row === y - 1 && x - 1 >= h.c0 && x - 1 < h.c1);
  return hit ? `${hit.row}:${hit.c0}` : null;
}

// Cut-off text under a resting pointer: after 0.5 s its full text is shown in a box (render's tooltip); moving off
// it, or 3 s without mouse events, takes the box away. It rides on the same hover tracking and timer.
function tipAt({ x, y }) {
  const tip = ui?.tips.find(h => h.row === y - 1 && x - 1 >= h.c0 && x - 1 < h.c1);
  return tip ? `${tip.row}:${tip.c0}` : null;
}

function move({ x, y }) {
  const key = keyAt({ x, y });
  const tip = tipAt({ x, y });
  hover = { x, y };
  clearTimeout(hoverTimer);
  hoverTimer = setTimeout(() => {
    hover = null;
    const had = hoverKey || tooltip;
    hoverKey = null;
    clearTooltip();
    if (had) draw();
  }, 3000);
  if (tip !== tipKey) {
    const had = tooltip;
    clearTooltip();
    tipKey = tip;
    if (tip) tipTimer = setTimeout(() => { tooltip = { x, y }; draw(); }, 500);
    if (had) { hoverKey = key; draw(); return; }
  }
  if (key !== hoverKey) { hoverKey = key; draw(); }
}

function clearTooltip() {
  clearTimeout(tipTimer);
  tooltip = null;
  tipKey = null;
}

async function key(event) {
  if (event.kind === 'key' && event.name === 'ctrl-c') process.exit(0);
  if (event.kind === 'key' && event.name === 'ctrl-q') return closeScreen();
  if (confirmPrompt && event.kind === 'key' && event.name === 'escape') return answerConfirm(false);
  if (focus) {
    if (event.kind === 'key' && event.name === 'enter') return commit();
    if (event.kind === 'key' && event.name === 'escape') { await commit(); focus = null; return draw(); }
    const next = edit({ text: buffers[focus.uid] ?? '', pos: focus.pos }, event);
    buffers[focus.uid] = next.text;
    focus.pos = next.pos;
    return draw();
  }
  if (event.kind === 'text' && event.text === 'q') return closeScreen();
  if (event.kind === 'key' && event.name === 'pagedown') scroll += Math.max(1, size(out).rows - 8);
  if (event.kind === 'key' && event.name === 'pageup') scroll -= Math.max(1, size(out).rows - 8);
  draw();
}

// While a layer is open, keys and the wheel belong to it (clicks only find its own controls, render hides the rest).
async function overlayEvent(event) {
  const res = await perform({ type: 'overlay-input', event }, env());
  overlay = res.overlay ?? null;
  draw();
}

// Clicks are matched to a control when they arrive, against the frame on screen then (see events.mjs).
const queue = createEventQueue({
  getUI: () => ui,
  onEvent: async (event, action) => {
    try {
      if (!model) return;
      if (event.kind === 'move') move(event);
      else if (overlay && event.kind !== 'click' && !(event.kind === 'key' && event.name === 'ctrl-c')) await overlayEvent(event);
      else if (event.kind === 'wheel') { scroll += event.dir * 3; draw(); } else if (event.kind === 'click') await click(action); else await key(event);
    } catch (e) { say(String(e.message || e)); }
  },
});

enter(out);
// A change of pane size closes the layer, like herdr-sidebar's modal does.
out.on('resize', () => { forgetSize(); overlay = null; draw(); });
paint.reset();
await refresh();
setInterval(() => { if (!busy) refresh(); }, 1000);
process.stdin.on('data', d => {
  const events = parseInput(d);
  if (events.length) lastInteractionAt = Date.now();
  events.forEach(event => queue.enqueue(event));
});
process.stdin.on('end', () => process.exit(0));
