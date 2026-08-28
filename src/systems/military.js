import { CONFIG } from '../core/config.js';
import { BUILDINGS } from '../data/buildings.js';
import { COMMODITIES } from '../data/commodities.js';
import { COUNTRIES, COUNTRY_IDS } from '../data/countries.js';
import { isPlayer, noteLedger, pushAlert } from '../core/state.js';
import { drawFrom, depotsByOwner, stockIn } from './logistics.js';

export const RELATIONS = ['neutral', 'alliance', 'access', 'war'];
export const TERRORIST_NAMES = ['ISIS cell', 'Taliban cell', 'Insurgent camp'];

// Five formations, and what each one EATS. A unit is not a building: it is
// raised by clicking ground you own with the unit in hand, and from then on it
// draws `upkeep` out of your warehouses every tick for as long as it stands.
//
// `cost` is the batch a nation lays out to raise one — the same commodities as
// the upkeep, so "can I field this" and "can I keep it" are the same question
// asked at two scales. This file is the unit DATA exactly as buildings.js is the
// industry data: a quantity belongs here, never in the code that spends it, and
// no system reads a unit type by name.
//
// The spread across the five is the whole design:
//   infantry    — rations and nothing else. Any nation on earth can field one.
//   armoredCar  — iron and power, and a LITTLE fuel.
//   tank        — iron and power, and real fuel.
//   aircraft    — steel and power, and more fuel than anything else.
//   artillery   — a little food, copper and coal. No oil at all, which is what
//                 makes it the heavy weapon a poor nation can actually keep.
export const UNIT_TYPES = {
  infantry: {
    name: 'Infantry', glyph: '♟', domain: 'land', strength: 10,
    cost: { food: 24 },
    upkeep: { food: 1 },
    blurb: 'Riflemen. They eat and nothing else, which is why anybody can field them.',
  },
  armoredCar: {
    name: 'Armored Car', glyph: '⛝', domain: 'land', strength: 16,
    cost: { ore: 24, power: 12, fuel: 6 },
    upkeep: { ore: 0.4, power: 0.5, fuel: 0.2 },
    blurb: 'Wheeled and light. Iron and power to keep it running, and a fraction of a tank’s fuel.',
  },
  tank: {
    name: 'Tank', glyph: '⛞', domain: 'land', strength: 28,
    cost: { ore: 48, power: 24, fuel: 24 },
    upkeep: { ore: 0.8, power: 1, fuel: 1 },
    blurb: 'Iron, power and fuel by the tonne. The heaviest thing that moves on land, and it drinks like one.',
  },
  aircraft: {
    name: 'Aircraft', glyph: '✈', domain: 'air', strength: 34,
    cost: { steel: 40, power: 30, fuel: 30 },
    upkeep: { steel: 0.6, power: 1.2, fuel: 1.5 },
    blurb: 'Steel airframes on a fuel bill nothing else comes near. It overflies anything you have access to.',
  },
  artillery: {
    name: 'Artillery', glyph: '⁂', domain: 'land', strength: 22,
    cost: { food: 10, copper: 18, coal: 24 },
    upkeep: { food: 0.3, copper: 0.3, coal: 0.7 },
    blurb: 'Guns, crews and a coal-fired train of supply. Less food than infantry and not a drop of oil.',
  },
};

export const UNIT_IDS = Object.keys(UNIT_TYPES);

// What a tick it could not be supplied costs a formation. Fielding what you
// cannot feed is the mistake this mechanic exists to punish, and a unit that
// runs out of strength is gone.
const STARVED_LOSS = 0.5;
const RECOVERY = 0.5;

export function relationOf(state, a, b) {
  if (a === b) return 'self';
  return state.diplomacy?.relations?.[a]?.[b] ?? 'neutral';
}

export function setRelation(state, a, b, relation) {
  if (a === b || !RELATIONS.includes(relation)) return { ok: false, reason: 'Invalid relation.' };
  if (!state.diplomacy) state.diplomacy = { relations: {}, lastWarAt: -1 };
  if (!state.diplomacy.relations[a]) state.diplomacy.relations[a] = {};
  if (!state.diplomacy.relations[b]) state.diplomacy.relations[b] = {};
  state.diplomacy.relations[a][b] = relation;
  state.diplomacy.relations[b][a] = relation;
  if (relation === 'war') state.diplomacy.lastWarAt = state.tick;
  return { ok: true };
}

export function canMilitaryEnter(state, unit, tile) {
  if (!unit || !tile) return false;
  if (unit.domain === 'sea') return tile.terrain === 'water' || allowedLand(state, unit.owner, tile.countryId);
  if (unit.domain === 'air') return !tile.countryId || allowedLand(state, unit.owner, tile.countryId);
  return tile.terrain !== 'water' && allowedLand(state, unit.owner, tile.countryId);
}

// Is this particular square somewhere this formation could stand? Deliberately
// CHEAP: no warehouse is scanned, because the map asks it of every visible tile
// on every draw while a formation is in hand, and a depot scan per tile over a
// viewport that can be the whole planet is unaffordable. Whether the nation can
// pay for one is a separate question, asked once (`unitAffordable`).
export function deployableTile(state, owner, type, tile) {
  const def = UNIT_TYPES[type];
  if (!def || !tile) return false;
  if (tile.countryId !== owner || tile.buildingId != null) return false;
  return canMilitaryEnter(state, { owner, domain: def.domain }, tile);
}

// ...and the half that costs a scan, asked once per render rather than once per
// tile. The depot index is passed in wherever the caller already has one.
export function unitAffordable(state, owner, type, depots = depotsByOwner(state).get(owner) ?? []) {
  const def = UNIT_TYPES[type];
  if (!def || !depots.length) return false;
  for (const [commodity, qty] of Object.entries(def.cost)) {
    if (stockIn(depots, commodity) < qty) return false;
  }
  return true;
}

// "May I raise this here, and can I pay for it?" — the authoritative answer,
// asked once when a tile is actually clicked. It mutates nothing, so the panel
// can use it to explain a refusal before anything has happened.
export function canDeployUnit(state, owner, type, tile) {
  const def = UNIT_TYPES[type];
  if (!def) return { ok: false, reason: 'Unknown formation.' };
  if (!tile) return { ok: false, reason: 'No such tile.' };
  if (!tile.countryId) return { ok: false, reason: 'Unclaimed territory — no government here.' };
  if (tile.countryId !== owner) {
    return { ok: false, reason: `${COUNTRIES[tile.countryId]?.name ?? tile.countryId} is foreign soil — units muster at home.` };
  }
  if (tile.buildingId != null) return { ok: false, reason: 'Tile is already occupied.' };
  if (unitOnTile(state, tile.id)) return { ok: false, reason: 'A formation already holds that ground.' };
  if (!deployableTile(state, owner, type, tile)) return { ok: false, reason: `${def.name} cannot deploy there.` };
  const depots = depotsByOwner(state).get(owner) ?? [];
  if (!depots.length) return { ok: false, reason: 'No warehouse to draw supplies from.' };
  for (const [commodity, qty] of Object.entries(def.cost)) {
    if (stockIn(depots, commodity) < qty) {
      return { ok: false, reason: `Not enough ${COMMODITIES[commodity].name} — ${def.name} needs ${qty}.` };
    }
  }
  return { ok: true };
}

export function createMilitaryUnit(state, owner, type, tileId) {
  ensureMilitary(state);
  const tile = state.tiles[tileId];
  const check = canDeployUnit(state, owner, type, tile);
  if (!check.ok) return check;
  const def = UNIT_TYPES[type];
  const depots = depotsByOwner(state).get(owner) ?? [];
  for (const [commodity, qty] of Object.entries(def.cost)) {
    const taken = drawFrom(depots, commodity, qty);
    if (isPlayer(state, owner)) noteLedger(state, commodity, 'used', taken);
  }
  const created = {
    id: state.military.nextUnitId++,
    type,
    owner,
    domain: def.domain,
    tileId,
    x: tile.x,
    y: tile.y,
    strength: def.strength,
    // Whether last tick's supplies actually turned up. The map and the build
    // dock read it; nothing else does.
    supplied: true,
  };
  state.military.units.push(created);
  return { ok: true, unit: created };
}

export function moveMilitaryUnit(state, unitId, tileId) {
  ensureMilitary(state);
  const unit = state.military.units.find((u) => u.id === unitId);
  const tile = state.tiles[tileId];
  if (!unit || !tile) return { ok: false, reason: 'Invalid movement order.' };
  if (!canMilitaryEnter(state, unit, tile)) return { ok: false, reason: 'No military access.' };
  unit.tileId = tileId;
  unit.x = tile.x;
  unit.y = tile.y;
  return { ok: true, unit };
}

export function disbandUnit(state, unitId) {
  ensureMilitary(state);
  const before = state.military.units.length;
  state.military.units = state.military.units.filter((u) => u.id !== unitId);
  return before === state.military.units.length ? { ok: false, reason: 'No such unit.' } : { ok: true };
}

export function unitsOf(state, owner) {
  return (state.military?.units ?? []).filter((u) => u.owner === owner);
}

export function unitOnTile(state, tileId) {
  return (state.military?.units ?? []).find((u) => u.tileId === tileId) ?? null;
}

// What a nation's standing army draws per tick, by commodity. The build dock
// shows it, so raising another squadron is a decision taken with the running
// bill already on screen.
export function upkeepOf(state, owner) {
  const bill = {};
  for (const unit of unitsOf(state, owner)) {
    for (const [commodity, qty] of Object.entries(UNIT_TYPES[unit.type]?.upkeep ?? {})) {
      bill[commodity] = (bill[commodity] ?? 0) + qty;
    }
  }
  return bill;
}

export function runMilitary(state) {
  ensureMilitary(state);
  supplyUnits(state);
  // Your own army gets first say: a formation standing on the cell's ground
  // resolves the fight before the cell gets to spawn a replacement or take
  // another step, so a defeat this tick truly ends it this tick.
  resolveTerrorCombat(state);
  spawnTerrorists(state);
  runTerrorists(state);
}

// What a cell is MADE of, from its rifleman count. Armoured cars are one per
// `carsPer` riflemen, so "fewer cars than infantry" holds at every size, and
// there is deliberately no third entry: a cell cannot field a tank, an aircraft
// or a gun, because it has no industry and no government behind it. Unlike a
// standing army, this force never grows past what it spawned with.
export function terroristForce(active) {
  const infantry = active?.infantry ?? 0;
  return {
    infantry,
    armoredCar: Math.floor(infantry / CONFIG.terrorism.carsPer),
  };
}

export function terroristStrength(active) {
  const force = terroristForce(active);
  return force.infantry * UNIT_TYPES.infantry.strength
    + force.armoredCar * UNIT_TYPES.armoredCar.strength;
}

export function defeatTerrorists(state) {
  ensureMilitary(state);
  if (!state.terrorism.active) return false;
  state.terrorism.active = null;
  state.terrorism.defeated = (state.terrorism.defeated ?? 0) + 1;
  state.terrorism.nextSpawnTick = state.tick + CONFIG.terrorism.cooldown;
  return true;
}

// Every standing formation draws its rations, its iron, its power and its fuel
// out of its own government's depots. A unit that goes unsupplied wastes away
// rather than merely idling: an army is a running cost, and one you cannot feed
// is one you eventually do not have.
//
// Depots are indexed ONCE for the whole world's armies rather than per unit, for
// the same reason `collect` and `contracts` do it — a nation with fifty
// formations must not scan every building on earth fifty times.
function supplyUnits(state) {
  if (!state.military.units.length) return;
  const byOwner = depotsByOwner(state);
  const lost = [];
  for (const unit of state.military.units) {
    const def = UNIT_TYPES[unit.type];
    if (!def) continue;
    const depots = byOwner.get(unit.owner) ?? [];
    let short = false;
    for (const [commodity, qty] of Object.entries(def.upkeep)) {
      const taken = drawFrom(depots, commodity, qty);
      if (isPlayer(state, unit.owner)) noteLedger(state, commodity, 'used', taken);
      if (taken < qty - 1e-9) short = true;
    }
    unit.supplied = !short;
    if (short) unit.strength -= STARVED_LOSS;
    else if (unit.strength < def.strength) unit.strength = Math.min(def.strength, unit.strength + RECOVERY);
    if (unit.strength <= 0) lost.push(unit);
  }
  if (!lost.length) return;
  state.military.units = state.military.units.filter((unit) => !lost.includes(unit));
  for (const unit of lost) {
    if (!isPlayer(state, unit.owner)) continue;
    pushAlert(state, `${UNIT_TYPES[unit.type].name} at (${unit.x}, ${unit.y}) disbanded — it went unsupplied.`, 'danger');
  }
}

function allowedLand(state, owner, countryId) {
  if (!countryId) return true;
  if (countryId === owner) return true;
  const relation = relationOf(state, owner, countryId);
  return relation === 'alliance' || relation === 'access' || relation === 'war';
}

function ensureMilitary(state) {
  if (!state.military) state.military = { units: [], nextUnitId: 1 };
  if (!state.terrorism) state.terrorism = { active: null, nextSpawnTick: state.tick + CONFIG.terrorism.cooldown, defeated: 0 };
  if (!state.diplomacy) state.diplomacy = { relations: {}, lastWarAt: -1 };
}

function spawnTerrorists(state) {
  if (state.terrorism.active || state.tick < state.terrorism.nextSpawnTick) return;
  const countries = COUNTRY_IDS.filter((id) => state.countries[id]?.solvent);
  if (!countries.length) return;
  const countryId = countries[(state.seed + state.tick + (state.terrorism.defeated ?? 0) * 17) % countries.length];
  const tiles = state.tiles.filter((tile) => tile.countryId === countryId && tile.terrain !== 'water');
  if (!tiles.length) return;
  const tile = tiles[(state.seed + state.tick * 13) % tiles.length];
  const active = {
    id: `terror-${state.tick}`,
    name: TERRORIST_NAMES[(state.terrorism.defeated ?? 0) % TERRORIST_NAMES.length],
    countryId,
    tileId: tile.id,
    x: tile.x,
    y: tile.y,
    // Irregulars, counted in riflemen. Armoured cars are derived from this
    // (`terroristForce`) rather than stored, so the two can never disagree.
    // Fixed at spawn — a cell that grew stronger the longer you ignored it
    // would be a losing condition, not a problem you go and deal with.
    infantry: CONFIG.terrorism.startInfantry,
    spawnedAt: state.tick,
    movedAt: state.tick,
    // The site it is currently walking toward, re-picked once it is reached or
    // destroyed. `null` until the first move tick chooses one.
    targetId: null,
    destroyed: 0,
  };
  active.strength = terroristStrength(active);
  state.terrorism.active = active;
  // The red card over the map is driven from `terrorism.active` and stands
  // until the presence is gone; this is the one-off "it just happened" line
  // beside it, which expires like every other message.
  pushAlert(state, `${active.name} reported in ${COUNTRIES[countryId]?.name ?? countryId}.`, 'danger');
}

// A cell has no economy. It builds nothing, buys nothing and sells nothing, and
// it never grows past what it spawned with — the only thing it does is CRAWL
// toward whatever it is going to wreck next.
//
// `moveEvery` is deliberately long and `moveTiles` deliberately short
// (`CONFIG.terrorism`): the point of the mechanic is a slow-moving problem you
// go and deal with, not a fire that outruns you. It also never leaves the
// country it appeared in, because its targets are all drawn from that one
// nation's buildings.
function runTerrorists(state) {
  const active = state.terrorism.active;
  if (!active) return;
  const { moveEvery, moveTiles } = CONFIG.terrorism;
  if (state.tick - active.movedAt < moveEvery) return;
  active.movedAt = state.tick;

  // Keep the current target if it is still standing; otherwise pick the
  // nearest site of the host nation. Nearest rather than random, so the cell
  // is always working toward something and closing the distance is visible.
  let target = active.targetId != null
    ? state.buildings.find((b) => b.id === active.targetId && b.owner === active.countryId)
    : null;
  if (!target) {
    target = nearestBuilding(state, active);
    active.targetId = target?.id ?? null;
  }
  if (!target) return;

  for (let i = 0; i < moveTiles && (active.x !== target.x || active.y !== target.y); i++) {
    if (active.x !== target.x) active.x += Math.sign(target.x - active.x);
    if (active.y !== target.y) active.y += Math.sign(target.y - active.y);
  }
  active.tileId = active.y * state.grid.w + active.x;

  // Adjacent counts as arrived — a camp does not have to stand on the exact
  // tile it is raiding.
  if (Math.max(Math.abs(active.x - target.x), Math.abs(active.y - target.y)) > 1) return;
  state.buildings = state.buildings.filter((b) => b.id !== target.id);
  const tile = state.tiles[target.tileId];
  if (tile) tile.buildingId = null;
  active.destroyed++;
  active.targetId = null;
  if (isPlayer(state, target.owner)) {
    pushAlert(state, `${active.name} destroyed your ${BUILDINGS[target.type].name} at (${target.x}, ${target.y}).`, 'danger');
  }
}

function nearestBuilding(state, active) {
  let best = null;
  let bestAway = Infinity;
  for (const b of state.buildings) {
    if (b.owner !== active.countryId) continue;
    const away = Math.max(Math.abs(b.x - active.x), Math.abs(b.y - active.y));
    if (away >= bestAway) continue;
    bestAway = away;
    best = b;
  }
  return best;
}

// Your own soldiers standing where the cell is. If one government's strength
// there matches or beats it, the cell is gone — and defeating it PAYS, in real
// money landed straight in that government's treasury, so going after it is a
// decision with a return rather than only a cost.
function resolveTerrorCombat(state) {
  const active = state.terrorism.active;
  if (!active || !state.military.units.length) return;
  const strengthByOwner = new Map();
  for (const u of state.military.units) {
    if (u.tileId !== active.tileId) continue;
    strengthByOwner.set(u.owner, (strengthByOwner.get(u.owner) ?? 0) + u.strength);
  }
  for (const [owner, strength] of strengthByOwner) {
    if (strength < active.strength) continue;
    const bounty = CONFIG.terrorism.bounty;
    if (state.countries[owner]) state.countries[owner].cash += bounty;
    const name = active.name;
    defeatTerrorists(state);
    if (isPlayer(state, owner)) {
      pushAlert(state, `${name} destroyed — ${money(bounty)} bounty paid to the treasury.`, 'good');
    }
    return;
  }
}

function money(value) {
  return value >= 1_000_000 ? `$${(value / 1_000_000).toFixed(2)}M` : `$${Math.round(value).toLocaleString('en-US')}`;
}
