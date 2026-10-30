// mailbox release: the receiver hands its mailbox over; it disconnects at once so another agent can claim it.
import { call } from '../ipc.mjs';

export const options = {};

export const usage = '  mailbox release [MB-id]   (run in the receiver pane; the next agent then runs mailbox claim)';

export async function build(v, positionals, h) {
  if (positionals.length > 1 || (positionals[0] && !positionals[0].startsWith('MB-'))) h.usage('release takes at most one mailbox id (MB-xxxx)');
  if (positionals[0]) return { op: 'release', mailbox: positionals[0] };
  const found = await call({ op: 'screen-find', pane: process.env.HERDR_PANE_ID }).catch(() => ({}));
  return { op: 'release', mailbox: found.mailbox };
}
