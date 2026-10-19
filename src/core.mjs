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

const len = s => [...String(s)].length;
const fail = (error, message, extra) => ({ ok: false, error, message, ...extra });
// Serial numbers (Q003, N012) are for people only; agents must name a letter by uid.
const SERIAL = /^[A-Z]\d{3,}$/;

export function newUid(now) {
  let t = now;
  let head = '';
  for (let i = 0; i < 10; i++) { head = CROCKFORD[t % 32] + head; t = Math.floor(t / 32); }
  const rand = crypto.randomBytes(16);
  let tail = '';
  for (let i = 0; i < 16; i++) tail += CROCKFORD[rand[i] % 32];
  return head + tail;
}

export class Mailboxes {
  constructor({ state, save, now = Date.now, attachDir }) {
    Object.assign(this, { state, persist: save, now, attachDir });
  }

  save() { this.persist(this.state); }

  // Checks fields and builds the content that is stored, deduplicated and edited.
  // `attach` is already read: { name, sha256, data }.
  normalize(type, f, attach) {
    if (!TYPES.includes(type)) return fail('bad_type', `type must be one of ${TYPES.join(', ')}`);
    if (f.priority && !PRIORITIES.includes(f.priority)) return fail('bad_priority', `priority must be one of ${PRIORITIES.join(', ')}`);
    const content = { type };
    const tooLong = (what, limit) => fail('too_long', `${what} is over ${limit} characters; put the long text in a file and pass it with --attach <file>`);
    if (type === 'note') {
      const text = String(f.text ?? '');
      if (!text.trim() && !attach) return fail('missing_text', 'a note needs text or --attach');
      if (len(text) > LIMITS.note) return tooLong('note text', LIMITS.note);
      content.text = text;
    } else {
      const question = String(f.question ?? '');
      if (!question.trim()) return fail('missing_question', `a ${type} question needs --question`);
      if (len(question) > LIMITS.question) return tooLong('question', LIMITS.question);
      content.question = question;
    }
    if (type === 'decision') {
      const options = (f.options ?? []).map(String);
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
    const norm = this.normalize(type, req, att.attach);
    if (!norm.ok) return norm;
    const content = norm.content;
    if (supersedes) {
      if (type === 'note') return fail('bad_supersedes', '--supersedes applies to decision and discussion questions');
      content.supersedes = supersedes;
    }
    const now = this.now();
    const live = l => l.mailbox === to && !['withdrawn', 'superseded'].includes(l.status);
    const sameSender = this.keyOf(content, from);
    const dup = Object.values(this.state.letters).find(l => live(l) && l.sender === from && now - l.createdAt < DEDUP_MS && this.keyOf(l.content, from) === sameSender);
    if (dup) return this.receipt(dup, from, { duplicate: true, reason: 'duplicate' });
    if (type === 'decision') {
      const anyone = this.keyOf(content, '');
      const open = Object.values(this.state.letters).find(l => live(l) && l.sender === from && l.type === 'decision' && l.status === 'pending' && !this.answered(l) && this.keyOf(l.content, '') === anyone);
      if (open) return this.receipt(open, from, { duplicate: true, reason: 'duplicate_open_question' });
    }
    // Checked after the duplicate lookups: a resend of a letter that already superseded its target gets the
    // original receipt back instead of a "not active" error.
    if (supersedes) {
      const old = this.find(supersedes);
      if (!old.ok) return old;
      const o = old.letter;
      if (o.mailbox !== to) return fail('bad_supersedes', 'the superseded letter is in another mailbox');
      if (o.sender !== from) return fail('not_sender', 'only the sender of a letter can supersede it');
      if (this.answered(o) && o.status === 'pending') return fail('user_answered', 'The user has already answered this question; it cannot be superseded until the answer is sent');
      if (!['pending', 'submitted'].includes(o.status)) return fail('not_active', `the letter is ${o.status}`);
    }
    const box = this.state.mailboxes[to] ??= { key: to, counter: 0 };
    box.counter += 1;
    const uid = newUid(now);
    const letter = {
      uid, serial: `${type === 'note' ? 'N' : 'Q'}${String(box.counter).padStart(3, '0')}`, mailbox: to, sender: from, type,
      status: type === 'note' ? 'queued' : 'pending', edited: false, version: 1, priority: req.priority || 'medium', tags: req.tags ?? [],
      createdAt: now, updatedAt: now, content, draft: null,
    };
    try {
      if (att.attach) content.attach.path = this.snapshot(uid, 1, att.attach);
    } catch (e) { box.counter -= 1; return fail('bad_attach', `cannot store the attachment: ${e.code || e.message}`); }
    this.state.letters[uid] = letter;
    if (supersedes) { const o = this.state.letters[supersedes]; o.status = 'superseded'; o.supersededBy = uid; o.updatedAt = now; }
    this.save();
    return this.receipt(letter, from);
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
    const boxes = req.to ? [req.to] : Object.keys(this.state.mailboxes);
    return { ok: true, mailboxes: boxes.map(to => ({ to, pending: this.pendingOf(from, to) })).filter(b => b.pending.length) };
  }

  // The write interface for the user's answers; the mailbox screen is a later task. Every answer carries the version
  // that was on screen, so an answer to a question that was edited in the meantime is refused.
  answer(req) {
    const found = this.find(req.uid);
    if (!found.ok) return found;
    const l = found.letter;
    if (l.status !== 'pending') return fail('not_pending', `the letter is ${l.status}`);
    if (req.version !== l.version) return fail('stale_version', 'the question changed; reload it', { version: l.version });
    const choice = req.choice ? String(req.choice).toUpperCase() : null;
    const text = String(req.text ?? '');
    const valid = l.type === 'decision' ? [...LETTERS.slice(0, l.content.options.length), 'P', 'E'] : ['E'];
    if (choice && !valid.includes(choice)) return fail('bad_choice', `choice must be one of ${valid.join(', ')}`);
    l.draft = choice || text.trim() ? { choice, text } : null;
    l.updatedAt = this.now();
    this.save();
    return { ok: true, uid: l.uid, version: l.version, userAnswered: this.answered(l) };
  }

  // Marks answered questions as sent. Delivery to the receiver is a later task; this is the state change.
  submit(req) {
    const results = (req.items ?? []).map(({ uid, version }) => {
      const found = this.find(uid);
      if (!found.ok) return { uid, ...found };
      const l = found.letter;
      if (l.status !== 'pending' || !this.answered(l)) return { uid, ok: false, error: 'not_answered' };
      if (l.version !== version) return { uid, ok: false, error: 'stale_version', version: l.version };
      l.status = 'submitted';
      l.updatedAt = this.now();
      return { uid, ok: true };
    });
    this.save();
    return { ok: true, results };
  }

  // Mutating calls run against a copy: if saving to disk fails, the in-memory state is put back and the
  // sender gets a failure, so nothing is acknowledged that is not on disk and a resend can land for real.
  handle(req) {
    const ops = { send: 'send', edit: 'edit', withdraw: 'withdraw', status: 'status', answer: 'answer', submit: 'submit' };
    if (!ops[req.op]) return fail('bad_op', `unknown op ${req.op}`);
    if (req.op === 'status') return this.status(req);
    const backup = structuredClone(this.state);
    try { return this[ops[req.op]](req); } catch (e) {
      this.state = backup;
      return fail('save_failed', `the letter was not saved (${e.code || e.message}); nothing was sent, try again`);
    }
  }
}
