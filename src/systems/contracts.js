import { CONFIG } from '../core/config.js';
import { COMMODITIES, COMMODITY_IDS } from '../data/commodities.js';
import { COUNTRIES, COUNTRY_IDS } from '../data/countries.js';
import { haulShare } from '../data/geography.js';
import { BUILDINGS } from '../data/buildings.js';
import { allOwners, canTrade, exchangeOf, isPlayer, noteLedger, ownerName, pushAlert, recordFlow,
  siteWages } from '../core/state.js';
import { depotsByOwner, drawFrom, deliverTo, spaceIn, stockIn } from './logistics.js';
import { unmet } from './domestic.js';

// SUPPLY CONTRACTS — the only way goods cross a border.
//
// There is no spot market. Nothing is bought or sold automatically on anybody's
// behalf: every cargo that moves between two nations moves because somebody
// promised it would, at a price somebody agreed to. What finds the two parties
// is the open book in `exchange.js`, and a match there lands straight here.
//
// Three rules do all the work, and each is a design decision:
//
//  * A contract is settled BEFORE the home market. You promised, so the cargo
//    leaves the country before the shopkeeper opens. That is what gives a
//    contract teeth — and it is why over-committing your own supply is a real
//    way to starve your own people.
//  * A contract is priced ONCE, at signing, and the price never moves. That is
//    the whole product: the seller gives up the chance of a better day and the
//    buyer stops caring what the market does.
//  * Either side can fail, and failing COSTS. A seller that cannot fill the
//    order, and a buyer that cannot pay for it or has nowhere to put it, pays
//    `CONFIG.contracts.penalty` of the value it defaulted on to the other side.
//
// Whatever is left in the warehouses after every contract has been honoured is
// what that nation's own people get to buy, which is the whole reason contracts
// are settled first: a promise outranks a shopkeeper.
export function runContracts(state) {
  if (!state.contracts) state.contracts = [];
  for (const owner of allOwners(state)) {
    // A contract is the only way anything crosses a border now, so these ARE
    // the nation's exports and imports rather than a line beside them.
    owner.report.exports = 0;
    owner.report.imports = 0;
    owner.report.penalties = 0;
    owner.report.fees = 0;
  }
  if (!state.contracts.length) return;

  // Depots and payroll are indexed ONCE, exactly as trade indexes them: a tick
  // that settles a hundred contracts must not scan every building in the world
  // twice per contract.
  const depots = depotsByOwner(state);
  const payroll = new Map();
  for (const b of state.buildings) payroll.set(b.owner, (payroll.get(b.owner) ?? 0) + siteWages(b));

  const kept = [];
  for (const contract of state.contracts) {
    if (state.tick >= contract.started) settle(state, contract, depots, payroll);
    if (state.tick < contract.started + contract.term) { kept.push(contract); continue; }
    if (isPlayer(state, contract.seller) || isPlayer(state, contract.buyer)) {
      pushAlert(state, `${describe(state, contract)} has run its term.`, 'info');
    }
  }
  state.contracts = kept;
}

function settle(state, c, depots, payroll) {
  if ((state.tick - c.started) % c.every !== 0) return;

  const seller = state.countries[c.seller];
  const buyer = state.countries[c.buyer];
  const def = COMMODITIES[c.commodity];
  if (!seller || !buyer || !def) return;

  const sellerDepots = depots.get(c.seller) ?? [];
  const buyerDepots = depots.get(c.buyer) ?? [];

  // The agreed price is DELIVERED: the buyer pays it, and the seller carries
  // the freight out of what it receives. Distance therefore shows up in what a
  // seller is willing to quote rather than as a surcharge nobody agreed to.
  const freight = def.basePrice * CONFIG.trade.freight * haulShare(c.seller, c.buyer);
  const unit = c.price;
  const keeps = Math.max(0, unit - freight);

  // What the buyer can actually take: money it has past its payroll reserve,
  // and somewhere to put the cargo.
  const budget = buyer.cash - (payroll.get(c.buyer) ?? 0) * CONFIG.trade.reserveTicks;
  const affordable = unit > 0 ? Math.max(0, budget) / unit : c.qty;
  const takeable = Math.min(c.qty, affordable, spaceIn(buyerDepots));

  const drawn = drawFrom(sellerDepots, c.commodity, takeable);
  const landed = deliverTo(buyerDepots, c.commodity, drawn);
  // Anything that would not fit goes back where it came from rather than
  // evaporating; the buyer is charged for failing to take it, below.
  if (landed < drawn) deliverTo(sellerDepots, c.commodity, drawn - landed);

  const bill = landed * unit;
  // The clearing house takes its cut of BOTH sides of anything that came off the
  // book. It is a fee rather than a tax: it does not vanish, it builds the fund
  // that a government borrows against when it cannot make payroll.
  const cut = c.viaExchange ? landed * unit * CONFIG.exchange.fee : 0;
  buyer.cash -= bill + cut;
  seller.cash += landed * keeps - cut;
  buyer.report.imports += bill + cut;
  seller.report.exports += landed * keeps - cut;
  buyer.report.fees += cut;
  seller.report.fees += cut;
  if (cut > 0) exchangeOf(state).fund += cut * 2;

  // Two different failures, and they are charged to two different parties. The
  // buyer defaults on what it could not pay for or store; the seller defaults
  // on what the buyer stood ready to take and it could not supply.
  const buyerShort = Math.max(0, c.qty - takeable);
  const sellerShort = Math.max(0, takeable - landed);
  charge(state, c, buyer, seller, buyerShort, unit, 'buyer');
  charge(state, c, seller, buyer, sellerShort, unit, 'seller');

  c.delivered = (c.delivered ?? 0) + landed;
  c.paid = (c.paid ?? 0) + bill;
  c.missed = (c.missed ?? 0) + buyerShort + sellerShort;
  c.deliveries = (c.deliveries ?? 0) + 1;

  if (landed > 0) {
    book(state, c, landed, bill, landed * keeps);
    recordFlow(state, {
      tick: state.tick,
      from: c.seller,
      to: c.buyer,
      commodity: c.commodity,
      kind: 'contract',
      qty: Math.round(landed * 10) / 10,
      value: Math.round(landed * unit),
    });
  }
}

// A default. The money moves whether or not the defaulter can afford it — that
// is what a penalty is — so a government that over-promises can drive itself
// insolvent, and its sites idle next tick exactly as if it had missed payroll.
function charge(state, c, from, to, short, unit, side) {
  if (short <= 0.0001) return;
  const fee = short * unit * CONFIG.contracts.penalty;
  from.cash -= fee;
  to.cash += fee;
  from.report.penalties -= fee;
  to.report.penalties += fee;
  c.penalties = (c.penalties ?? 0) + fee;
  c.lastMiss = state.tick;
  c.lastMissBy = side;
  if (isPlayer(state, from.id)) {
    pushAlert(state, `${short.toFixed(1)} ${COMMODITIES[c.commodity].name} short on your contract with ${ownerName(to.id)} — ${money(fee)} penalty.`, 'danger');
  }
}

// Your own side of a contract, in units and in money, for the Goods tab. A
// contracted cargo lands in a warehouse like any other, so it is NOT booked as
// feedstock: whether it ends up on a factory floor or over a counter is
// decided later, by `distribute` and `sellDomestic`.
function book(state, c, qty, bill, proceeds) {
  if (isPlayer(state, c.seller)) {
    noteLedger(state, c.commodity, 'exported', qty);
    noteLedger(state, c.commodity, 'earned', proceeds);
  }
  if (isPlayer(state, c.buyer)) {
    noteLedger(state, c.commodity, 'imported', qty);
    noteLedger(state, c.commodity, 'paid', bill);
  }
}

// --- quoting and signing --------------------------------------------------

// What a contract between these two would price at. The spot midpoint plus the
// certainty premium: the buyer is paying for a supply it can plan around, and
// the seller is giving up the chance of a better day.
export function quotePrice(state, sellerId, buyerId, commodityId) {
  const sell = state.markets[sellerId]?.[commodityId]?.price ?? COMMODITIES[commodityId].basePrice;
  const buy = state.markets[buyerId]?.[commodityId]?.price ?? COMMODITIES[commodityId].basePrice;
  const mid = sell + (buy - sell) * CONFIG.trade.split;
  return Math.round(mid * (1 + CONFIG.contracts.premium) * 100) / 100;
}

export function countContracts(state, countryId) {
  return (state.contracts ?? []).reduce((n, c) => n + (c.seller === countryId || c.buyer === countryId ? 1 : 0), 0);
}

export function canSignContract(state, terms) {
  const { seller, buyer, commodity, qty, every, term } = terms;
  if (!state.countries[seller] || !state.countries[buyer]) return { ok: false, reason: 'No such nation.' };
  if (seller === buyer) return { ok: false, reason: 'A nation cannot contract with itself.' };
  if (!COMMODITIES[commodity]) return { ok: false, reason: 'No such commodity.' };
  if (!canTrade(state, seller, buyer)) return { ok: false, reason: 'Those two cannot deal.' };
  if (!(qty > 0)) return { ok: false, reason: 'A contract has to move something.' };
  if (!(every >= 1)) return { ok: false, reason: 'A delivery cannot come more often than once a tick.' };
  if (term < 0 || term > CONFIG.contracts.maxTerm) {
    return { ok: false, reason: `A term runs at most ${CONFIG.contracts.maxTerm} ticks.` };
  }
  if (term > 0 && term < CONFIG.contracts.minTerm) {
    return { ok: false, reason: `A standing contract runs at least ${CONFIG.contracts.minTerm} ticks.` };
  }
  for (const id of [seller, buyer]) {
    if (countContracts(state, id) >= CONFIG.contracts.maxPerNation) {
      return { ok: false, reason: `${ownerName(id)} has as many contracts as it will hold.` };
    }
  }
  return { ok: true };
}

// Signing is the only way a contract comes into being — the player's button,
// an accepted offer and the governments' own dealing all land here, so none of
// them can write a contract the others could not.
export function signContract(state, terms) {
  const check = canSignContract(state, terms);
  if (!check.ok) return check;
  const price = terms.price ?? quotePrice(state, terms.seller, terms.buyer, terms.commodity);
  const contract = {
    id: state.nextContractId++,
    seller: terms.seller,
    buyer: terms.buyer,
    commodity: terms.commodity,
    qty: terms.qty,
    every: terms.every,
    // Term 0 is a one-off: it settles once and is gone. Everything else runs
    // until its ticks are up.
    term: terms.term,
    price,
    // Whether the exchange brokered it, and therefore whether the clearing fee
    // is charged on every settlement.
    viaExchange: Boolean(terms.viaExchange),
    // Goods take a tick to travel, so the first delivery is next tick — the
    // same rule that puts `distribute` after `produce`.
    started: state.tick + 1,
    delivered: 0, paid: 0, missed: 0, penalties: 0, deliveries: 0,
    lastMiss: null, lastMissBy: null,
  };
  state.contracts.push(contract);
  return { ok: true, contract };
}

export function describe(state, c) {
  const what = `${c.qty} ${COMMODITIES[c.commodity].name}${c.every > 1 ? `/${c.every}t` : '/t'}`;
  return isPlayer(state, c.seller)
    ? `Your contract to sell ${what} to ${ownerName(c.buyer)}`
    : `Your contract to buy ${what} from ${ownerName(c.seller)}`;
}

// --- the world's own dealing ----------------------------------------------

// Contracts other governments want with YOU, and the ones they strike among
// themselves. Both go through `signContract`, so nothing here can write terms
// you could not write yourself.
export function runContractDiplomacy(state) {
  if (!state.contractOffers) state.contractOffers = [];
  state.contractOffers = state.contractOffers.filter((offer) => state.tick - offer.tick < CONFIG.contracts.ttl);

  if (state.tick % CONFIG.contracts.every !== 0) return;

  const depots = depotsByOwner(state);
  const need = shortages(state);
  worldContracts(state, depots, need);
  offerToPlayer(state, depots, need);
}

// What every nation's factories are short of per tick, beyond what its own
// ground produces. This is the figure a contract is actually for: a government
// that has to buy coal every tick would rather promise for it than gamble on
// the spot market forty times running.
function shortages(state) {
  const burns = new Map();
  const makes = new Map();
  for (const b of state.buildings) {
    const recipe = BUILDINGS[b.type].recipe;
    if (!recipe) continue;
    for (const [id, qty] of Object.entries(recipe.in)) bump(burns, b.owner, id, qty / recipe.ticks);
    for (const [id, qty] of Object.entries(recipe.out)) bump(makes, b.owner, id, qty / recipe.ticks);
  }
  const out = new Map();
  for (const id of COUNTRY_IDS) {
    const row = {};
    for (const commodityId of COMMODITY_IDS) {
      const gap = (burns.get(id)?.[commodityId] ?? 0) - (makes.get(id)?.[commodityId] ?? 0);
      if (gap > 0) row[commodityId] = gap;
    }
    out.set(id, row);
  }
  return out;
}

function bump(index, ownerId, commodityId, qty) {
  let row = index.get(ownerId);
  if (!row) { row = {}; index.set(ownerId, row); }
  row[commodityId] = (row[commodityId] ?? 0) + qty;
}

// One government per decision tick goes looking for a standing supply of
// something its factories cannot dig up, and signs with the nearest nation that
// has a real surplus of it. Reproducible from `seed` and `tick`, like every
// other decision the world makes.
function worldContracts(state, depots, need) {
  const others = COUNTRY_IDS.filter((id) => id !== state.home);
  // A handful of governments look each decision tick rather than one, or the
  // world takes a thousand ticks to write its first contract and the whole
  // mechanism is invisible outside your own dealings.
  for (let n = 0; n < CONFIG.contracts.seekersPerTick; n++) {
    const roll = noise(state.seed ^ Math.imul(state.tick + 3 + n * 97, 0x9e3779b1));
    seekContract(state, others[Math.floor(roll * others.length)], depots, need);
  }
}

function seekContract(state, buyerId, depots, need) {
  const buyer = state.countries[buyerId];
  if (!buyer?.solvent) return;
  if (countContracts(state, buyerId) >= CONFIG.contracts.maxPerNation) return;

  const row = need.get(buyerId) ?? {};
  const commodityId = Object.keys(row).sort((a, b) => row[b] - row[a])[0];
  if (!commodityId) return;
  // Already covered by a standing contract? Then it does not need another.
  const covered = (state.contracts ?? []).reduce((sum, c) =>
    sum + (c.buyer === buyerId && c.commodity === commodityId ? c.qty / c.every : 0), 0);
  const gap = row[commodityId] - covered;
  if (gap <= 0.5) return;

  const seller = bestSeller(state, buyerId, commodityId, gap, depots);
  if (!seller) return;
  signContract(state, {
    seller, buyer: buyerId, commodity: commodityId,
    qty: Math.round(gap * 2 * 10) / 10, every: 2, term: 120,
  });
}

// A nation with the goods actually standing in its depots, nearest first. A
// promise nobody can keep is worse than no promise, so surplus is checked
// against stock rather than against intent.
function bestSeller(state, buyerId, commodityId, perTick, depots) {
  let best = null;
  for (const id of COUNTRY_IDS) {
    if (id === buyerId || !canTrade(state, id, buyerId)) continue;
    if (!state.countries[id].solvent) continue;
    const held = stockIn(depots.get(id) ?? [], commodityId);
    // Enough on the shelf to cover several deliveries, and enough left over
    // that its own people are not being sold out from under it.
    if (held < perTick * 4) continue;
    const haul = haulShare(id, buyerId);
    if (!best || haul < best.haul) best = { id, haul };
  }
  return best?.id ?? null;
}

// ...and one nation comes to you with terms. It is asking, so it is asking for
// what it is actually short of — or offering what it cannot place at home.
function offerToPlayer(state, depots, need) {
  if (state.contractOffers.length >= CONFIG.contracts.maxOffers) return;
  const partners = COUNTRY_IDS.filter((id) => id !== state.home && state.countries[id].solvent);
  if (!partners.length) return;

  const pending = new Set(state.contractOffers.map((o) => `${o.from}|${o.commodity}|${o.dir}`));
  // Every partner is considered, starting from a reproducible roll and going
  // round — one nation picked at random almost never happened to be sitting on
  // the thing you were short of, so the whole mechanism stayed invisible until
  // you went looking for it yourself.
  const start = Math.floor(noise(state.seed ^ Math.imul(state.tick + 5, 0x27d4eb2d)) * partners.length);
  const mine = depots.get(state.home) ?? [];

  let from = null;
  let pick = null;
  for (let n = 0; n < partners.length && !pick; n++) {
    const candidate = partners[(start + n) % partners.length];
    const theirs = depots.get(candidate) ?? [];

    // What it wants FROM you, and what it will sell YOU. A nation wants a
    // commodity for two different reasons and both count: its factories burn it
    // and cannot dig it up, or its people are simply short of it. Counting only
    // the factory gap made offers almost impossible — an oil state with a full
    // warehouse and a customer in mind is the commonest deal there is, and it
    // has nothing to do with anybody's factory floor.
    const wantsFromYou = wanted(state, candidate, need)
      .filter(([id, gap]) => stockIn(mine, id) > gap * 3)
      .sort((a, b) => b[1] - a[1])[0];
    const sellsToYou = wanted(state, state.home, need)
      .filter(([id, gap]) => stockIn(theirs, id) > gap * 3)
      .sort((a, b) => b[1] - a[1])[0];

    const found = sellsToYou
      ? { dir: 'sell', commodity: sellsToYou[0], gap: sellsToYou[1] }
      : wantsFromYou
        ? { dir: 'buy', commodity: wantsFromYou[0], gap: wantsFromYou[1] }
        : null;
    if (!found || pending.has(`${candidate}|${found.commodity}|${found.dir}`)) continue;
    from = candidate;
    pick = found;
  }
  if (!pick) return;

  // `dir` is written from THEIR side: 'sell' means they will supply you.
  const seller = pick.dir === 'sell' ? from : state.home;
  const buyer = pick.dir === 'sell' ? state.home : from;
  const qty = Math.max(1, Math.round(pick.gap * 2 * 10) / 10);
  const offer = {
    from,
    dir: pick.dir,
    commodity: pick.commodity,
    qty,
    every: 2,
    term: 120,
    price: quotePrice(state, seller, buyer, pick.commodity),
    tick: state.tick,
    // Wall clock, not ticks: an unanswered offer is declined in real time, the
    // same way an alert clears itself. See `pruneOffers`.
    at: Date.now(),
  };
  if (!canSignContract(state, { seller, buyer, commodity: offer.commodity, qty, every: 2, term: 120 }).ok) return;
  state.contractOffers.push(offer);
  pushAlert(state, `${COUNTRIES[from].name} proposes a supply contract — see the Trade tab.`, 'info');
}

// Everything a nation wants more of per tick, and how much: what its factories
// burn beyond what its ground yields, plus what its people are still short of
// after the private economy has done what it can.
function wanted(state, countryId, need) {
  const rows = { ...(need.get(countryId) ?? {}) };
  for (const id of COMMODITY_IDS) {
    const hungry = unmet(state, countryId, id);
    if (hungry > 0) rows[id] = (rows[id] ?? 0) + hungry;
  }
  return Object.entries(rows).filter(([, gap]) => gap > 0.2);
}

export function contractOfferLeft(state, offer) {
  return Math.max(0, CONFIG.contracts.ttl - (state.tick - offer.tick));
}

function money(value) {
  return value >= 1_000_000 ? `$${(value / 1_000_000).toFixed(2)}M` : `$${Math.round(value).toLocaleString('en-US')}`;
}

function noise(seed) {
  let a = (seed + 0x6d2b79f5) >>> 0;
  a = Math.imul(a ^ (a >>> 15), 1 | a);
  a = (a + Math.imul(a ^ (a >>> 7), 61 | a)) ^ a;
  return ((a ^ (a >>> 14)) >>> 0) / 4294967296;
}
