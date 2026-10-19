// State directory and the daemon's connection endpoint. HERDR_MAILBOX_STATE_DIR exists only for test isolation.
// The state lives under herdr's plugin state directory, outside the plugin code directory, so updating
// or reinstalling the plugin never touches letters.
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

// One state directory, one daemon and one set of mailboxes per herdr session: pane addresses such as w1:p2
// repeat across sessions, so letters must never be shared between them. The session is told apart by the
// socket path herdr hands to every pane; without it (outside herdr) the key is "default".
export const sessionKey = (socket = process.env.HERDR_SOCKET_PATH) =>
  socket ? crypto.createHash('sha256').update(socket).digest('hex').slice(0, 10) : 'default';
export const SESSION = sessionKey();
const ROOT = process.env.HERDR_MAILBOX_STATE_DIR
  || process.env.HERDR_PLUGIN_STATE_DIR
  || path.join(os.homedir(), '.local', 'state', 'herdr', 'plugins', 'herdr-mailbox');
export const STATE_DIR = path.join(ROOT, SESSION);
export const STATE_FILE = path.join(STATE_DIR, 'state.json');
export const PID_FILE = path.join(STATE_DIR, 'daemon.pid');
export const ATTACH_DIR = path.join(STATE_DIR, 'attachments');
export const SOCKET = process.platform === 'win32'
  ? `\\\\.\\pipe\\herdr-mailbox-${os.userInfo().username}-${SESSION}`
  : path.join(STATE_DIR, 'd.sock');

// Wire protocol version between the CLI and the daemon. A mismatch means the plugin was updated while an
// older daemon is still running. The override exists only so tests can start a daemon of another version.
export const PROTO = 1;
export const DAEMON_PROTO = Number(process.env.HERDR_MAILBOX_DAEMON_PROTO) || PROTO;
