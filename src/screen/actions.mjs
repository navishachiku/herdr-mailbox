// What a click, or Enter in a text field, does. env = { call, run, selfPane, ownerPane, generation }:
// call(req) talks to the daemon, run(args) runs herdr, and generation is the owner generation the screen displayed.
// Every write carries that generation, so the daemon refuses it if the mailbox changed hands since.

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
const STALE = new Set(['stale_version', 'stale_owner', 'unknown_uid', 'not_pending']);

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
export async function perform(action, env) {
  try {
    if (action.type === 'text-input') return { ok: true };
    if (action.type === 'attachment') { await env.run(popup('attachment', `HERDR_MAILBOX_UID=${action.uid}`)); return { ok: true }; }
    if (action.type === 'settings') { await env.run(popup('settings')); return { ok: true }; }
    const res = await write(action, env);
    if (!res) return { ok: false, error: 'unknown_action' };
    const refused = res.ok === false && STALE.has(res.error);
    const stale = refused || (res.results ?? []).some(r => r.ok === false && STALE.has(r.error));
    const out = { ok: res.ok !== false && !stale, ...(res.error ? { error: res.error } : {}) };
    if (stale && action.mailbox) out.model = await env.call({ op: 'view', mailbox: action.mailbox });
    if (!KEEPS_FOCUS.has(action.type)) await handBack(env);
    return out;
  } catch (e) {
    return { ok: false, error: 'failed', message: String(e.message || e) };
  }
}
