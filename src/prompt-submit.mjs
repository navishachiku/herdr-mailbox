#!/usr/bin/env node
// Claude Code UserPromptSubmit hook. A mailbox batch typed into the conversation starts with "📬 N messages (marker)";
// the marker is looked up in the daemon and what the short text left out is handed to the model as added context.
// Anything else, or any failure, prints nothing and exits 0 so a normal prompt is never held up.
import fs from 'node:fs';
import { call } from './ipc.mjs';

const MARKER = /^📬 [^\n]*[（(]([^\s（）()]+)[）)]\s*$/;

try {
  const input = JSON.parse(fs.readFileSync(0, 'utf8'));
  const marker = MARKER.exec(String(input.prompt ?? '').split('\n')[0])?.[1];
  if (marker) {
    // A daemon that answers slowly must not hold the prompt: give up after two seconds and add nothing.
    const res = await Promise.race([call({ op: 'batch-by-marker', marker, caller: { pane: process.env.HERDR_PANE_ID, sid: process.env.HERDR_MAILBOX_SID } }), new Promise(resolve => setTimeout(resolve, 2000, { ok: false }))]);
    if (res.ok && res.context) {
      process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: res.context } }));
    }
  }
} catch { /* never block the prompt */ }
process.exit(0);
