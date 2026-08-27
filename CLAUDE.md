# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Browser-based economic strategy game. **You govern a nation** — one of forty-six on a map of the
real world — and the other forty-five are run by the same code. Vanilla ES modules: no
dependencies, no build step, no bundler, no framework. Do not introduce any of those without being
asked.

## Commands

Node **is** installed (v18). Python on PATH is a Microsoft Store stub, not a real interpreter.

ES modules are blocked over `file://`, so the app needs an HTTP origin:

```bash
node tools/serve.js
```

then open <http://localhost:8123/>. (`.claude/launch.json` names the same server as `statecraft`
for the Browser pane. VS Code's Live Server also works.)

Tests:

```bash
node tools/test.js
```

`node tools/test.js <substring>` runs only matching tests. `tools/test.js` exists because **the
repo deliberately has no `package.json`** — without one Node reads `test/run.js` as CommonJS and
chokes on its `import`s, so the wrapper writes `{"type":"module"}` for the length of the run and
removes it again in a `finally`. Do not "simplify" that away by committing a package.json.

The same suite also runs in the browser at `test.html` (add `?only=<substring>` to filter), which
is the path to use when you need a DOM.

### Driving headless Chrome

Only needed for the browser suite; `node tools/test.js` is faster and covers the same tests.

```powershell
& "C:\Program Files\Google\Chrome\Application\chrome.exe" --headless --disable-gpu --no-sandbox `
  --virtual-time-budget=8000 --user-data-dir="$env:TEMP\cr-test" `
  --dump-dom "http://localhost:8123/test.html"
```

Grep the dumped DOM for `id="summary"` and `<li data-ok="false">`. Four things about this were each
measured the hard way, and all four fail **silently** — Chrome hangs until killed, writes nothing to
stdout and logs nothing to stderr, which is indistinguishable from a slow test:

- **Serve over HTTP, not `file://`.** The sandbox can block Chrome from reading local files and you
  get zero bytes rather than an error; `--allow-file-access-from-files` does not rescue it.
- **`--user-data-dir` must be on a short path.** Chrome creates deep nested directories inside the
  profile and blows past `MAX_PATH` under a long scratch path. This one is *intermittent*, because
  whether it trips depends on the length of the random suffix — it will look like a flaky suite.
- **Capture stdout with `Start-Process -RedirectStandardOutput`.** Piping Chrome's output into a
  PowerShell variable yields nothing.
- **Avoid `import()` and top-level `await` in a throwaway probe page.** Dynamic import deadlocks
  under `--virtual-time-budget`; static imports, as the real pages use, are fine.

If Chrome hangs, sanity-check it with `--dump-dom about:blank` before suspecting the game. The whole
suite dumps in well under a second, so anything taking tens of seconds is one of the failures above.

## Architecture

One-way data flow. Two rules keep it acyclic, and both are load-bearing:

- **Systems never touch the DOM.** This is what lets `test/run.js` build a state and call systems
  directly. Importing anything from `src/ui/` into `src/systems/` breaks the suite's ability to run
  headlessly.
- **UI never mutates state.** It calls into `src/actions.js`, which validates *before* mutating and
  returns `{ok, reason}`, so a rejected action never half-applies.

`state` (in `src/core/state.js`) is the simulation and is the save file. `ui` is a **separate**
object (selection, active build tool, zoom, which market is on screen) that deliberately does not
persist.

### You are a nation, not a company

There is no player object. `state.countries` holds all forty-six governments with identical shape —
treasury, solvency, report, demand, supply, pacts — and `state.home` is the only thing that says
which one is yours. Every system asks `isPlayer(state, id)` rather than checking a magic id.

Two consequences are load-bearing:

- **A government builds only on its own soil**, so `building.owner` is *also* the nation the site
  stands in. That single field answers "whose is it" and "whose wages, whose market". There is no
  separate `country` field and adding one back would create two sources of truth.
- **The rest of the world is a market, not real estate.** You cannot buy land abroad at any price.
  What you buy is a *trade pact* (`state.countries[id].pact`), and the fee lands in that nation's
  treasury — so opening a market funds the industry you then compete with.
- **...and pacts come the other way too.** `systems/diplomacy.js` has a nation with goods it cannot
  place at home (or people it cannot feed) offer YOU a pact, and since it is the one asking, it pays:
  accepting is income (`CONFIG.diplomacy.fee` of what the same pact would have cost you). Offers live
  on `state.offers`, lapse after `CONFIG.diplomacy.ttl` ticks, and the roll that picks the suitor is
  a pure function of `seed` and `tick`, so a save replayed sees the same nations come knocking.

`canTrade` is asymmetric on purpose: the forty-five foreign nations trade freely among themselves
and only *you* need a pact. They have had embassies for a century; you are the newcomer. A new game
opens with `STARTING_PACTS` of your nearest neighbours already signed, because most nations saturate
their own market on their first oil rig and would otherwise have nowhere to send anything.

### The tick pipeline is a design decision, not plumbing

`src/systems/index.js` defines the tick as an ordered list. Reordering it changes game behaviour:

- `collect` runs **before** `produce` so a site's throughput cannot depend on its index in
  `state.buildings` — this is what keeps ticks deterministic.
- `distribute` runs after `produce` so goods take a tick to travel, which is the visible chain-fill
  latency, not a bug to optimise away.
- `wages` runs before the markets so solvency gates production, rather than same-tick revenue
  rescuing payroll.
- **`domestic` runs before `trade`.** A nation feeds its own people before it feeds anyone else's,
  and only the surplus is offered abroad. Reverse these two and exporting would starve your own
  population for a better price.
- `prices` and `growth` run after both, so a market is repriced on the whole tick's supply — home
  sales and imports alike — and the economy grows or shrinks on that same figure.
- `state` industry runs LAST, so a government decides on settled numbers. `diplomacy` sits beside it
  for the same reason: an offer is a government's decision, taken on the same settled numbers.
- **`ledger` runs FIRST.** Four systems write into `state.ledger.tick` (production books what was
  made and burned, `domestic` what your people bought, `trade` what crossed a border) and none of
  them can reset it, because each sees only its own slice of the tick. Folding at the TOP rather than
  the bottom is what lets the panels read the tick that just finished: a render happens after the
  pipeline, so `tick` still holds the figures on screen and `total` carries the game.

Treat the order as a contract. If a change seems to need a different order, that is a game-design
question for the user.

### How money actually moves

Four flows, and nothing else:

1. **Tax base** (`CONFIG.taxPerDemand` × `demand`) — what the private economy this game does not
   simulate hands every treasury each tick. It is why `demand` is worth growing for its own sake,
   and why no nation can be permanently killed: a government that closes every plant still collects
   taxes and can start again.
2. **Domestic sales** — warehouses sell to their own population at the local price, capped at that
   nation's `appetite` for the tick. Past that there is no buyer at home. **That cap, not a flag, is
   what makes exporting necessary.**
3. **Trade** — surplus goes to a partner short of it, at a price that splits the difference between
   the two local prices, minus freight scaled by distance. Both sides gain, which is why trade
   happens at all.

   There are **two kinds of buyer**, and the difference is where the cargo ends up. A `people` buyer
   bids against its unmet appetite and the goods are eaten on arrival: a pure cost that buys supply,
   and therefore growth. An `industry` buyer bids against what its own factories burn and cannot dig
   up, and that cargo lands in its **warehouses** — which is the only reason a country with no
   coalfield can run a steel mill. Feedstock is capped at `CONFIG.trade.inputBuffer` ticks of
   consumption and at the depot space to put it in, so no treasury can corner a market in one tick,
   and it does **not** count toward the buyer's supply: a cargo on its way to a factory floor must
   never read as a fed population.

   Both kinds sit in ONE queue sorted by price, because a factory competes for a cargo like any other
   bidder. Running every population on earth before any factory is the same thing as never importing
   feedstock at all — with `selfSufficiency` under 1 somebody is always hungry. Within one country
   its own people still win the tie, which is the same rule that puts `domestic` before `trade`.

   The arbitrage loop this used to be guarded against is closed by the pipeline instead: `distribute`
   runs before `sellDomestic`, so imported feedstock reaches the factories that asked for it before
   anything can be sold over a counter.
4. **Wages and build costs** — out.

`CONFIG.spoilage` takes a small share of warehouse stock each tick. It is what stops a nation
stockpiling a commodity nobody wants for ever, and it is the pressure that makes finding a market
matter.

### Balance lives in data, never in systems

All numbers — costs, wages, recipes, prices, radii, capacities, pact fees, resource endowments — are
in `src/data/`, with the cross-cutting economic constants in `src/core/config.js`. Adding an industry
or a nation is a new object literal; it needs no new file, no class, and no edit to any system. A
hardcoded quantity inside `src/systems/` is a bug, and so is a system that reads a country *name*.

- `buildings.js`, `commodities.js` — twenty-two industries and twenty-one commodities in three tiers.
- `countries.js` — the forty-six nations: `wageMul`, `demand`, `pop`, and `deposits`. Also `char`,
  its character on the map.
- `world.js` — the hand-editable source map, sixty 120-character rows, traced from real coastlines.
- `geography.js` — **derived** data: each country's centroid and the distance matrix between all of
  them, computed once from the art. Freight reads this, so moving a coastline moves the freight bill
  with it and the two can never disagree.

**The source map is 120×60; the playable grid is 600×300 — 180,000 tiles.** `world.js` upscales the
art at load (`expand`), so the whole planet stays reviewable in one screen and a coastline is edited
in one place instead of twenty-five adjacent tiles. The projection is plain equirectangular: column 0
is 180°W at 3° per column, row 0 is 84°N at 2.35° per row. Russia and Canada are stretched near the
poles exactly as on a Plate Carrée wall map, and their tile counts (and therefore deposit budgets)
reflect that.

**Longitude wraps.** `geography.js` measures the short way round the globe, so Japan is nearer the
United States across the Pacific than the United Kingdom is overland. A flat measure would route that
cargo back over Europe and charge for it.

Terrain gates placement via `def.terrain`: `plain`, `water`, `desert`, and nine resource terrains —
`hills` (iron ore), `coalfield`, `oilfield`, `gasfield`, `copperbelt`, `bauxite`, `quarry`
(limestone), `farmland`, `forest`. Desert takes extraction and warehouses but no factories, so an
oil-rich desert nation cannot refine its own crude — that asymmetry is deliberate.

`warehouse` is the only building with `recipe: null`, and that null is how the systems distinguish
storage from production.

### Three silent traps when editing country data

- **Land deposits are authored against the 120×60 source and multiplied by `AREA_SCALE`.** Write the
  number as a count of *source* cells. Fractions are allowed and are the only way to give a one-cell
  country like the Netherlands a partial endowment.
- **Water deposits (`waters`) are FRACTIONS of a country's territorial sea, not counts.** The sea is
  not in the source art, so there is nothing to scale against and a fraction is scale-free.
- **A country's deposits must sum to no more than ~60% of the cells it owns.** `MAX_DEPOSIT_SHARE`
  reserves flat ground, and once the budget runs out, generation drops whatever comes last in
  `DEPOSIT_ORDER`. `DEPOSIT_ORDER` therefore puts scarce and strategic resources first and ubiquitous
  filler (quarry, farmland, desert) last, so a cramped country keeps what it is known for. A test
  fails if any country over-subscribes. Iran and Saudi Arabia sit right on the cap, so anything added
  to either has to be paid for out of what it already has — Iran's coalfields came out of its land
  oil, not out of thin air.

**`wageMul` is UNIT labour cost, not the hourly wage.** A German hour costs fifteen times an
Ethiopian one but buys far more output, so the spread here is about six to one. This matters because
wages are the only running cost in the game besides inputs: set the multipliers off hourly pay and
every high-wage nation becomes unplayable, since every plant it could build loses money on the day it
opens. A test asserts the dearest labour on earth can still profit on the deepest chain.

### Governments are you, without the mouse

`systems/stateIndustry.js` is about a hundred and eighty lines because it only decides *what* to
build; `build()`, `produce`, `collect`, `payWages`, `sellDomestic` and `runTrade` do the rest. Four
rules in it are load-bearing, and each one was added to fix a specific way the world used to fall
apart:

- **Depots are decided before industry, not scored against it** (`needsDepot`). A warehouse earns
  nothing directly, so any profitable plant always outbids it — and a government that only ever
  built plants ended up with one full warehouse and thirty sites blocked behind it.
- **...but at most one depot per `stateSitesPerDepot` sites.** A site can end up somewhere no
  warehouse will ever reach (an offshore rig far from a coast a depot can stand on). Without the
  ratio cap, that one site made the government build warehouses for ever.
- **Plans are costed pessimistically** (`marginPerTick` values output at the *lower* of local and
  base price, inputs at the higher). A market nobody supplies sits at a shortage premium; a
  government that took it at face value built into it, collapsed the price it was counting on, and
  then paid wages on a plant that no longer covered them.
- **A broke government closes its most expensive plant** rather than idling every site and paying the
  payroll on all of them for ever. It keeps the warehouse to last, since selling that strands
  everything else.

- **An input it cannot dig up still counts as available if the world is offering it.** `bestSite`
  accepts a recipe input the country produces *or* that is standing in warehouses somewhere
  (`worldOffer`, indexed once per decision) — the same feedstock channel you use. Refusing to plan
  around a bought input left half the map as pure extraction economies. `marginPerTick` then prices
  those inputs at the DEARER of local and base price, so a plan built on imports has to clear a
  margin at a price it will not be beaten by.
- **A decision may build up to `CONFIG.stateBuildsPerDecision` sites**, and it stops the moment
  nothing is worth building or the reserve is reached. One site every eight ticks left most of the
  world sitting on a treasury it never turned into industry.

`hasHeadroom` stops a government building capacity it has nowhere to send: its own people cap what it
can sell at home, and the export market is worth a slice of what the whole world eats. That is what
lets Norway build a gas industry many times larger than Norway without carpeting its deposits and
going bankrupt.

### Demand is real, and prices are local

Each nation prices every commodity itself (`state.markets[countryId][commodityId]`). Its appetite per
tick is its own `demand` × the commodity's `demandShare` × `CONFIG.demandScale`, and
`CONFIG.selfSufficiency` is what the private economy supplies without you — so an untouched market
sits at a standing premium instead of pinning at the ceiling. Sell into a nation and you push *its*
price down, nobody else's.

**`demand` is the only country figure that moves during a game.** `growEconomies` compounds it when a
nation's people are supplied above `CONFIG.growth.pivot` and shrinks it when they are not, bounded by
`floor`/`ceiling` multiples of the authored value. Because `demand` drives both appetite and the tax
base, a nation you starve is a customer you are destroying — and one you supply pays you to keep
doing it.

### The map is the page; the panels float on top of it

`.layout` is ONE layer. The map is absolutely positioned to fill it, and both panels are modals over
it — left `10px`, right `10px`, top to bottom — so the world is never squeezed into the middle third
of the window. Neither the page nor the body scrolls: `body` is a flex column of a fixed topbar and
the layout, and the only things that scroll are the map and the insides of the two panels.

Consequences worth knowing:

- **Both panels fold away**, and both keep a handle: the left one leaves the `☰ Build` rail
  (`ui.leftOpen`, `B`), the right one leaves its tab strip (`ui.panelOpen`, or clicking the tab you
  are already on).
- **Every pane is meant to fit its panel without scrolling.** That is why the build menu is two
  columns of one-line rows, why the market table's rows are single-line (`.market td` is `nowrap`,
  the name truncates, and figures use `priceShort`/`qtyShort` so a four-digit price cannot wrap a row
  into two lines), and why the standing explanations are `<details>`. If you add a column or a line,
  check the panes still fit. Three are allowed to outgrow the panel, each for a reason: the factory
  list (a nation can hold hundreds of sites), the Trade pane (forty-six nations sit at the bottom of
  it) and Ranks (forty-six rows). **Sideways is a different matter** — a pane that overflows
  horizontally puts a scrollbar across the whole panel, which is why the nine-column Ranks table
  lives in its own `.scroller` and why a summary card's `.facts` is one column rather than two.
- **Scrollbars are hairlines** — 6px, styled once in `base.css` for every scroller including the map.

### The side panel is one column with seven views

`index.html` declares a `<section class="pane" data-pane="…">` per view; `src/ui/tabs.js` owns the
strip and the `TABS` list that names them. `ui.tab` says which is on screen, `ui.panelOpen` whether
the panel is unfolded at all, `ui.leftOpen` whether the build panel is, `ui.openFactoryId` which site
has its numbers unfolded, `ui.goodsView` whether the commodity book reads the tick or the game, and
`ui.rankSort` which column the nation table is ranked by — all on `ui`, so none of it reaches the
save file. Seven tabs no longer fit one row of a 352px panel, so **the strip wraps**: a tab you
cannot read is not a tab you will click.

**Only the visible pane is repainted.** `src/ui/render.js` dispatches through `PANES` and returns
early when the panel is folded away; the topbar, build menu, map and alerts are outside that, because
they are always visible. A pane's update function is therefore not guaranteed to have run this tick,
so nothing may accumulate state there — every pane derives what it shows from `state` on the spot.

Five things earn their own view rather than sharing one:

- **Factories** is the only place that answers "is this plant earning its wages": inputs held against
  what a job needs, what it makes and at what rate, and its working percentage. `b.uptime` is a
  rolling average kept by `produce()` (weighted by `CONFIG.uptimeSmoothing`), because that system is
  the only one that knows whether a tick was actually worked. A warehouse has no recipe, so its bar
  is how full it is instead.
- **Summary** is derived from the other four and owns nothing. It exists so the answer to "how is the
  nation doing" is not four tabs of reading.
- **Goods** is the commodity book: made, burned, sold at home, shipped out, bought in — per tick or
  for the whole game — read from `state.ledger`. The treasury only ever shows money and Prices only
  ever shows one market, so this is the only place that shows *goods*. The bracket in the `In` column
  is the feedstock share, which is how you see the industrial import channel working at all.
- **Ranks** scores all forty-six nations against each other. The scoring rule (`scoreNations` in
  `src/ui/ranks.js`) is the one piece of UI with a rule rather than a layout in it, so it is covered
  by the suite — which means it must stay free of the DOM, like a system. Its measures are
  normalised against the best in the world, so a score is a standing rather than a unit.
- **Selected** is the old inspector. Clicking the map lands there only when no build tool is in hand:
  laying out a chain must not yank the panel away from the list you were reading.

### Messages expire in real time

`pushAlert` stamps a wall-clock `at`, and `main.js` sweeps expired alerts on a 500ms timer rather than
on a tick — a message you have read clears itself whether the game is running at 4x or sitting
paused. `CONFIG.alertTtlMs` is both the sweep deadline and the `--ttl` the countdown hairline animates
over, so the bar always runs out exactly when the alert goes. Repeating an alert refreshes `at` and
bumps `count` instead of stacking a duplicate.

Building and demolishing announce themselves from `src/actions.js`, guarded by `isPlayer` — the other
forty-five governments call the same `build()` every few ticks and none of that is your news.

## Footguns

**The inspector, the nation card, the trade head, the pact offers, the deal list, the trade-by-
commodity table, the summary cards, the factory header, each open factory's details, the ranks header
and the alerts all diff on signature strings** via `dataset.sig`. If you make one of
those visuals depend on a new piece of state, you **must** add it to that signature or it will simply
never repaint — with no error. The inspector signature uses a **boolean** for pact affordability
rather than the cash figure, so selecting a foreign country does not rebuild the panel every tick.

**The factory list diffs on two levels, and the outer one is a list of ids** (`dataset.ids`). Rows are
rebuilt only when the set of your sites changes; every tick after that writes the numbers into the
existing rows. Rebuilding the list each tick would throw away the unfolded row and the scroll
position — which is exactly the state you are using while you read it. The Goods table and the Ranks
table work the same way for the same reason: their rows are built once at mount (twenty-one
commodities, forty-six nations — both fixed lists) and only their figures are written per tick. Ranks
additionally re-orders its existing rows, and only when `dataset.order` actually changes.

**Your own deals live in `state.ownFlows`, not in `state.flows`.** The world list is capped at
`CONFIG.maxFlows` and a busy planet fills it in a tick or two, so filtering it for your own deals —
which is what the Trade tab used to do — showed a handful and silently hid the rest. `recordFlow`
writes to both. The deal list also GROUPS by partner, commodity and direction, because the same cargo
goes to the same partner every tick and sixty raw lines were four routes written fifteen times.

**The map does NOT work that way — it is a canvas.** At 180,000 tiles there is no DOM option: that
many elements exhausts memory and stalls layout, and virtualising the viewport does not rescue it
because zooming out legitimately puts every tile on screen. `src/ui/map.js` repaints the visible
window on every render, so there is no per-tile cache to keep in step. Terrain and ownership colours
therefore live in `TERRAIN_COLOR` and `fillFor()` in JS, **not** in CSS.

Consequences worth knowing before editing the map:

- Ownership is painted in **three tiers** — your own soil at full strength, a pact partner readable,
  everyone else pushed back — because those are exactly the three relationships you can have with a
  nation, and it makes the map answer "where can I sell" at a glance.
- Scrolling is native. A `.map__spacer` div sized to the whole world provides the scrollbars; the
  canvas is absolutely positioned at the content origin and moved with a `transform` matching the
  scroll offset. A sticky element inside the scroller was tried and is not dependable.
- Clicks and hover are hit-tested from mouse coordinates plus scroll offset. There is no element per
  tile to attach a listener to.
- Measured draw cost: 69ms at 1px (the whole world at once, the worst case), 21ms at 2px, 1ms at 8px.
  Renders happen on a tick, not a frame — do not add a per-frame render.
- **The canvas is sized from a `ResizeObserver`, and that is load-bearing** now that the map fills the
  window. Its size is zero on the first layout pass and changes with the window, but a render only
  happens on a TICK — so a paused game would sit blank or stretched until something else moved.
  `mountMap` returns a `dispose` that disconnects it, because remounting builds a second canvas and a
  stale observer would keep painting the detached one.
- Buildings are indexed into a `Map` by `tileId` once per draw. Searching `state.buildings` per tile
  is `O(tiles × buildings)` and dominates everything else.

Zoom is `ui.zoom`, an index into `CONFIG.zoomLevels`. It lives on `ui`, not `state`, so it never
reaches the save file. Glyphs are dropped below 10px because they are illegible there.

**Tiles are not saved.** 180,000 tile objects run to tens of megabytes and blow the localStorage
quota, so `packState` strips them and `loadState` calls `rehydrate`, which regenerates them from
`seed` and reattaches each building via its `tileId`. This works only because **nothing in the game
mutates terrain or `countryId` after generation** — if you add a mechanic that does (terraforming,
conquest), the save breaks silently and you must persist a diff.

**Commodity bags are compacted on the way out and refilled on the way in.** Every bag carries a key
per commodity and quantities go fractional once spoilage and part-filled orders touch them, so a bag
serialises as twenty-one entries, most of them zero, several of them seventeen digits long — roughly
ten times the necessary size at a thousand sites. `packBag` drops zeros and rounds; `rehydrate`
restores the full bag, and that restore is **required**: the systems subtract from these keys in
place, and a missing key produces `NaN` rather than an error. A save runs about 80KB fresh and 640KB
after a thousand ticks — it is dominated by buildings, so it grew when the governments started
building two sites a decision, and it is worth re-measuring if that changes again.

**Building `status` is a closed vocabulary** (`running`, `starved`, `blocked`, `unstaffed`, `store`,
`idle`) set in `src/systems/production.js` and consumed in five places: styled by attribute selectors
in `styles/map.css` and `styles/panel.css`, and labelled in `src/ui/inspector.js`,
`src/ui/factories.js` and `src/ui/summary.js`. Adding a status means touching all of them.

**The commodity ledger tracks YOUR nation only.** Forty-six of them would be six hundred numbers a
tick in the save file, and the other governments are read as rankings rather than as accounts —
`ranks.js` derives everything it shows from `state` on the spot. Every write is guarded by
`isPlayer`, and `noteLedger` tolerates a state built without a ledger rather than making four systems
check. Its figures are full-precision floats for a whole game, so `packState` rounds them on the way
out exactly as it rounds `uptime`.

**Save compatibility.** Anything put on `state` must be JSON-round-trippable — no `Map`, `Set`,
`Date`, or class instances, or load will silently produce a broken game. Bump `SAVE_VERSION` in
`src/core/state.js` when the shape changes; mismatched saves are discarded rather than migrated.

**Do not verify tick behavior through headless Chrome.** Headless fires `requestAnimationFrame`
exactly once regardless of `--virtual-time-budget`, so the game will always report 0 ticks there.
That is a harness limitation, not a bug — it has been measured. `createLoop` takes an injectable
`schedule`/`cancel` precisely so timing is tested with a fake clock; test the loop that way.

**Production consumes atomically.** A multi-input recipe must check every input before consuming any,
and record which ones are short in `building.shortage` (the UI reads it). Partial consumption would
deadlock chains and is covered by a test.

**`collect` and `distribute` index depots by owner once per tick.** Asking `warehousesServing` per
site — which scans every building in the world — is the hottest pair of loops in the game, and at two
thousand buildings it was over half the tick on its own. The index is built in `state.buildings`
order, so the order goods are drawn in is unchanged and ticks stay deterministic. `warehousesServing`
itself is still the answer for one-off questions from the UI and from state industry.

**Trade indexes stock and payroll once per tick.** Asking `warehouseStock`/`projectedWages` per
country per commodity — the obvious way to write `runTrade` — is forty-six times twenty-one scans of
every building in the world, every tick.
