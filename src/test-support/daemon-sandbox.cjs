const fs = require('node:fs');
const path = require('node:path');

const daemon = path.join(__dirname, '..', 'daemon.mjs');
const POLL_MS = 100;

exports.guardDaemon = (env, root) => {
  // The daemon may recreate its state directory. Only the fixture creates this file.
  const owner = path.join(root, '.daemon-owner');
  fs.closeSync(fs.openSync(owner, 'a'));
  env.HERDR_MAILBOX_TEST_DAEMON_OWNER = owner;
  env.HERDR_MAILBOX_TEST_DAEMON_OWNER_PID = String(process.pid);
  env.NODE_OPTIONS = [env.NODE_OPTIONS, `--require ${JSON.stringify(__filename)}`].filter(Boolean).join(' ');
};

const alive = pid => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };

const owner = process.env.HERDR_MAILBOX_TEST_DAEMON_OWNER;
if (owner && process.argv[1] === daemon) {
  // A detached daemon may reach startup after the fixture has removed its PID file and sandbox, or the fixture may
  // tear down while the daemon is still loading. A watcher misses a removal that happens before the event loop first
  // runs, so poll instead: the daemon stops once the fixture's owner file is gone, whenever that happens.
  // An interrupted test process never cleans up and leaves the file behind, so its exit stops the daemon too.
  const pid = Number(process.env.HERDR_MAILBOX_TEST_DAEMON_OWNER_PID);
  const gone = () => !fs.existsSync(owner) || !alive(pid);
  if (gone()) process.exit(0);
  setInterval(() => { if (gone()) process.exit(0); }, POLL_MS).unref();
}
