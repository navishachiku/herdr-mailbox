// Terminal input: turns raw stdin bytes into events, and edits a one-line text value.
// Events: { kind: 'click', x, y } (1-based, left button press), { kind: 'move', x, y } (pointer motion), { kind: 'wheel', dir: -1|1 },
// { kind: 'key', name } for named keys, { kind: 'text', text } for typed or pasted text.

const SGR_MOUSE = /^\x1b\[<(\d+);(\d+);(\d+)([Mm])/;
const PASTE = /^\x1b\[200~([\s\S]*?)\x1b\[201~/;
const CSI = /^\x1b\[([0-9;]*)([A-Za-z~])/;
const KEYS = { A: 'up', B: 'down', C: 'right', D: 'left', H: 'home', F: 'end' };
const TILDE = { 1: 'home', 3: 'delete', 4: 'end', 5: 'pageup', 6: 'pagedown', 7: 'home', 8: 'end' };
const CONTROL = { '\r': 'enter', '\n': 'enter', '\t': 'tab', '\x7f': 'backspace', '\b': 'backspace', '\x03': 'ctrl-c', '\x11': 'ctrl-q', '\x15': 'ctrl-u', '\x01': 'home', '\x05': 'end' };

export function parseInput(data) {
  const events = [];
  let s = String(data);
  while (s.length) {
    let m;
    if ((m = SGR_MOUSE.exec(s))) {
      const [b, x, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
      if (b === 64 || b === 65) events.push({ kind: 'wheel', dir: b === 64 ? -1 : 1 });
      else if (b & 32) events.push({ kind: 'move', x, y }); // motion, with or without a button held
      else if (b === 0 && m[4] === 'M') events.push({ kind: 'click', x, y });
    } else if ((m = PASTE.exec(s))) {
      events.push({ kind: 'text', text: m[1].replace(/\r?\n/g, ' ') });
    } else if ((m = CSI.exec(s))) {
      const name = m[2] === '~' ? TILDE[m[1].split(';')[0]] : KEYS[m[2]];
      if (name) events.push({ kind: 'key', name });
    } else if (s[0] === '\x1b') {
      m = [s[0]];
      if (s.length === 1) events.push({ kind: 'key', name: 'escape' });
      else m = [s.slice(0, 2)]; // an unknown escape pair is dropped
    } else {
      // A run of ordinary characters is one text event; control characters are keys.
      m = /^[^\x00-\x1f\x7f]+/.exec(s);
      if (m) events.push({ kind: 'text', text: m[0] });
      else {
        m = [s[0]];
        const name = CONTROL[s[0]];
        if (name) events.push({ kind: 'key', name });
      }
    }
    s = s.slice(m[0].length);
  }
  return events;
}

// A one-line text value with a caret, counted in characters rather than bytes.
export function edit({ text, pos }, event) {
  const chars = [...text];
  const put = (value, at) => ({ text: value.join(''), pos: at });
  if (event.kind === 'text') {
    const add = [...event.text];
    return put([...chars.slice(0, pos), ...add, ...chars.slice(pos)], pos + add.length);
  }
  switch (event.name) {
    case 'backspace': return pos ? put([...chars.slice(0, pos - 1), ...chars.slice(pos)], pos - 1) : { text, pos };
    case 'delete': return put([...chars.slice(0, pos), ...chars.slice(pos + 1)], pos);
    case 'left': return { text, pos: Math.max(0, pos - 1) };
    case 'right': return { text, pos: Math.min(chars.length, pos + 1) };
    case 'home': return { text, pos: 0 };
    case 'end': return { text, pos: chars.length };
    case 'ctrl-u': return { text: '', pos: 0 };
    default: return { text, pos };
  }
}
