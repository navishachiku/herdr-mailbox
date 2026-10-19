// The screen as data: render(model, options) → plain lines, the same lines with colors, and the clickable areas.
// Pure, so it can be tested without a terminal. `model` is the daemon's `view` answer.
import { width, cut, wrap } from './text.mjs';
import { screenText } from './messages.mjs';

const ESC = '\x1b[';
const RESET = `${ESC}0m`;
const STYLE = {
  bold: `${ESC}1m`, dim: `${ESC}2m`, title: `${ESC}1;97m`, warn: `${ESC}1;91m`, hold: `${ESC}93m`,
  button: `${ESC}48;5;238;97m`, off: `${ESC}48;5;236;90m`, selected: `${ESC}1;94m`, answered: `${ESC}42;30m`, open: `${ESC}48;5;238;37m`,
  field: `${ESC}4m`, tag: `${ESC}34m`, text: '',
};
const BAR = { high: `${ESC}91m`, medium: `${ESC}94m`, low: `${ESC}90m` };
const NOTES_SHOWN = 4;
export const BATCH = '__batch'; // the key of the batch note's text in `drafts` and of its focus

const newRow = () => ({ segs: [], hits: [], col: 0, caret: null });

function add(r, text, style = '', action = null) {
  const w = width(text);
  if (action) r.hits.push({ c0: r.col, c1: r.col + w, action });
  r.segs.push({ t: text, s: STYLE[style] ?? style });
  r.col += w;
  return r;
}

function finish(r, cols) {
  let used = 0;
  const segs = [];
  for (const seg of r.segs) {
    if (used >= cols) break;
    const t = used + width(seg.t) > cols ? cut(seg.t, cols - used) : seg.t;
    segs.push({ ...seg, t });
    used += width(t);
  }
  return {
    line: segs.map(s => s.t).join(''),
    styled: segs.map(s => (s.s ? `${s.s}${s.t}${RESET}` : s.t)).join(''),
    hits: r.hits.filter(h => h.c0 < cols).map(h => ({ ...h, c1: Math.min(h.c1, cols) })),
    caret: r.caret !== null && r.caret < cols ? r.caret : null,
  };
}

const draftText = q => q.draft?.text ?? '';
const isAnswered = q => Boolean(q.draft && (q.draft.choice || q.draft.text?.trim()));
const answerLabel = (q, t) => (q.draft?.choice || (draftText(q).trim() ? 'N' : t.none));
const clock = ms => `${String(Math.floor(ms / 60000)).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;
const oneLine = s => String(s).replace(/\s+/g, ' ').trim();
const btn = label => `[ ${label} ]`;

// A text field drawn inside a card. The visible part always contains the caret, so long text scrolls with typing.
function field(r, label, value, w, action, focused, pos) {
  add(r, `${label}: `, 'dim');
  const inner = Math.max(4, w - width(label) - 2);
  const chars = [...value];
  const before = chars.slice(0, pos ?? chars.length);
  let start = 0;
  while (width(before.slice(start).join('')) > inner - 1) start += 1;
  let shown = '';
  let used = 0;
  for (const ch of chars.slice(start)) {
    const cw = width(ch);
    if (used + cw > inner) break;
    shown += ch;
    used += cw;
  }
  const empty = !value && !focused;
  const text = empty ? '…' : shown;
  const c0 = r.col;
  add(r, text + ' '.repeat(Math.max(0, inner - width(text))), focused ? 'open' : empty ? 'dim' : 'field', action);
  if (focused) r.caret = c0 + width(before.slice(start).join(''));
}

function card(q, ctx) {
  const { t, cols, compact, model, drafts, focus } = ctx;
  const rows = [];
  const bar = BAR[q.priority] ?? BAR.medium;
  const inner = cols - 2;
  const row = () => { const r = newRow(); add(r, '▌ ', bar); rows.push(r); return r; };
  const base = { mailbox: model.mailbox.id, uid: q.uid, version: q.version };
  const buffer = drafts[q.uid];
  const value = buffer ?? draftText(q);
  const noteAction = { type: 'note-text', ...base, choice: q.draft?.choice ?? null, text: draftText(q) };
  const choose = (L, text) => ({ type: 'choose', ...base, choice: L, text });

  const head = row();
  const answerText = `${t.answer}: ${answerLabel(q, t)}`;
  const title = `${q.serial} · ${q.type === 'discussion' ? t.discussion : q.priority} · ${q.senderLabel}${q.edited ? ` · ${t.edited}` : ''}`;
  if (compact) {
    // Compact keeps the answer on the header line, so the lines below hold only the options and their buttons.
    const shown = cut(title, Math.max(8, inner - width(answerText) - 1));
    add(head, shown, 'bold');
    add(head, ' '.repeat(Math.max(1, inner - width(shown) - width(answerText))));
    add(head, answerText, isAnswered(q) ? 'answered' : 'dim');
  } else add(head, cut(title, inner), 'bold');
  if (q.tags?.length) add(row(), cut(q.tags.map(x => `#${x}`).join(' '), inner), 'tag');
  for (const line of wrap(q.content.question, inner)) add(row(), line, 'bold');

  if (q.type === 'decision') {
    const letters = 'ABCD';
    if (compact) {
      // Options are buttons in a row; Recommend and Explain sit at the right end of the last option row.
      const side = [[btn(t.recommendShort), { type: 'recommend', ...base, text: draftText(q) }], [btn(t.explainShort), { type: 'explain', ...base, text: draftText(q) }]];
      const sideWidth = side.reduce((n, [s]) => n + width(s) + 1, 0) - 1;
      let r = row();
      q.content.options.forEach((opt, i) => {
        const L = letters[i];
        const chosen = q.draft?.choice === L;
        const label = btn(`${L} ${cut(opt, 12)}${L === q.content.recommend ? '★' : ''}${chosen ? '✔' : ''}`);
        if (r.col + width(label) + 1 > cols && r.col > 2) r = row();
        add(r, label, chosen ? 'selected' : 'button', choose(L, draftText(q)));
        add(r, ' ');
      });
      if (r.col + sideWidth > cols) r = row();
      add(r, ' '.repeat(Math.max(1, cols - r.col - sideWidth)));
      side.forEach(([s, a], i) => { if (i) add(r, ' '); add(r, s, 'button', a); });
    } else {
      q.content.options.forEach((opt, i) => {
        const L = letters[i];
        const chosen = q.draft?.choice === L;
        const r = row();
        const line = `${chosen ? '●' : '○'}  ${L}  ${opt}${L === q.content.recommend ? ' ★' : ''}`;
        const shown = cut(line, inner);
        add(r, shown + ' '.repeat(inner - width(shown)), chosen ? 'selected' : '', choose(L, draftText(q)));
      });
    }
  } else if (q.content.idea) {
    for (const line of wrap(`${t.idea}: ${q.content.idea}`, inner)) add(row(), line, 'dim');
  }
  if (q.content.attach) add(row(), cut(`📎 ${q.content.attach.name}`, inner), 'tag', { type: 'attachment', mailbox: model.mailbox.id, uid: q.uid });
  if (q.draft?.reconfirm) {
    add(row(), cut(t.reconfirm, inner), 'hold');
    add(row(), btn(t.reconfirmButton), 'button', { type: 'reconfirm', ...base, choice: q.draft.choice, text: draftText(q) });
  }

  if (!compact) {
    const actions = row();
    if (q.type === 'decision') add(actions, btn(t.recommend), 'button', { type: 'recommend', ...base, text: draftText(q) });
    if (q.type === 'decision') add(actions, ' ');
    add(actions, btn(t.explain), 'button', { type: 'explain', ...base, text: draftText(q) });
    add(actions, '  ');
    add(actions, answerText, isAnswered(q) ? 'answered' : 'dim');
  } else if (q.type === 'discussion') {
    const r = row();
    add(r, ' '.repeat(Math.max(0, inner - width(btn(t.explainShort)))));
    add(r, btn(t.explainShort), 'button', { type: 'explain', ...base, text: draftText(q) });
  }

  const input = row();
  const isFocused = focus?.uid === q.uid;
  const reset = ` ${btn(t.reset)}`;
  field(input, q.type === 'decision' ? t.note : t.reply, value, inner - width(reset), noteAction, isFocused, isFocused ? focus.pos : undefined);
  add(input, reset, 'button', { type: 'reset', ...base });
  const spacer = newRow();
  rows.push(spacer);
  return rows;
}

function topRows(model, ctx) {
  const { t, cols, now } = ctx;
  const rows = [];
  const push = () => { const r = newRow(); rows.push(r); return r; };
  const { mailbox } = model;
  const title = push();
  add(title, cut(`📬 ${mailbox.id} · ${mailbox.label}`, cols), 'title');
  if (ctx.notice) add(push(), cut(`! ${ctx.notice}`, cols), 'warn');

  if (mailbox.state === 'disconnected') {
    add(push(), cut(t.disconnected(mailbox.disconnect?.reason ?? 'unbound'), cols), 'warn');
    add(push(), t.claimHint, 'dim');
    add(push(), `  ${mailbox.claim}`, 'bold');
    add(push(), cut(t.kept(model.notes.length, model.questions.filter(q => q.status === 'pending').length), cols), 'dim');
  }

  const head = push();
  let label = t.messages(model.notes.length);
  if (model.notes.length && mailbox.state === 'connected' && model.deliverAt && model.deliverAt > now) label += ` · ${t.deliverIn(clock(model.deliverAt - now))}`;
  add(head, label, 'bold');
  if (model.notes.length && mailbox.state === 'connected') {
    const button = btn(t.deliverNow);
    const into = head.col + 1 + width(button) <= cols ? head : push();
    if (into === head) add(head, ' ');
    add(into, button, 'button', { type: 'deliver-now', mailbox: mailbox.id });
  }
  for (const n of model.notes.slice(0, NOTES_SHOWN)) add(push(), cut(`${n.senderLabel} 💬 ${oneLine(n.text)}`, cols));
  if (model.notes.length > NOTES_SHOWN) add(push(), t.more(model.notes.length - NOTES_SHOWN), 'dim');
  if (!model.notes.length) add(push(), t.noMessages, 'dim');
  // A disconnected mailbox delivers nothing, so it says so instead of counting down.
  if (mailbox.state !== 'connected') add(push(), cut(t.pausedDisconnected, cols), 'hold');
  else if (model.paused) add(push(), cut(t.paused[model.paused.reason] ?? t.pausedOther(model.paused.reason), cols), 'hold');

  for (const b of model.batches.filter(x => x.status === 'unconfirmed')) {
    add(push(), cut(t.unconfirmed(b.id), cols), 'hold');
    add(push(), `  ${btn(t.markDelivered)}`, 'button', { type: 'resolve-batch', mailbox: mailbox.id, batch: b.id, action: 'delivered' });
    add(push(), `  ${btn(t.resend)}`, 'button', { type: 'resolve-batch', mailbox: mailbox.id, batch: b.id, action: 'resend' });
  }
  return rows;
}

function questionRows(model, ctx) {
  const { t, cols, compact } = ctx;
  const rows = [];
  const pending = model.questions.filter(q => q.status === 'pending');
  const head = newRow();
  add(head, t.questions(pending.length, pending.filter(isAnswered).length), 'bold');
  const mode = btn(compact ? t.detailed : t.compact);
  const gear = btn(t.settings);
  const room = cols - head.col - width(mode) - width(gear) - 2;
  // On a narrow pane the two buttons move to a row of their own instead of disappearing.
  const into = room >= 0 ? head : newRow();
  if (room >= 0) add(head, ' '.repeat(room + 1));
  add(into, mode, 'button', { type: 'card-mode', mailbox: model.mailbox.id, mode: compact ? 'detailed' : 'compact' });
  add(into, ' ');
  add(into, gear, 'button', { type: 'settings', mailbox: model.mailbox.id });
  rows.push(head);
  if (into !== head) rows.push(into);
  if (!model.questions.length) rows.push(add(newRow(), t.empty, 'dim'));
  for (const q of model.questions) {
    if (q.status === 'pending') rows.push(...card(q, ctx));
    else rows.push(add(newRow(), t.sent(q.serial), 'dim'));
  }
  return rows;
}

function bottomRows(model, ctx) {
  const { t, cols, drafts } = ctx;
  const rows = [];
  const push = () => { const r = newRow(); rows.push(r); return r; };
  const mailbox = model.mailbox.id;
  const pending = model.questions.filter(q => q.status === 'pending');
  const open = pending.filter(q => !isAnswered(q));
  const ready = pending.filter(q => isAnswered(q) && !q.draft.reconfirm);
  const rule = `── ${t.batch} `;
  add(push(), rule + '─'.repeat(Math.max(0, cols - width(rule))), 'dim');

  const bulkRow = push();
  // Questions with a note typed but not saved yet are left out, so the batch note never replaces one.
  const free = open.filter(q => !drafts[q.uid]?.trim());
  const recs = free.filter(q => q.type === 'decision');
  const exps = free;
  const note = drafts[BATCH]?.trim() ? drafts[BATCH] : '';
  const withNote = (type, list) => ({ type, mailbox, uids: list.map(q => q.uid), text: note });
  add(bulkRow, btn(t.allRecommend), recs.length ? 'button' : 'off', recs.length ? withNote('bulk-recommend', recs) : null);
  add(bulkRow, ' ');
  add(bulkRow, btn(t.allExplain), exps.length ? 'button' : 'off', exps.length ? withNote('bulk-explain', exps) : null);

  const noteRow = push();
  const isFocused = ctx.focus?.uid === BATCH;
  field(noteRow, t.note, drafts[BATCH] ?? '', cols, { type: 'batch-note', mailbox }, isFocused, isFocused ? ctx.focus.pos : undefined);
  if (note) {
    const names = list => (list.length ? list.map(q => q.serial).join(' ') : t.none);
    add(push(), cut(`→ ${t.allRecommend}: ${names(recs)}`, cols), 'dim');
    add(push(), cut(`→ ${t.allExplain}: ${names(exps)}`, cols), 'dim');
  }

  let why = null;
  if (model.mailbox.state !== 'connected') why = t.whyDisconnected;
  else if (model.inputState === 'typing') why = t.whyTyping;
  else if (model.inputState !== 'empty') why = t.whyUnknown;
  else if (!ready.length) why = t.whyNothing;
  const confirm = push();
  add(confirm, btn(t.confirm), why ? 'off' : 'answered', why ? null : { type: 'submit', mailbox, items: ready.map(q => ({ uid: q.uid, version: q.version })) });
  add(confirm, ' ');
  const answeredNow = pending.filter(isAnswered);
  add(confirm, btn(t.resetAll), answeredNow.length ? 'button' : 'off', answeredNow.length ? { type: 'reset-all', mailbox, items: answeredNow.map(q => ({ uid: q.uid, version: q.version })) } : null);
  if (why) add(push(), cut(`  ${t.disabled(why)}`, cols), 'hold');
  return rows;
}

export function render(model, { cols = 48, rows = 40, cardMode = model.prefs?.cardMode ?? 'detailed', locale = 'en', scroll = 0, focus = null, drafts = {}, notice = null, now = Date.now() } = {}) {
  const ctx = { t: screenText(locale), cols, compact: cardMode === 'compact', model, drafts, focus, notice, now };
  const top = topRows(model, ctx);
  const mid = questionRows(model, ctx);
  const bottom = bottomRows(model, ctx);
  const budget = Math.max(3, rows - top.length - bottom.length);
  const scrollMax = Math.max(0, mid.length - budget);
  const from = Math.min(Math.max(0, scroll), scrollMax);
  const shown = mid.slice(from, from + budget);
  while (shown.length < budget) shown.push(newRow());

  const lines = [];
  const styled = [];
  const hits = [];
  let cursor = null;
  [...top, ...shown, ...bottom].forEach((r, row) => {
    const out = finish(r, cols);
    lines.push(out.line);
    styled.push(out.styled);
    for (const h of out.hits) hits.push({ row, c0: h.c0, c1: h.c1, action: h.action });
    if (out.caret !== null) cursor = { row, col: out.caret };
  });
  return { lines, styled, hits, cursor, scrollMax, scroll: from };
}
