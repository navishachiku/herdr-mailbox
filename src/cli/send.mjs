// mailbox send: put a note, decision question or discussion question into a mailbox.
import path from 'node:path';
import { ownNames, stripOwnPrefix } from '../signature.mjs';

export const options = {
  to: { type: 'string' }, from: { type: 'string' }, type: { type: 'string' }, text: { type: 'string' },
  question: { type: 'string' }, option: { type: 'string', multiple: true }, recommend: { type: 'string' },
  idea: { type: 'string' }, priority: { type: 'string' }, tag: { type: 'string', multiple: true },
  attach: { type: 'string', multiple: true }, supersedes: { type: 'string' },
  wait: { type: 'boolean' }, timeout: { type: 'string' },
};

export const usage = `  mailbox send --to <address|MB-id> --type note <text>
  mailbox send --to <address|MB-id> --type decision --question <q> --option <o> --option <o> [--option <o>...] --recommend <letter>
  mailbox send --to <address|MB-id> --type discussion --question <q> [--idea <text>]
    optional: --priority high|medium|low  --tag <t>  --attach <file> (up to 5, repeat the flag)  --supersedes <uid>
    --wait [--timeout <ms>]  after the receipt, block until the receiver has taken the letter and finished its turn (exit 3: not delivered in 120s, letter still arrives; exit 4: receiver outlasted --timeout; never resend)`;

export async function build(v, positionals, h) {
  if (!v.to || !v.type) h.usage('--to and --type are required');
  // The signature is added by the program; a role prefix the sender typed itself is dropped first.
  const names = await ownNames(h.from);
  const strip = t => (t == null ? t : stripOwnPrefix(t, names));
  return {
    op: 'send', to: await h.target(v.to), from: h.from, type: v.type, text: strip(v.text ?? positionals.join(' ')), question: strip(v.question),
    options: v.option, recommend: v.recommend, idea: strip(v.idea), priority: v.priority, tags: v.tag,
    attach: v.attach?.map(f => path.resolve(f)), supersedes: v.supersedes,
  };
}
