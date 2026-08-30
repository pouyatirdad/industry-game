import { BUILDINGS } from '../data/buildings.js';
import { COUNTRY_IDS } from '../data/countries.js';
import { COMMODITY_IDS } from '../data/commodities.js';
import { appetite } from '../core/state.js';

// THE WORLD'S BALANCE SHEET, PER COMMODITY.
//
// What the planet wants per tick against what it can actually make, plus what is
// standing in warehouses right now. Three governments' decisions read it and
// they used to read three different copies:
//
//   * `stateIndustry` scores a plan by how badly the world needs its output,
//   * `research` now picks a subject the same way, rather than by "cheap and
//     plausibly useful",
//   * and both need `worldOffer` to know whether a feedstock is buyable at all.
//
// It lived in `stateIndustry.js` because that was the first caller. A second
// copy in `research.js` would have drifted from this one the first time either
// was tuned, and the numbers would then have disagreed about what the world is
// short of — which is exactly the sort of split that produced the limestone bug
// this whole measure exists to fix.
//
// MEMOISED PER TICK, because it walks every building in the world three times
// and every country once. `research` runs every tick and `state` every five, so
// without this the sweep would be paid twice on the ticks they coincide.
const cache = new WeakMap();

export function worldBalance(state) {
  const hit = cache.get(state);
  if (hit && hit.tick === state.tick && hit.buildings === state.buildings.length) return hit.value;
  const wants = worldDemand(state);
  const supply = worldSupply(state);
  const value = {
    wants,
    supply,
    offered: worldOffer(state),
    scarce: scarcityOf(wants.world, supply),
  };
  // `state.buildings.length` is in the key as well as the tick because a
  // government BUILDS inside the decision phase: the plan it scores second must
  // see the site it laid first, or a nation lays four identical plants in one
  // decision on the strength of a shortage the first one already answered.
  cache.set(state, { tick: state.tick, buildings: state.buildings.length, value });
  return value;
}

// What every commodity is wanted for, worldwide and per nation: people's
// appetite PLUS what the world's factories burn. Counting only appetite is what
// left the world permanently short of feedstock — nobody built the coal mine
// that three coal plants in another country were waiting on, because as far as
// `hasHeadroom` was concerned nobody wanted any more coal.
export function worldDemand(state) {
  const world = {};
  const home = {};
  for (const commodityId of COMMODITY_IDS) {
    world[commodityId] = 0;
    home[commodityId] = {};
  }
  for (const countryId of COUNTRY_IDS) {
    for (const commodityId of COMMODITY_IDS) {
      const eats = appetite(state, countryId, commodityId);
      home[commodityId][countryId] = eats;
      world[commodityId] += eats;
    }
  }
  for (const b of state.buildings) {
    const recipe = BUILDINGS[b.type].recipe;
    if (!recipe) continue;
    for (const [id, qty] of Object.entries(recipe.in)) {
      const burn = qty / recipe.ticks;
      world[id] += burn;
      home[id][b.owner] = (home[id][b.owner] ?? 0) + burn;
    }
  }
  return { world, home };
}

// What the world can MAKE of each commodity per tick, from every site standing.
// The counterpart of `worldDemand`: the two together say which commodities the
// planet is actually short of, which is a different question from which ones pay
// best — and getting those two confused is what left the world burning twice the
// limestone it quarried.
export function worldSupply(state) {
  const totals = {};
  for (const id of COMMODITY_IDS) totals[id] = 0;
  for (const b of state.buildings) {
    const recipe = BUILDINGS[b.type].recipe;
    if (!recipe) continue;
    for (const [id, qty] of Object.entries(recipe.out)) totals[id] += qty / recipe.ticks;
  }
  return totals;
}

// Everything sitting in a warehouse anywhere, by commodity. A government reads
// this as "could I buy this in" — every market on earth is open to every nation,
// so anything standing on a shelf is reachable by any of them.
export function worldOffer(state) {
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

// A shortage may make a plan look up to this much better than its margin says,
// and no more. Uncapped, the first commodity nobody makes at all would outweigh
// every other consideration and the whole world would build one thing.
export const SCARCITY_CAP = 4;

// HOW SHORT THE WORLD IS OF EACH COMMODITY, as a multiplier on a plan that makes
// it. This is the one thing that stops every government on earth building the
// same profitable plant.
//
// Margin alone cannot see a shortage. `marginPerTick` deliberately values output
// at the LOWER of the local and base price — that pessimism is load-bearing,
// because a market nobody supplies sits at a premium and a government that took
// it at face value would build into it and collapse it. But the same pessimism
// blinds it to a genuine, structural shortage: cement pays better than
// limestone, so everybody built cement plants, the world ended up burning twice
// the limestone it quarried, and no government could see why building a quarry
// was the most valuable thing it could do.
//
// So scarcity is measured on QUANTITIES, not prices, where the premium cannot
// mislead it. A commodity nobody is short of scores 1 and changes nothing.
export function scarcityOf(wants, supply) {
  const out = {};
  for (const id of COMMODITY_IDS) {
    const want = wants[id] ?? 0;
    const made = supply[id] ?? 0;
    // No demand at all is not a shortage, it is a commodity nobody has found a
    // use for yet — building into that is how a government goes broke.
    out[id] = want <= 0 ? 1 : Math.max(0.5, Math.min(SCARCITY_CAP, want / Math.max(made, want * 0.05)));
  }
  return out;
}

// The scarcity of a whole side of a recipe, weighted by how much of each
// commodity it moves — so a plant is judged on the thing it mostly makes rather
// than on a trace by-product.
export function scarcityGain(bag, scarce) {
  if (!scarce) return 1;
  let total = 0;
  let weight = 0;
  for (const [id, qty] of Object.entries(bag)) {
    total += (scarce[id] ?? 1) * qty;
    weight += qty;
  }
  return weight ? total / weight : 1;
}
