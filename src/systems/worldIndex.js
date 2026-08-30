// EVERY COUNTRY'S TILES, GROUPED ONCE.
//
// This lived inside `stateIndustry.js`, which was the only thing that wanted it.
// `stateMilitary.js` wants it too now — an army that marches at enemy GROUND has
// to be able to ask which ground is the enemy's — and a second copy walking a
// million tiles would double the most expensive index in the game rather than
// sharing the one already paid for.
//
// Cached against the tile array AND `state.mapVersion`:
//
//   * nothing mutates TERRAIN after generation, which is the same guarantee that
//     lets the save omit tiles entirely, so the buckets never go stale;
//   * OWNERSHIP does move, because a war moves borders — hence the version. It
//     only changes when a tile actually changes hands, so a world at peace still
//     builds this exactly once.
//
// Tiles are bucketed BY TERRAIN inside each country as well, because `findTile`
// asks for one terrain at a time: a steel mill wants plain ground, and walking
// Russia's forty-seven thousand tiles once per building type to discover that a
// coalfield is not plain is thirty-four scans of a country per decision.
const tileCache = new WeakMap();

export const EMPTY_LAND = { all: [], byTerrain: new Map() };

export function tilesByCountry(state) {
  const cached = tileCache.get(state.tiles);
  if (cached && cached.version === (state.mapVersion ?? 0)) return cached.index;
  const index = new Map();
  for (const tile of state.tiles) {
    if (!tile.countryId) continue;
    let entry = index.get(tile.countryId);
    if (!entry) { entry = { all: [], byTerrain: new Map() }; index.set(tile.countryId, entry); }
    entry.all.push(tile);
    const list = entry.byTerrain.get(tile.terrain);
    if (list) list.push(tile); else entry.byTerrain.set(tile.terrain, [tile]);
  }
  tileCache.set(state.tiles, { version: state.mapVersion ?? 0, index });
  return index;
}

export function landOf(state, countryId) {
  return tilesByCountry(state).get(countryId) ?? EMPTY_LAND;
}
