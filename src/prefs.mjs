// Screen preferences: one JSON file next to the per-session state directories, shared by every herdr session.
import fs from 'node:fs';
import path from 'node:path';
import { STATE_DIR } from './paths.mjs';

export const PREFS_FILE = path.join(STATE_DIR, '..', 'prefs.json');
export const DEFAULTS = { width: 48, cardMode: 'detailed', mergeSeconds: 60 };
export const WIDTH = { min: 24, max: 80, step: 4 };
const MERGE = { min: 5, max: 3600 };

const valid = {
  width: v => Number.isInteger(v) && v >= WIDTH.min && v <= WIDTH.max && v % WIDTH.step === 0,
  cardMode: v => v === 'detailed' || v === 'compact',
  mergeSeconds: v => Number.isInteger(v) && v >= MERGE.min && v <= MERGE.max,
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
