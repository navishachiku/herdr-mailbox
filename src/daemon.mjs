// Mailbox daemon: the single writer of the state file. Requests are handled one at a time.
import fs from 'node:fs';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { SOCKET, STATE_FILE, STATE_DIR, PID_FILE, ATTACH_DIR, DAEMON_PROTO, SESSION } from './paths.mjs';
import { loadState, saveState } from './store.mjs';
import { Mailboxes } from './core.mjs';
import { timings } from './timings.mjs';

// Only the owner may enter the state directory, read letters or connect to the socket.
fs.mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
fs.chmodSync(STATE_DIR, 0o700);

// One writer per state directory. The pid file doubles as the lock: it is created exclusively, so of several
// daemons started at once (concurrent first sends) exactly one proceeds and the others exit. A lock left by a
// killed daemon is taken over only if the recorded pid is gone and the file still holds that same pid.
const alive = pid => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };

function takeLock() {
  for (let i = 0; i < 5; i++) {
    try { fs.writeFileSync(PID_FILE, String(process.pid), { flag: 'wx', mode: 0o600 }); return; } catch (e) { if (e.code !== 'EEXIST') throw e; }
    const held = fs.readFileSync(PID_FILE, 'utf8').trim();
    if (alive(Number(held))) process.exit(0);
    if (held !== '' && fs.readFileSync(PID_FILE, 'utf8').trim() === held) { try { fs.unlinkSync(PID_FILE); } catch { /* taken over by another */ } }
  }
  process.exit(0);
}
takeLock();
const release = () => { try { if (fs.readFileSync(PID_FILE, 'utf8').trim() === String(process.pid)) fs.unlinkSync(PID_FILE); } catch { /* already gone */ } };
process.on('exit', release);
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => process.exit(0));
if (process.platform !== 'win32') { try { fs.unlinkSync(SOCKET); } catch { /* no stale socket */ } }

const core = new Mailboxes({ state: loadState(STATE_FILE, SESSION), save: s => saveState(STATE_FILE, s), attachDir: ATTACH_DIR });

// Feature modules, loaded in this order; a missing file is skipped so each can be developed and tested alone.
for (const name of ['identity', 'delivery', 'screen-api']) {
  const file = new URL(`./${name}.mjs`, import.meta.url);
  if (fs.existsSync(fileURLToPath(file))) core.register((await import(file)).default);
}

// Requests and ticks run one at a time on this chain, so handlers never interleave their writes.
let chain = Promise.resolve();
const serial = fn => { const run = chain.then(fn); chain = run.catch(() => {}); return run; };

async function respond(req) {
  if (req.proto !== DAEMON_PROTO) {
    return { ok: false, error: 'incompatible_daemon', message: `the running daemon speaks protocol ${DAEMON_PROTO}, this command speaks ${req.proto}; restart the daemon (stop pid ${process.pid}, the next command starts a new one)`, daemonProto: DAEMON_PROTO, SESSION };
  }
  if (req.op === 'ping') return { ok: true, pid: process.pid, proto: DAEMON_PROTO, SESSION };
  try { return await core.handle(req, { caller: req.caller ?? {} }); } catch (e) { return { ok: false, error: 'internal', message: String(e.message || e) }; }
}

const server = net.createServer(sock => {
  let buf = '';
  sock.setEncoding('utf8');
  sock.on('error', () => {});
  sock.on('data', d => {
    buf += d;
    const i = buf.indexOf('\n');
    if (i < 0) return;
    let req;
    try { req = JSON.parse(buf.slice(0, i)); } catch { sock.end(`${JSON.stringify({ ok: false, error: 'bad_request' })}\n`); return; }
    serial(() => respond(req)).then(res => sock.end(`${JSON.stringify(res)}\n`));
  });
});

server.listen(SOCKET, () => {
  if (process.platform !== 'win32') fs.chmodSync(SOCKET, 0o600);
  serial(() => core.emit('start', {}));
  // A tick that is still queued or running is not queued again, so a slow tick never piles up.
  for (const { name, fn, everyMs } of core.ticks) {
    let busy = false;
    setInterval(() => {
      if (busy) return;
      busy = true;
      serial(() => fn({ caller: null, tick: name, timings })).catch(e => console.error(`tick ${name} failed: ${e.message || e}`)).finally(() => { busy = false; });
    }, everyMs ?? timings.tickMs).unref();
  }
});
