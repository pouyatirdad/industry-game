# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Browser-based economic strategy game. **You govern a nation** — one of 258 countries and territories
on a real polygon-derived world map — and the rest are run by the same code. Vanilla ES modules: no
dependencies, no build step, no bundler, no framework. Do not introduce any of those without being
asked.

## Commands

Node **is** installed (v18). Python on PATH is a Microsoft Store stub, not a real interpreter.

**If `node` is not on PATH, do not give up on the suite — VS Code ships one.** Its bundled Electron
runs as a real Node (v24) when `ELECTRON_RUN_AS_NODE=1` is set, and both `tools/test.js` and
`tools/serve.js` work under it unchanged:

```powershell
$env:ELECTRON_RUN_AS_NODE=1
& "$env:LOCALAPPDATA\Programs\Microsoft VS Code\Code.exe" tools\test.js
```

The same trick serves the app, which is what lets headless Chrome load `index.html` over HTTP at all.

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

**Do not run two of those wrappers at once.** They write and delete the same marker file, so a
second one finishing pulls the ESM marker out from under the first, which then dies on `require is
not defined in ES module scope` — a failure that has nothing to do with the code under test. If you
write a throwaway script that needs the marker, run it *after* the suite, not beside it.

### Regenerating the world

`src/data/worldProvinces.js` is generated, not written:

```bash
node tools/genworld.js <path-to>/ne_10m_admin_1_states_provinces.geojson
```

The source is Natural Earth's 10m admin-1 layer (public domain, from the `nvkelso/natural-earth-vector`
GeoJSON mirror, ~39MB). It is deliberately NOT in the repo — the repo carries the raster, exactly as
it always carried one. The 50m edition looks like the obvious cheaper choice and is not: it has 294
subdivisions covering a handful of federal countries, where the 10m has 4,596 covering every one.

When the user asks you to commit and push, update this file in the same change if the work teaches a
new repo rule, run the relevant tests first, commit only the files you intentionally changed, and
push the current branch. Do not leave a requested push as a reminder.

Important: all pushes and commits must be on the `develop` branch.

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

### Driving the real UI from a throwaway page

The suite cannot reach `main.js` — it is the wiring layer and needs the DOM — so a keyboard shortcut
or a pointer gesture is verified by loading `index.html` in a **same-origin iframe** from a scratch
page in the repo root, pressing at it, and writing the results into an element `--dump-dom` will
capture. Four things about that are each worth knowing before writing one:

- **Dispatch keys on `doc.body`, not on `doc`.** A real keypress targets an element, and the handler
  guards with `event.target.matches(...)`, which a `Document` does not have. Dispatching on the
  document makes every shortcut look broken when none of them is.
- **The map selects on `pointerdown`/`pointerup`, never `click`** (a drag that ends on a tile must
  not build there), so a synthetic `click` does nothing at all.
- **Stub `setPointerCapture`/`releasePointerCapture` on the map before dispatching.** A synthetic
  `pointerId` was never a real pointer and Chrome throws on capturing one, which kills the handler
  before it records the gesture.
- **Zoom in before hunting for anything on the canvas.** At the opening 2px a tile a formation is a
  two-pixel disc; the only way to ask "what is under this pixel" from outside the module is the
  hover tooltip (`canvas.title`), and a sweep coarser than a tile walks straight past it.

Delete the page afterwards — it is a probe, not a fixture.

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

There is no player object. `state.countries` holds every government with identical shape —
treasury, solvency, report, demand, population, supply, debt — and `state.home` is the only thing that says
which one is yours. Every system asks `isPlayer(state, id)` rather than checking a magic id.

Two consequences are load-bearing:

- **A government builds only on its own soil**, so `building.owner` is *also* the nation the site
  stands in. That single field answers "whose is it" and "whose wages, whose market". There is no
  separate `country` field and adding one back would create two sources of truth.
- **The rest of the world is a market, not real estate.** You cannot buy land abroad at any price.
  What you can do is deal with it — and every market on earth is open to every nation, so `canTrade`
  is now simply "are these two different countries". There is no permission to buy and nothing to
  purchase your way into.
- **What limits a deal is that somebody has to agree to it.** Nothing is bought or sold
  automatically on anybody's behalf. Goods cross a border only under a CONTRACT, and a contract
  exists only because two governments agreed terms — either on the open book in
  `systems/exchange.js`, or by name in the Trade tab.

### The tick pipeline is a design decision, not plumbing

`src/systems/index.js` defines the tick as an ordered list. Reordering it changes game behaviour:

- `collect` runs **before** `produce` so a site's throughput cannot depend on its index in
  `state.buildings` — this is what keeps ticks deterministic.
- `distribute` runs after `produce` so goods take a tick to travel, which is the visible chain-fill
  latency, not a bug to optimise away.
- `wages` runs before the markets so solvency gates production, rather than same-tick revenue
  rescuing payroll.
- **`contracts` runs before `domestic`.** A contract is a PROMISE: the cargo leaves the country
  before the shopkeeper opens. That single ordering is what gives one teeth — over-commit your own
  supply and you really will starve your own people for it — and whatever survives every contract is
  what its own factories, and then its own people, get to work with.
- **`relay` runs between `contracts` and `distribute`.** A nation's depots are a NETWORK, not a
  set of islands: a depot hauls to a neighbouring depot whatever the factories on the far side of
  it are short of. It is after `contracts` because a promise still outranks a smelter, and before
  `distribute` so a cargo hauled across the country reaches the plant that asked for it on the same
  tick rather than a tick later.
- **`distribute` runs after `contracts` and BEFORE `domestic`.** A factory draws its inputs out of
  the depot before the counter opens, because otherwise a nation's own population outbids its own
  industry for free: an imported cargo of coal landed in the warehouse and was sold over the counter
  the same tick, every tick, and the steel mill it was bought for never saw a lump of it.
- **`domestic` runs after `contracts`.** A nation feeds its own people out of whatever its promises
  and its own factories left behind. There is no spot market after it at all.
- `prices` and `growth` run after both, so a market is repriced on the whole tick's supply, and the
  economy grows or shrinks on that same figure. `growth` also moves POPULATION, far more slowly.
- `lending` runs before `report`, because interest and repayment move the treasury and the net on
  screen has to be the whole net.
- `research` runs before `report`, so the laboratories are paid for out of the same tick's treasury
  and the net on screen is the whole net. It sits with the decisions at the bottom because it is one.
- **`relations` runs before `army`, and `army` before `security`.** A declaration of war matures
  into a war, THEN governments decide what to raise and where to send it, THEN the shooting happens.
  Any other order costs a tick somewhere: an army ordered at an enemy it is not yet at war with, or
  a war that begins after the armies have already decided they had nothing to do this tick.
- `state` industry runs LAST, so a government decides on settled numbers. `exchange` sits beside it
  for the same reason — posting an ask is a decision taken on the same numbers, and a match written
  now first delivers next tick — and so do `licensing` (who will sell you a technology) and
  `dealing` (who wants a contract by name).
- **`ledger` runs FIRST.** Four systems write into `state.ledger.tick` (production books what was
  made and burned, `domestic` what your people bought, `contracts` what crossed a border) and none of
  them can reset it, because each sees only its own slice of the tick. Folding at the TOP rather than
  the bottom is what lets the panels read the tick that just finished: a render happens after the
  pipeline, so `tick` still holds the figures on screen and `total` carries the game.

Treat the order as a contract. If a change seems to need a different order, that is a game-design
question for the user.

### Depots are a NETWORK, not a set of islands

`relay` in `systems/logistics.js`. A depot serves the industry inside its own radius and nothing
further, which is why a nation whose power stations stand in the east and whose copper smelter
stands in the west could watch one warehouse fill with electricity while the other starved: the two
never spoke, and the smelter sat `starved` for ever with the goods it wanted already in the country.

- **Two depots of one owner are NEIGHBOURS when their catchment areas touch** — Chebyshev distance
  no greater than the SUM of their radii. So a warehouse built halfway between two distant ones
  genuinely bridges them, which is the whole reason a player would put one there. The rule is
  derived from `radius` in `buildings.js`; there is no distance written in the system.
- **Cargo is PULLED, never pushed, and only toward a factory that is actually short of it.** A depot
  with nothing near it that eats aluminium never accumulates aluminium, so this cannot become a
  second, invisible way to hoard. Need is measured exactly as `distribute` measures it — `inCap`
  minus what the plant is holding — so the two can never disagree about what "short" means.
- **Flow is strictly DOWN a hop gradient, and that is what makes it acyclic.** `hopsToNeed` is a BFS
  from every depot that wants the commodity; a depot only ever draws from a neighbour at the same
  depth or deeper. Nothing can be handed back and forth, and a depot never gives away what its own
  industry is waiting for — a donor offers `held - need`, never its whole shelf.
- **An unmet request passes OUTWARD as `pending`.** Shallower depots are served first, so by the
  time a deep one is reached it knows everything being asked of it: that is what makes the middle
  warehouse ask the eastern one for power because the western one asked IT. One hop a tick, which is
  the same visible latency `distribute` has always had.
- It is owner-scoped like the rest of `logistics.js` — a government's depots are never free
  infrastructure for anybody else's industry — and it moves nothing across a border, so it is not a
  second way for goods to leave the country.

### How money actually moves

Four flows, and nothing else:

1. **Tax base** (`CONFIG.taxPerDemand` × `demand`) — what the private economy this game does not
   simulate hands every treasury each tick. It is why `demand` is worth growing for its own sake,
   and why no nation can be permanently killed: a government that closes every plant still collects
   taxes and can start again.
2. **Domestic sales** — warehouses sell to their own population at the local price, capped at that
   nation's `appetite` for the tick. Past that there is no buyer at home. **That cap, not a flag, is
   what makes exporting necessary.**
3. **The exchange** — a nation with a surplus posts an ASK, one with a shortage posts a BID, and
   when they cross the pair becomes a contract at a price that splits the difference. Freight scales
   with distance, so geography still decides who your natural customers are. The house takes
   `CONFIG.exchange.fee` from BOTH sides of every settlement it brokered, and that money does not
   vanish — see the clearing fund below.

   A nation bids for two different reasons and both count: what its factories burn and cannot dig
   up, and what its people are simply short of. Scoring a bid by what the cargo is WORTH was a quiet
   disaster — every nation on earth spent its listings bidding for aircraft it had no chance of being
   sold while the coal its own power stations were idle for went unasked for. Urgency is about need:
   a shortage that idles a factory outranks everything, and after that it is how much of the diet is
   missing (`topBids`).

   Asks and bids have **separate per-nation allowances**. Sharing one cap looked tidier and broke the
   market: a nation short of a few things filled its whole allowance with bids, never offered its own
   surplus again, and the world ended up with warehouses full of coal and nobody selling any.

   A contract stops counting as cover `CONFIG.exchange.renewWithin` ticks before it ends
   (`coveredBy`), so a replacement is arranged before the supply actually stops. Without that, every
   nation's imports arrived in bursts with a starved gap between them and its plants ran at two
   thirds for ever.
4. **Contracts** — a promise made in advance to move a fixed quantity at a price fixed on the day it
   was signed, for a fixed term. It is the ONLY way goods cross a border: either the exchange
   matched it for you, or you wrote it by name. The agreed price is DELIVERED — the buyer pays it and the
   seller carries the freight out of what it receives — so distance shows up in what a seller is
   willing to quote rather than as a surcharge nobody agreed to.

   **Either side can fail, and failing costs.** A seller that cannot fill the order, and a buyer
   that cannot pay for it or has nowhere to put it, pays `CONFIG.contracts.penalty` of the value it
   defaulted on straight to the other side — whether or not it can afford to, so a government that
   over-promises can drive itself insolvent and idle every site it owns. Breaking a contract early
   costs the same rate on everything still owed, which is what stops walking away from being a
   cheaper way to default.

5. **The clearing fund** — where the exchange's fee goes. It is real money sitting in
   `state.exchange.fund`, and a government that cannot make payroll BORROWS against it rather than
   closing its industry. Interest accrues every tick and repayment comes out of the tax base, so a
   nation that borrows to build is spending next decade's budget. Your own borrowing is a button, not
   a policy the engine applies for you.

6. **Research and technology licences** — out, and in for whoever sold the licence. See below.

7. **Wages and build costs** — out.

`CONFIG.spoilage` takes a small share of warehouse stock each tick. It is what stops a nation
stockpiling a commodity nobody wants for ever, and it is the pressure that makes finding a market
matter.

### Balance lives in data, never in systems

All numbers — costs, wages, recipes, prices, radii, capacities, clearing fees, resource endowments — are
in `src/data/`, with the cross-cutting economic constants in `src/core/config.js`. Adding an industry
or a nation is a new object literal; it needs no new file, no class, and no edit to any system. A
hardcoded quantity inside `src/systems/` is a bug, and so is a system that reads a country *name*.

- `buildings.js`, `commodities.js` — thirty-four industries and thirty-four commodities in four
  tiers. A building's `tech` names what must be researched before anybody may build it; an industry
  with no `tech` is one every nation starts knowing.
- `technology.js` — the tree: nineteen techs in five eras, each with a `cost` in research points and
  the `needs` it stands on. What a tech UNLOCKS is not listed there — `buildings.js` names its own
  requirement, so the two can never disagree.
- `countries.js` — hand-balanced values for featured nations plus default values for every other
  ISO country/territory: `wageMul`, `demand`, `pop`, `waters`, and `deposits`. `char` remains only
  for compatibility with the old hand-painted source art.
- `worldProvinces.js` — **GENERATED, and the live map.** A 1440×720 raster (a quarter of a degree a
  cell) of Natural Earth's 10m admin-1 polygons, run-length encoded a row at a time, plus the name
  and owner of every one of its 3,817 provinces. Do not hand-edit it: re-run `tools/genworld.js`
  against the source GeoJSON. It is one raster rather than two because **the union of a country's
  provinces IS the country** — ownership is derived from it, so who owns a cell and which province
  it is in can never disagree.
- `worldCountries.js` — the 258 ISO countries and territories (`WORLD_COUNTRY_INFO`), which is what
  decides who is in the game, plus the OLD 360×180 ownership grid. That grid is no longer read at
  run time: it is the generator's fallback for the thirty-five territories the admin-1 layer does not
  cover, and it is why the file is still here.
- `world.js` — decodes the raster into `PROVINCE_AT` (a typed array) and `SOURCE_COUNTRY_ROWS`, and
  keeps the old hand-editable 120×60 source art as reference data. There is no upscale step any
  more: the raster is the playable grid.
- `geography.js` — **derived** data: each country's centroid and the distance matrix between all of
  them, computed once from the ISO country grid with GeoJSON centroids as fallback for tiny
  countries. Freight reads this, so moving country ownership moves the freight bill with it.
- `places.js` — the province LOOKUP and the capital names. Provinces themselves are real now: Iran
  has its thirty-one where they actually are, Afghanistan thirty-two, France ninety-nine. They used
  to be derived — a country's land cut into blobs by k-means and given plausible names — and every
  line of that is gone. What is left is presentation data only: do not persist it on `state`. Three
  rules in it are load-bearing:
  - **Asking which province a tile is in is ONE typed-array read.** The map asks it per tile per
    edge while drawing, so anything else is unaffordable. `provinceIndexForTile` numbers a province
    within its own country and the map compares THAT, never two strings.
  - **Two polygons under one name are one province.** The admin-1 layer splits a few (England has
    two Haltons); merging them is what stops the map drawing a boundary between two halves of the
    same name and then writing that name on both sides.
  - **The raster answers for LAND.** Territorial water, and the cells `generateWorld` hands to a
    country too small for the raster to see, fall back to whichever of that country's provinces is
    nearest. `CAPITAL_PROVINCE` names the handful where the seat of government is not simply the
    province of the same name — without it Washington DC lands in Washington state.

**The grid is 1440×720 — 1,036,800 tiles, a quarter of a degree each.** There is no separate source
grid any more: `SOURCE_COUNTRY_W/H` and `WORLD_W/H` are the same numbers, and `WORLD_COUNTRY_ROWS`
is the same array as `SOURCE_COUNTRY_ROWS` rather than a copy. The projection is plain
equirectangular over the whole globe: column 0 is 180°W, row 0 is 90°N. Russia and Canada are
stretched near the poles exactly as on a Plate Carrée wall map, and their tile counts reflect that.

At this resolution the coastline is the real coastline — Italy has a boot, Japan has four islands,
Hudson Bay is a bay. That is the whole reason for the size, and it costs about 110MB of tile objects
and a 100ms draw at one pixel a tile. Both were measured; see the map and generation notes below
before making it bigger again.

The opening zoom is `CONFIG.defaultZoom = 1` (2px/tile), which is a hundred and sixty degrees of
longitude across a laptop screen. The top of `CONFIG.zoomLevels` is 28px/tile, and it is set by the
PROVINCES rather than by the tiles: a province name has to fit on the land it names. **The map opens
centred on your own country** (`mountMap`, on the first draw, because the spacer has no size until
then) — scroll 0,0 on a whole planet is the empty North Pacific.

`generateWorld()` also expands any country below nine land cells into a tiny cluster at its GeoJSON
centroid. This intentionally spends a little ocean or neighbour space on legibility: all countries
must be visible and buildable without turning the map into an abstract rectangle.

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

- **Land deposits are authored against a 360×180 grid and multiplied by `AREA_SCALE`.** Write the
  number as a count of cells *at that authoring resolution* — one authored cell is sixteen tiles
  today. `AREA_SCALE` divides by `AUTHORED_W/H`, deliberately NOT by the source grid, which is now
  the same size as the playable one: forty-six hand-balanced countries must not need rewriting every
  time the map gets sharper. Fractions are allowed. Default countries intentionally get a tiny
  baseline mix of farmland, quarry and hills so no country starts with nothing to build from.
  A test that measures "token" amounts has to measure them in `AREA_SCALE` too, for the same reason.
- **Water deposits (`waters`) are FRACTIONS of a country's territorial sea, not counts.** The sea is
  not in the source art, so there is nothing to scale against and a fraction is scale-free.
- **A country's deposits must sum to no more than ~60% of the cells it owns.** `MAX_DEPOSIT_SHARE`
  reserves flat ground, and once the budget runs out, generation drops whatever comes last in
  `DEPOSIT_ORDER`. `DEPOSIT_ORDER` therefore puts scarce and strategic resources first and ubiquitous
  filler (quarry, farmland, desert) last, so a cramped country keeps what it is known for. A test
  fails if any country over-subscribes. Countries authored before the grid grew can look tighter
  than they are — Iran and Saudi Arabia read as capped and in fact use well under a fifth of their
  budget — so **check the actual counts before paying for one deposit with another**: generate a
  state and count the tiles rather than trusting a comment. `MIN_VISIBLE_LAND_CELLS` scales with the
  grid for exactly this reason: it is the smallest country the deposits still have to fit inside.

**Deposits are laid in PATCHES, not scattered a tile at a time** (`layDeposits`/`growPatch` in
`state.js`). The COUNT is unchanged — the same tiles are drawn from the same shuffled pool in the
same order, so balance, the budget and the tests do not move — but each terrain grows outward from
its seed into a blob. Scattering was invisible when a tile was half a degree and a deposit was four
of them; at a quarter of a degree it is sixteen, and the whole planet turned to television static.
The frontier is picked from at RANDOM rather than in order, because strict breadth-first growth
makes a perfect diamond and a planet of identical diamonds is no better than the static was.

**`wageMul` is UNIT labour cost, not the hourly wage.** A German hour costs fifteen times an
Ethiopian one but buys far more output, so the spread here is about six to one. This matters because
wages are the only running cost in the game besides inputs: set the multipliers off hourly pay and
every high-wage nation becomes unplayable, since every plant it could build loses money on the day it
opens. A test asserts the dearest labour on earth can still profit on the deepest chain.

### Governments are you, without the mouse

`systems/stateIndustry.js` is about two hundred lines because it only decides *what* to
build; `build()`, `produce`, `collect`, `payWages`, `sellDomestic` and `runExchange` do the rest. Four
rules in it are load-bearing, and each one was added to fix a specific way the world used to fall
apart:

**Before any of them: this file is where a million tiles bites.** Three indexes keep a decision tick
affordable, and removing any one of them takes it from ~100ms to well over a second — measured, with
the cost still growing as the world builds:

- `tilesByCountry` groups every tile by country ONCE and caches it against `state.tiles` in a
  `WeakMap`, exactly as `depositsOf` in research.js does. Nothing mutates terrain or ownership after
  generation, which is the same guarantee that lets the save omit tiles.
- ...and buckets them **by terrain** inside each country, because `findTile` asks for one terrain at
  a time. Walking Russia's forty-seven thousand tiles once per building type to discover that a
  coalfield is not plain ground is thirty-four scans of a country per decision.
- `servedBy(depots, x, y)` replaces `warehousesServing` in the decision path. The old call scanned
  every building in the world per candidate tile per building type, so the cost grew with the square
  of the game's progress.

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
- **...but margin alone cannot see a SHORTAGE, so `scarcity` is measured on quantities.**
  `worldSupply` is the counterpart of `worldDemand` — what the planet can make against what it
  wants, per commodity per tick — and `scarcityOf` turns the ratio into a multiplier on a plan's
  score (outputs raise it, inputs divide it, capped by `SCARCITY_CAP`). This exists because the
  pessimism above is load-bearing AND blinding: cement pays better than limestone, so every
  government on earth built cement plants, the world ended up burning **twice the limestone it
  quarried**, and nobody could see that a quarry was the most valuable thing it could build. Prices
  could not say so, because the pessimistic valuation caps out the shortage premium on purpose —
  hence measuring it in tonnes, where the premium cannot mislead. A commodity nobody is short of
  scores 1 and changes nothing. There is a test on the world's feedstock balance and it failed for
  a long time before this went in.
- **A broke government closes its most expensive plant** rather than idling every site and paying the
  payroll on all of them for ever. It keeps the warehouse to last, since selling that strands
  everything else.
- **...and a solvent one clears DEAD CAPITAL.** `closeDeadSites` demolishes a producer that has
  stood `CONFIG.stateSalvage.deadAfter` ticks without working (`uptime` under `deadUptime`) and
  takes the refund, so a bad decision becomes capital rather than a permanent drain on the payroll.
  It runs BEFORE the build decision, so the refund is in the treasury and the ground is free when
  that decision is taken. Three guards keep it from thrashing: a plant gets a long grace period
  (a chain takes time to fill, and one judged before its feedstock arrives would be torn down the
  tick before it started paying), only a genuinely idle one counts, and a warehouse is never
  touched. `building.builtAt` exists solely for this.

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

**`demand` and `pop` both move during a game, and they are not the same thing.** `growEconomies`
compounds demand when a nation's people are supplied above `CONFIG.growth.pivot` and shrinks it when
they are not. Because `demand` drives both appetite and the tax base, a nation you starve is a
customer you are destroying — and one you supply pays you to keep doing it.

**Population is the slower thing underneath it**, and it needs BOTH conditions: shops that are
genuinely full (`CONFIG.population.pivot`) AND a treasury comfortably ahead of its own bills
(`wealth`, measured against its own tax base so it means the same to DR Congo as to the United
States). It only falls below `starve`. Those are three bands, not two, and the middle one — fed, but
not richly — is where most of the world sits: making the grow and shrink thresholds the same figure
quietly emptied the planet.

More people **widens the band demand may move in** rather than pushing demand up directly: the
`floor`/`ceiling` multiples are taken against `base × pop/basePop`. So a nation can populate and
still shrink if it cannot feed anybody, which is the honest outcome — and a nation that gets rich and
stays supplied compounds twice.

### The exchange is how two nations find each other

`src/systems/exchange.js`. Every nation may deal with every other, so the problem is not permission
but discovery: a nation with four hundred tonnes of coal and no customer, and a nation three
continents away whose steel mill is idle for want of it, have no way to know about each other.

So they post. A surplus is an ASK, a shortage is a BID, both sit on one open book that everybody
including you can read, and when a bid crosses an ask the pair becomes a contract. Three things
follow, and each is load-bearing:

- **Nothing here is a separate economy.** A match is a contract exactly like one you wrote by hand,
  settled by `runContracts` in the same pass with the same penalties. `signContract` is still the
  only way one comes into being, so the exchange cannot write terms you could not.
- **The house takes a cut of both sides and it goes somewhere.** `CONFIG.exchange.fee` on every
  settlement builds `state.exchange.fund`, which is what nations borrow against — so the clearing
  fee is the thing that stops a bad decade from being permanent.
- **A listing is public.** You can take a government's ask before another government does, which is
  the whole reason to keep the book on screen. Yours are public too, and a handful of them sorted by
  price among everybody else's is unfindable — hence the **Everybody / Yours** filter above the book
  (`ui.bookFilter`), which is how you get back to a listing to withdraw it.
- **The form fills itself in from the same arithmetic the governments use.**
  `suggestListing(state, id, side, commodityId)` in `systems/exchange.js` returns the quantity and
  price `topAsks`/`topBids` would have posted for one commodity, and the Market pane's "Fill from my
  books" button drops it into the draft. It lives in the system, not in the panel, because a second
  copy of that reasoning in the UI would drift from this one the first time either was tuned — and
  it decides nothing: nothing is posted until you press Post.

Your own government posts through the same code, and the `↗`/`↙` flags in Goods are the switch:
`exportsFrom`/`importsTo` are already true for every other nation, so one call covers both. Leave a
flag on and your surplus finds a buyer without you; turn it off and that commodity is yours to place
by hand.

### The clearing fund lends

`runLending`, in the same file. A government that cannot make payroll borrows against the fund
rather than closing its most expensive plant and then the next one. Interest accrues on the balance
every tick and repayment is a share of the TAX BASE — so it scales with the economy and a small
nation is never crushed by a balance a big one could carry. A balance is bounded by
`maxDebt` multiples of that tax base, and by what the fund actually holds.

Other governments ask automatically when they are about to miss payroll. You never do: your own
borrowing is a button in the Market tab, because taking on debt is a decision.

### Technology is a decision you took forty ticks ago

`src/data/technology.js` is the tree and `src/systems/research.js` runs it, for you and for the
every other government identically. `canBuild` asks `knowsTech(state, owner, def.tech)` — the same
function `runStateIndustry` goes through — so no government can build what it has not learned, and
nothing is special-cased for the player.

A nation's knowledge is `state.countries[id].techs`, a plain object of `techId -> true` so it
round-trips through the save like everything else. `knowsTech` treats a **null** tech id as yes,
which is how the basics (coal, iron, stone, timber, food) need no special case anywhere.

Three rules are load-bearing:

- **Research is funded as a share of the tax base**, not out of the treasury at large
  (`CONFIG.research.share`, and your own slider up to `maxShare`). The consequence is deliberate: a
  big economy climbs faster than a small one for exactly the reason it does in life, and a small
  one's realistic route to the top is to **licence** what somebody else already worked out.
- **AI research scores what a tech unlocks against world scarcity divided by cost.** Extraction
  techs only score where the country actually has matching ground; everything reads the shared
  `worldBalance.js` scarcity numbers so research and state industry want the same missing goods.
- **A licence carries the whole missing branch.** `techChain` walks the prerequisites the buyer
  lacks — you cannot licence a semiconductor fab to a nation that has never refined a barrel — so
  one purchase can be several techs and the quote says so. The fee lands in the seller's treasury,
  which is what makes being first up the tree worth money as well as industry.
- **The world licenses among itself too.** `licenseAmongTheWorld` has one government per decision
  tick buy from the nearest holder it trades with, on a roll that is a pure function of `seed` and
  `tick` — so a save replayed sees the same transfers. Without it the poor half of the map would
  climb from the bottom for ever and never arrive.

A tech that unlocks nothing is a test failure, and so is a building naming a tech that does not
exist. The tree is also asserted to be acyclic: a cycle would leave both ends permanently
unreachable and nothing else in the game would notice.

### Contracts are the half of trade you choose

`src/systems/contracts.js`. Nothing is bought or sold automatically on anybody's behalf: every
cargo that moves between two nations moves because somebody promised it would, at a price somebody
agreed to. What finds the two parties is the open book in `exchange.js`; a match lands straight
here. A contract is a promise made in advance, so a steel mill can be built on the strength of coal
that has not been dug yet.

- Settled **before** `domestic` — see the pipeline above. That is what gives one teeth.
- Priced **once**, at signing, and the price never moves. That is the whole product.
- Either side can fail, and failing costs (see *How money actually moves*).
- Everything left in the warehouses afterwards is what that nation's own people get to buy, which
  is the whole reason contracts are settled first: a promise outranks a shopkeeper. Turning a
  commodity's `↗`/`↙` flag off in Goods stops your government posting it on the exchange **and stops
  anybody putting a contract offer for it to you** — the flag is your whole policy on that
  commodity, not just an exchange setting — and leaves it entirely to contracts you write by hand.

`signContract` is the only way one comes into being — your button, an accepted offer, and the
governments' own dealing all land there — so none of them can write terms the others could not.
Contracts are settled against **depots indexed once per tick** (`depotsByOwner`), like `collect` and
`distribute`, because a tick that settles a hundred of them must not scan every building in the
world twice per contract.

**A contract warning says which side is currently at risk, not whether it ever missed once.**
`lastBuyerShort` and `lastSellerShort` retain the latest settlement's audit, while
`refreshSupplyHealth` recalculates a seller's `supplyShort` every tick from `spareRates` minus its
other promises. Thus building enough oil production clears the red seller warning immediately, but
the earlier missed quantity and penalties remain historical facts. A buyer can still be short because
it cannot pay past its payroll reserve or has no warehouse space; its own last-delivery warning must
not be mistaken for the exporter lacking stock.

**The Trade tab can draft an export without guesswork.** `suggestExportContract` starts from the
selected commodity, subtracts existing export promises from the player's sustainable surplus, then
chooses the solvent country with unmet demand and the highest live market price (need breaks a price
tie). It will not recommend a buyer that fails the ordinary underwriting check. The **Suggest best
buyer** button only fills the draft — partner, one-tick quantity and explanatory price/need/surplus
data — and the player still sends the contract request explicitly.

There is **no per-nation contract cap**. A country may hold as many contracts as it can arrange; the
guardrail is commodity cover, not a raw count. Automatic exchange and AI-seeking paths must subtract
already promised export rates before offering more of the same commodity, so removing a count limit
does not let one warehouse sell the same coal, limestone, or steel twice. Hand-written contracts may
still over-commit, because penalties are the point of making a promise.

`state.contractOffers` and `state.techOffers` are what other governments have put to you; both lapse
if you never answer, and both also appear in the floating inbox over the map.

**Nobody may ask you for what you have not got, and nobody may ask you at all for what you will not
sell.** `offerToPlayer` puts three gates on every commodity before it will let a nation come to you,
and they answer three different questions:

- **`exportsFrom` — your POLICY.** The `↗` flag off in Goods now means that commodity is not for
  sale *at all*: no exchange listing (as before) and no contract offer either. `importsTo` is the
  mirror on the way in. This widened what the flags mean — they used to govern only the exchange —
  and it is the sense a player actually expects: a switch labelled "sell" that still fills the inbox
  with people asking to buy is a switch that does nothing.
- **`spareRates` minus `promisedBy` — your RATE.** Nobody asks for more per tick than you have left
  once your own factories, your own people and your standing promises are served. A nation that
  pumps two oil and burns one has **one** to sell, and offers for three simply do not arrive. Worked
  out ONCE per round rather than per partner.
- **stock — your SHELF**, which is still checked, because a promise you cannot begin filling this
  week is not much of a promise either. The old code checked only this, which is why offers used to
  arrive that could only ever be defaulted on: a warehouse is a one-off and a contract is a rate.

**`spareRates` lives in `core/state.js`, not in either place that uses it.** The Goods tab's `Bal`
column and the offer filter must mean the same thing by "spare" — two definitions would drift the
first time either was touched, and the panel would then be promising rates the offers refuse.

**`bestSeller` skips `state.home`, and that is load-bearing.** The world signing contracts among
itself must not be able to conscript YOUR government into supplying something: a contract exists only
because two governments agreed terms, and yours agrees through `offerToPlayer` or the Trade tab.
Leaving the player in that candidate list is how a nation ended up promising oil it had switched
exporting off for, with no offer and no alert.

**World contract sellers compete on price and standing, not only distance.** A seller quotes its own
ask price, but if a standing ask already exists for that commodity it undercuts the best ask. The
buyer then scores sellers by quoted price, freight and its opinion of the seller, so reliable trade
partners naturally keep finding each other. `seekContract` walks the buyer's shortages in order and
falls through to the next one if the largest shortage has no viable seller.

### Diplomacy is a conversation, with exactly one exception

`src/systems/relations.js`. `state.diplomacy.relations` is still the symmetric country-pair table
with four values — `neutral`, `alliance`, `access`, `war` — and military movement still may enter
your own land, unclaimed space, allied land, access-granted land, or enemy land during war; open
trade is not open borders. What changed is **how a relation comes into being**.

- **Alliance, military access and peace are REQUESTS.** `proposeRelation` puts one on the table and
  the other government answers it; `answerProposal` is the same function whether a government or you
  is saying yes, so your yes cannot write a relation theirs could not. `PROPOSABLE` lists the three,
  and `war` is deliberately not on it — `canPropose` refuses it by name.
- **War is DECLARED, and then it WAITS.** `declareWar` is unilateral — nobody is asked permission to
  be invaded — but it does not start a war. It writes an **ultimatum**, and for
  `CONFIG.diplomacy.warDelay` (**50**) ticks the two are only on notice: any alliance or access
  between them is torn up on the spot, but no border opens, no shot is fired, and the declaring side
  may still `callOffWar`. `beginWars` is the ONLY place a relation becomes `war`, which is what
  makes the delay unconditional — there is no path from a declaration to a shot that avoids it.
- **The defender's allies are dragged in the same way as everybody else** (`dragInAllies`): their
  own declaration, their own fifty ticks. There is no back door round the delay, and that is what
  makes an alliance worth signing and worth thinking twice about.
- **Peace is agreed, and then it holds.** Accepting a `neutral` proposal out of a war stamps a peace
  clock (`CONFIG.diplomacy.peaceCooldown`), so a government cannot sign peace and declare again on
  the same tick.
- **`relationAppetite(state, from, to, relation)` is how the world answers**, and it is a pure
  function of `state` — so the Diplomacy tab can show you the answer you will get *before* you ask
  (hover any button). Three things decide it and they are the three that would decide it in life:
  distance (`haulShare`, the same measure freight is priced on), relative power (`powerOf` —
  economy plus army, used only as a ratio so the units cancel), how the two already stand, and what
  `from` thinks of `to` in the opinion table. A small deterministic `jitter` on `seed` and `tick`
  keeps it from being a lookup table while leaving a replayed save identical.
- **Opinion is asymmetric and sparse.** `state.diplomacy.opinion[a][b]` means what `a` thinks of
  `b`; missing is neutral zero. Contracts nudge both sides up when signed and again when completed,
  defaults lower the wronged party's opinion of the defaulter, and a declaration of war hits hard.
  The friends clause is in `declareWar`: if `A` attacks `B`, every `C` that likes `B` lowers its
  opinion of `A`. Opinion decays each diplomacy review and `packState` rounds it before saving.
- **The world may declare war without you.** `warAppetite` reads dislike, distance and relative
  power, then three brakes keep it rare: it must beat `CONFIG.diplomacy.warAppetite`, a review may
  write at most `warsPerReview` declarations, and `warQuiet` is a worldwide cooldown after any
  declaration. `declareWar` is still the only writer, so player wars, AI wars and allies joining all
  share the same ultimatum path.
- **The world proposes to its NEIGHBOURS, not to a random sample of the planet** (`bestPartnerFor`
  walks `nearestTo`, a cached 24-nation slice of `neighboursOf`). Sampling uniformly was the first
  version and it produced 182 basing agreements and not one alliance: a government was only ever
  asked about strangers, and `relationAppetite` quite correctly refuses to promise to fight a
  stranger's war. Neighbours are who you have something to settle with, and opinion is part of that
  score so friendly neighbours find each other more often.
- **The Diplomacy tab's opinion word and bar are live state.** They must stay in each row's
  `dataset.sig`; otherwise a contract, default or war can change opinion without repainting the
  list.
- **Your inbox is capped** at `CONFIG.diplomacy.maxProposals`, like a government's outbox. A stack
  of pacts is a stack nobody reads — the same reason a declined licence has a cooldown.
- **A proposal expires on the TICK clock**, not the wall clock the contract and licence offers use.
  A treaty is not a thing you answer in five seconds, and a paused game must not decide one for you.
  `CONFIG.diplomacy.proposalTtl` is **10** ticks, so an unanswered pact clears promptly while the
  pact card still says its remaining ticks in words rather than using a wall-clock bar.

The file is named `relations.js` rather than `diplomacy.js` on purpose: the old `systems/diplomacy.js`
was about permission to TRADE and is gone for good (see the footgun below). This one is about
relations only and moves no goods.

### Ownership MOVES now, and that broke two stated invariants

Conquest was called out in this file as the thing that would break the save, and it does. Both places
are fixed and both fixes are load-bearing:

- **`setTileOwner` in `core/state.js` is the ONLY place `tile.countryId` may change**, and it does
  three things at once: moves the tile, writes the change into **`state.claims`** (the diff), and
  bumps **`state.mapVersion`**.
- **Tiles are still dropped from the save.** They are regenerated from `seed`, which is only sound
  while generation is the whole truth — so `rehydrate` lays `state.claims` back over the fresh world.
  It is a few hundred numbers rather than a million tiles (measured: 2KB against a 1.1MB save). A
  test saves a conquest and loads it back, because without the diff a border would spring silently
  back to where the generator put it.
- **The two AI caches key on `mapVersion` as well as the tile array.** `tilesByCountry`
  (stateIndustry) and `depositsOf` (research) were both keyed on `state.tiles` identity *on the
  stated grounds that ownership never moves*. They now rebuild when a border does. The version only
  moves on a real change, so a world at peace still builds each of them exactly once.
- **A building goes WITH the ground.** `building.owner` is also the country the site stands in —
  that is why nothing carries a separate `country` field — so a tile that changes hands takes
  whatever is built on it. Ground that becomes unowned loses the site entirely, because unclaimed
  ground has no government to own a factory.
- Known cosmetic limitation: `provinceForTile` reads the tile's CURRENT owner, so a conquered tile
  is named from its conqueror's province list. The centroids in `geography.js` are also computed once
  from the original grid, so freight and map labels use pre-war centres. Neither breaks anything.

### Taking ground, and being taken off the map

- **GROUND IS TAKEN AS IT IS CROSSED.** `advanceUnits` calls `takeGround` after *every step*, so a
  land formation that walks six tiles into an enemy takes all six. It did not always: conquest ran
  only on the `CONFIG.war.conquerEvery` cadence against the tile a unit happened to be standing on,
  so a column that marched 74 tiles across Turkey took **7** of them — 74 ticks over a 10-tick
  cadence, exactly. `conquerEvery` still exists, but only for a formation that is NOT marching (one
  already standing on foreign soil when the war broke out, or one that has arrived and stopped);
  `conquerGround` skips anything with a standing order.
- **`takeGround` is the single rule** both paths go through, which is what keeps the one thing that
  must never vary in one place: an aircraft takes nothing, ever.
- **Aircraft take nothing.** `conquerGround` checks `domain`, not range — an aircraft parked on a
  tile is not an occupation. That single asymmetry is why a nation still needs infantry.
- **A nation with no land left is finished** (`eliminate`): `alive` becomes false, `canTrade` and
  `canPropose` refuse it, every AI decision loop skips it, and its army, contracts, listings and
  pending diplomacy are all cleared. Conquest by an army is permanent.
- **AND THE VICTOR INHERITS EVERYTHING.** `eliminate` takes the conqueror as its second argument and
  moves the treasury, the population and the economy (`demand`) across, plus any site still on the
  defeated nation's books. Its INDUSTRY has usually moved already — tile by tile, with the ground —
  so what passes here is what was never on the map. **A terrorist cell inherits nothing**: it is not
  a government and cannot annex anything, so `seizeForCell` calls `eliminate` with no victor and a
  test asserts no treasury on earth grows when a cell finishes a country.
- **A terrorist cell takes ground too**, both what it walks over and the ground under anything it
  wrecks. Held ground becomes **nobody's** (`countryId: null`) and `state.occupied` remembers whose
  it was — a cell is not a government and cannot own anything.
- **Liberating is not annexing.** `defeatTerrorists` hands every held tile back to the country it was
  taken FROM, never to whoever cleared the cell. A nation eliminated while a cell held its last
  ground comes back (`revive`), which is the honest difference between *occupied* and *conquered*.

### A war actually does something

Two halves, both in `runMilitary`, both reading `relationOf` and nothing else — no system reads a
country name:

- **`resolveWarCombat`** — every formation within its own `range` of an enemy formation takes
  `CONFIG.war.damage` of the attacker's strength off it. **There is no attack order and there never
  was one**: a garrison standing still fights anything that walks into its reach, and both sides
  fire whether either was going anywhere. Proximity plus `war` is the entire trigger. Both sides fire in one pass off the SAME
  snapshot, so position in `state.military.units` cannot decide a battle: the same determinism
  argument that puts `collect` before `produce`. Units are bucketed by tile block (the longest
  `range` in the data, read from `UNIT_TYPES` rather than written down) so this is not every unit
  against every other.
- **`raidEnemySites`** — a formation on or beside an enemy site wrecks it every
  `CONFIG.war.raidEvery` ticks, the same cadence and the same "adjacent counts as arrived" rule a
  terrorist cell uses. A war costs the loser its INDUSTRY, and that is the only reason a government
  would ever sue for peace.

Two rules make a war finish, and both were added because leaving them out produced a war that could
not be won:

- **A formation in contact does not make its losses good.** `resolveWarCombat` stamps
  `unit.engaged`, and `reorganise` skips those next tick. Without it a unit recovers `RECOVERY` a
  tick, damage falls away with the strength doing it, and two even armies settle into a permanent
  stalemate at half strength.
- **`CONFIG.war.breakAt`** — a formation below this share of full strength is destroyed outright.
  Damage is a share of the ATTACKER's strength, so two units shooting at each other decay
  geometrically and never reach zero; the break point turns that asymptote into an outcome. Clearing
  `engaged` on the last unit standing matters for the same reason — left flagged, a survivor could
  never recover from a war it had won.

### An army is CAPITAL, bought in goods

`UNIT_TYPES` in `systems/military.js` is the unit data, exactly as `buildings.js` is the industry
data — five formations, each with a `cost` (the batch that raises one), a `speed` (tiles a tick) and
a `range` (how far it reaches to fight). A quantity belongs there and never in the code that spends
it, and no system reads a unit type by name. **There is no military industry at all** — no arms
factory, no munitions plant, no armor plant; a formation is raised straight out of base commodities,
and `BUILDINGS` has nothing in the `military` category any more.

**A FORMATION IS PAID FOR IN GOODS FIRST AND MONEY SECOND.** `cost` is a batch of commodities, and
drawing it out of your own warehouses is much the cheapest way to raise one. Whatever the depots
cannot cover, the government **buys in** out of the treasury at `CONFIG.army.cashMarkup` (**2.5×**)
the price — so a nation with a full treasury and a bare warehouse can still field an army, and pays
through the nose for it. `unitShortfall` is the one place that arithmetic lives; `unitAffordable`
means "stock or treasury", and `unitInStock` is the narrower question the build dock uses to tell
"you have this" from "you would have to buy it in" (three states on the box, not two).

- **It is procurement, NOT trade.** No contract is written, no border is crossed, and no other
  country's stock moves — goods cross a border only under a contract and this is not one. Nothing in
  `unitShortfall`/`createMilitaryUnit` touches `state.contracts`, `recordFlow` or another nation's
  depots, and a test asserts a cash purchase leaves both the contract list and the offer list empty.
- **The price is the DEARER of the local market and the base price**, times the markup — the same
  rule `marginPerTick` costs a plan's inputs by. A depressed home market is never a bargain and a
  real shortage makes procurement dearer still.
- **A depot is no longer required.** The old rule ("a nation with money and no depot cannot field
  anything") is gone, because money buying the whole batch is precisely the case this exists for.
  `musterTile` falls back to any free square of the nation's own land when it owns no storage.
- **The world prefers goods too.** `affordableType` exhausts the stock route first (strongest it can
  cover) and only then buys, and when it buys it takes the CHEAPEST formation rather than the best —
  a government paying cash raises riflemen, not aircraft. `stateReserveTicks` guards the treasury
  the same way it guards `considerBuild`.
- **Measured effect** over 3,000 ticks: formations 294 → **321**, largest armies 14/7/4/3 → **14/14/10/6**,
  nations able to beat a terrorist cell 2 → **4**, and the world defeated a cell on its own for the
  first time. Solvency and median treasury both went UP, so the reserve guard is holding.

**A FORMATION COSTS NOTHING TO KEEP, and that is a deliberate design decision, not an omission.**
It was a per-tick supply bill once and that is gone: `cost` is the ONLY thing a unit ever draws, on
the tick it is raised, and after that it consumes nothing at all — no rations, no fuel, no running
bill of any kind. Do not reintroduce one. `UNIT_TYPES` therefore has no `upkeep` key, and a test
asserts it stays that way, because a running bill would not merely be unused data — it would
contradict the rule.

The consequences are worth stating, because each one used to go the other way:

- **The affordability decision is taken once**, at the moment of raising, rather than every tick for
  the rest of the game. `unitAffordable`/`canDeployUnit` are the whole of it.
- **Nothing can starve an army.** A unit is lost to an ENEMY and to nothing else. There is no
  `supplied` flag any more — `unit.engaged` (was it in contact last tick) is what the map's red rim
  and the inspector's status line read now.
- **What is left of the old supply pass is `reorganise`**: a formation out of contact makes its
  losses good at `RECOVERY` a tick. It reads no warehouse, so it is not a cost.
- **The world's armies stopped dying.** Measured over 900 ticks: 15 formations across 15 nations
  before, 280 across all 258 after. `security` runs last in the tick, so under the old rule a unit
  only ate what its nation's contracts, factories and people had already left behind — and most of
  the planet has no such surplus, so the world's starter infantry quietly starved to death and no
  government could ever afford to replace them.
- The distinction between the five still lives in `cost` (an armoured car takes less fuel to build
  than a tank, a tank less than an aircraft, artillery none at all), so the tests that guarded that
  ordering simply moved from `upkeep` to `cost`.

- **A unit is not a building.** There is no barracks and no build queue: you pick a formation out of
  the same bottom dock the industries are in and click your own ground. Nothing is charged to the
  treasury — the batch comes out of your WAREHOUSES — so a nation with money and no depot cannot
  field anything. `ui.unit` is the formation in hand and `ui.tool` the building; picking one up puts
  the other down, because the pointer only ever carries one thing.
- **Deployment is asked in two halves, and that split is a performance decision.**
  `deployableTile` is cheap (terrain, ownership, occupancy) because the map asks it of every visible
  tile on every draw while a formation is in hand; `unitAffordable` costs a depot scan and is asked
  ONCE per render. `canDeployUnit` is the authoritative answer and is only asked when a tile is
  actually clicked.
- **A standing formation can be MOVED**, and that is a third thing entirely — not a building, not a
  formation waiting to be raised. Clicking a unit (with no tool or unit-to-raise in hand) selects its
  tile and opens Selected, which shows a Move button; pressing it sets `ui.moveUnit` to that unit's id,
  and the next tile click is the order (`actions.js`'s `orderMove`, gated by the same
  `canMilitaryEnter` access rule as everything else military). `ui.moveUnit` is a third pointer mode,
  mutually exclusive with `ui.tool`, `ui.unit` and `ui.groupUnit` — picking up any of those, or
  pressing Escape, cancels a pending move order. The map highlights valid destinations the same blue
  as a deployable tile while an order is pending.
- **A MOVE ORDER IS A MARCH, NOT A TELEPORT.** `moveMilitaryUnit` writes `unit.orderTileId` and
  returns; `advanceUnits`, inside `runMilitary`, walks the unit up to `speed` tiles toward it every
  tick until it arrives. The speeds are the whole point of having five formations on a map rather
  than five lines on a balance sheet — infantry and artillery **1**, tank **2**, armoured car **3**,
  aircraft **20** — so the light thing outruns the heavy thing it is lighter than, and an aircraft
  crosses a continent while a rifleman crosses a field. Three rules in it are load-bearing:
  - **The step is greedy, not a search**, and `stepToward` is three tie-breaks deep because on this
    grid the obvious rule is never enough. There is still no A\* — pathfinding a million tiles per
    formation is not affordable — so a deep concave bay will still defeat it. Each rule below was
    added because the version without it produced something visibly wrong:
    1. **Nearest to the goal, over all EIGHT neighbours.** The first version tried three fixed
       offsets in a fixed order and gave up two tiles short of a destination because all three
       happened to be blocked while a step to the side would have gone round in one move.
    2. **It may walk BACKWARDS.** A formation on a coastal spit with the enemy to the east and land
       only to the west has to be able to go west. "Never move away from the goal" seemed the tidy
       way to stop ping-ponging and instead pinned **Turkey's entire army on the Black Sea coast for
       a whole war** — ordered at Iran every fifteen ticks, giving up on the first tick of every
       order. `unit.trail` (the last dozen tiles it stood on, kept out of the running) is what stops
       backtracking becoming a shuffle. Measured after the fix, the same army marches east and stands
       80 tiles inside Iran.
    3. **Ties are settled on the SIGHT-LINE from where the march began.** Distance here is
       CHEBYSHEV — a diagonal costs the same as a straight step — so heading 83 east and 27 south,
       the moves east, north-east and south-east all reduce it by exactly one and tie. Settling that
       by the order of the neighbour list put north-east first and walked a column up to the
       northern coast and along it; settling it by "close both axes first" walked the diagonal out
       and then turned a hard corner. Measuring each candidate's deviation from the start→goal line
       (`unit.fromX/fromY`) spreads the diagonal steps evenly, which is the line a person would draw.
       Measured: 83 steps for a distance of 83, deviation under 1.5 tiles across open ground.
  - **...which is why a march also gives up when it stops making PROGRESS.** `advanceUnits` tracks
    the closest a unit has ever come, and abandons the order after `CONFIG.war.giveUpAfter` ticks
    without improving on it. Sidestepping is exactly what lets a unit circle an unreachable target
    for ever, and the ordinary case is real: the far side of Turkey is an **island**, and a rifleman
    ordered there marched the length of the country and then shuffled on the beach opposite it.
    The place is remembered on `unit.unreachable` so the government does not send the same formation
    at the same island on its very next decision.
  - A unit that cannot take even one step gives up at once, and either way says so if it is yours.
  - **Marching happens BEFORE the fighting** inside `runMilitary`, and after supply. A column that
    closed the last tiles this tick engages this tick.
  - **Formations STACK.** Only `canDeployUnit` refuses occupied ground — you may not *raise* a unit
    on top of another, but you may march onto one, and a group converging on a destination does
    exactly that. `unitOnTile` still returns one unit; the map indexes a tile to a LIST.
- **A war can be fought automatically, and the only condition is that an ENEMY EXISTS.** A land
  formation's **Auto conquer** button appears whenever its government is at war with somebody who
  still holds ground (`enemiesOf`, the whole gate, asked by `canAutoConquer`). `startAutoConquest`
  fixes the nearest such country as its objective, then `advanceAutoConquests` picks that country's
  nearest reachable land and walks **one tile per tick** — even for faster formations — taking every
  crossed tile through the usual `takeGround` rule.
  - **There is no separate "attack" half, and there must not be one.** `resolveWarCombat` triggers on
    proximity plus a relation of `war` and has never taken an attack order, so a formation that
    marches into a defended country is fought by whatever it walks into. "March at the enemy and take
    its ground" IS "attack the enemy" — adding a combat path here would be a second copy of a rule
    that already exists.
  - It used to also require that enemy to have **no formations left**, which made it a tidying-up
    order for a war already won and nothing else. The fighting is the half a player most wants
    automated.
  - **Annexing one enemy does not end the campaign**: `advanceAutoConquests` retargets through
    `pickCampaignTarget` to the next enemy still holding land, because the last tile of one country
    silently standing the whole army down while the war ran on was the obvious wrong answer.
  - **Pressing the button again calls it off** — `cancelAutoConquest`, a separate entry point rather
    than a toggle inside the start, because "stop" has to work on a formation whose campaign the
    system has already ended for it and a toggle would restart that one instead. `stopAutoConquest`
    is the single place a campaign ends either way; its `announce` flag is what lets the deliberate
    stop say something different from the one that ran out of ground.
  - **`orderAutoConquestAll` is the same order for many at once** — a selection, or your whole army
    when nothing is selected (`unitIds == null`). It goes through `startAutoConquest` per formation,
    so a bulk order cannot write anything a single one could not: an aircraft is refused for the same
    reason, and so is a campaign in peacetime. What it adds is ONE alert for the lot.
  - Aircraft never receive the button (an aircraft occupies nothing), and issuing a normal Move
    replaces a campaign.
  - **`nearestAutoConquestTile` and `nearestEnemyLandDistance` go through `landOf`, not `state.tiles`.**
    They walked a million tiles per formation per tick, which was affordable only while this was a
    rare order. It is an ordinary one now and a whole army may be on it, so both read the country
    index `stateIndustry` and `stateMilitary` already pay for.
- **Formations can be GROUPED, and a group is a `groupId` and nothing else** — no object, no list, no
  `Map` — so it round-trips through the save like everything else on `state`. What it buys is one
  thing: an order given to any member is given to all of them (`moveMilitaryUnit` walks
  `groupOf`), and the column moves at its **slowest** member's pace (`groupSpeed`), because
  otherwise the cars arrive alone and the guns turn up long after. `state.military.nextGroupId` hands
  out the ids and a group of one dissolves itself (`dissolveIfAlone`), so a stale `groupId` can never
  lie to the panel.
  - **Who may group is decided by DOMAIN, which makes "land groups with land, aircraft only with
    aircraft" ONE rule rather than two** — aircraft are the only `air` formation there is, so
    `canGroup` comparing domains says both at once. A group is also one government's.
  - The gesture is a **fourth pointer mode**, shaped exactly like Move: the Group button in Selected
    sets `ui.groupUnit`, and each following click on one of your own formations adds it, so a column
    is assembled in a run of clicks. Clicking anything else ends it. The map rings the formations
    that could legally join in green, which is how "aircraft only with aircraft" is something you
    see rather than a refusal you discover by clicking.
- **AN ARMY IS SELECTED THE WAY FILES ARE, and a selection is a thing you HAVE rather than a thing
  the pointer is carrying.** `ui.selection` is a plain array of unit ids — the only piece of pointer
  state that is NOT exclusive with the other four, because picking six formations out and then
  picking up a building are not contradictory statements. `ui.orderSelection` is the mode that
  SPENDS one: while it is set, the next tile click is a march order for every id in the list
  (`orderMoveMany`), and it is checked before `ui.moveUnit` because a selection is the bigger order.
  - **The gesture is a rubber band, because the map has no empty space to drag on.** Panning is
    dragging — the scrollbars are gone — so a plain drag cannot be the marquee. **Shift-drag** starts
    a fresh selection box, **Ctrl/⌘-drag** adds to the one you have, and a modified drag under the
    four-pixel threshold is treated as an additive CLICK, which is how one formation is added or
    removed. A plain click replaces the selection with whatever it landed on, exactly as it does in a
    file list; Escape clears it.
  - **The band itself lives on `view`, not on `ui`.** It exists only between a pointer going down and
    coming up again, so nothing outside `map.js` has any use for it — and `boxTiles` converts it from
    content pixels to tiles ONCE, so the drawing and the selection can never disagree about which
    tiles the box covered. `unitsInBox` in `actions.js` is what turns that rectangle into ids, so the
    map drags a box without knowing what a formation is.
  - **Every button on the army card acts on the SELECTION when there is one and on the whole army
    when there is not**, and says which in its label. That is what makes "order these six" and "order
    all thirty" one control rather than two sets of them — and it is how the campaign is enabled or
    disabled for a whole army in one press.
- **The five are told apart by what they consume**, and that ordering is covered by a test:
  infantry eat food and nothing else; an armoured car burns less fuel than a tank, and a tank less
  than an aircraft; artillery burn no fuel at all and eat less than infantry.
- **...and by how far they REACH.** `range` is 1 for everything except artillery, which is 3, and
  that single asymmetry is the whole reason to drag a gun anywhere: a battery fights what it cannot
  touch. `resolveTerrorCombat` sums the strength of every unit within its own `range` (Chebyshev) of
  the cell rather than only those standing on its tile. **Reaching across a border is governed by the
  same access rule as walking over one** — you cannot shell a camp in a neutral country from your own
  side of the line — which is why that function still asks `canMilitaryEnter` against the camp's tile.
- **A formation loses strength to enemies and to nothing else**, and makes it good at `RECOVERY` a
  tick whenever it is out of contact. Everything military still happens in the `security` phase at
  the END of the tick, so a formation is raised out of whatever a nation's contracts, its factories
  and its people have already left behind — the cost is drawn once, there, and never again.

### The world raises armies too

`src/systems/stateMilitary.js`, and it is the same shape of file as `stateIndustry.js` for the same
reason: it decides only how many formations a government wants and where it sends them, and goes
through `createMilitaryUnit`/`moveMilitaryUnit` exactly as your own buttons do. Nothing is
special-cased.

- **An army is sized by the ECONOMY, not the treasury** (`armyTarget`: `CONFIG.army.perDemand`
  against `demand`, floored and capped, multiplied when the nation is at war or has a cell on its
  soil).
- **A government MOBILISES before the shooting starts.** `mobilising` counts an ultimatum with
  `CONFIG.diplomacy.mobiliseAt` (**20**) ticks or fewer left to run as a war for sizing purposes, so
  both sides of a declaration raise their armies during the countdown rather than on the day. The
  whole point of a declared war waiting is that it can be seen coming; a government that only began
  arming once it was fired on wasted every tick of the warning. Formations cost supplies, so a rich nation with an empty depot fields nothing — a test
  asserts that, for them exactly as for you.
- **The type is the DEAREST it can afford out of stock**, walked from the strongest down, so an
  economy shows up in an order of battle without a line of code reading a country's name.
- **`CONFIG.army.costHeadroom` is the only brake there is.** A unit costs nothing to keep, so
  without wanting some multiple of the batch in stock before spending one, a government would
  convert every scrap of surplus into infantry on the tick it appeared and have nothing left to
  trade.
- **WHAT ACTUALLY LIMITS THE WORLD'S ARMIES IS THE ECONOMY, and it is worth knowing before tuning
  anything here.** Measured at tick 700, every large nation held **zero** food in its depots at
  *every* phase of the tick — the United States runs about −75 food a tick against an appetite of
  115 — so nothing accumulates and a formation, which is bought out of goods, cannot be raised.
  That is why the world fields ~290 formations across 258 nations, nearly all of them single, while
  a genuine surplus economy like China fields ten and can clear a terrorist cell on its own.
  **Moving the `army` phase earlier in the tick does not fix this** — it was tried and measured and
  changed nothing, because the depots are empty at every phase, not merely at the last one. See the
  note in `systems/index.js`. If the world's armies are to grow, the lever is food and feedstock
  production, not phase order and not `army` tuning.
- **It moves with a reason** (`orderArmy`): a cell on its own soil first — that is a threat it can
  do something about, and defeating one pays — then the nearest site of somebody it is actually at
  war with. A formation already under orders is left alone; re-deciding every fifteen ticks is how
  an army ends up oscillating between two targets and arriving at neither.
- **Current target ladder:** after a home terrorist cell, `orderArmy` now aims at enemy formations,
  then enemy sites, then enemy land. The land fallback reads `landOf` from `worldIndex.js`, so wars
  still progress after the buildings and armies are gone.
- **AN ARMY FANS OUT.** One objective per formation while there are objectives to go round (a
  `taken` set passed into `nearestEnemySite`), and each is then nudged to its own corner of that
  objective by `spreadOut` — an offset that is a pure function of the unit's id, so it is stable
  across ticks and identical on a replayed save. Every idle unit used to be sent at the single
  nearest enemy site, so an army marched down one road in single file and arrived as a stack on one
  tile. That wastes it twice over: a stack takes one tile, because `takeGround` only takes the tile a
  unit is actually standing on. Measured: four formations on four distinct tiles instead of three
  piled on one. The claims are released once there are more formations than sites, since by then
  converging is the right answer.

Terrorism is deliberately a single pressure point, not world chaos, and every number in it is in
`CONFIG.terrorism`. `state.terrorism.active` starts null and `runMilitary` spawns one presence only
if none exists, no earlier than `firstAt` (600 ticks into a fresh game); destroying it clears it and
schedules the next after `cooldown` (also 600). Do not spawn parallel terrorist areas while one is
already active.

**A CELL IS ANNOUNCED BEFORE IT ARRIVES.** `CONFIG.terrorism.warnBefore` (**100**) ticks ahead of the
spawn, `warnTerrorists` chooses the ground and writes `state.terrorism.warning` — country, tile, and
the tick it will appear on — and the red card over the map counts it down. That is what the mechanic
was always for: a cell you cannot see coming is an ambush, and one you can is a problem you get to
march an army toward first. Three rules hold it together:

- **The choice is seeded on `nextSpawnTick`, not on the current tick.** It has to give the same
  answer on every tick of the countdown, or the camp would wander around the map while the clock ran
  and the warning would be worth nothing.
- **`spawnTerrorists` spawns where the warning said and nowhere else**, and if it somehow finds no
  warning it writes one and waits — so there is no path to a cell nobody was told about.
- **A defeat clears the warning too** (the next cell has not been chosen yet), and so does the spawn
  itself.

The map marks the announced ground with a dashed amber ring (`drawOmen`) rather than the camp's solid
red, because "a cell will be here" and "a cell is here" must not look the same. The card is the same
card in the same place for the same reason the inbox is one stack: they are two states of one thing.

- **A cell is INFANTRY and a few armoured cars, and nothing else — and it is FIXED at spawn.**
  `terroristForce` derives the cars from the rifleman count (`carsPer`) rather than storing them, so
  "fewer cars than men" can never disagree with itself, and there is no third entry: a cell has no
  industry, so it cannot field a tank, an aircraft or a gun. Unlike your own army it never grows
  stronger the longer it stands — a cell that gained power the longer you ignored it would be a
  losing condition, not a problem you go and deal with.
- **It does not sit still.** `runTerrorists` walks it toward the nearest site of its host nation,
  `moveTiles` at a time, once every `moveEvery` ticks — both deliberately small, which is the whole
  reason it reads as slow rather than as an ambush. Reaching (or coming adjacent to) its target
  destroys that one site and picks the next nearest; it never leaves the country it appeared in,
  because every target comes from that one nation's buildings. **It builds nothing, buys nothing, and
  sells nothing** — the only thing it does is walk and wreck.
- **FIGHTING A CELL IS A FIGHT, NOT A THRESHOLD.** `resolveTerrorCombat` runs every tick before the
  cell can spawn a replacement or take a step, and everything in reach of the camp wears it down at
  `CONFIG.war.damage` while the cell wears them down in return — off the same snapshot, exactly as
  two armies do in `resolveWarCombat`. **One combat rule in this game, not two.** When the cell has
  no riflemen left, whoever had the most strength in reach is paid `CONFIG.terrorism.bounty` straight
  into its treasury. Reaching a cell on FOREIGN soil still needs the ordinary access/alliance/war
  relation; reaching one on your own soil needs nothing but marching your own units there.

  It was **all-or-nothing** until measured: a government whose strength in reach matched the cell
  cleared it instantly, and anything less did nothing whatever. A cell is 46 strength and almost no
  nation fields that in one place, so what actually happened over 3,000 ticks was a lone formation
  marching onto the camp and **standing there for 2,400 ticks** — taking no losses, inflicting none —
  while the cell walked off and wrecked every site its host owned. Attrition fixes both halves: a
  partial force grinds a cell down instead of being ignored, and one that is badly outmatched dies,
  which is feedback rather than a stalemate. Measured after the change, China (10 formations) clears
  a cell and its industry keeps growing through the fight.

  **Damage lands on the cell's RIFLEMEN**, not on an abstract pool, because `terroristForce` derives
  its armoured cars from the rifleman count — the damage has to reach the thing everything else is
  derived from, or the two would disagree. `terroristForce` therefore floors the count, and a cell
  that floors to nobody is finished. A weakened cell is visibly smaller on the red card.

- **A government with a cell on its soil wants enough formations to BEAT it** — `armyTarget` works
  the count out from the data (`terroristStrength` against the weakest formation anyone could raise,
  times `CONFIG.army.terrorMargin`). It was a multiplier once and did nothing: a small nation's
  target is 1 and one-and-a-half rounds back to 1, which is how Andorra came to send its single
  rifleman at a cell four times its strength and lose every factory it had.
- The red card over the map (`src/ui/terror.js`) is driven from `terrorism.active` and does NOT
  expire — it is a standing situation, not news. Clicking it centres the map on the camp. The one-off
  spawn alert beside it expires like every other message.

Every new game seeds each country with a SMALL starter base near its capital/atlas centre: one
warehouse with modest stock, one farm on farmland, one Food Plant, and one small infantry unit on
bare ground beside the depot. These are opening conditions, not AI construction decisions: they are
added without treasury charges or alerts. **The opening military asset is a FORMATION, not a
factory** — there is no military industry left to build at all, so an opening arms works was never an
option to begin with. Do not turn this into huge free industry; test fixtures may clear the starter
assets when they need an empty scratch economy.

**Nothing in `seedDefaultAssets` may stamp terrain.** Tiles are dropped from the save and regenerated
from the seed, so an opening position that edits the map makes every save rehydrate into a different
world, silently. The farm needs farmland, so `generateWorld` guarantees it (`ensureFarmland`, inside
the same deterministic pass) and the starter merely finds it.

### The map is the page; panels dock over it

`.layout` is ONE layer. The map is absolutely positioned to fill it, and panels dock over it rather
than taking columns out of it: the information tabs hang from the top of the map like an app bar, and
the build controls sit along the bottom like a strategy-game command panel. Keep them compact: the
top dock is capped around 286px/38vh and the bottom dock around 156px/25vh. The fixed `.topbar` above
the layout does not move. Neither the page nor the body scrolls: `body` is a flex column of a fixed
topbar and the layout, and the only things that scroll are the map and panel interiors.

Consequences worth knowing:

- **The bottom build panel is always visible and spans the bottom edge.** Do not add a hide state,
  rail, or close button back to it: `ui.leftOpen` starts true and the CSS keeps the dock rendered even
  if old code sets it false. Its header carries the home-nation name and a small map-target button
  that recentres the map on the nation's centroid, because at high zoom it is easy to lose your own
  country. The build menu is filtered by `ui.buildView` through `buildCategory()`: Basic, Extract,
  Power, Tier 1, Tier 2+, Logistics, and Military. There is no military INDUSTRY, so the Military
  view holds only the five FORMATIONS: they carry `data-unit` instead of `data-type`, are picked up
  with `onSelectUnit` rather than `onSelectTool`, and are gated by warehouse supplies rather than by
  technology or treasury.

- **An author `display` beats the user agent's `[hidden]`, whatever the specificity.** The category
  filter sets the `hidden` attribute on every box outside the current view — and `.build` sets
  `display: grid`, so for a long time `hidden` did nothing at all, every industry in the game was on
  screen at once, and the tabs in the bottom dock read as broken with no error anywhere. `.build[hidden]`
  and `.terror-popup[hidden]` exist for that reason. **Any element that is both hidden by attribute
  and given a `display` by class needs its own `[hidden] { display: none }` rule.**

- **The top information panel is opened and closed by CLICKING, and by nothing else.** It starts
  folded to its tab strip; a tab click opens it on that tab, and it then STAYS open. It closes on the
  active tab, the collapse control, or **a click on the map** (`onTileClick`/`onTileRightClick` set
  `ui.panelOpen = false` before every branch, so it holds whether the click was a build, a
  deployment, an order or a plain selection).
  It used to unfold on HOVER and fold again the instant the pointer left it, and there are no
  pointer listeners left in `tabs.js` because that could not be lived with: reading a table and
  reaching for the map dismissed the table. Do not add `pointerenter`/`pointerleave` back.
  Clicking bare ground still primes `ui.tab = 'selected'` — primed rather than shown, since the same
  click just closed the panel: one click to get the world back, one on the strip to read about what
  you clicked.
- **Messages sit above every panel.** Alerts, inbox cards and the red terrorist card use the high
  overlay layer (`z-index: 100`) so a popup is visible even when the top or bottom dock is open. All
  three are repainted on every render, outside the pane dispatch, because they are always visible.
- **A pane should still be READABLE in one look, but it may now scroll.** `.panes` was
  `overflow-y: hidden` on the principle that a table is read whole — which was true of the pane it
  was written for and false of every pane that grew since: the bottom of the Trade list, the Ranks
  table and the tech tree were simply unreachable on a short window. The aim is unchanged, so the
  bottom dock shows only the build menu, as a two-row horizontal carousel of build boxes. **Those two
  rows are a GRID** (`grid-auto-flow: column`, two fixed rows), not a wrapping flex column: wrapping
  fills whatever rows the container's height happens to allow, which is one row on a short window and
  three on a tall one, and the row count is a layout decision rather than a leftover. Two rows in a
  156px dock leave a box 47px tall, which is why the recipe line is one line and the dock's own
  "Build" heading is hidden — the rail that opens the panel already says it. Table rows are still single-line
  (`.market td` is `nowrap`, the name truncates, and figures use `priceShort`/`qtyShort` so a
  four-digit price cannot wrap a row into two), and the standing explanations are still `<details>`.
  **Sideways is a different matter** — a pane that overflows horizontally is a bug, not a scroll,
  which is why the nine-column Ranks table lives in its own `.scroller` and why a summary card's
  `.facts` is one column rather than two.
- **Scrollbars are INVISIBLE** — `scrollbar-width: none` once in `base.css`, for every scroller
  including the map. They cost more width than the figures beside them. Everything still scrolls by
  wheel, drag, trackpad and keyboard, so a box that can overflow must say `overflow: auto`;
  `hidden` now means "this genuinely cannot be reached", which is almost never what you want.
- **There is exactly one mobile breakpoint: 820px.** Below it the top panel becomes a full-width
  sheet, the tab strip is one sideways-scrolling row with sticky close/tall buttons, and the build
  dock deliberately overrides the desktop "two rows, always" grid into **one row** of touch-sized
  boxes. The dock height is the `--dock` custom property; tune that variable rather than chasing
  individual panel heights.
- **The mobile overflow menu is `data-open`, not `hidden`.** `.controls__more` is a real sheet under
  the `...` button on phones and ordinary controls on desktop, so the closed mobile state is
  `.controls__more[data-open="false"] { display: none; }`. The renderer toggles `data-open`; do not
  reintroduce `hidden` or desktop controls disappear in the wrong mode.
- **`.overlays` uses `display: contents` on mobile.** The alerts, inbox and terrorism card stack
  over the map as their own fixed layers instead of adding another box to the page. That is why the
  verified phone shell has no page scroll in either axis.
- **Pinch zoom is real map zoom.** `src/ui/map.js` tracks two active pointers in `attachPan`, calls
  `zoomTo`, and snaps through `levelNearest`, the same zoom levels the wheel and buttons use.

### The top panel has ten tabbed views

`index.html` declares a `<section class="pane" data-pane="…">` per view; `src/ui/tabs.js` owns the
strip and the `TABS` list that names them. `ui.tab` says which is on screen, `ui.panelOpen` whether
the panel is unfolded at all, `ui.leftOpen` whether the build panel is, `ui.openFactoryId` which site
has its numbers unfolded, `ui.goodsView` whether the commodity book reads the tick or the game,
`ui.rankSort` which column the nation table is ranked by, `ui.bookFilter` whether the exchange shows
everybody's terms or only yours, `ui.moveUnit`/`ui.groupUnit` which formation is waiting for a
destination or for companions, `ui.selection`/`ui.orderSelection` which formations you have picked
out and whether their march order is armed, and `ui.draft` the contract you are writing but have not signed —
`ui.panelTall` how much room the panel gets when it is open, and `ui.eventFilter` whose world news
the News tab is showing — all on `ui`, so none of it reaches the save file. Ten tabs do not fit one
row of the panel, so **the strip wraps**: a tab you cannot read is not a tab you will click.

Four things about the strip itself, and each is there because the panel is one you move around in
constantly:

- **Every tab prints the number that opens it.** `1`–`9` already worked and nobody could have known;
  a shortcut you cannot see is a shortcut nobody uses. `←`/`→` walk the strip and wrap.
- **The active tab wears a bright edge along its top** (`.tab[data-active]::before`). Nine tabs in
  two wrapped rows all shaded the same colour made "which one am I on" a question you answered by
  reading rather than by looking.
- **`⤢` (or `T`) makes the panel TALL** — `ui.panelTall`, capped at a share of the viewport rather
  than a fixed height, because the panel docks over the map and must never replace it. The summary
  card is read in one look; the Ranks table and the tech tree are not, and scrolling a pane sized
  for a card is the wrong answer to both. It is a second control beside the collapse button because
  it answers a different question: how tall, versus whether at all.
- **A war, or a declaration counting down toward one, marks the Diplomacy tab urgent**
  (`data-urgent`, a pulsing badge — and it respects `prefers-reduced-motion`). It is the one thing
  on the strip worth interrupting whatever you are reading.

**The keyboard is a whole control surface, and `main.js`'s keydown handler is all of it**:
`Space` runs/pauses, `Esc` drops whatever the pointer is carrying — and clears the marquee selection
and any march order armed on it, since "I am carrying nothing" and "I have picked nothing out" are
the same statement — `B` folds the build dock,
`T` makes the top panel tall, `+`/`-` zoom, `1`–`9` and `←`/`→` pick a view, **`H` finds your own
country again** (`onCenterHome`, the same call the ⌖ button makes) and **`M` moves the selected
formation** (`onMoveSelected` → `onMoveUnit`, the same call the Move button makes). Two rules hold
for all of them:

- **A key goes through the same ctx method its button does**, never round the side. `M` toggles like
  the button and explains itself when nothing of yours is selected, rather than failing silently.
- **Every shortcut is written down where the thing it does lives** — the number on each tab, `(H)`
  and `(B)` on the panel buttons, `(M)` on the Move button, and the full list in the build dock's
  "How building works". A shortcut nobody can see is one nobody uses, which is exactly what `1`–`9`
  were before.
- `event.target.matches('input, textarea, select')` guards the lot, so typing in the contract draft
  or the market select never fires a shortcut. Note it assumes an ELEMENT target — true of every real
  keypress, and the reason a test that dispatches on `document` rather than `document.body` will
  appear to prove the shortcuts are broken when they are not.

The fixed `.topbar` gained a **Standing** figure for the same reason: it says the most alarming true
thing about your diplomacy — a war being fought, else a war counting down, else your alliances —
because "fighting begins in twelve ticks" is not something a player should have to open a panel to
find out. Its stats also wrap now: the bar is fixed, and a stat pushed off the end of it is a stat
you can never see.

**Save, Load, the nation select and New game are icon buttons, not spelled-out ones.** Three words
were what made the bar wrap into an orphaned second row at ordinary desktop widths (a lone `Tick`
stat stranded on its own line) — `.icon-btn` is the glyph alone (💾/📂/✚), and `#home-select` is
capped to 130px rather than however wide a country's full name runs. The word itself is not gone:
`.btn-label` clips it the same way `.visually-hidden` used to (off-screen, not `display:none`, so a
screen reader still reads it), and the one place it is genuinely useful — the phone's `⋯` overflow
sheet, which has no crowding at all — un-clips it back to a plain inline label beside the glyph. Same
DOM, same handlers, two renderings of the same word for two different amounts of room.

**A build box's name is single-line and ellipsised on a phone too, not wrapped.** It briefly wrapped
to fit the extra width `--dock` gets on mobile, and a two-word name like "Fishing Fleet" wrapping to
a second line pushed that one box's cost and recipe down by a line while its neighbours in the same
scrolling row did not move — a carousel where every third box sits a little lower reads as broken
alignment rather than as a longer name. `.build__recipe` was already single-line for exactly this
reason (see the note above it); `.build__name` now follows the same rule on both breakpoints, and the
full name is still on the tooltip.

**The phone's stat strip fades at its scrolled edge.** `.stats` already scrolled sideways rather than
wrapping into four rows on a 360px bar; a plain hard cut at the edge of the visible strip looked like
`Trade balance` was the last figure rather than the fourth of eight. The mask is cosmetic only — the
scroll itself is unchanged, `Standing` and `Tick` are exactly as reachable as they were.

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
- **Goods** (`src/ui/resources.js`, pane id `resources`) is the commodity book: **ONE table, one line
  a commodity, fourteen columns.** Prices and Goods were two tabs, then two tables stacked in one
  pane, then two tables side by side — every one of which meant the price of coal was in one place
  and what you were doing with coal was in another, though both were the same thirty-four rows in the
  same order. On one line: the first group of columns is the market named in the header (live price,
  base price,
  drift, need, met, held — any nation on earth, chosen in the select), the second is your own book
  (made, burned, sold, balance, shipped out, bought in, per tick or for the whole game from
  `state.ledger`), and the `↗`/`↙` flags at the end are your policy. It fits because the table is
  `table-layout: fixed` with one fixed name column and thirteen even figure columns, at a font size
  smaller than the rest of the panel. **Base** sits directly beside the selected market's live
  **Price**: it is the commodity definition's fixed reference price, so the adjacent drift is
  readable without inferring its baseline.
  **The two halves are different nations whenever the select is not you**, which is the point — what
  Germany pays and how short it is, beside what you can actually spare — so the group header row is
  load-bearing and says whose figures each half is. The bracket in the `In` column is the feedstock
  share, which is how you see the industrial import channel working at all. The treasury only ever
  shows money and the exchange only ever shows listings, so this is the only place that shows *goods*.
  Above the table, **Sell all / Sell none / Buy all / Buy none** move all thirty-four flags at once.
  Each pair is a switch and the side that already stands lights up (`data-active`), because a bulk
  button whose work is invisible — you pressed "Sell all" on a book that was already all-sell — is
  indistinguishable from a broken one. They also `pushAlert`, since a policy set on a paused game
  changes nothing you can watch happening.
  **`Bal` comes from `spareRates` in `core/state.js`, not from a sum written here** — it is the same
  function the contract-offer filter reads, so what this column promises and what the world is
  allowed to ask you for can never disagree.
- **News** (`src/ui/events.js`, pane id `events`) is the WORLD's log, as against the alerts in the
  corner, which are yours. Every pact agreed or refused, every declaration and every war, every
  contract signed, every formation raised, every cell that appears or is destroyed, and every border
  that moves — for all 258 governments. Filters are **World / Yours / one nation**, and `eventsFor`
  matches a nation under `who` OR `about`, so a pact put to you is your news as much as the
  proposer's. Three rules hold it up:
  - **It expires on the TICK clock** — `CONFIG.events.ttl` (50) ticks — not the wall clock the
    alerts use. It is "what is going on now", not a history of the game, and a history of the game
    would not fit in localStorage beside the markets.
  - **It is bounded TWICE.** `noteEvent` also caps the list at `CONFIG.events.max` whatever the age,
    because the world acts in BURSTS: every nation reviews its army on the same decision tick, and
    the sweep only runs once a tick. A test asserts the cap holds inside a single tick and that it
    is the NEWEST rows that survive.
  - **The systems store DATA, never sentences** (`kind`, `who`, `about`, `what`, `qty`). This file
    is the only place a row becomes English — `src/systems` may not contain presentation text, and
    a formatted string per row would multiply the size for nothing. Measured on a long game: the
    whole log is 8KB of a 1.1MB save.
- **Ranks** scores all countries against each other. The scoring rule (`scoreNations` in
  `src/ui/ranks.js`) is the one piece of UI with a rule rather than a layout in it, so it is covered
  by the suite — which means it must stay free of the DOM, like a system. Its measures are
  normalised against the best in the world, so a score is a standing rather than a unit. Headers and
  cells are centred deliberately: dense comparative columns scan vertically more cleanly when their
  labels and values share the same centre line.
- **Diplomacy** is where relations are asked for, and it is no longer a dropdown per nation — that
  said the quiet part out loud, that a relation was something you SET. Each of the 257 rows carries
  four buttons in a fixed order (**Ally / Access / Peace / War**), a line saying where the two of
  you stand, and a countdown when a declaration is running. Three of the four are proposals; War is
  the one that is declared, and it is styled and placed apart for that reason. Hovering a button
  says roughly how much that government wants what you are offering (`relationAppetite`) or, when it
  is disabled, exactly why. Anything waiting on YOUR answer sits at the top of the pane rather than
  among 257 neutral neighbours, and the same cards appear in the floating inbox — two doors onto one
  state, calling one action, exactly as the contract and licence offers are.
  Rows are built ONCE at mount like the commodity book and the ranks table, and each diffs on its
  own `dataset.sig`, so a tick in which nothing diplomatic happened touches no DOM at all. The
  countdown is in that signature — but only the handful of pairs that actually have a declaration
  standing ever change it.
  Military movement checks those relation values; trade still uses `canTrade` and remains open to
  every non-self country.
- **Selected** is the old inspector. Clicking the map lands there only when no build tool is in hand:
  laying out a chain must not yank the panel away from the list you were reading.
  It renders **two cards, not one**: an ARMY card above whatever the clicked tile is, shown whenever
  you have a formation at all. That card is the only place a selection can be spent, and having to
  hunt for a formation to click on before you can order the other twenty is not a gesture — so it is
  not gated on the click having landed on one. Both cards are in the pane's single `dataset.sig`
  (`armySig` — the army's size, how much of it is selected, how much is campaigning, and whether a
  campaign is available at all), because a formation joining a campaign while you are looking at a
  coalfield still has to repaint the buttons.

### Messages and offers expire differently

`pushAlert` stamps a wall-clock `at`, and `main.js` sweeps expired alerts on a 500ms timer rather than
on a tick — a message you have read clears itself whether the game is running at 4x or sitting
paused. `CONFIG.alertTtlMs` is both the sweep deadline and the `--ttl` the countdown hairline animates
over, so the bar always runs out exactly when the alert goes. Repeating an alert refreshes `at` and
bumps `count` instead of stacking a duplicate.

Building and demolishing announce themselves from `src/actions.js`, guarded by `isPlayer` — the other
governments call the same `build()` every few ticks and none of that is your news.

Contract and tech offers use `CONFIG.offerTtlMs`, but that countdown is active game time, not wall
clock time. `main.js` advances the offer clock only while `state.paused === false`; `pruneOffers`
stamps `offer.activeAt` on the first active sweep and compares against that. A paused or freshly
loaded game must not auto-decline an inbox decision.

**A diplomatic proposal is the third clock, and it is a TICK clock.** It lapses after
`CONFIG.diplomacy.proposalTtl` ticks inside `runRelations`, not in the wall-clock sweep — a treaty
is not a thing you answer in five seconds, and a paused game simply does not advance it. Letting one
lapse counts as an answer and stamps the cooldown, the same rule a declined licence follows, so the
same government does not come straight back with it.

## Footguns

**The inspector, the nation card, the trade head, the inbox, the order book, the deal list, the trade-by-
commodity table, the summary cards, the factory header, each open factory's details, the ranks header
and the alerts all diff on signature strings** via `dataset.sig`. If you make one of
those visuals depend on a new piece of state, you **must** add it to that signature or it will simply
never repaint — with no error. The tech-row signature uses a **boolean** for whether a licence is
affordable rather than the cash figure, so the tree does not rebuild on every tick the treasury moves.
The unit inspector carries the formation's `orderTileId` and its group's **SIZE** rather than its
`groupId`: a companion joining or standing down leaves the id untouched, and the panel is showing the
size — so the id alone would have gone quietly stale. It also carries `armySig`, and that one is in
the signature **even when no tile is selected at all** (`none|${armySig}`), because the army card is
shown whether or not a click has landed anywhere.

**The factory list diffs on two levels, and the outer one is a list of ids** (`dataset.ids`). Rows are
rebuilt only when the set of your sites changes; every tick after that writes the numbers into the
existing rows. Rebuilding the list each tick would throw away the unfolded row and the scroll
position — which is exactly the state you are using while you read it. The commodity book and the
Ranks table work the same way for the same reason: their rows are built once at mount (all
commodities and all countries — both fixed lists) and only their figures are written per tick. Ranks
additionally re-orders its existing rows, and only when `dataset.order` actually changes.

**Your own deals live in `state.ownFlows`, not in `state.flows`.** The world list is capped at
`CONFIG.maxFlows` and a busy planet fills it in a tick or two, so filtering it for your own deals —
which is what the Trade tab used to do — showed a handful and silently hid the rest. `recordFlow`
writes to both. The deal list also GROUPS by partner, commodity and direction, because the same cargo
goes to the same partner every tick and sixty raw lines were four routes written fifteen times.

**The map does NOT work that way — it is a canvas.** At 1,036,800 tiles there is no DOM option: that
many elements exhausts memory and stalls layout, and virtualising the viewport does not rescue it
because zooming out legitimately puts every tile on screen. `src/ui/map.js` repaints the visible
window on every render, so there is no per-tile cache to keep in step. Terrain and ownership colours
therefore live in `TERRAIN_COLOR` and `fillFor()` in JS, **not** in CSS.

Consequences worth knowing before editing the map:

- **The base fill is drawn in RUNS of one colour, a row at a time**, not a rect per tile. Most of a
  row is ocean or one country, and the expensive half of a per-tile fill is not `fillRect` but
  assigning `fillStyle` a hundred thousand times: batching took the whole-planet draw from ~290ms to
  ~40ms, measured. A run is flushed **before** anything is drawn on top of a tile inside it — a
  status ring, a buildable highlight, the selection — or the fill would paint over what it was meant
  to sit under. That ordering is the whole correctness argument; keep it if you touch the loop.
- **Factories with no warehouse in range get a red `!` badge on the map.** Compute that from
  owner-scoped logistics (`depotsByOwner` + `servedBy`) during the draw, not from a DOM overlay and
  not from cross-owner depots. The marker belongs on producers only (`building.output`), never on
  warehouses themselves.
- **Frontiers, coastlines, a graticule and country names are painted over the terrain**, and the
  border segments are COLLECTED during the tile loop rather than found in a sweep of their own: at
  one pixel a tile the visible window is the whole planet, and a second pass over a million tiles
  would double the worst-case draw. A frontier is simply an edge where two neighbouring tiles belong
  to different countries, so it can never disagree with who owns what. Labels sit on the centroids
  in `geography.js` — the same ones the freight matrix uses — so a name is drawn exactly where the
  game thinks the country is. Province boundaries come from `places.js`, drawn in a light stroke
  inside a country before national borders are drawn. **Province lines and labels appear only from
  `PROVINCE_ZOOM` (3px) upward**, and that gate is not cosmetic: below it a province line is thinner
  than the tile it divides, and asking every tile which province it is in — twice, over a viewport
  that is the whole planet — is the one question in the tile loop worth not asking. `edge()` compares
  province INDICES, never names. How much of a province has to be on screen before it is worth
  naming falls as you zoom in (`minTiles`), so a speck does not land its name on its neighbour. The
  country label adds the capital/city name at close zoom, and hover/Selected show
  country → **the province the tile is actually in** → city. There is no Borders button now;
  frontiers and province lines are part of the map read.
- **A province is DRAWN at `PROVINCE_ZOOM` (3px) and NAMED at `PROVINCE_LABEL_ZOOM` (8px)**, and the
  two are different numbers on purpose. A line only has to be seen; a name has to be read, and a
  planet's worth of them at once stops being a map. Getting this wrong is what turned the world into
  a mesh of yellow boxes the first time provinces went in — the fix was the thresholds and a
  hairline colour, not fewer provinces.
- **A country's name is only drawn if it FITS the country.** Without that the Caribbean is a wall of
  overlapping text at every zoom. The width is ESTIMATED from the character count, not measured:
  `measureText` on a hundred and fifty visible countries a draw costs more than every fill in the
  viewport put together, and this only has to decide whether a name is roughly too big.
- **Every country's dimmed tint is computed once** into `DIM`. It used to be a cache keyed by a
  template string, which built and hashed a string per land tile per draw — a couple of hundred
  thousand of them.
- **The graticule is measured pole to pole** (180° over the grid height). It used to be measured
  against the old hand-painted art, which ran 84°N to 57°S, so every parallel was drawn a couple of
  thousand kilometres out.
- Ownership is painted in **two tiers** — your own soil, and everybody else's. Every market on
  earth is open now, so the map no longer has to answer "where may I sell"; only "what is mine".
- **There are no scrollbars and no zoom buttons.** The map is PANNED by dragging it and ZOOMED with
  the wheel or a trackpad pinch (which arrives as `wheel` with `ctrlKey` set, so both take the same
  path). The scroller itself is still there — a `.map__spacer` sized to the whole world is what
  `scrollLeft`/`scrollTop` move against, and the canvas is absolutely positioned at the content
  origin and moved with a matching `transform` — it simply has nothing visible on it.
- **Zoom holds the tile under the cursor.** `attachZoom` converts the pointer to world coordinates
  at the old tile size, resizes the spacer, and sets the scroll offset so the same world point lands
  back under the pointer. Zooming toward something and then having to hunt for it again is exactly
  what makes naive wheel zoom feel wrong.
- **A drag that ends on a tile is not a click.** `attachPan` sets `view.dragged` past a four-pixel
  threshold and the click handler swallows the next click, or moving the map would build a mine
  wherever you let go.
- Clicks and hover are hit-tested from mouse coordinates plus scroll offset. There is no element per
  tile to attach a listener to.
- Re-measure draw cost after map-size changes. Renders happen on a tick, not a frame — do not add a
  per-frame render.
- **The canvas is sized from a `ResizeObserver`, and that is load-bearing** now that the map fills the
  window. Its size is zero on the first layout pass and changes with the window, but a render only
  happens on a TICK — so a paused game would sit blank or stretched until something else moved.
  `mountMap` returns a `dispose` that disconnects it, because remounting builds a second canvas and a
  stale observer would keep painting the detached one.
- Buildings are indexed into a `Map` by `tileId` once per draw. Searching `state.buildings` per tile
  is `O(tiles × buildings)` and dominates everything else.
- **Formations are indexed the same way, but a tile maps to a LIST**, because they stack. The draw
  paints the top of the stack and writes `×n` beside it — without that a column of five reads as a
  lone scout. Your own standing ORDERS are indexed in the same pass into `ordersByTile`, so a
  destination is marked on the ground (`drawWaypoint`): a march takes many ticks now, and an army
  crossing a continent with no visible waypoint looks like an army that has stopped.
- **A selected formation's strike range is ONE rectangle drawn after the tile loop**, not a highlight
  per tile inside it. Only artillery's is bigger than the ground it stands on, so it is worth
  showing — and not worth a per-tile question over a viewport that can be the whole planet. A
  grouped unit wears a second ring for the same reason: grouping changes nothing you can see until
  an order moves four formations at once, which is exactly the surprise a marker prevents.
- **A formation in `ui.selection` wears a cyan rim, and the rubber band is painted LAST**, over the
  frontiers and the labels, because it is a gesture rather than part of the world. The selection is
  turned into a `Set` once per draw for the same reason everything else in the tile loop is indexed
  once. The rim and the band are deliberately the same colour: "these six" has to mean one thing in
  both places, and it is the same cyan the army card's Move button lights up in.
- **A drag with Shift or Ctrl/⌘ held is a SELECTION BOX, not a pan**, and `attachPan` decides that on
  `pointerdown` — before `from` is ever set, so the map cannot lurch. `draw` is called directly on
  each `pointermove` of a band: a render happens on a TICK, and a paused game would otherwise show
  a rubber band that never moved.

Zoom is `ui.zoom`, an index into `CONFIG.zoomLevels`. It lives on `ui`, not `state`, so it never
reaches the save file. Glyphs are dropped below 10px because they are illegible there.

**Tiles are not saved.** A million tile objects run to about 110 megabytes and blow the localStorage
quota, so `packState` strips them and `loadState` calls `rehydrate`, which regenerates them from
`seed` and reattaches each building via its `tileId`.

**TERRAIN is still fixed for the life of a world; OWNERSHIP is not.** Conquest is exactly the
mechanic this note used to warn about, and it carries the diff the warning demanded:
`state.claims` (tile id → new owner) is written by `setTileOwner` and reapplied by `rehydrate` over
the regenerated world. Anything else that starts moving `countryId` MUST go through `setTileOwner`
or it will load back wrong with no error. **Terraforming would still break the save** — nothing
persists a terrain diff, and nothing may mutate `tile.terrain` after generation.

**Commodity bags are compacted on the way out and refilled on the way in.** Every bag carries a key
per commodity and quantities go fractional once spoilage and part-filled orders touch them, so a bag
serialises as twenty-one entries, most of them zero, several of them seventeen digits long — roughly
ten times the necessary size at a thousand sites. `packBag` drops zeros and rounds; `rehydrate`
restores the full bag, and that restore is **required**: the systems subtract from these keys in
place, and a missing key produces `NaN` rather than an error.

**Markets are packed the same way, and they are the biggest thing in the save.** Every nation prices
every commodity itself, so `state.markets` is 258 books of 34 lines; written out as objects it is
three quarters of a megabyte of REPEATED KEY NAMES — `"soldLastTick"` nine thousand times — which on
its own put a fresh save past what localStorage will take. `packMarkets` writes each line as a fixed
tuple in `MARKET_FIELDS` order and `unpackMarkets` restores the object the systems mutate in place.

**The relation table starts EMPTY for the same reason.** `relationOf` returns `neutral` for a pair it
has never heard of, so writing all 258×257 of them down said nothing and cost another megabyte. Only
a pair somebody actually changed is stored, and `lastWarAt` is `-1` rather than `-Infinity` because
`JSON.stringify(-Infinity)` is `null`.

A save runs about 350KB fresh — it is dominated by the markets, the opening buildings and the world's
standing armies, and it is worth re-measuring whenever any of those three changes.

**Building `status` is a closed vocabulary** (`running`, `starved`, `blocked`, `unstaffed`, `store`,
`idle`) set in `src/systems/production.js` and consumed in five places: styled by attribute selectors
in `styles/map.css` and `styles/panel.css`, and labelled in `src/ui/inspector.js`,
`src/ui/factories.js` and `src/ui/summary.js`. Adding a status means touching all of them.

**The commodity ledger tracks YOUR nation only.** One per country would be thousands of numbers a
tick in the save file, and the other governments are read as rankings rather than as accounts —
`ranks.js` derives everything it shows from `state` on the spot. Every write is guarded by
`isPlayer`, and `noteLedger` tolerates a state built without a ledger rather than making four systems
check. Its figures are full-precision floats for a whole game, so `packState` rounds them on the way
out exactly as it rounds `uptime`.

**A contract, a licence and a tech are all plain data on `state`.** `state.contracts`,
`state.contractOffers`, `state.techOffers` and each country's `techs`/`research`/`researching`/
`researchShare` ride along in the save like everything else, which is the whole reason they are
objects and arrays rather than `Map`s and `Set`s. `runContracts` REPLACES `state.contracts` with the
survivors each tick rather than splicing, so a caller holding a contract reference still sees its
running totals — the objects are the same, only the array is new.

**Five signature strings gained fields.** The contract list, the contract offers, the tech tree rows,
the tech head and the ranks table all diff on `dataset.sig` like everything else in the panel. The
tech row signature uses a **boolean** for whether a licence is affordable rather than the cash
figure, for the same reason the inspector does: otherwise the whole tree rebuilds on every tick the
treasury moves.

**`html()` returns the FIRST element of its template.** A markup string with two roots silently drops
the second — which is how the research slider went missing the first time it was written. Wrap
multi-part markup in one container.

**There is no spot market and no trade permission.** `canTrade` is now "are these two different
countries", `state.offers` and `systems/diplomacy.js` are gone, and `report.exports`/`report.imports`
ARE the contract settlements — `runContracts` writes them and resets them, which is why
`sellDomestic` must NOT reset them any more. If you add another way for goods to move, it has to
write those two lines or the whole trade half of the UI goes quiet.
`src/systems/relations.js` is NOT that old file coming back: it decides who is allied with whom and
who is at war, and it moves no goods at all. The name is different on purpose.

**The inbox and the tabs are two doors onto the same offers.** `src/ui/inbox.js` floats over the map
and calls the very same actions the Trade, Tech and Diplomacy panes do; it is not a second copy of
the state. It is repainted on every render whether the panel is open or not, so it diffs on a
signature like everything else that floats. **The pact card is the one with no countdown BAR**: the
bar animates over `CONFIG.offerTtlMs` of WALL clock, and a treaty lapses on the TICK clock, so it
prints its remaining ticks in words instead. Do not give it a bar — the two clocks would disagree
visibly, and a paused game would show a bar running out under an offer that is not going anywhere.

**`state.exchange` rides along in the save** like the contracts do — plain arrays and numbers, no
`Map`s. `exchangeOf(state)` tolerates a state built before it existed rather than making every
caller check, the same way `noteLedger` does. **Reach for it in `actions.js` too, never
`state.exchange.listings`.** The UI renders *after* the action returns, so anything that throws in
there leaves the panel painted with the old state — the mutation happened, the screen did not move,
and what the player sees is a button that does nothing.

**Save compatibility.** Anything put on `state` must be JSON-round-trippable — no `Map`, `Set`,
`Date`, or class instances, or load will silently produce a broken game. Bump `SAVE_VERSION` in
`src/core/state.js` when the shape changes; mismatched saves are discarded rather than migrated.
It is at **15** for sparse asymmetric `state.diplomacy.opinion`. Fourteen was raised for
`state.events`, `state.claims`, `state.occupied` and `mapVersion`; thirteen was
`state.diplomacy` gaining `proposals`, `ultimatums`, `history` and `nextId`; twelve was formations
gaining `orderTileId` and `groupId`. Thirteen also had buildings gaining
`builtAt`, and units trading `supplied` for `engaged`. Both are exactly the kind of change that has
to bump it: a marching column loaded out of a save that never heard of orders would stand still for
ever, and a declaration of war loaded out of one that never heard of ultimatums would never mature,
with no error anywhere. Everything added is a plain array, object or number, so it round-trips.

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
itself is still the answer for one-off questions from the UI and from state industry. `relay` pays
the same index once and then works per OWNER rather than per site: the depot graph is quadratic in
one nation's depots (tens, not thousands) and the BFS is per commodity over that graph, so it costs
about what `distribute` costs and does not grow with the world.

**`worldIndex.js` and `worldBalance.js` are shared AI infrastructure.** `worldIndex.js` owns
`tilesByCountry`/`landOf`, cached on `state.tiles` plus `state.mapVersion`, and is used by state
industry, state military and `military.js` itself — an automatic campaign asks "where is that
country" every tick per formation, and walking a million tiles to answer it is what the index is for.
`worldBalance.js` owns world demand, supply, offered stock and scarcity;
state industry and research should read it rather than growing private copies of the same scan.

**The exchange indexes stock and payroll once per posting round.** Asking `warehouseStock`/`projectedWages` per
country per commodity — the obvious way to write it — is hundreds of countries times thirty-four scans of
every building in the world, every tick.
