// startup hook: make sure the daemon is running when herdr starts.
import { call } from './ipc.mjs';

await call({ op: 'ping' }).catch(() => {});
