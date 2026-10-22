// Thin wrapper around the herdr CLI. Uses only HERDR_BIN_PATH and never touches the socket, so it behaves the same on every platform.
import { execFile } from 'node:child_process';

export function run(args, timeout = 15000) {
  const bin = process.env.HERDR_BIN_PATH || 'herdr';
  return new Promise((resolve, reject) => {
    execFile(bin, args, { encoding: 'utf8', timeout, windowsHide: true }, (err, stdout, stderr) => {
      if (err) reject(Object.assign(err, { stderr }));
      else resolve(stdout);
    });
  });
}

export async function listPanes() {
  return JSON.parse(await run(['pane', 'list'])).result.panes;
}

export function notify(title, body) {
  return run(['notification', 'show', title, '--body', body, '--sound', 'request']);
}

// Read what the pane currently shows (with ANSI color codes), to tell whether anyone is typing in the input box.
export function readScreen(pane, { source = 'visible', lines = 40 } = {}) {
  return run(['pane', 'read', pane, '--source', source, '--lines', String(lines), '--format', 'ansi'], 3000);
}

// Single-pane lookups. paneGet and agentGet return the object herdr wraps in result.pane / result.agent.
export async function paneGet(pane) {
  return JSON.parse(await run(['pane', 'get', pane])).result.pane;
}

export async function agentGet(name) {
  return JSON.parse(await run(['agent', 'get', name])).result.agent;
}

// Every pane herdr knows, with its terminal_id (stable while herdr runs, new after a restart).
export const paneList = listPanes;

// Sends text to an agent pane's input box and submits it.
export function prompt(pane, text) {
  return run(['agent', 'prompt', pane, text]);
}

// Presses Enter in a pane: submits text that is still sitting in the input box.
export function pressEnter(pane) {
  return run(['pane', 'send-keys', pane, 'Enter']);
}

const PROMPT_END = /[$#%>❯➜»λ→]\s*$/;
const sleep = ms => new Promise(r => setTimeout(r, ms));

// A shell that is still loading (WSL can take many seconds) only echoes a command sent to it and never runs it, and herdr
// reports no error. herdr has no "input is ready" signal, so read the screen: ready is a last line ending in a prompt
// character, seen on two reads in a row with the same screen. Gives up at the timeout and returns false; the caller then
// sends the command anyway, never earlier.
export async function waitPromptReady(pane, timeoutMs, pollMs = 500) {
  const end = Date.now() + timeoutMs;
  let prev = null;
  while (Date.now() < end) {
    const screen = (await run(['pane', 'read', pane, '--lines', '5'], 3000).catch(() => '')).trimEnd();
    if (screen && screen === prev && PROMPT_END.test(screen.split('\n').pop().trimEnd())) return true;
    prev = screen;
    await sleep(pollMs);
  }
  return false;
}
