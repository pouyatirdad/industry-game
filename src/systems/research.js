import { CONFIG } from '../core/config.js';
import { BUILDINGS, BUILDING_IDS } from '../data/buildings.js';
import { COUNTRIES, COUNTRY_IDS } from '../data/countries.js';
import { TECHS, availableTechs, techChain } from '../data/technology.js';
import { allOwners, isPlayer, knowsTech, learnTech, pushAlert, canTrade,
  techDeclinedRecently } from '../core/state.js';

// Technology. Every industry past coal, iron, stone, timber and food is locked
// behind a tech, for you and for the other forty-five alike — so what a nation
// can build is a decision it made forty ticks ago rather than a property of its
// map. Nothing here is special-cased for the player.
//
// A government turns treasury into research at a fixed rate, funded as a share
// of its tax base. That has one consequence worth stating plainly: a big
// economy climbs faster than a small one, for the same reason it does in life.
// The small one's route to the top is to LICENCE what somebody else already
// worked out (`runTechTrade` below) — which is why being first up the tree is
// worth money as well as industry.
export function runResearch(state) {
  for (const owner of allOwners(state)) {
    if (!owner.techs) owner.techs = {};
    owner.report.research = 0;

    // A government with nothing on the bench picks its next subject; you pick
    // your own, and a player who has picked nothing spends nothing.
    if (!owner.researching && !isPlayer(state, owner.id)) {
      owner.researching = chooseTech(state, owner.id);
    }
    const target = TECHS[owner.researching];
    if (!target) { owner.researching = null; continue; }

    const share = clampShare(owner.researchShare);
    const spend = Math.min(owner.report.tax * share, Math.max(0, owner.cash));
    if (spend <= 0) continue;

    owner.cash -= spend;
    owner.report.research = Math.round(spend);
    owner.research = (owner.research ?? 0) + spend / CONFIG.research.costPerPoint;

    if (owner.research < target.cost) continue;
    // The overflow carries into the next subject rather than being thrown away,
    // so a nation that funds a big programme is not quietly taxed for finishing
    // early.
    const done = owner.researching;
    owner.research -= target.cost;
    owner.researching = null;
    learnTech(state, owner.id, done);
    if (isPlayer(state, owner.id)) {
      pushAlert(state, `${target.name} completed — ${unlockNames(done) || 'no new industry'} now buildable.`, 'good');
    }
  }
}

export function clampShare(share) {
  const value = Number.isFinite(share) ? share : CONFIG.research.share;
  return Math.min(CONFIG.research.maxShare, Math.max(0, value));
}

// What a government studies next. It prefers a tech that unlocks something it
// could actually site and feed — a landlocked nation does not fund offshore
// extraction — and falls back to the cheapest thing it can start, so no nation
// ever sits idle at the bottom of the tree.
function chooseTech(state, countryId) {
  const options = availableTechs(state.countries[countryId].techs ?? {});
  if (!options.length) return null;
  const deposits = depositsOf(state, countryId);
  let best = null;
  for (const id of options) {
    const useful = unlocksFor(id).some((type) => {
      const def = BUILDINGS[type];
      // Extraction is worth learning only where the ground carries it.
      if (def.recipe && !Object.keys(def.recipe.in).length) {
        return def.terrain.some((t) => deposits.has(t));
      }
      return true;
    });
    // Cheap and useful beats dear and useful beats useless.
    const score = (useful ? 1_000_000 : 0) - TECHS[id].cost;
    if (!best || score > best.score) best = { id, score };
  }
  return best?.id ?? options[0];
}

const unlockIndex = (() => {
  const out = {};
  for (const type of BUILDING_IDS) {
    const tech = BUILDINGS[type].tech;
    if (!tech) continue;
    (out[tech] ??= []).push(type);
  }
  return out;
})();

export function unlocksFor(techId) {
  return unlockIndex[techId] ?? [];
}

function unlockNames(techId) {
  return unlocksFor(techId).map((type) => BUILDINGS[type].name).join(', ');
}

// Which resource terrains a nation actually holds. Built for every country in
// ONE pass and cached against the tile array, because nothing in the game
// mutates terrain or ownership after generation — the same guarantee that lets
// the save omit tiles entirely. Asking per country was a scan of 180,000 tiles
// every time any government finished a subject.
const depositCache = new WeakMap();
function depositsOf(state, countryId) {
  let index = depositCache.get(state.tiles);
  if (!index) {
    index = new Map();
    for (const tile of state.tiles) {
      if (!tile.countryId) continue;
      let found = index.get(tile.countryId);
      if (!found) { found = new Set(); index.set(tile.countryId, found); }
      found.add(tile.terrain);
    }
    depositCache.set(state.tiles, index);
  }
  return index.get(countryId) ?? new Set();
}

// --- licensing ------------------------------------------------------------

// What it costs to buy a tech off somebody who has it. Everything upstream the
// buyer still lacks comes with it — you cannot licence a semiconductor fab to a
// nation that has never refined a barrel — so the quote is for the whole
// missing branch, marked up because the buyer is paying for time.
export function licenceCost(state, buyerId, techId) {
  const known = state.countries[buyerId]?.techs ?? {};
  const points = techChain(known, techId).reduce((sum, id) => sum + (TECHS[id]?.cost ?? 0), 0);
  return Math.round(points * CONFIG.research.costPerPoint * CONFIG.techTrade.markup);
}

// Who could sell you a tech: a nation that holds it and that you have a pact
// with. Nearest first, because the list is read as "who do I ask".
export function sellersOf(state, buyerId, techId) {
  return COUNTRY_IDS.filter((id) => id !== buyerId
    && knowsTech(state, id, techId)
    && canTrade(state, buyerId, id));
}

// The world licenses among itself, and comes to you with offers.
//
// Without the first half of this, the forty-five would each climb their own
// tree from the bottom and the poor ones would never arrive; without the
// second, being behind would be a problem with no answer but time.
export function runTechTrade(state) {
  if (!state.techOffers) state.techOffers = [];
  state.techOffers = state.techOffers.filter((offer) => state.tick - offer.tick < CONFIG.techTrade.ttl
    && !knowsTech(state, state.home, offer.tech));

  if (state.tick % CONFIG.techTrade.every !== 0) return;

  licenseAmongTheWorld(state);
  if (CONFIG.techTrade.unsolicitedToPlayer) offerToPlayer(state);
}

// A government that can afford a licence for something it could otherwise be
// years researching simply buys it, from the nearest holder it trades with.
// One nation per decision tick, picked by the same reproducible roll the rest
// of the diplomacy uses — so a save replayed sees the same transfers.
function licenseAmongTheWorld(state) {
  const roll = noise(state.seed ^ Math.imul(state.tick + 7, 0x85ebca6b));
  const others = COUNTRY_IDS.filter((id) => id !== state.home);
  const buyerId = others[Math.floor(roll * others.length)];
  const buyer = state.countries[buyerId];
  if (!buyer?.solvent) return;

  for (const techId of availableTechs(buyer.techs ?? {})) {
    const cost = licenceCost(state, buyerId, techId);
    // It keeps a treasury after buying, or the licence bankrupts it before the
    // first plant it unlocks is standing.
    if (buyer.cash < cost * 3) continue;
    const holder = COUNTRY_IDS.find((id) => id !== buyerId && knowsTech(state, id, techId));
    if (!holder) continue;
    buyer.cash -= cost;
    state.countries[holder].cash += cost;
    for (const id of techChain(buyer.techs ?? {}, techId)) learnTech(state, buyerId, id);
    return;
  }
}

// ...and one of them comes to you. It is offering, so it quotes what it would
// charge anybody — the decision is whether the time is worth the money.
function offerToPlayer(state) {
  if (state.techOffers.length >= CONFIG.techTrade.maxPending) return;
  const home = state.countries[state.home];
  const pending = new Set(state.techOffers.map((o) => o.tech));

  // Anything you have turned down lately is off the table. Being asked the
  // same question every thirty ticks is what makes an inbox worth ignoring.
  const wanted = availableTechs(home.techs ?? {})
    .filter((id) => !pending.has(id) && !techDeclinedRecently(state, id));
  if (!wanted.length) return;

  const roll = noise(state.seed ^ Math.imul(state.tick + 13, 0x27d4eb2d));
  const techId = wanted[Math.floor(roll * wanted.length)];
  const sellers = sellersOf(state, state.home, techId);
  if (!sellers.length) return;

  const from = sellers[Math.floor(noise(state.seed ^ state.tick) * sellers.length)];
  const fee = licenceCost(state, state.home, techId);
  state.techOffers.push({ from, tech: techId, fee, tick: state.tick, at: Date.now() });
  pushAlert(state, `${COUNTRIES[from].name} offers to licence ${TECHS[techId].name} — see the Tech tab.`, 'info');
}

export function techOfferLeft(state, offer) {
  return Math.max(0, CONFIG.techTrade.ttl - (state.tick - offer.tick));
}

// The same integer hash `generateWorld` uses, so licensing is reproducible from
// the save rather than from the wall clock.
function noise(seed) {
  let a = (seed + 0x6d2b79f5) >>> 0;
  a = Math.imul(a ^ (a >>> 15), 1 | a);
  a = (a + Math.imul(a ^ (a >>> 7), 61 | a)) ^ a;
  return ((a ^ (a >>> 14)) >>> 0) / 4294967296;
}
