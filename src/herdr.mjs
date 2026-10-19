// Thin wrapper around the herdr CLI. Uses only HERDR_BIN_PATH and never touches the socket, so it behaves the same on every platform.
import { execFile } from 'node:child_process';

export function run(args) {
  const bin = process.env.HERDR_BIN_PATH || 'herdr';
  return new Promise((resolve, reject) => {
    execFile(bin, args, { encoding: 'utf8', timeout: 15000, windowsHide: true }, (err, stdout, stderr) => {
      if (err) reject(Object.assign(err, { stderr }));
      else resolve(stdout);
    });
  });
}

export async function listPanes() {
  return JSON.parse(await run(['pane', 'list'])).result.panes;
}

// Panes with an agent go through agent prompt (pastes the text and presses Enter); plain terminals use pane run.
export function deliver(pane, text) {
  return pane.agent
    ? run(['agent', 'prompt', pane.pane_id, text])
    : run(['pane', 'run', pane.pane_id, text]);
}

export function notify(title, body) {
  return run(['notification', 'show', title, '--body', body, '--sound', 'request']);
}

// Read what the pane currently shows (with ANSI color codes), to tell whether anyone is typing in the input box.
export function readScreen(pane) {
  return run(['pane', 'read', pane, '--source', 'visible', '--lines', '40', '--format', 'ansi']);
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
