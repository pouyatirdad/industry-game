import { CONFIG } from '../core/config.js';
import { COUNTRY_IDS } from '../data/countries.js';
import { depotsByOwner, stockIn } from './logistics.js';
import { projectedWages, isAlive } from '../core/state.js';
import { relationOf, createMilitaryUnit, moveMilitaryUnit, unitsOf, unitOnTile, unitShortfall,
  canMilitaryEnter, terroristStrength, UNIT_TYPES, UNIT_IDS } from './military.js';
import { landOf } from './worldIndex.js';

// THE WORLD'S ARMIES.
//
// `stateIndustry.js` decides what the other governments BUILD; this decides what
// they RAISE and where they send it. It is the same shape of file and for the
// same reason: nothing here is special-cased, because it goes through
// `createMilitaryUnit` and `moveMilitaryUnit` exactly as your own buttons do —
// same costs out of the same warehouses, the same treasury fallback when those
// warehouses are bare, and the same access rules.
//
// Three rules in it are load-bearing, and each one is here because the obvious
// version of it went wrong:
//
//   - AN ARMY IS SIZED BY THE ECONOMY, NOT THE TREASURY. `CONFIG.army.perDemand`
//     against `demand` is what stops the United States fielding six hundred
//     divisions and DR Congo none. Money can PAY for a formation, but it does
//     not decide how many a government wants.
//   - IT SPENDS GOODS BEFORE MONEY. Drawing the batch out of its own depots is
//     much the cheaper route, so `affordableType` exhausts that first and only
//     then buys the shortfall in — and when it does buy, it buys the cheapest
//     formation rather than the best. `costHeadroom` guards the goods route so a
//     government does not convert every scrap of surplus into infantry the tick
//     it appears; `stateReserveTicks` guards the money route so it does not buy
//     an army with the wages of the industry paying for it.
//   - IT MOVES WITH A REASON. A government orders formations at a terrorist
//     cell on its own soil, or at an enemy it is actually at war with. It does
//     not wander, because a hundred and fifty armies drifting across the map is
//     noise, not a world.

export function runStateMilitary(state) {
  if (state.tick % CONFIG.stateArmyEvery !== 0) return;
  const depots = depotsByOwner(state);
  // Enemy sites are indexed ONCE for the whole world rather than per country,
  // the same reason `collect` and `contracts` index depots once.
  const sitesByOwner = new Map();
  for (const b of state.buildings) {
    const list = sitesByOwner.get(b.owner);
    if (list) list.push(b); else sitesByOwner.set(b.owner, [b]);
  }
  const unitsByOwner = new Map();
  for (const u of state.military?.units ?? []) {
    const list = unitsByOwner.get(u.owner);
    if (list) list.push(u); else unitsByOwner.set(u.owner, [u]);
  }
  const cell = state.terrorism?.active ?? null;

  for (const id of COUNTRY_IDS) {
    // Your own army is yours to raise and yours to move. Nothing here touches it.
    if (id === state.home) continue;
    const gov = state.countries[id];
    if (!gov?.solvent || !isAlive(state, id)) continue;
    const own = unitsOf(state, id);
    raiseOne(state, id, own, depots.get(id) ?? []);
    orderArmy(state, id, own, sitesByOwner, unitsByOwner, cell);
  }
}

// How many formations this government wants standing. Its economy sets the
// baseline; a war or a cell on its own soil multiplies it, because an army is
// answer to a threat rather than an ornament.
export function armyTarget(state, countryId) {
  const gov = state.countries[countryId];
  if (!gov) return 0;
  const { perDemand, min, max, warFactor, terrorMargin } = CONFIG.army;
  let want = gov.demand * perDemand;
  // A war being FOUGHT and a war about to start want the same army — see
  // `mobilising`. Preparing after the shooting begins is preparing too late.
  if (atWar(state, countryId) || mobilising(state, countryId)) want *= warFactor;
  // A CELL IS A FIXED FORCE, so the answer to one is a fixed number of
  // formations rather than a percentage more than you happened to have.
  //
  // This was a multiplier once and it did nothing: a small nation's target is 1,
  // and one-and-a-half rounds back to 1. What that produced was Andorra sending
  // its single rifleman at a cell four times its strength, standing there, and
  // losing every factory it owned. The count is worked out from the DATA — the
  // cell's strength against the weakest formation anyone could raise — so it
  // stays right if either is ever retuned.
  const active = state.terrorism?.active;
  if (active?.countryId === countryId) {
    const weakest = UNIT_IDS.reduce((low, id) => Math.min(low, UNIT_TYPES[id].strength), Infinity);
    want = Math.max(want, Math.ceil(terroristStrength(active) * terrorMargin / weakest));
  }
  return Math.max(min, Math.min(max, Math.round(want)));
}

export function atWar(state, countryId) {
  const row = state.diplomacy?.relations?.[countryId] ?? {};
  return Object.values(row).some((relation) => relation === 'war');
}

// A war DECLARED on this government, or by it, that has nearly run its
// ultimatum. It counts as a war for the purposes of how big an army to want.
//
// The whole point of a declaration waiting is that both sides can see it coming,
// so a government had better use the time: raising an army only once the
// shooting started meant the formations arrived long after they were needed, and
// the hundred ticks of warning bought the defender nothing at all.
export function mobilising(state, countryId) {
  const { mobiliseAt } = CONFIG.diplomacy;
  return (state.diplomacy?.ultimatums ?? []).some((u) =>
    (u.from === countryId || u.to === countryId) && u.beginsAt - state.tick <= mobiliseAt);
}

// One formation per decision, and only what it can comfortably pay for. The
// type is the DEAREST it can afford out of stock — a nation that can build
// armour builds armour, one that can only spare rations raises riflemen — which
// is how an economy shows up in an order of battle without a single line of
// code reading a country's name.
function raiseOne(state, countryId, own, depots) {
  if (own.length >= armyTarget(state, countryId)) return;
  const type = affordableType(state, countryId, depots);
  if (!type) return;
  const tile = musterTile(state, countryId, depots);
  if (!tile) return;
  createMilitaryUnit(state, countryId, type, tile.id);
}

// What this government will raise, and it prefers GOODS to money every time.
//
// First choice is anything its own warehouses can cover outright with
// `costHeadroom` to spare, walked from the strongest down so a nation sitting on
// steel does not raise riflemen. Only if nothing qualifies does it reach for the
// treasury, and then it buys the CHEAPEST thing it can rather than the best —
// procurement is dear (`CONFIG.army.cashMarkup`), so a government that has to
// pay for its army buys a rifleman, not an aircraft.
//
// The treasury route is what put armies in the world at all. Measured before it
// existed, every large nation held zero food at every phase of the tick, so the
// United States fielded one rifleman while wanting eleven.
function affordableType(state, countryId, depots) {
  const ranked = UNIT_IDS.slice().sort((a, b) => UNIT_TYPES[b].strength - UNIT_TYPES[a].strength);
  for (const type of ranked) {
    const def = UNIT_TYPES[type];
    let covered = true;
    for (const [id, qty] of Object.entries(def.cost)) {
      if (stockIn(depots, id) < qty * CONFIG.army.costHeadroom) { covered = false; break; }
    }
    if (covered) return type;
  }
  // Nothing on the shelves. Keep back the same payroll reserve `considerBuild`
  // keeps: an army bought with the wages of the industry that pays for it is a
  // bad trade, and a government that spends into insolvency idles every site.
  const gov = state.countries[countryId];
  if (!gov) return null;
  const reserve = projectedWages(state, countryId) * CONFIG.stateReserveTicks;
  const priced = ranked
    .map((type) => ({ type, cash: unitShortfall(state, countryId, type, depots).cash }))
    .sort((a, b) => a.cash - b.cash);
  for (const option of priced) {
    if (gov.cash - option.cash >= reserve) return option.type;
  }
  return null;
}

// Ground beside one of its own depots. Beside rather than on, because a
// warehouse occupies its tile — and near it, because that is where its goods
// are.
//
// A nation with NO depot still musters somewhere: it is buying the whole batch
// out of the treasury, and procurement needs no warehouse to come out of. The
// fallback walks its own land for the first free square, which is slower and is
// only ever reached by a government that owns no storage at all.
function musterTile(state, countryId, depots) {
  const w = state.grid.w;
  for (const depot of depots) {
    for (let oy = -2; oy <= 2; oy++) {
      for (let ox = -2; ox <= 2; ox++) {
        const x = depot.x + ox;
        const y = depot.y + oy;
        if (x < 0 || y < 0 || x >= w || y >= state.grid.h) continue;
        const tile = state.tiles[y * w + x];
        if (!tile || tile.countryId !== countryId) continue;
        if (tile.terrain === 'water' || tile.buildingId != null) continue;
        if (unitOnTile(state, tile.id)) continue;
        return tile;
      }
    }
  }
  if (depots.length) return null;
  return state.tiles.find((tile) => tile.countryId === countryId
    && tile.terrain !== 'water' && tile.buildingId == null && !unitOnTile(state, tile.id)) ?? null;
}

// Where an idle formation is sent. A cell on its own soil first — that is the
// threat it can actually do something about, and defeating one pays — then the
// nearest site of somebody it is at war with. A formation already under orders
// is left alone: re-deciding every fifteen ticks is how an army ends up
// oscillating between two targets and arriving at neither.
function orderArmy(state, countryId, own, sitesByOwner, unitsByOwner, cell) {
  if (!own.length) return;
  const idle = own.filter((u) => u.orderTileId == null);
  if (!idle.length) return;

  if (cell && cell.countryId === countryId) {
    for (const unit of idle) moveMilitaryUnit(state, unit.id, cell.tileId);
    return;
  }
  const enemies = COUNTRY_IDS.filter((id) => relationOf(state, countryId, id) === 'war');
  if (!enemies.length) return;
  // ONE TARGET PER FORMATION while there are targets to go round. Every idle
  // unit used to be sent at the single nearest enemy site, so an army marched
  // down one road in single file and arrived as a stack on one tile — which
  // wastes it: a column that fans out takes ground on a front, and `takeGround`
  // only takes the tile a unit is actually standing on.
  //
  // Once there are more formations than sites the claims are released, because
  // by then piling onto the last few is the right answer rather than standing
  // idle.
  const taken = new Set();
  for (const unit of idle) {
    let target = nearestEnemyFormation(state, unit, enemies, unitsByOwner, taken)
      ?? nearestEnemySite(state, unit, enemies, sitesByOwner, taken)
      ?? nearestEnemyLand(state, unit, enemies, taken);
    if (!target) {
      target = nearestEnemyFormation(state, unit, enemies, unitsByOwner, null)
        ?? nearestEnemySite(state, unit, enemies, sitesByOwner, null)
        ?? nearestEnemyLand(state, unit, enemies, null);
    }
    if (!target) continue;
    taken.add(target.key);
    moveMilitaryUnit(state, unit.id, spreadOut(state, unit, target));
  }
}

// Where about the target this particular formation is actually sent. Two units
// given the exact same tile walk the exact same line and arrive as a stack;
// nudging each one to its own corner of the objective sends them down their own
// roads and puts them on their own ground when they get there — which matters,
// because a formation only takes the tile it is standing on.
//
// The offset is a pure function of the unit's id, so it is stable across ticks
// (a march is not re-aimed every decision) and identical on a replayed save.
function spreadOut(state, unit, site) {
  const span = CONFIG.army.spread;
  if (span <= 0) return site.tileId;
  const ox = (unit.id % (span * 2 + 1)) - span;
  const oy = (Math.floor(unit.id / (span * 2 + 1)) % (span * 2 + 1)) - span;
  const x = site.x + ox;
  const y = site.y + oy;
  if (x < 0 || y < 0 || x >= state.grid.w || y >= state.grid.h) return site.tileId;
  const tile = state.tiles[y * state.grid.w + x];
  // Only if it is somewhere this formation could actually stand — otherwise the
  // objective itself, which it certainly can.
  return tile && canMilitaryEnter(state, unit, tile) ? tile.id : site.tileId;
}

function nearestEnemyFormation(state, unit, enemies, unitsByOwner, taken) {
  let best = null;
  let bestAway = Infinity;
  for (const enemy of enemies) {
    for (const foe of unitsByOwner.get(enemy) ?? []) {
      const key = `u${foe.id}`;
      if (taken?.has(key) || foe.tileId === unit.unreachable) continue;
      const away = Math.max(Math.abs(foe.x - unit.x), Math.abs(foe.y - unit.y));
      if (away >= bestAway) continue;
      if (!canMilitaryEnter(state, unit, state.tiles[foe.tileId])) continue;
      bestAway = away;
      best = { key, id: foe.id, tileId: foe.tileId, x: foe.x, y: foe.y };
    }
  }
  return best;
}

function nearestEnemySite(state, unit, enemies, sitesByOwner, taken) {
  let best = null;
  let bestAway = Infinity;
  for (const enemy of enemies) {
    for (const site of sitesByOwner.get(enemy) ?? []) {
      const key = `b${site.id}`;
      // Already promised to another formation this round, so this one goes
      // somewhere else and the army spreads out. `null` lifts the restriction,
      // which is what happens once every site is spoken for.
      if (taken?.has(key)) continue;
      // Somewhere this formation has already marched at and failed to reach —
      // an island, most often. Without this the government re-issues the same
      // impossible order on its very next decision, for ever.
      if (site.tileId === unit.unreachable) continue;
      const away = Math.max(Math.abs(site.x - unit.x), Math.abs(site.y - unit.y));
      if (away >= bestAway) continue;
      // No point ordering a march the access rules will refuse at the border.
      // War opens the ground, so this is nearly always true — but a land unit
      // still cannot walk to an island.
      if (!canMilitaryEnter(state, unit, state.tiles[site.tileId])) continue;
      bestAway = away;
      best = { ...site, key };
    }
  }
  return best;
}

function nearestEnemyLand(state, unit, enemies, taken) {
  let best = null;
  let bestAway = Infinity;
  for (const enemy of enemies) {
    const land = landOf(state, enemy).all;
    const step = Math.max(1, Math.floor(land.length / 64));
    for (let i = 0; i < land.length; i += step) {
      const tile = land[i];
      const key = `t${tile.id}`;
      if (taken?.has(key) || tile.id === unit.unreachable) continue;
      if (tile.terrain === 'water' || tile.buildingId != null) continue;
      const away = Math.max(Math.abs(tile.x - unit.x), Math.abs(tile.y - unit.y));
      if (away >= bestAway) continue;
      if (!canMilitaryEnter(state, unit, tile)) continue;
      bestAway = away;
      best = { key, id: tile.id, tileId: tile.id, x: tile.x, y: tile.y };
    }
  }
  return best;
}
