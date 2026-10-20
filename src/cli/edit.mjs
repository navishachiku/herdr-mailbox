// mailbox edit: change a pending question the user has not answered yet.
import path from 'node:path';

export const options = {
  from: { type: 'string' }, question: { type: 'string' }, option: { type: 'string', multiple: true }, recommend: { type: 'string' },
  idea: { type: 'string' }, priority: { type: 'string' }, attach: { type: 'string', multiple: true },
};

export const usage = '  mailbox edit <uid> [--question <q>] [--option <o>...] [--recommend <letter>] [--idea <text>] [--priority <p>] [--attach <file>]';

export function build(v, positionals, h) {
  if (positionals.length !== 1) h.usage('edit takes exactly one uid');
  return {
    op: 'edit', uid: positionals[0], from: h.from, question: v.question, options: v.option, recommend: v.recommend,
    idea: v.idea, priority: v.priority, attach: v.attach?.map(f => path.resolve(f)),
  };
}
