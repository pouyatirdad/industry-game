import { COMMODITY_IDS } from '../data/commodities.js';
import { createLedger } from '../core/state.js';

// The commodity ledger, and the reason it is a pipeline step rather than a
// counter reset hidden inside `runTick`.
//
// Four systems write into `state.ledger.tick`: production notes what was made
// and what was burned, the home market notes what your people bought, and trade
// notes what crossed a border in either direction. None of them can reset it —
// each one only sees its own slice of the tick — so the fold happens HERE, at
// the very top of the tick, before anything has written anything.
//
// Folding at the top rather than the bottom is what lets the panels read the
// tick that just finished: a render happens after the pipeline, so `tick` still
// holds the figures the player is looking at, and `total` carries the game.
export function openLedger(state) {
  if (!state.ledger) state.ledger = createLedger();
  const { tick, total } = state.ledger;
  for (const id of COMMODITY_IDS) {
    const line = tick[id];
    const sum = total[id];
    for (const key of Object.keys(line)) {
      sum[key] += line[key];
      line[key] = 0;
    }
  }
}
