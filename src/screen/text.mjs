// Terminal text measuring. Wide characters (CJK, emoji) take two columns; everything the screen draws is cut and
// wrapped by columns, never by string length.
const WIDE = [
  [0x1100, 0x115f], [0x2e80, 0x303e], [0x3041, 0x33ff], [0x3400, 0x4dbf], [0x4e00, 0x9fff], [0xa000, 0xa4cf],
  [0xac00, 0xd7a3], [0xf900, 0xfaff], [0xfe30, 0xfe6f], [0xff00, 0xff60], [0xffe0, 0xffe6],
  [0x1f300, 0x1f64f], [0x1f900, 0x1f9ff], [0x20000, 0x3fffd],
  // Symbols drawn as emoji by default (Emoji_Presentation) are wide; text symbols such as ★ ✔ ⚙ ⚠ are not, which is
  // also how herdr's terminal measures them.
  [0x231a, 0x231b], [0x23e9, 0x23ec], [0x23f0, 0x23f0], [0x23f3, 0x23f3], [0x25fd, 0x25fe], [0x2614, 0x2615],
  [0x2648, 0x2653], [0x267f, 0x267f], [0x2693, 0x2693], [0x26a1, 0x26a1], [0x26aa, 0x26ab], [0x26bd, 0x26be],
  [0x26c4, 0x26c5], [0x26ce, 0x26ce], [0x26d4, 0x26d4], [0x26ea, 0x26ea], [0x26f2, 0x26f3], [0x26f5, 0x26f5],
  [0x26fa, 0x26fa], [0x26fd, 0x26fd], [0x2705, 0x2705], [0x270a, 0x270b], [0x2728, 0x2728], [0x274c, 0x274c],
  [0x274e, 0x274e], [0x2753, 0x2755], [0x2757, 0x2757], [0x2795, 0x2797], [0x27b0, 0x27b0], [0x27bf, 0x27bf],
  [0x2b1b, 0x2b1c], [0x2b50, 0x2b50], [0x2b55, 0x2b55],
];

export function charWidth(ch) {
  const c = ch.codePointAt(0);
  // Combining marks (accents, Thai vowel and tone marks, variation selectors) sit on the character before them.
  if (c === 0x200d || /\p{M}/u.test(ch)) return 0;
  return WIDE.some(([a, b]) => c >= a && c <= b) ? 2 : 1;
}

export const width = s => [...String(s)].reduce((n, ch) => n + charWidth(ch), 0);

// Cut to at most n columns, ending in an ellipsis when something was dropped.
export function cut(s, n) {
  s = String(s);
  if (width(s) <= n) return s;
  let out = '';
  let w = 0;
  for (const ch of s) {
    const cw = charWidth(ch);
    if (w + cw > n - 1) break;
    out += ch;
    w += cw;
  }
  return `${out}…`;
}

export const pad = (s, n) => s + ' '.repeat(Math.max(0, n - width(s)));

// Wrap to n columns. A Latin word is moved whole to the next line when the line has a space to break at, and a line
// never starts with closing punctuation: the character before it moves down too. Newlines start new lines.
const CLOSING = new Set([...'，。、？！：；）」』】,.?!:;)']);
const wordChar = ch => /[0-9A-Za-z_'-]/.test(ch);

export function wrap(s, n) {
  const lines = [];
  for (const para of String(s).split('\n')) {
    let line = [];
    let w = 0;
    for (const ch of para) {
      const cw = charWidth(ch);
      if (w + cw > n && line.length) {
        let carry = [];
        const space = line.lastIndexOf(' ');
        if (wordChar(ch) && wordChar(line[line.length - 1]) && space > 0) carry = line.splice(space + 1);
        else if (CLOSING.has(ch) && line.length > 1) carry = line.splice(-1);
        lines.push(line.join('').trimEnd());
        line = carry;
        w = width(line.join(''));
      }
      line.push(ch);
      w += cw;
    }
    lines.push(line.join(''));
  }
  return lines;
}

// Web addresses in a wrapped text. `lines` is wrap(text, n). Returns, per line, the parts [{ t, url? }] in order.
// Addresses are found in the original text, so one the wrap broke (even inside "https://") keeps its full address
// on every piece, and a line break the writer typed ends it. Trailing punctuation, and a closing bracket that has no
// opening bracket in the address, stay out of it.
const URL_AT = /https?:\/\/[^\s　-〿＀-￯<>"'`]+/gi;
const OPENING = { ')': '(', ']': '[', '}': '{' };
function trimAddress(u) {
  for (;;) {
    const last = u[u.length - 1];
    if (/[.,;:!?]/.test(last) || (OPENING[last] && u.split(last).length > u.split(OPENING[last]).length)) u = u.slice(0, -1);
    else return u;
  }
}
export function linkParts(text, lines) {
  const spans = []; // where each line sits in the text
  let pos = 0;
  for (const line of lines) {
    const at = line ? text.indexOf(line, pos) : pos;
    spans.push([at, at + line.length]);
    pos = at + line.length;
  }
  const urls = [...text.matchAll(URL_AT)].map(m => ({ from: m.index, url: trimAddress(m[0]) })).map(u => ({ ...u, to: u.from + u.url.length }));
  return lines.map((line, li) => {
    const [from, to] = spans[li];
    const parts = [];
    let at = from;
    for (const u of urls) {
      const a = Math.max(u.from, from);
      const b = Math.min(u.to, to);
      if (b <= a) continue;
      if (a > at) parts.push({ t: text.slice(at, a) });
      parts.push({ t: text.slice(a, b), url: u.url });
      at = b;
    }
    if (at < to) parts.push({ t: text.slice(at, to) });
    return parts.length ? parts : [{ t: line }];
  });
}
