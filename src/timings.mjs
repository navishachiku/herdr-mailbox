import { readPrefs } from './prefs.mjs';

// Every time constant in one place. HERDR_MAILBOX_TIMINGS (JSON, milliseconds) overrides them; it exists only so tests need not wait.
const defaults = {
  tickMs: 5_000,
  reconcileMs: 5_000,
  registerGraceMs: 15_000,
  mergeMs: 60_000,
  workingMs: 300_000,
  retryMs: 30_000,
  nudgeMs: 5_000,
  confirmMs: 20_000,
  batchFileBytes: 100_000,
  promptWaitMs: 60_000, // how long a new screen pane may take to show a shell prompt before the start command is sent anyway
  promptPollMs: 500,
  screenReadyMs: 10_000, // a reloaded screen that has not reported screen-ready by then is closed
};

function overrides(raw) {
  try {
    const given = JSON.parse(raw ?? '{}');
    return Object.fromEntries(Object.entries(given).filter(([k, v]) => k in defaults && Number.isFinite(v) && v >= 0));
  } catch { return {}; }
}

export const timings = { ...defaults, ...overrides(process.env.HERDR_MAILBOX_TIMINGS) };

// The merge interval is a screen preference read on every use, so a change applies without a restart.
// The env override stays first so tests can pin it.
const pinnedMerge = 'mergeMs' in overrides(process.env.HERDR_MAILBOX_TIMINGS);
export const mergeMs = () => pinnedMerge ? timings.mergeMs : readPrefs().mergeSeconds * 1000;
