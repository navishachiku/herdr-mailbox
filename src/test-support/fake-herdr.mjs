#!/usr/bin/env node
// Fake herdr CLI for tests, injected through HERDR_BIN_PATH. It reads the world from the JSON file named by
// FAKE_HERDR_STATE (re-read on every call, so a test moves a pane or swaps a conversation by rewriting the
// file) and appends one JSON line per call to FAKE_HERDR_LOG.
import fs from 'node:fs';

const argv = process.argv.slice(2);
const statePath = process.env.FAKE_HERDR_STATE;
const logPath = process.env.FAKE_HERDR_LOG;
const world = statePath && fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, 'utf8')) : {};
const panes = world.panes ?? [];

if (logPath) fs.appendFileSync(logPath, `${JSON.stringify({ argv, at: Date.now() })}\n`);

const out = result => console.log(JSON.stringify({ id: 'fake', result }));
const die = (code, message, status = 1) => { console.error(JSON.stringify({ error: { code, message } })); process.exit(status); };
const paneById = id => panes.find(p => p.pane_id === id);
const [group, verb, ...rest] = argv;
const positional = rest.filter(a => !a.startsWith('--'));

if (group === 'pane' && verb === 'list') out({ panes });
else if (group === 'pane' && verb === 'get') {
  const pane = paneById(positional[0]);
  if (!pane) die('pane_not_found', `no pane ${positional[0]}`);
  out({ pane });
} else if (group === 'pane' && verb === 'read') {
  if (!paneById(positional[0])) die('pane_not_found', `no pane ${positional[0]}`);
  // FAKE_NOPROMPT=N: a pane that was split off shows no prompt on its first N reads, like a shell still loading its profile.
  const id = positional[0];
  const split = /-s\d+$/.test(id);
  world.reads = { ...world.reads, [id]: (world.reads?.[id] ?? 0) + 1 };
  if (statePath) fs.writeFileSync(statePath, JSON.stringify(world));
  if (split) process.stdout.write(world.reads[id] <= Number(process.env.FAKE_NOPROMPT || 0) ? 'loading shell...\n' : 'user@host:~$ \n');
  else process.stdout.write(world.screens?.[id] ?? '');
} else if (group === 'pane' && verb === 'layout') {
  const pane = paneById(rest[rest.indexOf('--pane') + 1]);
  if (!pane) die('pane_not_found', 'no pane for layout');
  out({ layout: { panes: [{ pane_id: pane.pane_id, rect: { width: pane.width ?? 200, height: pane.height ?? 50 } }] } });
} else if (group === 'pane' && verb === 'split') {
  const parent = paneById(rest[0]);
  if (!parent) die('pane_not_found', `no pane ${rest[0]}`);
  if (!statePath) die('fake_state_missing', 'pane split requires FAKE_HERDR_STATE');
  let n = 1;
  while (paneById(`${parent.pane_id}-s${n}`)) n++;
  const pane = { pane_id: `${parent.pane_id}-s${n}`, terminal_id: `${parent.terminal_id}-s${n}`,
    workspace_id: parent.workspace_id, tab_id: parent.tab_id, label: '', agent: null };
  panes.push(pane);
  world.panes = panes;
  fs.writeFileSync(statePath, JSON.stringify(world));
  out({ pane });
} else if (group === 'pane' && verb === 'run') {
  if (process.env.FAKE_RUN_FAILS) die('run_failed', 'herdr could not type into the pane');
  // A command sent before the prompt shows is only echoed, never run, and herdr says nothing.
  if ((world.reads?.[positional[0]] ?? 0) <= Number(process.env.FAKE_NOPROMPT || 0)) {
    world.echoedOnly = [...(world.echoedOnly ?? []), positional[0]];
    if (statePath) fs.writeFileSync(statePath, JSON.stringify(world));
  }
  out({ ok: true });
}
else if (group === 'pane' && verb === 'focus') out({ focused: positional[0] });
else if (group === 'agent' && verb === 'get') {
  // The target is a pane id or an agent name (the pane label).
  const pane = paneById(positional[0]) ?? panes.find(p => p.agent && p.label === positional[0]);
  if (!pane) die('agent_not_found', `no agent ${positional[0]}`);
  out({ agent: pane });
} else if (group === 'agent' && verb === 'prompt') {
  const [target, ...text] = positional;
  const pane = paneById(target);
  if (!pane) die('pane_not_found', `no pane ${target}`);
  const result = world.promptResult?.[target] ?? 'ok';
  if (result === 'agent_blocked') die('agent_blocked', `agent ${target} is blocked`);
  // "lost" reports success but never reaches the conversation.
  const transcript = world.transcripts?.[target];
  if (result === 'stuck') {
    // Pasted but never submitted: the text sits in the input box until Enter is pressed.
    world.stuck = { ...world.stuck, [target]: text.join(' ') };
    // Like Claude Code, fold a long paste into a one-line placeholder.
    const lines = text.join(' ').split('\n').length;
    const shown = lines >= 30 ? `[Pasted text #1 +${lines} lines]` : text.join(' ').replace(/\n/g, ' ');
    world.screens = { ...world.screens, [target]: `────────────\n❯ ${shown}\n────────────` };
    fs.writeFileSync(statePath, JSON.stringify(world));
  } else if (result !== 'lost' && transcript) {
    fs.appendFileSync(transcript, `${JSON.stringify({ type: 'user', message: { role: 'user', content: text.join(' ') } })}\n`);
  }
  out({ pane_id: target, sent: true });
} else if (group === 'pane' && verb === 'send-keys') {
  const [target, ...keys] = positional;
  const held = world.stuck?.[target];
  if (keys.join() === 'Enter' && held && world.transcripts?.[target]) {
    fs.appendFileSync(world.transcripts[target], `${JSON.stringify({ type: 'user', message: { role: 'user', content: held } })}\n`);
    delete world.stuck[target];
    world.screens[target] = '────────────\n❯ \n────────────';
    fs.writeFileSync(statePath, JSON.stringify(world));
  }
  out({ pane_id: target, sent: true });
} else if (group === 'tab' && verb === 'get') {
  const id = positional[0];
  out({ tab: { tab_id: id, label: world.tabs?.[id] ?? panes.find(p => p.tab_id === id)?.label ?? id } });
} else if (group === 'workspace' && verb === 'get') {
  const id = positional[0];
  out({ workspace: { workspace_id: id, label: world.workspaces?.[id] ?? id } });
} else if (group === 'plugin' && verb === 'pane') out({ ok: true });
else if (group === 'notification' && verb === 'show') out({ shown: true });
else die('unknown_command', `fake herdr does not know: ${argv.join(' ')}`, 2);
