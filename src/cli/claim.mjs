// mailbox claim: an agent takes over a disconnected mailbox.
export const options = {};

export const usage = '  mailbox claim <MB-id>';

export function build(v, positionals, h) {
  if (positionals.length !== 1 || !positionals[0].startsWith('MB-')) h.usage('claim takes exactly one mailbox id (MB-xxxx)');
  return { op: 'claim', mailbox: positionals[0] };
}
