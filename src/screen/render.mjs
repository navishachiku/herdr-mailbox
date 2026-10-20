// The screen as data: render(model, options) → plain lines, the same lines with colors, and the clickable areas.
// Pure, so it can be tested without a terminal. `model` is the daemon's `view` answer.
// Look: solid colour blocks. Buttons are one row of background colour with a column of padding on each side, never
// bracketed text; adjacent clickable things keep a column apart; the hovered one gets a brighter background.
import { width, cut, wrap, charWidth } from './text.mjs';
import { screenText } from './messages.mjs';
import { feedbackFor } from './feedback.mjs';

const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const P = {
  text: hex('#d7dae0'), dim: hex('#7d8590'), faint: hex('#4b5160'), white: hex('#ffffff'), surface: hex('#252932'),
  btn: hex('#3b414d'), btnHover: hex('#566074'), primary: hex('#2f7de1'), primaryHover: hex('#4a93f0'),
  off: hex('#2a2e36'), offText: hex('#5c6370'), accent: hex('#6cb2ff'), rowHover: hex('#2c313b'),
  field: hex('#1b1e25'), fieldHover: hex('#262b35'), fieldFocus: hex('#303644'),
  chipBg: hex('#1e3a5c'), chipText: hex('#a9cdff'), okBg: hex('#2ea043'), okText: hex('#0d1117'),
  hold: hex('#d29922'), amber: hex('#e5b567'), star: hex('#ffd43b'), warn: hex('#e5534b'), high: hex('#e5534b'), medium: hex('#4c8dff'), low: hex('#8b949e'),
};
// Style objects; sgr() turns one into an escape sequence. A segment's `h` is how it looks while hovered.
const S = {
  plain: {}, text: { fg: P.text }, bold: { fg: P.text, bold: true }, dim: { fg: P.dim }, rule: { fg: P.faint },
  title: { fg: P.text, bg: P.surface, bold: true }, serial: { fg: P.white, bold: true }, sender: { fg: P.amber }, warn: { fg: P.warn, bold: true }, hold: { fg: P.hold },
  button: { fg: P.text, bg: P.btn }, buttonHover: { fg: P.white, bg: P.btnHover, bold: true },
  primary: { fg: P.white, bg: P.primary, bold: true }, primaryHover: { fg: P.white, bg: P.primaryHover, bold: true },
  off: { fg: P.offText, bg: P.off }, failed: { fg: P.warn, bg: P.off, bold: true }, star: { fg: P.star, bold: true },
  chosen: { fg: P.accent, bold: true }, letter: { fg: P.text, bg: P.btn, bold: true }, letterChosen: { fg: P.white, bg: P.primary, bold: true }, chosenButton: { fg: P.white, bg: P.primary, bold: true },
  field: { fg: P.text, bg: P.field }, fieldEmpty: { fg: P.dim, bg: P.field }, fieldHover: { fg: P.text, bg: P.fieldHover },
  fieldFocus: { fg: P.white, bg: P.fieldFocus },
  link: { fg: P.accent, ul: true }, linkHover: { fg: P.white, bg: P.rowHover, ul: true, bold: true },
  chip: { fg: P.chipText, bg: P.chipBg }, ok: { fg: P.okText, bg: P.okBg, bold: true }, no: { fg: P.dim, bg: P.btn },
};
const withBg = (s, bg) => ({ ...s, bg });

// Animation helpers. Fading mixes colours toward the terminal background (a dark grey is assumed, the terminal's
// real background cannot be read); `fx` holds the progress 0 → 1 of each running animation, by key.
const BG = hex('#1f1f1f');
const mix = (a, b, k) => a.map((v, i) => Math.round(v + (b[i] - v) * k));
const fade = (s, a) => (a >= 1 || !s ? s : { ...s, fg: mix(BG, s.fg ?? P.text, a), ...(s.bg ? { bg: mix(BG, s.bg, a) } : {}) });
// The arrival highlight: every row gets a clearly lit background (a dark tone of `tone`) that fades back to the
// plain background; buttons and chips keep their own colour.
const highlight = (rows, tone, k) => { const bg = mix(mix(tone, BG, 0.5), BG, k); rows.forEach(r => { r.segs = r.segs.map(x => (x.s?.bg ? x : { ...x, s: { ...(x.s ?? {}), bg } })); }); };
// Slides rows `k` columns to the right, cutting what passes the right edge. A wide character that would be cut in
// half is drawn as a blank instead, so no half glyph ever shows. Clickable areas move with their content.
function slide(rows, k, cols) {
  if (k <= 0) return rows;
  return rows.map(r => {
    const out = newRow();
    out.caret = null;
    gap(out, Math.min(k, cols));
    const room = cols - out.col;
    let used = 0;
    for (const x of r.segs) {
      if (used >= room) break;
      let text = '';
      for (const ch of x.t) {
        const cw = charWidth(ch);
        if (used + cw > room) { if (used < room) { text += ' '; used += 1; } break; }
        text += ch;
        used += cw;
      }
      out.segs.push({ ...x, t: text });
    }
    out.col += used;
    out.hits = r.hits.filter(h => h.c0 + k < cols).map(h => ({ ...h, c0: h.c0 + k, c1: Math.min(cols, h.c1 + k), i0: h.i0 + 1, i1: h.i1 + 1 }));
    out.blocks = r.blocks.map(b => ({ c0: b.c0 + k, c1: Math.min(cols, b.c1 + k) })).filter(b => b.c0 < cols);
    return out;
  });
}
const fadeRows = (rows, a) => { if (a < 1) rows.forEach(r => { r.segs = r.segs.map(x => ({ ...x, s: fade(x.s, a), h: x.h && fade(x.h, a) })); }); };
// Rows that grow in or shrink away; while the receiver is typing nothing moves, only colours change.
const grow = (rows, p, fx) => (fx.noShift || p >= 1 ? rows : rows.slice(0, Math.max(1, Math.ceil(rows.length * p))));

function sgr(s) {
  const p = [];
  if (s.bold) p.push('1');
  if (s.ul) p.push('4');
  if (s.strike) p.push('9');
  if (s.fg) p.push(`38;2;${s.fg.join(';')}`);
  if (s.bg) p.push(`48;2;${s.bg.join(';')}`);
  return p.length ? `\x1b[${p.join(';')}m` : '';
}

const NOTES_SHOWN = 4;
const IDLE_MS = 3000; // no mouse movement or typing for this long counts as idle
export const BATCH = '__batch'; // the key of the batch note's text in `drafts` and of its focus

// ---------- rows and items ----------
// A row is { segs: [{ t, s, h }], hits: [{ c0, c1, i0, i1, action }], col, caret }.
// An item is { segs, action?, caret? } and is placed whole; caret is a column offset inside the item.
const newRow = () => ({ segs: [], hits: [], blocks: [], tips: [], col: 0, caret: null });
const seg = (t, s = S.plain, h) => ({ t, s, h });
const item = (segs, action = null, caret = null) => ({ segs, action, caret });
const textItem = (t, s = S.text) => item([seg(t, s)]);
// Text cut to n columns. When something was cut the item carries the full text as `tip`, so hovering it can show
// the whole thing (see the tooltip in render()).
const clipItem = (text, n, s = S.text) => { const shown = cut(text, n); const it = textItem(shown, s); if (shown !== text) it.tip = text.trim(); return it; };
const itemWidth = it => it.segs.reduce((n, x) => n + width(x.t), 0);

function place(r, it) {
  const c0 = r.col;
  const i0 = r.segs.length;
  for (const x of it.segs) { r.segs.push(x); r.col += width(x.t); }
  if (it.action) r.hits.push({ c0, c1: r.col, i0, i1: r.segs.length, action: it.action, group: it.group });
  // Disabled buttons still look like buttons, so they keep their distance too.
  if (it.action || it.block) r.blocks.push({ c0, c1: r.col });
  if (it.caret !== null && it.caret !== undefined) r.caret = c0 + it.caret;
  if (it.tip) r.tips.push({ c0, c1: r.col, text: it.tip });
}
const gap = (r, n = 1, s = S.plain) => { if (n > 0) { r.segs.push(seg(' '.repeat(n), s)); r.col += n; } };

// Lays items out left to right with one free column between them, starting a new row when the next one would not
// fit. `right` items go flush right on the last row, or on a row of their own when there is no room.
function flow(mkRow, w, left, right = [], fill = S.plain) {
  const rows = [];
  let r = mkRow();
  rows.push(r);
  const start = r.col;
  let x = 0;
  for (const it of left) {
    const iw = itemWidth(it);
    if (x > 0 && x + 1 + iw > w) { r = mkRow(); rows.push(r); x = 0; }
    if (x > 0) { gap(r, 1, fill); x += 1; }
    place(r, it);
    x += iw;
  }
  if (right.length) {
    const rw = right.reduce((n, it) => n + itemWidth(it), 0) + right.length - 1;
    if (x > 0 && x + 1 + rw > w) { r = mkRow(); rows.push(r); x = 0; }
    gap(r, w - x - rw, fill);
    right.forEach((it, i) => { if (i) gap(r, 1, fill); place(r, it); });
  }
  for (const row of rows) gap(row, start + w - row.col, fill);
  return rows;
}

// The feedback of the operation in flight, set by render() for the frame being drawn (render is synchronous).
let FB = { t: null, look: () => null };

// A button. While its operation is in flight it is drawn disabled with what is happening instead of its label:
// processing, delivering, waiting (and why), the result for 2 seconds, or the failure reason.
const button = (label, action, kind = 'button') => {
  const look = FB.look(action);
  if (look) return { ...item([seg(` ${FB.label(look)} `, look.state === 'failed' ? S.failed : S.off)]), block: true };
  if (!action) return { ...item([seg(` ${label} `, S.off)]), block: true };
  const [s, h] = kind === 'primary' ? [S.primary, S.primaryHover] : kind === 'chosen' ? [S.chosenButton, S.primaryHover] : [S.button, S.buttonHover];
  return item([seg(` ${label} `, s, h)], action);
};

// A one-line text field. It keeps a column of padding on each side; the visible part always contains the caret.
function fieldItem(value, w, action, focused, pos, placeholder = '…') {
  const inner = Math.max(2, w - 2);
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
  const text = empty ? cut(placeholder, inner) : shown;
  const s = focused ? S.fieldFocus : empty ? S.fieldEmpty : S.field;
  return item([seg(` ${text}${' '.repeat(Math.max(0, inner - width(text)))} `, s, focused ? S.fieldFocus : S.fieldHover)],
    action, focused ? 1 + width(before.slice(start).join('')) : null);
}

const draftText = q => q.draft?.text ?? '';
const isAnswered = q => Boolean(q.draft && (q.draft.choice || q.draft.text?.trim()));
const answerLabel = (q, t) => (q.draft?.choice || (draftText(q).trim() ? 'N' : t.none));
const clock = ms => `${String(Math.floor(ms / 60000)).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;
const oneLine = s => String(s).replace(/\s+/g, ' ').trim();

// ---------- cards ----------
function card(q, ctx) {
  const { t, cols, compact, model, drafts, focus } = ctx;
  const rows = [];
  const bar = { fg: P[q.priority] ?? P.medium };
  const w = cols - 1; // after the one-column priority bar
  const mkRow = () => { const r = newRow(); r.segs.push(seg('▌', bar)); r.col = 1; return r; };
  const add = (left, right) => rows.push(...flow(mkRow, w, left, right));
  const blank = () => rows.push(...flow(mkRow, w, []));
  const base = { mailbox: model.mailbox.id, uid: q.uid, version: q.version };
  const choose = L => ({ type: 'choose', ...base, choice: L, text: draftText(q) });
  // Void answers X ("no answer needed") and sends this one question at once.
  const voidButton = button(t.void, { type: 'void', ...base, text: draftText(q) });
  const chip = isAnswered(q) ? textItem(` ${t.answer}: ${answerLabel(q, t)} `, S.ok) : textItem(` ${t.answer}: ${answerLabel(q, t)} `, S.no);

  // Header: only the serial (white) and the sender (bright amber). No priority word: the colour bar already says it.
  // Amber stays clear of the red and green bars for a red-green colour-blind reader by being much brighter, and of
  // the blue medium bar by hue.
  const room = Math.max(4, w - width(` ${q.serial} · `));
  const headItem = item([seg(` ${q.serial}`, S.serial), seg(' · ', S.dim), seg(cut(q.senderLabel, room), S.sender)]);
  if (cut(q.senderLabel, room) !== q.senderLabel) headItem.tip = `${q.serial} · ${q.senderLabel}`;
  add([headItem]);
  if (q.tags?.length) add(q.tags.map(x => textItem(` #${x} `, S.chip)));
  // Compact mode keeps the same layout and only shortens content: the question to three rows, the third ending in
  // "…", every row carrying the full question for the tooltip.
  let questionLines = wrap(q.content.question, w - 2);
  if (compact && questionLines.length > 3) {
    const third = questionLines.slice(2).join(' ');
    questionLines = [...questionLines.slice(0, 2), cut(third, w - 3) === third ? `${cut(third, w - 4)}…` : cut(third, w - 3)];
  }
  const shortened = questionLines.join('') !== wrap(q.content.question, w - 2).join('');
  for (const l of questionLines) add([{ ...textItem(` ${l}`, S.bold), ...(shortened ? { tip: q.content.question } : {}) }]);

  if (q.type === 'decision') {
    const letters = 'ABCD';
    blank(); // the question stands a row apart from its options
    // Options: ★ (bright yellow, the recommended one) or a blank, then the letter as a small coloured block, then the
    // option text. Detailed mode wraps long text in full, continuation lines starting under the first line's text;
    // all of an option's rows are one clickable group that lights up together. Compact mode keeps each option to one
    // row ending in "…", with the full text in a tooltip. Picking an option recolours its letter block.
    const letter = (L, chosen) => seg(` ${L} `, chosen ? S.letterChosen : S.letter, chosen ? S.letterChosen : S.buttonHover);
    const group = rowsOf => rowsOf.forEach(r => { r.group = q.uid; });
    const optionRows = (opt, i) => {
      const L = letters[i];
      const chosen = q.draft?.choice === L;
      const pending = FB.look(choose(L));
      const action = pending ? null : choose(L);
      const s = pending ? S.dim : chosen ? S.chosen : S.text;
      const h = withBg(s, P.rowHover);
      const lead = [seg(' ', s, h), L === q.content.recommend ? seg('★', S.star, withBg(S.star, P.rowHover)) : seg(' ', s, h), seg(' ', s, h), letter(L, chosen), seg(' ', s, h)];
      const indent = lead.reduce((n, x) => n + width(x.t), 0);
      const room = Math.max(4, w - indent - 1);
      const lines = compact ? [cut(opt, room)] : wrap(opt, room);
      const fill = segs => [...segs, seg(' '.repeat(Math.max(1, w - segs.reduce((n, x) => n + width(x.t), 0))), s, h)];
      const rowsOf = [item(fill([...lead, seg(lines[0], s, h)]), action), ...lines.slice(1).map(l => item(fill([seg(' '.repeat(indent), s, h), seg(l, s, h)]), action))];
      rowsOf.forEach(it => { it.group = `${q.uid}:${L}`; });
      if (lines[0] !== opt && compact) rowsOf[0].tip = opt;
      return rowsOf;
    };
    const at = rows.length;
    q.content.options.forEach((opt, i) => { for (const it of optionRows(opt, i)) add([it]); });
    group(rows.slice(at));
  } else if (q.content.idea) {
    for (const l of wrap(`${t.idea}: ${q.content.idea}`, w - 2)) add([textItem(` ${l}`, S.dim)]);
  }
  (q.content.attachments ?? (q.content.attach ? [q.content.attach] : [])).forEach((a, index) => {
    const open = { type: 'attachment', mailbox: model.mailbox.id, uid: q.uid, ...(index ? { index } : {}) };
    const look = FB.look(open);
    add([look ? textItem(` 📎 ${cut(FB.label(look), w - 6)} `, S.off) : { ...item([seg(` 📎 ${cut(a.name, w - 6)} `, S.link, S.linkHover)], open), ...(cut(a.name, w - 6) !== a.name ? { tip: a.name } : {}) }]);
  });
  if (q.draft?.reconfirm) {
    add([clipItem(` ${t.reconfirm}`, w - 1 + 1, S.hold)]);
    add([button(t.reconfirmButton, { type: 'reconfirm', ...base, choice: q.draft.choice, text: draftText(q) })]);
  }

  blank();
  const actions = q.type === 'decision'
    ? [button(t.recommend, { type: 'recommend', ...base, text: draftText(q) }), button(t.explain, { type: 'explain', ...base, text: draftText(q) }), voidButton]
    : [button(t.explain, { type: 'explain', ...base, text: draftText(q) }), voidButton];
  add(actions, [chip]);

  const isFocused = focus?.uid === q.uid;
  const label = textItem(` ${q.type === 'decision' ? t.note : t.reply}`, S.dim);
  const reset = button(t.reset, { type: 'reset', ...base });
  const fw = w - itemWidth(label) - itemWidth(reset) - 2;
  const note = { type: 'note-text', ...base, choice: q.draft?.choice ?? null, text: draftText(q) };
  // While a typed note is being saved the field shows it is busy and takes no clicks.
  const saving = FB.look(note);
  add([label, saving ? textItem(` ${cut(FB.label(saving), fw - 2)}`.padEnd(fw), S.off) : fieldItem(drafts[q.uid] ?? draftText(q), fw, note, isFocused, isFocused ? focus.pos : undefined, q.type === 'decision' ? t.notePlaceholder : t.replyPlaceholder), reset]);
  return rows;
}

// A card with its running effects: grows in when it arrives (and when the card mode changes), its colour bar
// lights up and fades back, and an option that was just picked flashes.
function liveCard(q, ctx) {
  const { fx } = ctx;
  let rows = card(q, ctx);
  if (fx.mode !== undefined) rows = grow(rows, fx.mode, fx);
  const glow = fx[`glow:${q.uid}`];
  if (glow !== undefined) {
    const tone = P[q.priority] ?? P.medium;
    highlight(rows, tone, glow);
    rows.forEach(r => { r.segs[0] = { ...r.segs[0], s: { fg: mix(P.white, tone, glow), bg: r.segs[0].s?.bg } }; });
  }
  for (const [key, p] of Object.entries(fx)) {
    if (!key.startsWith(`pick:${q.uid}:`)) continue;
    const choice = key.slice(key.lastIndexOf(':') + 1);
    for (const r of rows) {
      const hit = r.hits.find(h => h.action.type === 'choose' && h.action.choice === choice);
      if (hit) r.segs = r.segs.map((x, i) => (i >= hit.i0 && i < hit.i1 ? { ...x, s: { ...x.s, bg: mix(P.accent, x.s.bg ?? BG, 0.6 + 0.4 * p) } } : x));
    }
  }
  // Arriving: the whole card, highlight and all, slides in from the right edge.
  const enter = fx[`enter:${q.uid}`];
  if (enter !== undefined) rows = slide(rows, Math.round((1 - enter) * ctx.cols), ctx.cols);
  return rows;
}

// A question on its way out. Sent: the bar flashes green first. Withdrawn: the text is struck through and dimmed
// first, so the two never differ by colour alone. Then it slides out and folds.
function ghostCard(q, ctx) {
  const { fx } = ctx;
  const p = fx[`leave:${q.uid}`] ?? 0;
  let rows = card(q, ctx);
  rows.forEach(r => { r.hits = []; });
  if (q.ghost === 'withdrawn') rows.forEach(r => { r.segs = r.segs.map((x, i) => (i ? { ...x, s: { ...x.s, strike: true }, h: undefined } : x)); });
  else rows.forEach(r => { r.segs[0] = { ...r.segs[0], s: { fg: P.okBg } }; });
  if (q.ghost === 'withdrawn') fadeRows(rows, 0.5);
  return leaving(rows, q.uid, ctx);
}

// Leaving: slide out to the right (sent and withdrawn ones have already shown their 150 ms cue), then the emptied
// rows fold away. While the receiver is typing the rows stay until the end instead of folding.
function leaving(rows, uid, ctx) {
  const { fx, cols } = ctx;
  const fold = fx[`fold:${uid}`];
  const p = fx[`leave:${uid}`] ?? (fold !== undefined ? 1 : 0);
  rows = slide(rows, Math.round(p * cols), cols);
  if (fold !== undefined) rows = grow(rows, 1 - fold, fx);
  return rows;
}

// Puts each ghost back before the item it was anchored to (or at the end when nothing after it is left).
function insertGhosts(list, ghosts) {
  for (const g of ghosts) {
    const at = g.next ? list.findIndex(x => x.uid === g.next) : -1;
    list.splice(at < 0 ? list.length : at, 0, { ...g.q, ghost: g.kind });
  }
  return list;
}

// ---------- regions ----------
function topRows(model, ctx) {
  const { t, cols, now } = ctx;
  const rows = [];
  const mk = () => newRow();
  const add = (left, right, fill) => rows.push(...flow(mk, cols, left, right, fill));
  const { mailbox } = model;
  add([clipItem(` 📬 ${mailbox.id} · ${mailbox.label}`, cols - 1, S.title)], [], S.title);
  if (ctx.notice) add([clipItem(` ${`! ${ctx.notice}`}`, cols - 1 + 1, S.warn)]);

  if (mailbox.state === 'disconnected') {
    add([clipItem(` ${t.disconnected(mailbox.disconnect?.reason ?? 'unbound')}`, cols - 1 + 1, S.warn)]);
    add([textItem(` ${t.claimHint}`, S.dim)]);
    add([textItem(`   ${mailbox.claim}`, S.bold)]);
    add([clipItem(` ${t.kept(model.notes.length, model.questions.filter(q => q.status === 'pending').length)}`, cols - 1 + 1, S.dim)]);
  }
  add([]);

  let label = ` ${t.messages(model.notes.length)}`;
  if (model.notes.length && mailbox.state === 'connected' && model.deliverAt && model.deliverAt > now) label += ` · ${t.deliverIn(clock(model.deliverAt - now))}`;
  // The button stays while its own delivery is still being reported (delivering, waiting, Delivered), even after
  // the messages it sent have left the list.
  const deliverAction = { type: 'deliver-now', mailbox: mailbox.id };
  const deliver = (model.notes.length || FB.look(deliverAction)) && mailbox.state === 'connected' ? [button(t.deliverNow, deliverAction)] : [];
  add([textItem(label, S.bold)], deliver);
  add([]); // the heading stands a row apart from the messages under it
  const notes = insertGhosts([...model.notes], ctx.ghosts.filter(g => g.kind === 'delivered'));
  for (const n of notes.slice(0, NOTES_SHOWN)) {
    const at = rows.length;
    add([clipItem(` ${n.senderLabel} 💬 ${oneLine(n.text)}`, cols, S.text)]);
    if (n.ghost) {
      rows.splice(at, rows.length - at, ...leaving(rows.slice(at), n.uid, ctx));
      continue;
    }
    // A new message slides in from the right on a highlighted row that fades back over 2.5 seconds.
    let mine = rows.slice(at);
    const glow = ctx.fx[`glow:${n.uid}`];
    if (glow !== undefined) highlight(mine, P.medium, glow);
    const enter = ctx.fx[`enter:${n.uid}`];
    if (enter !== undefined) mine = slide(mine, Math.round((1 - enter) * cols), cols);
    rows.splice(at, rows.length - at, ...mine);
  }
  if (model.notes.length > NOTES_SHOWN) add([textItem(` ${t.more(model.notes.length - NOTES_SHOWN)}`, S.dim)]);
  if (!model.notes.length) add([textItem(` ${t.noMessages}`, S.dim)]);
  // A disconnected mailbox delivers nothing, so it says so instead of counting down.
  if (mailbox.state !== 'connected') add([clipItem(` ${t.pausedDisconnected}`, cols - 1 + 1, S.hold)]);
  else if (model.paused) add([clipItem(` ${t.paused[model.paused.reason] ?? t.pausedOther(model.paused.reason)}`, cols - 1 + 1, S.hold)]);

  for (const b of model.batches.filter(x => x.status === 'unconfirmed')) {
    add([clipItem(` ${t.unconfirmed(b.id)}`, cols - 1 + 1, S.hold)]);
    add([
      button(t.markDelivered, { type: 'resolve-batch', mailbox: mailbox.id, batch: b.id, action: 'delivered' }),
      button(t.resend, { type: 'resolve-batch', mailbox: mailbox.id, batch: b.id, action: 'resend', confirm: t.resendConfirm(b.id, b.members) }),
    ]);
  }
  add([]);
  return rows;
}

function questionRows(model, ctx) {
  const { t, cols, compact } = ctx;
  const rows = [];
  const add = (left, right) => rows.push(...flow(newRow, cols, left, right));
  const pending = model.questions.filter(q => q.status === 'pending');
  // The mode button keeps one width in both modes, so switching never moves the header or the cards below it.
  const modeWidth = Math.max(width(t.compact), width(t.detailed));
  const modeText = compact ? t.detailed : t.compact;
  const modeLabel = modeText + ' '.repeat(modeWidth - width(modeText));
  add([textItem(` ${t.questions(pending.length, pending.filter(isAnswered).length)}`, S.bold)], [
    button(modeLabel, { type: 'card-mode', mailbox: model.mailbox.id, mode: compact ? 'detailed' : 'compact' }),
    button(t.settings, { type: 'settings', mailbox: model.mailbox.id }),
  ]);
  add([]);
  // The heading and the free row under it stay pinned at the top of the decision area while the cards scroll.
  rows.forEach(r => { r.sticky = true; });
  if (!model.questions.length) add([textItem(` ${t.empty}`, S.dim)]);
  // Questions that just left (sent or withdrawn) stay in place as ghosts while they fade and fold away.
  const shown = [...model.questions];
  insertGhosts(shown, ctx.ghosts.filter(g => g.kind !== 'delivered'));
  shown.forEach((q, i) => {
    if (q.ghost) rows.push(...ghostCard(q, ctx));
    else if (q.status === 'pending') {
      const at = rows.length;
      rows.push(...liveCard(q, ctx));
      if (rows[at]) rows[at].cardStart = q.uid; // where the card begins, for scrolling to a new one
    }
    else add([textItem(` ${t.sent(q.serial)}`, S.dim)]);
    if (i < shown.length - 1) {
      add([]);
      add([textItem('─'.repeat(cols), S.rule)]);
      add([]);
    }
  });
  return rows;
}

// The batch bar: one row of actions; the note field opens below it on demand. The counts under it say what each
// action covers: the batch buttons touch only unanswered questions, Confirm sends only answered ones.
function bottomRows(model, ctx) {
  const { t, cols, drafts, batchOpen } = ctx;
  const rows = [];
  const add = (left, right) => rows.push(...flow(newRow, cols, left, right));
  const mailbox = model.mailbox.id;
  const pending = model.questions.filter(q => q.status === 'pending');
  const open = pending.filter(q => !isAnswered(q));
  const ready = pending.filter(q => isAnswered(q) && !q.draft.reconfirm);
  // Questions with a note typed but not saved yet are left out, so the batch note never replaces one.
  const free = open.filter(q => !drafts[q.uid]?.trim());
  const recs = free.filter(q => q.type === 'decision');
  const note = drafts[BATCH]?.trim() ? drafts[BATCH] : '';
  const withNote = (type, list) => ({ type, mailbox, uids: list.map(q => q.uid), text: note });
  const answeredNow = pending.filter(isAnswered);

  const resetAll = button(t.resetAll, answeredNow.length ? { type: 'reset-all', mailbox, items: answeredNow.map(q => ({ uid: q.uid, version: q.version })) } : null);
  // Void all sends every unsent question, drafts included, as X; the screen asks first (see main.mjs).
  const voidAll = button(t.voidAll, pending.length ? {
    type: 'void-all', mailbox, items: pending.map(q => ({ uid: q.uid, version: q.version })), confirm: t.voidAllConfirm(pending.length),
  } : null);
  const title = `── ${t.batch} `;
  add([textItem(title + '─'.repeat(Math.max(0, cols - width(title) - itemWidth(voidAll) - itemWidth(resetAll) - 2)), S.rule)], [voidAll, resetAll]);
  if (ctx.confirmPrompt) {
    add([clipItem(` ${ctx.confirmPrompt}`, cols - 1 + 1, S.warn)]);
    add([button(t.yes, { type: 'confirm-yes', mailbox }, 'primary'), button(t.no, { type: 'confirm-no', mailbox })]);
  }

  let why = null;
  if (model.mailbox.state !== 'connected') why = t.whyDisconnected;
  else if (model.inputState === 'typing') why = t.whyTyping;
  else if (model.inputState !== 'empty') why = t.whyUnknown;
  else if (!ready.length) why = t.whyNothing;
  const confirm = button(t.confirm, why ? null : { type: 'submit', mailbox, items: ready.map(q => ({ uid: q.uid, version: q.version })) }, 'primary');
  add([
    button(t.allRecommend, recs.length ? withNote('bulk-recommend', recs) : null),
    button(t.allExplain, free.length ? withNote('bulk-explain', free) : null),
    button(batchOpen ? t.collapse : t.note, { type: 'batch-toggle', mailbox }),
  ], [confirm]);

  if (batchOpen) {
    const isFocused = ctx.focus?.uid === BATCH;
    const at = rows.length;
    add([fieldItem(drafts[BATCH] ?? '', cols, { type: 'batch-note', mailbox }, isFocused, isFocused ? ctx.focus.pos : undefined, t.notePlaceholder)]);
    const a = ctx.fx['batch-open'] ?? (ctx.fx['batch-close'] !== undefined ? 1 - ctx.fx['batch-close'] : 1);
    fadeRows(rows.slice(at), a);
  }
  add([]);
  add([clipItem(` ${t.batchCounts(free.length, ready.length)}`, cols - 1 + 1, S.dim)]);
  if (batchOpen && free.length) add([clipItem(` ${t.appliesTo(free.map(q => q.serial).join(' '))}`, cols - 1 + 1, S.dim)]);
  if (why) add([clipItem(` ${`${t.confirm} ${t.disabled(why)}`}`, cols - 1 + 1, S.dim)]);
  return rows;
}

// ---------- in-pane layer (settings, attachment) ----------
// A box drawn over the middle of the screen. While it is open only its own controls are clickable, and keys go to
// it (main.mjs). Blue-grey, never red next to green.
const BOX = { fg: P.text, bg: hex('#2b3245') };
const BOX_TITLE = { fg: P.white, bg: hex('#2b3245'), bold: true };
const BOX_DIM = { fg: hex('#9aa3b5'), bg: hex('#2b3245') };
const BOX_EDGE = { fg: hex('#8fa3c7'), bg: hex('#2b3245') };
const MERGE_STEP = 10;
const TOOLTIP_STEP = 5; // prefs.mjs TOOLTIP
const WIDTH_STEP = 4;

function overlayRows(overlay, ctx, height) {
  const { t } = ctx;
  const cols = ctx.cols - 2; // inside the border
  const rows = [];
  const add = (left, right) => rows.push(...flow(newRow, cols, left, right, BOX));
  const title = overlay.kind === 'settings' ? t.settingsTitle : `📎 ${overlay.name}`;
  add([clipItem(` ${title}`, cols - itemWidth(button(t.close, { type: 'overlay-close' })) - 1, BOX_TITLE)], [button(t.close, { type: 'overlay-close' })]);
  add([]);
  let top = 0;
  if (overlay.kind === 'settings') {
    const p = overlay.prefs ?? {};
    const set = change => ({ type: 'settings-set', change });
    const label = text => textItem(` ${text}${' '.repeat(Math.max(1, 22 - width(text)))}`, BOX);
    add([label(t.widthLabel), button('−', set({ width: p.width - WIDTH_STEP })), textItem(String(p.width).padStart(3), BOX), button('+', set({ width: p.width + WIDTH_STEP }))]);
    add([]);
    add([label(t.modeLabel), button(t.detailed, set({ cardMode: 'detailed' }), p.cardMode === 'detailed' ? 'chosen' : 'button'), button(t.compact, set({ cardMode: 'compact' }), p.cardMode === 'compact' ? 'chosen' : 'button')]);
    add([]);
    add([label(t.mergeLabel), button('−', set({ mergeSeconds: p.mergeSeconds - MERGE_STEP })), textItem(String(p.mergeSeconds).padStart(3), BOX), button('+', set({ mergeSeconds: p.mergeSeconds + MERGE_STEP }))]);
    add([]);
    add([label(t.tooltipLabel), button('−', set({ tooltipSeconds: p.tooltipSeconds - TOOLTIP_STEP })), textItem(String(p.tooltipSeconds).padStart(3), BOX), button('+', set({ tooltipSeconds: p.tooltipSeconds + TOOLTIP_STEP }))]);
    add([]);
    for (const l of wrap(t.settingsHint, cols - 2)) add([textItem(` ${l}`, BOX_DIM)]);
  } else {
    // The text uses the full width inside the border; the border itself is the margin.
    const body = overlay.text.replace(/\r/g, '').replace(/\t/g, '  ').split('\n').flatMap(l => wrap(l, cols));
    const view = Math.max(1, height - 2 - rows.length - 1);
    top = Math.min(Math.max(0, overlay.top ?? 0), Math.max(0, body.length - view));
    for (const l of body.slice(top, top + view)) add([textItem(l, BOX)]);
    while (rows.length < height - 3) add([]);
    add([textItem(` ${t.attachmentHint(Math.min(body.length, top + view), body.length)}${overlay.truncated ? ` · ${t.truncated}` : ''}`, BOX_DIM)]);
  }
  return { rows: frame(rows, ctx.cols), top };
}

// A full border around the layer: corners, top and bottom edges, and a side on every content row. Everything inside
// moves one column right, clickable areas with it.
function frame(rows, cols) {
  const edge = (l, r) => { const row = newRow(); row.segs.push(seg(`${l}${'─'.repeat(cols - 2)}${r}`, BOX_EDGE)); row.col = cols; return row; };
  const sides = rows.map(r => {
    const row = newRow();
    row.segs.push(seg('│', BOX_EDGE), ...r.segs, seg('│', BOX_EDGE));
    row.col = r.col + 2;
    row.hits = r.hits.map(h => ({ ...h, c0: h.c0 + 1, c1: h.c1 + 1, i0: h.i0 + 1, i1: h.i1 + 1 }));
    row.tips = r.tips.map(x => ({ ...x, c0: x.c0 + 1, c1: x.c1 + 1 }));
    return row;
  });
  return [edge('┌', '┐'), ...sides, edge('└', '┘')];
}

// ---------- tooltip ----------
// The full text of a cut-off item, in a box right under it, wrapped to the screen width; above it when there is not
// enough room below. The box covers the rows it lands on, and their clickable areas with them. Blue-grey, so it
// never puts red and green side by side.
const TIP = { fg: P.white, bg: hex('#34405a') };
function showTooltip({ x, y }, ui) {
  const tip = ui.tips.find(h => h.row === y - 1 && x - 1 >= h.c0 && x - 1 < h.c1);
  if (!tip) return;
  let body = wrap(tip.text, ui.cols - 2);
  const screen = Math.min(ui.rows, ui.lines.length);
  const roomBelow = screen - tip.row - 1;
  const roomAbove = tip.row;
  // Below when it fits, else above when that fits, else whichever side has more room, cut to fit.
  const below = body.length <= roomBelow || (body.length > roomAbove && roomBelow >= roomAbove);
  const room = below ? roomBelow : roomAbove;
  if (body.length > room) body = [...body.slice(0, Math.max(0, room - 1)), cut(body.slice(room - 1).join(''), ui.cols - 2)].slice(0, room);
  body = body.map(l => ` ${l}${' '.repeat(Math.max(0, ui.cols - 2 - width(l)))} `);
  const start = below ? tip.row + 1 : tip.row - body.length;
  body.forEach((l, i) => {
    const row = start + i;
    if (row >= ui.lines.length) return;
    ui.lines[row] = l;
    ui.styled[row] = `${sgr(TIP)}${l}\x1b[0m`;
    for (let k = ui.hits.length - 1; k >= 0; k--) if (ui.hits[k].row === row) ui.hits.splice(k, 1);
  });
}

// ---------- assembly ----------
// Two clickable things never touch from above and below: where a row's hits share columns with the next row's,
// a blank row goes between them, except between the option rows of one question, (carrying a card's colour bar, so the card stays one block).
const overlap = (a, b) => a.blocks.some(h => b.blocks.some(k => h.c0 < k.c1 && k.c0 < h.c1));
function spaceOut(rows, cols) {
  const out = [];
  for (const r of rows) {
    const prev = out[out.length - 1];
    if (prev && overlap(prev, r) && !(prev.group && prev.group === r.group)) {
      const blank = newRow();
      if (r.segs[0]?.t === '▌') {
        blank.segs.push(r.segs[0]);
        blank.col = 1;
        // Inside a highlighted card the gap row keeps the highlight, so the card stays one lit block.
        const bg = r.segs[0].s?.bg;
        if (bg) gap(blank, cols - 1, { bg });
      }
      out.push(blank);
    }
    out.push(r);
  }
  return out;
}

function finish(r, cols, lit) {
  let segs = r.segs;
  for (const hit of r.hits.filter(lit)) segs = segs.map((x, i) => (i >= hit.i0 && i < hit.i1 && x.h ? { ...x, s: x.h } : x));
  let used = 0;
  const out = [];
  for (const x of segs) {
    if (used >= cols) break;
    const t = used + width(x.t) > cols ? cut(x.t, cols - used) : x.t;
    out.push({ ...x, t });
    used += width(t);
  }
  return {
    line: out.map(x => x.t).join(''),
    styled: out.map(x => { const code = sgr(x.s ?? {}); return code ? `${code}${x.t}\x1b[0m` : x.t; }).join(''),
    hits: r.hits.filter(h => h.c0 < cols).map(h => ({ c0: h.c0, c1: Math.min(h.c1, cols), action: h.action })),
    caret: r.caret !== null && r.caret < cols ? r.caret : null,
  };
}

// previousQuestionIds: questions already shown before (null: no arrival tracking); lastInteractionAt: when input was
// last parsed (null: idle). `unseen` in the result lists new questions still off screen behind the hint.
// hover: { x, y } in the 1-based coordinates of terminal mouse reports, or null. tooltip: { x, y } of a pointer that
// has rested on cut-off text long enough; the full text is then drawn in a box under it (main.mjs times it). fx and ghosts carry running
// animations (see main.mjs); without them the screen is drawn at rest.
export function render(model, {
  cols = 48, rows = 40, cardMode = model.prefs?.cardMode ?? 'detailed', locale = 'en', scroll = 0, focus = null,
  drafts = {}, notice = null, now = Date.now(), hover = null, batchOpen = false, fx = {}, ghosts = [],
  previousQuestionIds = null, lastInteractionAt = null, confirmPrompt = null,
  feedback = null, deliveryState = null, deliveryConfirmedAt = null, tooltip = null, overlay = null,
} = {}) {
  const ctx = { t: screenText(locale), cols, compact: cardMode === 'compact', model, drafts, focus, notice, now, batchOpen, fx, ghosts, confirmPrompt };
  FB = {
    look: action => feedbackFor(action, feedback, { now, deliveryState, deliveryConfirmedAt }),
    label: look => ({
      pending: ctx.t.processing, delivering: ctx.t.delivering, delivered: ctx.t.delivered, done: ctx.t.completed,
      waiting: ctx.t.waiting(ctx.t.waitReason[look.reason] ?? look.reason), failed: ctx.t.failedReason(look.error),
    })[look.state],
  };
  // The pending label of Deliver now says what it is doing.
  if (feedback?.type === 'deliver-now') { const base = FB.label; FB.label = look => (look.state === 'pending' ? ctx.t.delivering : base(look)); }
  const top = spaceOut(topRows(model, ctx), cols);
  const decision = spaceOut(questionRows(model, ctx), cols);
  const pinned = [];
  while (decision[0]?.sticky) pinned.push(decision.shift());
  const mid = decision; // what scrolls under the pinned heading
  // The batch bar starts with a free row, so it never touches the last visible card.
  const bottom = [newRow(), ...spaceOut(bottomRows(model, ctx), cols)];
  const budget = Math.max(3, rows - top.length - pinned.length - bottom.length);
  const scrollMax = Math.max(0, mid.length - budget);
  let from = Math.min(Math.max(0, scroll), scrollMax);

  // A question that arrived since the last screen and sits outside the visible part: an idle screen scrolls to it;
  // while the user is moving the mouse or typing, the view stays put and a clickable hint says how many arrived.
  const seen = previousQuestionIds && new Set(previousQuestionIds);
  const startOf = uid => mid.findIndex(r => r.cardStart === uid);
  const offscreen = (seen ? model.questions.filter(q => q.status === 'pending' && !seen.has(q.uid)) : [])
    .map(q => ({ uid: q.uid, at: startOf(q.uid) }))
    .filter(x => x.at >= 0 && (x.at < from || x.at >= from + budget));
  // The receiver typing counts as interaction too: the view never jumps while either side is typing.
  const idle = model.inputState !== 'typing' && (lastInteractionAt === null || now - lastInteractionAt >= IDLE_MS);
  let unseen = [];
  if (offscreen.length && idle) from = Math.min(offscreen[0].at, scrollMax);
  else if (offscreen.length) unseen = offscreen.map(x => x.uid);
  const shown = mid.slice(from, from + budget);
  while (shown.length < budget) shown.push(newRow());
  if (unseen.length) {
    const target = Math.min(offscreen[0].at, scrollMax);
    const hint = flow(newRow, cols, [], [button(ctx.t.newQuestions(unseen.length), { type: 'reveal', scroll: target }, 'primary')]);
    shown[shown.length - 1] = hint[hint.length - 1];
    if (shown.length > 1) shown[shown.length - 2] = newRow(); // keep the hint clear of the row above it
  }

  const lines = [];
  const styled = [];
  const hits = [];
  const tips = [];
  let cursor = null;
  // The hovered control, and with it every row of the same group (all lines of one wrapped option).
  const all = [...top, ...pinned, ...shown, ...bottom];
  const pointed = hover ? all[hover.y - 1]?.hits.find(h => hover.x - 1 >= h.c0 && hover.x - 1 < h.c1) ?? null : null;
  const lit = h => h === pointed || Boolean(pointed?.group && h.group === pointed.group);
  all.forEach((r, row) => {
    const out = finish(r, cols, lit);
    lines.push(out.line);
    styled.push(out.styled);
    for (const h of out.hits) hits.push({ row, ...h });
    for (const tip of r.tips) if (tip.c0 < cols) tips.push({ row, c0: tip.c0, c1: Math.min(cols, tip.c1), text: tip.text });
    if (out.caret !== null) cursor = { row, col: out.caret };
  });
  if (tooltip && !overlay) showTooltip(tooltip, { lines, styled, hits, tips, cols, rows });
  let overlayTop = null;
  if (overlay) {
    // The settings box is as tall as its content; the attachment reader takes all but a row above and below.
    const screen = Math.min(rows, lines.length);
    const height = overlay.kind === 'attachment' ? Math.max(5, screen - 2) : 0;
    const box = overlayRows(overlay, ctx, height);
    overlayTop = box.top;
    const start = Math.max(0, Math.floor((screen - box.rows.length) / 2));
    hits.length = 0;
    tips.length = 0;
    cursor = null;
    box.rows.forEach((r, i) => {
      const row = start + i;
      if (row >= lines.length) return;
      const out = finish(r, cols, h => Boolean(hover && hover.y - 1 === row && hover.x - 1 >= h.c0 && hover.x - 1 < h.c1));
      lines[row] = out.line;
      styled[row] = out.styled;
      for (const h of out.hits) hits.push({ row, ...h });
    });
  }
  return { lines, styled, hits, tips, cursor, scrollMax, scroll: from, unseen, overlayTop };
}
