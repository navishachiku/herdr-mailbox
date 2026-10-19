// Durable state: one JSON file with a schema version. Every write goes to a temp file, is flushed to disk
// and renamed over the old file, so the daemon can acknowledge a letter only after it is on disk.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const SCHEMA = 2;

export function emptyState(session) {
  return { schema: SCHEMA, session, mailboxes: {}, letters: {}, registrations: {}, batches: {}, senders: {} };
}

// v1 keyed mailboxes by address and had no owner. Each becomes an unbound mailbox with a fresh MB- id;
// letters follow their mailbox to the new id.
export function migrate(state) {
  if (state.schema === SCHEMA) return state;
  if (state.schema !== 1) throw new Error(`state schema ${state.schema} is not supported (expected ${SCHEMA})`);
  const ids = {};
  const mailboxes = {};
  for (const [to, box] of Object.entries(state.mailboxes ?? {})) {
    let id;
    do { id = `MB-${crypto.randomBytes(2).toString('hex')}`; } while (mailboxes[id]);
    ids[to] = id;
    mailboxes[id] = { id, counter: box.counter ?? 0, owner: null, state: 'disconnected', disconnect: { reason: 'unbound', at: Date.now() }, paused: null, screen: { open: false } };
  }
  const letters = {};
  for (const [uid, l] of Object.entries(state.letters ?? {})) letters[uid] = { ...l, mailbox: ids[l.mailbox] ?? l.mailbox };
  return { ...emptyState(state.session), mailboxes, letters };
}

// Fields added after a state file was written read as empty.
const fill = state => Object.assign(state, { registrations: {}, batches: {}, senders: {}, ...state });

export function loadState(file, session) {
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch (e) {
    if (e.code === 'ENOENT') return emptyState(session);
    throw e;
  }
  const parsed = JSON.parse(raw);
  if (parsed.session !== session) throw new Error(`state belongs to herdr session ${parsed.session}, not ${session}`);
  return fill(migrate(parsed));
}

export function saveState(file, state) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  const fd = fs.openSync(tmp, 'w', 0o600);
  try { fs.writeSync(fd, JSON.stringify(state)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, file);
}
