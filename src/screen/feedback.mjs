// The shared "processing" feedback. perform() reports each stage of a background operation through
// env.onFeedback({ key, type, state, at, error? }); render() draws the matching element accordingly.
// state: 'pending' (sent, waiting for the answer), 'delivering' (Deliver now accepted, waiting for the landing),
// 'done', 'failed'.

// Operations that send or remove content keep their result on screen for a while.
import { timings } from '../timings.mjs';

export const RESULT_TYPES = new Set(['submit', 'void', 'void-all', 'resolve-batch']);
export const RESULT_MS = 2000;
export const FAILED_MS = 4000;

// The batch a Deliver now press follows: the first one made from about a second before the press on (an automatic
// batch may have just taken the messages), else one that was already being sent.
export function followedBatch(feedback, deliveryState) {
  const mine = (deliveryState?.batches ?? []).filter(b => b.kind !== 'direct');
  return mine.find(b => b.createdAt >= feedback.at - 1000) ?? mine.find(b => b.status === 'sending') ?? null;
}

// Which on-screen element an action belongs to.
export const feedbackKey = a => [a.type, a.uid ?? '', a.index ?? '', a.batch ?? '', a.action ?? '', a.choice ?? ''].join(':');

// How the element of `action` should look at `now`, or null when it looks normal.
// Returns { state: 'pending'|'delivering'|'waiting'|'delivered'|'done'|'failed', error?, reason? }.
export function feedbackFor(action, feedback, { now, deliveryState = null, deliveryConfirmedAt = null } = {}) {
  if (!feedback || !action || feedback.key !== feedbackKey(action)) return null;
  const { state } = feedback;
  if (state === 'pending') return { state };
  if (state === 'failed') return now - feedback.at < FAILED_MS ? { state, error: feedback.error } : null;
  if (state === 'delivering') {
    if (deliveryConfirmedAt !== null) return now - deliveryConfirmedAt < RESULT_MS ? { state: 'delivered' } : null;
    if (deliveryState) {
      const batch = followedBatch(feedback, deliveryState);
      // The batch did not land (the messages area offers Mark delivered / Resend), or there is nothing to follow
      // and nothing left to send, or a followed batch has outlived the daemon's landing timeout: back to normal.
      if (batch && ['unconfirmed', 'failed'].includes(batch.status)) return null;
      if (!batch && !deliveryState.queued?.length) return null;
      if (batch && now - (batch.sentAt ?? batch.createdAt) > timings.confirmMs + 2 * timings.tickMs) return null;
    }
    const reason = deliveryState?.paused?.reason;
    return reason ? { state: 'waiting', reason } : { state };
  }
  if (state === 'done' && RESULT_TYPES.has(feedback.type) && now - feedback.at < RESULT_MS) return { state };
  return null;
}
