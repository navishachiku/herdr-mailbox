// Sender signature for outgoing messages: "[workspace/]position/role 💬 ".
// The role is the sender pane's label; the position is the sender tab's label with its first letter
// upper-cased (left out when it equals the role, ignoring case); the workspace label is added only
// when the recipient lives in another workspace.
import * as herdr from './herdr.mjs';

const MARK = ' 💬 ';
const HEAD_MAX = 80;

const get = async (...args) => JSON.parse(await herdr.run(args)).result;

// `to` is a pane id ("w1:p2") or an agent name; only the agent name needs a lookup.
export async function resolvePane(to) {
  return to.includes(':') ? to : (await get('agent', 'get', to)).agent.pane_id;
}

// null when the sender cannot be determined or has no names to sign with.
export async function signatureFor(senderPane, targetPane) {
  try {
    const { pane } = await get('pane', 'get', senderPane);
    const tab = pane.tab_id ? (await get('tab', 'get', pane.tab_id)).tab.label : '';
    const target = (await get('pane', 'get', targetPane)).pane;
    const role = pane.label || '';
    const position = tab && tab.toLowerCase() !== role.toLowerCase() ? tab[0].toUpperCase() + tab.slice(1) : '';
    const workspace = target.workspace_id !== pane.workspace_id ? (await get('workspace', 'get', pane.workspace_id)).workspace.label : '';
    return [workspace, position, role].filter(Boolean).join('/') || null;
  } catch { return null; }
}

// A signature already at the start of the text is replaced, so only one is left. The head counts as a
// signature only if it is shaped like one: no whitespace, parts separated by "/" (position/role or
// workspace/position/role); a single bare word counts only when it is exactly the computed signature
// (the role alone), so ordinary text that merely contains " 💬 " is left alone. Slash commands are
// sent untouched.
const SHAPE = /^[^\s/]+(?:\/[^\s/]+){1,2}$/;

export function withSignature(text, signature) {
  if (text.startsWith('/')) return text;
  const i = text.indexOf(MARK);
  const head = i > 0 && i <= HEAD_MAX ? text.slice(0, i) : '';
  const hasOne = head !== '' && (head === signature || SHAPE.test(head));
  return `${signature}${MARK}${hasOne ? text.slice(i + MARK.length) : text}`;
}
