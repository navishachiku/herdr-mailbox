#!/usr/bin/env node
// mailbox CLI: send, status, edit, withdraw. Prints the daemon's JSON answer; exit 0 only when it says ok.
// Letters are named by uid only. The sender is this pane (HERDR_PANE_ID) unless --from says otherwise.
import path from 'node:path';
import { parseArgs } from 'node:util';
import { call } from './ipc.mjs';
import { resolvePane } from './signature.mjs';

const [cmd, ...rest] = process.argv.slice(2);
const spec = {
  to: { type: 'string' }, from: { type: 'string' }, type: { type: 'string' }, text: { type: 'string' },
  question: { type: 'string' }, option: { type: 'string', multiple: true }, recommend: { type: 'string' },
  idea: { type: 'string' }, priority: { type: 'string' }, tag: { type: 'string', multiple: true },
  attach: { type: 'string' }, supersedes: { type: 'string' }, reason: { type: 'string' },
};
const USAGE = `usage:
  mailbox send --to <address|MB-id> --type note <text>
  mailbox send --to <address|MB-id> --type decision --question <q> --option <o> --option <o> [--option <o>...] --recommend <letter>
  mailbox send --to <address|MB-id> --type discussion --question <q> [--idea <text>]
    optional: --priority high|medium|low  --tag <t>  --attach <file>  --supersedes <uid>
  mailbox status [--to <address|MB-id>]
  mailbox edit <uid> [--question <q>] [--option <o>...] [--recommend <letter>] [--idea <text>] [--priority <p>] [--attach <file>]
  mailbox withdraw <uid> --reason <text>`;

function usage(msg) {
  console.error(msg ? `${msg}\n${USAGE}` : USAGE);
  process.exit(2);
}

let parsed;
try { parsed = parseArgs({ args: rest, options: spec, allowPositionals: true }); } catch (e) { usage(e.message); }
const { values: v, positionals } = parsed;
const from = v.from ?? process.env.HERDR_PANE_ID ?? 'unknown';
const attach = v.attach ? path.resolve(v.attach) : undefined;

async function target(to) {
  if (!to) return to;
  if (to.includes(':') || to.startsWith('MB-')) return to;
  try { return await resolvePane(to); } catch { console.error(`unknown agent or pane: ${to}`); process.exit(1); }
}

let req;
if (cmd === 'send') {
  if (!v.to || !v.type) usage('--to and --type are required');
  req = {
    op: 'send', to: await target(v.to), from, type: v.type, text: v.text ?? positionals.join(' '), question: v.question,
    options: v.option, recommend: v.recommend, idea: v.idea, priority: v.priority, tags: v.tag, attach, supersedes: v.supersedes,
  };
} else if (cmd === 'status') {
  req = { op: 'status', from, to: await target(v.to) };
} else if (cmd === 'edit') {
  if (positionals.length !== 1) usage('edit takes exactly one uid');
  req = { op: 'edit', uid: positionals[0], from, question: v.question, options: v.option, recommend: v.recommend, idea: v.idea, priority: v.priority, attach };
} else if (cmd === 'withdraw') {
  if (positionals.length !== 1) usage('withdraw takes exactly one uid');
  req = { op: 'withdraw', uid: positionals[0], from, reason: v.reason };
} else usage(cmd ? `unknown command: ${cmd}` : '');

let res;
try { res = await call(req); } catch (e) { res = { ok: false, error: 'daemon_unavailable', message: String(e.message || e) }; }
console.log(JSON.stringify(res));
process.exit(res.ok ? 0 : 1);
