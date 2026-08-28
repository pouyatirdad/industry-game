import { CONFIG } from '../core/config.js';
import { COMMODITIES, COMMODITY_IDS } from '../data/commodities.js';
import { COUNTRY_IDS } from '../data/countries.js';
import { haulShare } from '../data/geography.js';
import { BUILDINGS } from '../data/buildings.js';
import { allOwners, exchangeOf, exportsFrom, importsTo, isPlayer, ownerName, pushAlert,
  siteWages } from '../core/state.js';
import { depotsByOwner, spaceIn, stockIn } from './logistics.js';
import { signContract } from './contracts.js';
import { unmet } from './domestic.js';

// THE GLOBAL EXCHANGE.
//
// Every nation may deal with every other — there is no permission to buy and no
// closed market. What there is instead is the problem of FINDING somebody: a
// nation with four hundred tonnes of coal and no customer, and a nation three
// continents away whose steel mill is idle for want of it, have no way to know
// about each other.
//
// So they post. A surplus is an ASK, a shortage is a BID, and both sit on one
// open book that everybody — you included — can read and take. When a bid and an
// ask cross, the exchange pairs them and the pair becomes a CONTRACT, which is
// the only way goods move in this game.
//
// Three consequences worth stating plainly:
//
//  * Nothing here is a separate economy. A match is a contract exactly like one
//    you wrote by hand, settled by `runContracts` in the same pass, with the
//    same penalties if either side fails. `signContract` is still the only way
//    one comes into being.
//  * The house takes a cut of both sides (`CONFIG.exchange.fee`) and it goes
//    somewhere: `exchange.fund`. That fund is what nations borrow against when
//    they cannot make payroll, so the clearing fee is the thing that stops a bad
//    decade from being permanent.
//  * A listing is public. You can take a government's ask before another
//    government does, which is the whole reason to keep the book on screen.
export function runExchange(state) {
  const book = exchangeOf(state);

  // Withdraw what has stood too long or been emptied. A listing whose owner has
  // gone insolvent goes with them: a promise they cannot keep is worse than no
  // promise at all.
  book.listings = book.listings.filter((l) => state.tick - l.tick < CONFIG.exchange.ttl
    && l.qty > 0.05
    && state.countries[l.from]?.solvent);

  if (state.tick % CONFIG.exchange.post === 0) postListings(state);
  matchBook(state);
}

// --- posting ---------------------------------------------------------------

// What every government puts on the book this round. A nation posts what it
// cannot place at home and bids for what it cannot dig up — the same two figures
// the old spot market used, except that now they are visible and somebody has to
// actually take them.
function postListings(state) {
  const book = exchangeOf(state);
  const depots = depotsByOwner(state);
  const flows = industryFlows(state);

  for (const id of COUNTRY_IDS) {
    const gov = state.countries[id];
    if (!gov.solvent) continue;

    if (book.listings.length >= CONFIG.exchange.maxListings) return;
    const own = book.listings.filter((l) => l.from === id);
    const posted = new Set(own.map((l) => `${l.side}|${l.commodity}`));
    const held = depots.get(id) ?? [];

    // Asks and bids have SEPARATE budgets. Sharing one cap looked tidier and
    // quietly broke the market: a nation short of a few things filled its
    // allowance with bids, never offered its own surplus again, and the world
    // ended up with warehouses full of coal and nobody selling any.
    const { asksPerNation, bidsPerNation, asksPerRound, bidsPerRound } = CONFIG.exchange;
    const asks = own.reduce((n, l) => n + (l.side === 'sell' ? 1 : 0), 0);
    const bids = own.length - asks;

    const askRoom = Math.min(asksPerRound, asksPerNation - asks);
    for (const ask of topAsks(state, id, held, flows, posted, askRoom)) post(state, ask);

    const bidRoom = Math.min(bidsPerRound, bidsPerNation - bids);
    for (const bid of topBids(state, id, flows, posted, depots, bidRoom)) post(state, bid);
  }
}

// The commodity a nation is most obviously long of: standing in its depots, past
// what its own people will eat and its own factories will burn.
//
// Your OWN government posts through this too, and the ↗ flag in Prices is what
// says whether it may: leave it on and your surplus finds a buyer without you,
// turn it off and that commodity is yours to place by hand. `exportsFrom` is
// already true for every other nation, so this one call covers both.
function topAsks(state, id, held, flows, posted, room) {
  if (room <= 0) return [];
  const offers = [];
  for (const commodityId of COMMODITY_IDS) {
    if (posted.has(`sell|${commodityId}`)) continue;
    if (!exportsFrom(state, id, commodityId)) continue;
    const stock = stockIn(held, commodityId);
    if (stock <= 0) continue;
    // What it will need itself before it sells anything: its own unmet appetite
    // and several ticks of whatever its factories burn.
    const keep = unmet(state, id, commodityId)
      + (flows.burns.get(id)?.[commodityId] ?? 0) * CONFIG.trade.inputBuffer;
    const spare = stock - keep;
    if (spare < 1) continue;
    // Already promised away? Then it is not spare. A nation that ignored its own
    // standing contracts kept offering the same tonne to everybody.
    const promised = promisedBy(state, id, commodityId);
    const free = spare - promised * CONFIG.contracts.maxTerm;
    if (free < 1) continue;
    offers.push({
      // How badly it is drowning in the stuff, weighted by how widely the world
      // eats it — not by what it is worth, which would leave every cheap bulk
      // commodity unoffered for ever.
      glut: free * COMMODITIES[commodityId].demandShare,
      listing: {
        from: id, side: 'sell', commodity: commodityId,
        // Offered as a rate, because a contract is a rate: this empties the
        // shelf over the term without promising away what has not been dug yet.
        qty: Math.round((free / 8) * 10) / 10,
        price: askPrice(state, id, commodityId),
      },
    });
  }
  return offers.sort((a, b) => b.glut - a.glut).slice(0, room).map((row) => row.listing);
}

// What this nation has already promised to deliver per tick, contracted or
// posted. The mirror of `coveredBy` on the selling side.
function promisedBy(state, countryId, commodityId) {
  let rate = 0;
  for (const c of state.contracts ?? []) {
    if (c.seller === countryId && c.commodity === commodityId) rate += c.qty / c.every;
  }
  for (const l of exchangeOf(state).listings) {
    if (l.from === countryId && l.side === 'sell' && l.commodity === commodityId) rate += l.qty;
  }
  return rate;
}

// ...and the one it is most obviously short of, counting mouths and factory
// floors together. This is the channel that feeds a steel mill in a country
// with no coalfield, so it is the one that has to work.
function topBids(state, id, flows, posted, depots, room) {
  if (room <= 0) return [];
  const space = spaceIn(depots.get(id) ?? []);
  if (space < 1) return [];
  const payroll = flows.payroll.get(id) ?? 0;
  const budget = state.countries[id].cash - payroll * CONFIG.trade.reserveTicks;
  if (budget <= 0) return [];

  const wanted = [];
  for (const commodityId of COMMODITY_IDS) {
    if (posted.has(`buy|${commodityId}`)) continue;
    // ...and the ↙ flag is the same switch on the buying side.
    if (!importsTo(state, id, commodityId)) continue;
    const deficit = (flows.burns.get(id)?.[commodityId] ?? 0) - (flows.makes.get(id)?.[commodityId] ?? 0);
    const hungry = unmet(state, id, commodityId);
    const want = Math.max(0, deficit) + hungry * CONFIG.trade.maxFill;
    if (want < 0.2) continue;
    // Already covered by something standing? Then it is not short of it.
    const gap = want - coveredBy(state, id, commodityId);
    if (gap < 0.2) continue;

    // Urgency is about NEED, not about price. Scoring it by what the cargo is
    // worth was a quiet disaster: every nation on earth spent its listings
    // bidding for aircraft and semiconductors it had no chance of being sold,
    // while the coal its own power stations were idle for never got asked for
    // at all. A shortage that idles a factory outranks everything, and after
    // that it is simply how much of the diet is missing.
    const industrial = deficit > 0;
    const urgency = (industrial ? 1000 : 0) + gap * COMMODITIES[commodityId].demandShare;
    wanted.push({
      urgency,
      listing: {
        from: id, side: 'buy', commodity: commodityId,
        qty: Math.round(gap * 10) / 10,
        price: bidPrice(state, id, commodityId, industrial),
      },
    });
  }
  return wanted
    .sort((a, b) => b.urgency - a.urgency)
    .slice(0, room)
    .map((row) => row.listing);
}

// What a standing contract and an open listing already promise this nation per
// tick. Without this a government re-bids for coal it has already contracted
// for, every posting round, until it is buying six times what it burns.
//
// A contract about to run out does NOT count, though. Counting one right up to
// its last tick meant a nation only started looking for a replacement after the
// old one had lapsed — so every supply arrived in bursts with a starved gap
// between them, and its plants ran at two thirds for ever.
function coveredBy(state, countryId, commodityId) {
  let rate = 0;
  for (const c of state.contracts ?? []) {
    if (c.buyer !== countryId || c.commodity !== commodityId) continue;
    if (c.started + c.term - state.tick <= CONFIG.exchange.renewWithin) continue;
    rate += c.qty / c.every;
  }
  for (const l of exchangeOf(state).listings) {
    if (l.from === countryId && l.side === 'buy' && l.commodity === commodityId) rate += l.qty;
  }
  return rate;
}

// A seller asks a little over what its own market pays, because at home it can
// only sell what its own people eat; a buyer bids a little over its own price,
// because the alternative is a plant standing idle on full wages. Both are
// bounded, so the book cannot run away from the base price.
function askPrice(state, id, commodityId) {
  const local = state.markets[id][commodityId].price;
  return round2(Math.max(local, COMMODITIES[commodityId].basePrice * CONFIG.price.floor) * 1.02);
}

function bidPrice(state, id, commodityId, forIndustry) {
  const local = state.markets[id][commodityId].price;
  const premium = forIndustry ? CONFIG.trade.feedstockPremium : 0.05;
  const ceiling = COMMODITIES[commodityId].basePrice * CONFIG.exchange.maxCross;
  return round2(Math.min(ceiling, local * (1 + premium)));
}

// The terms this nation's own government would have posted, for one commodity
// on one side — the same two figures `topAsks` and `topBids` work out for
// everybody else, handed to YOU as a draft. It decides nothing: the form is
// filled in and you still have to post it.
//
// It is here rather than in the panel because it is the governments' own
// arithmetic, and a second copy of it in the UI would drift from this one the
// first time either was tuned.
export function suggestListing(state, countryId, side, commodityId) {
  const flows = industryFlows(state);
  const depots = depotsByOwner(state);
  const burns = flows.burns.get(countryId)?.[commodityId] ?? 0;

  if (side === 'sell') {
    const stock = stockIn(depots.get(countryId) ?? [], commodityId);
    const keep = unmet(state, countryId, commodityId) + burns * CONFIG.trade.inputBuffer;
    const free = stock - keep - promisedBy(state, countryId, commodityId) * CONFIG.trade.inputBuffer;
    return {
      // Offered as a rate, like a government's own ask: this empties the shelf
      // over the term rather than promising away what has not been dug yet.
      qty: rate(free / 8),
      price: askPrice(state, countryId, commodityId),
    };
  }

  const deficit = burns - (flows.makes.get(countryId)?.[commodityId] ?? 0);
  const want = Math.max(0, deficit) + unmet(state, countryId, commodityId) * CONFIG.trade.maxFill;
  return {
    qty: rate(want - coveredBy(state, countryId, commodityId)),
    price: bidPrice(state, countryId, commodityId, deficit > 0),
  };
}

// A suggestion is a form to be posted, so it is never zero: a blank quantity is
// the one thing that stops the form being usable at all.
function rate(value) {
  return Math.max(0.1, Math.round(value * 10) / 10);
}

export function post(state, listing) {
  const book = exchangeOf(state);
  const row = {
    id: book.nextListingId++,
    from: listing.from,
    side: listing.side,
    commodity: listing.commodity,
    qty: Math.max(0, Number(listing.qty) || 0),
    price: Math.max(0, Number(listing.price) || 0),
    every: listing.every ?? CONFIG.exchange.every,
    term: listing.term ?? CONFIG.exchange.term,
    tick: state.tick,
  };
  if (row.qty <= 0 || row.price <= 0) return { ok: false, reason: 'A listing needs a quantity and a price.' };
  book.listings.push(row);
  return { ok: true, listing: row };
}

export function withdraw(state, listingId) {
  const book = exchangeOf(state);
  const before = book.listings.length;
  book.listings = book.listings.filter((l) => l.id !== listingId);
  return { ok: book.listings.length !== before };
}

// --- matching --------------------------------------------------------------

// One pass per commodity: bids sorted by what they will pay, asks by what they
// want plus the freight to get there. A pair crosses when the buyer's price
// covers the seller's plus the haul plus both halves of the clearing fee — and
// the contract that results is priced in the middle, so both sides gain, exactly
// as a spot deal used to.
function matchBook(state) {
  const book = exchangeOf(state);
  if (!book.listings.length) return;
  const depots = depotsByOwner(state);

  const byCommodity = new Map();
  for (const l of book.listings) {
    let row = byCommodity.get(l.commodity);
    if (!row) { row = { buy: [], sell: [] }; byCommodity.set(l.commodity, row); }
    row[l.side].push(l);
  }

  for (const [commodityId, row] of byCommodity) {
    if (!row.buy.length || !row.sell.length) continue;
    const def = COMMODITIES[commodityId];
    row.buy.sort((a, b) => b.price - a.price);

    for (const bid of row.buy) {
      if (bid.qty <= 0.05) continue;
      const ranked = row.sell
        .filter((ask) => ask.qty > 0.05 && ask.from !== bid.from)
        .map((ask) => ({ ask, freight: def.basePrice * CONFIG.trade.freight * haulShare(ask.from, bid.from) }))
        .sort((a, b) => (a.ask.price + a.freight) - (b.ask.price + b.freight));

      for (const { ask, freight } of ranked) {
        if (bid.qty <= 0.05) break;
        const fee = (ask.price + bid.price) * 0.5 * CONFIG.exchange.fee;
        if (bid.price < ask.price + freight + fee * 2) continue;
        const qty = Math.round(Math.min(bid.qty, ask.qty) * 10) / 10;
        if (qty <= 0.05) continue;
        // The exchange writes promises automatically, so it is stricter than a
        // hand-written contract: do not fill a buyer's warehouse with deals it
        // has nowhere to stage. Manual contracts may still over-commit because
        // that is a deliberate player choice with penalties attached.
        if (spaceIn(depots.get(bid.from) ?? []) < qty * CONFIG.trade.inputBuffer) continue;
        // Split the difference, exactly as a spot deal did. The buyer beats its
        // own shortage price and the seller beats what it could get at home.
        const price = round2(ask.price + (bid.price - ask.price) * CONFIG.trade.split);
        const term = Math.min(bid.term, ask.term);

        const signed = signContract(state, {
          seller: ask.from, buyer: bid.from, commodity: commodityId,
          qty, every: Math.max(bid.every, ask.every), term, price,
          // The cut is charged on every settlement of a contract that came off
          // the book — which is what fills the fund that nations borrow from.
          viaExchange: true,
        });
        if (!signed.ok) continue;

        bid.qty = round2(bid.qty - qty);
        ask.qty = round2(ask.qty - qty);
        announce(state, signed.contract);
      }
    }
  }

  book.listings = book.listings.filter((l) => l.qty > 0.05);
}

function announce(state, c) {
  if (!isPlayer(state, c.seller) && !isPlayer(state, c.buyer)) return;
  const out = isPlayer(state, c.seller);
  pushAlert(state, `Exchange matched your ${out ? 'ask' : 'bid'} — ${c.qty} ${COMMODITIES[c.commodity].name}/${c.every}t ${out ? 'to' : 'from'} ${ownerName(out ? c.buyer : c.seller)}.`, 'good');
}

// --- taking a listing by hand ---------------------------------------------

export function canTake(state, listingId, byId = state.home) {
  const listing = exchangeOf(state).listings.find((l) => l.id === listingId);
  if (!listing) return { ok: false, reason: 'That listing has gone.' };
  if (listing.from === byId) return { ok: false, reason: 'That is your own listing.' };
  return { ok: true, listing };
}

// Taking somebody's ask or bid off the book, at their price. You pay the posted
// price rather than the midpoint — you are the one accepting terms — and the
// house takes its cut of the settlements exactly as it would on a match.
export function takeListing(state, listingId, byId = state.home) {
  const check = canTake(state, listingId, byId);
  if (!check.ok) return check;
  const { listing } = check;
  const selling = listing.side === 'buy';   // they want to buy, so you sell
  const signed = signContract(state, {
    seller: selling ? byId : listing.from,
    buyer: selling ? listing.from : byId,
    commodity: listing.commodity,
    qty: listing.qty,
    every: listing.every,
    term: listing.term,
    price: listing.price,
    viaExchange: true,
  });
  if (!signed.ok) return signed;
  withdraw(state, listingId);
  return signed;
}

// --- lending ---------------------------------------------------------------

// The clearing fund does something. A government that cannot make payroll used
// to close its most expensive plant and keep closing them; now it can borrow
// against the fees the world's trade has paid in, and work its way back.
//
// It is a real debt: interest accrues every tick and repayment comes out of the
// tax base, so a nation that borrows to build is spending next decade's budget.
export function runLending(state) {
  const book = exchangeOf(state);
  const { interest, repay, ticksOfPayroll } = CONFIG.exchange.loan;
  const payroll = new Map();
  for (const b of state.buildings) payroll.set(b.owner, (payroll.get(b.owner) ?? 0) + siteWages(b));

  for (const owner of allOwners(state)) {
    owner.report.interest = 0;
    owner.report.repaid = 0;
    const debt = owner.debt ?? 0;

    if (debt > 0) {
      const due = debt * interest;
      owner.cash -= due;
      owner.report.interest = due;
      book.fund += due;

      // Repayment is a share of the tax base, so it scales with the economy and
      // a small nation is never crushed by a balance a big one could carry.
      const instalment = Math.min(debt, Math.max(0, owner.report.tax * repay), Math.max(0, owner.cash));
      if (instalment > 0) {
        owner.cash -= instalment;
        owner.debt = debt - instalment;
        owner.report.repaid = instalment;
        book.fund += instalment;
        book.lent = Math.max(0, book.lent - instalment);
      }
    }

    // A government asks when it is about to miss payroll. You never do: your own
    // borrowing is a button, not a policy the engine applies for you.
    if (isPlayer(state, owner.id)) continue;
    const wages = payroll.get(owner.id) ?? 0;
    if (wages <= 0) continue;
    if (owner.cash >= wages * CONFIG.trade.reserveTicks) continue;
    borrow(state, owner.id, wages * ticksOfPayroll);
  }

}

// What a nation could still draw, in money. Bounded by its own tax base — a
// balance it cannot service is a default waiting to happen — and by what the
// fund actually holds.
export function borrowLimit(state, countryId) {
  const book = exchangeOf(state);
  const gov = state.countries[countryId];
  if (!gov) return 0;
  const { maxDebt, maxShare } = CONFIG.exchange.loan;
  const ceiling = Math.max(0, gov.report.tax * maxDebt - (gov.debt ?? 0));
  const available = Math.max(0, book.fund * maxShare);
  return Math.floor(Math.min(ceiling, available));
}

export function borrow(state, countryId, wanted) {
  const book = exchangeOf(state);
  const gov = state.countries[countryId];
  const amount = Math.floor(Math.min(Math.max(0, wanted), borrowLimit(state, countryId)));
  if (amount <= 0) {
    return { ok: false, reason: book.fund <= 0
      ? 'The clearing fund is empty — it fills from the fee on every settlement.'
      : 'You are already carrying as much as your tax base will service.' };
  }
  gov.debt = (gov.debt ?? 0) + amount;
  gov.cash += amount;
  book.fund -= amount;
  book.lent += amount;
  if (isPlayer(state, countryId)) {
    pushAlert(state, `Borrowed ${money(amount)} from the clearing fund. Interest accrues every tick.`, 'info');
  }
  return { ok: true, amount };
}

export function repay(state, countryId, wanted) {
  const book = exchangeOf(state);
  const gov = state.countries[countryId];
  const amount = Math.floor(Math.min(Math.max(0, wanted), gov.debt ?? 0, Math.max(0, gov.cash)));
  if (amount <= 0) return { ok: false, reason: 'Nothing to repay, or nothing to repay it with.' };
  gov.debt -= amount;
  gov.cash -= amount;
  book.fund += amount;
  book.lent = Math.max(0, book.lent - amount);
  if (isPlayer(state, countryId)) pushAlert(state, `Repaid ${money(amount)} to the clearing fund.`, 'good');
  return { ok: true, amount };
}

// --- shared indexes --------------------------------------------------------

// What the world's factories burn and turn out, and what its payroll is, in one
// pass. Posting asks this for every nation, so it cannot be asked per nation.
function industryFlows(state) {
  const burns = new Map();
  const makes = new Map();
  const payroll = new Map();
  for (const b of state.buildings) {
    payroll.set(b.owner, (payroll.get(b.owner) ?? 0) + siteWages(b));
    const recipe = BUILDINGS[b.type].recipe;
    if (!recipe) continue;
    for (const [id, qty] of Object.entries(recipe.in)) bump(burns, b.owner, id, qty / recipe.ticks);
    for (const [id, qty] of Object.entries(recipe.out)) bump(makes, b.owner, id, qty / recipe.ticks);
  }
  return { burns, makes, payroll };
}

function bump(index, ownerId, commodityId, qty) {
  let row = index.get(ownerId);
  if (!row) { row = {}; index.set(ownerId, row); }
  row[commodityId] = (row[commodityId] ?? 0) + qty;
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

// Systems cannot import the UI's formatter, and a bare 42000 in a message reads
// as a quantity of goods rather than a price.
function money(value) {
  return value >= 1_000_000 ? `$${(value / 1_000_000).toFixed(2)}M` : `$${Math.round(value).toLocaleString('en-US')}`;
}
