// Hands a file or a web address to the system's default program (Preview for images, the default browser for
// links). It runs where this screen runs, which is the machine herdr's server runs on.
import { spawn } from 'node:child_process';

const COMMANDS = {
  darwin: target => ['open', [target]],
  // No command interpreter: the address is one argument and nothing in it is read as a command.
  win32: target => ['rundll32', ['url.dll,FileProtocolHandler', target]],
};
const fallback = target => ['xdg-open', [target]];

export function systemOpen(target, { platform = process.platform, spawnFn = spawn } = {}) {
  const [cmd, args] = (COMMANDS[platform] ?? fallback)(target);
  return new Promise((resolve, reject) => {
    const child = spawnFn(cmd, args, { stdio: 'ignore' });
    child.once('error', e => reject(new Error(e.code === 'ENOENT' ? `${cmd} is not available here` : e.message)));
    child.once('exit', code => (code === 0 ? resolve() : reject(new Error(`${cmd} exited with ${code}`))));
  });
}

// Only web addresses are handed over from card text; other schemes (file:, javascript:, custom handlers) are not.
export function isWebUrl(s) {
  if (!/^https?:\/\/[^\s\x00-\x1f]+$/i.test(s)) return false;
  try { return ['http:', 'https:'].includes(new URL(s).protocol); } catch { return false; }
}
