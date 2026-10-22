// startup hook: make sure the daemon is running when herdr starts.
import { call } from './ipc.mjs';
import { refreshPointer } from './stable.mjs';

refreshPointer();

await call({ op: 'ping' }).catch(() => {});
