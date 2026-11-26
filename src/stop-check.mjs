#!/usr/bin/env node
// Claude Code Stop hook. The final reply of a turn is checked by the daemon: in a pane that owns a connected mailbox,
// a question with options or a mention of the waiting cards sends the reply back to be rewritten. A turn a Stop hook
// already continued ends as it is, so the hook never loops. Anything else, or any failure, prints nothing and exits 0.
import fs from 'node:fs';
import { call } from './ipc.mjs';

try {
  const input = JSON.parse(fs.readFileSync(0, 'utf8'));
  const reply = input.last_assistant_message;
  if (reply && !input.stop_hook_active) {
    const caller = { pane: process.env.HERDR_PANE_ID, sid: process.env.HERDR_MAILBOX_SID };
    // A daemon that answers slowly, or predates reply-check, must not hold the turn: nothing is blocked.
    const res = await Promise.race([call({ op: 'reply-check', reply, caller }), new Promise(resolve => setTimeout(resolve, 2000, { ok: false }))]);
    if (res.ok && res.reason) process.stdout.write(JSON.stringify({ decision: 'block', reason: res.reason }));
  }
} catch { /* never block the end of a turn */ }
process.exit(0);
