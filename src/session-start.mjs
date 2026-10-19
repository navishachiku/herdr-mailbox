#!/usr/bin/env node
// Claude Code SessionStart hook (matcher startup|resume|clear|compact). Tells the daemon which conversation just
// started in this pane, and exports its id to the conversation's own shell commands through CLAUDE_ENV_FILE.
// It only records; whether the mailbox binding changes is decided by the daemon's reconcile. Any failure is
// silent and exits 0, so a broken mailbox never blocks a session from starting.
import fs from 'node:fs';
import { call } from './ipc.mjs';

try {
  const input = JSON.parse(fs.readFileSync(0, 'utf8'));
  const pane = process.env.HERDR_PANE_ID;
  const sid = input.session_id;
  if (pane && sid) {
    if (process.env.CLAUDE_ENV_FILE && /^[\w-]+$/.test(sid)) {
      fs.appendFileSync(process.env.CLAUDE_ENV_FILE, `export HERDR_MAILBOX_SID='${sid}'\n`);
    }
    await call({ op: 'register', pane, sid, source: input.source, transcript: input.transcript_path });
  }
} catch { /* never block the session */ }
process.exit(0);
