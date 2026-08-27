import { CONFIG } from '../core/config.js';
import { COMMODITY_IDS } from '../data/commodities.js';
import { COUNTRIES, pactCost } from '../data/countries.js';
import { neighboursOf } from '../data/geography.js';
import { pushAlert } from '../core/state.js';

// The other forty-five governments come to you.
//
// Opening a market used to be entirely your move: you found a country, you paid
// its fee, and it never had an opinion. But a nation with a full warehouse and
// nowhere to send it wants a customer at least as much as you want a supplier —
// so it offers a pact of its own, and since it is the one asking, IT pays.
//
// The offer is deliberately worth less than the same pact bought outright
// (`CONFIG.diplomacy.fee`): being courted is cheaper than courting, but the
// nations that court you are the ones that need you, not the ones you need.
//
// Nothing here is random in the sense of being unrepeatable — the roll is a
// pure function of `seed` and `tick`, so a save that is loaded and run again
// sees the same nations come knocking.
export function runDiplomacy(state) {
  if (!state.offers) state.offers = [];

  // An offer lapses, and one that has been overtaken (you bought that pact
  // yourself in the meantime) is simply gone.
  state.offers = state.offers.filter((offer) => state.tick - offer.tick < CONFIG.diplomacy.ttl
    && !state.countries[offer.from]?.pact);

  if (state.tick % CONFIG.diplomacy.every !== 0) return;
  if (state.offers.length >= CONFIG.diplomacy.maxPending) return;

  const pending = new Set(state.offers.map((o) => o.from));
  const surplus = warehouseTotals(state);

  // Sorted by distance, so the weighting below reaches for your neighbours
  // first without ever ruling out the far side of the planet.
  const candidates = neighboursOf(state.home).filter((id) => {
    if (state.countries[id].pact || pending.has(id)) return false;
    const gov = state.countries[id];
    if (!gov.solvent) return false;
    const fee = offerFee(id);
    // A government that cannot comfortably cover the fee has no business
    // offering it, and one paying its own payroll out of the fee would go under
    // the moment you accepted.
    if (gov.cash < fee * 2) return false;
    // It needs a reason: goods it cannot place at home, or people it cannot
    // feed from home. A self-sufficient nation with empty depots wants nothing
    // from you.
    return (surplus.get(id) ?? 0) > 0 || gov.supply < CONFIG.growth.pivot;
  });
  if (!candidates.length) return;

  // Squaring the roll bunches the pick toward the front of a list already
  // sorted by distance: mostly your neighbours, occasionally somebody far
  // enough away to be worth a great deal.
  const roll = noise(state.seed ^ Math.imul(state.tick + 1, 0x9e3779b1));
  const pick = candidates[Math.min(candidates.length - 1, Math.floor(roll * roll * candidates.length))];

  const fee = offerFee(pick);
  state.offers.push({ from: pick, fee, tick: state.tick });
  pushAlert(state, `${COUNTRIES[pick].name} offers a trade pact and ${money(fee)} with it — see the Trade tab.`, 'info');
}

export function offerFee(countryId) {
  return Math.round(pactCost(countryId) * CONFIG.diplomacy.fee);
}

export function offerFrom(state, countryId) {
  return (state.offers ?? []).find((offer) => offer.from === countryId) ?? null;
}

// How many ticks an offer has left before it lapses.
export function offerLeft(state, offer) {
  return Math.max(0, CONFIG.diplomacy.ttl - (state.tick - offer.tick));
}

// What every nation is sitting on. One pass, and only on a decision tick.
function warehouseTotals(state) {
  const totals = new Map();
  for (const b of state.buildings) {
    if (!b.store) continue;
    let sum = 0;
    for (const id of COMMODITY_IDS) sum += b.store[id] ?? 0;
    totals.set(b.owner, (totals.get(b.owner) ?? 0) + sum);
  }
  return totals;
}

// The same integer hash `generateWorld` uses, so diplomacy is reproducible from
// the save rather than from the wall clock.
function noise(seed) {
  let a = (seed + 0x6d2b79f5) >>> 0;
  a = Math.imul(a ^ (a >>> 15), 1 | a);
  a = (a + Math.imul(a ^ (a >>> 7), 61 | a)) ^ a;
  return ((a ^ (a >>> 14)) >>> 0) / 4294967296;
}

// Systems cannot import the UI's formatter, and a bare 42000 in a message reads
// as a quantity of goods rather than a price.
function money(value) {
  return value >= 1_000_000 ? `$${(value / 1_000_000).toFixed(2)}M` : `$${Math.round(value).toLocaleString('en-US')}`;
}
