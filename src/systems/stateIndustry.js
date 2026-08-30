import { CONFIG } from '../core/config.js';
import { BUILDINGS, BUILDING_IDS } from '../data/buildings.js';
import { COUNTRIES, COUNTRY_IDS } from '../data/countries.js';
import { COMMODITIES } from '../data/commodities.js';
import { projectedWages, buildingsOf, siteWages, warehouseUsed, knowsTech, isAlive } from '../core/state.js';
import { build, canBuild, demolish } from '../actions.js';
import { servedBy } from './logistics.js';
import { tilesByCountry, EMPTY_LAND } from './worldIndex.js';
import { worldBalance, scarcityGain } from './worldBalance.js';

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

// The tile index and the world's balance sheet both moved out to modules of
// their own (`worldIndex.js`, `worldBalance.js`) once `stateMilitary` and
// `research` needed them too. A second copy of either would walk a million tiles
// or every building in the world all over again, and — worse — would drift from
// this one the first time either was tuned.

export function runStateIndustry(state) {
  if (state.tick % CONFIG.stateBuildEvery !== 0) return;

  const byCountry = tilesByCountry(state);

  // What the world wants, what it can make, how short of each thing it is, and
  // what is standing on a shelf somewhere — worked out ONCE for all 257
  // decisions rather than once per country.
  const { offered, wants, supply, scarce } = worldBalance(state);

  for (const id of COUNTRY_IDS) {
    // Your own country is yours to run. Nothing builds on your soil but you.
    if (id === state.home) continue;
    // A nation conquered out of existence builds nothing ever again.
    if (!isAlive(state, id)) continue;
    const land = byCountry.get(id) ?? EMPTY_LAND;
    // Dead capital is cleared BEFORE anything new is considered, so the refund
    // is in the treasury and the ground is free when the decision below is
    // taken. A government that only ever built forward kept paying wages on
    // plants that had not turned a job in two hundred ticks.
    closeDeadSites(state, id);
    // More than one site per decision, or a government with a full treasury
    // spends the game saving it. It still stops the moment nothing is worth
    // building or the reserve is reached, so this is a ceiling, not a quota.
    for (let n = 0; n < CONFIG.stateBuildsPerDecision; n++) {
      if (!considerBuild(state, id, land, offered, wants, supply, scarce)) break;
    }
  }
}

// A site that has not worked in a long time is money leaving the treasury every
// tick for nothing. A government demolishes it and takes the refund, which is
// what turns a bad decision into capital rather than a permanent drain.
//
// Three guards, and each one is here because leaving it out thrashes: a plant
// gets `deadAfter` ticks to find its feet before anybody judges it, only a
// genuinely idle one counts (`uptime`), and a WAREHOUSE is never touched —
// selling the depot strands everything else, exactly as in `closeWorstSite`.
function closeDeadSites(state, countryId) {
  const { deadAfter, deadUptime } = CONFIG.stateSalvage;
  for (const b of state.buildings) {
    if (b.owner !== countryId || !b.output) continue;
    if (state.tick - (b.builtAt ?? 0) < deadAfter) continue;
    if ((b.uptime ?? 0) > deadUptime) continue;
    demolish(state, state.tiles[b.tileId], countryId);
    return;   // one a decision: a country is not razed in a single tick
  }
}

function considerBuild(state, countryId, land, offered, wants, supply, scarce) {
  const gov = state.countries[countryId];
  // A broke government closes plants rather than sinking forever. Without this
  // one line an insolvent nation idles every site, keeps paying the payroll on
  // all of them, and never comes back — and half the map ends up bankrupt.
  if (!gov.solvent) { closeWorstSite(state, countryId); return false; }
  if (!land.all.length) return false;

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
  const candidate = needsDepot(own, depots)
    ? bestDepot(state, countryId, spendable, land.all)
    : bestSite(state, countryId, spendable, own, depots, land, offered, wants, supply, scarce);
  if (!candidate) return false;
  return build(state, candidate.type, candidate.tile, countryId).ok;
}

function needsDepot(own, depots) {
  if (!depots.length) return true;
  const free = depots.reduce((sum, d) => sum + BUILDINGS[d.type].capacity - warehouseUsed(d), 0);
  if (free < BUILDINGS.warehouse.capacity * CONFIG.stateDepotHeadroom) return true;
  // A site can end up somewhere no warehouse will ever reach — an offshore rig
  // far from any coast a depot can stand on. Without this ratio cap, that one
  // site makes the government build warehouses forever and never build industry
  // again.
  if (depots.length * CONFIG.stateSitesPerDepot >= own.length) return false;
  return own.some((b) => b.output && !servedBy(depots, b.x, b.y));
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
function bestSite(state, countryId, spendable, own, depots, land, offered, wants, supply, scarce) {
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
    for (const [id, qty] of Object.entries(recipe.in)) {
      rate[id] = (rate[id] ?? 0) - qty / recipe.ticks;
    }
  }

  // Plans it could site today, and — separately — what the plans it CANNOT site
  // are waiting for. The second list is the whole point of the pass below.
  const viable = [];
  const blockedBy = new Map();

  for (const type of BUILDING_IDS) {
    const def = BUILDINGS[type];
    if (!def.recipe) continue;   // storage is `needsDepot`'s decision, not this one
    // A government builds only what it has learned to build, exactly as you do.
    if (!knowsTech(state, countryId, def.tech)) continue;

    const wages = Math.round(def.wages * COUNTRIES[countryId].wageMul);
    // A plan is worth what it earns TIMES how badly the world needs what it
    // makes, divided by how hard what it burns is to get. The second half
    // matters as much as the first: a plant built on a feedstock nobody can
    // supply is a plant that stands idle, and its margin on paper is a fiction.
    const margin = marginPerTick(def, market) - wages;
    const inputScarcity = scarcityGain(def.recipe.in, scarce);
    const score = margin * scarcityGain(def.recipe.out, scarce) / Math.max(1, inputScarcity * inputScarcity);

    // An input counts as available if the country makes it, or if there is
    // enough of it standing in warehouses somewhere to keep the plant fed for a
    // few jobs. `marginPerTick` then prices those inputs at the DEARER of local
    // and base price, so a plan built on imports has to clear a margin at a
    // price it will not actually be beaten by.
    const missing = Object.entries(def.recipe.in)
      .filter(([id, qty]) => {
        const inputRate = qty / def.recipe.ticks;
        if (produces.has(id) && (!undersuppliedManufactured(id, wants, supply, inputRate) || (rate[id] ?? 0) >= inputRate)) {
          return false;
        }
        return (offered?.get(id) ?? 0) < qty * 4 || undersuppliedManufactured(id, wants, supply, inputRate);
      })
      .map(([id]) => id);

    if (missing.length) {
      // IT CANNOT BUILD THIS ONE — BUT REMEMBER WHAT IT IS WAITING FOR.
      //
      // A nation with no coalfield and no coal on any shelf it can reach used to
      // discard the steel mill here and never think about it again, so it never
      // built the coal mine that would have made the mill possible. Half the map
      // stayed a pure extraction economy for exactly this reason.
      //
      // Two guards keep it honest: the blocked plan has to be worth something on
      // its own terms, and it has to be within distant reach of the treasury —
      // planning a chain around a plant this government will never afford is how
      // an AI talks itself into a mine nothing will ever consume.
      if (score <= 0 || def.cost > spendable * CONFIG.stateChain.reach) continue;
      // Split across everything it lacks: a plan short of three feedstocks is not
      // three times as good a reason to build any one of them.
      const share = score / missing.length;
      for (const id of missing) blockedBy.set(id, Math.max(blockedBy.get(id) ?? 0, share));
      continue;
    }

    if (def.cost > spendable) continue;
    if (!hasHeadroom(state, countryId, def, rate, wants)) continue;
    // Kept even when the margin is negative, because the pass below may find it
    // is worth building anyway for what it unblocks. It is filtered on the TOTAL.
    viable.push({ type, score, out: def.recipe.out });
  }

  // ONE LEVEL OF LOOKAHEAD, and one only. A plant that feeds a plan the
  // government actually wants is worth more than its own margin says; two levels
  // would need a real planner, and 257 governments cannot afford one.
  const ranked = viable
    .map((plan) => {
      let unblocks = 0;
      for (const id of Object.keys(plan.out)) unblocks = Math.max(unblocks, blockedBy.get(id) ?? 0);
      return { type: plan.type, score: plan.score + unblocks * CONFIG.stateChain.lookahead };
    })
    .filter((plan) => plan.score > 0)
    .sort((a, b) => b.score - a.score);

  // Highest score that can actually be put somewhere. Walking in rank order
  // rather than scoring every type and then siting it means `findTile` — which
  // walks a country's tiles of one terrain — is usually called once.
  for (const plan of ranked) {
    const tile = findTile(state, countryId, plan.type, depots, land);
    if (tile) return { type: plan.type, tile, score: plan.score };
  }
  return null;
}

// A government stops building capacity it has nowhere to send. Its own people
// cap what it can sell at home; the rest of the world is worth a slice of what
// everybody eats, which is what lets Norway build a gas industry many times
// larger than Norway. Without this a resource-rich nation carpets its deposits
// and then goes broke paying wages on cargo that never leaves the warehouse.
function hasHeadroom(state, countryId, def, rate, wants) {
  const { homeShare, worldShare } = CONFIG.stateCapacity;
  for (const [id, qty] of Object.entries(def.recipe.out)) {
    // Demand is people AND factory floors. A commodity is wanted by whoever
    // burns it, and coal that three foreign power stations are waiting on is
    // demand exactly as bread on a table is — leaving it out is what made the
    // world permanently short of every feedstock it did not eat directly.
    const home = wants.home[id]?.[countryId] ?? 0;
    const world = wants.world[id] ?? 0;
    const ceiling = home * homeShare + world * worldShare;
    if ((rate[id] ?? 0) + qty / def.recipe.ticks > ceiling) return false;
  }
  return true;
}

const MANUFACTURED_OUTPUTS = new Set(Object.values(BUILDINGS)
  .filter((def) => def.recipe && Object.keys(def.recipe.in).length)
  .flatMap((def) => Object.keys(def.recipe.out)));

function undersuppliedManufactured(commodityId, wants, supply, added = 0) {
  if (!MANUFACTURED_OUTPUTS.has(commodityId)) return false;
  const want = (wants.world[commodityId] ?? 0) + added;
  if (want <= 0) return false;
  return (supply[commodityId] ?? 0) < want * 0.5;
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
//
// It walks the country's tiles OF THE RIGHT TERRAIN rather than all of them: a
// steel mill wants plain ground, and at a quarter of a degree Russia's fortyseven
// thousand tiles were being walked once per building type to discover that a
// coalfield is not plain.
function findTile(state, countryId, type, depots, land) {
  const def = BUILDINGS[type];
  for (const terrain of def.terrain) {
    for (const tile of land.byTerrain.get(terrain) ?? []) {
      // Cheapest checks first: occupancy rejects nearly everything, and canBuild
      // allocates a reason string on every rejection.
      if (tile.buildingId != null) continue;
      if (def.recipe && !servedBy(depots, tile.x, tile.y)) continue;
      if (!canBuild(state, type, tile, countryId).ok) continue;
      return tile;
    }
  }
  return null;
}
