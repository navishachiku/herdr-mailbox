// Optional card rules: refuse letters that hold a phrase the owner does not want, a sentence that is too long, or a
// line in a card's free text that reads as a step for the owner to do.
// One JSON file next to prefs.json, shared by every herdr session. No file, an unreadable file or a bad key means
// no phrase or length rule, and a bad value never blocks sending. The step check has a built-in default, so a new
// install catches steps written into free text without any file; `"stepPatterns": []` turns it off.
import fs from 'node:fs';
import path from 'node:path';
import { STATE_DIR } from './paths.mjs';

export const CARD_RULES_FILE = path.join(STATE_DIR, '..', 'card-rules.json');

// Common action verbs that open a step the reader is told to do. Measured on 50 stored cards: no hit.
export const DEFAULT_STEP_PATTERNS = ['^(open|press|click|log in|run|type|enter|select)\\b', '^(請|开启|開啟|開|打開|按|點|點擊|登入|輸入|執行|跑|切換|選)'];

// The authority for the file format; `mailbox --help` prints it and the README shows the same example.
export const CARD_RULES_HELP = `card rules (optional): ${CARD_RULES_FILE}
  {"rejectPhrases": ["as you know", "basically"], "maxSentenceUnits": 50, "stepPatterns": ["^(open|press|log in) "]}
  rejectPhrases      a letter whose text holds any of these (case-insensitive) is refused, naming the phrase
  maxSentenceUnits   a letter with a sentence longer than this is refused; a Chinese character counts 1, a run of
                     letters or digits counts 1; sentences end at 。！？.!? or a line break
  stepPatterns       regular expressions (case-insensitive); a decision or discussion card whose free text has a
                     bulleted or numbered line (- * • 1. 1) (1)) that matches one, tested without the marker, is refused:
                     steps for the owner go in --step with --why-not-agent saying why an agent cannot do each one;
                     without this key a built-in list of common action verbs is used, [] turns the check off
  Each key is optional and a bad value is ignored. No file means no phrase or length rule.
  The text checked: note text, question, options, trade-offs, why-open and idea (not attachments).`;

const compile = list => list.filter(p => typeof p === 'string' && p.trim()).flatMap(p => { try { return [new RegExp(p, 'iu').source]; } catch { return []; } });

export function readCardRules(file = CARD_RULES_FILE) {
  let saved;
  try { saved = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return { stepPatterns: compile(DEFAULT_STEP_PATTERNS) }; }
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return { stepPatterns: compile(DEFAULT_STEP_PATTERNS) };
  const rules = {};
  if (Array.isArray(saved.rejectPhrases)) {
    const phrases = saved.rejectPhrases.filter(p => typeof p === 'string' && p.trim());
    if (phrases.length) rules.rejectPhrases = phrases;
  }
  if (Number.isInteger(saved.maxSentenceUnits) && saved.maxSentenceUnits > 0) rules.maxSentenceUnits = saved.maxSentenceUnits;
  // An array is the owner's choice, an empty one included; anything else falls back to the built-in list.
  const patterns = compile(Array.isArray(saved.stepPatterns) ? saved.stepPatterns : DEFAULT_STEP_PATTERNS);
  if (patterns.length) rules.stepPatterns = patterns;
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

// A bulleted or numbered line whose text, without the marker, matches a step pattern: a step for the owner written as free text.
const LIST_MARKER = /^\s*(?:[-*•·]|\d+[.)、]|[(（]\d+[)）]|[①-⑳]|[一二三四五六七八九十]+、)\s*/u;
export function checkStepText(text, rules, where) {
  const patterns = (rules.stepPatterns ?? []).map(p => new RegExp(p, 'iu'));
  if (!patterns.length) return null;
  for (const line of String(text ?? '').split('\n')) {
    const m = LIST_MARKER.exec(line);
    if (!m) continue;
    const body = line.slice(m[0].length).trim();
    if (body && patterns.some(r => r.test(body))) {
      return { error: 'step_in_text', message: `the ${where} has a line that reads as a step for the owner to do ("${body.length > 40 ? `${body.slice(0, 40)}…` : body}"); move each step the owner must do into --step, each with a --why-not-agent saying why an agent cannot do it, or rewrite the line as a statement` };
    }
  }
  return null;
}
