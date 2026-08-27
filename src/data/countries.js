// Forty-six playable nations. You govern one of them; the other forty-five are
// run by the same code out of their own treasuries. Everything that makes one
// nation different from another lives here — no system reads a country name or
// hardcodes a rate.
//
//   char      the character this country occupies in world.js
//   wageMul   labour cost multiplier on every building's wages (Poland = 1.0).
//             This is UNIT labour cost, not the hourly wage: a German hour costs
//             fifteen times an Ethiopian one but buys far more output, so the
//             spread here is six to one rather than fifty. Get this wrong in the
//             other direction and every high-wage nation is unplayable, because
//             wages are the only running cost in the game besides inputs.
//   demand    size of the country's home market. Multiplied by each
//             commodity's demandShare to give the appetite of its population
//             per tick, which is what its local price moves against. Scaled
//             off real GDP but compressed (~gdp^0.65), so DR Congo is fifty
//             times smaller than the United States rather than four hundred.
//             This is the ONLY value that moves during a game: a nation whose
//             people are well supplied grows, a starved one shrinks.
//   pop       population in millions. Presentation and flavour; the simulation
//             reads `demand`.
//   deposits  resource tiles the country gets, authored against the 120x60
//             source grid in world.js and scaled up with the playable grid.
//             Fractions are allowed and are the only way to give a one-cell
//             country like the Netherlands a partial endowment.
//   waters    offshore deposits as a FRACTION of the country's territorial sea.
//             The sea is not in the source art, so there is nothing to count
//             against and a fraction is scale-free.
//
// IMPORTANT: a country's deposits must sum to no more than about 60% of the
// cells it owns in the source grid, or generation runs out of room and silently
// drops whatever comes last in DEPOSIT_ORDER — the country then never gets the
// resource you thought you gave it. `test/run.js` fails if any country
// over-subscribes.
//
// Endowments otherwise follow the real world: Chile, Peru and DR Congo for
// copper, Australia for iron ore and bauxite, Russia, Iran, Qatar-adjacent Gulf
// states and Norway for gas, the US, Ukraine and Argentina for grain, and Japan,
// South Korea and the Netherlands for almost nothing at all.
export const COUNTRIES = {
  // --- North America -------------------------------------------------------
  US: { name: 'United States', char: 'U', color: '#4b6ea9', wageMul: 1.65, demand: 60, pop: 340,
        waters: { offshoreOil: 0.12, offshoreGas: 0.08, fishery: 0.30 },
        deposits: { farmland: 26, coalfield: 20, oilfield: 18, gasfield: 16, forest: 14, hills: 8, quarry: 6, copperbelt: 5, desert: 5 } },
  CA: { name: 'Canada', char: 'C', color: '#7a90b8', wageMul: 1.50, demand: 10.5, pop: 41,
        waters: { fishery: 0.34, offshoreOil: 0.06 },
        deposits: { forest: 40, oilfield: 20, farmland: 18, hills: 16, gasfield: 12, coalfield: 8, copperbelt: 8, quarry: 8 } },
  MX: { name: 'Mexico', char: 'M', color: '#3f8f6e', wageMul: 0.55, demand: 9.3, pop: 130,
        waters: { offshoreOil: 0.18, fishery: 0.24 },
        deposits: { oilfield: 4, copperbelt: 3, farmland: 4, desert: 4, hills: 3, quarry: 2 } },

  // --- South America -------------------------------------------------------
  CO: { name: 'Colombia', char: 'c', color: '#57a05f', wageMul: 0.40, demand: 3.4, pop: 53,
        waters: { fishery: 0.26, offshoreGas: 0.06 },
        deposits: { oilfield: 3, coalfield: 3, forest: 4, farmland: 2, copperbelt: 1 } },
  VE: { name: 'Venezuela', char: 'v', color: '#b8894f', wageMul: 0.30, demand: 1.3, pop: 28,
        waters: { offshoreOil: 0.24, offshoreGas: 0.10, fishery: 0.18 },
        deposits: { oilfield: 4, gasfield: 1, bauxite: 1 } },
  BR: { name: 'Brazil', char: 'B', color: '#5f9e46', wageMul: 0.60, demand: 11, pop: 212,
        waters: { offshoreOil: 0.22, fishery: 0.22 },
        deposits: { forest: 24, hills: 16, farmland: 14, bauxite: 6, oilfield: 5, quarry: 4, copperbelt: 2 } },
  PE: { name: 'Peru', char: 'P', color: '#c48a3f', wageMul: 0.40, demand: 2.5, pop: 34,
        waters: { fishery: 0.44 },
        deposits: { copperbelt: 4, hills: 2, forest: 2, gasfield: 1, farmland: 1 } },
  CL: { name: 'Chile', char: 'L', color: '#b8574f', wageMul: 0.65, demand: 2.9, pop: 20,
        waters: { fishery: 0.40 },
        deposits: { copperbelt: 6, desert: 3, forest: 2, farmland: 1 } },
  AR: { name: 'Argentina', char: 'A', color: '#6fa8b8', wageMul: 0.45, demand: 4.6, pop: 46,
        waters: { fishery: 0.30, offshoreOil: 0.06 },
        deposits: { farmland: 12, gasfield: 5, oilfield: 4, hills: 3, forest: 3, quarry: 2 } },

  // --- Europe --------------------------------------------------------------
  GB: { name: 'United Kingdom', char: 'G', color: '#5a5f9e', wageMul: 1.55, demand: 15, pop: 69,
        waters: { offshoreOil: 0.20, offshoreGas: 0.16, fishery: 0.22 },
        deposits: { oilfield: 1, gasfield: 1, coalfield: 1, farmland: 1 } },
  FR: { name: 'France', char: 'F', color: '#4f7fb0', wageMul: 1.65, demand: 14, pop: 66,
        waters: { fishery: 0.26 },
        deposits: { farmland: 4, forest: 2, quarry: 1 } },
  ES: { name: 'Spain', char: 'E', color: '#c9803f', wageMul: 1.15, demand: 8.8, pop: 48,
        waters: { fishery: 0.30 },
        deposits: { farmland: 4, quarry: 2, hills: 1, copperbelt: 1 } },
  DE: { name: 'Germany', char: 'D', color: '#8a8a5c', wageMul: 1.75, demand: 18, pop: 84,
        waters: { fishery: 0.20, offshoreGas: 0.06 },
        deposits: { coalfield: 3, farmland: 3, forest: 2 } },
  NL: { name: 'Netherlands', char: 'n', color: '#d1913f', wageMul: 1.70, demand: 6.9, pop: 18,
        waters: { offshoreGas: 0.22, fishery: 0.24 },
        deposits: { gasfield: 0.3, farmland: 0.2 } },
  IT: { name: 'Italy', char: 'T', color: '#4f9e7a', wageMul: 1.35, demand: 11, pop: 59,
        waters: { fishery: 0.26 },
        deposits: { quarry: 2, farmland: 2, hills: 1 } },
  PL: { name: 'Poland', char: 'O', color: '#a05f6e', wageMul: 1.00, demand: 5.5, pop: 37,
        waters: { fishery: 0.20 },
        deposits: { coalfield: 3, farmland: 2 } },
  SE: { name: 'Sweden', char: 'W', color: '#5b8fc9', wageMul: 1.80, demand: 4.4, pop: 11,
        waters: { fishery: 0.24 },
        deposits: { hills: 3, forest: 3 } },
  NO: { name: 'Norway', char: 'w', color: '#8f5fb8', wageMul: 1.90, demand: 3.9, pop: 5.6,
        waters: { offshoreOil: 0.30, offshoreGas: 0.26, fishery: 0.24 },
        deposits: { oilfield: 2, gasfield: 2, forest: 1, hills: 1 } },
  UA: { name: 'Ukraine', char: 'K', color: '#c9b03f', wageMul: 0.35, demand: 1.9, pop: 38,
        waters: { fishery: 0.16, offshoreGas: 0.06 },
        deposits: { farmland: 7, coalfield: 3, hills: 2, gasfield: 1 } },
  RU: { name: 'Russia', char: 'R', color: '#7f6f9e', wageMul: 0.60, demand: 10.5, pop: 144,
        waters: { fishery: 0.30, offshoreGas: 0.10, offshoreOil: 0.06 },
        deposits: { gasfield: 55, oilfield: 45, forest: 60, coalfield: 35, hills: 30, farmland: 25, quarry: 10, copperbelt: 8, desert: 8 } },
  TR: { name: 'Turkey', char: 'Y', color: '#b8564f', wageMul: 0.60, demand: 7.3, pop: 87,
        waters: { fishery: 0.26 },
        deposits: { coalfield: 3, farmland: 4, hills: 2, quarry: 2, copperbelt: 1 } },

  // --- Middle East ---------------------------------------------------------
  // Iran runs right up against MAX_DEPOSIT_SHARE, so its coalfields (Tabas and
  // Kerman are real, and modest) are paid for out of its land oil rather than
  // added on top: it keeps the largest offshore gas in the game and a hundred
  // oil tiles, and can now feed a steel mill or a cement works without buying
  // the coal in.
  IR: { name: 'Iran', char: 'I', color: '#2f8f5f', wageMul: 0.40, demand: 3.5, pop: 92,
        waters: { offshoreGas: 0.26, offshoreOil: 0.20, fishery: 0.12 },
        deposits: { oilfield: 4, gasfield: 5, coalfield: 2, hills: 2, copperbelt: 1, farmland: 1, desert: 0.5 } },
  IQ: { name: 'Iraq', char: 'q', color: '#9e8f3f', wageMul: 0.42, demand: 2.4, pop: 46,
        waters: { offshoreOil: 0.30, fishery: 0.10 },
        deposits: { oilfield: 2, gasfield: 1 } },
  SA: { name: 'Saudi Arabia', char: 'S', color: '#3f8f70', wageMul: 0.85, demand: 6.5, pop: 34,
        waters: { offshoreOil: 0.30, offshoreGas: 0.14, fishery: 0.08 },
        deposits: { oilfield: 9, gasfield: 5, desert: 6, quarry: 1 } },
  AE: { name: 'United Arab Emirates', char: 'a', color: '#6fc9a8', wageMul: 0.90, demand: 3.9, pop: 11,
        waters: { offshoreOil: 0.34, offshoreGas: 0.18, fishery: 0.08 },
        deposits: { oilfield: 0.6, gasfield: 0.4 } },

  // --- Africa --------------------------------------------------------------
  EG: { name: 'Egypt', char: 'X', color: '#c9a83f', wageMul: 0.32, demand: 3.0, pop: 116,
        waters: { offshoreGas: 0.20, fishery: 0.14 },
        deposits: { gasfield: 3, oilfield: 2, farmland: 2, desert: 3, quarry: 1 } },
  DZ: { name: 'Algeria', char: 'g', color: '#7fa84f', wageMul: 0.42, demand: 2.4, pop: 46,
        waters: { offshoreGas: 0.12, fishery: 0.20 },
        deposits: { gasfield: 8, oilfield: 6, desert: 8, hills: 2, farmland: 1 } },
  NG: { name: 'Nigeria', char: 'N', color: '#4f9e5f', wageMul: 0.32, demand: 1.9, pop: 229,
        waters: { offshoreOil: 0.28, offshoreGas: 0.12, fishery: 0.14 },
        deposits: { oilfield: 6, gasfield: 4, farmland: 3, forest: 3 } },
  ET: { name: 'Ethiopia', char: 'e', color: '#a8c95f', wageMul: 0.30, demand: 1.8, pop: 129,
        waters: { fishery: 0.10 },
        deposits: { farmland: 6, forest: 3, hills: 2, quarry: 2, gasfield: 1 } },
  KE: { name: 'Kenya', char: 'k', color: '#c95f8a', wageMul: 0.32, demand: 1.4, pop: 56,
        waters: { fishery: 0.24 },
        deposits: { farmland: 4, forest: 2, quarry: 1, hills: 1 } },
  CD: { name: 'DR Congo', char: 'Z', color: '#8fa04f', wageMul: 0.30, demand: 1.1, pop: 109,
        waters: { fishery: 0.30 },
        deposits: { copperbelt: 10, forest: 14, hills: 4, bauxite: 1, farmland: 1 } },
  ZA: { name: 'South Africa', char: 'H', color: '#c9913f', wageMul: 0.55, demand: 3.3, pop: 63,
        waters: { fishery: 0.32 },
        deposits: { coalfield: 6, hills: 4, quarry: 2, farmland: 3, copperbelt: 1, bauxite: 1 } },

  // --- Asia ----------------------------------------------------------------
  KZ: { name: 'Kazakhstan', char: 'z', color: '#5fb8c9', wageMul: 0.50, demand: 2.6, pop: 20,
        waters: { offshoreOil: 0.20, fishery: 0.10 },
        deposits: { oilfield: 8, gasfield: 5, coalfield: 6, hills: 4, farmland: 4, copperbelt: 2 } },
  PK: { name: 'Pakistan', char: 'Q', color: '#4f8f6a', wageMul: 0.30, demand: 3.1, pop: 251,
        waters: { fishery: 0.28, offshoreGas: 0.06 },
        deposits: { farmland: 4, gasfield: 1, coalfield: 1, desert: 1 } },
  IN: { name: 'India', char: 'J', color: '#d1913f', wageMul: 0.38, demand: 16, pop: 1440,
        waters: { fishery: 0.30, offshoreOil: 0.08, offshoreGas: 0.08 },
        deposits: { coalfield: 9, farmland: 9, hills: 5, bauxite: 3, forest: 2, quarry: 2 } },
  BD: { name: 'Bangladesh', char: 'b', color: '#3f9e8a', wageMul: 0.30, demand: 3.6, pop: 173,
        waters: { fishery: 0.24, offshoreGas: 0.14 },
        deposits: { gasfield: 0.5, farmland: 0.5 } },
  CN: { name: 'China', char: 'V', color: '#b8524f', wageMul: 0.80, demand: 45, pop: 1416,
        waters: { fishery: 0.36, offshoreOil: 0.08, offshoreGas: 0.06 },
        deposits: { coalfield: 28, hills: 16, farmland: 22, forest: 12, quarry: 8, copperbelt: 6, bauxite: 5, desert: 6, gasfield: 3, oilfield: 2 } },
  JP: { name: 'Japan', char: '1', color: '#c96f80', wageMul: 1.45, demand: 17, pop: 124,
        waters: { fishery: 0.42 },
        deposits: { forest: 3, quarry: 1 } },
  KR: { name: 'South Korea', char: '2', color: '#6f7fc9', wageMul: 1.30, demand: 9.5, pop: 52,
        waters: { fishery: 0.36 },
        deposits: { forest: 1, quarry: 1 } },
  VN: { name: 'Vietnam', char: 'h', color: '#c9c94f', wageMul: 0.35, demand: 3.7, pop: 100,
        waters: { fishery: 0.30, offshoreOil: 0.14, offshoreGas: 0.08 },
        deposits: { coalfield: 2, farmland: 2, forest: 1 } },
  TH: { name: 'Thailand', char: 't', color: '#9e6fc9', wageMul: 0.48, demand: 4.1, pop: 72,
        waters: { fishery: 0.28, offshoreGas: 0.12 },
        deposits: { farmland: 5, forest: 2, quarry: 1, gasfield: 1 } },
  MY: { name: 'Malaysia', char: 'y', color: '#4fb8c9', wageMul: 0.55, demand: 3.6, pop: 35,
        waters: { fishery: 0.26, offshoreOil: 0.14, offshoreGas: 0.14 },
        deposits: { oilfield: 1, gasfield: 1, forest: 2 } },
  ID: { name: 'Indonesia', char: '3', color: '#5f9e8a', wageMul: 0.42, demand: 7.7, pop: 281,
        waters: { fishery: 0.34, offshoreOil: 0.12, offshoreGas: 0.10 },
        deposits: { coalfield: 9, forest: 10, oilfield: 4, gasfield: 3, copperbelt: 3, bauxite: 2, farmland: 1 } },
  PH: { name: 'Philippines', char: 'p', color: '#c95f5f', wageMul: 0.38, demand: 3.7, pop: 116,
        waters: { fishery: 0.40 },
        deposits: { copperbelt: 3, forest: 3, farmland: 3, hills: 1 } },

  // --- Oceania -------------------------------------------------------------
  AU: { name: 'Australia', char: '4', color: '#c9743f', wageMul: 1.80, demand: 9.2, pop: 27,
        waters: { fishery: 0.26, offshoreGas: 0.16, offshoreOil: 0.06 },
        deposits: { hills: 22, coalfield: 16, bauxite: 10, desert: 14, gasfield: 6, farmland: 6, copperbelt: 4, oilfield: 2 } },
  NZ: { name: 'New Zealand', char: '5', color: '#7fc98f', wageMul: 1.50, demand: 2.3, pop: 5.2,
        waters: { fishery: 0.44 },
        deposits: { farmland: 4, forest: 2, gasfield: 1 } },
};

export const COUNTRY_IDS = Object.keys(COUNTRIES);

// world.js stores a character per cell; the systems want a country id.
export const COUNTRY_BY_CHAR = Object.fromEntries(
  COUNTRY_IDS.map((id) => [COUNTRIES[id].char, id]),
);

export const DEFAULT_HOME = 'IR';

// Seed money in every national treasury, scaled to market size. A nation spends
// this on its own industry and tops it up by selling to its own people and
// exporting the rest.
export const TREASURY_PER_DEMAND = 40_000;

// ...but no nation starts unable to lay a warehouse and a mine. Playing DR Congo
// is meant to be hard, not stillborn.
export const TREASURY_FLOOR = 150_000;

// What a trade pact with a country costs to open, per point of its demand. A
// pact with the United States is a serious investment; one with DR Congo is
// pocket change. Derived rather than authored so the forty-six entries above
// cannot drift out of proportion with each other.
export const PACT_PER_DEMAND = 20_000;

// How many of your nearest neighbours you already trade with when a game
// starts. Nobody begins in autarky, and a nation whose own market saturates on
// its first oil rig — which is most of them — needs somewhere to send the
// surplus before it can afford to buy its way into a distant one.
export const STARTING_PACTS = 4;

export function pactCost(countryId) {
  const country = COUNTRIES[countryId];
  return country ? Math.round(country.demand * PACT_PER_DEMAND) : 0;
}
