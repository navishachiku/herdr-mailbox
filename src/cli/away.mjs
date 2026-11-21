// mailbox away on|off: the receiver tells its mailbox the user is away (on) or back (off).
import { call } from '../ipc.mjs';

export const options = {};

export const usage = '  mailbox away on|off   (run in the receiver pane; while away, cards are taken in without a notification; off raises one notification for the cards that waited)';

export async function build(v, positionals, h) {
  if (positionals.length !== 1 || !['on', 'off'].includes(positionals[0])) h.usage('away takes on or off');
  const pane = process.env.HERDR_PANE_ID;
  const found = await call({ op: 'screen-find', pane }).catch(() => ({}));
  return { op: 'away', mailbox: found.mailbox, generation: found.generation, on: positionals[0] === 'on' };
}
