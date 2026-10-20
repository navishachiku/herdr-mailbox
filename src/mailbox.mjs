#!/usr/bin/env node
// mailbox CLI. Each subcommand lives in src/cli/<name>.mjs and exports { options, usage, build }; a subcommand
// whose file does not exist yet is simply not listed. Prints the daemon's JSON answer; exit 0 only when it says ok.
// Letters are named by uid only. The sender is this pane (HERDR_PANE_ID) unless --from says otherwise.
import fs from 'node:fs';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { waitForReceiver, START_WINDOW_MS } from './wait.mjs';
import { call } from './ipc.mjs';
import { resolvePane } from './signature.mjs';

const COMMANDS = ['send', 'status', 'edit', 'withdraw', 'claim', 'open', 'close', 'deliver'];
const dir = new URL('./cli/', import.meta.url);

const commands = Object.create(null);
for (const name of COMMANDS) {
  if (fs.existsSync(fileURLToPath(new URL(`${name}.mjs`, dir)))) commands[name] = await import(new URL(`${name}.mjs`, dir));
}

const usageText = () => `usage:\n${Object.values(commands).map(c => c.usage).join('\n')}`;
function usage(msg) {
  console.error(msg ? `${msg}\n${usageText()}` : usageText());
  process.exit(2);
}

const [cmd, ...rest] = process.argv.slice(2);
const command = commands[cmd];
if (!command) usage(cmd ? `unknown command: ${cmd}` : '');

let parsed;
try { parsed = parseArgs({ args: rest, options: command.options, allowPositionals: true }); } catch (e) { usage(e.message); }
const { values, positionals } = parsed;

const helpers = {
  from: values.from ?? process.env.HERDR_PANE_ID ?? 'unknown',
  usage,
  // A pane id or MB- id passes through; an agent name is looked up.
  async target(to) {
    if (!to) return to;
    if (to.includes(':') || to.startsWith('MB-')) return to;
    try { return await resolvePane(to); } catch { console.error(`unknown agent or pane: ${to}`); process.exit(1); }
  },
};

const req = await command.build(values, positionals, helpers);
// Who is asking, for ops that only an owner (or the user, through a herdr plugin action) may run.
req.caller = { pane: process.env.HERDR_PANE_ID, sid: process.env.HERDR_MAILBOX_SID, viaPlugin: Boolean(process.env.HERDR_PLUGIN_ID) };

if (values.wait && (!req.to || req.to.startsWith('MB-'))) usage('--wait needs an agent or pane address, not a mailbox id');

let res;
try { res = await call(req); } catch (e) { res = { ok: false, error: 'daemon_unavailable', message: String(e.message || e) }; }
let exitCode = res.ok ? 0 : 1;
if (res.ok && values.wait) {
  // A letter that went into a mailbox is delivered when its batch is confirmed; a direct send has no batch to follow.
  const viaMailbox = res.status !== 'direct' && res.status !== 'downgraded';
  const delivered = viaMailbox ? async () => {
    for (const end = Date.now() + START_WINDOW_MS; Date.now() < end; await new Promise(r => setTimeout(r, 1000))) {
      const st = await call({ op: 'status', from: req.from, to: req.to, caller: req.caller }).catch(() => null);
      if (st?.batches?.some(b => b.members.includes(res.uid) && b.status === 'confirmed')) return true;
    }
    return false;
  } : undefined;
  const { code, fields } = await waitForReceiver(req.to, values.timeout, { delivered });
  res = { ...res, ...fields };
  exitCode = code;
}
console.log(JSON.stringify(res));
process.exit(exitCode);
