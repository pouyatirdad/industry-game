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

// "Is there a depot of this owner's within reach of here?", asked against a
// list already narrowed to that owner. State industry asks it per candidate tile
// per building type, and against every building in the world that was, at a
// million tiles, the single most expensive thing in the tick.
export function servedBy(depots, x, y) {
  for (const b of depots) {
    const radius = BUILDINGS[b.type].radius ?? 0;
    if (Math.max(Math.abs(b.x - x), Math.abs(b.y - y)) <= radius) return true;
  }
  return false;
}

// Depots grouped by the nation they belong to, in `state.buildings` order — so
// the order goods are drawn in is exactly what it was when every site scanned
// the whole world, and ticks stay deterministic.
export function depotsByOwner(state) {
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

// Cargo leaves the warehouses that hold it. Which one is arbitrary, so the
// first ones found are drained in order — deterministic because
// `state.buildings` is only ever appended to. Returns what was actually found.
//
// This and its opposite below are the ONLY way goods cross a border, whether by
// spot deal or by contract, so both live here rather than in either system.
export function drawFromWarehouses(state, ownerId, commodityId, qty) {
  return drawFrom(state.buildings.filter((b) => b.owner === ownerId && b.store), commodityId, qty);
}

// The same question asked against a list already narrowed to one nation's
// depots. A tick that settles a hundred contracts cannot afford to scan every
// building in the world twice per contract, so `contracts.js` indexes the
// depots once and calls these.
export function drawFrom(depots, commodityId, qty) {
  let left = qty;
  for (const b of depots) {
    if (left <= 0) break;
    const held = b.store[commodityId] ?? 0;
    if (held <= 0) continue;
    const taken = Math.min(held, left);
    b.store[commodityId] = held - taken;
    left -= taken;
  }
  return qty - left;
}

export function deliverTo(depots, commodityId, qty) {
  let left = qty;
  for (const b of depots) {
    if (left <= 0) break;
    const free = BUILDINGS[b.type].capacity - warehouseUsed(b);
    if (free <= 0) continue;
    const put = Math.min(free, left);
    b.store[commodityId] = (b.store[commodityId] ?? 0) + put;
    left -= put;
  }
  return qty - left;
}

export function spaceIn(depots) {
  let free = 0;
  for (const b of depots) free += Math.max(0, BUILDINGS[b.type].capacity - warehouseUsed(b));
  return free;
}

export function stockIn(depots, commodityId) {
  let held = 0;
  for (const b of depots) held += b.store[commodityId] ?? 0;
  return held;
}

// ...and a cargo arrives in them, which is the whole point of the industrial
// channel: goods a nation cannot dig up become goods its factories can draw on
// next tick. Returns what actually fitted.
export function deliverToWarehouses(state, ownerId, commodityId, qty) {
  return deliverTo(state.buildings.filter((b) => b.owner === ownerId && b.store), commodityId, qty);
}

// Free depot space a nation has, in units. Trade and contracts both have to
// know whether a cargo has anywhere to land before they agree to it.
export function depotSpace(state, ownerId) {
  return spaceIn(state.buildings.filter((b) => b.owner === ownerId && b.store));
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

// ---- the depot network -----------------------------------------------------
//
// A depot serves the industry inside its own radius and nothing further, which
// is why a nation whose power stations are in the east and whose smelter is in
// the west could watch one warehouse fill with electricity while the other
// starved: the two never spoke. `relay` is the haulage between them.
//
// Two depots of the same owner are NEIGHBOURS when their catchment areas touch
// (Chebyshev distance no greater than the sum of their radii), so a warehouse
// built halfway between two distant ones genuinely bridges them — that is the
// whole reason a player would put one there, and the rule is derived from the
// radius in `buildings.js` rather than from a number written here.
//
// What moves is PULLED, never pushed, and only ever toward a factory that is
// actually short of it. A depot with nothing near it that eats coal will not
// accumulate coal, so this cannot become a second, invisible way of hoarding.
function depotNeeds(depots, sites) {
  const need = depots.map(() => ({}));
  const wanted = new Set();
  for (const site of sites) {
    const def = BUILDINGS[site.type];
    for (let i = 0; i < depots.length; i++) {
      const d = depots[i];
      const radius = BUILDINGS[d.type].radius ?? 0;
      if (Math.max(Math.abs(d.x - site.x), Math.abs(d.y - site.y)) > radius) continue;
      for (const id of Object.keys(def.recipe.in)) {
        const short = def.inCap - (site.input[id] ?? 0);
        if (short <= 0) continue;
        need[i][id] = (need[i][id] ?? 0) + short;
        wanted.add(id);
      }
    }
  }
  return { need, wanted };
}

function depotNeighbours(depots) {
  const near = depots.map(() => []);
  for (let i = 0; i < depots.length; i++) {
    const a = depots[i];
    const ra = BUILDINGS[a.type].radius ?? 0;
    for (let j = i + 1; j < depots.length; j++) {
      const b = depots[j];
      const rb = BUILDINGS[b.type].radius ?? 0;
      if (Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) > ra + rb) continue;
      near[i].push(j);
      near[j].push(i);
    }
  }
  return near;
}

// How many hops each depot is from the nearest one that actually wants the
// commodity. Cargo only ever flows DOWN this gradient, which is what makes the
// relay acyclic: nothing can be handed back and forth between two depots.
function hopsToNeed(depots, near, need, id) {
  const depth = depots.map(() => Infinity);
  const queue = [];
  for (let i = 0; i < depots.length; i++) {
    if ((need[i][id] ?? 0) > 0) { depth[i] = 0; queue.push(i); }
  }
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head];
    for (const j of near[i]) {
      if (depth[j] !== Infinity) continue;
      depth[j] = depth[i] + 1;
      queue.push(j);
    }
  }
  return depth;
}

function relayCommodity(depots, near, need, id) {
  const depth = hopsToNeed(depots, near, need, id);
  const order = depots.map((_, i) => i)
    .filter((i) => depth[i] !== Infinity)
    .sort((a, b) => depth[a] - depth[b] || a - b);
  if (!order.length) return;

  // A request that could not be met passes OUTWARD to the deeper neighbours, so
  // one tick's shortage at the smelter is what makes the depot in the middle ask
  // the depot in the east for power. Shallower depots are served first, so by
  // the time a deep one is reached it knows everything being asked of it.
  const pending = depots.map(() => 0);

  for (const i of order) {
    const d = depots[i];
    const held = d.store[id] ?? 0;
    const want = (need[i][id] ?? 0) + pending[i] - held;
    if (want <= 0) continue;
    // Capped by the shelf it has to put the cargo on: asking further out for
    // what it could not hold anyway only moves the pile-up one depot along.
    let room = Math.min(want, BUILDINGS[d.type].capacity - warehouseUsed(d));
    if (room <= 0) continue;

    for (const j of near[i]) {
      if (depth[j] < depth[i]) continue;
      const donor = depots[j];
      // A depot never gives away what its own industry is waiting for.
      const spare = (donor.store[id] ?? 0) - (need[j][id] ?? 0);
      const moved = Math.min(room, spare);
      if (moved <= 0) continue;
      donor.store[id] -= moved;
      d.store[id] = (d.store[id] ?? 0) + moved;
      room -= moved;
      if (room <= 0) break;
    }

    if (room <= 0) continue;
    const deeper = near[i].filter((j) => depth[j] > depth[i]);
    if (!deeper.length) continue;
    const share = room / deeper.length;
    for (const j of deeper) pending[j] += share;
  }
}

// Haulage between a nation's own depots, run once per tick per owner.
export function relay(state) {
  const byOwner = depotsByOwner(state);
  const sitesByOwner = new Map();
  for (const b of state.buildings) {
    const recipe = BUILDINGS[b.type].recipe;
    if (!recipe || !Object.keys(recipe.in).length) continue;
    const list = sitesByOwner.get(b.owner);
    if (list) list.push(b); else sitesByOwner.set(b.owner, [b]);
  }

  for (const [owner, depots] of byOwner) {
    if (depots.length < 2) continue;
    const sites = sitesByOwner.get(owner);
    if (!sites?.length) continue;
    const { need, wanted } = depotNeeds(depots, sites);
    if (!wanted.size) continue;
    const near = depotNeighbours(depots);
    for (const id of COMMODITY_IDS) {
      if (wanted.has(id)) relayCommodity(depots, near, need, id);
    }
  }
}
