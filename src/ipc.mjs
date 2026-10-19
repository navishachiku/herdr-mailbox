// Connection between the CLI and the daemon: one JSON line for the request, one for the response.
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { SOCKET, PROTO } from './paths.mjs';

function request(msg) {
  return new Promise((resolve, reject) => {
    const c = net.connect(SOCKET);
    let buf = '';
    c.setEncoding('utf8');
    c.on('connect', () => c.write(`${JSON.stringify({ proto: PROTO, ...msg })}\n`));
    c.on('data', d => { buf += d; });
    c.on('end', () => { try { resolve(JSON.parse(buf)); } catch (e) { reject(e); } });
    c.on('error', reject);
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const down = e => ['ENOENT', 'ECONNREFUSED'].includes(e.code);

// If the connection fails, start a detached daemon and retry. The startup hook runs only once when herdr
// starts, so every entry point has to make sure the daemon is up itself. There is no fallback to typing
// the message into the pane: when the daemon cannot be started the call fails.
// HERDR_MAILBOX_DAEMON_ENTRY exists only for test isolation.
export async function call(msg) {
  try { return await request(msg); } catch (e) { if (!down(e)) throw e; }
  const entry = process.env.HERDR_MAILBOX_DAEMON_ENTRY || fileURLToPath(new URL('./daemon.mjs', import.meta.url));
  spawn(process.execPath, [entry], { detached: true, stdio: 'ignore', env: process.env, windowsHide: true }).unref();
  for (let i = 0; i < 40; i++) {
    await sleep(100);
    try { return await request(msg); } catch (e) { if (!down(e)) throw e; }
  }
  throw new Error('mailbox daemon did not come up');
}
