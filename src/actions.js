import { CONFIG } from './core/config.js';
import { BUILDINGS } from './data/buildings.js';
import { COMMODITIES, COMMODITY_IDS } from './data/commodities.js';
import { COUNTRIES } from './data/countries.js';
import { TECHS, canResearch, techChain } from './data/technology.js';
import { buildingOnTile, exchangeOf, pushAlert, isOwnSoil, isPlayer, ownerById, ownerName,
  knowsTech, learnTech, contractById, contractLeft, declineTech } from './core/state.js';
import { licenceCost, clampShare } from './systems/research.js';
import { canSignContract, signContract, quotePrice, describe as describeContract, suggestExportContract } from './systems/contracts.js';
import { post, withdraw, takeListing, borrow, repay } from './systems/exchange.js';
import { canDeployUnit, createMilitaryUnit, disbandUnit, unitOnTile,
  moveMilitaryUnit, canMilitaryEnter, joinGroup, leaveGroup, groupOf, groupSpeed,
  speedOf, UNIT_TYPES, startAutoConquest, cancelAutoConquest, canAutoConquer,
  canGroup, unitsOf } from './systems/military.js';
import { proposeRelation, answerProposal, withdrawProposal, declareWar,
  callOffWar } from './systems/relations.js';

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
  // Technology gates every industry past the basics, for the forty-five
  // governments exactly as for you — `runStateIndustry` calls this same
  // function, so none of them can build what it has not learned either.
  if (def.tech && !knowsTech(state, owner, def.tech)) {
    return { ok: false, reason: `${TECHS[def.tech].name} has not been researched yet.` };
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
    // The tick it was laid. A plant needs time before "it has never worked" is
    // a judgement rather than an observation, and `closeDeadSites` is the one
    // thing that asks — see `stateIndustry.js`.
    builtAt: state.tick,
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

// --- the army -------------------------------------------------------------

// Raising a formation. There is no barracks and no build queue: you pick a unit
// out of the same dock the industries are in, click your own ground, and the
// batch it costs comes straight out of your warehouses. From then on it draws
// its upkeep every tick until it is disbanded or it starves — see
// `systems/military.js`, which owns every quantity involved.
export function deployUnit(state, type, tile, owner = state.home) {
  const check = canDeployUnit(state, owner, type, tile);
  if (!check.ok) {
    if (isPlayer(state, owner)) pushAlert(state, check.reason, 'warn');
    return check;
  }
  const result = createMilitaryUnit(state, owner, type, tile.id);
  if (result.ok && isPlayer(state, owner)) {
    const def = UNIT_TYPES[type];
    // Say plainly when the treasury made up the difference — buying goods in
    // costs several times what producing them does, and a player who does it by
    // accident should find out from the alert rather than from the balance.
    pushAlert(state, `${def.name} raised at (${tile.x}, ${tile.y}) for ${describeBag(def.cost)}`
      + `${result.cash > 0 ? `, ${cash(result.cash)} of it bought in` : ''}.`, 'good');
  }
  return result;
}

// Standing one down. The supplies that raised it are spent, so nothing comes
// back — what you get is the upkeep you stop paying.
export function standDown(state, tile, owner = state.home) {
  const unit = unitOnTile(state, tile.id);
  if (!unit) return { ok: false, reason: 'No formation here.' };
  return standDownUnit(state, unit.id, owner);
}

export function standDownUnit(state, unitId, owner = state.home) {
  const unit = (state.military?.units ?? []).find((u) => u.id === unitId);
  if (!unit) return { ok: false, reason: 'No such formation.' };
  if (unit.owner !== owner) {
    const reason = `That formation belongs to ${ownerName(unit.owner)}.`;
    if (isPlayer(state, owner)) pushAlert(state, reason, 'warn');
    return { ok: false, reason };
  }
  const result = disbandUnit(state, unit.id);
  if (result.ok && isPlayer(state, owner)) {
    pushAlert(state, `${UNIT_TYPES[unit.type].name} at (${unit.x}, ${unit.y}) stood down.`, 'info');
  }
  return result;
}

// Ordering a formation you already have to a new tile. The map asks for this
// once a unit is picked up in "move" mode and a destination is clicked — the
// same access rules as raising one apply (`canMilitaryEnter`), so a unit can
// only cross into land its government has a reason to be on.
//
// It is an ORDER, not an arrival: the column sets off and covers `speed` tiles
// a tick until it gets there. If the formation marches with a group, the whole
// group is ordered and moves at its slowest member's pace, so the alert says
// how many are on the road and how long it will take them.
export function orderMove(state, unitId, tile, owner = state.home) {
  const unit = (state.military?.units ?? []).find((u) => u.id === unitId);
  if (!unit) return { ok: false, reason: 'No such formation.' };
  if (unit.owner !== owner) {
    const reason = `That formation belongs to ${ownerName(unit.owner)}.`;
    if (isPlayer(state, owner)) pushAlert(state, reason, 'warn');
    return { ok: false, reason };
  }
  if (!tile) return { ok: false, reason: 'No such tile.' };
  if (!canMilitaryEnter(state, unit, tile)) {
    const reason = 'No military access to that ground.';
    if (isPlayer(state, owner)) pushAlert(state, reason, 'warn');
    return { ok: false, reason };
  }
  const result = moveMilitaryUnit(state, unitId, tile.id);
  if (!result.ok) { if (isPlayer(state, owner)) pushAlert(state, result.reason, 'warn'); return result; }
  if (isPlayer(state, owner)) {
    const pace = unit.groupId != null ? groupSpeed(state, unit.groupId) : speedOf(unit);
    const away = Math.max(Math.abs(tile.x - unit.x), Math.abs(tile.y - unit.y));
    const ticks = Math.max(1, Math.ceil(away / Math.max(1, pace)));
    const marching = result.ordered.length;
    pushAlert(state, `${marching > 1 ? `${marching} formations march` : `${UNIT_TYPES[unit.type].name} marches`} for (${tile.x}, ${tile.y}) — ${pace} tile${pace > 1 ? 's' : ''} a tick, about ${ticks} tick${ticks > 1 ? 's' : ''} out.`, 'info');
  }
  return result;
}

// AUTOMATIC CAMPAIGNS — the order, and the same order pressed again to stop it.
//
// Both go through one function because they are one button. `on` says which way
// it is being pressed, and everything else — who owns the formation, what the
// system will actually accept — is asked exactly once for either.
export function orderAutoConquest(state, unitId, on = true, owner = state.home) {
  const unit = (state.military?.units ?? []).find((u) => u.id === unitId);
  if (!unit) return { ok: false, reason: 'No such formation.' };
  if (unit.owner !== owner) return { ok: false, reason: `That formation belongs to ${ownerName(unit.owner)}.` };
  const result = on ? startAutoConquest(state, unitId) : cancelAutoConquest(state, unitId);
  if (!result.ok) { if (isPlayer(state, owner)) pushAlert(state, result.reason, 'warn'); return result; }
  if (isPlayer(state, owner)) {
    pushAlert(state, on
      ? `${UNIT_TYPES[unit.type].name} is campaigning against ${COUNTRIES[result.countryId].name} — it marches at their ground and takes a tile a tick, fighting whatever it meets.`
      : `${UNIT_TYPES[unit.type].name} called off its campaign against ${COUNTRIES[result.countryId].name}.`, 'info');
  }
  return result;
}

// THE SAME ORDER GIVEN TO MANY FORMATIONS AT ONCE — a marquee selection, or your
// whole army when nothing in particular is selected.
//
// It goes through `startAutoConquest`/`cancelAutoConquest` per formation exactly
// as the single button does, so a bulk order cannot write anything a single one
// could not: an aircraft is refused here for the same reason it is refused
// there, and so is a campaign in peacetime. What this adds is ONE alert for the
// lot, because thirty of them is not a report, it is a wall.
export function orderAutoConquestAll(state, unitIds = null, on = true, owner = state.home) {
  const army = unitsOf(state, owner);
  const wanted = unitIds == null ? army : army.filter((u) => unitIds.includes(u.id));
  let done = 0;
  let reason = on
    ? 'None of those formations can campaign — only land formations can, and only against an enemy at war that still holds land.'
    : 'None of those formations was campaigning.';
  for (const unit of wanted) {
    const result = on ? startAutoConquest(state, unit.id) : cancelAutoConquest(state, unit.id);
    if (result.ok) done++; else reason = result.reason;
  }
  if (!isPlayer(state, owner)) return { ok: done > 0, ordered: done };
  if (!done) { pushAlert(state, reason, 'warn'); return { ok: false, reason, ordered: 0 }; }
  pushAlert(state, on
    ? `${done} formation${done === 1 ? '' : 's'} campaigning — they march at the nearest enemy and take a tile a tick until its ground is gone.`
    : `${done} campaign${done === 1 ? '' : 's'} called off.`, on ? 'good' : 'info');
  return { ok: true, ordered: done };
}

// ONE DESTINATION, MANY FORMATIONS. The counterpart of `orderMove` for a
// selection, and it goes through the same `moveMilitaryUnit` per formation — so
// the access rule, the group rule and the march are all identical. A member
// already ordered by an earlier formation's group is skipped rather than
// ordered twice.
export function orderMoveMany(state, unitIds, tile, owner = state.home) {
  if (!tile) return { ok: false, reason: 'No such tile.' };
  const wanted = unitsOf(state, owner).filter((u) => unitIds.includes(u.id));
  if (!wanted.length) return { ok: false, reason: 'No formations of yours are selected.' };
  const moved = new Set();
  let refused = 'No military access to that ground.';
  for (const unit of wanted) {
    if (moved.has(unit.id)) continue;
    const result = moveMilitaryUnit(state, unit.id, tile.id);
    if (!result.ok) { refused = result.reason; continue; }
    for (const member of result.ordered) moved.add(member.id);
  }
  if (!isPlayer(state, owner)) return { ok: moved.size > 0, ordered: moved.size };
  if (!moved.size) { pushAlert(state, refused, 'warn'); return { ok: false, reason: refused, ordered: 0 }; }
  pushAlert(state, `${moved.size} formation${moved.size === 1 ? '' : 's'} march for (${tile.x}, ${tile.y}).`, 'info');
  return { ok: true, ordered: moved.size };
}

// EVERY SELECTED FORMATION INTO ONE COLUMN. `joinGroup` decides who may stand
// with whom — land with land, aircraft with aircraft, one government's — so the
// domains simply fall out into as many groups as there are domains, rather than
// this file knowing anything about them.
export function groupMany(state, unitIds, owner = state.home) {
  const wanted = unitsOf(state, owner).filter((u) => unitIds.includes(u.id));
  if (wanted.length < 2) return { ok: false, reason: 'Select at least two of your own formations to group them.' };
  let joined = 0;
  const leaders = [];
  for (const unit of wanted) {
    const lead = leaders.find((other) => canGroup(other, unit));
    if (!lead) { leaders.push(unit); continue; }
    if (joinGroup(state, lead.id, unit.id).ok) joined++;
  }
  if (!isPlayer(state, owner)) return { ok: joined > 0, joined };
  if (!joined) {
    const reason = 'Those formations are already grouped, or none of them can march together.';
    pushAlert(state, reason, 'warn');
    return { ok: false, reason };
  }
  pushAlert(state, `${joined + leaders.length} formations grouped into ${leaders.length} column${leaders.length === 1 ? '' : 's'} — an order to any of them is an order to all.`, 'good');
  return { ok: true, joined };
}

// WHICH OF YOUR FORMATIONS A MARQUEE JUST CAUGHT. It reads `state` and decides
// nothing, so the map can drag a box without knowing what a formation is.
export function unitsInBox(state, x0, y0, x1, y1, owner = state.home) {
  const left = Math.min(x0, x1);
  const right = Math.max(x0, x1);
  const top = Math.min(y0, y1);
  const bottom = Math.max(y0, y1);
  return unitsOf(state, owner)
    .filter((u) => u.x >= left && u.x <= right && u.y >= top && u.y <= bottom)
    .map((u) => u.id);
}

// Whether an automatic campaign is available to this government at all — the
// panel asks it to decide whether to offer the button for the whole army, and it
// is the same gate one formation's button goes through.
export function canCampaign(state, owner = state.home) {
  return unitsOf(state, owner).some((unit) => canAutoConquer(state, unit).ok);
}

// --- groups ---------------------------------------------------------------

// Putting two of your formations in one group. From then on an order given to
// either is given to both, and they march at the slower one's pace — see
// `moveMilitaryUnit`. Land marches with land and aircraft fly with aircraft;
// the system decides that, not this file.
export function groupUnits(state, unitId, otherId, owner = state.home) {
  const a = (state.military?.units ?? []).find((u) => u.id === unitId);
  const b = (state.military?.units ?? []).find((u) => u.id === otherId);
  if (!a || !b) return { ok: false, reason: 'No such formation.' };
  if (a.owner !== owner || b.owner !== owner) {
    const reason = 'You can only group your own formations.';
    if (isPlayer(state, owner)) pushAlert(state, reason, 'warn');
    return { ok: false, reason };
  }
  const result = joinGroup(state, unitId, otherId);
  if (!result.ok) { if (isPlayer(state, owner)) pushAlert(state, result.reason, 'warn'); return result; }
  if (isPlayer(state, owner)) {
    pushAlert(state, `${UNIT_TYPES[b.type].name} joined the group — ${result.size} formations now move together at ${groupSpeed(state, result.groupId)} tile/tick.`, 'good');
  }
  return result;
}

export function ungroupUnit(state, unitId, owner = state.home) {
  const unit = (state.military?.units ?? []).find((u) => u.id === unitId);
  if (!unit) return { ok: false, reason: 'No such formation.' };
  if (unit.owner !== owner) return { ok: false, reason: `That formation belongs to ${ownerName(unit.owner)}.` };
  const size = groupOf(state, unit).length;
  const result = leaveGroup(state, unitId);
  if (!result.ok) { if (isPlayer(state, owner)) pushAlert(state, result.reason, 'warn'); return result; }
  if (isPlayer(state, owner)) {
    pushAlert(state, `${UNIT_TYPES[unit.type].name} left the group${size > 2 ? '' : ' — the group is dissolved'}.`, 'info');
  }
  return result;
}

function describeBag(bag) {
  return Object.entries(bag).map(([id, qty]) => `${qty} ${COMMODITIES[id].name}`).join(' + ');
}

// --- the exchange ---------------------------------------------------------

// Your own ask or bid on the open book. Everything else about it is the same as
// a government's: it stands for `CONFIG.exchange.ttl` ticks, anybody may take
// it, and the matcher will pair it the moment somebody's terms cross yours.
export function postListing(state, draft) {
  const result = post(state, {
    from: state.home,
    side: draft.side,
    commodity: draft.commodity,
    qty: Number(draft.qty) || 0,
    price: Number(draft.price) || 0,
    every: Math.max(1, Math.round(Number(draft.every) || 1)),
    term: Math.max(1, Math.round(Number(draft.term) || CONFIG.exchange.term)),
  });
  if (!result.ok) { pushAlert(state, result.reason, 'warn'); return result; }
  pushAlert(state, `Posted: ${draft.side === 'sell' ? 'selling' : 'buying'} ${result.listing.qty} ${COMMODITIES[draft.commodity].name}/${result.listing.every}t at ${cash(result.listing.price)}.`, 'good');
  return result;
}

export function cancelListing(state, listingId) {
  const result = withdraw(state, listingId);
  if (result.ok) pushAlert(state, 'Listing withdrawn.', 'info');
  return result;
}

// Taking somebody else's terms off the book, at their price.
export function take(state, listingId) {
  const result = takeListing(state, listingId, state.home);
  if (!result.ok) { pushAlert(state, result.reason, 'warn'); return result; }
  pushAlert(state, `${describeContract(state, result.contract)} taken off the book.`, 'good');
  return result;
}

// Borrowing against the clearing fund, and paying it back. The fund is the fee
// every settlement on the exchange has paid in, so this is the world's own trade
// lending to the nation that needs it.
export function takeLoan(state, amount) {
  const result = borrow(state, state.home, amount);
  if (!result.ok) pushAlert(state, result.reason, 'warn');
  return result;
}

export function repayLoan(state, amount) {
  const result = repay(state, state.home, amount);
  if (!result.ok) pushAlert(state, result.reason, 'warn');
  return result;
}

// --- technology -----------------------------------------------------------

// What the laboratories are working on. Switching subject keeps the points
// already banked, because they are a budget line rather than progress on one
// particular idea — a nation that changes its mind loses time, not money.
export function setResearch(state, techId) {
  const home = state.countries[state.home];
  if (techId && !canResearch(home.techs ?? {}, techId)) {
    return { ok: false, reason: 'That needs something you have not learned yet.' };
  }
  home.researching = techId ?? null;
  return { ok: true };
}

export function setResearchShare(state, share) {
  state.countries[state.home].researchShare = clampShare(share);
  return { ok: true, share: state.countries[state.home].researchShare };
}

export function canBuyTech(state, techId, fromId) {
  const home = state.countries[state.home];
  if (!TECHS[techId]) return { ok: false, reason: 'No such technology.' };
  if (knowsTech(state, state.home, techId)) return { ok: false, reason: 'You already have it.' };
  if (!knowsTech(state, fromId, techId)) {
    return { ok: false, reason: `${ownerName(fromId)} does not have it either.` };
  }
  const cost = licenceCost(state, state.home, techId);
  if (home.cash < cost) return { ok: false, reason: 'A licence costs more than the treasury holds.' };
  return { ok: true, cost };
}

// Buying knowledge rather than working it out. Everything upstream you still
// lack comes with it — a fab is no use to a nation that cannot make glass — so
// one licence can be several techs, and the quote says so.
export function buyTech(state, techId, fromId) {
  const check = canBuyTech(state, techId, fromId);
  if (!check.ok) { pushAlert(state, check.reason, 'warn'); return check; }
  const chain = techChain(state.countries[state.home].techs ?? {}, techId);
  state.countries[state.home].cash -= check.cost;
  state.countries[fromId].cash += check.cost;
  for (const id of chain) learnTech(state, state.home, id);
  pushAlert(state, `${TECHS[techId].name} licensed from ${ownerName(fromId)} for ${cash(check.cost)}${chain.length > 1 ? ` (${chain.length} technologies)` : ''}.`, 'good');
  return { ok: true, chain };
}

export function acceptTechOffer(state, techId) {
  const offer = (state.techOffers ?? []).find((o) => o.tech === techId);
  if (!offer) return { ok: false, reason: 'No such offer.' };
  const result = buyTech(state, techId, offer.from);
  if (result.ok) state.techOffers = state.techOffers.filter((o) => o !== offer);
  return result;
}

// Turning one down is remembered, so the same government does not come back
// with it for `CONFIG.offerCooldown` ticks.
export function declineTechOffer(state, techId) {
  const before = (state.techOffers ?? []).length;
  state.techOffers = (state.techOffers ?? []).filter((o) => o.tech !== techId);
  declineTech(state, techId);
  return state.techOffers.length === before ? { ok: false, reason: 'No such offer.' } : { ok: true };
}

// --- contracts ------------------------------------------------------------

// Your side of a contract, drafted in the Trade tab. `dir` is written from YOUR
// point of view: 'buy' means the cargo comes to you.
export function proposeContract(state, draft) {
  const terms = contractTerms(state, draft);
  const check = canSignContract(state, terms);
  if (!check.ok) { pushAlert(state, check.reason, 'warn'); return check; }
  // The other side has to believe it. A government will not promise to sell
  // what it does not have, nor buy what it cannot pay for.
  const willing = otherSideAgrees(state, terms);
  if (!willing.ok) { pushAlert(state, willing.reason, 'warn'); return willing; }
  const result = signContract(state, terms);
  if (result.ok) pushAlert(state, `${describeContract(state, result.contract)} signed at ${cash(result.contract.price)}/unit.`, 'good');
  return result;
}

export function contractTerms(state, draft) {
  const other = draft.partner;
  const buying = draft.dir === 'buy';
  return {
    seller: buying ? other : state.home,
    buyer: buying ? state.home : other,
    commodity: draft.commodity,
    qty: Number(draft.qty) || 0,
    every: Math.max(1, Math.round(Number(draft.every) || 1)),
    term: Math.max(0, Math.round(Number(draft.term) || 0)),
  };
}

// The quote you are being offered, so the panel can show it before you commit.
export function contractQuote(state, draft) {
  const terms = contractTerms(state, draft);
  if (!terms.seller || !terms.buyer || terms.seller === terms.buyer) return null;
  return quotePrice(state, terms.seller, terms.buyer, terms.commodity);
}

export function suggestContractExport(state, draft, owner = state.home) {
  const result = suggestExportContract(state, owner, draft.commodity);
  if (!result.ok) { if (isPlayer(state, owner)) pushAlert(state, result.reason, 'warn'); return result; }
  return {
    ok: true,
    draft: {
      ...draft,
      dir: 'sell',
      partner: result.buyerId,
      qty: result.qty,
      every: 1,
      suggestion: { partner: result.buyerId, need: result.need, price: result.price, available: result.available },
    },
  };
}

// A government signs what it can keep. Asking one to promise ten coal a tick
// when it has never mined any is not a deal, it is a penalty scheme.
function otherSideAgrees(state, terms) {
  const themId = isPlayer(state, terms.seller) ? terms.buyer : terms.seller;
  const them = state.countries[themId];
  if (!them.solvent) return { ok: false, reason: `${ownerName(themId)} is insolvent and will not sign.` };
  if (isPlayer(state, terms.buyer)) {
    // They would be supplying you: they need the goods on the shelf.
    const held = stockOf(state, themId, terms.commodity);
    const perDelivery = terms.qty;
    if (held < perDelivery * 2) {
      return { ok: false, reason: `${ownerName(themId)} has nowhere near ${perDelivery} ${COMMODITIES[terms.commodity].name} to promise.` };
    }
  } else {
    // They would be buying from you: they need a reason and a treasury.
    const price = quotePrice(state, terms.seller, terms.buyer, terms.commodity);
    if (them.cash < price * terms.qty * 4) {
      return { ok: false, reason: `${ownerName(themId)} cannot underwrite a contract that size.` };
    }
  }
  return { ok: true };
}

function stockOf(state, ownerId, commodityId) {
  let held = 0;
  for (const b of state.buildings) {
    if (b.owner === ownerId && b.store) held += b.store[commodityId] ?? 0;
  }
  return held;
}

export function acceptContractOffer(state, offer) {
  const found = (state.contractOffers ?? []).find((o) => o.from === offer.from
    && o.commodity === offer.commodity && o.dir === offer.dir);
  if (!found) return { ok: false, reason: 'No such offer.' };
  const seller = found.dir === 'sell' ? found.from : state.home;
  const buyer = found.dir === 'sell' ? state.home : found.from;
  const result = signContract(state, {
    seller, buyer, commodity: found.commodity,
    qty: found.qty, every: found.every, term: found.term, price: found.price,
  });
  if (!result.ok) { pushAlert(state, result.reason, 'warn'); return result; }
  state.contractOffers = state.contractOffers.filter((o) => o !== found);
  pushAlert(state, `${describeContract(state, result.contract)} signed.`, 'good');
  return result;
}

export function declineContractOffer(state, offer) {
  const before = (state.contractOffers ?? []).length;
  state.contractOffers = (state.contractOffers ?? []).filter((o) => !(o.from === offer.from
    && o.commodity === offer.commodity && o.dir === offer.dir));
  return state.contractOffers.length === before ? { ok: false, reason: 'No such offer.' } : { ok: true };
}

// Walking away early. A contract is a promise, so breaking one is not free:
// the other side is paid the penalty on everything still owed. That is the
// same rate a missed delivery costs, which is what stops cancelling from being
// a cheaper way to default.
export function cancelContract(state, id) {
  const contract = contractById(state, id);
  if (!contract) return { ok: false, reason: 'No such contract.' };
  const mine = isPlayer(state, contract.seller) || isPlayer(state, contract.buyer);
  if (!mine) return { ok: false, reason: 'That is not your contract.' };
  const left = contractLeft(state, contract);
  const owed = (left / contract.every) * contract.qty * contract.price;
  const fee = Math.round(owed * CONFIG.contracts.penalty);
  const otherId = isPlayer(state, contract.seller) ? contract.buyer : contract.seller;
  state.countries[state.home].cash -= fee;
  state.countries[otherId].cash += fee;
  state.contracts = state.contracts.filter((c) => c.id !== id);
  pushAlert(state, `Contract with ${ownerName(otherId)} broken — ${cash(fee)} paid to walk away.`, 'warn');
  return { ok: true, fee };
}

export function toggleExport(state, commodityId) {
  state.exports[commodityId] = !state.exports[commodityId];
  if (!state.exports[commodityId]) withdrawPolicyListings(state, commodityId, 'sell');
  return { ok: true, on: state.exports[commodityId] };
}

export function toggleImport(state, commodityId) {
  state.imports[commodityId] = !state.imports[commodityId];
  if (!state.imports[commodityId]) withdrawPolicyListings(state, commodityId, 'buy');
  return { ok: true, on: state.imports[commodityId] };
}

// Thirty-four flags is thirty-four clicks, so the whole side moves at once.
// Both of these SAY what they did: a policy you set on a paused game changes
// nothing you can see happening, and a button that looks inert is a button you
// assume is broken.
export function setAllExports(state, on) {
  for (const id of COMMODITY_IDS) state.exports[id] = Boolean(on);
  const pulled = on ? 0 : withdrawPolicyListings(state, null, 'sell');
  pushAlert(state, on
    ? `Offering all ${COMMODITY_IDS.length} commodities on the exchange.`
    : `Offering nothing on the exchange${pulled ? ` — ${pulled} ask${pulled > 1 ? 's' : ''} withdrawn` : ''}. Exports are yours to place by hand.`, 'info');
  return { ok: true, on: Boolean(on), pulled };
}

export function setAllImports(state, on) {
  for (const id of COMMODITY_IDS) state.imports[id] = Boolean(on);
  const pulled = on ? 0 : withdrawPolicyListings(state, null, 'buy');
  pushAlert(state, on
    ? `Bidding for all ${COMMODITY_IDS.length} commodities on the exchange.`
    : `Bidding for nothing on the exchange${pulled ? ` — ${pulled} bid${pulled > 1 ? 's' : ''} withdrawn` : ''}. Imports are yours to arrange by hand.`, 'info');
  return { ok: true, on: Boolean(on), pulled };
}

// A flag turned off pulls the terms it was standing behind, or your government
// would keep a promise it is no longer willing to make. `exchangeOf` rather than
// `state.exchange` because a save written before the exchange existed has no
// book at all, and a throw here would leave the panel unrepainted — which looks
// exactly like a button that does nothing.
function withdrawPolicyListings(state, commodityId, side) {
  const book = exchangeOf(state);
  const before = book.listings.length;
  book.listings = book.listings.filter((listing) => listing.from !== state.home
    || listing.side !== side
    || (commodityId && listing.commodity !== commodityId));
  return before - book.listings.length;
}

export function setSpeed(state, speed) {
  state.speed = CONFIG.speeds.includes(speed) ? speed : 1;
}

export function togglePause(state) {
  state.paused = !state.paused;
}

// --- diplomacy ------------------------------------------------------------
//
// A relation is no longer a dropdown you set. Alliance, military access and
// peace are all ASKED FOR, and the other government answers on the same
// appetite it uses to answer every other nation (`relationAppetite`). War is
// the exception and it is the exception on purpose — see `systems/relations.js`.
//
// `changeRelation` is kept as the one door the UI goes through, so a click on
// "Declare war" and a click on "Propose alliance" are the same call with a
// different word, and neither can reach a code path the other cannot.
export function changeRelation(state, countryId, relation) {
  return relation === 'war' ? declareOnCountry(state, countryId) : proposeTo(state, countryId, relation);
}

export function proposeTo(state, countryId, relation, from = state.home) {
  const result = proposeRelation(state, from, countryId, relation);
  if (!result.ok) {
    if (isPlayer(state, from)) pushAlert(state, result.reason, 'warn');
    return result;
  }
  if (isPlayer(state, from)) {
    pushAlert(state, `${describeRelation(relation)} proposed to ${ownerName(countryId)} — awaiting their answer.`, 'info');
  }
  return result;
}

export function declareOnCountry(state, countryId, from = state.home) {
  const result = declareWar(state, from, countryId);
  if (!result.ok && isPlayer(state, from)) pushAlert(state, result.reason, 'warn');
  return result;
}

// Answering what another government has put to YOU. The same function the world
// answers with — `answerProposal` in the system — so your yes cannot write a
// relation theirs could not.
export function answerPact(state, proposalId, accept, by = state.home) {
  const result = answerProposal(state, proposalId, accept, by);
  if (!result.ok) { pushAlert(state, result.reason, 'warn'); return result; }
  const other = result.proposal.from === by ? result.proposal.to : result.proposal.from;
  pushAlert(state, accept
    ? `${describeRelation(result.proposal.relation)} agreed with ${ownerName(other)}.`
    : `Declined ${ownerName(other)}'s proposal.`, accept ? 'good' : 'info');
  return result;
}

export function withdrawPact(state, proposalId, by = state.home) {
  const result = withdrawProposal(state, proposalId, by);
  if (!result.ok) { pushAlert(state, result.reason, 'warn'); return result; }
  pushAlert(state, `Proposal to ${ownerName(result.proposal.to)} withdrawn.`, 'info');
  return result;
}

export function standDownWar(state, ultimatumId, by = state.home) {
  const result = callOffWar(state, ultimatumId, by);
  if (!result.ok) { pushAlert(state, result.reason, 'warn'); return result; }
  pushAlert(state, `Declaration of war on ${ownerName(result.ultimatum.to)} called off.`, 'good');
  return result;
}

function describeRelation(relation) {
  return relation === 'alliance' ? 'An alliance'
    : relation === 'access' ? 'Military access'
      : relation === 'war' ? 'War' : 'Peace';
}
