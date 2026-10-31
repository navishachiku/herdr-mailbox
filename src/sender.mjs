// Which pane a command runs in. Codex conversations run in one shared background server, so the HERDR_PANE_ID
// they inherit is the pane that started the server, not the pane the user is typing in. A Codex tool call carries
// CODEX_THREAD_ID; herdr has no thread-to-pane map, so the pane is found as the one Codex pane whose working
// directory is this command's. When that is not exactly one pane the sender cannot be told, and the inherited id
// would be a wrong reply address, so the result is null and the caller must ask for --from.
import * as herdr from './herdr.mjs';

export async function senderPane(env = process.env, cwd = process.cwd()) {
  const inherited = env.HERDR_PANE_ID;
  if (!env.CODEX_THREAD_ID) return inherited;
  try {
    const here = (await herdr.listPanes()).filter(p => p.agent === 'codex' && (p.cwd === cwd || p.foreground_cwd === cwd));
    return here.length === 1 ? here[0].pane_id : null;
  } catch { return null; }
}
