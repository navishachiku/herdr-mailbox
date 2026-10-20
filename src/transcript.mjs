// Reads a receiver's Claude transcript (JSON lines) to see whether a batch landed in the conversation.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function sizeOf(file) {
  try { return fs.statSync(file).size; } catch { return 0; }
}

// True when a user entry (or an absorbed queued command) written after `offset` bytes contains the batch id.
export function landed(file, offset, id) {
  if (!file) return false;
  let text;
  try {
    const fd = fs.openSync(file, 'r');
    try {
      const size = fs.fstatSync(fd).size;
      if (size <= offset) return false;
      const buf = Buffer.alloc(size - offset);
      fs.readSync(fd, buf, 0, buf.length, offset);
      text = buf.toString('utf8');
    } finally { fs.closeSync(fd); }
  } catch { return false; }
  return text.split('\n').some(line => {
    if (!line.includes(id)) return false;
    try {
      const entry = JSON.parse(line);
      // A prompt that arrives while Claude is working is first logged as a queue-operation (enqueue, which proves
      // nothing) and, once it is taken into the turn, as a queued_command attachment: that is the landing.
      return entry.type === 'user' || (entry.type === 'attachment' && entry.attachment?.type === 'queued_command');
    } catch { return false; } // a half-written last line is not there yet
  });
}

// Without a SessionStart registration the file is found by the conversation id herdr reports:
// <claude config dir>/projects/<project>/<id>.jsonl. null when there is none.
export function findByConversation(id) {
  if (!id || !/^[\w:-]+$/.test(String(id))) return null;
  const projects = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'projects');
  try {
    for (const dir of fs.readdirSync(projects)) {
      const file = path.join(projects, dir, `${id}.jsonl`);
      if (fs.existsSync(file)) return file;
    }
  } catch { /* no projects directory */ }
  return null;
}
