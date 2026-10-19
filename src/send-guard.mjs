#!/usr/bin/env node
// PreToolUse hook (matcher Bash): sends between agents go through the mailbox instead of typing into the receiver.
//   - `herdr agent prompt <target> <text>` (no --wait) and herdr-holdback's `send.mjs --to <target> <text>` to an
//     agent pane are rewritten to `mailbox send --to <target> --type note <text>`; the daemon decides between
//     the mailbox and a direct send.
//   - A target without a mailbox is never rewritten (with or without --wait): only the input box is checked,
//     and typed or unreadable text blocks (exit 2). A target that has a mailbox is rewritten, --wait included.
//   - Slash commands, sends to the sender's own pane and non-agent panes pass untouched.
// Short-term limit (rewrite correctness): a call is rewritten only in the plain form
//   herdr agent prompt <target> <one literal argument> [--wait]   (or holdback's send.mjs --to <target> <text>)
// with no `$` or backtick in it and nothing else in the command (no redirect, pipe, &&, ;). Anything else sent to
// an agent that has a mailbox is blocked with the mailbox command to use instead,
// because rewriting would change what the shell does with expansions and redirects.
// Removal condition: the rewrite keeps the original shell semantics (expansions, redirects, trailing commands).
// Non-Claude receivers (codex, agy, ...): an input box that cannot be read is let through instead of blocked.
// Removal condition: screen samples of that agent's input box are added to input-box.mjs, then it follows the same three states.
// Only direct invocations are seen (no subshells, bash -c, ssh, eval, xargs). Exit 2 blocks the call and feeds
// stderr to the model. Any hook failure exits 0: this hook must never fail a tool call.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as herdr from './herdr.mjs';
import { signatureFor, withSignature } from './signature.mjs';
import { classify, typedText } from './input-box.mjs';
import { STATE_FILE } from './paths.mjs';

const MAILBOX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'mailbox.mjs');
const MAX_TYPED = 40;
const VALUE_OPTS = new Set(['--timeout', '--until', '--source', '--lines', '--format', '--machine']);
const SLASH_RE = /^\/[A-Za-z][\w:-]*(?:\s|$)/;

// ---- shell tokenizer ------------------------------------------------------

// Splits a command into segments (separated by && || ; | & and newlines) of
// tokens. Quotes and backslash escapes are resolved; $ expansions are not.
function tokenize(command) {
  const segments = [];
  const fresh = () => Object.assign([], { spans: [], substitutions: [] });
  let tokens = fresh();
  let cur = '';
  let substitution = false;
  let has = false;
  let start = -1;
  let pos = 0;
  const endToken = () => {
    if (has) {
      tokens.push(cur);
      tokens.spans.push([start, pos]);
      tokens.substitutions.push(substitution);
    }
    cur = '';
    substitution = false;
    has = false;
    start = -1;
  };
  const endSegment = () => {
    endToken();
    if (tokens.length) segments.push(tokens);
    tokens = fresh();
  };
  const heredocs = [];
  const SPECIAL = new Set([' ', '\t', '"', "'", '$', '\\', '`', '&', '|', ';', '<', '>', '(', ')', '\n']);
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    const here = i;
    pos = i;
    if (c === '$' && command[i + 1] === "'") {
      has = true;
      const ESC = { n: '\n', t: '\t', r: '\r', '\\': '\\', "'": "'", '"': '"' };
      for (i += 2; i < command.length && command[i] !== "'"; i++) {
        if (command[i] === '\\' && i + 1 < command.length) {
          const n = command[i + 1];
          cur += n in ESC ? ESC[n] : `\\${n}`;
          i++;
        } else cur += command[i];
      }
    } else if (c === '<' && command[i + 1] === '<' && command[i + 2] !== '<') {
      let j = i + 2;
      const dash = command[j] === '-';
      if (dash) j++;
      while (command[j] === ' ' || command[j] === '\t') j++;
      const q = command[j] === "'" || command[j] === '"' ? command[j] : '';
      if (q) j++;
      let word = '';
      while (j < command.length && (q ? command[j] !== q : !/[\s;&|<>()]/.test(command[j]))) word += command[j++];
      if (q) j++;
      if (word) heredocs.push({ word, dash });
      endToken();
      i = j - 1;
    } else if (c === "'") {
      const j = command.indexOf("'", i + 1);
      const end = j < 0 ? command.length : j;
      cur += command.slice(i + 1, end);
      has = true;
      i = end;
    } else if (c === '"') {
      has = true;
      i++;
      for (; i < command.length && command[i] !== '"'; i++) {
        if (command[i] === '\\' && '"\\$`'.includes(command[i + 1] ?? '')) i++;
        else if (command[i] === '`' || (command[i] === '$' && command[i + 1] === '(')) substitution = true;
        cur += command[i];
      }
    } else if (c === '\\') {
      const n = command[i + 1];
      if (n !== undefined && SPECIAL.has(n)) {
        if (n !== '\n') cur += n;
        has = has || n !== '\n';
        i++;
      } else {
        cur += c;
        has = true;
      }
    } else if (c === ' ' || c === '\t' || c === '\r') {
      endToken();
    } else if (c === '\n' || c === ';' || c === '|' || c === '&') {
      endSegment();
      if (c === '\n') {
        for (const h of heredocs.splice(0)) {
          let pos = i + 1;
          while (pos < command.length) {
            let nl = command.indexOf('\n', pos);
            if (nl < 0) nl = command.length;
            const line = command.slice(pos, nl).replace(/\r$/, '');
            pos = nl + 1;
            if ((h.dash ? line.replace(/^\t+/, '') : line) === h.word) break;
          }
          i = pos - 1;
        }
      }
      if ((c === '|' || c === '&') && command[i + 1] === c) i++;
    } else {
      if (c === '`' || (c === '$' && command[i + 1] === '(')) substitution = true;
      cur += c;
      has = true;
    }
    if (has && start < 0) start = here;
  }
  pos = command.length;
  endSegment();
  return segments;
}

const isHerdr = (tok) => /^herdr(?:\.exe)?$/i.test(tok.split(/[\\/]/).pop());
const isHoldbackSend = (tok) => /(?:^|[\\/])herdr-holdback[\\/]src[\\/]send\.mjs$/.test(tok);

// Delivery calls found in one segment: { target, text, wait, from, to } where from/to are the character
// range of the whole call in the command (so only that call is rewritten).
function actionsIn(tokens, single) {
  const out = [];
  const literal = (...vals) => vals.every((v) => !/[$`]/.test(v));
  const range = (i) => [tokens.spans[i][0], tokens.spans[tokens.length - 1][1]];
  for (let i = 0; i < tokens.length; i++) {
    if (isHerdr(tokens[i])) {
      let j = i + 1;
      while (j < tokens.length && tokens[j].startsWith('--')) j += tokens[j].includes('=') || !VALUE_OPTS.has(tokens[j]) ? 1 : 2;
      if (tokens[j] !== 'agent' || tokens[j + 1] !== 'prompt') continue;
      const pos = [];
      let wait = false;
      for (let k = j + 2; k < tokens.length; k++) {
        const t = tokens[k];
        if (t.startsWith('--')) {
          if (t === '--wait') wait = true;
          else if (!t.includes('=') && VALUE_OPTS.has(t)) k++;
          continue;
        }
        pos.push(k);
      }
      if (pos.length >= 2) {
        const plain = single && i === 0 && tokens.filter((t) => t !== '--wait').length === 5 && !tokens.substitutions.some(Boolean) && literal(tokens[pos[0]], tokens[pos[1]]);
        out.push({ target: tokens[pos[0]], text: tokens[pos[1]], wait, plain, range: range(i) });
      }
    } else if (isHoldbackSend(tokens[i])) {
      const to = tokens.indexOf('--to', i + 1);
      const target = to >= 0 ? tokens[to + 1] : undefined;
      const text = tokens.slice(i + 1).find((t, n) => !t.startsWith('--') && i + 1 + n !== to + 1);
      const at = text === undefined ? -1 : tokens.indexOf(text, i + 1);
      if (target && at >= 0) {
        const start = tokens[i - 1] === 'node' ? i - 1 : i;
        const plain = single && start === 0 && tokens.length - start === (start === i ? 4 : 5) && !tokens.substitutions.some(Boolean) && literal(target, text);
        out.push({ target, text, wait: false, plain, range: range(start) });
      }
    }
  }
  return out;
}

// The target as { pane_id, workspace_id } when it is an agent pane; null when herdr cannot say or it hosts no agent.
async function agentReceiver(target) {
  for (const read of [() => herdr.agentGet(target), () => herdr.paneGet(target)]) {
    try {
      const r = await read();
      if (r) return r.agent ? r : null;
    } catch { /* try the next lookup */ }
  }
  return null;
}

// Reads the state file directly: the hook must not start a daemon just to ask a question.
function hasMailbox(pane) {
  try {
    const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    return Object.values(state.mailboxes ?? {}).some((b) => b.owner?.pane === pane || b.key === pane || b.id === pane);
  } catch {
    return false;
  }
}

// Only an empty box is safe to dispatch into: typing is someone's draft, unknown is anything we cannot read
// as a Claude input box (blank screen, failed read, agent list taking the arrow keys).
async function inputBox(pane) {
  try {
    const screen = await herdr.readScreen(pane);
    const state = classify(screen);
    return state === 'empty' ? {} : state === 'typing' ? { typed: typedText(screen) } : { unknown: true };
  } catch {
    return { unknown: true };
  }
}

const shellQuote = (s) => `'${s.replace(/'/g, `'\\''`)}'`;

async function judge(action, ownPane) {
  const receiver = await agentReceiver(action.target);
  if (!receiver || receiver.pane_id === ownPane || SLASH_RE.test(action.text)) return { pass: true };
  // No mailbox: nothing to rewrite into, so a plain or --wait send goes straight through after the typing check.
  if (!hasMailbox(receiver.pane_id)) {
    const box = await inputBox(receiver.pane_id);
    // Only Claude's input box can be read here; for another agent herdr's own agent_blocked protection applies.
    if (box.unknown && receiver.agent !== 'claude') return { pass: true };
    if (box.unknown) return { block: `Blocked: cannot confirm ${action.target}'s input box is empty, so the message could land on top of someone's typing. Try again in a moment.` };
    if (box.typed) {
      const chars = Array.from(box.typed);
      const shown = chars.length > MAX_TYPED ? `${chars.slice(0, MAX_TYPED).join('')}…` : box.typed;
      return { block: `Blocked: someone is typing in ${action.target}'s input box ("${shown}"). Wait until it is empty; do not clear it or submit it for them.` };
    }
    return { pass: true };
  }
  if (!action.plain) {
    return { block: `Blocked: messages to ${action.target} go through the mailbox, and this command is not a plain herdr agent prompt <target> "<text>" (it has expansions, a redirect, a pipe or other commands). Use: mailbox send --to ${action.target} --type note "<text>"` };
  }
  const signature = ownPane ? await signatureFor(ownPane, receiver.pane_id) : null;
  const text = signature ? withSignature(action.text, signature) : action.text;
  return { rewrite: `node ${shellQuote(MAILBOX)} send --to ${shellQuote(receiver.pane_id)} --type note ${shellQuote(text)}` };
}

async function main() {
  let payload;
  try { payload = JSON.parse(fs.readFileSync(0, 'utf8')); } catch { return 0; }
  if ((payload?.tool_name ?? payload?.toolName) !== 'Bash') return 0;
  const command = payload.tool_input?.command ?? payload.toolInput?.command;
  if (typeof command !== 'string' || !/herdr/i.test(command)) return 0;
  const ownPane = process.env.HERDR_PANE_ID || '';
  const edits = [];
  const segments = tokenize(command);
  for (const segment of segments) {
    for (const action of actionsIn(segment, segments.length === 1)) {
      const v = await judge(action, ownPane);
      if (v.block) { process.stderr.write(`${v.block}\n`); return 2; }
      if (v.rewrite) edits.push({ range: action.range, text: v.rewrite });
    }
  }
  if (!edits.length) return 0;
  let fixed = command;
  for (const e of edits.sort((a, b) => b.range[0] - a.range[0])) fixed = fixed.slice(0, e.range[0]) + e.text + fixed.slice(e.range[1]);
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'allow',
      permissionDecisionReason: 'Agent-to-agent message sent through the mailbox',
      updatedInput: { ...payload.tool_input, command: fixed },
    },
  }));
  return 0;
}

let code = 0;
try { code = await main(); } catch { code = 0; }
process.exit(code);
