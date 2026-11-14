// Optional card rules: refuse letters that hold a phrase the owner does not want, or a sentence that is too long.
// One JSON file next to prefs.json, shared by every herdr session. No file, an unreadable file or a bad key means
// no rule: a mailbox without the file takes every card, and a bad value never blocks sending.
import fs from 'node:fs';
import path from 'node:path';
import { STATE_DIR } from './paths.mjs';

export const CARD_RULES_FILE = path.join(STATE_DIR, '..', 'card-rules.json');

// The authority for the file format; `mailbox --help` prints it and the README shows the same example.
export const CARD_RULES_HELP = `card rules (optional): ${CARD_RULES_FILE}
  {"rejectPhrases": ["as you know", "basically"], "maxSentenceUnits": 50}
  rejectPhrases      a letter whose text holds any of these (case-insensitive) is refused, naming the phrase
  maxSentenceUnits   a letter with a sentence longer than this is refused; a Chinese character counts 1, a run of
                     letters or digits counts 1; sentences end at 。！？.!? or a line break
  Each key is optional and a bad value is ignored. No file means every letter is accepted.
  The text checked: note text, question, options, trade-offs, why-open and idea (not attachments).`;

export function readCardRules(file = CARD_RULES_FILE) {
  let saved;
  try { saved = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; }
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return {};
  const rules = {};
  if (Array.isArray(saved.rejectPhrases)) {
    const phrases = saved.rejectPhrases.filter(p => typeof p === 'string' && p.trim());
    if (phrases.length) rules.rejectPhrases = phrases;
  }
  if (Number.isInteger(saved.maxSentenceUnits) && saved.maxSentenceUnits > 0) rules.maxSentenceUnits = saved.maxSentenceUnits;
  return rules;
}

// A Chinese character is 1 unit and so is each run of ASCII letters or digits; anything else is 0.
export const units = s => (String(s).match(/\p{Script=Han}|[A-Za-z0-9]+/gu) ?? []).length;

// Returns null when the text passes, otherwise { error, message } for the first problem found.
export function checkText(text, rules, where) {
  const body = String(text ?? '');
  const lower = body.toLowerCase();
  const phrase = (rules.rejectPhrases ?? []).find(p => lower.includes(p.toLowerCase()));
  if (phrase) return { error: 'rejected_phrase', message: `the ${where} holds "${phrase}", a phrase this mailbox refuses; say it without that phrase` };
  const max = rules.maxSentenceUnits;
  if (max) {
    for (const sentence of body.split(/[。！？.!?\n]/)) {
      const n = units(sentence);
      if (n > max) return { error: 'sentence_too_long', message: `a sentence in the ${where} is ${n} units, over the ${max} this mailbox allows (a Chinese character or a run of letters or digits counts 1; sentences end at 。！？.!? or a line break); split it or shorten it` };
    }
  }
  return null;
}
