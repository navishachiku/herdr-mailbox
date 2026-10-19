// The mailbox screen: a TUI that runs in a pane to the right of the receiver. It draws the daemon's view, turns
// mouse clicks and typing into actions, and keeps nothing of its own except what is being typed.
import { call as daemon } from '../ipc.mjs';
import * as herdr from '../herdr.mjs';
import { pickLocale } from '../messages.mjs';
import { render, BATCH } from './render.mjs';
import { perform } from './actions.mjs';
import { parseInput, edit } from './input.mjs';
import { enter, painter, size, forgetSize } from './term.mjs';
import { wrap } from './text.mjs';

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
  ui = render(model, { cols, rows, cardMode: model.prefs?.cardMode, locale, scroll, focus, drafts: buffers, notice });
  scroll = ui.scroll;
  paint.paint(ui.styled, rows, ui.cursor);
}

function adopt(next) {
  if (!next?.ok) {
    failure = next?.message || next?.error || 'the mailbox did not answer';
    say(failure);
    return;
  }
  failure = null;
  model = next;
  const pending = new Map(model.questions.filter(q => q.status === 'pending').map(q => [q.uid, q]));
  for (const uid of Object.keys(buffers)) {
    if (uid !== BATCH && (!pending.has(uid) || focus?.uid !== uid)) delete buffers[uid];
  }
  if (focus && focus.uid !== BATCH && !pending.has(focus.uid)) focus = null;
}

async function refresh() {
  adopt(await call({ op: 'view', mailbox }).catch(e => ({ ok: false, message: String(e.message || e) })));
  draw();
}

const env = () => ({ call, run: herdr.run, selfPane: SELF, ownerPane: model.mailbox.pane, generation: model.mailbox.generation });
const question = uid => model.questions.find(q => q.uid === uid);

async function act(action) {
  if (busy) return; // a second press while the first is being handled does nothing
  busy = true;
  try {
    const res = await perform(action, env());
    if (res.model) adopt(res.model); else await refresh();
    if (!res.ok && res.error && !res.model) say(res.error);
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

async function click({ x, y }) {
  const hit = ui?.hits.find(h => h.row === y - 1 && x - 1 >= h.c0 && x - 1 < h.c1);
  const action = hit?.action;
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
  await commit();
  focus = null;
  if (!action) { draw(); return; }
  // What is typed in a question's field travels with its option buttons.
  const typed = action.uid && buffers[action.uid];
  if (typed !== undefined && ['choose', 'recommend', 'explain', 'reconfirm'].includes(action.type)) action.text = typed;
  if (action.type === 'reset') delete buffers[action.uid];
  if (action.type.startsWith('bulk-')) delete buffers[BATCH];
  await act(action);
}

async function key(event) {
  if (event.kind === 'key' && event.name === 'ctrl-c') process.exit(0);
  if (event.kind === 'key' && event.name === 'ctrl-q') return closeScreen();
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

let queue = Promise.resolve();
const handle = event => {
  queue = queue.then(async () => {
    if (!model) return;
    if (event.kind === 'wheel') { scroll += event.dir * 3; draw(); } else if (event.kind === 'click') await click(event); else await key(event);
  }).catch(e => say(String(e.message || e)));
};

enter(out);
out.on('resize', () => { forgetSize(); draw(); });
paint.reset();
await refresh();
setInterval(() => { if (!busy) refresh(); }, 1000);
process.stdin.on('data', d => parseInput(d).forEach(handle));
process.stdin.on('end', () => process.exit(0));
