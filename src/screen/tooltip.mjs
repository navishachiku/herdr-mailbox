// When the full text of a cut-off item is shown (render's tooltip). It opens after the pointer rests on the item
// for delayMs. It closes once the pointer has been still for timeoutMs (the Settings value "Tooltip stays", 15 s by
// default), counted from the last movement, so moving within the item keeps it open; moving onto something else, a
// click or a key closes it at once. Once it has timed out it does not come back by itself:
// the pointer has to move off and onto the item again. timeoutMs may be a function; each tooltip takes the value
// current when it starts, so a changed setting applies to the next one.
import { DEFAULTS } from '../prefs.mjs';

export function createTooltipTracker({ now = Date.now, getUI, getSize, delayMs = 500, timeoutMs = DEFAULTS.tooltipSeconds * 1000 }) {
  let target = null; // { key, point, since (entered), moved (last movement), timeout, expired }
  const limit = () => (typeof timeoutMs === 'function' ? timeoutMs() : timeoutMs);
  const tipAt = ({ x, y }) => getUI()?.tips?.find(t => t.row === y - 1 && x - 1 >= t.c0 && x - 1 < t.c1) ?? null;

  return {
    handle(event) {
      if (event.kind !== 'move') { target = null; return; }
      const tip = tipAt(event);
      const key = tip ? `${tip.row}:${tip.c0}` : null;
      if (key && key === target?.key) { if (!target.expired) target.moved = now(); return; }
      const at = now();
      target = key ? { key, point: { x: event.x, y: event.y }, since: at, moved: at, timeout: limit(), expired: false } : null;
    },
    current() {
      if (!target || target.expired) return null;
      if (now() - target.moved >= target.timeout) { target.expired = true; return null; }
      return now() - target.since >= delayMs ? target.point : null;
    },
    delayMs,
    timeoutMs: limit,
  };
}
