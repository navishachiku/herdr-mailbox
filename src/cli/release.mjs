// mailbox release: the receiver hands its mailbox over; it disconnects at once so another agent can claim it.
import { call } from '../ipc.mjs';

export const options = { next: { type: 'string' } };

export const usage = '  mailbox release [MB-id] [--next <pane|agent>]   (queue notes for the specified pane until the mailbox is claimed)';

export async function build(v, positionals, h) {
  if (positionals.length > 1 || (positionals[0] && !positionals[0].startsWith('MB-'))) h.usage('release takes at most one mailbox id (MB-xxxx)');
  let [mailbox] = positionals;
  if (!mailbox) {
    const found = await call({ op: 'screen-find', pane: process.env.HERDR_PANE_ID }).catch(() => ({}));
    mailbox = found.mailbox;
  }
  // An older daemon rejects the new operation before it can release without recording the successor.
  if (v.next !== undefined) return { op: 'release-next', mailbox, nextPane: await h.target(v.next) };
  return { op: 'release', mailbox };
}
