import { CONFIG } from '../core/config.js';
import { BUILDINGS } from '../data/buildings.js';
import { COMMODITIES, COMMODITY_IDS } from '../data/commodities.js';
import { COUNTRY_IDS } from '../data/countries.js';
import { haulShare } from '../data/geography.js';
import { canTrade, exportsFrom, importsTo, siteWages, recordFlow, warehouseUsed,
  isPlayer, noteLedger } from '../core/state.js';
import { unmet } from './domestic.js';

// World trade. Runs AFTER the home market, so every nation feeds its own people
// before it feeds anyone else's — a rule, not an accident of ordering.
//
// A deal is struck between the two local prices and splits the difference, so
// both sides come out ahead: the seller beats what it could get at home, the
// buyer pays less than its own shortage price. That is why trade happens at all,
// and it is why flooding your own market makes exporting the profitable move
// rather than a chore.
//
// Freight is real and scales with distance, so geography decides who your
// natural customers are. Selling Norwegian gas to Germany is nearly free;
// selling it to New Zealand is not.
//
// There are TWO kinds of buyer, and the difference is where the cargo ends up:
//
//   people   — bought against a nation's unmet appetite. It is eaten on
//              arrival: a pure cost that buys supply, and therefore growth.
//   industry — bought against what a nation's own factories burn and cannot
//              dig up. It lands in that nation's WAREHOUSES, so a country with
//              no coalfield can still run a steel mill on imported coal.
//
// Feedstock is capped at `CONFIG.trade.inputBuffer` ticks of consumption and at
// the depot space to put it in, so no treasury can corner a market in one tick,
// and it does not count toward the buyer's supply — its people never see it.
// `distribute` runs before `sellDomestic`, so those imports reach the factories
// that asked for them before they can be sold over the counter.
export function runTrade(state) {
  // Warehouse stock, payroll and what each nation's industry makes and burns
  // are indexed ONCE. Asking per country per commodity — the obvious way — is
  // forty-six times twenty-one scans of every building in the world, per tick.
  const stock = new Map();    // ownerId -> { commodityId: qty }
  const payroll = new Map();  // ownerId -> wages per tick
  const burns = new Map();    // ownerId -> { commodityId: units its factories eat per tick }
  const makes = new Map();    // ownerId -> { commodityId: units its factories turn out per tick }
  const space = new Map();    // ownerId -> free depot capacity
  for (const b of state.buildings) {
    payroll.set(b.owner, (payroll.get(b.owner) ?? 0) + siteWages(b));
    const def = BUILDINGS[b.type];
    if (!b.store) {
      const recipe = def.recipe;
      if (!recipe) continue;
      for (const [id, qty] of Object.entries(recipe.in)) bump(burns, b.owner, id, qty / recipe.ticks);
      for (const [id, qty] of Object.entries(recipe.out)) bump(makes, b.owner, id, qty / recipe.ticks);
      continue;
    }
    space.set(b.owner, (space.get(b.owner) ?? 0) + Math.max(0, def.capacity - warehouseUsed(b)));
    let held = stock.get(b.owner);
    if (!held) { held = {}; stock.set(b.owner, held); }
    for (const id of COMMODITY_IDS) {
      const qty = b.store[id] ?? 0;
      if (qty > 0) held[id] = (held[id] ?? 0) + qty;
    }
  }

  const earned = {};
  const spent = {};
  for (const id of COUNTRY_IDS) { earned[id] = 0; spent[id] = 0; }

  const world = { stock, payroll, burns, makes, space, earned, spent };
  for (const id of COMMODITY_IDS) settle(state, id, world);

  for (const id of COUNTRY_IDS) {
    const country = state.countries[id];
    country.report.exports = Math.round(earned[id]);
    country.report.imports = Math.round(spent[id]);
    country.cash += country.report.exports - country.report.imports;
  }
}

function bump(index, ownerId, commodityId, qty) {
  let row = index.get(ownerId);
  if (!row) { row = {}; index.set(ownerId, row); }
  row[commodityId] = (row[commodityId] ?? 0) + qty;
}

function settle(state, commodityId, world) {
  const { stock, payroll, burns, makes, space, earned, spent } = world;
  const def = COMMODITIES[commodityId];

  const sellers = [];
  for (const id of COUNTRY_IDS) {
    if (!exportsFrom(state, id, commodityId)) continue;
    const surplus = stock.get(id)?.[commodityId] ?? 0;
    if (surplus > 0) sellers.push({ id, price: state.markets[id][commodityId].price, surplus });
  }
  if (!sellers.length) return;

  // A treasury will not spend its payroll on groceries, whichever kind of buyer
  // it is being.
  const budgetFor = (id) => state.countries[id].cash - spent[id]
    - (payroll.get(id) ?? 0) * CONFIG.trade.reserveTicks;

  const people = [];
  const industry = [];
  for (const id of COUNTRY_IDS) {
    if (!importsTo(state, id, commodityId)) continue;
    const budget = budgetFor(id);
    if (budget <= 0) continue;
    const price = state.markets[id][commodityId].price;

    const hunger = unmet(state, id, commodityId) * CONFIG.trade.maxFill;
    if (hunger > 0) people.push({ id, price, need: hunger, kind: 'people' });

    // What its own factories burn beyond what its own mines and fields turn
    // out. This is the whole answer to "my country has no coal": the deficit is
    // real, so somebody is paid to cover it.
    const deficit = (burns.get(id)?.[commodityId] ?? 0) - (makes.get(id)?.[commodityId] ?? 0);
    if (deficit <= 0) continue;
    const held = stock.get(id)?.[commodityId] ?? 0;
    const wanted = Math.min(deficit * CONFIG.trade.inputBuffer - held, space.get(id) ?? 0);
    if (wanted > 0) industry.push({ id, price, need: wanted, kind: 'industry' });
  }

  // One queue, not two. The nation paying most is served first — and a factory
  // bids at its own country's local price exactly as that country's people do,
  // so industry competes for a cargo rather than waiting behind every
  // population on earth. Running the world's people first was the same thing as
  // never importing feedstock at all: with `selfSufficiency` under 1 there is
  // always somebody hungry, and the surplus never reached a factory floor.
  //
  // Within ONE country, its people still come first on the tie — which is the
  // same rule that puts `domestic` before `trade` in the pipeline.
  const buyers = [...people, ...industry];
  buyers.sort((a, b) => (b.price - a.price) || rank(a) - rank(b));
  for (const buyer of buyers) match(state, commodityId, def, buyer, sellers, world, budgetFor(buyer.id));
}

function rank(buyer) {
  return buyer.kind === 'people' ? 0 : 1;
}

function match(state, commodityId, def, buyer, sellers, world, startingBudget) {
  const { stock, space, earned, spent } = world;
  let budget = startingBudget;
  if (budget <= 0) return;

  const ranked = sellers
    .filter((s) => canTrade(state, s.id, buyer.id))
    .map((s) => ({ seller: s, freight: def.basePrice * CONFIG.trade.freight * haulShare(s.id, buyer.id) }))
    .sort((a, b) => (a.seller.price + a.freight) - (b.seller.price + b.freight));

  for (const { seller, freight } of ranked) {
    if (buyer.need <= 0 || budget <= 0) break;
    if (seller.surplus <= 0) continue;

    // For people, the gap has to cover the haul and still leave something worth
    // the paperwork. A factory buying its own feedstock has no such luxury —
    // it is short either way — so it will pay up to its own local price.
    const gain = buyer.price - seller.price - freight;
    const floor = buyer.kind === 'industry' ? 0 : def.basePrice * CONFIG.trade.minGain;
    if (gain < floor) continue;

    const deal = seller.price + (buyer.price - seller.price) * CONFIG.trade.split;
    const unitCost = deal + freight;
    if (unitCost <= 0) continue;
    let qty = Math.min(seller.surplus, buyer.need, budget / unitCost);
    if (qty <= 0) continue;

    // Feedstock has to physically fit in a depot, so the cargo is trimmed to
    // what is actually put away rather than billed for what was ordered.
    if (buyer.kind === 'industry') {
      qty = deliverToWarehouses(state, buyer.id, commodityId, qty);
      if (qty <= 0) continue;
      space.set(buyer.id, Math.max(0, (space.get(buyer.id) ?? 0) - qty));
      bumpStock(stock, buyer.id, commodityId, qty);
    }

    const proceeds = qty * deal;
    const outlay = qty * unitCost;

    drawFromWarehouses(state, seller.id, commodityId, qty);
    seller.surplus -= qty;
    stock.get(seller.id)[commodityId] = seller.surplus;

    buyer.need -= qty;
    budget -= outlay;

    earned[seller.id] += proceeds;
    spent[buyer.id] += outlay;
    // Only what a population actually eats counts toward its supply. Feedstock
    // is on its way to a factory floor, and counting it would tell a nation its
    // people were fed by coal.
    if (buyer.kind === 'people') state.markets[buyer.id][commodityId].importedLastTick += qty;

    book(state, commodityId, buyer, seller, qty, proceeds, outlay);

    recordFlow(state, {
      tick: state.tick,
      from: seller.id,
      to: buyer.id,
      commodity: commodityId,
      kind: buyer.kind,
      qty: Math.round(qty * 10) / 10,
      value: Math.round(proceeds),
    });
  }
}

// Your own side of a deal, in units and in money, for the Goods tab.
function book(state, commodityId, buyer, seller, qty, proceeds, outlay) {
  if (isPlayer(state, seller.id)) {
    noteLedger(state, commodityId, 'exported', qty);
    noteLedger(state, commodityId, 'earned', proceeds);
  }
  if (isPlayer(state, buyer.id)) {
    noteLedger(state, commodityId, 'imported', qty);
    noteLedger(state, commodityId, 'paid', outlay);
    if (buyer.kind === 'industry') noteLedger(state, commodityId, 'feedstock', qty);
  }
}

function bumpStock(stock, ownerId, commodityId, qty) {
  let held = stock.get(ownerId);
  if (!held) { held = {}; stock.set(ownerId, held); }
  held[commodityId] = (held[commodityId] ?? 0) + qty;
}

// Cargo leaves the warehouses that hold it. Which one is arbitrary, so the
// first ones found are drained in order — deterministic because
// `state.buildings` is only ever appended to.
function drawFromWarehouses(state, ownerId, commodityId, qty) {
  let left = qty;
  for (const b of state.buildings) {
    if (left <= 0) break;
    if (b.owner !== ownerId || !b.store) continue;
    const held = b.store[commodityId] ?? 0;
    if (held <= 0) continue;
    const taken = Math.min(held, left);
    b.store[commodityId] = held - taken;
    left -= taken;
  }
  return qty - left;
}

// ...and imported feedstock arrives in them, which is the whole point of the
// industrial channel: goods a nation cannot dig up become goods its factories
// can draw on next tick. Returns what actually fitted.
function deliverToWarehouses(state, ownerId, commodityId, qty) {
  let left = qty;
  for (const b of state.buildings) {
    if (left <= 0) break;
    if (b.owner !== ownerId || !b.store) continue;
    const free = BUILDINGS[b.type].capacity - warehouseUsed(b);
    if (free <= 0) continue;
    const put = Math.min(free, left);
    b.store[commodityId] = (b.store[commodityId] ?? 0) + put;
    left -= put;
  }
  return qty - left;
}
