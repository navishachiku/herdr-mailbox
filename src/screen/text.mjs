// Terminal text measuring. Wide characters (CJK, emoji) take two columns; everything the screen draws is cut and
// wrapped by columns, never by string length.
const WIDE = [
  [0x1100, 0x115f], [0x2e80, 0x303e], [0x3041, 0x33ff], [0x3400, 0x4dbf], [0x4e00, 0x9fff], [0xa000, 0xa4cf],
  [0xac00, 0xd7a3], [0xf900, 0xfaff], [0xfe30, 0xfe6f], [0xff00, 0xff60], [0xffe0, 0xffe6],
  [0x1f300, 0x1f64f], [0x2600, 0x27bf], [0x2b50, 0x2b55], [0x1f900, 0x1f9ff], [0x20000, 0x3fffd],
];

export function charWidth(ch) {
  const c = ch.codePointAt(0);
  if (c === 0x200d || (c >= 0xfe00 && c <= 0xfe0f) || (c >= 0x300 && c <= 0x36f)) return 0;
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

// Hard wrap to n columns. Newlines in the text start new lines.
export function wrap(s, n) {
  const lines = [];
  for (const para of String(s).split('\n')) {
    let line = '';
    let w = 0;
    for (const ch of para) {
      const cw = charWidth(ch);
      if (w + cw > n) { lines.push(line); line = ''; w = 0; }
      line += ch;
      w += cw;
    }
    lines.push(line);
  }
  return lines;
}
