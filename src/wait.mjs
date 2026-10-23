// `mailbox send --wait`: block until the receiver has taken this letter and finished the turn that followed it.
//   1. the letter's batch is confirmed as delivered (a letter to a busy receiver stays queued until it is idle);
//   2. the receiver goes back to idle/done/blocked after that delivery.
// Exit codes: 0 finished, 3 the letter was not delivered within the window (it is queued and will still arrive),
// 4 delivered but the receiver did not finish before --timeout. Neither 3 nor 4 means the letter was lost, so the
// sender must not send it again.
import { execFile } from 'node:child_process';

export const START_WINDOW_MS = 120000;
const SETTLE_MS = 5000;

const herdrWait = (target, until, timeout) => new Promise(resolve => {
  const args = ['agent', 'wait', target, ...until.flatMap(u => ['--until', u]), ...(timeout ? ['--timeout', String(timeout)] : [])];
  execFile(process.env.HERDR_BIN_PATH || 'herdr', args, { encoding: 'utf8' }, err => resolve(!err));
});

// `delivered` resolves true once the letter's batch is confirmed, false at the end of the window. Without it
// (a direct send, which is typed at once) the receiver starting a turn is the delivery signal.
export async function waitForReceiver(target, timeout, { delivered, wait = herdrWait } = {}) {
  const arrived = delivered ? await delivered() : await wait(target, ['working'], START_WINDOW_MS);
  if (!arrived && !delivered) {
    // A direct send keeps no queue: there is nothing that could still arrive.
    return { code: 3, fields: { waited: false, queued: false, waitError: `the receiver did not start a turn within ${START_WINDOW_MS / 1000}s of the message being typed; whether it arrived is unknown, nothing is queued and nothing will be retried` } };
  }
  if (!arrived) {
    return { code: 3, fields: { waited: false, queued: true, waitError: `the letter was not delivered within ${START_WINDOW_MS / 1000}s; it is queued and will still be delivered, do not send it again` } };
  }
  // The delivered prompt makes the receiver start a turn; give the status a moment to show it so an idle reading from just before it is not taken as the end.
  if (delivered) await wait(target, ['working'], SETTLE_MS);
  if (!await wait(target, ['idle', 'done', 'blocked'], timeout)) {
    return { code: 4, fields: { waited: false, queued: false, waitError: 'the letter was delivered but the receiver did not finish its turn before --timeout; do not send it again' } };
  }
  return { code: 0, fields: { waited: true } };
}
