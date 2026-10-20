// Tell whether anyone has typed into the Claude input box. Same approach as the send guard:
// filter out dim and gray foreground text (suggestions, placeholders); anything else counts as
// typed. A screen that is not a Claude input box always counts as having no text.
const SGR_OR_ANSI_RE = /\x1b\[([0-9;]*)m|\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)|[@-Z\\-_])/g;
const ANSI_RE = /\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)|[@-Z\\-_])/g;

// A rule may carry a label inside it ("──── name ─"), so only the start counts.
const isRule = (line) => /^─{3,}/.test(line.trim());

function grayFg(params, i) {
  // params[i] is 38; returns [isGray, consumed]
  if (params[i + 1] === 5) {
    const n = params[i + 2];
    return [n === 8 || n === 59 || n === 102 || n === 145 || n === 188 || n >= 232, 3];
  }
  if (params[i + 1] === 2) {
    const [r, g, b] = [params[i + 2], params[i + 3], params[i + 4]];
    return [r === g && g === b, 5];
  }
  return [false, 1];
}

// Keeps only the text that is neither dim nor drawn in a gray foreground.
function visibleText(rawLine) {
  let dim = false;
  let gray = false;
  let out = '';
  let last = 0;
  for (const m of rawLine.matchAll(SGR_OR_ANSI_RE)) {
    if (!dim && !gray) out += rawLine.slice(last, m.index);
    last = m.index + m[0].length;
    if (m[1] === undefined) continue;
    const params = m[1] === '' ? [0] : m[1].split(';').map((s) => (s === '' ? 0 : Number(s)));
    for (let i = 0; i < params.length; i++) {
      const p = params[i];
      if (p === 0) { dim = false; gray = false; }
      else if (p === 2) dim = true;
      else if (p === 22) dim = false;
      else if (p === 39 || (p >= 30 && p <= 37) || (p >= 91 && p <= 97)) gray = false;
      else if (p === 90) gray = true;
      else if (p === 38) {
        const [isGray, used] = grayFg(params, i);
        gray = isGray;
        i += used - 1;
      }
    }
  }
  if (!dim && !gray) out += rawLine.slice(last);
  return out;
}

// Index of the "❯" line that sits right under a rule: the Claude input box. -1 when the screen has none.
function findInputBox(plain) {
  for (let i = plain.length - 1; i >= 1; i--) {
    if (isRule(plain[i - 1]) && /^\s*❯/.test(plain[i])) return i;
  }
  return -1;
}

// Returns the text typed in the Claude input box, or '' when there is none or
// the screen is not a Claude input box.
export function typedText(screen) {
  const rawLines = screen.split(/\r?\n/);
  const plain = rawLines.map((l) => l.replace(ANSI_RE, ''));
  const start = findInputBox(plain);
  if (start < 0) return '';
  const parts = [visibleText(rawLines[start]).replace(/^\s*❯/, '')];
  for (let i = start + 1; i < rawLines.length && !isRule(plain[i]); i++) parts.push(visibleText(rawLines[i]));
  return parts.map((s) => s.replace(ANSI_RE, '').trim()).filter(Boolean).join(' ');
}

// A long paste is folded by Claude Code into "[Pasted text #1 +N lines]". Returns N when that placeholder is all the
// box holds, else null.
export function pastedLines(screen) {
  const m = /^\[Pasted text #\d+ \+(\d+) lines?\]$/.exec(typedText(screen));
  return m ? Number(m[1]) : null;
}

// Three-way reading for delivery: 'empty' is the only state that allows typing into the pane. A screen that is
// blank, has no Claude input box, or shows the background-agent list (it takes the arrow keys) is 'unknown'.
export function classify(screen) {
  if (typeof screen !== 'string' || !screen.trim()) return 'unknown';
  const plain = screen.split(/\r?\n/).map((l) => l.replace(ANSI_RE, ''));
  if (plain.some((l) => l.includes('↑/↓ to select'))) return 'unknown';
  if (findInputBox(plain) < 0) return 'unknown';
  return typedText(screen) ? 'typing' : 'empty';
}
