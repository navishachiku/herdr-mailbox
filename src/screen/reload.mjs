// Reloading a running screen when its code changes on disk. The version (version.mjs) is read every check; a new
// version is acted on only when it has stayed the same for two checks in a row (an editor that is half way through
// saving several files is not caught mid-way) and the new code passes a test load in a separate process. That is
// the first filter; the second is in the daemon: the new screen opens next to the old one, and the old one closes
// only once the new one reports it is drawing (screen-ready). A new screen that never reports is closed instead, and
// the old one stays, so a broken version never leaves the pane empty.
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { screenVersion, REPO_ROOT } from './version.mjs';

const run = args => new Promise(resolve => {
  execFile(process.execPath, args, { timeout: 15000 }, err => resolve(!err));
});

export async function loads(root = REPO_ROOT) {
  const dir = path.join(root, 'src', 'screen');
  const files = (await fs.readdir(dir)).filter(n => n.endsWith('.mjs')).map(n => path.join(dir, n));
  for (const file of files) if (!(await run(['--check', file]))) return false;
  // Every module is linked and run once; main.mjs only up to its imports (it stops when told it is a check), so a
  // missing or misspelt import anywhere fails here.
  const isMain = f => path.basename(f) === 'main.mjs';
  const modules = [...files.filter(f => !isMain(f)), ...files.filter(isMain)].map(f => pathToFileURL(f).href); // main last: it exits
  return run(['--input-type=module', '-e', `process.env.HERDR_MAILBOX_IMPORT_CHECK = '1'; for (const m of ${JSON.stringify(modules)}) await import(m);`]);
}

// check() resolves to the new version once the screen should ask for a reload, else null. A version that failed the
// test load, or that was already asked for, is not tried again; only a newer version is.
export function createReloadWatch({ root = REPO_ROOT, version = screenVersion, test = loads } = {}) {
  let started = null;
  let seen = null;
  const done = new Set();
  let checking = false;
  return {
    async start() { started = await version(root); },
    // drafts: text typed in the screen but not yet saved to the daemon (keyed like main's buffers). A reload would
    // lose it, so none is asked for while any of it holds text.
    async check({ drafts = {} } = {}) {
      if (!started || checking) return null;
      if (Object.values(drafts).some(text => String(text ?? '').trim())) return null;
      checking = true;
      try {
        const now = await version(root).catch(() => started);
        if (now === started || done.has(now)) { seen = null; return null; }
        if (now !== seen) { seen = now; return null; } // wait for one more check with the same version
        done.add(now);
        return (await test(root)) ? now : null;
      } finally { checking = false; }
    },
  };
}
