// Mailbox state and rules: validation, receipts, duplicate detection, edit, withdraw and supersede.
// Pure of sockets and timers; the daemon wraps it and the tests drive it with a fake clock.
// Every mutating call saves to disk before it returns, so an acknowledged letter is never lost.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const LIMITS = { question: 200, option: 80, idea: 300, note: 500 };
export const DEDUP_MS = 30_000;
const PRIORITIES = ['high', 'medium', 'low'];
const TYPES = ['note', 'decision', 'discussion'];
const OPEN = ['queued', 'pending'];
const LETTERS = 'ABCD';
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

const BUILTIN = { send: 'send', edit: 'edit', withdraw: 'withdraw', status: 'status', answer: 'answer', submit: 'submit' };
const len = s => [...String(s)].length;
const fail = (error, message, extra) => ({ ok: false, error, message, ...extra });
// Serial numbers (Q003, N012) are for people only; agents must name a letter by uid.
const SERIAL = /^[A-Z]\d{3,}$/;

// The screen shows each option's letter itself, so a sender who wrote it into the option text would show it twice.
// Only the option's own letter is taken off, and only when text remains after it:
// - with brackets or punctuation it always goes: "(A)", "（A）", "[A]", "A.", "A:", "A)", "A、", "A："
// - a bare letter and a space goes only when a non-Latin character follows ("A 改甲"), because in Latin text it is
//   usually a word ("A new plan", "A plan" stay); a letter joined to the next word ("A.I. tools", "Apple") stays too
function ownLetterOff(option, letter) {
  if (!letter) return option;
  const m = new RegExp(`^\\s*(?:[(（\\[]${letter}[)）\\]]\\s*|${letter}[、：）]\\s*|${letter}[.):]\\s+|${letter}\\s+(?=[^\\sA-Za-z0-9\\u00C0-\\u024F]))`).exec(option);
  const rest = m ? option.slice(m[0].length) : option;
  return rest.trim() ? rest : option;
}

export function newUid(now) {
  let t = now;
  let head = '';
  for (let i = 0; i < 10; i++) { head = CROCKFORD[t % 32] + head; t = Math.floor(t / 32); }
  const rand = crypto.randomBytes(16);
  let tail = '';
  for (let i = 0; i < 16; i++) tail += CROCKFORD[rand[i] % 32];
  return head + tail;
}

export function newMailboxId(taken) {
  for (;;) {
    const id = `MB-${crypto.randomBytes(2).toString('hex')}`;
    if (!taken[id]) return id;
  }
}

export class Mailboxes {
  constructor({ state, save, now = Date.now, attachDir }) {
    Object.assign(this, { state, persist: save, now, attachDir });
    this.ops = new Map();
    this.ticks = [];
    this.listeners = {};
    // route and direct are single slots (a later module replaces the default); guards all run.
    this.hooks = { route: to => ({ kind: 'direct', pane: to }), direct: null, guard: [], annotate: [] };
  }

  save() { this.persist(this.state); }

  // Modules (identity, delivery, screen-api) each export default function register(api).
  register(mod) {
    const core = this;
    mod({
      op(name, handler, { mutates = false } = {}) {
        if (core.ops.has(name) || BUILTIN[name]) throw new Error(`op ${name} is already registered`);
        core.ops.set(name, { handler, mutates });
      },
      tick(name, fn, everyMs) { core.ticks.push({ name, fn, everyMs }); },
      on(event, fn) { (core.listeners[event] ??= []).push(fn); },
      emit: (event, payload) => core.emit(event, payload),
      hook(name, fn) {
        if (name === 'guard' || name === 'annotate') core.hooks[name].push(fn);
        else if (name === 'route' || name === 'direct') core.hooks[name] = fn;
        else throw new Error(`unknown hook ${name}`);
      },
      get state() { return core.state; },
      save: () => core.save(),
      now: () => core.now(),
    });
  }

  // A failing listener must not undo or fail the call that raised the event.
  emit(event, payload) {
    for (const fn of this.listeners[event] ?? []) { try { fn(payload); } catch { /* listener bug */ } }
  }

  // Guards run before any op does its work; the first failure is the answer.
  guard(op, req, ctx) {
    for (const fn of this.hooks.guard) { const r = fn(op, req, ctx); if (r && r.ok === false) return r; }
    return null;
  }

  // Extra receipt fields from modules (owner changes, disconnect hints). kind is 'send' or 'status'.
  annotate(kind, mailbox, sender) {
    return Object.assign({}, ...this.hooks.annotate.map(fn => fn(kind, mailbox, sender)));
  }

  // Checks fields and builds the content that is stored, deduplicated and edited.
  // `attach` is already read: { name, sha256, data }. `direct` letters never enter a mailbox, so they have no note length limit.
  normalize(type, f, attach, { direct = false } = {}) {
    if (!TYPES.includes(type)) return fail('bad_type', `type must be one of ${TYPES.join(', ')}`);
    if (f.priority && !PRIORITIES.includes(f.priority)) return fail('bad_priority', `priority must be one of ${PRIORITIES.join(', ')}`);
    const content = { type };
    const tooLong = (what, limit) => fail('too_long', `${what} is over ${limit} characters; put the long text in a file and pass it with --attach <file>`);
    if (type === 'note') {
      const text = String(f.text ?? '');
      if (!text.trim() && !attach) return fail('missing_text', 'a note needs text or --attach');
      if (!direct && len(text) > LIMITS.note) return tooLong('note text', LIMITS.note);
      content.text = text;
    } else {
      const question = String(f.question ?? '');
      if (!question.trim()) return fail('missing_question', `a ${type} question needs --question`);
      if (len(question) > LIMITS.question) return tooLong('question', LIMITS.question);
      content.question = question;
    }
    if (type === 'decision') {
      const options = (f.options ?? []).map((o, i) => ownLetterOff(String(o), LETTERS[i]));
      if (options.length < 2 || options.length > 4) return fail('bad_options', `a decision question needs 2 to 4 options, got ${options.length}`);
      const long = options.findIndex(o => len(o) > LIMITS.option);
      if (long >= 0) return tooLong(`option ${LETTERS[long]}`, LIMITS.option);
      const recommend = String(f.recommend ?? '').toUpperCase();
      if (!recommend) return fail('missing_recommend', `a decision question needs --recommend <${LETTERS.slice(0, options.length).split('').join('|')}>`);
      if (!LETTERS.slice(0, options.length).includes(recommend) || recommend.length !== 1) return fail('bad_recommend', `--recommend must be one of ${LETTERS.slice(0, options.length).split('').join(', ')}`);
      Object.assign(content, { options, recommend });
    }
    if (type === 'discussion' && f.idea) {
      if (len(f.idea) > LIMITS.idea) return tooLong('idea', LIMITS.idea);
      content.idea = String(f.idea);
    }
    if (attach) content.attach = { name: attach.name, sha256: attach.sha256 };
    return { ok: true, content };
  }

  readAttach(file) {
    if (!file) return { ok: true, attach: null };
    try {
      const data = fs.readFileSync(file);
      return { ok: true, attach: { name: path.basename(file), sha256: crypto.createHash('sha256').update(data).digest('hex'), data } };
    } catch (e) { return fail('bad_attach', `cannot read attachment ${file}: ${e.code || e.message}`); }
  }

  // The snapshot is copied into the mailbox, so later changes to the original do not change the letter.
  snapshot(uid, version, attach) {
    const dir = path.join(this.attachDir, uid);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const file = path.join(dir, `v${version}-${attach.name}`);
    fs.writeFileSync(file, attach.data, { mode: 0o600 });
    return file;
  }

  keyOf(c, withSender) {
    return JSON.stringify([withSender, c.type, c.text ?? null, c.question ?? null, c.options ?? null, c.recommend ?? null, c.idea ?? null, c.attach?.sha256 ?? null, c.supersedes ?? null]);
  }

  // The letters this sender still has open in one mailbox: queued notes and pending questions.
  pendingOf(sender, mailbox) {
    return Object.values(this.state.letters)
      .filter(l => l.sender === sender && l.mailbox === mailbox && OPEN.includes(l.status))
      .sort((a, b) => a.createdAt - b.createdAt)
      .map(l => this.brief(l));
  }

  brief(l) {
    const c = l.content;
    return {
      uid: l.uid, serial: l.serial, type: l.type, status: l.status, edited: l.edited, userAnswered: this.answered(l),
      summary: (c.text ?? c.question).replace(/\s+/g, ' ').slice(0, 60),
    };
  }

  answered(l) { return Boolean(l.draft && (l.draft.choice || l.draft.text.trim())); }

  // A uid argument: serial numbers get a specific hint, anything else unknown is just unknown.
  find(uid) {
    if (SERIAL.test(String(uid))) return fail('serial_not_accepted', `${uid} is a serial number shown to people; name the letter by its uid`);
    const l = this.state.letters[uid];
    return l ? { ok: true, letter: l } : fail('unknown_uid', `no letter with uid ${uid}`);
  }

  receipt(l, sender, extra = {}) {
    return { ok: true, uid: l.uid, serial: l.serial, status: l.status, version: l.version, pending: this.pendingOf(sender, l.mailbox), ...extra };
  }

  send(req) {
    const { to, from = 'unknown', type, supersedes } = req;
    if (!to) return fail('missing_to', '--to is required');
    const att = this.readAttach(req.attach);
    if (!att.ok) return att;
    const dest = this.hooks.route(to, req);
    if (dest.ok === false) return dest;
    const norm = this.normalize(type, req, att.attach, { direct: dest.kind === 'direct' });
    if (!norm.ok) return norm;
    const content = norm.content;
    if (supersedes) {
      if (type === 'note') return fail('bad_supersedes', '--supersedes applies to decision and discussion questions');
      content.supersedes = supersedes;
    }
    if (dest.kind === 'direct') {
      return this.hooks.direct ? this.hooks.direct(req, content) : fail('no_mailbox', `${to} has no mailbox`);
    }
    const box = this.state.mailboxes[dest.id];
    if (!box) return fail('unknown_mailbox', `no mailbox ${dest.id}`);
    const now = this.now();
    const live = l => l.mailbox === dest.id && !['withdrawn', 'superseded'].includes(l.status);
    const sameSender = this.keyOf(content, from);
    const dup = Object.values(this.state.letters).find(l => live(l) && l.sender === from && now - l.createdAt < DEDUP_MS && this.keyOf(l.content, from) === sameSender);
    if (dup) return this.receipt(dup, from, { duplicate: true, reason: 'duplicate', ...this.annotate('send', box.id, from) });
    if (type === 'decision') {
      const anyone = this.keyOf(content, '');
      const open = Object.values(this.state.letters).find(l => live(l) && l.sender === from && l.type === 'decision' && l.status === 'pending' && !this.answered(l) && this.keyOf(l.content, '') === anyone);
      if (open) return this.receipt(open, from, { duplicate: true, reason: 'duplicate_open_question', ...this.annotate('send', box.id, from) });
    }
    // Checked after the duplicate lookups: a resend of a letter that already superseded its target gets the
    // original receipt back instead of a "not active" error.
    if (supersedes) {
      const old = this.find(supersedes);
      if (!old.ok) return old;
      const o = old.letter;
      if (o.mailbox !== dest.id) return fail('bad_supersedes', 'the superseded letter is in another mailbox');
      if (o.sender !== from) return fail('not_sender', 'only the sender of a letter can supersede it');
      if (this.answered(o) && o.status === 'pending') return fail('user_answered', 'The user has already answered this question; it cannot be superseded until the answer is sent');
      if (!['pending', 'submitted'].includes(o.status)) return fail('not_active', `the letter is ${o.status}`);
    }
    box.counter += 1;
    const uid = newUid(now);
    const letter = {
      uid, serial: `${type === 'note' ? 'N' : 'Q'}${String(box.counter).padStart(3, '0')}`, mailbox: box.id, sender: from, type,
      status: type === 'note' ? 'queued' : 'pending', edited: false, version: 1, priority: req.priority || 'medium', tags: req.tags ?? [],
      createdAt: now, updatedAt: now, content, draft: null,
    };
    try {
      if (att.attach) content.attach.path = this.snapshot(uid, 1, att.attach);
    } catch (e) { box.counter -= 1; return fail('bad_attach', `cannot store the attachment: ${e.code || e.message}`); }
    this.state.letters[uid] = letter;
    if (supersedes) { const o = this.state.letters[supersedes]; o.status = 'superseded'; o.supersededBy = uid; o.updatedAt = now; }
    const extra = this.annotate('send', box.id, from);
    this.save();
    this.emit('letter', { letter });
    return this.receipt(letter, from, extra);
  }

  // Edit and withdraw share the checks: the caller sent the letter, it is a question, and the user has not answered.
  editable(uid, from) {
    const found = this.find(uid);
    if (!found.ok) return found;
    const l = found.letter;
    if (l.sender !== from) return fail('not_sender', 'only the sender of a letter can change it');
    if (l.type === 'note') return fail('not_editable', 'notes cannot be edited or withdrawn');
    if (l.status !== 'pending') return fail('not_pending', `the letter is ${l.status}; send a new question with --supersedes <uid> instead`);
    if (this.answered(l)) return fail('user_answered', 'The user has already answered this question; wait for the answer to be sent, then send a new question with --supersedes <uid>');
    return { ok: true, letter: l };
  }

  edit(req) {
    const e = this.editable(req.uid, req.from ?? 'unknown');
    if (!e.ok) return e;
    const l = e.letter;
    const att = this.readAttach(req.attach);
    if (!att.ok) return att;
    const old = l.content;
    const merged = {
      question: req.question ?? old.question, options: req.options ?? old.options, recommend: req.recommend ?? old.recommend,
      idea: req.idea ?? old.idea, priority: req.priority ?? l.priority,
    };
    const norm = this.normalize(l.type, merged, att.attach ?? old.attach);
    if (!norm.ok) return norm;
    const content = norm.content;
    if (old.supersedes) content.supersedes = old.supersedes;
    // Changing the attachment counts as changing the question: the version moves on either way.
    const version = l.version + 1;
    if (att.attach) content.attach.path = this.snapshot(l.uid, version, att.attach);
    else if (old.attach) content.attach = old.attach;
    if (this.keyOf(content, '') === this.keyOf(old, '') && merged.priority === l.priority) return this.receipt(l, l.sender, { unchanged: true });
    Object.assign(l, { content, priority: merged.priority, version, edited: true, updatedAt: this.now() });
    this.save();
    return this.receipt(l, l.sender);
  }

  withdraw(req) {
    const e = this.editable(req.uid, req.from ?? 'unknown');
    if (!e.ok) return e;
    if (!req.reason?.trim()) return fail('missing_reason', '--reason is required');
    Object.assign(e.letter, { status: 'withdrawn', withdrawReason: req.reason, updatedAt: this.now() });
    this.save();
    return this.receipt(e.letter, e.letter.sender);
  }

  status(req) {
    const from = req.from ?? 'unknown';
    const routed = req.to ? this.hooks.route(req.to, req) : null;
    if (routed?.ok === false) return routed;
    const ids = req.to ? [routed.id].filter(Boolean) : Object.keys(this.state.mailboxes);
    const mailboxes = ids.map(id => {
      const box = this.state.mailboxes[id];
      return { to: box.owner?.pane ?? id, mailbox: id, pending: this.pendingOf(from, id) };
    });
    return { ok: true, mailboxes: mailboxes.filter(b => b.pending.length), ...(ids.length === 1 ? this.annotate('status', ids[0], from) : {}) };
  }

  // The write interface for the user's answers; the mailbox screen is a later task. Every answer carries the version
  // that was on screen, so an answer to a question that was edited in the meantime is refused.
  answer(req, ctx = {}) {
    const found = this.find(req.uid);
    if (!found.ok) return found;
    const l = found.letter;
    if (l.status !== 'pending') return fail('not_pending', `the letter is ${l.status}`);
    if (req.version !== l.version) return fail('stale_version', 'the question changed; reload it', { version: l.version });
    const choice = req.choice ? String(req.choice).toUpperCase() : null;
    const text = String(req.text ?? '');
    // X voids the question: the user says it no longer needs an answer.
    const valid = l.type === 'decision' ? [...LETTERS.slice(0, l.content.options.length), 'P', 'E', 'X'] : ['E', 'X'];
    if (choice && !valid.includes(choice)) return fail('bad_choice', `choice must be one of ${valid.join(', ')}`);
    l.draft = choice || text.trim() ? { choice, text } : null;
    l.updatedAt = this.now();
    this.save();
    return { ok: true, uid: l.uid, version: l.version, userAnswered: this.answered(l) };
  }

  // Marks answered questions as sent. Delivery to the receiver is a later task; this is the state change.
  submit(req, ctx = {}) {
    const submitted = {};
    const results = (req.items ?? []).map(({ uid, version }) => {
      const found = this.find(uid);
      if (!found.ok) return { uid, ...found };
      const l = found.letter;
      if (l.status !== 'pending' || !this.answered(l)) return { uid, ok: false, error: 'not_answered' };
      if (l.version !== version) return { uid, ok: false, error: 'stale_version', version: l.version };
      l.status = 'submitted';
      l.updatedAt = this.now();
      (submitted[l.mailbox] ??= []).push(uid);
      return { uid, ok: true };
    });
    this.save();
    for (const [mailbox, uids] of Object.entries(submitted)) this.emit('submitted', { mailbox, uids });
    return { ok: true, results };
  }

  // Mutating calls run against a copy: if saving to disk fails, the in-memory state is put back and the
  // sender gets a failure, so nothing is acknowledged that is not on disk and a resend can land for real.
  // Registered handlers may be async (the daemon runs requests one at a time, so the copy stays valid).
  handle(req, ctx = {}) {
    // Guards see every op; a guard decides which ones it cares about.
    const denied = this.guard(req.op, req, ctx);
    if (denied) return denied;
    const registered = this.ops.get(req.op);
    if (!registered && !BUILTIN[req.op]) return fail('bad_op', `unknown op ${req.op}`);
    const mutates = registered ? registered.mutates : req.op !== 'status';
    const run = () => (registered ? registered.handler(req, ctx) : this[BUILTIN[req.op]](req, ctx));
    if (!mutates) {
      try { return run(); } catch (e) { return fail('internal', String(e.message || e)); }
    }
    const backup = structuredClone(this.state);
    const restore = e => {
      this.state = backup;
      return fail('save_failed', `the letter was not saved (${e.code || e.message}); nothing was sent, try again`);
    };
    try {
      const r = run();
      return r && typeof r.then === 'function' ? r.catch(restore) : r;
    } catch (e) { return restore(e); }
  }
}
