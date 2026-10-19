// Durable state: one JSON file with a schema version. Every write goes to a temp file, is flushed to disk
// and renamed over the old file, so the daemon can acknowledge a letter only after it is on disk.
import fs from 'node:fs';
import path from 'node:path';

export const SCHEMA = 1;

export function emptyState(session) {
  return { schema: SCHEMA, session, mailboxes: {}, letters: {} };
}

export function loadState(file, session) {
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch (e) {
    if (e.code === 'ENOENT') return emptyState(session);
    throw e;
  }
  const state = JSON.parse(raw);
  if (state.schema !== SCHEMA) throw new Error(`state schema ${state.schema} is not supported (expected ${SCHEMA})`);
  if (state.session !== session) throw new Error(`state belongs to herdr session ${state.session}, not ${session}`);
  return state;
}

export function saveState(file, state) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  const fd = fs.openSync(tmp, 'w', 0o600);
  try { fs.writeSync(fd, JSON.stringify(state)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, file);
}
