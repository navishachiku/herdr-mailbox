// The version of the screen code: a hash of the contents of every file in src/screen and of every module they
// import, followed through relative imports (../ipc.mjs, ../paths.mjs and so on). A running screen compares the
// version it started with to the one on disk; only a change of contents counts, not a touched timestamp.
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const IMPORT = /^\s*(?:import|export)\s[^'"]*?from\s*['"](\.{1,2}\/[^'"]+)['"]|^\s*import\s*['"](\.{1,2}\/[^'"]+)['"]/gm;

export async function screenVersion(root = REPO_ROOT) {
  const dir = path.join(root, 'src', 'screen');
  const queue = (await fs.readdir(dir)).filter(n => n.endsWith('.mjs')).map(n => path.join(dir, n));
  const files = new Map();
  while (queue.length) {
    const file = queue.shift();
    if (files.has(file)) continue;
    let text;
    try { text = await fs.readFile(file); } catch { files.set(file, Buffer.from('missing')); continue; }
    files.set(file, text);
    for (const m of text.toString('utf8').matchAll(IMPORT)) queue.push(path.resolve(path.dirname(file), m[1] ?? m[2]));
  }
  const hash = crypto.createHash('sha256');
  for (const file of [...files.keys()].sort()) hash.update(path.relative(root, file)).update('\0').update(files.get(file)).update('\0');
  return hash.digest('hex').slice(0, 16);
}
