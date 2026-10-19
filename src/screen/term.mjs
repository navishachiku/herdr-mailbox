import { execFileSync } from 'node:child_process';

// Terminal setup shared by the screen and its popups: alternate screen, mouse reporting, bracketed paste.
// Everything is undone on exit, including when herdr kills the pane.
export function enter(out = process.stdout, stdin = process.stdin) {
  out.write('\x1b[?1049h\x1b[?25l\x1b[?1000h\x1b[?1006h\x1b[?2004h');
  stdin.setRawMode?.(true);
  stdin.resume();
  const restore = () => out.write('\x1b[?2004l\x1b[?1006l\x1b[?1000l\x1b[?25h\x1b[?1049l');
  process.on('exit', restore);
  for (const sig of ['SIGTERM', 'SIGHUP']) process.on(sig, () => process.exit(0));
  return restore;
}

// Rewrites only the rows that changed since the last frame. The cursor is saved and restored around the write, so a
// row changing elsewhere never moves it: an input method that is composing text at the caret is not disturbed.
export function painter(out = process.stdout) {
  let prev = [];
  let caret = null;
  return {
    reset() { prev = []; caret = null; out.write('\x1b[2J'); },
    paint(styled, rows, cursor) {
      let buf = '';
      for (let i = 0; i < Math.max(rows, prev.length); i++) {
        const line = i < rows ? styled[i] ?? '' : '';
        if (line === prev[i]) continue;
        buf += `\x1b[${i + 1};1H${line}\x1b[K`;
      }
      prev = styled.slice(0, rows);
      const next = cursor ? `${cursor.row + 1};${cursor.col + 1}` : null;
      if (buf) out.write(`\x1b7${buf}\x1b8`);
      if (next !== caret) {
        caret = next;
        out.write(next ? `\x1b[${next}H\x1b[?25h` : '\x1b[?25l');
      }
    },
  };
}

// The size of the terminal as the kernel has it. A herdr pane can be a few columns narrower than the size it was
// opened with, and node only learns of that on SIGWINCH, so the number is re-read from the tty (at most twice a
// second) and falls back to node's own figure. One column is kept free: a line that reaches the last column
// wraps in some terminals and the wrapped character overwrites the start of the next row.
let cached = { at: 0, value: null };
export function size(out = process.stdout, now = Date.now()) {
  if (cached.value && now - cached.at < 500) return cached.value;
  let cols = out.columns;
  let rows = out.rows;
  try {
    const [r, c] = execFileSync('stty', ['size'], { stdio: ['inherit', 'pipe', 'ignore'], encoding: 'utf8', timeout: 500 }).trim().split(/\s+/).map(Number);
    if (r > 0 && c > 0) { rows = r; cols = c; }
  } catch { /* not a tty, or no stty: node's figure stands */ }
  cached = { at: now, value: { cols: Math.max(20, (cols || 48) - 1), rows: rows || 40 } };
  return cached.value;
}
export const forgetSize = () => { cached = { at: 0, value: null }; };
