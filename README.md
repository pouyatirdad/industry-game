# Statecraft — run a nation's economy

A browser-based economics game played on a map of the real world. You govern a country: its land,
its industry, its treasury, its people and its trade. No dependencies, no build step, vanilla ES
modules.

Forty-six nations on a 600×300 tile world — 180,000 tiles — each with its own labour costs, market
size, population and resource endowments drawn from the real thing: Iranian and Qatari gas, Saudi
oil, Chilean, Peruvian and Congolese copper, Australian iron ore and bauxite, Ukrainian and American
grain, Russian and Canadian timber, Norwegian offshore oil — and Japan, South Korea and the
Netherlands with almost nothing in the ground. Coastal waters are claimed too, and hold offshore oil,
gas and fishing grounds.

The coastlines are traced from real longitude and latitude, so the map is a plain equirectangular
projection of Earth: 3° per column, 2.35° per row, 84°N down to 57°S. Distance is measured the short
way round the globe, which is why Japan's natural customer is the United States and not the United
Kingdom.

You are not the only one governing. Every other nation runs its own industry out of its own treasury,
feeds its own people first, exports its surplus and buys what it lacks — through exactly the same
code you do.

## Running it

ES modules are blocked over `file://`, so the page needs a local HTTP server. Node ships one here:

```bash
node tools/serve.js
```

Then open <http://localhost:8123/>. VS Code's Live Server extension works too.

- Game: `index.html` — the world is wider than a screen, so the map scrolls and the Zoom control
  above it steps the tile size. `+` and `-` work too.
- Tests: `node tools/test.js`, or open `test.html` in the same server. `node tools/test.js price`
  runs only the matching tests; in the browser use `test.html?only=price`.

## How to play

You start as **Iran** by default. Pick a different nation from the **Nation** dropdown in the top bar
and press **New game** — Norway, Germany, DR Congo and the United States are four completely
different games.

1. **Build a Warehouse first.** Nothing moves without one: sites push output to, and pull inputs
   from, any warehouse of yours within 20 tiles.
2. **Build extraction on the terrain that allows it.** Twelve resources, each on its own ground: iron
   ore on hills, coal, crude oil, natural gas, copper, bauxite, limestone in quarries, grain on
   farmland, timber in forest — and at sea, offshore oil, offshore gas and fishing grounds inside
   your own territorial waters.
3. **Build factories on flat ground** in range of the same warehouse. Deserts and open water take
   extraction but never factories, so an oil-rich desert cannot refine its own crude and a rig needs
   a terminal on shore.
4. **Watch the Supply figure.** It is the share of what your people want that is actually reaching
   them. Above the pivot your economy compounds and your tax base compounds with it; below it, the
   country shrinks — and a shrinking country is a smaller market and a smaller treasury.
5. **Export the surplus.** Your warehouses feed your own market first, up to what your population
   actually eats in a tick. Past that there is no buyer at home, and the **Out** flag offers the rest
   abroad. The **In** flag lets the treasury buy what your people — and your factories — are short
   of: an input your ground does not hold arrives in your warehouses, so a country with no coalfield
   can still run a steel mill. The **Goods** tab is where you watch that happen.
6. **Open new markets.** Click a nation on the map or in the **Nations** list to see its terms and
   sign a trade pact. The fee goes into its treasury, so buying your way into a market funds the
   industry you will then be competing with. Nations also come to *you*: one with goods it cannot
   place at home will offer a pact and pay you for it — the offers sit at the top of the **Trade**
   tab and lapse if you leave them there.
7. **Watch where you stand.** The **Ranks** tab scores all forty-six nations against each other on
   the size of their economy, the industry they have built, what it turns out, how well their people
   are fed, their treasury and their trade balance.

### The chains

| Stage | Made from |
|---|---|
| Power | coal, or gas at a better rate |
| Fuel | crude oil |
| Steel | iron ore + coal |
| Copper | copper ore + power |
| Aluminium | bauxite + a great deal of power |
| Cement | limestone + coal |
| Lumber / Food | timber / grain, or fish at a cannery |
| Machinery | steel + fuel |
| Electronics | copper + aluminium + power |
| Vehicles | machinery + steel + electronics — the deepest chain and the highest price |

### The four decisions

**Feed your own people, or don't.** Domestic demand is the largest single market you will ever have
access to and the only one nobody can close to you — but it is finite, and a small nation saturates
its own oil market on its first rig. Supply drives growth, growth drives the tax base, and the tax
base is what pays for everything else.

**Vertical.** Dumping raw ore pays immediately but poorly, and floods its own price downward, while
feeding it up the chain pays far more per unit — and you carry the payroll the whole time.

**Geographic.** Cheap labour is usually where the resources aren't, and power is what ties them
together: aluminium is so power-hungry it wants to be smelted next to a gas field, not next to a
bauxite mine. Freight scales with distance, so your neighbours are your natural customers and the far
side of the world has to be worth the haul.

**Where you sell.** Every nation has its own price and its own appetite. A deal settles between the
two local prices, so both sides gain — which means the market to sell into is the one that is short,
and flooding a market destroys the reason you went there. The **Want/t** and **Met** columns are the
numbers to read before you build.

`Space` runs/pauses. `Esc` clears the selected build tool. `+` and `-` zoom. Right-click a building
to demolish it for half its cost.

## Architecture

One-way data flow, no cycles:

    data/          static definitions, never mutated
      ↓
    core/state  ←  systems/ mutate it,  core/loop drives the tick
      ↓ read-only
    ui/            renders state, emits actions
      ↓
    actions.js  →  validates, then mutates

Two rules make this hold:

- **Systems never touch the DOM.** That is why every system is testable with no browser APIs.
- **UI never mutates state.** It calls an action, which validates *before* mutating, so a rejected
  build never half-applies.

`state` is the serializable simulation and is the save file. `ui` is a separate object (selection,
active tool, zoom, which market is on screen) that deliberately does not survive a reload.

There is no player object. All forty-six governments are entries in `state.countries` with identical
shape, and `state.home` is the only thing that says which one is yours.

### The tick pipeline

Defined as an ordered list in `src/systems/index.js`. The order is a **game design decision**, not an
implementation detail:

1. `ledger` — fold the finished tick's commodity figures into the total and start the next one empty
2. `collect` — finished output → warehouses in range
3. `produce` — consume inputs, advance jobs, set status
4. `distribute` — warehouses → input buffers, for next tick
5. `wages` — debit payroll at each site's local wage multiplier, unstaff everyone if it bounces
6. `domestic` — sell to your own population, up to what they actually eat
7. `trade` — offer the surplus abroad; buy what your people are short of, and what your factories
   cannot dig up
8. `carry` — warehouse stock loses a little to handling
9. `prices` — move on the whole tick's supply, mean-revert toward base
10. `growth` — economies compound or contract on how well their people were supplied
11. `state` — the other forty-five governments decide what to build
12. `diplomacy` — and whether to come and ask you for a pact

Collecting *before* producing makes a site's throughput independent of its position in the
`buildings` array, which keeps ticks deterministic. Selling at home *before* trading is the rule that
a nation feeds its own people before it feeds anyone else's — reverse those two and exporting would
starve your own population for a better price.

### Where the balance lives

All of it is data in `src/data/`, with the cross-cutting economic constants in `src/core/config.js`.
Adding an industry or a nation is a new object literal — no new file, no new class, no changes to any
system.

- `buildings.js`, `commodities.js` — twenty-two industries, twenty-one commodities.
- `countries.js` — labour multiplier, market size, population and resource endowments per nation.
- `world.js` — the map, as sixty 120-character rows. One character per cell: `.` ocean, `-` land
  belonging to none of the forty-six, anything else a nation.
- `geography.js` — derived: centroids and the distance matrix, computed from the art, so moving a
  coastline moves the freight bill with it.

The map is authored at 120×60 and upscaled to the playable 600×300 at load, so the whole planet stays
reviewable in one screen. Deposit counts are written against that source and scaled with it — and a
nation's deposits must fit inside roughly 60% of the land it owns, or generation runs out of room and
silently drops the rest. A test enforces that.

The continents are fixed data, so every game is played on the same planet. What the seed controls is
*geology* — which of a nation's own tiles happen to hold its oil, ore and coal. Reset rerolls the
deposits, never the coastlines.

## Tests

108 tests in `test/run.js`, covering the parts most likely to break silently: the map data itself
(every row the right width, every nation actually on it, no two sharing a character, countries in the
right hemispheres, distance wrapping the globe rather than the map, no deposit outside its owner or
dropped for want of room, regeneration deterministic for a seed), territorial waters and offshore
deposits, the save round trip (tiles omitted, bags compacted and restored, world rebuilt from the
seed, buildings reattached, payload small enough for localStorage, nothing on the state that a JSON
round trip would eat), the industry tables (no recipe naming an unknown commodity, no building on a
terrain the map never makes, nothing unproduced or unmineable, every recipe clearing a margin at base
price, and the dearest labour on earth still able to profit on the deepest chain), sovereignty (you
build only at home, and so does every government), trade pacts, the home market and its appetite cap,
world trade (both sides gaining, freight scaling with distance, no shipping without a pact, payroll
reserved against imports), local prices, economic growth and collapse and their bounds, spoilage,
terrain gating, atomic multi-input consumption up to three inputs, warehouse radius boundaries,
owner-scoped logistics, independent payroll, a broke government closing plants, six production chains
end to end, output blocking with no warehouse in range, the feedstock channel (a nation with no coal
buying coal for its factories, feedstock never counting as a fed population, the buffer and depot-
space caps, and a chain running end to end on an import), the commodity ledger (what it books, that
it folds one tick at a time, and that it books only your nation), your own deals surviving a full
world flow list, pacts offered to you and accepted, declined or left to lapse, a government planning
a plant around an input it has to import, and the fixed-timestep loop maths.

The suite is deliberately DOM-free — it builds a state and calls systems directly, so it runs without
a browser. The loop takes an injectable scheduler so its timing can be driven by a fake clock rather
than `requestAnimationFrame`.

## Known trade-offs

- The loop is `requestAnimationFrame`-based, so the game **pauses when the tab is backgrounded**. For
  an idle-style economy game you may eventually want `setInterval`, or to credit elapsed wall-clock
  time on return.
- Freight is charged between nations but is free inside one, so distance costs you tiles at home and
  money abroad. Internal logistics cost is the obvious next lever.
- Governments trade, build, close plants and offer you a pact when they want your market — but they
  never subsidise, never embargo and never go to war. They are economic competitors with one
  diplomatic move, not diplomats.
- A trade pact is permanent — there is no way to close one and recover anything.
- Imports bought for your *population* satisfy it directly rather than passing through your
  warehouses; only imports bought for your *factories* land in a depot, capped at a few ticks of what
  those factories actually burn. That split is what lets a country with no coalfield run a steel mill
  without turning the game into "buy low abroad, sell high abroad". You are a country, not a trading
  house.
- Only your own nation needs pacts. The other forty-five are assumed to trade freely with each other,
  which is a simplification in your favour early and against you later.
- Coastline detail comes from the 120×60 source. Borders are blocky up close; sharper outlines mean
  repainting the source art at a higher resolution, not changing the scale.
- Countries near the poles are stretched by the equirectangular projection, so Russia and Canada own
  more tiles — and get larger deposit budgets — than their true area warrants. That is a property of
  the projection, and the same one every wall map has.
- `power` is stored and traded like any other commodity, which is a convenient abstraction rather than
  a physical one. It is what makes gas and coal strategically valuable, and aluminium worth siting
  carefully.
- Save/load uses a single `localStorage` slot, and `SAVE_VERSION` is `7` — earlier saves are discarded
  rather than migrated. Tiles are **not** saved: they are regenerated from the seed. That only holds
  while nothing mutates terrain or borders after generation.
- Drawing the whole world at once (1px zoom) costs about 70ms, so the lowest zoom is best used as an
  overview rather than a working view.
