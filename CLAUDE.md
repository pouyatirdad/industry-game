# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Browser-based economic strategy game. **You govern a nation** — one of 258 countries and territories
on a real polygon-derived world map — and the rest are run by the same code. Vanilla ES modules: no
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

When the user asks you to commit and push, update this file in the same change if the work teaches a
new repo rule, run the relevant tests first, commit only the files you intentionally changed, and
push the current branch. Do not leave a requested push as a reminder.

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
- `worldCountries.js` — generated ISO country/territory ownership data from GeoJSON polygons:
  `WORLD_COUNTRY_INFO` and a 360×180 `SOURCE_COUNTRY_ROWS` grid. This is the live ownership source.
- `world.js` — keeps the old hand-editable 120×60 source art as reference/fallback data, but also
  imports and upscales the ISO country grid for the live map.
- `geography.js` — **derived** data: each country's centroid and the distance matrix between all of
  them, computed once from the ISO country grid with GeoJSON centroids as fallback for tiny
  countries. Freight reads this, so moving country ownership moves the freight bill with it.

**The live country source grid is 360×180; the playable grid is 720×360 — 259,200 tiles.**
`world.js` upscales `SOURCE_COUNTRY_ROWS` at load, so tile ownership is real ISO country IDs rather
than one-character paint. The projection is plain equirectangular: column 0 is 180°W, row 0 is 90°N.
Russia and Canada are stretched near the poles exactly as on a Plate Carrée wall map, and their tile
counts reflect that.

The opening zoom is `CONFIG.defaultZoom = 2` (3px/tile), because labels only appear from 3px upward
and tiny countries otherwise look absent even when the ISO grid gives them land.

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

- **Land deposits are authored against the 360×180 ISO source and multiplied by `AREA_SCALE`.** Write
  the number as a count of *source* cells. Fractions are allowed, but tiny countries may have only a
  fallback cell, so default countries intentionally have no authored land deposits.
- **Water deposits (`waters`) are FRACTIONS of a country's territorial sea, not counts.** The sea is
  not in the source art, so there is nothing to scale against and a fraction is scale-free.
- **A country's deposits must sum to no more than ~60% of the cells it owns.** `MAX_DEPOSIT_SHARE`
  reserves flat ground, and once the budget runs out, generation drops whatever comes last in
  `DEPOSIT_ORDER`. `DEPOSIT_ORDER` therefore puts scarce and strategic resources first and ubiquitous
  filler (quarry, farmland, desert) last, so a cramped country keeps what it is known for. A test
  fails if any country over-subscribes. Countries authored before the grid grew to 720×360 can look
  tighter than they are — Iran and Saudi Arabia read as capped and in fact use well under a fifth of
  their budget — so **check the actual counts before paying for one deposit with another**: generate
  a state and count the tiles rather than trusting a comment.

**`wageMul` is UNIT labour cost, not the hourly wage.** A German hour costs fifteen times an
Ethiopian one but buys far more output, so the spread here is about six to one. This matters because
wages are the only running cost in the game besides inputs: set the multipliers off hourly pay and
every high-wage nation becomes unplayable, since every plant it could build loses money on the day it
opens. A test asserts the dearest labour on earth can still profit on the deepest chain.

### Governments are you, without the mouse

`systems/stateIndustry.js` is about a hundred and eighty lines because it only decides *what* to
build; `build()`, `produce`, `collect`, `payWages`, `sellDomestic` and `runExchange` do the rest. Four
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
  commodity's `↗`/`↙` flag off in Goods stops your government posting it on the exchange at all
  and leaves it entirely to contracts you write by hand.

`signContract` is the only way one comes into being — your button, an accepted offer, and the
governments' own dealing all land there — so none of them can write terms the others could not.
Contracts are settled against **depots indexed once per tick** (`depotsByOwner`), like `collect` and
`distribute`, because a tick that settles a hundred of them must not scan every building in the
world twice per contract.

`state.contractOffers` and `state.techOffers` are what other governments have put to you; both lapse
if you never answer, and both also appear in the floating inbox over the map.

### The map is the page; the panels float on top of it

`.layout` is ONE layer. The map is absolutely positioned to fill it, and both panels are modals over
it — left `10px`, right `10px`, top to bottom — so the world is never squeezed into the middle third
of the window. Neither the page nor the body scrolls: `body` is a flex column of a fixed topbar and
the layout, and the only things that scroll are the map and the insides of the two panels.

Consequences worth knowing:

- **Both panels fold away**, and both keep a handle: the left one leaves the `☰ Build` rail
  (`ui.leftOpen`, `B`), the right one leaves its tab strip (`ui.panelOpen`, or clicking the tab you
  are already on).
- **A pane should still be READABLE in one look, but it may now scroll.** `.panes` was
  `overflow-y: hidden` on the principle that a table is read whole — which was true of the pane it
  was written for and false of every pane that grew since: the bottom of the Trade list, the Ranks
  table and the tech tree were simply unreachable on a short window. The aim is unchanged, so the
  build menu is still two columns of one-line rows, the tables' rows are still single-line
  (`.market td` is `nowrap`, the name truncates, and figures use `priceShort`/`qtyShort` so a
  four-digit price cannot wrap a row into two), and the standing explanations are still `<details>`.
  **Sideways is a different matter** — a pane that overflows horizontally is a bug, not a scroll,
  which is why the nine-column Ranks table lives in its own `.scroller` and why a summary card's
  `.facts` is one column rather than two.
- **Scrollbars are INVISIBLE** — `scrollbar-width: none` once in `base.css`, for every scroller
  including the map. They cost more width than the figures beside them. Everything still scrolls by
  wheel, drag, trackpad and keyboard, so a box that can overflow must say `overflow: auto`;
  `hidden` now means "this genuinely cannot be reached", which is almost never what you want.

### The side panel is one column with eight views

`index.html` declares a `<section class="pane" data-pane="…">` per view; `src/ui/tabs.js` owns the
strip and the `TABS` list that names them. `ui.tab` says which is on screen, `ui.panelOpen` whether
the panel is unfolded at all, `ui.leftOpen` whether the build panel is, `ui.openFactoryId` which site
has its numbers unfolded, `ui.goodsView` whether the commodity book reads the tick or the game,
`ui.rankSort` which column the nation table is ranked by, `ui.bookFilter` whether the exchange shows
everybody's terms or only yours, and `ui.draft` the contract you are writing but have not signed —
all on `ui`, so none of it reaches the save file. Eight tabs do not fit one row of the panel, so
**the strip wraps**: a tab you cannot read is not a tab you will click.

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
- **Goods** (`src/ui/resources.js`, pane id `resources`) is the commodity book, and it is ONE table.
  Prices and Goods were two tabs, then two tables stacked in one pane — which meant the price of coal
  was in one place and what you were doing with coal was in another, though both were the same
  thirty-four rows in the same order. They are now the same row: the first group of columns is the
  market named in the header (price, drift, need, met, held — any nation on earth, chosen in the
  select), the second is your own book (made, burned, sold, balance, shipped out, bought in, per tick
  or for the whole game from `state.ledger`), and the `↗`/`↙` flags at the end are your policy.
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
- **Ranks** scores all countries against each other. The scoring rule (`scoreNations` in
  `src/ui/ranks.js`) is the one piece of UI with a rule rather than a layout in it, so it is covered
  by the suite — which means it must stay free of the DOM, like a system. Its measures are
  normalised against the best in the world, so a score is a standing rather than a unit.
- **Selected** is the old inspector. Clicking the map lands there only when no build tool is in hand:
  laying out a chain must not yank the panel away from the list you were reading.

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

## Footguns

**The inspector, the nation card, the trade head, the inbox, the order book, the deal list, the trade-by-
commodity table, the summary cards, the factory header, each open factory's details, the ranks header
and the alerts all diff on signature strings** via `dataset.sig`. If you make one of
those visuals depend on a new piece of state, you **must** add it to that signature or it will simply
never repaint — with no error. The tech-row signature uses a **boolean** for whether a licence is
affordable rather than the cash figure, so the tree does not rebuild on every tick the treasury moves.

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

**The map does NOT work that way — it is a canvas.** At 259,200 tiles there is no DOM option: that
many elements exhausts memory and stalls layout, and virtualising the viewport does not rescue it
because zooming out legitimately puts every tile on screen. `src/ui/map.js` repaints the visible
window on every render, so there is no per-tile cache to keep in step. Terrain and ownership colours
therefore live in `TERRAIN_COLOR` and `fillFor()` in JS, **not** in CSS.

Consequences worth knowing before editing the map:

- **Frontiers, coastlines, a graticule and country names are painted over the terrain**, and the
  border segments are COLLECTED during the tile loop rather than found in a sweep of their own: at
  one pixel a tile the visible window is the whole planet, and a second pass over 259,200 tiles
  would double the worst-case draw. A frontier is simply an edge where two neighbouring tiles belong
  to different countries, so it can never disagree with who owns what. Labels sit on the centroids
  in `geography.js` — the same ones the freight matrix uses — so a name is drawn exactly where the
  game thinks the country is. There is no Borders button now; frontiers are part of the map read.
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

Zoom is `ui.zoom`, an index into `CONFIG.zoomLevels`. It lives on `ui`, not `state`, so it never
reaches the save file. Glyphs are dropped below 10px because they are illegible there.

**Tiles are not saved.** 259,200 tile objects run to tens of megabytes and blow the localStorage
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

**The inbox and the tabs are two doors onto the same offers.** `src/ui/inbox.js` floats over the map
and calls the very same actions the Trade and Tech panes do; it is not a second copy of the state.
It is repainted on every render whether the panel is open or not, so it diffs on a signature like
everything else that floats.

**`state.exchange` rides along in the save** like the contracts do — plain arrays and numbers, no
`Map`s. `exchangeOf(state)` tolerates a state built before it existed rather than making every
caller check, the same way `noteLedger` does. **Reach for it in `actions.js` too, never
`state.exchange.listings`.** The UI renders *after* the action returns, so anything that throws in
there leaves the panel painted with the old state — the mutation happened, the screen did not move,
and what the player sees is a button that does nothing.

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

**The exchange indexes stock and payroll once per posting round.** Asking `warehouseStock`/`projectedWages` per
country per commodity — the obvious way to write it — is hundreds of countries times thirty-four scans of
every building in the world, every tick.
