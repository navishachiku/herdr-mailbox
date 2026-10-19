// mailbox send: put a note, decision question or discussion question into a mailbox.
import path from 'node:path';

export const options = {
  to: { type: 'string' }, from: { type: 'string' }, type: { type: 'string' }, text: { type: 'string' },
  question: { type: 'string' }, option: { type: 'string', multiple: true }, recommend: { type: 'string' },
  idea: { type: 'string' }, priority: { type: 'string' }, tag: { type: 'string', multiple: true },
  attach: { type: 'string' }, supersedes: { type: 'string' },
};

export const usage = `  mailbox send --to <address|MB-id> --type note <text>
  mailbox send --to <address|MB-id> --type decision --question <q> --option <o> --option <o> [--option <o>...] --recommend <letter>
  mailbox send --to <address|MB-id> --type discussion --question <q> [--idea <text>]
    optional: --priority high|medium|low  --tag <t>  --attach <file>  --supersedes <uid>`;

export async function build(v, positionals, h) {
  if (!v.to || !v.type) h.usage('--to and --type are required');
  return {
    op: 'send', to: await h.target(v.to), from: h.from, type: v.type, text: v.text ?? positionals.join(' '), question: v.question,
    options: v.option, recommend: v.recommend, idea: v.idea, priority: v.priority, tags: v.tag,
    attach: v.attach ? path.resolve(v.attach) : undefined, supersedes: v.supersedes,
  };
}
