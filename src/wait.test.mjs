import test from 'node:test';
import assert from 'node:assert/strict';
import { waitForReceiver } from './wait.mjs';

test('212/AC-2 a letter that is never delivered gives exit 3 with "queued, do not send again" and never waits for idle', async () => {
  const calls = [];
  const r = await waitForReceiver('w1:p1', undefined, { delivered: async () => false, wait: async (_t, until) => { calls.push(until[0]); return true; } });
  assert.equal(r.code, 3);
  assert.equal(r.fields.queued, true);
  assert.match(r.fields.waitError, /queued.*do not send it again/);
  assert.deepEqual(calls, []);
});

test('212/AC-2 with a busy receiver idle is awaited only after delivery; delivered but unfinished gives exit 4, finished gives 0', async () => {
  let delivered = false;
  const order = [];
  const wait = async (_t, until) => { order.push(`${until[0]}:${delivered}`); return until[0] !== 'idle' || order.length < 4; };
  const deliver = async () => { await new Promise(r => setTimeout(r, 20)); delivered = true; return true; };
  assert.deepEqual(await waitForReceiver('w1:p1', 1000, { delivered: deliver, wait }), { code: 0, fields: { waited: true } });
  assert.deepEqual(order, ['working:true', 'idle:true']);
  order.length = 0;
  const r = await waitForReceiver('w1:p1', 1000, { delivered: async () => true, wait: async (_t, until) => until[0] === 'working' });
  assert.equal(r.code, 4);
});
