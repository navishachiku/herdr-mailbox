// mailbox renew: the receiver gets a new mailbox id for its pane; letters sent to the old id keep arriving.
import { call } from '../ipc.mjs';

export const options = {};

export const usage = '  mailbox renew [MB-id]   (run in the receiver pane; unsent letters and drafts move to the new mailbox, the old id forwards to it)';

export async function build(v, positionals, h) {
  if (positionals.length > 1 || (positionals[0] && !positionals[0].startsWith('MB-'))) h.usage('renew takes at most one mailbox id (MB-xxxx)');
  if (positionals[0]) return { op: 'renew', mailbox: positionals[0] };
  const found = await call({ op: 'screen-find', pane: process.env.HERDR_PANE_ID }).catch(() => ({}));
  return { op: 'renew', mailbox: found.mailbox };
}
