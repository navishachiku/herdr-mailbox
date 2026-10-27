// 250 bundled send-a-letter skill: `mailbox skill` prints the repo's SKILL.md verbatim; the README names agy's two limits.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');

test('250/AC-2 mailbox skill prints exactly the SKILL.md in the repo', () => {
  const r = spawnSync(process.execPath, [path.join(here, 'mailbox.mjs'), 'skill'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, fs.readFileSync(path.join(root, 'skills', 'herdr-mailbox-send', 'SKILL.md'), 'utf8'));
});

test('250/AC-3 the README has a Known issues section with both agy limits', () => {
  const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  const start = readme.indexOf('## Known issues');
  assert.ok(start > 0, 'Known issues section');
  const section = readme.slice(start, readme.indexOf('<details>', start));
  assert.match(section, /skill is not installed where agy reads it/);
  assert.match(section, /does not use the mailbox on its own/);
});

test('278.1/AC-4 mailbox skill prints the fallback, daemon_unavailable and attachment text', () => {
  const r = spawnSync(process.execPath, [path.join(here, 'mailbox.mjs'), 'skill'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(r.stdout.includes('Send the text with `herdr agent prompt <receiver> "<role> 💬 <text>"` instead'));
  assert.ok(r.stdout.includes('`daemon_unavailable` → the mailbox service did not start; send it the way Step 1 describes for a missing mailbox, and tell the user.'));
  assert.ok(r.stdout.includes('attach it with `--attach <file>` (up to 5, repeat the flag) instead of pasting its path into the text'));
});
