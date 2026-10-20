// What a click, or Enter in a text field, does. env = { call, run, confirm, selfPane, ownerPane, generation }:
// call(req) talks to the daemon, run(args) runs herdr, confirm(message) asks the user yes or no, and generation is
// the owner generation the screen displayed.
// Every write carries that generation, so the daemon refuses it if the mailbox changed hands since.

import { feedbackKey } from './feedback.mjs';

const ANSWERS = {
  choose: a => ({ choice: a.choice, text: a.text }),
  recommend: a => ({ choice: 'P', text: a.text }),
  explain: a => ({ choice: 'E', text: a.text }),
  'note-text': a => ({ choice: a.choice ?? null, text: a.text }),
  reconfirm: a => ({ choice: a.choice ?? null, text: a.text }),
  reset: () => ({ choice: null, text: '' }),
};
// Popups keep the focus they were opened with, and typing in the screen must never leave it.
const KEEPS_FOCUS = new Set(['text-input', 'note-text', 'batch-note', 'attachment', 'settings']);

const popup = (entrypoint, ...env) => ['plugin', 'pane', 'open', '--plugin', 'herdr-mailbox', '--entrypoint', entrypoint, '--placement', 'popup', ...env.flatMap(e => ['--env', e])];

// The receiver is the pane to the left of the screen, so focus moves one pane left from the screen's own pane.
async function handBack(env) {
  if (!env.selfPane) return;
  await env.run(['pane', 'focus', '--pane', env.selfPane, '--direction', 'left']).catch(() => {});
}

async function write(action, env) {
  const base = { mailbox: action.mailbox, generation: env.generation };
  const { call } = env;
  const answer = (item, body) => call({ op: 'answer', uid: item.uid, version: item.version, ...body, confirm: true, ...base });
  switch (action.type) {
    case 'choose': case 'recommend': case 'explain': case 'note-text': case 'reconfirm': case 'reset':
      return answer(action, ANSWERS[action.type](action));
    case 'reset-all': {
      let last = { ok: true };
      for (const item of action.items ?? []) {
        last = await answer(item, ANSWERS.reset());
        if (!last.ok) break;
      }
      return last;
    }
    case 'submit': return call({ op: 'submit', items: action.items, ...base });
    // Void: answer X ("no answer needed") and send at once, one question or, after a confirmation, all of them.
    case 'void': {
      const res = await answer(action, { choice: 'X', text: action.text ?? '' });
      return res.ok === false ? res : call({ op: 'submit', items: [{ uid: action.uid, version: action.version }], ...base });
    }
    case 'void-all': {
      for (const item of action.items ?? []) {
        const res = await answer(item, { choice: 'X', text: '' });
        if (res.ok === false) return res;
      }
      return call({ op: 'submit', items: action.items, ...base });
    }
    case 'bulk-recommend': return call({ op: 'bulk', action: 'recommend', uids: action.uids, text: action.text, ...base });
    case 'bulk-explain': return call({ op: 'bulk', action: 'explain', uids: action.uids, text: action.text, ...base });
    case 'deliver-now': return call({ op: 'deliver-now', ...base });
    case 'resolve-batch': return call({ op: 'resolve-batch', batch: action.batch, action: action.action, ...base });
    case 'batch-note': return { ok: true };
    case 'card-mode': return call({ op: 'prefs-set', cardMode: action.mode });
    default: return null;
  }
}

// Returns { ok, error?, model? }. When the daemon says what the screen showed is out of date, the fresh view
// comes back as `model` so the caller can redraw at once instead of waiting for the next poll.
// Every stage is also reported through env.onFeedback (see feedback.mjs): 'pending' before the first request goes
// out, so the element can show it is busy in the same frame; then 'done', 'failed' with the reason, or for Deliver
// now 'delivering', since the daemon only accepting it does not mean it landed.
export async function perform(action, env) {
  const now = env.now ?? Date.now;
  const report = (state, extra = {}) => env.onFeedback?.({ key: feedbackKey(action), type: action.type, state, at: now(), ...extra });
  try {
    if (action.type === 'text-input') return { ok: true };
    // The new-question hint only moves the view; it keeps focus in the screen.
    if (action.type === 'reveal') return { ok: true, scroll: action.scroll };
    // Void all and Resend ask first; the caller supplies the question (main draws it as a Yes / No row). A caller
    // without a confirm step has already decided.
    const asks = action.type === 'void-all' || (action.type === 'resolve-batch' && action.action === 'resend');
    if (asks && env.confirm && !(await env.confirm(action.confirm))) return { ok: true, cancelled: true };
    report('pending');
    if (action.type === 'attachment' || action.type === 'settings') {
      await env.run(action.type === 'attachment' ? popup('attachment', `HERDR_MAILBOX_UID=${action.uid}`) : popup('settings'));
      report('done');
      return { ok: true };
    }
    const res = await write(action, { ...env, confirm: async () => true });
    if (!res) { report('failed', { error: 'unknown_action' }); return { ok: false, error: 'unknown_action' }; }
    // A write can fail as a whole or per question (submit answers question by question). Any failure is reported
    // as one, and the screen reloads so it shows what the daemon actually holds.
    const failedItem = (res.results ?? []).find(r => r.ok === false);
    const failed = res.ok === false || Boolean(failedItem);
    const out = { ok: !failed, ...(failed ? { error: res.error ?? failedItem.error } : {}) };
    if (failed && action.mailbox) out.model = await env.call({ op: 'view', mailbox: action.mailbox });
    report(failed ? 'failed' : action.type === 'deliver-now' ? 'delivering' : 'done', failed ? { error: out.error } : {});
    if (!KEEPS_FOCUS.has(action.type)) await handBack(env);
    return out;
  } catch (e) {
    report('failed', { error: String(e.message || e) });
    return { ok: false, error: 'failed', message: String(e.message || e) };
  }
}
