import { CONFIG } from '../core/config.js';
import { BUILDINGS } from '../data/buildings.js';
import { bufferUsed, noteLedger, isPlayer } from '../core/state.js';

// A rolling share of recent ticks a site actually turned its recipe — what the
// panel calls its working percentage. It is an exponential average so it tracks
// the plant's current life rather than its whole history: recorded here because
// this is the only place that knows whether a tick was worked.
function trackUptime(b, worked) {
  const k = CONFIG.uptimeSmoothing;
  b.uptime = (b.uptime ?? 0) * (1 - k) + (worked ? k : 0);
}

export function produce(state) {
  for (const b of state.buildings) {
    const def = BUILDINGS[b.type];
    const recipe = def.recipe;
    if (!recipe) { b.status = 'store'; continue; }
    const mine = isPlayer(state, b.owner);

    if (!b.staffed) { b.status = 'unstaffed'; b.shortage = []; trackUptime(b, false); continue; }

    if (bufferUsed(b.output) >= def.outCap) {
      b.status = 'blocked';
      b.shortage = [];
      trackUptime(b, false);
      continue;
    }

    if (b.progress === 0) {
      const missing = Object.keys(recipe.in).filter((id) => (b.input[id] ?? 0) < recipe.in[id]);
      if (missing.length) {
        b.status = 'starved';
        b.shortage = missing;
        trackUptime(b, false);
        continue;
      }
      for (const id of Object.keys(recipe.in)) {
        b.input[id] -= recipe.in[id];
        // Only your own industry is booked. The other forty-five are read as
        // rankings rather than as accounts, and forty-six ledgers would be six
        // hundred numbers a tick in the save file.
        if (mine) noteLedger(state, id, 'used', recipe.in[id]);
      }
    }

    b.shortage = [];
    b.progress++;
    if (b.progress >= recipe.ticks) {
      b.progress = 0;
      for (const [id, qty] of Object.entries(recipe.out)) {
        b.output[id] = (b.output[id] ?? 0) + qty;
        if (mine) noteLedger(state, id, 'made', qty);
      }
    }
    b.status = 'running';
    trackUptime(b, true);
  }
}
