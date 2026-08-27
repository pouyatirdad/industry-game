// The technology tree. Every industry past the basics is locked behind one of
// these, for you and for the other forty-five governments alike.
//
// A tech is one object literal, exactly as an industry is. No system knows any
// of these names: `buildings.js` names its tech, `canBuild` asks whether the
// nation holds it, and `systems/research.js` walks `needs` to decide what a
// government can start next. Adding a tech is an entry here plus a `tech:` on
// whatever it unlocks.
//
//   era    presentation only — which column of the tree pane it sits in.
//   cost   research points to complete. A nation's research rate is a share of
//          its tax base (see CONFIG.research), so cost is readable as "about
//          this many ticks of a small nation's whole budget".
//   needs  tech ids that must be held first. The tree is a DAG and is checked
//          by the suite; a cycle would leave both ends permanently unreachable.
//
// What a tech unlocks is NOT listed here. `buildings.js` names its own
// requirement, so the two can never disagree — see UNLOCKS below, which is
// derived from the buildings rather than authored.
export const TECHS = {
  // --- era 1: the industrial basics ---------------------------------------
  drilling: {
    name: 'Rotary Drilling', era: 1, cost: 900, needs: [],
    blurb: 'Puts a bit through hard rock. Crude oil and natural gas stop being seepages and become an industry.',
  },
  metallurgy: {
    name: 'Metallurgy', era: 1, cost: 1_100, needs: [],
    blurb: 'Smelting past iron. Copper ore becomes worth digging, and the wire that follows becomes worth making.',
  },
  papermaking: {
    name: 'Industrial Papermaking', era: 1, cost: 700, needs: [],
    blurb: 'Pulp at scale. Cheap, unglamorous, and the fastest return a forested nation has.',
  },
  glassmaking: {
    name: 'Float Glass', era: 1, cost: 850, needs: [],
    blurb: 'Limestone and heat into flat glass. On its own it is a modest trade; everything optical and electronic runs through it later.',
  },

  // --- era 2: refining and machines ---------------------------------------
  refining: {
    name: 'Catalytic Refining', era: 2, cost: 2_200, needs: ['drilling'],
    blurb: 'Cracks crude into fuel and burns gas for power. The single most valuable step an oil nation can take.',
  },
  offshore: {
    name: 'Offshore Extraction', era: 2, cost: 2_600, needs: ['drilling'],
    blurb: 'Platforms on the seabed. Turns a coastline into a resource, which is the only endowment some nations have.',
  },
  mechanisation: {
    name: 'Mechanisation', era: 2, cost: 2_400, needs: ['metallurgy'],
    blurb: 'Steel and fuel into machines. The first stage that sells for more than it costs to ship.',
  },
  lightMetals: {
    name: 'Light Metals', era: 2, cost: 2_900, needs: ['metallurgy'],
    blurb: 'Bauxite into aluminium by electrolysis. Enormously power-hungry, and the gateway to everything that has to fly.',
  },

  // --- era 3: chemistry and the grid --------------------------------------
  petrochemistry: {
    name: 'Petrochemistry', era: 3, cost: 5_200, needs: ['refining'],
    blurb: 'Hydrocarbons into chemicals and plastics. The branch point of the whole modern tree.',
  },
  agroChemistry: {
    name: 'Agro-Chemistry', era: 3, cost: 4_500, needs: ['petrochemistry'],
    blurb: 'Fixed nitrogen. Fertiliser is what lets a crowded nation feed itself, and what it sells to the ones that cannot.',
  },
  pharmaceuticals: {
    name: 'Pharmaceuticals', era: 3, cost: 5_800, needs: ['petrochemistry'],
    blurb: 'Fine chemistry with a licence attached. Low volume, very high margin.',
  },
  rareEarths: {
    name: 'Rare Earth Separation', era: 3, cost: 4_800, needs: ['metallurgy'],
    blurb: 'Seventeen metals that will not separate willingly. Whoever does it cheaply owns the stage above.',
  },
  nuclear: {
    name: 'Nuclear Fission', era: 3, cost: 6_800, needs: ['metallurgy', 'refining'],
    blurb: 'A gram of uranium for a wagon of coal. The cheapest power in the game once it is standing.',
  },
  shipbuilding: {
    name: 'Modern Shipbuilding', era: 3, cost: 5_500, needs: ['mechanisation'],
    blurb: 'Welded hulls on a slipway. Ships are the heaviest thing anyone sells, and the price says so.',
  },

  // --- era 4: electronics --------------------------------------------------
  electronics: {
    name: 'Electronics', era: 4, cost: 11_000, needs: ['lightMetals', 'glassmaking'],
    blurb: 'Copper, aluminium and power into circuits. Everything after this is downstream of it.',
  },
  automotive: {
    name: 'Mass Automotive', era: 4, cost: 13_000, needs: ['mechanisation', 'electronics'],
    blurb: 'The assembly line. The deepest chain a nation can run end to end, and the highest volume of value.',
  },
  electrochemistry: {
    name: 'Electrochemistry', era: 4, cost: 12_000, needs: ['petrochemistry', 'rareEarths'],
    blurb: 'Lithium cells at industrial scale. A battery industry needs three imports and pays for all of them.',
  },

  // --- era 5: the top ------------------------------------------------------
  semiconductors: {
    name: 'Semiconductors', era: 5, cost: 20_000, needs: ['electronics', 'rareEarths'],
    blurb: 'Wafers, and the cleanest room in the country. The single highest-value thing a nation can learn to make.',
  },
  aerospace: {
    name: 'Aerospace', era: 5, cost: 26_000, needs: ['automotive', 'semiconductors'],
    blurb: 'Airframes. Nothing else on the board sells for as much per unit, and nothing else needs as much beneath it.',
  },
};

export const TECH_IDS = Object.keys(TECHS);

// What every nation on earth already knows when a game opens.
//
// The whole of era 1, and the same set for all forty-six — nobody starts a step
// ahead of anybody else, and the race begins at era 2. Derived from the `era`
// field rather than listed separately, so moving a tech between eras moves it in
// and out of the starting set with it and the two can never disagree.
//
// It is a set rather than nothing at all because an empty tree makes the first
// fifty ticks of every game identical: no oil, no gas, no copper, nothing to
// decide. Starting everybody at era 1 means the first decision is which branch
// of era 2 to take, which is a decision worth having.
export const STARTING_ERA = 1;
export const STARTING_TECHS = TECH_IDS.filter((id) => TECHS[id].era <= STARTING_ERA);

// The eras, in order, for the tree pane. Derived so a new era needs no edit.
export const TECH_ERAS = [...new Set(TECH_IDS.map((id) => TECHS[id].era))].sort((a, b) => a - b);

// Everything a tech makes buildable, derived from `buildings.js` rather than
// restated here — the two can then never disagree about what a tech is worth.
export function unlocksOf(buildings) {
  const out = {};
  for (const id of TECH_IDS) out[id] = [];
  for (const [buildingId, def] of Object.entries(buildings)) {
    if (def.tech && out[def.tech]) out[def.tech].push(buildingId);
  }
  return out;
}

// Whether a nation holding `known` can start `id` now: it must not already hold
// it, and every prerequisite must be in hand.
export function canResearch(known, id) {
  const tech = TECHS[id];
  if (!tech || known[id]) return false;
  return tech.needs.every((need) => known[need]);
}

// Everything a nation could start next. Sorted cheapest first, which is also
// the order a government considers them in.
export function availableTechs(known) {
  return TECH_IDS.filter((id) => canResearch(known, id)).sort((a, b) => TECHS[a].cost - TECHS[b].cost);
}

// What a tech is worth to buy off somebody who already has it, before any
// markup. Everything upstream of it that the buyer still lacks comes with it —
// you cannot licence a semiconductor fab to a nation that has never refined a
// barrel, so the price quotes the whole missing branch.
export function techChain(known, id) {
  const chain = [];
  const walk = (techId) => {
    if (known[techId] || chain.includes(techId)) return;
    for (const need of TECHS[techId]?.needs ?? []) walk(need);
    chain.push(techId);
  };
  walk(id);
  return chain;
}
