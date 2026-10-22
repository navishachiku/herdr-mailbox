// Shortcut action: open (or focus, or close) the mailbox screen for the focused pane.
import { ensureMailbox } from './cli/open.mjs';
import { call } from './ipc.mjs';
import { notify } from './herdr.mjs';

const pane = process.env.HERDR_PANE_ID;
if (!pane) process.exit(1);
const caller = { pane, sid: process.env.HERDR_MAILBOX_SID, viaPlugin: true };

// The shortcut has no terminal to print to, so a refusal is shown as a herdr notification.
const refuse = async body => { await notify('Mailbox', body).catch(() => {}); process.exit(1); };

const failed = await ensureMailbox(pane, caller);
if (failed?.error === 'not_agent') await refuse('This pane is not an agent, so it cannot have a mailbox. Press the shortcut in an agent pane.');
if (failed?.error === 'agent_not_ready') await refuse('This agent has not started a conversation yet, so it has no mailbox. Press the shortcut again once it is ready.');
if (failed) await refuse(`Could not create the mailbox for this pane (${failed.error ?? 'unknown'}).`);

const res = await call({ op: 'screen-open', pane, caller }).catch(() => ({ ok: false }));
if (!res.ok) await refuse(`Could not open the mailbox (${res.error ?? 'unknown'}).`);
process.exit(0);
