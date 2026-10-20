// Event-driven animation clock. It runs only while something is animating, at most 30 frames a second (herdr
// merges anything faster), and stops as soon as the last animation ends, so a still screen keeps no timer.
export const FRAME_MS = 33;
const EASE = { out: p => 1 - (1 - p) ** 3, in: p => p ** 3, linear: p => p };

export class Animator {
  constructor(onFrame, now = Date.now) {
    Object.assign(this, { onFrame, now, items: new Map(), timer: null });
  }

  // key names what animates (for example enter:<uid>); starting a key again restarts it.
  start(key, ms, { ease = 'out', delay = 0, onEnd } = {}) {
    this.items.set(key, { at: this.now() + delay, ms, ease, onEnd });
    if (!this.timer) this.timer = setInterval(() => this.tick(), FRAME_MS);
  }

  has(key) { return this.items.has(key); }

  // Eased progress 0 → 1 of every running animation, by key.
  values() {
    const t = this.now();
    const out = {};
    for (const [key, a] of this.items) out[key] = EASE[a.ease](Math.min(1, Math.max(0, (t - a.at) / a.ms)));
    return out;
  }

  tick() {
    const t = this.now();
    const ended = [...this.items].filter(([, a]) => t >= a.at + a.ms);
    for (const [key] of ended) this.items.delete(key);
    for (const [, a] of ended) a.onEnd?.();
    this.onFrame();
    if (!this.items.size) { clearInterval(this.timer); this.timer = null; }
  }
}
