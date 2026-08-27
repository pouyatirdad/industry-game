// Twenty commodities in three tiers. `tier` is presentation only — what
// actually orders the economy is which recipe consumes what, in buildings.js.
//
// demandShare is how much of a typical economy's consumption a commodity makes
// up. A country's appetite for it per tick is its own `demand` times this,
// times CONFIG.demandScale — so food and power are wanted everywhere while
// bauxite is barely consumed directly at all. Local price moves against that
// appetite, which is why dumping four food a tick bottoms out Iran and barely
// registers in the United States.
//
// Prices are set so every recipe clears a margin on its inputs at base price.
// If you retune one, check the chain it feeds: a mid-tier price cut can make the
// stage above it unprofitable at any volume.
export const COMMODITIES = {
  // --- tier 0: dug, pumped, grown or felled --------------------------------
  ore:         { name: 'Iron Ore',    tier: 0, basePrice: 40,   demandShare: 5, color: '#b07a4e' },
  coal:        { name: 'Coal',        tier: 0, basePrice: 30,   demandShare: 7, color: '#5a5a66' },
  oil:         { name: 'Crude Oil',   tier: 0, basePrice: 70,   demandShare: 7, color: '#3f3a52' },
  gas:         { name: 'Natural Gas', tier: 0, basePrice: 50,   demandShare: 6, color: '#6f8fa8' },
  copperOre:   { name: 'Copper Ore',  tier: 0, basePrice: 90,   demandShare: 2.5, color: '#c07a52' },
  bauxite:     { name: 'Bauxite',     tier: 0, basePrice: 60,   demandShare: 2, color: '#a86f5a' },
  grain:       { name: 'Grain',       tier: 0, basePrice: 25,   demandShare: 6, color: '#c9b46a' },
  timber:      { name: 'Timber',      tier: 0, basePrice: 35,   demandShare: 5, color: '#6f8f5a' },
  limestone:   { name: 'Limestone',   tier: 0, basePrice: 20,   demandShare: 6, color: '#9fa3a8' },
  fish:        { name: 'Fish',        tier: 0, basePrice: 45,   demandShare: 4.5, color: '#5fa8c9' },

  // --- tier 1: smelted, refined, milled, burned ----------------------------
  power:       { name: 'Power',       tier: 1, basePrice: 60,   demandShare: 12, color: '#e8d24a' },
  steel:       { name: 'Steel',       tier: 1, basePrice: 300,  demandShare: 5, color: '#8fa3b8' },
  fuel:        { name: 'Fuel',        tier: 1, basePrice: 240,  demandShare: 8, color: '#c9a83f' },
  copper:      { name: 'Copper',      tier: 1, basePrice: 420,  demandShare: 1.5, color: '#d98a55' },
  aluminium:   { name: 'Aluminium',   tier: 1, basePrice: 700,  demandShare: 1.2, color: '#bcc6d1' },
  cement:      { name: 'Cement',      tier: 1, basePrice: 120,  demandShare: 6, color: '#8a8a8a' },
  lumber:      { name: 'Lumber',      tier: 1, basePrice: 130,  demandShare: 5, color: '#9e7f4a' },
  food:        { name: 'Food',        tier: 1, basePrice: 110,  demandShare: 10, color: '#c98f6a' },

  // --- tier 2: assembled ---------------------------------------------------
  machinery:   { name: 'Machinery',   tier: 2, basePrice: 1200, demandShare: 2, color: '#4a91d6' },
  electronics: { name: 'Electronics', tier: 2, basePrice: 1500, demandShare: 2.5, color: '#5fd6c4' },
  vehicles:    { name: 'Vehicles',    tier: 2, basePrice: 9000, demandShare: 1.2, color: '#d65f8a' },
};

export const COMMODITY_IDS = Object.keys(COMMODITIES);
