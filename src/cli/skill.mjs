// mailbox skill: prints the bundled send-a-letter skill verbatim, for agents that cannot install skills
// (paste the output into the agent's instruction file). Runs locally; it does not talk to the daemon.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export const options = {};

export const usage = '  mailbox skill   (prints the instructions for sending letters; the same text as skills/herdr-mailbox-send/SKILL.md)';

export const SKILL_FILE = fileURLToPath(new URL('../../skills/herdr-mailbox-send/SKILL.md', import.meta.url));

export async function run() {
  process.stdout.write(fs.readFileSync(SKILL_FILE));
}
