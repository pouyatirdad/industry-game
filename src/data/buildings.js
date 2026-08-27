// Every industry is one object literal. No system knows any of these names.
//
// `terrain` gates placement. Extraction sits on the deposit it works; factories
// need `plain`, which is why a country that is all desert and oilfield can pump
// crude but not refine it. `warehouse` is the only entry with `recipe: null`,
// and that null is how the systems tell storage from production.
//
// `tech` names an entry in data/technology.js that a government must hold
// before it may build this at all. An industry with no `tech` is one every
// nation starts knowing — the basics of coal, iron, stone, timber and food.
// The requirement is named HERE rather than in the tech tree so the two can
// never disagree about what a tech is worth.
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
    name: 'Oil Rig', glyph: '🛢', cost: 26_000, wages: 110, tech: 'drilling',
    terrain: ['oilfield'], inCap: 0, outCap: 60,
    recipe: { in: {}, out: { oil: 5 }, ticks: 1 },
    blurb: 'Pumps crude oil. Oilfields only — Saudi Arabia, Iran, Russia and Venezuela lead.',
  },
  gasWell: {
    name: 'Gas Well', glyph: '♨', cost: 30_000, wages: 120, tech: 'drilling',
    terrain: ['gasfield'], inCap: 0, outCap: 70,
    recipe: { in: {}, out: { gas: 6 }, ticks: 1 },
    blurb: 'Taps natural gas. Gasfields only — Russia and Iran hold the two largest reserves.',
  },
  copperMine: {
    name: 'Copper Mine', glyph: '✦', cost: 24_000, wages: 100, tech: 'metallurgy',
    terrain: ['copperbelt'], inCap: 0, outCap: 50,
    recipe: { in: {}, out: { copperOre: 3 }, ticks: 1 },
    blurb: 'Extracts copper ore. Copperbelts only — Chile, Peru and DR Congo above all.',
  },
  bauxiteMine: {
    name: 'Bauxite Mine', glyph: '◆', cost: 20_000, wages: 90, tech: 'lightMetals',
    terrain: ['bauxite'], inCap: 0, outCap: 60,
    recipe: { in: {}, out: { bauxite: 4 }, ticks: 1 },
    blurb: 'Strips bauxite for aluminium. Australia, Brazil and India are the big holders.',
  },
  uraniumMine: {
    name: 'Uranium Mine', glyph: '☢', cost: 68_000, wages: 210, tech: 'nuclear',
    terrain: ['uraniumore'], inCap: 0, outCap: 30,
    recipe: { in: {}, out: { uranium: 2 }, ticks: 1 },
    blurb: 'Works a uranium body. Kazakhstan, Canada and Australia hold nearly all of it — and a reactor needs almost none of it.',
  },
  lithiumWorks: {
    name: 'Lithium Works', glyph: '⬗', cost: 44_000, wages: 150, tech: 'electrochemistry',
    terrain: ['lithiumflat'], inCap: 0, outCap: 40,
    recipe: { in: {}, out: { lithium: 3 }, ticks: 1 },
    blurb: 'Evaporates brine off a salt flat. Chile, Australia and Argentina share the lithium triangle between them.',
  },
  rareEarthMine: {
    name: 'Rare Earth Mine', glyph: '❖', cost: 56_000, wages: 180, tech: 'rareEarths',
    terrain: ['rareearth'], inCap: 0, outCap: 30,
    recipe: { in: {}, out: { rareEarth: 2 }, ticks: 1 },
    blurb: 'Digs and separates the lanthanides. China holds most of the world total, and every stage above this one knows it.',
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
    name: 'Offshore Platform', glyph: '🛟', cost: 62_000, wages: 200, tech: 'offshore',
    terrain: ['offshoreOil'], inCap: 0, outCap: 80,
    recipe: { in: {}, out: { oil: 7 }, ticks: 1 },
    blurb: 'Pumps crude from the seabed. Costlier than a land rig, and it out-produces one. Saudi, Iranian, Brazilian and North Sea waters are richest.',
  },
  offshoreGasRig: {
    name: 'Offshore Gas Rig', glyph: '🌊', cost: 70_000, wages: 215, tech: 'offshore',
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
    name: 'Gas Power Plant', glyph: '⚡', cost: 46_000, wages: 150, tech: 'refining',
    terrain: ['plain'], inCap: 40, outCap: 70,
    recipe: { in: { gas: 4 }, out: { power: 10 }, ticks: 1 },
    blurb: 'Burns gas for power — costlier to build than coal, and markedly more efficient.',
  },
  nuclearPlant: {
    name: 'Nuclear Station', glyph: '☢', cost: 190_000, wages: 300, tech: 'nuclear',
    terrain: ['plain'], inCap: 20, outCap: 90,
    recipe: { in: { uranium: 1 }, out: { power: 14 }, ticks: 1 },
    blurb: 'A gram of uranium for a wagon of coal. Ruinous to build, and the cheapest power on the board once it is standing.',
  },

  // --- processing ----------------------------------------------------------
  refinery: {
    name: 'Refinery', glyph: '⛽', cost: 52_000, wages: 180, tech: 'refining',
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
    name: 'Copper Smelter', glyph: '⬢', cost: 58_000, wages: 190, tech: 'metallurgy',
    terrain: ['plain'], inCap: 30, outCap: 30,
    recipe: { in: { copperOre: 6, power: 4 }, out: { copper: 3 }, ticks: 2 },
    blurb: 'Smelts copper ore with power into refined copper.',
  },
  aluminiumPlant: {
    name: 'Aluminium Plant', glyph: '⬡', cost: 75_000, wages: 220, tech: 'lightMetals',
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
  paperMill: {
    name: 'Paper Mill', glyph: '▤', cost: 30_000, wages: 115, tech: 'papermaking',
    terrain: ['plain'], inCap: 30, outCap: 40,
    recipe: { in: { timber: 6, power: 3 }, out: { paper: 5 }, ticks: 1 },
    blurb: 'Pulps timber into paper. The cheapest thing a forested nation can learn to sell.',
  },
  glassworks: {
    name: 'Glassworks', glyph: '◫', cost: 36_000, wages: 120, tech: 'glassmaking',
    terrain: ['plain'], inCap: 30, outCap: 40,
    recipe: { in: { limestone: 8, power: 3 }, out: { glass: 5 }, ticks: 1 },
    blurb: 'Floats limestone and heat into flat glass. Modest on its own, and everything optical above it needs it.',
  },
  chemicalWorks: {
    name: 'Chemical Works', glyph: '⚗', cost: 64_000, wages: 200, tech: 'petrochemistry',
    terrain: ['plain'], inCap: 30, outCap: 40,
    recipe: { in: { gas: 6, limestone: 4 }, out: { chemicals: 3 }, ticks: 1 },
    blurb: 'Gas and stone into industrial chemicals. The branch point of the modern tree: fertiliser, plastics and medicine all start here.',
  },
  plasticsPlant: {
    name: 'Plastics Plant', glyph: '◍', cost: 70_000, wages: 210, tech: 'petrochemistry',
    terrain: ['plain'], inCap: 30, outCap: 40,
    recipe: { in: { oil: 6, power: 3 }, out: { plastics: 4 }, ticks: 1 },
    blurb: 'Polymerises crude into plastics. An oil nation that only ever sells barrels is leaving this on the table.',
  },
  fertiliserPlant: {
    name: 'Fertiliser Plant', glyph: '🌱', cost: 58_000, wages: 185, tech: 'agroChemistry',
    terrain: ['plain'], inCap: 30, outCap: 40,
    recipe: { in: { gas: 4, chemicals: 2 }, out: { fertiliser: 4 }, ticks: 1 },
    blurb: 'Fixes nitrogen out of natural gas. What a crowded nation buys when it cannot grow enough at home.',
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
  pharmaPlant: {
    name: 'Pharmaceutical Plant', glyph: '💊', cost: 140_000, wages: 330, tech: 'pharmaceuticals',
    terrain: ['plain'], inCap: 20, outCap: 20,
    recipe: { in: { chemicals: 4, power: 3, grain: 3 }, out: { medicine: 2 }, ticks: 2 },
    blurb: 'Fine chemistry with a licence attached. Small volumes, and the best margin per tonne in the game.',
  },

  // --- assembly ------------------------------------------------------------
  machineWorks: {
    name: 'Machine Works', glyph: '⚒', cost: 90_000, wages: 260, tech: 'mechanisation',
    terrain: ['plain'], inCap: 16, outCap: 24,
    recipe: { in: { steel: 4, fuel: 2 }, out: { machinery: 2 }, ticks: 2 },
    blurb: 'Turns steel + fuel into machinery.',
  },
  electronicsPlant: {
    name: 'Electronics Plant', glyph: '⌘', cost: 120_000, wages: 320, tech: 'electronics',
    terrain: ['plain'], inCap: 20, outCap: 24,
    recipe: { in: { copper: 3, aluminium: 2, power: 3 }, out: { electronics: 3 }, ticks: 3 },
    blurb: 'Assembles copper + aluminium + power into electronics.',
  },
  batteryPlant: {
    name: 'Battery Plant', glyph: '🔋', cost: 130_000, wages: 300, tech: 'electrochemistry',
    terrain: ['plain'], inCap: 20, outCap: 24,
    recipe: { in: { lithium: 4, copper: 1, chemicals: 2 }, out: { battery: 3 }, ticks: 2 },
    blurb: 'Cells at industrial scale. Three inputs, and a nation with none of them can still buy all three in.',
  },
  semiconductorFab: {
    name: 'Semiconductor Fab', glyph: '⬚', cost: 260_000, wages: 480, tech: 'semiconductors',
    terrain: ['plain'], inCap: 16, outCap: 16,
    recipe: { in: { rareEarth: 3, glass: 3, power: 6 }, out: { semiconductor: 2 }, ticks: 3 },
    blurb: 'Wafers, and the cleanest room in the country. The highest value per unit of input anywhere on the board.',
  },
  vehiclePlant: {
    name: 'Vehicle Plant', glyph: '🚚', cost: 180_000, wages: 420, tech: 'automotive',
    terrain: ['plain'], inCap: 24, outCap: 12,
    recipe: { in: { machinery: 2, steel: 3, electronics: 2 }, out: { vehicles: 1 }, ticks: 3 },
    blurb: 'The deepest chain in the game, and the highest price per unit on the market.',
  },
  shipyard: {
    name: 'Shipyard', glyph: '⚓', cost: 210_000, wages: 440, tech: 'shipbuilding',
    terrain: ['plain'], inCap: 24, outCap: 8,
    recipe: { in: { steel: 8, machinery: 3, fuel: 4 }, out: { ship: 1 }, ticks: 3 },
    blurb: 'Welded hulls on a slipway. The heaviest thing anybody sells, and it eats steel by the wagon.',
  },
  aircraftPlant: {
    name: 'Aircraft Plant', glyph: '✈', cost: 340_000, wages: 560, tech: 'aerospace',
    terrain: ['plain'], inCap: 16, outCap: 8,
    recipe: { in: { aluminium: 3, semiconductor: 2, machinery: 2 }, out: { aircraft: 1 }, ticks: 4 },
    blurb: 'Airframes. Nothing on the board sells for more per unit, and nothing needs as much industry standing beneath it.',
  },

  // --- logistics -----------------------------------------------------------
  warehouse: {
    name: 'Warehouse', glyph: '▥', cost: 12_000, wages: 60,
    terrain: ['plain', 'hills', 'coalfield', 'oilfield', 'gasfield', 'copperbelt', 'bauxite',
             'quarry', 'farmland', 'forest', 'desert', 'uraniumore', 'lithiumflat', 'rareearth'],
    radius: 20, capacity: 3000,
    recipe: null,
    blurb: 'Stores goods and serves industry within 20 tiles. Your people buy from here first; whatever they do not eat is what you have to export.',
  },
};

export const BUILDING_IDS = Object.keys(BUILDINGS);

// What a nation must know before it may build a thing. `null` is the answer for
// the basics every government starts with.
export function techFor(type) {
  return BUILDINGS[type]?.tech ?? null;
}
