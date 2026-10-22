// The one place that does not move when the plugin is updated: ~/.herdr-mailbox/ holds run.mjs (a copy of shim.mjs)
// and `root`, the plugin folder the hooks and the `mailbox` command currently run from. Claude Code's settings and
// the PATH link point at run.mjs; the plugin keeps `root` current from its own startup and focus events, because a
// herdr update leaves the old install folder on disk and the next one is a different folder.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const STABLE_DIR = path.join(os.homedir(), '.herdr-mailbox');
export const POINTER = path.join(STABLE_DIR, 'root');
export const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Writes the pointer only when setup has created the folder and the content differs. Never throws.
export function refreshPointer(root = PLUGIN_ROOT) {
  try {
    if (!fs.existsSync(STABLE_DIR)) return false;
    if (fs.existsSync(POINTER) && fs.readFileSync(POINTER, 'utf8').trim() === root) return false;
    fs.writeFileSync(POINTER, `${root}\n`);
    return true;
  } catch { return false; }
}
