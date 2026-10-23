// What a click, or Enter in a text field, does. env = { call, run, confirm, selfPane, ownerPane, generation }:
// call(req) talks to the daemon, run(args) runs herdr, confirm(message) asks the user yes or no, and generation is
// the owner generation the screen displayed.
// Every write carries that generation, so the daemon refuses it if the mailbox changed hands since.

import { feedbackKey } from './feedback.mjs';
import { isWebUrl } from './launch.mjs';

const ANSWERS = {
  choose: a => ({ choice: a.choice, text: a.text }),
  recommend: a => ({ choice: 'P', text: a.text }),
  explain: a => ({ choice: 'E', text: a.text }),
  'note-text': a => ({ choice: a.choice ?? null, text: a.text }),
  reconfirm: a => ({ choice: a.choice ?? null, text: a.text }),
  reset: () => ({ choice: null, text: '' }),
};
// These keep focus in the screen: typing, the in-screen settings and attachment layer, and the controls inside it.
const KEEPS_FOCUS = new Set(['text-input', 'note-text', 'batch-note', 'attachment', 'open-url', 'settings', 'settings-set', 'overlay-input', 'overlay-close']);

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

// Settings open as a layer inside the mailbox pane (herdr popups do not show in the web interface, and one left open
// blocks the next). The layer is plain data, kept by the caller and passed back as env.overlay: { kind: 'settings', prefs, top }.
// Attachments and web addresses are not a layer: they go to the system's default program (see openExternal).
async function openOverlay(action, env) {
  if (action.type === 'settings') {
    const prefs = await env.call({ op: 'prefs-get' });
    return prefs.ok === false ? { ok: false, error: prefs.error } : { ok: true, overlay: { kind: 'settings', prefs: pickPrefs(prefs) } };
  }
  // settings-set: each change is saved at once; an open screen keeps its width until the next time it opens.
  const prefs = await env.call({ op: 'prefs-set', ...action.change });
  if (prefs.ok === false) return { ok: false, error: prefs.error, overlay: env.overlay ?? null };
  return { ok: true, overlay: { ...(env.overlay ?? { kind: 'settings' }), prefs: pickPrefs(prefs) } };
}

// An attachment's snapshot or a web address goes to the system's default program: an image opens in the viewer,
// a text file in whatever the system uses for it, a link in the default browser.
async function openExternal(action, env) {
  let target = action.url;
  if (action.type === 'attachment') {
    const res = await env.call({ op: 'attachment', uid: action.uid, index: action.index });
    if (res.ok === false) return { ok: false, error: res.error };
    target = res.path;
  } else if (!isWebUrl(target ?? '')) return { ok: false, error: 'bad_url' };
  if (!env.open) return { ok: false, error: 'cannot_open' };
  await env.open(target);
  return { ok: true };
}

const pickPrefs = p => ({ width: p.width, cardMode: p.cardMode, mergeSeconds: p.mergeSeconds, tooltipSeconds: p.tooltipSeconds, locale: p.locale });

// Keys and the wheel while a layer is open: they belong to the layer. Esc or q closes it; the arrows, Page keys,
// Home, End and the wheel scroll it (render keeps the position within the content).
function overlayInput(overlay, event) {
  if (!overlay) return null;
  if ((event.kind === 'key' && event.name === 'escape') || (event.kind === 'text' && event.text === 'q')) return null;
  const step = { up: -1, down: 1, pageup: -10, pagedown: 10, home: -Infinity, end: Infinity }[event.name];
  const by = event.kind === 'wheel' ? event.dir * 3 : event.kind === 'key' ? step : undefined;
  if (by === undefined) return overlay;
  // No upper limit here: render knows how many rows the content takes and keeps the position within them (main
  // copies that back). End only needs a bound past the last row: the attachment never wraps to more rows than it
  // has characters, and the settings are a handful of rows.
  return { ...overlay, top: Math.min(Math.max(0, (overlay.top ?? 0) + by), 1000) };
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
    // Settings are a layer inside the screen itself (overlay); these move or close it locally.
    if (action.type === 'overlay-input') return { ok: true, overlay: overlayInput(env.overlay ?? null, action.event) };
    if (action.type === 'overlay-close') return { ok: true, overlay: null };
    // The new-question hint only moves the view; it keeps focus in the screen.
    if (action.type === 'reveal') return { ok: true, scroll: action.scroll };
    // Void all and Resend ask first; the caller supplies the question (main draws it as a Yes / No row). A caller
    // without a confirm step has already decided.
    const asks = action.type === 'void-all' || (action.type === 'resolve-batch' && action.action === 'resend');
    if (asks && env.confirm && !(await env.confirm(action.confirm))) return { ok: true, cancelled: true };
    report('pending');
    if (action.type === 'attachment' || action.type === 'open-url') {
      const res = await openExternal(action, env);
      report(res.ok ? 'done' : 'failed', res.ok ? {} : { error: res.error });
      return res;
    }
    if (action.type === 'settings' || action.type === 'settings-set') {
      const res = await openOverlay(action, env);
      report(res.ok ? 'done' : 'failed', res.ok ? {} : { error: res.error });
      return res;
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
    const message = String(e.message || e);
    report('failed', { error: message });
    // The screen shows `error` in its notice line: for a link that is the only place the reason can appear.
    return { ok: false, error: message, message };
  }
}
