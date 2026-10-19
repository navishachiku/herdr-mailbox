// Shortcut action: open (or focus, or close) the mailbox screen for the focused pane.
import { build } from './cli/open.mjs';
import { call } from './ipc.mjs';

const pane = process.env.HERDR_PANE_ID;
if (!pane) process.exit(1);
const req = await build();
req.caller = { pane, sid: process.env.HERDR_MAILBOX_SID, viaPlugin: true };
const res = await call(req).catch(() => ({ ok: false }));
process.exit(res.ok ? 0 : 1);
