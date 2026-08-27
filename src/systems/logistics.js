import { CONFIG } from '../core/config.js';
import { BUILDINGS } from '../data/buildings.js';
import { COMMODITY_IDS } from '../data/commodities.js';
import { warehouseUsed } from '../core/state.js';

// Logistics is OWNER-SCOPED, and that is load-bearing. A depot only ever serves
// its own owner's sites: without this, a government's warehouses would act as
// free infrastructure for your factories (and vice versa), and competing for
// ground would stop meaning anything.
//
// `owner` is required rather than defaulted, so a new call site cannot silently
// get cross-owner logistics.
export function warehousesServing(state, x, y, owner) {
  return within(state.buildings, x, y, owner);
}

// The same question asked against a list that has already been narrowed to one
// owner's depots. `collect` and `distribute` ask it once per site, and a world
// of two thousand buildings turned that into millions of checks a tick — this is
// the hottest pair of loops in the game.
function within(candidates, x, y, owner) {
  const out = [];
  for (const b of candidates) {
    if (!b.store || (owner != null && b.owner !== owner)) continue;
    const radius = BUILDINGS[b.type].radius ?? 0;
    if (Math.max(Math.abs(b.x - x), Math.abs(b.y - y)) <= radius) out.push(b);
  }
  return out;
}

// Depots grouped by the nation they belong to, in `state.buildings` order — so
// the order goods are drawn in is exactly what it was when every site scanned
// the whole world, and ticks stay deterministic.
function depotsByOwner(state) {
  const byOwner = new Map();
  for (const b of state.buildings) {
    if (!b.store) continue;
    const list = byOwner.get(b.owner);
    if (list) list.push(b); else byOwner.set(b.owner, [b]);
  }
  return byOwner;
}

export function collect(state) {
  const byOwner = depotsByOwner(state);
  for (const b of state.buildings) {
    if (!b.output) continue;
    const depots = within(byOwner.get(b.owner) ?? [], b.x, b.y, null);
    if (!depots.length) continue;
    for (const id of COMMODITY_IDS) {
      let pending = b.output[id] ?? 0;
      if (pending <= 0) continue;
      for (const depot of depots) {
        if (pending <= 0) break;
        const free = BUILDINGS[depot.type].capacity - warehouseUsed(depot);
        const moved = Math.min(pending, free);
        if (moved <= 0) continue;
        depot.store[id] = (depot.store[id] ?? 0) + moved;
        pending -= moved;
      }
      b.output[id] = pending;
    }
  }
}

export function distribute(state) {
  const byOwner = depotsByOwner(state);
  for (const b of state.buildings) {
    const def = BUILDINGS[b.type];
    const recipe = def.recipe;
    if (!recipe || !Object.keys(recipe.in).length) continue;
    const depots = within(byOwner.get(b.owner) ?? [], b.x, b.y, null);
    if (!depots.length) continue;
    for (const id of Object.keys(recipe.in)) {
      let need = def.inCap - (b.input[id] ?? 0);
      if (need <= 0) continue;
      for (const depot of depots) {
        if (need <= 0) break;
        const available = depot.store[id] ?? 0;
        const moved = Math.min(need, available);
        if (moved <= 0) continue;
        depot.store[id] = available - moved;
        b.input[id] = (b.input[id] ?? 0) + moved;
        need -= moved;
      }
    }
  }
}

// Storage is not free. A small share of everything sitting in a warehouse is
// lost to handling each tick, which is what stops a nation from stockpiling a
// commodity nobody wants until the end of time. Produce past what you can sell
// at home and export abroad, and you are quietly burning money — that pressure
// is the whole reason a second market is worth opening.
export function spoil(state) {
  const keep = 1 - CONFIG.spoilage;
  if (keep >= 1) return;
  for (const b of state.buildings) {
    if (!b.store) continue;
    for (const id of COMMODITY_IDS) {
      const held = b.store[id] ?? 0;
      if (held > 0) b.store[id] = held * keep;
    }
  }
}
