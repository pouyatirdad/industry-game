export const CONFIG = {
  tickMs: 1000,
  maxFrameMs: 250,
  maxCatchUpTicks: 5,
  demolishRefund: 0.5,
  historyEvery: 5,
  historyLength: 120,
  maxAlerts: 6,
  // How many of your own deals the Trade tab keeps. The world list below is
  // every deal on the planet and a busy world fills it in a tick or two, so
  // your own are kept in a list of their own rather than being crowded out of
  // it by forty-five other governments trading among themselves.
  maxOwnFlows: 60,
  // How long a message stays on screen before it clears itself. Alerts are
  // interruptions, not a log: the panel is meant to be empty most of the time,
  // so anything still on it is something that just happened.
  alertTtlMs: 9000,
  maxFlows: 40,
  speeds: [1, 2, 4],
  // Tile sizes in px. The world is far wider than a screen, so zoom is a
  // first-class control rather than a nicety.
  zoomLevels: [1, 2, 3, 5, 8, 14],
  defaultZoom: 1,
  // Weight of the current tick in a site's rolling 'working %'. Uptime has to
  // answer 'is this plant earning its wages lately', so it is an exponential
  // average rather than a lifetime one: a factory starved for fifty ticks and
  // then fed reads as working again within a few ticks.
  uptimeSmoothing: 0.12,
  price: { meanReversion: 0.02, elasticity: 0.025, floor: 0.35, ceiling: 1.9 },

  // Converts a nation's `demand` x a commodity's `demandShare` into units its
  // population wants per tick. The United States eats 120 food a tick and DR
  // Congo 2.2, so one food plant at 4/tick is most of a small nation's table
  // and a rounding error in a large one. This sets the scale of the whole
  // economy — raise it and every nation needs proportionally more industry.
  demandScale: 0.2,

  // How much of its own appetite a nation meets from the private economy you do
  // not run. Your state industry is built on TOP of this, which is why an
  // untouched market sits at a mild premium instead of starving outright.
  selfSufficiency: 0.45,

  // What a nation collects each tick from the private economy it does not run,
  // per point of `demand`. This is the tax base, and it is why `demand` is worth
  // growing for its own sake: supply your people, the economy compounds, and
  // the treasury compounds with it. It also means no nation can be permanently
  // killed — a government that closes every plant still collects taxes and can
  // start again.
  taxPerDemand: 130,

  // Share of warehouse stock lost to handling and carrying costs each tick.
  // Small, but it means goods nobody will buy do not pile up forever: a nation
  // that produces past what it can sell is quietly burning money, which is the
  // pressure that makes finding an export market matter.
  spoilage: 0.015,

  // The economy responds to whether its people are supplied. Above `pivot` a
  // nation's demand compounds, below it the economy contracts — and since
  // `demand` is what every price moves against, a shrinking nation is a
  // shrinking market for everybody who sells to it.
  growth: { rate: 0.003, pivot: 0.62, floor: 0.4, ceiling: 3.0 },

  trade: {
    // A deal is struck between the seller's local price and the buyer's. Half
    // and half: both sides gain, which is why trade happens at all.
    split: 0.5,
    // Freight for one unit hauled to the far side of the planet, as a share of
    // the commodity's base price. Nearby partners are nearly free; the antipodes
    // eat a fifth of the cargo's value.
    freight: 0.20,
    // Below this much price gap the haul is not worth arranging.
    minGain: 0.04,
    // Payroll a treasury keeps back rather than spending it on imports.
    reserveTicks: 10,
    // A nation will not buy more than this share of its unmet appetite in one
    // tick, so a single rich buyer cannot vacuum up a market instantly.
    maxFill: 0.6,
    // Ticks of factory consumption a nation keeps in stock when it buys inputs
    // abroad. A country with no coalfield can still run a steel mill, because
    // feedstock lands in its WAREHOUSES rather than being eaten by its
    // population — that is what makes the second import channel worth having.
    // Small on purpose: buying a hundred ticks of coal up front would let a
    // treasury corner a market in one go.
    inputBuffer: 6,
  },

  // The other forty-five governments come to you. A nation that has goods to
  // move (or people to feed) offers a pact of its own rather than waiting for
  // you to buy your way in — and since it is the one asking, IT pays.
  diplomacy: {
    every: 12,          // ticks between offers being considered
    maxPending: 3,      // offers on the table at once
    ttl: 90,            // ticks an offer stands before it lapses
    // What an offered pact pays you, as a share of what the same pact would
    // have cost you to open. Under 1 because you are not the one who wants it.
    fee: 0.6,
  },

  // State industry. A nation builds from its treasury, which it fills by
  // selling to its own people and exporting the surplus. `stateBuildEvery` is
  // in ticks; keeping it well above 1 is what stops governments from carpeting
  // their own land.
  stateBuildEvery: 5,
  // ...and up to this many sites on one decision, so a government with a full
  // treasury actually spends it. One site every eight ticks left half the world
  // sitting on money it never turned into industry.
  stateBuildsPerDecision: 2,
  stateReserveTicks: 45,   // payroll it refuses to spend below
  // How much capacity a government will build for a commodity before it stops.
  // Its own people cap what it can sell at home (`homeShare` of their appetite);
  // the export market is worth a slice of what the whole world eats
  // (`worldShare`). Without this a resource-rich nation carpets its deposits and
  // then goes bankrupt paying wages on goods nobody will buy.
  stateCapacity: { homeShare: 1.0, worldShare: 0.05 },
  // Spare depot space, as a share of one warehouse, below which a government
  // builds another before it builds anything else.
  stateDepotHeadroom: 0.35,
  // ...and at most one depot per this many sites, whatever else is going on.
  stateSitesPerDepot: 6,
  seed: 20260826,
};
