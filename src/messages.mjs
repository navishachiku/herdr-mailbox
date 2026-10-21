// Locale helpers only. Each module keeps its own text table in its own file and picks a language with table().
// The locale follows the operating system: an explicit LC_ALL or LC_MESSAGES wins, then the OS language setting
// (macOS AppleLanguages, Windows UI culture), then LANG, then Node's own locale. Reading it never throws.
import { execFileSync } from 'node:child_process';

const readSystemLanguage = (platform, exec) => {
  try {
    if (platform === 'darwin') return /"?([A-Za-z]{2,3}(?:-[A-Za-z0-9]+)*)"?\s*[,)]/.exec(exec('defaults', ['read', '-g', 'AppleLanguages']))?.[1];
    if (platform === 'win32') return exec('powershell', ['-NoProfile', '-Command', '(Get-UICulture).Name']).trim() || undefined;
  } catch { /* unreadable → fall back to LANG */ }
  return undefined;
};
const run = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });

export function systemLocale(env = process.env, platform = process.platform, exec = run) {
  const explicit = env.LC_ALL || env.LC_MESSAGES;
  if (explicit) return explicit;
  const fromSystem = readSystemLanguage(platform, exec);
  if (fromSystem) return fromSystem;
  if (env.LANG) return env.LANG;
  try { return Intl.DateTimeFormat().resolvedOptions().locale; } catch { return ''; }
}

// Match on the language part (`zh` of `zh_TW.UTF-8`) against each key, so a new language needs only a new table. No match → en.
// Chinese is the one language split by script: Simplified (Hans, CN, SG) picks a zh-CN table when there is one, and
// anything else Chinese picks zh-TW, as it did before zh-CN existed.
const language = tag => String(tag).split(/[._@-]/)[0].toLowerCase();
const SIMPLIFIED = /[-_](hans|cn|sg)\b/i;

export function pickLocale(tag = systemLocale(), keys = ['en', 'zh-TW']) {
  const lang = language(tag);
  if (lang === 'zh' && SIMPLIFIED.test(tag) && keys.includes('zh-CN')) return 'zh-CN';
  return keys.find(key => language(key) === lang && key !== 'zh-CN') ?? keys.find(key => language(key) === lang) ?? 'en';
}

// table({ en, 'zh-TW': ... }) → the table for the system language.
export const table = (locales, tag) => locales[pickLocale(tag, Object.keys(locales))];
