import { CONFIG } from './core/config.js';
import { BUILDINGS } from './data/buildings.js';
import { COMMODITY_IDS } from './data/commodities.js';
import { COUNTRIES, pactCost } from './data/countries.js';
import { buildingOnTile, pushAlert, isOwnSoil, isPlayer, ownerById, ownerName } from './core/state.js';

// Money in an alert, spelled the way the panels spell it. Actions cannot import
// the UI's formatter — src/ui is the layer above this one — and a bare 18000 in
// a message reads as a quantity of goods rather than a price.
function cash(value) {
  const abs = Math.abs(value);
  const text = abs >= 1_000_000 ? `$${(abs / 1_000_000).toFixed(2)}M` : `$${Math.round(abs).toLocaleString('en-US')}`;
  return value < 0 ? `-${text}` : text;
}

function emptyBag() {
  const bag = {};
  for (const id of COMMODITY_IDS) bag[id] = 0;
  return bag;
}

// `owner` defaults to the nation you play. The forty-five governments call the
// very same function with their own id, so none of them can cheat: each pays
// from its treasury and obeys terrain and occupancy exactly as you do.
export function canBuild(state, type, tile, owner = state.home) {
  const def = BUILDINGS[type];
  if (!def) return { ok: false, reason: 'Unknown building type.' };
  if (!tile) return { ok: false, reason: 'No such tile.' };
  if (tile.terrain === 'water') return { ok: false, reason: 'That is open ocean.' };
  if (!tile.countryId) return { ok: false, reason: 'Unclaimed territory — no government here.' };
  if (!isOwnSoil(tile.countryId, owner)) {
    return { ok: false, reason: `${COUNTRIES[tile.countryId].name} is foreign soil — trade with it instead.` };
  }
  if (tile.buildingId != null) return { ok: false, reason: 'Tile is already occupied.' };
  if (!def.terrain.includes(tile.terrain)) {
    return { ok: false, reason: `${def.name} cannot be built on ${tile.terrain}.` };
  }
  if ((ownerById(state, owner)?.cash ?? 0) < def.cost) return { ok: false, reason: 'Treasury is short.' };
  return { ok: true };
}

export function build(state, type, tile, owner = state.home) {
  const check = canBuild(state, type, tile, owner);
  if (!check.ok) {
    if (isPlayer(state, owner)) pushAlert(state, check.reason, 'warn');
    return check;
  }
  const def = BUILDINGS[type];
  const building = {
    id: state.nextBuildingId++,
    type,
    // `owner` is also the nation this site stands in — a government builds only
    // at home — so nothing needs to carry the country separately.
    owner,
    x: tile.x,
    y: tile.y,
    tileId: tile.id,
    progress: 0,
    status: 'idle',
    // Rolling share of recent ticks this site actually worked. A new plant has
    // not worked one yet, so it opens at nought and climbs as it runs.
    uptime: 0,
    shortage: [],
    staffed: true,
    input: def.recipe && Object.keys(def.recipe.in).length ? emptyBag() : null,
    output: def.recipe ? emptyBag() : null,
    store: def.recipe ? null : emptyBag(),
  };
  ownerById(state, owner).cash -= def.cost;
  state.buildings.push(building);
  tile.buildingId = building.id;
  // Only your own ledger is worth interrupting you about: the other forty-five
  // governments build through this same function every few ticks.
  if (isPlayer(state, owner)) {
    pushAlert(state, `${def.name} built at (${tile.x}, ${tile.y}) for ${cash(def.cost)}.`, 'good');
  }
  return { ok: true, building };
}

export function demolish(state, tile, owner = state.home) {
  const building = buildingOnTile(state, tile);
  if (!building) return { ok: false, reason: 'Nothing to demolish here.' };
  if (building.owner !== owner) {
    const reason = `That belongs to ${ownerName(building.owner)}.`;
    if (isPlayer(state, owner)) pushAlert(state, reason, 'warn');
    return { ok: false, reason };
  }
  const def = BUILDINGS[building.type];
  const refund = Math.round(def.cost * CONFIG.demolishRefund);
  ownerById(state, owner).cash += refund;
  state.buildings = state.buildings.filter((b) => b.id !== building.id);
  tile.buildingId = null;
  if (isPlayer(state, owner)) {
    pushAlert(state, `${def.name} at (${tile.x}, ${tile.y}) demolished — ${cash(refund)} back.`, 'info');
  }
  return { ok: true, refund };
}

export function canOpenPact(state, countryId) {
  const country = COUNTRIES[countryId];
  if (!country) return { ok: false, reason: 'No such country.' };
  if (countryId === state.home) return { ok: false, reason: 'That is your own country.' };
  if (state.countries[countryId].pact) return { ok: false, reason: `Already trading with ${country.name}.` };
  const cost = pactCost(countryId);
  if (state.countries[state.home].cash < cost) {
    return { ok: false, reason: `A pact with ${country.name} costs more than the treasury holds.` };
  }
  return { ok: true, cost };
}

// A pact is permanent and paid up front: there is no refund for closing one,
// which is what makes opening a distant market a decision rather than a free
// upgrade. The fee lands in that nation's treasury, so buying your way into a
// market also funds the industry you will then be competing with.
export function openPact(state, countryId) {
  const check = canOpenPact(state, countryId);
  if (!check.ok) {
    pushAlert(state, check.reason, 'warn');
    return check;
  }
  state.countries[state.home].cash -= check.cost;
  state.countries[countryId].cash += check.cost;
  state.countries[countryId].pact = true;
  pushAlert(state, `Trade pact signed with ${COUNTRIES[countryId].name}.`, 'good');
  return { ok: true };
}

// The other half of the pact story: a nation that wants your market comes to
// you, and accepting is paid rather than paying. The fee is capped at what its
// treasury actually holds, so an eager government cannot bankrupt itself the
// moment you say yes — `runDiplomacy` will not make an offer it cannot cover,
// but ticks pass between the offer and your answer.
export function acceptOffer(state, countryId) {
  const offer = (state.offers ?? []).find((o) => o.from === countryId);
  if (!offer) return { ok: false, reason: 'No such offer.' };
  if (state.countries[countryId].pact) {
    state.offers = state.offers.filter((o) => o !== offer);
    return { ok: false, reason: `Already trading with ${COUNTRIES[countryId].name}.` };
  }
  const paid = Math.max(0, Math.min(offer.fee, state.countries[countryId].cash));
  state.countries[countryId].cash -= paid;
  state.countries[state.home].cash += paid;
  state.countries[countryId].pact = true;
  state.offers = state.offers.filter((o) => o !== offer);
  pushAlert(state, `Pact with ${COUNTRIES[countryId].name} accepted — ${cash(paid)} paid to you.`, 'good');
  return { ok: true, paid };
}

export function declineOffer(state, countryId) {
  const before = (state.offers ?? []).length;
  state.offers = (state.offers ?? []).filter((o) => o.from !== countryId);
  if (state.offers.length === before) return { ok: false, reason: 'No such offer.' };
  pushAlert(state, `Offer from ${COUNTRIES[countryId].name} declined.`, 'info');
  return { ok: true };
}

export function toggleExport(state, commodityId) {
  state.exports[commodityId] = !state.exports[commodityId];
  return { ok: true, on: state.exports[commodityId] };
}

export function toggleImport(state, commodityId) {
  state.imports[commodityId] = !state.imports[commodityId];
  return { ok: true, on: state.imports[commodityId] };
}

export function setSpeed(state, speed) {
  state.speed = CONFIG.speeds.includes(speed) ? speed : 1;
}

export function togglePause(state) {
  state.paused = !state.paused;
}
