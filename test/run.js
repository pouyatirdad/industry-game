import { createInitialState, warehouseStock, siteWages, DEPOSIT_TERRAINS, WATER_TERRAINS, rehydrate,
  appetite, buildingsOf, hasPact, canTrade, isPlayer, projectedWages, packState,
  pushAlert, pruneAlerts, dismissAlert, recordFlow, ownFlows } from '../src/core/state.js';
import { COMMODITIES, COMMODITY_IDS } from '../src/data/commodities.js';
import { COUNTRIES, COUNTRY_IDS, COUNTRY_BY_CHAR, pactCost } from '../src/data/countries.js';
import { WORLD_ROWS, WORLD_W, WORLD_H, SOURCE_ROWS, SOURCE_W, SOURCE_H, AREA_SCALE } from '../src/data/world.js';
import { CENTROIDS, distanceBetween, haulShare, neighboursOf, MAX_DISTANCE } from '../src/data/geography.js';
import { BUILDINGS } from '../src/data/buildings.js';
import { CONFIG } from '../src/core/config.js';
import { build, canBuild, openPact, canOpenPact, demolish, acceptOffer, declineOffer } from '../src/actions.js';
import { runTick } from '../src/systems/index.js';
import { produce } from '../src/systems/production.js';
import { payWages } from '../src/systems/economy.js';
import { movePrices, growEconomies } from '../src/systems/market.js';
import { sellDomestic, unmet, supplyRatio } from '../src/systems/domestic.js';
import { runTrade } from '../src/systems/trade.js';
import { warehousesServing, spoil } from '../src/systems/logistics.js';
import { runStateIndustry } from '../src/systems/stateIndustry.js';
import { runDiplomacy, offerFee, offerFrom } from '../src/systems/diplomacy.js';
import { createLoop } from '../src/core/loop.js';
// The nation table's scoring is the one piece of UI with a rule in it rather
// than a layout, and it reads only `state` — so it is tested here like anything
// else. It must stay free of the DOM for this import to keep working headlessly.
import { scoreNations } from '../src/ui/ranks.js';

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function equal(actual, expected, message) {
  if (actual !== expected) throw new Error(`${message} — expected ${expected}, got ${actual}`);
}

function close(actual, expected, tolerance, message) {
  if (Math.abs(actual - expected) > tolerance) {
    throw new Error(`${message} — expected ${expected} ±${tolerance}, got ${actual}`);
  }
}

// Tests build on a scratch tile: the real map is fixed geography, so a test that
// wants "a coalfield here" says so, and stamps the tile into the nation whose
// government is doing the building. A site's owner IS the nation it stands in,
// so both have to be set together.
function placeIn(state, countryId, type, x, y, terrain) {
  const tile = state.tiles[y * state.grid.w + x];
  tile.terrain = terrain;
  tile.countryId = countryId;
  tile.buildingId = null;
  const result = build(state, type, tile, countryId);
  assert(result.ok, `failed to place ${type} in ${countryId}: ${result.reason}`);
  return result.building;
}

function place(state, type, x, y, terrain) {
  return placeIn(state, state.home, type, x, y, terrain);
}

// Ground a government could build on, without building on it. Real Japan is
// nowhere near real Iran, so a test that wants a nation to have room next to the
// depot it just stamped has to stamp that room too.
function claim(state, countryId, x, y, terrain) {
  const tile = state.tiles[y * state.grid.w + x];
  tile.terrain = terrain;
  tile.countryId = countryId;
  tile.buildingId = null;
  return tile;
}

function fixture() {
  const state = createInitialState();
  state.countries[state.home].cash = 1_000_000;
  return state;
}

const me = (state) => state.countries[state.home];

// ---- world data integrity -------------------------------------------------

test('the world map is a complete rectangle of the declared size', () => {
  equal(WORLD_ROWS.length, WORLD_H, 'row count');
  assert(WORLD_W * WORLD_H >= 180_000, `the playable grid should be far larger than the source, got ${WORLD_W}x${WORLD_H}`);
  for (let y = 0; y < WORLD_ROWS.length; y++) {
    equal(WORLD_ROWS[y].length, WORLD_W, `row ${y} width`);
  }
});

test('the source art is exactly the declared source grid', () => {
  equal(SOURCE_ROWS.length, SOURCE_H, 'source row count');
  for (let y = 0; y < SOURCE_ROWS.length; y++) {
    equal(SOURCE_ROWS[y].length, SOURCE_W, `source row ${y} width`);
  }
});

test('every nation owns land on the map', () => {
  assert(COUNTRY_IDS.length >= 40, `the world should be crowded, got ${COUNTRY_IDS.length} nations`);
  const seen = new Set();
  for (const row of SOURCE_ROWS) {
    for (const char of row) {
      const id = COUNTRY_BY_CHAR[char];
      if (id) seen.add(id);
    }
  }
  const missing = COUNTRY_IDS.filter((id) => !seen.has(id));
  equal(missing.length, 0, `nations with no tiles: ${missing.join(', ')}`);
});

test('no two nations share a map character', () => {
  equal(Object.keys(COUNTRY_BY_CHAR).length, COUNTRY_IDS.length,
    'every country needs its own character in world.js');
});

test('no character on the map is left unexplained', () => {
  for (let y = 0; y < WORLD_ROWS.length; y++) {
    for (const char of WORLD_ROWS[y]) {
      assert(char === '.' || char === '-' || COUNTRY_BY_CHAR[char],
        `row ${y} uses "${char}", which is neither ocean, neutral land, nor a country`);
    }
  }
});

// The art is traced from real coastlines, so the countries have to land in the
// right hemispheres. A row or column shift would otherwise pass every other
// test in this file while putting Brazil in the Pacific.
test('nations sit where they do on a real map', () => {
  // The source is equirectangular: column 0 is 180W, row 0 is the far north.
  const lon = (id) => -180 + (CENTROIDS[id].x + 0.5) * (360 / SOURCE_W);
  const lat = (id) => 84 - (CENTROIDS[id].y + 0.5) * (141 / SOURCE_H);

  assert(lon('US') < -70 && lon('US') > -130, `the United States should be in the western hemisphere, got ${lon('US').toFixed(0)}`);
  assert(lon('JP') > 120 && lon('JP') < 155, `Japan should be in the far east, got ${lon('JP').toFixed(0)}`);
  assert(lat('NO') > 55, `Norway should be arctic, got ${lat('NO').toFixed(0)}`);
  assert(lat('ZA') < -15, `South Africa should be deep in the southern hemisphere, got ${lat('ZA').toFixed(0)}`);
  assert(lat('BR') < 5 && lon('BR') < -35, 'Brazil should be in the south Atlantic quadrant');
  assert(lat('AU') < -15 && lon('AU') > 110, 'Australia should be south-east');
});

test('distance wraps around the globe rather than across the map', () => {
  // Tokyo and Los Angeles face each other over the Pacific. Measured flat, the
  // route would run back over Europe and cost several times as much freight.
  const pacific = distanceBetween('JP', 'US');
  const overland = distanceBetween('JP', 'GB');
  assert(pacific < overland, `Japan should be nearer the US across the Pacific than the UK overland (${pacific.toFixed(1)} vs ${overland.toFixed(1)})`);
  equal(distanceBetween('IR', 'IR'), 0, 'a country is not distant from itself');
  assert(MAX_DISTANCE > 0, 'the world must have a longest haul');
  assert(haulShare('IR', 'IQ') < haulShare('IR', 'CL'), 'Iraq is nearer to Iran than Chile is');
});

test('a nations nearest neighbours are actually its neighbours', () => {
  const near = neighboursOf('DE').slice(0, 6);
  assert(near.some((id) => ['FR', 'NL', 'PL', 'IT'].includes(id)),
    `Germany's closest markets should be European, got ${near.join(', ')}`);
  assert(!near.includes('NZ'), 'New Zealand is not next door to Germany');
});

test('deposits only ever land inside the country that owns them', () => {
  const state = createInitialState();
  for (const tile of state.tiles) {
    if (DEPOSIT_TERRAINS.includes(tile.terrain)) {
      assert(tile.countryId, `deposit at (${tile.x},${tile.y}) sits on unowned land`);
    }
  }
});

// Data-integrity guards over the industry tables. These are the failures that
// would otherwise show up as a chain that silently never runs.
test('every recipe input and output is a real commodity', () => {
  for (const [id, def] of Object.entries(BUILDINGS)) {
    if (!def.recipe) continue;
    for (const side of ['in', 'out']) {
      for (const commodity of Object.keys(def.recipe[side])) {
        assert(COMMODITIES[commodity], `${id}.recipe.${side} names unknown commodity "${commodity}"`);
      }
    }
  }
});

test('every building sits on a terrain the map actually produces', () => {
  const real = new Set(['plain', ...DEPOSIT_TERRAINS]);
  for (const [id, def] of Object.entries(BUILDINGS)) {
    for (const terrain of def.terrain) {
      assert(real.has(terrain), `${id} wants terrain "${terrain}", which no country generates`);
    }
  }
});

test('every commodity is produced by something and every deposit is mined', () => {
  const produced = new Set();
  const worked = new Set();
  for (const def of Object.values(BUILDINGS)) {
    if (def.recipe) for (const id of Object.keys(def.recipe.out)) produced.add(id);
    if (def.recipe && !Object.keys(def.recipe.in).length) for (const t of def.terrain) worked.add(t);
  }
  const orphans = COMMODITY_IDS.filter((id) => !produced.has(id));
  equal(orphans.length, 0, `commodities nothing produces: ${orphans.join(', ')}`);

  const unmined = DEPOSIT_TERRAINS.filter((t) => t !== 'desert' && !worked.has(t));
  equal(unmined.length, 0, `deposit terrains no building can work: ${unmined.join(', ')}`);
});

test('every recipe clears a margin on its inputs at base price', () => {
  const value = (bag) => Object.entries(bag)
    .reduce((sum, [id, qty]) => sum + qty * COMMODITIES[id].basePrice, 0);
  for (const [id, def] of Object.entries(BUILDINGS)) {
    if (!def.recipe || !Object.keys(def.recipe.in).length) continue;
    const inputs = value(def.recipe.in);
    const outputs = value(def.recipe.out);
    assert(outputs > inputs,
      `${id} destroys value: ${inputs} of inputs makes ${outputs} of output at base price`);
  }
});

// Wages are the only running cost besides inputs, so a wage multiplier set on
// hourly pay rather than unit labour cost quietly makes whole nations
// unplayable — every plant they could build loses money on the day it opens.
test('the dearest labour on earth can still run the deepest chain', () => {
  const dearest = COUNTRY_IDS.reduce((a, b) => (COUNTRIES[a].wageMul > COUNTRIES[b].wageMul ? a : b));
  const value = (bag) => Object.entries(bag)
    .reduce((sum, [id, qty]) => sum + qty * COMMODITIES[id].basePrice, 0);
  const def = BUILDINGS.vehiclePlant;
  const margin = (value(def.recipe.out) - value(def.recipe.in)) / def.recipe.ticks;
  const wages = def.wages * COUNTRIES[dearest].wageMul;
  assert(margin > wages,
    `${dearest} cannot profit on vehicles at base price: margin ${margin.toFixed(0)} vs wages ${wages.toFixed(0)}`);
});

test('Iran is generated as an oil and gas country', () => {
  const state = createInitialState();
  const iranian = state.tiles.filter((t) => t.countryId === 'IR');
  assert(iranian.length >= 8, `Iran should be a workable size, got ${iranian.length} tiles`);
  const oil = iranian.filter((t) => t.terrain === 'oilfield').length;
  equal(oil, Math.round(COUNTRIES.IR.deposits.oilfield * AREA_SCALE), 'Iran oilfields on the map');
  assert(iranian.some((t) => t.terrain === 'plain'), 'Iran needs flat ground to refine on');
});

// Deposits are authored against the source grid, so growing the playable grid
// must grow them with it or a big country turns into empty plains.
test('deposits keep their proportion of a country when the grid scales', () => {
  const state = createInitialState();
  for (const id of ['IR', 'AU', 'CN']) {
    const tiles = state.tiles.filter((t) => t.countryId === id);
    for (const [terrain, authored] of Object.entries(COUNTRIES[id].deposits)) {
      const found = tiles.filter((t) => t.terrain === terrain).length;
      const wanted = Math.round(authored * AREA_SCALE);
      assert(found > authored, `${id} ${terrain}: did not scale up — authored ${authored}, found ${found}`);
      assert(found <= wanted, `${id} ${terrain}: overshot — wanted at most ${wanted}, found ${found}`);
    }
  }
});

// Over-subscribing is silent: generation runs out of room and drops whatever
// comes last in DEPOSIT_ORDER, so the country never gets a resource its data
// says it has. This is the guard that makes that a test failure instead.
test('no country asks for more deposits than it has room for', () => {
  const state = createInitialState();
  const offenders = [];
  for (const id of COUNTRY_IDS) {
    const tiles = state.tiles.filter((t) => t.countryId === id);
    if (!tiles.length) continue;
    for (const terrain of Object.keys(COUNTRIES[id].deposits)) {
      const found = tiles.filter((t) => t.terrain === terrain).length;
      if (found === 0) offenders.push(`${id} lost all its ${terrain}`);
    }
  }
  equal(offenders.length, 0, `deposits silently dropped: ${offenders.join('; ')}`);
});

// Every country must keep flat ground, or it can extract but never manufacture.
test('no country is paved over entirely with deposits', () => {
  const state = createInitialState();
  for (const id of COUNTRY_IDS) {
    const tiles = state.tiles.filter((t) => t.countryId === id);
    if (!tiles.length) continue;
    const plains = tiles.filter((t) => t.terrain === 'plain').length;
    assert(plains > 0, `${id} has no plain tiles at all — nothing can be manufactured there`);
  }
});

test('the same seed regenerates an identical world', () => {
  const a = createInitialState(4242);
  const b = createInitialState(4242);
  equal(JSON.stringify(a.tiles), JSON.stringify(b.tiles), 'world generation must be deterministic');
});

// ---- territorial waters and offshore --------------------------------------

test('coastal sea is claimed by a country and open ocean is not', () => {
  const state = createInitialState();
  const claimed = state.tiles.filter((t) => t.terrain === 'water' && t.countryId).length;
  const open = state.tiles.filter((t) => t.terrain === 'water' && !t.countryId).length;
  assert(claimed > 0, 'some sea should be territorial');
  assert(open > claimed, 'most of the ocean should still belong to nobody');
});

test('offshore deposits only appear in somebody territorial waters', () => {
  const state = createInitialState();
  const offshore = state.tiles.filter((t) => WATER_TERRAINS.includes(t.terrain));
  assert(offshore.length > 0, 'the sea should hold resources');
  for (const tile of offshore) {
    assert(tile.countryId, `offshore deposit at (${tile.x},${tile.y}) is unowned`);
  }
});

test('Iran gets the offshore gas its data claims', () => {
  const state = createInitialState();
  const gas = state.tiles.filter((t) => t.countryId === 'IR' && t.terrain === 'offshoreGas').length;
  assert(gas > 0, 'Iran shares the largest offshore gas field on earth');
});

test('warehouses can never stand on water of any kind', () => {
  for (const terrain of WATER_TERRAINS) {
    assert(!BUILDINGS.warehouse.terrain.includes(terrain),
      `warehouses must not be placeable on ${terrain}`);
  }
});

test('offshore extraction is buildable at sea but factories are not', () => {
  const state = fixture();
  const sea = state.tiles.find((t) => t.countryId === state.home && t.terrain === 'offshoreGas')
    ?? state.tiles.find((t) => t.countryId === state.home && t.terrain === 'water');
  sea.terrain = 'offshoreGas';
  equal(canBuild(state, 'offshoreGasRig', sea).ok, true, 'a rig goes to sea');
  equal(canBuild(state, 'refinery', sea).ok, false, 'a refinery does not');
  equal(canBuild(state, 'warehouse', sea).ok, false, 'nor does a depot');
});

test('open ocean stays unbuildable even for its nearest country', () => {
  const state = fixture();
  const open = state.tiles.find((t) => t.terrain === 'water' && !t.countryId);
  equal(canBuild(state, 'offshoreGasRig', open).ok, false, 'no claim, no licence');
});

test('an offshore rig delivers to a depot on shore', () => {
  const state = fixture();
  place(state, 'warehouse', 100, 100, 'plain');
  const rig = place(state, 'offshoreGasRig', 101, 100, 'offshoreGas');

  for (let i = 0; i < 8; i++) runTick(state);

  assert(rig.status === 'running', 'the rig is being collected from');
});

test('a fishing fleet feeds a cannery', () => {
  const state = fixture();
  place(state, 'warehouse', 100, 100, 'plain');
  place(state, 'fishingFleet', 101, 100, 'fishery');
  const cannery = place(state, 'cannery', 99, 100, 'plain');

  for (let i = 0; i < 14; i++) runTick(state);

  assert(cannery.status === 'running', 'the cannery should be fed within 14 ticks');
});

// ---- saving ----------------------------------------------------------------

// 180,000 tile objects will not fit in localStorage, so they are regenerated
// from the seed instead of stored. That round trip has to be exact.
test('a save omits tiles and rehydrates to the identical world', () => {
  const state = createInitialState(31_337, 'IR');
  // Built on ground that is ALREADY plain: the test helpers stamp terrain, and
  // regeneration would rightly discard that. Nothing in the real game mutates
  // terrain, which is exactly why tiles are safe to drop from the save.
  const spot = state.tiles.find((t) => t.countryId === 'IR' && t.terrain === 'plain');
  const placed = build(state, 'warehouse', spot);
  assert(placed.ok, `could not place a depot: ${placed.reason}`);

  const saved = packState(state);
  assert(!('tiles' in saved), 'tiles must not be part of the save payload');
  assert(JSON.stringify(saved).length < 900_000,
    `a save must stay small enough for localStorage, got ${JSON.stringify(saved).length} bytes`);

  const back = rehydrate(JSON.parse(JSON.stringify(saved)));
  equal(back.tiles.length, state.tiles.length, 'tile count restored');
  equal(JSON.stringify(back.tiles.map((t) => t.terrain)),
    JSON.stringify(state.tiles.map((t) => t.terrain)), 'terrain restored exactly');
  equal(JSON.stringify(back.tiles.map((t) => t.countryId)),
    JSON.stringify(state.tiles.map((t) => t.countryId)), 'ownership restored exactly');
  equal(back.tiles[placed.building.tileId].buildingId, placed.building.id,
    'the building is reattached to its tile');
});

test('nothing on the state survives a JSON round trip as anything but data', () => {
  const state = createInitialState(7, 'BR');
  const saved = packState(state);
  const back = JSON.parse(JSON.stringify(saved));
  equal(JSON.stringify(back), JSON.stringify(saved),
    'a Map, Set or class instance on the state would silently vanish here');
});

// ---- you are a nation ------------------------------------------------------

test('you govern one nation and build only on its soil', () => {
  const state = fixture();
  assert(isPlayer(state, state.home), 'the home country is you');
  assert(!isPlayer(state, 'DE'), 'Germany is not');

  const foreign = state.tiles.find((t) => t.countryId === 'DE');
  foreign.terrain = 'plain';
  const check = canBuild(state, 'warehouse', foreign);
  equal(check.ok, false, 'you cannot build abroad at any price');
  assert(check.reason.includes('Germany'), `the refusal should name the country, got: ${check.reason}`);
});

test('a government cannot build outside its own borders either', () => {
  const state = fixture();
  const iranian = state.tiles.find((t) => t.countryId === 'IR' && t.buildingId == null);
  equal(canBuild(state, 'warehouse', iranian, 'DE').ok, false, 'Germany may not build in Iran');
});

test('the ocean and unclaimed land are never buildable', () => {
  const state = fixture();
  const ocean = state.tiles.find((t) => t.terrain === 'water');
  equal(canBuild(state, 'warehouse', ocean).ok, false, 'ocean refused');

  const neutral = state.tiles.find((t) => !t.countryId && t.terrain !== 'water');
  assert(neutral, 'the map should carry some unclaimed land');
  equal(canBuild(state, 'warehouse', neutral).ok, false, 'unclaimed land refused');
});

test('every nation starts solvent, with a treasury and its neighbours as partners', () => {
  const state = createInitialState(1, 'IR');
  for (const id of COUNTRY_IDS) {
    assert(state.countries[id].cash > 0, `${id} needs a treasury to start with`);
    assert(state.countries[id].solvent, `${id} should start solvent`);
  }
  const partners = COUNTRY_IDS.filter((id) => id !== 'IR' && hasPact(state, id));
  assert(partners.length >= 3, `a new game should open with neighbours, got ${partners.length}`);
  const far = neighboursOf('IR').at(-1);
  assert(!hasPact(state, far), `the far side of the world should not be free (${far})`);
});

// ---- trade pacts -----------------------------------------------------------

test('you may only trade with a nation you hold a pact with', () => {
  const state = fixture();
  const stranger = COUNTRY_IDS.find((id) => id !== state.home && !hasPact(state, id));
  equal(canTrade(state, state.home, stranger), false, 'no pact, no trade');
  equal(canTrade(state, stranger, state.home), false, 'and it is symmetric');

  const partner = COUNTRY_IDS.find((id) => id !== state.home && hasPact(state, id));
  equal(canTrade(state, state.home, partner), true, 'a pact opens both directions');
});

test('two foreign nations always trade with each other', () => {
  const state = fixture();
  const [a, b] = COUNTRY_IDS.filter((id) => id !== state.home).slice(0, 2);
  equal(canTrade(state, a, b), true, 'the rest of the world has had embassies for a century');
  equal(canTrade(state, a, a), false, 'a country does not trade with itself');
});

test('signing a pact costs the treasury and pays the other nation', () => {
  const state = fixture();
  const target = COUNTRY_IDS.find((id) => id !== state.home && !hasPact(state, id));
  const cost = pactCost(target);
  me(state).cash = cost + 50_000;
  const theirs = state.countries[target].cash;

  const result = openPact(state, target);
  equal(result.ok, true, 'pact accepted');
  equal(me(state).cash, 50_000, 'fee debited in full');
  equal(state.countries[target].cash, theirs + cost, 'and it lands in their treasury');
  assert(hasPact(state, target), 'the pact stands');
});

test('a pact is refused outright when you cannot afford it', () => {
  const state = fixture();
  const target = COUNTRY_IDS.find((id) => id !== state.home && !hasPact(state, id));
  me(state).cash = pactCost(target) - 1;

  equal(canOpenPact(state, target).ok, false, 'refused');
  openPact(state, target);
  equal(me(state).cash, pactCost(target) - 1, 'no partial charge');
  equal(hasPact(state, target), false, 'still closed');
});

test('a pact with a large market costs more than one with a small market', () => {
  assert(pactCost('US') > pactCost('CD') * 20,
    'the price of a pact should track the size of the market it opens');
});

// ---- the home market -------------------------------------------------------

test('a nation sells to its own people up to what they eat, and no further', () => {
  const state = fixture();
  const depot = place(state, 'warehouse', 20, 20, 'plain');
  depot.store.ore = 10_000;
  me(state).cash = 0;

  sellDomestic(state);

  const want = appetite(state, state.home, 'ore');
  close(state.markets[state.home].ore.soldLastTick, want, 0.001, 'the home market absorbs exactly its appetite');
  close(depot.store.ore, 10_000 - want, 0.001, 'the rest stays in the warehouse for export');
  assert(me(state).cash > 0, 'the sale reaches the treasury');
});

test('selling into your own market moves nobody elses price', () => {
  const state = fixture();
  const depot = place(state, 'warehouse', 20, 20, 'plain');
  depot.store.food = 10_000;

  sellDomestic(state);

  assert(state.markets[state.home].food.soldLastTick > 0, 'your people bought');
  equal(state.markets.US.food.soldLastTick, 0, 'the United States saw none of it');
});

test('every nation collects a tax base whether or not it produces anything', () => {
  const state = fixture();
  me(state).cash = 0;
  sellDomestic(state);
  const expected = Math.round(me(state).demand * CONFIG.taxPerDemand);
  equal(me(state).report.tax, expected, 'tax scales with the size of the economy');
  equal(me(state).cash, expected, 'and it is real money');
});

test('warehouses across a nation draw on one shared appetite', () => {
  const state = fixture();
  const a = place(state, 'warehouse', 20, 20, 'plain');
  const b = place(state, 'warehouse', 60, 60, 'plain');
  a.store.ore = 10_000;
  b.store.ore = 10_000;

  sellDomestic(state);

  const want = appetite(state, state.home, 'ore');
  close(state.markets[state.home].ore.soldLastTick, want, 0.001,
    'two depots must not each sell a whole nations appetite');
});

// ---- world trade -----------------------------------------------------------

test('surplus goes abroad to a partner who is short of it', () => {
  const state = fixture();
  const partner = COUNTRY_IDS.find((id) => id !== state.home && hasPact(state, id));
  const depot = place(state, 'warehouse', 20, 20, 'plain');
  depot.store.steel = 500;
  // Crush the home price so abroad is plainly the better market.
  state.markets[state.home].steel.price = COMMODITIES.steel.basePrice * 0.5;
  state.markets[partner].steel.price = COMMODITIES.steel.basePrice * 1.5;
  me(state).cash = 0;

  runTrade(state);

  assert(me(state).report.exports > 0, 'the surplus found a buyer');
  assert(depot.store.steel < 500, 'and it left the warehouse');
  assert(state.flows.some((f) => f.from === state.home && f.to === partner),
    'the deal is recorded as a flow you can see');
});

test('a deal settles between the two local prices, so both sides gain', () => {
  const state = fixture();
  const partner = COUNTRY_IDS.find((id) => id !== state.home && hasPact(state, id));
  const depot = place(state, 'warehouse', 20, 20, 'plain');
  depot.store.steel = 500;
  const low = COMMODITIES.steel.basePrice * 0.5;
  const high = COMMODITIES.steel.basePrice * 1.5;
  state.markets[state.home].steel.price = low;
  state.markets[partner].steel.price = high;

  runTrade(state);

  const flow = state.flows.find((f) => f.from === state.home && f.commodity === 'steel');
  const unit = flow.value / flow.qty;
  assert(unit > low, `the seller beats its home price: ${unit.toFixed(0)} vs ${low}`);
  assert(unit < high, `and the buyer pays under its own: ${unit.toFixed(0)} vs ${high}`);
});

test('nothing is shipped to a nation you have no pact with', () => {
  const state = fixture();
  const stranger = COUNTRY_IDS.find((id) => id !== state.home && !hasPact(state, id));
  // Only the stranger is short; everybody else is glutted.
  for (const id of COUNTRY_IDS) {
    state.markets[id].steel.price = COMMODITIES.steel.basePrice * 0.4;
    state.markets[id].steel.importedLastTick = appetite(state, id, 'steel');
  }
  state.markets[stranger].steel.price = COMMODITIES.steel.basePrice * 1.8;
  state.markets[stranger].steel.importedLastTick = 0;

  const depot = place(state, 'warehouse', 20, 20, 'plain');
  depot.store.steel = 500;

  runTrade(state);

  assert(!state.flows.some((f) => f.to === stranger && f.from === state.home),
    'a market you have not paid to open stays shut');
});

test('freight makes a distant buyer worth less than a near one', () => {
  const state = fixture();
  const near = neighboursOf(state.home).find((id) => hasPact(state, id));
  const far = neighboursOf(state.home).at(-1);
  state.countries[far].pact = true;

  const proceeds = (partner) => {
    const s = fixture();
    s.countries[partner].pact = true;
    const depot = placeIn(s, s.home, 'warehouse', 20, 20, 'plain');
    depot.store.vehicles = 200;
    for (const id of COUNTRY_IDS) s.markets[id].vehicles.price = COMMODITIES.vehicles.basePrice * 0.4;
    s.markets[s.home].vehicles.price = COMMODITIES.vehicles.basePrice * 0.4;
    s.markets[partner].vehicles.price = COMMODITIES.vehicles.basePrice * 1.8;
    runTrade(s);
    const flow = s.flows.find((f) => f.to === partner);
    return flow ? s.countries[partner].report.imports / flow.qty : 0;
  };

  assert(proceeds(far) > proceeds(near),
    'the same cargo must cost the distant buyer more per unit than the near one');
});

test('a nation will not spend its payroll on imports', () => {
  const state = fixture();
  const partner = COUNTRY_IDS.find((id) => id !== state.home && hasPact(state, id));
  placeIn(state, partner, 'warehouse', 40, 40, 'plain').store.steel = 5000;
  const mine = place(state, 'ironMine', 20, 20, 'hills');
  // Just enough treasury to cover the reserve, and not a penny more.
  me(state).cash = projectedWages(state) * CONFIG.trade.reserveTicks;
  state.markets[state.home].steel.price = COMMODITIES.steel.basePrice * 1.8;
  state.markets[partner].steel.price = COMMODITIES.steel.basePrice * 0.4;
  const before = me(state).cash;

  runTrade(state);

  equal(me(state).cash, before, 'the reserve is untouchable');
  assert(mine.staffed, 'which is the point: payroll comes first');
});

test('an import is what actually fills the gap in a nations supply', () => {
  const state = fixture();
  const before = supplyRatio(state, state.home, 'steel');
  const want = appetite(state, state.home, 'steel');
  assert(unmet(state, state.home, 'steel') > 0, 'an untouched nation is short of everything');

  state.markets[state.home].steel.importedLastTick = want * 0.5;
  assert(supplyRatio(state, state.home, 'steel') > before, 'imports count toward supply');
  assert(unmet(state, state.home, 'steel') < want, 'and shrink the shortfall');
});

// ---- prices ----------------------------------------------------------------

test('flooding the market pushes the price below base', () => {
  const state = fixture();
  const before = state.markets[state.home].ore.price;
  state.markets[state.home].ore.soldLastTick = appetite(state, state.home, 'ore') * 40;

  movePrices(state);

  assert(state.markets[state.home].ore.price < before, 'price should fall when supply exceeds demand');
  assert(state.markets[state.home].ore.price >= COMMODITIES.ore.basePrice * CONFIG.price.floor,
    'price must respect the floor');
});

test('scarcity lifts the price toward the ceiling but never past it', () => {
  const state = fixture();
  for (let i = 0; i < 500; i++) {
    state.markets[state.home].ore.soldLastTick = 0;
    movePrices(state);
  }
  assert(state.markets[state.home].ore.price > COMMODITIES.ore.basePrice, 'price rises when nothing is sold');
  assert(state.markets[state.home].ore.price <= COMMODITIES.ore.basePrice * CONFIG.price.ceiling,
    'price must respect the ceiling');
});

test('a big market wants far more of a good than a small one', () => {
  const state = fixture();
  assert(appetite(state, 'US', 'food') > appetite(state, 'CD', 'food') * 10,
    'the United States should out-consume DR Congo by an order of magnitude');
  assert(appetite(state, 'IR', 'food') > appetite(state, 'IR', 'bauxite'),
    'food is consumed far more than bauxite');
});

test('the same goods fetch different prices in different countries', () => {
  const state = fixture();
  // Flood Iran with food; leave the United States alone.
  for (let i = 0; i < 40; i++) {
    state.markets.IR.food.soldLastTick = appetite(state, 'IR', 'food');
    state.markets.US.food.soldLastTick = 0;
    movePrices(state);
  }
  assert(state.markets.IR.food.price < state.markets.US.food.price,
    `flooding Iran should make it the worse market: IR ${state.markets.IR.food.price} vs US ${state.markets.US.food.price}`);
});

// ---- a living economy ------------------------------------------------------

test('supplying your people grows the economy and neglecting them shrinks it', () => {
  const fed = fixture();
  for (const id of COMMODITY_IDS) {
    fed.markets[fed.home][id].soldLastTick = appetite(fed, fed.home, id);
  }
  const startFed = fed.countries[fed.home].demand;
  growEconomies(fed);
  assert(fed.countries[fed.home].demand > startFed, 'a supplied nation grows');

  const starved = fixture();
  const startStarved = starved.countries[starved.home].demand;
  growEconomies(starved);
  assert(starved.countries[starved.home].demand < startStarved, 'an unsupplied one shrinks');
});

test('an economy cannot grow or collapse without limit', () => {
  const state = fixture();
  const base = COUNTRIES[state.home].demand;
  for (let i = 0; i < 4000; i++) {
    for (const id of COMMODITY_IDS) {
      state.markets[state.home][id].soldLastTick = appetite(state, state.home, id) * 5;
    }
    growEconomies(state);
  }
  close(me(state).demand, base * CONFIG.growth.ceiling, base * 0.01, 'growth is capped');

  for (let i = 0; i < 8000; i++) {
    for (const id of COMMODITY_IDS) state.markets[state.home][id].soldLastTick = 0;
    growEconomies(state);
  }
  close(me(state).demand, base * CONFIG.growth.floor, base * 0.01, 'and so is collapse');
});

test('a glut of one commodity cannot pay for starving the rest', () => {
  const state = fixture();
  state.markets[state.home].ore.soldLastTick = appetite(state, state.home, 'ore') * 500;
  growEconomies(state);
  assert(me(state).supply < CONFIG.growth.pivot,
    'one flooded commodity must not read as a supplied nation');
});

test('goods left in a warehouse are quietly lost to carrying costs', () => {
  const state = fixture();
  const depot = place(state, 'warehouse', 20, 20, 'plain');
  depot.store.ore = 1000;

  spoil(state);

  close(depot.store.ore, 1000 * (1 - CONFIG.spoilage), 0.001,
    'hoarding a commodity nobody wants has to cost something');
});

// ---- terrain gating --------------------------------------------------------

test('desert takes extraction and storage but not factories', () => {
  const state = fixture();
  const tile = state.tiles.find((t) => t.countryId === state.home);
  tile.terrain = 'desert';
  equal(canBuild(state, 'warehouse', tile).ok, true, 'warehouses work in desert');
  equal(canBuild(state, 'refinery', tile).ok, false, 'refineries need flat ground');
  equal(canBuild(state, 'steelMill', tile).ok, false, 'mills need flat ground');
});

test('an oil rig only goes on an oilfield', () => {
  const state = fixture();
  const tile = state.tiles.find((t) => t.countryId === state.home);
  tile.terrain = 'plain';
  equal(canBuild(state, 'oilRig', tile).ok, false, 'no rig on plains');
  tile.terrain = 'oilfield';
  equal(canBuild(state, 'oilRig', tile).ok, true, 'rig on oilfield');
});

// ---- production ------------------------------------------------------------

test('a multi-input recipe consumes nothing while any input is short', () => {
  const state = fixture();
  const mill = place(state, 'steelMill', 5, 5, 'plain');
  mill.input.ore = 6;
  mill.input.coal = 0;

  produce(state);

  equal(mill.input.ore, 6, 'ore must not be consumed when coal is missing');
  equal(mill.status, 'starved', 'mill status');
  assert(mill.shortage.includes('coal'), 'shortage should name coal');
  equal(mill.output.steel, 0, 'no steel produced');
});

test('a recipe consumes atomically once every input is present', () => {
  const state = fixture();
  const mill = place(state, 'steelMill', 5, 5, 'plain');
  mill.input.ore = 6;
  mill.input.coal = 3;

  produce(state);

  equal(mill.input.ore, 0, 'ore consumed');
  equal(mill.input.coal, 0, 'coal consumed');
  equal(mill.progress, 1, 'job started but not finished (2-tick recipe)');
  equal(mill.output.steel, 0, 'steel not delivered until the job completes');

  produce(state);
  equal(mill.output.steel, 3, 'steel delivered on the completing tick');
  equal(mill.progress, 0, 'job reset');
});

test('machine works will not burn steel while it has no fuel', () => {
  const state = fixture();
  const works = place(state, 'machineWorks', 5, 5, 'plain');
  works.input.steel = 4;
  works.input.fuel = 0;

  produce(state);

  equal(works.input.steel, 4, 'steel held back until fuel arrives');
  equal(works.status, 'starved', 'status');
  assert(works.shortage.includes('fuel'), 'shortage should name fuel');
});

// The radius is read from data rather than hardcoded, so it survives a change
// of map scale — the boundary behaviour is what matters, not the number.
test('warehouse service radius includes its exact reach and excludes one past it', () => {
  const state = fixture();
  const r = BUILDINGS.warehouse.radius;
  place(state, 'warehouse', 20, 20, 'plain');
  const home = state.home;

  equal(warehousesServing(state, 20 + r, 20, home).length, 1, `orthogonal distance ${r} is served`);
  equal(warehousesServing(state, 20 + r, 20 + r, home).length, 1, `diagonal distance ${r} is served`);
  equal(warehousesServing(state, 20 + r + 1, 20, home).length, 0, `distance ${r + 1} is out of range`);
});

// ---- wages and solvency ----------------------------------------------------

test('wages are priced by the nation the site stands in', () => {
  const state = fixture();
  const cheapest = COUNTRY_IDS.reduce((a, b) => (COUNTRIES[a].wageMul < COUNTRIES[b].wageMul ? a : b));
  const dearest = COUNTRY_IDS.reduce((a, b) => (COUNTRIES[a].wageMul > COUNTRIES[b].wageMul ? a : b));
  const cheap = placeIn(state, cheapest, 'steelMill', 5, 5, 'plain');
  const dear = placeIn(state, dearest, 'steelMill', 60, 60, 'plain');

  equal(siteWages(cheap), Math.round(160 * COUNTRIES[cheapest].wageMul), 'cheap payroll');
  equal(siteWages(dear), Math.round(160 * COUNTRIES[dearest].wageMul), 'dear payroll');
  assert(siteWages(dear) > siteWages(cheap) * 3, 'the spread has to be worth caring about');
});

test('wages are debited every tick and insolvency unstaffs every site', () => {
  const state = fixture();
  const mine = place(state, 'ironMine', 2, 2, 'hills');
  const payroll = siteWages(mine);
  assert(payroll > 0, 'the mine must cost something to staff');

  me(state).cash = 1000;
  payWages(state);
  equal(me(state).cash, 1000 - payroll, 'wages debited');
  equal(mine.staffed, true, 'still staffed while solvent');

  me(state).cash = payroll - 1;
  payWages(state);
  equal(me(state).cash, -1, 'cash may go negative');
  equal(me(state).solvent, false, 'flagged insolvent');
  equal(mine.staffed, false, 'sites unstaffed when payroll is missed');

  produce(state);
  equal(mine.status, 'unstaffed', 'unstaffed sites do not produce');
  equal(mine.output.ore, 0, 'no output while unstaffed');
});

test('every nation meets its own payroll independently', () => {
  const state = fixture();
  const yours = place(state, 'ironMine', 20, 20, 'hills');
  const theirs = placeIn(state, 'DE', 'ironMine', 80, 40, 'hills');

  me(state).cash = 10_000;
  state.countries.DE.cash = 0;
  payWages(state);

  equal(me(state).solvent, true, 'you are fine');
  equal(state.countries.DE.solvent, false, 'Germany missed its payroll');
  equal(yours.staffed, true, 'your site keeps running');
  equal(theirs.staffed, false, 'theirs idles');
});

// ---- other nations ---------------------------------------------------------

test('a government builds its own industry out of its treasury', () => {
  const state = fixture();
  const before = state.countries.RU.cash;
  for (let i = 0; i < 200; i++) runTick(state);

  const theirs = buildingsOf(state, 'RU');
  assert(theirs.length > 0, 'Russia should have built something within 200 ticks');
  assert(theirs.every((b) => b.owner === 'RU'), 'a government builds only at home');
  assert(state.countries.RU.cash !== before, 'the treasury should have moved');
});

test('nothing but you ever builds on your soil', () => {
  const state = fixture();
  for (let i = 0; i < 200; i++) runTick(state);
  equal(buildingsOf(state, state.home).length, 0, 'you built nothing, so your land is empty');
  assert(!state.buildings.some((b) => state.tiles[b.tileId].countryId === state.home),
    'and no other government took a tile of it');
});

test('a broke government closes plants instead of sinking forever', () => {
  const state = fixture();
  placeIn(state, 'DE', 'warehouse', 80, 40, 'plain');
  for (let i = 0; i < 6; i++) placeIn(state, 'DE', 'ironMine', 80 + i, 41, 'hills');
  state.countries.DE.cash = -1;
  state.countries.DE.solvent = false;
  const before = buildingsOf(state, 'DE').length;

  state.tick = CONFIG.stateBuildEvery;
  runStateIndustry(state);

  assert(buildingsOf(state, 'DE').length < before, 'it shut something down');
  assert(buildingsOf(state, 'DE').some((b) => b.store), 'but it kept the warehouse');
});

test('a warehouse will not serve a site belonging to someone else', () => {
  const state = fixture();
  placeIn(state, 'DE', 'warehouse', 80, 40, 'plain');
  const mine = placeIn(state, 'DE', 'ironMine', 81, 40, 'hills');

  equal(warehousesServing(state, mine.x, mine.y, state.home).length, 0,
    'a German depot is not your infrastructure');
  equal(warehousesServing(state, mine.x, mine.y, 'DE').length, 1,
    'it does serve its own owner');
});

test('you cannot demolish what you do not own', () => {
  const state = fixture();
  const depot = placeIn(state, 'DE', 'warehouse', 80, 40, 'plain');
  const result = demolish(state, state.tiles[depot.tileId]);
  equal(result.ok, false, 'refused');
  equal(state.buildings.length, 1, 'still standing');
});

// ---- what the panels read ---------------------------------------------------

test('a site reports how much of the time it is actually working', () => {
  const state = fixture();
  place(state, 'warehouse', 5, 5, 'plain');
  const mine = place(state, 'ironMine', 4, 4, 'hills');
  const mill = place(state, 'steelMill', 5, 4, 'plain');

  for (let i = 0; i < 30; i++) runTick(state);

  assert(mine.uptime > 0.8, `a mine on its own deposit should read as working, got ${mine.uptime}`);
  assert(mill.uptime < mine.uptime, 'a mill waiting on coal cannot be working as hard as the mine feeding it');
});

test('a new site has not worked a tick yet', () => {
  const state = fixture();
  const depot = place(state, 'warehouse', 5, 5, 'plain');
  equal(depot.uptime, 0, 'a site opens at nought');
});

test('building and demolishing your own sites announce themselves', () => {
  const state = fixture();
  const depot = place(state, 'warehouse', 5, 5, 'plain');
  assert(state.alerts.some((a) => a.text.includes('Warehouse') && a.text.includes('built')),
    'building said so');

  state.alerts = [];
  demolish(state, state.tiles[depot.tileId]);
  assert(state.alerts.some((a) => a.text.includes('demolished')), 'demolishing said so');
});

test('the other governments build without interrupting you', () => {
  const state = fixture();
  placeIn(state, 'DE', 'warehouse', 80, 40, 'plain');
  equal(state.alerts.length, 0, 'a German depot is not your news');
});

test('a message clears itself once its time is up', () => {
  const state = fixture();
  pushAlert(state, 'Something happened.', 'info');
  const at = state.alerts[0].at;

  equal(pruneAlerts(state, at + CONFIG.alertTtlMs - 1), false, 'nothing expires early');
  equal(state.alerts.length, 1, 'still on screen');

  equal(pruneAlerts(state, at + CONFIG.alertTtlMs + 1), true, 'it expires');
  equal(state.alerts.length, 0, 'and is gone');
});

test('a message that keeps firing keeps its place', () => {
  const state = fixture();
  pushAlert(state, 'Payroll missed.', 'danger');
  const first = state.alerts[0].at;
  state.alerts[0].at = first - CONFIG.alertTtlMs;   // as if it were about to expire
  pushAlert(state, 'Payroll missed.', 'danger');

  equal(state.alerts.length, 1, 'a repeat is not a second message');
  equal(state.alerts[0].count, 2, 'it counts instead');
  assert(state.alerts[0].at > first - CONFIG.alertTtlMs, 'and its clock restarts');
});

test('a message can be dismissed by hand', () => {
  const state = fixture();
  pushAlert(state, 'One.', 'info');
  pushAlert(state, 'Two.', 'info');
  equal(dismissAlert(state, 0), true, 'dismissed');
  equal(state.alerts.length, 1, 'one left');
  equal(dismissAlert(state, 5), false, 'and nothing else to dismiss');
});

// ---- chains ----------------------------------------------------------------

test('a full ore + coal -> steel chain delivers steel', () => {
  const state = fixture();
  place(state, 'warehouse', 5, 5, 'plain');
  place(state, 'ironMine', 4, 4, 'hills');
  place(state, 'coalMine', 6, 6, 'coalfield');
  const mill = place(state, 'steelMill', 5, 4, 'plain');

  for (let i = 0; i < 12; i++) runTick(state);

  assert(mill.status === 'running', 'the mill should be fed within 12 ticks');
});

test('a full crude -> fuel chain delivers fuel', () => {
  const state = fixture();
  place(state, 'warehouse', 5, 5, 'plain');
  place(state, 'oilRig', 4, 4, 'oilfield');
  const refinery = place(state, 'refinery', 5, 4, 'plain');

  for (let i = 0; i < 15; i++) runTick(state);

  assert(refinery.status === 'running', 'the refinery should be fed within 15 ticks');
});

test('a gas well powers a plant', () => {
  const state = fixture();
  place(state, 'warehouse', 20, 20, 'plain');
  place(state, 'gasWell', 19, 19, 'gasfield');
  const plant = place(state, 'gasPlant', 21, 20, 'plain');

  for (let i = 0; i < 12; i++) runTick(state);

  assert(plant.status === 'running', 'power should be flowing within 12 ticks');
});

test('a copper chain runs from ore and power to refined copper', () => {
  const state = fixture();
  place(state, 'warehouse', 20, 20, 'plain');
  place(state, 'copperMine', 19, 19, 'copperbelt');
  place(state, 'coalMine', 18, 20, 'coalfield');
  place(state, 'coalPlant', 21, 19, 'plain');
  const smelter = place(state, 'copperSmelter', 21, 21, 'plain');

  for (let i = 0; i < 20; i++) runTick(state);

  assert(smelter.status === 'running', 'the smelter should be fed within 20 ticks');
});

test('a farm feeds a food plant', () => {
  const state = fixture();
  place(state, 'warehouse', 20, 20, 'plain');
  place(state, 'farm', 19, 19, 'farmland');
  const plant = place(state, 'foodPlant', 21, 20, 'plain');

  for (let i = 0; i < 12; i++) runTick(state);

  assert(plant.status === 'running', 'the food plant should be fed within 12 ticks');
});

test('a three-input assembly holds every input until all are present', () => {
  const state = fixture();
  const plant = place(state, 'vehiclePlant', 20, 20, 'plain');
  plant.input.machinery = 2;
  plant.input.steel = 3;
  plant.input.electronics = 0;

  produce(state);

  equal(plant.input.machinery, 2, 'machinery held back');
  equal(plant.input.steel, 3, 'steel held back');
  equal(plant.status, 'starved', 'status');
  assert(plant.shortage.includes('electronics'), 'shortage should name electronics');

  plant.input.electronics = 2;
  produce(state);
  equal(plant.input.machinery, 0, 'machinery consumed once complete');
  equal(plant.input.steel, 0, 'steel consumed once complete');
  equal(plant.input.electronics, 0, 'electronics consumed once complete');
});

test('an aluminium plant is the power hog it is meant to be', () => {
  const alu = BUILDINGS.aluminiumPlant.recipe;
  const smelter = BUILDINGS.copperSmelter.recipe;
  assert(alu.in.power / alu.out.aluminium > smelter.in.power / smelter.out.copper,
    'aluminium must cost more power per unit than copper');
});

test('a site with no warehouse in range fills its output buffer and blocks', () => {
  const state = fixture();
  const mine = place(state, 'ironMine', 1, 1, 'hills');

  for (let i = 0; i < 40; i++) runTick(state);

  equal(mine.status, 'blocked', 'mine blocks once its output buffer is full');
  equal(mine.output.ore, 60, 'output capped at the buffer size');
});

test('goods only leave a warehouse, never a factory floor', () => {
  const state = fixture();
  const mine = place(state, 'ironMine', 40, 40, 'hills');
  me(state).cash = 0;

  for (let i = 0; i < 6; i++) runTick(state);

  assert(mine.output.ore > 0, 'the ore piles up where it was dug');
  equal(warehouseStock(state, 'ore'), 0, 'and none of it is stock');
  equal(state.markets[state.home].ore.soldLastTick, 0, 'nothing was sold');
});

test('holding a commodity back keeps it out of the export market', () => {
  const state = fixture();
  const partner = COUNTRY_IDS.find((id) => id !== state.home && hasPact(state, id));
  const depot = place(state, 'warehouse', 20, 20, 'plain');
  depot.store.steel = 500;
  state.markets[state.home].steel.price = COMMODITIES.steel.basePrice * 0.5;
  state.markets[partner].steel.price = COMMODITIES.steel.basePrice * 1.5;
  state.exports.steel = false;

  runTrade(state);

  equal(depot.store.steel, 500, 'held stock stays put');
  equal(me(state).report.exports, 0, 'and earns nothing');
});

// ---- importing what you cannot dig up --------------------------------------

// The failure this fixes: a nation with no coalfield could never run a coal
// plant or a steel mill, because every unit it bought abroad was eaten by its
// population on arrival. Feedstock lands in the WAREHOUSES instead.
test('a nation with no coal can buy coal for its factories', () => {
  const state = fixture();
  const partner = COUNTRY_IDS.find((id) => id !== state.home && hasPact(state, id));
  const depot = place(state, 'warehouse', 20, 20, 'plain');
  place(state, 'coalPlant', 21, 20, 'plain');
  placeIn(state, partner, 'warehouse', 60, 60, 'plain').store.coal = 4000;
  // A real gap: the coal is cheap where it sits and dear where it is wanted.
  state.markets[partner].coal.price = COMMODITIES.coal.basePrice * 0.5;
  state.markets[state.home].coal.price = COMMODITIES.coal.basePrice * 1.6;
  state.countries[partner].cash = 1_000_000;

  runTrade(state);

  assert(depot.store.coal > 0, 'imported feedstock has to reach a warehouse to be worth anything');
  assert(state.ledger.tick.coal.feedstock > 0, 'and it is booked as feedstock, not as groceries');
  assert(me(state).report.imports > 0, 'it is paid for like any other import');
});

test('feedstock is not counted as feeding anybody', () => {
  const state = fixture();
  const partner = COUNTRY_IDS.find((id) => id !== state.home && hasPact(state, id));
  const depot = place(state, 'warehouse', 20, 20, 'plain');
  place(state, 'steelMill', 21, 20, 'plain');
  placeIn(state, partner, 'warehouse', 60, 60, 'plain').store.coal = 4000;
  state.markets[partner].coal.price = COMMODITIES.coal.basePrice * 0.5;
  state.markets[state.home].coal.price = COMMODITIES.coal.basePrice * 1.6;
  // Your people already have all the coal they want this tick.
  state.markets[state.home].coal.importedLastTick = appetite(state, state.home, 'coal');
  const met = supplyRatio(state, state.home, 'coal');

  runTrade(state);

  assert(depot.store.coal > 0, 'the mill still gets its coal');
  close(supplyRatio(state, state.home, 'coal'), met, 0.0001,
    'a cargo on its way to a factory floor must not read as a fed population');
});

test('a nation buys no more feedstock than its factories can burn', () => {
  const state = fixture();
  const partner = COUNTRY_IDS.find((id) => id !== state.home && hasPact(state, id));
  const depot = place(state, 'warehouse', 20, 20, 'plain');
  place(state, 'coalPlant', 21, 20, 'plain');
  placeIn(state, partner, 'warehouse', 60, 60, 'plain').store.coal = 40_000;
  state.markets[partner].coal.price = COMMODITIES.coal.basePrice * 0.4;
  state.markets[state.home].coal.price = COMMODITIES.coal.basePrice * 1.8;
  state.countries[partner].cash = 1_000_000;
  me(state).cash = 50_000_000;

  runTrade(state);

  const recipe = BUILDINGS.coalPlant.recipe;
  const burn = recipe.in.coal / recipe.ticks;
  assert(depot.store.coal <= burn * CONFIG.trade.inputBuffer + 0.001,
    `a treasury must not corner a market in one tick, got ${depot.store.coal}`);
});

test('a nation with nowhere to put it buys no feedstock at all', () => {
  const state = fixture();
  const partner = COUNTRY_IDS.find((id) => id !== state.home && hasPact(state, id));
  place(state, 'coalPlant', 21, 20, 'plain');   // no depot anywhere
  placeIn(state, partner, 'warehouse', 60, 60, 'plain').store.coal = 4000;
  state.markets[partner].coal.price = COMMODITIES.coal.basePrice * 0.4;
  state.markets[state.home].coal.price = COMMODITIES.coal.basePrice * 1.8;
  // Nothing for the population either, so anything bought would be feedstock.
  state.markets[state.home].coal.importedLastTick = appetite(state, state.home, 'coal');

  runTrade(state);

  equal(me(state).report.imports, 0, 'nothing is bought that cannot be put away');
});

test('a chain that needs an import runs on one', () => {
  const state = fixture();
  const partner = COUNTRY_IDS.find((id) => id !== state.home && hasPact(state, id));
  place(state, 'warehouse', 20, 20, 'plain');
  place(state, 'ironMine', 19, 19, 'hills');
  const mill = place(state, 'steelMill', 21, 20, 'plain');
  const theirs = placeIn(state, partner, 'warehouse', 60, 60, 'plain');
  state.countries[partner].cash = 1_000_000;

  for (let i = 0; i < 30; i++) {
    theirs.store.coal = 2000;   // a partner that keeps producing coal
    runTick(state);
  }

  assert(state.ledger.total.coal.feedstock > 0, 'the coal was bought in');
  assert(mill.uptime > 0.3, `a mill on imported coal should be working, got ${mill.uptime.toFixed(2)}`);
  assert(state.ledger.total.steel.made > 0, 'and turning out steel');
});

// ---- the commodity ledger --------------------------------------------------

test('the ledger books what you made, burned, sold and shipped', () => {
  const state = fixture();
  place(state, 'warehouse', 20, 20, 'plain');
  place(state, 'farm', 19, 19, 'farmland');
  place(state, 'foodPlant', 21, 20, 'plain');

  for (let i = 0; i < 12; i++) runTick(state);

  const grain = state.ledger.total.grain;
  const food = state.ledger.total.food;
  assert(grain.made > 0, 'the farm turned out grain');
  assert(grain.used > 0, 'and the food plant burned some of it');
  assert(food.made > 0, 'which became food');
  assert(food.sold > 0 && food.revenue > 0, 'and your people bought it');
});

test('the ledger folds the tick into the total and starts the next one empty', () => {
  const state = fixture();
  place(state, 'warehouse', 20, 20, 'plain');
  place(state, 'farm', 19, 19, 'farmland');

  runTick(state);
  const first = state.ledger.tick.grain.made;
  assert(first > 0, 'the tick just run is what the panels read');

  runTick(state);
  equal(state.ledger.tick.grain.made, first, 'each tick reports itself, not a running sum');
  equal(state.ledger.total.grain.made, first, 'and the finished tick is what lands in the total');
});

test('only your own industry is booked', () => {
  const state = fixture();
  placeIn(state, 'DE', 'warehouse', 80, 40, 'plain');
  placeIn(state, 'DE', 'farm', 81, 40, 'farmland');

  for (let i = 0; i < 6; i++) runTick(state);

  equal(state.ledger.total.grain.made, 0, 'a German farm is not your ledger');
});

// ---- what the trade panel reads --------------------------------------------

test('your own deals are never crowded out by the rest of the world', () => {
  const state = fixture();
  const partner = COUNTRY_IDS.find((id) => id !== state.home && hasPact(state, id));
  recordFlow(state, { tick: 1, from: state.home, to: partner, commodity: 'steel', qty: 5, value: 500 });
  for (let i = 0; i < CONFIG.maxFlows * 2; i++) {
    recordFlow(state, { tick: 2, from: 'DE', to: 'FR', commodity: 'steel', qty: 1, value: 10 });
  }

  equal(state.flows.length, CONFIG.maxFlows, 'the world list is capped');
  assert(!state.flows.some((f) => f.from === state.home), 'and your deal has been pushed off it');
  assert(ownFlows(state).some((f) => f.from === state.home),
    'which is exactly why your own deals are kept in a list of their own');
});

// ---- being asked ------------------------------------------------------------

test('a nation with goods it cannot place offers you a pact', () => {
  const state = fixture();
  const suitor = neighboursOf(state.home).find((id) => !hasPact(state, id));
  placeIn(state, suitor, 'warehouse', 60, 60, 'plain').store.steel = 500;
  // Only one nation on earth can afford to ask, so the roll has one candidate.
  for (const id of COUNTRY_IDS) state.countries[id].cash = 0;
  state.countries[suitor].cash = pactCost(suitor) * 10;

  state.tick = CONFIG.diplomacy.every;
  runDiplomacy(state);

  const offer = offerFrom(state, suitor);
  assert(offer, `${suitor} should have come knocking`);
  assert(offer.fee > 0 && offer.fee < pactCost(suitor),
    'being courted costs less than courting, but it is not free');
});

test('accepting an offered pact pays you rather than costing you', () => {
  const state = fixture();
  const suitor = COUNTRY_IDS.find((id) => id !== state.home && !hasPact(state, id));
  const fee = offerFee(suitor);
  state.offers = [{ from: suitor, fee, tick: state.tick }];
  state.countries[suitor].cash = fee * 4;
  me(state).cash = 0;

  const result = acceptOffer(state, suitor);

  equal(result.ok, true, 'accepted');
  equal(me(state).cash, fee, 'the fee lands in your treasury');
  equal(state.countries[suitor].cash, fee * 3, 'and leaves theirs');
  assert(hasPact(state, suitor), 'the market is open');
  equal(state.offers.length, 0, 'and the offer is off the table');
});

test('an offer can be declined, and lapses if you never answer', () => {
  const state = fixture();
  const suitor = COUNTRY_IDS.find((id) => id !== state.home && !hasPact(state, id));
  state.offers = [{ from: suitor, fee: 1000, tick: 0 }];

  equal(declineOffer(state, suitor).ok, true, 'declined');
  equal(state.offers.length, 0, 'gone');
  assert(!hasPact(state, suitor), 'and no pact was opened');

  state.offers = [{ from: suitor, fee: 1000, tick: 0 }];
  state.tick = CONFIG.diplomacy.ttl + 1;
  runDiplomacy(state);
  equal(state.offers.length, 0, 'an offer nobody answers does not stand forever');
});

test('a government too poor to pay does not offer', () => {
  const state = fixture();
  for (const id of COUNTRY_IDS) state.countries[id].cash = 0;
  state.tick = CONFIG.diplomacy.every;
  runDiplomacy(state);
  equal(state.offers.length, 0, 'a treasury that cannot cover the fee has no business offering it');
});

// ---- other governments -----------------------------------------------------

test('a government will build a plant on an input it has to import', () => {
  const state = fixture();
  // Japan has no coalfield, so before feedstock existed it could never plan a
  // plant that burns coal, however rich it was.
  placeIn(state, 'JP', 'warehouse', 100, 60, 'plain');
  placeIn(state, 'JP', 'ironMine', 101, 60, 'hills');
  for (let x = 102; x < 108; x++) claim(state, 'JP', x, 60, 'plain');
  // ...and the world has coal standing in a warehouse, so it can be bought.
  placeIn(state, 'RU', 'warehouse', 40, 20, 'plain').store.coal = 2000;
  state.countries.JP.cash = 5_000_000;

  state.tick = CONFIG.stateBuildEvery;
  runStateIndustry(state);

  const burnsCoal = buildingsOf(state, 'JP')
    .filter((b) => BUILDINGS[b.type].recipe?.in?.coal);
  assert(burnsCoal.length > 0,
    'a country with no coalfield should still be able to plan around bought coal');
});

test('a government builds more than one site when it can plainly afford to', () => {
  const state = fixture();
  state.countries.RU.cash = 50_000_000;
  const before = buildingsOf(state, 'RU').length;

  state.tick = CONFIG.stateBuildEvery;
  runStateIndustry(state);

  const built = buildingsOf(state, 'RU').length - before;
  assert(built > 1, 'a full treasury should turn into industry rather than sitting there');
  assert(built <= CONFIG.stateBuildsPerDecision, 'but never more than the decision allows');
});

// ---- the nation table -------------------------------------------------------

test('every nation is scored against the rest of the world', () => {
  const state = fixture();
  place(state, 'warehouse', 20, 20, 'plain');
  for (let i = 0; i < 60; i++) runTick(state);

  const rows = scoreNations(state);
  equal(rows.length, COUNTRY_IDS.length, 'the table is the whole world');
  for (const row of rows) {
    assert(row.score >= 0 && row.score <= 100, `${row.id} scores off the scale: ${row.score}`);
  }
  const best = rows.reduce((a, b) => (a.score > b.score ? a : b));
  const worst = rows.reduce((a, b) => (a.score < b.score ? a : b));
  assert(best.score > worst.score, 'a score that separates nobody says nothing');
  assert(best.economy > worst.economy || best.sites > worst.sites,
    'and the leader has to lead on something');
});

// ---- loop ------------------------------------------------------------------

function fakeClock() {
  let callback = null;
  return {
    schedule(fn) { callback = fn; return 1; },
    cancel() { callback = null; },
    advance(now) { const fn = callback; callback = null; if (fn) fn(now); },
  };
}

function loopFixture(overrides = {}) {
  const state = fixture();
  Object.assign(state, { paused: false, speed: 1 }, overrides);
  const clock = fakeClock();
  const counts = { ticks: 0, renders: 0 };
  const loop = createLoop({
    ctx: { state },
    onTick: () => counts.ticks++,
    onRender: () => counts.renders++,
    schedule: clock.schedule,
    cancel: clock.cancel,
  });
  loop.start();
  clock.advance(0);
  return { state, clock, counts, loop };
}

test('the loop accumulates part-frames into exactly one tick per second', () => {
  const { clock, counts } = loopFixture();
  for (const t of [250, 500, 750]) { clock.advance(t); }
  equal(counts.ticks, 0, 'no tick before a full second of frames');
  clock.advance(1000);
  equal(counts.ticks, 1, 'the fourth 250ms frame completes the second');
  equal(counts.renders, 1, 'one render per tick batch, not per frame');
});

test('leftover time carries into later frames instead of being dropped', () => {
  const { clock, counts } = loopFixture();
  let now = 0;
  for (let i = 0; i < 8; i++) { now += 250; clock.advance(now); }
  equal(counts.ticks, 2, '2000ms of frames yields exactly two ticks');
});

test('speed multiplies ticks without changing real elapsed time', () => {
  const { clock, counts } = loopFixture({ speed: 4 });
  clock.advance(250);
  equal(counts.ticks, 1, 'a single 250ms frame at 4x completes a whole tick');
});

test('a paused loop never ticks and discards accumulated time', () => {
  const { state, clock, counts } = loopFixture({ paused: true });
  clock.advance(5000);
  equal(counts.ticks, 0, 'no ticks while paused');
  state.paused = false;
  clock.advance(5200);
  equal(counts.ticks, 0, 'time spent paused is not banked into a burst');
});

test('a long stall is clamped and cannot trigger a catch-up spiral', () => {
  const { clock, counts } = loopFixture({ speed: 4 });
  clock.advance(600_000);
  assert(counts.ticks <= 5, `a ten-minute stall must not burst past the catch-up cap, got ${counts.ticks}`);
  equal(counts.ticks, 1, 'the stalled frame is clamped to maxFrameMs of simulated work');
});

export function runTests(filter = '') {
  const needle = filter.trim().toLowerCase();
  const selected = needle ? tests.filter((t) => t.name.toLowerCase().includes(needle)) : tests;
  const results = selected.map(({ name, fn }) => {
    try {
      fn();
      return { name, ok: true };
    } catch (error) {
      return { name, ok: false, error: error.message };
    }
  });
  results.skipped = tests.length - selected.length;
  return results;
}

const isNode = typeof process !== 'undefined' && process.versions?.node && typeof document === 'undefined';
if (isNode) {
  const results = runTests(process.argv[2] ?? '');
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : `\n      ${r.error}`}`);
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passing`);
  process.exit(failed ? 1 : 0);
}
