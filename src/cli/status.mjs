// mailbox status: the letters this sender still has open, per mailbox.
export const options = { to: { type: 'string' }, from: { type: 'string' } };

export const usage = '  mailbox status [--to <address|MB-id>]   (with --to, also shows which batch each of your letters is in)';

export async function build(v, positionals, h) {
  return { op: 'status', from: h.from, to: await h.target(v.to) };
}
