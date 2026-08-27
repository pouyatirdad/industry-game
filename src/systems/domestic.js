import { CONFIG } from '../core/config.js';
import { COMMODITY_IDS } from '../data/commodities.js';
import { COUNTRY_IDS } from '../data/countries.js';
import { appetite, allOwners, isPlayer, noteLedger } from '../core/state.js';

// The home market. Before anything is shipped anywhere, a nation's warehouses
// serve its own population, and that is where most of a treasury's money comes
// from.
//
// A nation can sell its people at most what they actually eat in a tick — its
// `appetite`. Past that there is no buyer at home, and the surplus is left in
// the warehouse for the trade system to find a foreign one. That cap, not a
// flag, is what makes exporting necessary: build past what your own people
// consume and you MUST find someone else to sell to.
export function sellDomestic(state) {
  // Only the home line is reset here. `exports` and `imports` belong to
  // `runContracts`, which has already run this tick and put its figures in
  // them — a contract IS this game's import and export.
  for (const owner of allOwners(state)) owner.report.domestic = 0;
  for (const country of COUNTRY_IDS) {
    const market = state.markets[country];
    for (const id of COMMODITY_IDS) {
      market[id].soldLastTick = 0;
      market[id].importedLastTick = 0;
    }
  }

  for (const b of state.buildings) {
    if (!b.store) continue;
    const market = state.markets[b.owner];
    const owner = state.countries[b.owner];
    if (!market || !owner) continue;

    for (const id of COMMODITY_IDS) {
      const qty = b.store[id] ?? 0;
      if (qty <= 0) continue;

      const line = market[id];
      // Appetite is per nation per tick, so every warehouse in the country
      // draws on the same remaining room rather than each getting its own.
      const room = appetite(state, b.owner, id) - line.soldLastTick;
      if (room <= 0) continue;

      const sold = Math.min(qty, room);
      b.store[id] = qty - sold;
      line.soldLastTick += sold;
      line.soldTotal += sold;
      owner.report.domestic += sold * line.price;
      if (isPlayer(state, b.owner)) {
        noteLedger(state, id, 'sold', sold);
        noteLedger(state, id, 'revenue', sold * line.price);
      }
    }
  }

  for (const owner of allOwners(state)) {
    owner.report.domestic = Math.round(owner.report.domestic);
    // The tax base: what the private economy hands the treasury whether or not
    // the state produces anything at all. It scales with `demand`, so a nation
    // that keeps its people supplied is literally paying itself to grow.
    owner.report.tax = Math.round(owner.demand * CONFIG.taxPerDemand);
    owner.cash += owner.report.domestic + owner.report.tax;
  }
}

// How much of a nation's appetite is actually being met, per commodity. The
// private economy this game does not simulate supplies `selfSufficiency` of it
// on its own; state sales and imports come on top.
export function supplyRatio(state, countryId, commodityId) {
  const wanted = appetite(state, countryId, commodityId);
  if (wanted <= 0) return 1;
  const line = state.markets[countryId][commodityId];
  const supplied = wanted * CONFIG.selfSufficiency + line.soldLastTick + line.importedLastTick;
  return supplied / wanted;
}

// What a nation is still short of this tick, in units — what the trade system
// tries to buy for it.
export function unmet(state, countryId, commodityId) {
  const wanted = appetite(state, countryId, commodityId);
  const line = state.markets[countryId][commodityId];
  const supplied = wanted * CONFIG.selfSufficiency + line.soldLastTick + line.importedLastTick;
  return Math.max(0, wanted - supplied);
}
