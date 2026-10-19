// mailbox withdraw: take back a pending question the user has not answered yet.
export const options = { from: { type: 'string' }, reason: { type: 'string' } };

export const usage = '  mailbox withdraw <uid> --reason <text>';

export function build(v, positionals, h) {
  if (positionals.length !== 1) h.usage('withdraw takes exactly one uid');
  return { op: 'withdraw', uid: positionals[0], from: h.from, reason: v.reason };
}
