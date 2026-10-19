// mailbox open: open the mailbox screen next to this pane (focus it if open, close it when run from inside it).
import { call } from '../ipc.mjs';

export const options = {};

export const usage = '  mailbox open';

// Pressing the shortcut in a pane that has no mailbox yet creates it first; the user is the one asking.
export async function build(v, positionals, h) {
  const pane = process.env.HERDR_PANE_ID;
  const caller = { pane, sid: process.env.HERDR_MAILBOX_SID, viaPlugin: true };
  const found = await call({ op: 'screen-find', pane, caller }).catch(() => null);
  if (found && !found.mailbox) await call({ op: 'bind', pane, caller }).catch(() => {});
  return { op: 'screen-open', pane };
}
