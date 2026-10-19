// Attachment popup: the full text of one question's attachment. Arrow keys, Page keys and the wheel scroll; Esc closes.
import { call as daemon } from '../ipc.mjs';
import { pickLocale } from '../messages.mjs';
import { parseInput } from './input.mjs';
import { enter, painter } from './term.mjs';
import { wrap } from './text.mjs';
import { size, forgetSize } from './term.mjs';

const uid = process.env.HERDR_MAILBOX_UID;
const zh = pickLocale() === 'zh-TW';
const res = await daemon({ caller: { pane: process.env.HERDR_PANE_ID, viaPlugin: true }, op: 'attachment', uid }).catch(e => ({ ok: false, message: String(e.message || e) }));
const out = process.stdout;
const paint = painter(out);
let top = 0;

function draw() {
  const { cols, rows } = size(out);
  const body = res.ok ? res.text.split('\n').flatMap(line => wrap(line.replace(/\t/g, '  ').replace(/\r/g, ''), cols)) : [res.message || res.error];
  top = Math.min(Math.max(0, top), Math.max(0, body.length - (rows - 2)));
  const head = `\x1b[1;97m 📎 ${res.name ?? ''}\x1b[0m${res.truncated ? '  (truncated)' : ''}`;
  const foot = `\x1b[2m ${zh ? 'Esc：關閉　↑↓ 捲動' : 'Esc closes · ↑↓ scroll'} · ${Math.min(body.length, top + rows - 2)}/${body.length}\x1b[0m`;
  paint.paint([head, ...body.slice(top, top + rows - 2), foot], rows, null);
}

enter(out);
out.on('resize', () => { forgetSize(); paint.reset(); draw(); });
paint.reset();
draw();
const page = () => size(out).rows - 3;
process.stdin.on('data', d => {
  for (const e of parseInput(d)) {
    if (e.kind === 'wheel') top += e.dir * 3;
    else if (e.kind === 'key' && e.name === 'down') top += 1;
    else if (e.kind === 'key' && e.name === 'up') top -= 1;
    else if (e.kind === 'key' && e.name === 'pagedown') top += page();
    else if (e.kind === 'key' && e.name === 'pageup') top -= page();
    else if (e.kind === 'key' && e.name === 'home') top = 0;
    else if (e.kind === 'key' && e.name === 'end') top = Infinity;
    else if ((e.kind === 'key' && ['escape', 'ctrl-c'].includes(e.name)) || (e.kind === 'text' && e.text === 'q')) process.exit(0);
  }
  draw();
});
