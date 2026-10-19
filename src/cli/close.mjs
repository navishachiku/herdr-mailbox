// mailbox close: close the mailbox screen only; the mailbox, its questions, drafts and queued messages stay.
import { call } from '../ipc.mjs';

export const options = {};

export const usage = '  mailbox close';

// The user's shortcut carries the generation shown on screen; the receiver agent is checked by pane and conversation.
export async function build() {
  const pane = process.env.HERDR_PANE_ID;
  const found = await call({ op: 'screen-find', pane }).catch(() => ({}));
  return { op: 'close', mailbox: found.mailbox, generation: found.generation };
}
