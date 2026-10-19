// mailbox deliver: the receiver asks for the waiting notes now instead of at the next merge; an empty input box is still required.
export const options = {};

export const usage = '  mailbox deliver <MB-id>';

export function build(v, positionals, h) {
  if (positionals.length !== 1 || !positionals[0].startsWith('MB-')) h.usage('deliver takes exactly one mailbox id (MB-xxxx)');
  return { op: 'deliver', mailbox: positionals[0] };
}
