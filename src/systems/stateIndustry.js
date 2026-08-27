import { CONFIG } from '../core/config.js';
import { BUILDINGS, BUILDING_IDS } from '../data/buildings.js';
import { COUNTRIES, COUNTRY_IDS } from '../data/countries.js';
import { COMMODITIES } from '../data/commodities.js';
import { projectedWages, buildingsOf, appetite, siteWages, warehouseUsed } from '../core/state.js';
import { build, canBuild, demolish } from '../actions.js';
import { warehousesServing } from './logistics.js';

// The other forty-five nations run their own industry. They are not scripted
// opponents with special powers: each goes through `build` exactly as you do,
// pays from its treasury, obeys terrain and occupancy, and idles when it misses
// payroll. Nothing here is special-cased, which is why this file is a hundred
// lines — it decides *what* to build and the rest of the engine does the work.
//
// Their money comes from selling to their own people and exporting the surplus,
// plus whatever you paid them for a trade pact. Buying your way into a market
// funds the industry you will then be competing with, which is the point.
//
// Decisions are deliberately slow (CONFIG.stateBuildEvery) and capped at one
// site per country per decision, because a government that built every tick
// would carpet its own land inside a minute and leave you nothing to buy.
export function runStateIndustry(state) {
  if (state.tick % CONFIG.stateBuildEvery !== 0) return;

  // Tiles are grouped by country in ONE pass and shared across all the
  // decisions. Rescanning every tile per country per building type — the
  // obvious way to write this — costs millions of checks per decision.
  const byCountry = new Map();
  for (const tile of state.tiles) {
    if (!tile.countryId || tile.countryId === state.home) continue;
    const list = byCountry.get(tile.countryId);
    if (list) list.push(tile); else byCountry.set(tile.countryId, [tile]);
  }

  // What the world has on offer, so a government can plan a plant around an
  // input it cannot dig up. Indexed once for all forty-five decisions.
  const offered = worldOffer(state);

  for (const id of COUNTRY_IDS) {
    // Your own country is yours to run. Nothing builds on your soil but you.
    if (id === state.home) continue;
    const tiles = byCountry.get(id) ?? [];
    // More than one site per decision, or a government with a full treasury
    // spends the game saving it. It still stops the moment nothing is worth
    // building or the reserve is reached, so this is a ceiling, not a quota.
    for (let n = 0; n < CONFIG.stateBuildsPerDecision; n++) {
      if (!considerBuild(state, id, tiles, offered)) break;
    }
  }
}

// Everything sitting in a warehouse anywhere, by commodity. A government reads
// this as "could I buy this in" — the forty-five trade freely with each other,
// so anything on the world market is reachable by any of them.
function worldOffer(state) {
  const totals = new Map();
  for (const b of state.buildings) {
    if (!b.store) continue;
    for (const id of Object.keys(b.store)) {
      const qty = b.store[id] ?? 0;
      if (qty > 0) totals.set(id, (totals.get(id) ?? 0) + qty);
    }
  }
  return totals;
}

function considerBuild(state, countryId, tiles, offered) {
  const gov = state.countries[countryId];
  // A broke government closes plants rather than sinking forever. Without this
  // one line an insolvent nation idles every site, keeps paying the payroll on
  // all of them, and never comes back — and half the map ends up bankrupt.
  if (!gov.solvent) { closeWorstSite(state, countryId); return false; }
  if (!tiles.length) return false;

  // Keep enough treasury to make payroll for a while after spending.
  const reserve = projectedWages(state, countryId) * CONFIG.stateReserveTicks;
  const spendable = gov.cash - reserve;
  if (spendable <= 0) return false;

  const own = buildingsOf(state, countryId);
  const depots = own.filter((b) => b.store);
  // Depots are decided BEFORE industry, not scored against it. A warehouse
  // earns nothing directly, so any profitable plant always outbids it — and a
  // government that only ever builds plants ends up with one full warehouse and
  // thirty sites blocked behind it, which is exactly what used to happen.
  const candidate = needsDepot(state, countryId, own, depots)
    ? bestDepot(state, countryId, spendable, tiles)
    : bestSite(state, countryId, spendable, own, tiles, offered);
  if (!candidate) return false;
  return build(state, candidate.type, candidate.tile, countryId).ok;
}

function needsDepot(state, countryId, own, depots) {
  if (!depots.length) return true;
  const free = depots.reduce((sum, d) => sum + BUILDINGS[d.type].capacity - warehouseUsed(d), 0);
  if (free < BUILDINGS.warehouse.capacity * CONFIG.stateDepotHeadroom) return true;
  // A site can end up somewhere no warehouse will ever reach — an offshore rig
  // far from any coast a depot can stand on. Without this ratio cap, that one
  // site makes the government build warehouses forever and never build industry
  // again.
  if (depots.length * CONFIG.stateSitesPerDepot >= own.length) return false;
  return own.some((b) => b.output && !warehousesServing(state, b.x, b.y, countryId).length);
}

// The most expensive site goes first, and the demolition refund is what buys
// the payroll back into the black. A depot is kept to the last, since selling
// the warehouse strands everything else.
function closeWorstSite(state, countryId) {
  let worst = null;
  for (const b of state.buildings) {
    if (b.owner !== countryId) continue;
    const cost = siteWages(b) + (b.store ? -1e6 : 0);
    if (!worst || cost > worst.cost) worst = { building: b, cost };
  }
  if (!worst) return;
  demolish(state, state.tiles[worst.building.tileId], countryId);
}

// A government's first move is always a depot, since nothing it builds can move
// goods without one. It is placed where it covers the most of its own deposits.
// Scored on a COARSE density grid, not by comparing every tile against every
// other. Russia holds tens of thousands of tiles, so the pairwise version is
// hundreds of millions of comparisons per decision; bucketing is a single pass.
function bestDepot(state, countryId, spendable, tiles) {
  const def = BUILDINGS.warehouse;
  if (def.cost > spendable) return null;

  const cell = Math.max(1, def.radius);
  const density = new Map();
  for (const tile of tiles) {
    if (tile.terrain === 'plain' || tile.buildingId != null) continue;
    const key = `${Math.floor(tile.x / cell)},${Math.floor(tile.y / cell)}`;
    density.set(key, (density.get(key) ?? 0) + 1);
  }

  let best = null;
  for (const tile of tiles) {
    const key = `${Math.floor(tile.x / cell)},${Math.floor(tile.y / cell)}`;
    const score = density.get(key) ?? 0;
    if (best && score <= best.score) continue;
    if (!canBuild(state, 'warehouse', tile, countryId).ok) continue;
    best = { type: 'warehouse', tile, score };
  }
  return best;
}

// Otherwise it builds whatever pays best per tick at its own local prices, and
// only if it can actually feed it — from its own industry OR from the world
// market. A country with no coalfield can run a steel mill on imported coal
// exactly as you can, so refusing to plan around an input it cannot dig up was
// what left half the map as pure extraction economies.
function bestSite(state, countryId, spendable, own, tiles, offered) {
  const market = state.markets[countryId];
  const produces = new Set();
  const rate = {};
  for (const b of own) {
    const recipe = BUILDINGS[b.type].recipe;
    if (!recipe) continue;
    for (const [id, qty] of Object.entries(recipe.out)) {
      produces.add(id);
      rate[id] = (rate[id] ?? 0) + qty / recipe.ticks;
    }
  }

  let best = null;
  for (const type of BUILDING_IDS) {
    const def = BUILDINGS[type];
    if (!def.recipe) continue;   // storage is `needsDepot`'s decision, not this one
    if (def.cost > spendable) continue;

    // An input counts as available if the country makes it, or if there is
    // enough of it standing in warehouses somewhere to keep the plant fed for a
    // few jobs. `marginPerTick` then prices those inputs at the DEARER of local
    // and base price, so a plan built on imports has to clear a margin at a
    // price it will not actually be beaten by.
    const inputs = Object.entries(def.recipe.in);
    if (!inputs.every(([id, qty]) => produces.has(id) || (offered?.get(id) ?? 0) >= qty * 4)) continue;
    if (!hasHeadroom(state, countryId, def, rate)) continue;

    const wages = Math.round(def.wages * COUNTRIES[countryId].wageMul);
    const score = marginPerTick(def, market) - wages;
    if (score <= 0) continue;

    const tile = findTile(state, countryId, type, tiles);
    if (!tile) continue;
    if (!best || score > best.score) best = { type, tile, score };
  }
  return best;
}

// A government stops building capacity it has nowhere to send. Its own people
// cap what it can sell at home; the rest of the world is worth a slice of what
// everybody eats, which is what lets Norway build a gas industry many times
// larger than Norway. Without this a resource-rich nation carpets its deposits
// and then goes broke paying wages on cargo that never leaves the warehouse.
function hasHeadroom(state, countryId, def, rate) {
  const { homeShare, worldShare } = CONFIG.stateCapacity;
  for (const [id, qty] of Object.entries(def.recipe.out)) {
    const home = appetite(state, countryId, id);
    let world = 0;
    for (const other of COUNTRY_IDS) world += appetite(state, other, id);
    const ceiling = home * homeShare + world * worldShare;
    if ((rate[id] ?? 0) + qty / def.recipe.ticks > ceiling) return false;
  }
  return true;
}

// Output is valued at the LOWER of the local price and the commodity's base
// price, inputs at the higher. A market nobody supplies sits at a shortage
// premium, and a government that took that premium at face value would build
// into it, collapse the very price it was counting on, and then be paying wages
// on a plant that no longer covers them. Costing the plan pessimistically is
// what turns a boom-and-bust AI into one that keeps its books.
function marginPerTick(def, market) {
  const out = Object.entries(def.recipe.out)
    .reduce((sum, [id, qty]) => sum + qty * Math.min(market[id]?.price ?? 0, COMMODITIES[id].basePrice), 0);
  const inn = Object.entries(def.recipe.in)
    .reduce((sum, [id, qty]) => sum + qty * Math.max(market[id]?.price ?? 0, COMMODITIES[id].basePrice), 0);
  return (out - inn) / def.recipe.ticks;
}

// Only tiles the government's own depots already reach are considered, so state
// industry grows in clusters rather than scattering unreachable sites.
function findTile(state, countryId, type, tiles) {
  const def = BUILDINGS[type];
  for (const tile of tiles) {
    // Cheapest checks first: terrain and occupancy reject nearly everything, and
    // canBuild allocates a reason string on every rejection.
    if (tile.buildingId != null) continue;
    if (!def.terrain.includes(tile.terrain)) continue;
    if (def.recipe && !warehousesServing(state, tile.x, tile.y, countryId).length) continue;
    if (!canBuild(state, type, tile, countryId).ok) continue;
    return tile;
  }
  return null;
}
