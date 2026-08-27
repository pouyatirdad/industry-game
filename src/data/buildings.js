// Every industry is one object literal. No system knows any of these names.
//
// `terrain` gates placement. Extraction sits on the deposit it works; factories
// need `plain`, which is why a country that is all desert and oilfield can pump
// crude but not refine it. `warehouse` is the only entry with `recipe: null`,
// and that null is how the systems tell storage from production.
export const BUILDINGS = {
  // --- extraction ----------------------------------------------------------
  ironMine: {
    name: 'Iron Mine', glyph: '⛏', cost: 18_000, wages: 90,
    terrain: ['hills'], inCap: 0, outCap: 60,
    recipe: { in: {}, out: { ore: 4 }, ticks: 1 },
    blurb: 'Extracts iron ore. Hills only — Australia, Brazil and Sweden have the most.',
  },
  coalMine: {
    name: 'Coal Mine', glyph: '⬛', cost: 15_000, wages: 80,
    terrain: ['coalfield'], inCap: 0, outCap: 60,
    recipe: { in: {}, out: { coal: 4 }, ticks: 1 },
    blurb: 'Extracts coal. Coalfields only — China, India, Australia and the US dominate.',
  },
  oilRig: {
    name: 'Oil Rig', glyph: '🛢', cost: 26_000, wages: 110,
    terrain: ['oilfield'], inCap: 0, outCap: 60,
    recipe: { in: {}, out: { oil: 5 }, ticks: 1 },
    blurb: 'Pumps crude oil. Oilfields only — Saudi Arabia, Iran, Russia and Venezuela lead.',
  },
  gasWell: {
    name: 'Gas Well', glyph: '♨', cost: 30_000, wages: 120,
    terrain: ['gasfield'], inCap: 0, outCap: 70,
    recipe: { in: {}, out: { gas: 6 }, ticks: 1 },
    blurb: 'Taps natural gas. Gasfields only — Russia and Iran hold the two largest reserves.',
  },
  copperMine: {
    name: 'Copper Mine', glyph: '✦', cost: 24_000, wages: 100,
    terrain: ['copperbelt'], inCap: 0, outCap: 50,
    recipe: { in: {}, out: { copperOre: 3 }, ticks: 1 },
    blurb: 'Extracts copper ore. Copperbelts only — Chile, Peru and DR Congo above all.',
  },
  bauxiteMine: {
    name: 'Bauxite Mine', glyph: '◆', cost: 20_000, wages: 90,
    terrain: ['bauxite'], inCap: 0, outCap: 60,
    recipe: { in: {}, out: { bauxite: 4 }, ticks: 1 },
    blurb: 'Strips bauxite for aluminium. Australia, Brazil and India are the big holders.',
  },
  quarry: {
    name: 'Quarry', glyph: '▩', cost: 14_000, wages: 70,
    terrain: ['quarry'], inCap: 0, outCap: 80,
    recipe: { in: {}, out: { limestone: 6 }, ticks: 1 },
    blurb: 'Cuts limestone for cement. Common almost everywhere, and cheap.',
  },
  farm: {
    name: 'Farm', glyph: '🌾', cost: 10_000, wages: 60,
    terrain: ['farmland'], inCap: 0, outCap: 90,
    recipe: { in: {}, out: { grain: 8 }, ticks: 1 },
    blurb: 'Grows grain. Farmland only — the US, India, Ukraine and Argentina are breadbaskets.',
  },
  loggingCamp: {
    name: 'Logging Camp', glyph: '🌲', cost: 12_000, wages: 70,
    terrain: ['forest'], inCap: 0, outCap: 70,
    recipe: { in: {}, out: { timber: 5 }, ticks: 1 },
    blurb: 'Fells timber. Forest only — Russia, Brazil and Canada carry most of the world total.',
  },

  // --- offshore ------------------------------------------------------------
  // Water is not empty. A country's territorial waters carry oil, gas and
  // fishing grounds, and offshore extraction is dearer than the same thing on
  // land — you are paying for the platform.
  offshorePlatform: {
    name: 'Offshore Platform', glyph: '🛟', cost: 62_000, wages: 200,
    terrain: ['offshoreOil'], inCap: 0, outCap: 80,
    recipe: { in: {}, out: { oil: 7 }, ticks: 1 },
    blurb: 'Pumps crude from the seabed. Costlier than a land rig, and it out-produces one. Saudi, Iranian, Brazilian and North Sea waters are richest.',
  },
  offshoreGasRig: {
    name: 'Offshore Gas Rig', glyph: '🌊', cost: 70_000, wages: 215,
    terrain: ['offshoreGas'], inCap: 0, outCap: 90,
    recipe: { in: {}, out: { gas: 9 }, ticks: 1 },
    blurb: 'Taps undersea gas. Iran and Qatar share the largest field on earth.',
  },
  fishingFleet: {
    name: 'Fishing Fleet', glyph: '🐟', cost: 18_000, wages: 85,
    terrain: ['fishery'], inCap: 0, outCap: 90,
    recipe: { in: {}, out: { fish: 7 }, ticks: 1 },
    blurb: 'Works a fishing ground. Cheap, and the fastest cash a coastal country has.',
  },

  // --- power ---------------------------------------------------------------
  coalPlant: {
    name: 'Coal Power Plant', glyph: '⌁', cost: 40_000, wages: 140,
    terrain: ['plain'], inCap: 40, outCap: 60,
    recipe: { in: { coal: 6 }, out: { power: 8 }, ticks: 1 },
    blurb: 'Burns coal for power. Cheap to build, thirsty for fuel.',
  },
  gasPlant: {
    name: 'Gas Power Plant', glyph: '⚡', cost: 46_000, wages: 150,
    terrain: ['plain'], inCap: 40, outCap: 70,
    recipe: { in: { gas: 4 }, out: { power: 10 }, ticks: 1 },
    blurb: 'Burns gas for power — costlier to build than coal, and markedly more efficient.',
  },

  // --- processing ----------------------------------------------------------
  refinery: {
    name: 'Refinery', glyph: '⛽', cost: 52_000, wages: 180,
    terrain: ['plain'], inCap: 30, outCap: 40,
    recipe: { in: { oil: 8 }, out: { fuel: 4 }, ticks: 2 },
    blurb: 'Cracks crude into fuel. Needs flat ground, so oil-rich deserts cannot refine their own.',
  },
  steelMill: {
    name: 'Steel Mill', glyph: '⚙', cost: 45_000, wages: 160,
    terrain: ['plain'], inCap: 24, outCap: 40,
    recipe: { in: { ore: 6, coal: 3 }, out: { steel: 3 }, ticks: 2 },
    blurb: 'Smelts ore + coal into steel.',
  },
  copperSmelter: {
    name: 'Copper Smelter', glyph: '⬢', cost: 58_000, wages: 190,
    terrain: ['plain'], inCap: 30, outCap: 30,
    recipe: { in: { copperOre: 6, power: 4 }, out: { copper: 3 }, ticks: 2 },
    blurb: 'Smelts copper ore with power into refined copper.',
  },
  aluminiumPlant: {
    name: 'Aluminium Plant', glyph: '⬡', cost: 75_000, wages: 220,
    terrain: ['plain'], inCap: 40, outCap: 24,
    recipe: { in: { bauxite: 6, power: 12 }, out: { aluminium: 2 }, ticks: 2 },
    blurb: 'Smelts bauxite into aluminium. Enormously power-hungry — site it next to generation.',
  },
  cementWorks: {
    name: 'Cement Works', glyph: '▦', cost: 34_000, wages: 130,
    terrain: ['plain'], inCap: 30, outCap: 40,
    recipe: { in: { limestone: 8, coal: 2 }, out: { cement: 4 }, ticks: 2 },
    blurb: 'Burns limestone with coal into cement. Low value, high volume.',
  },
  sawmill: {
    name: 'Sawmill', glyph: '▬', cost: 22_000, wages: 100,
    terrain: ['plain'], inCap: 30, outCap: 40,
    recipe: { in: { timber: 6 }, out: { lumber: 4 }, ticks: 1 },
    blurb: 'Cuts timber into lumber.',
  },
  foodPlant: {
    name: 'Food Plant', glyph: '🍞', cost: 20_000, wages: 95,
    terrain: ['plain'], inCap: 30, outCap: 40,
    recipe: { in: { grain: 6 }, out: { food: 4 }, ticks: 1 },
    blurb: 'Mills grain into food. The cheapest chain to start, and the thinnest margin.',
  },

  cannery: {
    name: 'Cannery', glyph: '🥫', cost: 24_000, wages: 100,
    terrain: ['plain'], inCap: 30, outCap: 40,
    recipe: { in: { fish: 6 }, out: { food: 4 }, ticks: 1 },
    blurb: 'Turns fish into food — the coastal alternative to farming.',
  },

  // --- assembly ------------------------------------------------------------
  machineWorks: {
    name: 'Machine Works', glyph: '⚒', cost: 90_000, wages: 260,
    terrain: ['plain'], inCap: 16, outCap: 24,
    recipe: { in: { steel: 4, fuel: 2 }, out: { machinery: 2 }, ticks: 2 },
    blurb: 'Turns steel + fuel into machinery.',
  },
  electronicsPlant: {
    name: 'Electronics Plant', glyph: '⌘', cost: 120_000, wages: 320,
    terrain: ['plain'], inCap: 20, outCap: 24,
    recipe: { in: { copper: 3, aluminium: 2, power: 3 }, out: { electronics: 3 }, ticks: 3 },
    blurb: 'Assembles copper + aluminium + power into electronics.',
  },
  vehiclePlant: {
    name: 'Vehicle Plant', glyph: '🚚', cost: 180_000, wages: 420,
    terrain: ['plain'], inCap: 24, outCap: 12,
    recipe: { in: { machinery: 2, steel: 3, electronics: 2 }, out: { vehicles: 1 }, ticks: 3 },
    blurb: 'The deepest chain in the game, and the highest price per unit on the market.',
  },

  // --- logistics -----------------------------------------------------------
  warehouse: {
    name: 'Warehouse', glyph: '▤', cost: 12_000, wages: 60,
    terrain: ['plain', 'hills', 'coalfield', 'oilfield', 'gasfield', 'copperbelt', 'bauxite',
             'quarry', 'farmland', 'forest', 'desert'],
    radius: 20, capacity: 3000,
    recipe: null,
    blurb: 'Stores goods and serves industry within 20 tiles. Your people buy from here first; whatever they do not eat is what you have to export.',
  },
};

export const BUILDING_IDS = Object.keys(BUILDINGS);
