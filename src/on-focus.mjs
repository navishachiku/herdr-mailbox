// pane.focused event: if this pane is a receiver whose screen was open before herdr restarted, bring the screen back.
import { call } from './ipc.mjs';
import { refreshPointer } from './stable.mjs';

refreshPointer();

const data = JSON.parse(process.env.HERDR_PLUGIN_EVENT_JSON || '{}').data ?? {};
if (data.pane_id) await call({ op: 'screen-ensure', pane: data.pane_id }).catch(() => {});
