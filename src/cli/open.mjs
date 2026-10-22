// mailbox open: open the mailbox screen next to this pane (focus it if open, close it when run from inside it).
import { call } from '../ipc.mjs';

export const options = {};

export const usage = '  mailbox open';

// Pressing the shortcut in a pane that has no mailbox yet creates it first; the user is the one asking.
// Returns the bind answer when that failed (for example the pane is not an agent), otherwise null.
export async function ensureMailbox(pane, caller) {
  const found = await call({ op: 'screen-find', pane, caller }).catch(() => null);
  if (!found || found.mailbox) return null;
  const bound = await call({ op: 'bind', pane, caller }).catch(() => null);
  return bound?.ok ? null : (bound ?? { ok: false, error: 'daemon_unavailable' });
}

export async function build(v, positionals, h) {
  const pane = process.env.HERDR_PANE_ID;
  await ensureMailbox(pane, { pane, sid: process.env.HERDR_MAILBOX_SID, viaPlugin: true });
  return { op: 'screen-open', pane };
}
