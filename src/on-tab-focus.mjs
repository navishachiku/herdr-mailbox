// tab.focused event: check every receiver in that tab whose screen was open before herdr restarted.
import { call } from './ipc.mjs';
import { refreshPointer } from './stable.mjs';

refreshPointer();

const data = JSON.parse(process.env.HERDR_PLUGIN_EVENT_JSON || '{}').data ?? {};
const tab = data.tab_id ?? data.tab?.tab_id;
await call({ op: 'screen-ensure', ...(tab ? { tab } : {}) }).catch(() => {});
