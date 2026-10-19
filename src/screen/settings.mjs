// Settings popup: width, card mode and the merge interval. Every change is saved at once; an open mailbox screen
// keeps its width until the next time it is opened.
import { call as daemon } from '../ipc.mjs';
import { pickLocale } from '../messages.mjs';
import { parseInput } from './input.mjs';
import { enter, painter } from './term.mjs';
import { WIDTH } from '../prefs.mjs';

const call = req => daemon({ caller: { pane: process.env.HERDR_PANE_ID, viaPlugin: true }, ...req });
const zh = pickLocale() === 'zh-TW';
const L = zh
  ? { title: '信箱設定', width: '寬度（欄）', mode: '卡片模式', detailed: '詳細', compact: '精簡', merge: '合併間隔（秒）', hint: '寬度在下次開信箱時套用　Esc：關閉' }
  : { title: 'Mailbox settings', width: 'Width (columns)', mode: 'Card mode', detailed: 'Detailed', compact: 'Compact', merge: 'Merge interval (s)', hint: 'Width applies the next time the mailbox opens · Esc closes' };
const MERGE_STEP = 10;

let prefs = await call({ op: 'prefs-get' });
let hits = [];
const out = process.stdout;
const paint = painter(out);

function draw() {
  const rows = [];
  hits = [];
  const row = (parts) => {
    let col = 0;
    let line = '';
    parts.forEach(([text, style, action]) => {
      if (action) hits.push({ row: rows.length, c0: col, c1: col + [...text].length, action });
      line += style ? `${style}${text}\x1b[0m` : text;
      col += [...text].length;
    });
    rows.push(line);
  };
  const B = '\x1b[48;5;238;97m';
  const ON = '\x1b[1;94m';
  row([[` ${L.title}`, '\x1b[1;97m']]);
  row([['']]);
  row([[` ${L.width.padEnd(22)}`], [' − ', B, { set: { width: prefs.width - WIDTH.step } }], [` ${String(prefs.width).padStart(3)} `], [' + ', B, { set: { width: prefs.width + WIDTH.step } }]]);
  row([[` ${L.mode.padEnd(22)}`], [`[${L.detailed}]`, prefs.cardMode === 'detailed' ? ON : B, { set: { cardMode: 'detailed' } }], [' '], [`[${L.compact}]`, prefs.cardMode === 'compact' ? ON : B, { set: { cardMode: 'compact' } }]]);
  row([[` ${L.merge.padEnd(22)}`], [' − ', B, { set: { mergeSeconds: prefs.mergeSeconds - MERGE_STEP } }], [` ${String(prefs.mergeSeconds).padStart(3)} `], [' + ', B, { set: { mergeSeconds: prefs.mergeSeconds + MERGE_STEP } }]]);
  row([['']]);
  row([[` ${L.hint}`, '\x1b[2m']]);
  paint.paint(rows, out.rows || 12, null);
}

async function set(change) {
  const next = await call({ op: 'prefs-set', ...change });
  if (next.ok) prefs = next;
  draw();
}

enter(out);
out.on('resize', () => { paint.reset(); draw(); });
paint.reset();
draw();
process.stdin.on('data', async d => {
  for (const e of parseInput(d)) {
    if (e.kind === 'click') {
      const hit = hits.find(h => h.row === e.y - 1 && e.x - 1 >= h.c0 && e.x - 1 < h.c1);
      if (hit) await set(hit.action.set);
    } else if ((e.kind === 'key' && ['escape', 'ctrl-c'].includes(e.name)) || (e.kind === 'text' && e.text === 'q')) process.exit(0);
  }
});
