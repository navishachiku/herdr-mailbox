// The input queue. Events are handled one at a time, but a click is matched to a control the moment it arrives,
// against the frame on screen at that moment. Handling may wait behind an earlier event while the screen redraws;
// the click still acts on what the user saw and clicked, never on whatever moved under that spot since.
export const hitAt = (ui, { x, y }) => ui?.hits.find(h => h.row === y - 1 && x - 1 >= h.c0 && x - 1 < h.c1) ?? null;

export function createEventQueue({ getUI, onEvent }) {
  let chain = Promise.resolve();
  return {
    enqueue(event) {
      const action = event.kind === 'click' ? hitAt(getUI(), event)?.action ?? null : null;
      const run = chain.then(() => onEvent(event, action));
      chain = run.catch(() => {});
      return run;
    },
  };
}
