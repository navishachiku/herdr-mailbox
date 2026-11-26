// What a final reply may not hold while its pane has an open mailbox: a question with options belongs on a card,
// and the cards waiting in the mailbox are not reported in the conversation.

// What may stand before the first character that counts: quote marks, a list bullet, bold, italics or code marks.
const PREFIX = String.raw`^\s*(?:>\s*)*(?:[-+*]\s+)?[*_\x60]*\s*`;
const OPTION = new RegExp(`${PREFIX}[(（][A-Z][)）]`);
const BATCH = new RegExp(`${PREFIX}[(（]AP[)）]`);
const NUMBERED = new RegExp(`${PREFIX}(?:❓\\s*)?[*_]*(?:Q\\d+|\\d+(?:[、)）]|\\.(?!\\d)))`);
const INLINE_OPTION = /[(（][A-Z][)）]/;
// A line that starts a list item, heading or table row does not continue the sentence of the line before.
const NEW_BLOCK = /^\s*(?:[-+*]\s|\d+[.)、）]|#{1,6}\s|\|)/;
const QUOTE = /^\s*>/;
// Words that hold 卡 and have nothing to do with a card. After 張 or 的, 卡住 and 卡在 are a card that is somewhere.
const NOT_A_CARD = /(?<![張张的])卡[住在]|卡關|关卡|關卡|卡关|打卡|卡頓|卡顿|卡死/g;

// The lines outside fenced code blocks. Quoted lines count.
function proseLines(text) {
  const lines = [];
  let fence = null;
  for (const line of String(text).split(/\r?\n/)) {
    const mark = /^\s*(?:>\s*)*(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence) {
      if (mark && mark[1][0] === fence[0] && mark[1].length >= fence.length && !mark[2].trim()) fence = null;
    } else if (mark && !(mark[1][0] === '`' && mark[2].includes('`'))) fence = mark[1];
    else lines.push(line);
  }
  return lines;
}

const mentionsBoth = sentence => sentence.includes('信箱') && sentence.replace(NOT_A_CARD, '').includes('卡');

// The line that opens the first sentence naming both the mailbox and a card; a sentence may wrap over several lines.
function lineNamingBoth(lines) {
  let text = '';
  let first = null;
  let before = '';
  for (const line of lines) {
    if (!line.trim() || NEW_BLOCK.test(line.replace(/^(?:\s*>)+/, '')) || QUOTE.test(line) !== QUOTE.test(before)) {
      if (mentionsBoth(text)) return first;
      text = '';
    }
    before = line;
    for (const piece of line.replace(/^(?:\s*>)+\s*/, '').split(/(?<=[。！？!?；;])/)) {
      if (!text) first = line;
      text += piece.trim();
      if (/[。！？!?；;]$/.test(piece.trim())) {
        if (mentionsBoth(text)) return first;
        text = '';
      }
    }
  }
  return mentionsBoth(text) ? first : null;
}

// The first line that breaks the rule, or null. `serials` are the cards of this mailbox still waiting for an answer.
export function offendingLine(text, serials = []) {
  const lines = proseLines(text);
  const options = lines.filter(l => OPTION.test(l));
  if (options.length >= 2) return options[0];
  const numbered = lines.filter(l => NUMBERED.test(l) && INLINE_OPTION.test(l));
  if (numbered.length >= 2) return numbered[0];
  const named = serials.map(s => new RegExp(`(?<![A-Za-z0-9])${s}(?![A-Za-z0-9])`));
  return lines.find(l => BATCH.test(l) || named.some(r => r.test(l))) ?? lineNamingBoth(lines);
}
