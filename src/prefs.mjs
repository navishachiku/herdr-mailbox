// Screen preferences: one JSON file next to the per-session state directories, shared by every herdr session.
import fs from 'node:fs';
import path from 'node:path';
import { STATE_DIR } from './paths.mjs';
import { LOCALES } from './screen/messages.mjs';

export const PREFS_FILE = path.join(STATE_DIR, '..', 'prefs.json');
export const DEFAULTS = { width: 48, cardMode: 'detailed', mergeSeconds: 60, tooltipSeconds: 15, locale: 'auto' };
export const WIDTH = { min: 24, max: 80, step: 4 };
const MERGE = { min: 5, max: 3600 };
// How long a tooltip stays while the pointer rests. 5 s is about the least to read a long note; past 60 s the box
// would in effect never leave on its own. Steps of 5 keep the − / + buttons quick across that range.
export const TOOLTIP = { min: 5, max: 60, step: 5 };

const valid = {
  width: v => Number.isInteger(v) && v >= WIDTH.min && v <= WIDTH.max && v % WIDTH.step === 0,
  cardMode: v => v === 'detailed' || v === 'compact',
  mergeSeconds: v => Number.isInteger(v) && v >= MERGE.min && v <= MERGE.max,
  tooltipSeconds: v => Number.isInteger(v) && v >= TOOLTIP.min && v <= TOOLTIP.max && v % TOOLTIP.step === 0,
  // 'auto' follows the system language; anything else is a screen language picked in Settings.
  locale: v => v === 'auto' || LOCALES.includes(v),
};

// A missing, unreadable or hand-edited file falls back per key, so a bad value never breaks opening the screen.
export function readPrefs(file = PREFS_FILE) {
  let saved = {};
  try { saved = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* defaults */ }
  return Object.fromEntries(Object.entries(DEFAULTS).map(([k, d]) => [k, valid[k](saved[k]) ? saved[k] : d]));
}

// Returns the new prefs, or { error } naming the first bad key; nothing is written when any key is bad.
export function writePrefs(change, file = PREFS_FILE) {
  for (const [k, v] of Object.entries(change)) {
    if (k in valid && !valid[k](v)) return { error: k };
  }
  const next = { ...readPrefs(file), ...Object.fromEntries(Object.entries(change).filter(([k]) => k in valid)) };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(next));
  fs.renameSync(tmp, file);
  return next;
}
