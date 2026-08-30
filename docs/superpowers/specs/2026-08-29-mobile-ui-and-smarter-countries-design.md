# Mobile shell, and countries that think

Date: 2026-08-29

Two pieces of work in one change: make the chrome usable on a phone, and make the
258 governments behave less like a script and more like neighbours.

Nothing here introduces a dependency, a build step or a framework. Systems still
never touch the DOM and the UI still never mutates state.

---

## Part A — the mobile shell

**One breakpoint, `max-width: 820px`.** The existing 760px rule that stacks the
Market and Trade panes folds into it, so the project has exactly one number that
means "this is a phone". A second breakpoint is a second place to forget.

### A1. The header becomes one row

`.stats` stops wrapping and scrolls sideways; all eight figures are kept, with
Treasury, Net, Standing and Tick first. Speed, Save, Load, the nation select and
New game move behind a `...` button.

The overflow items are **the same DOM**, wrapped in `.controls__more`: inline
flex on desktop, a positioned sheet on mobile, toggled by `ui.menuOpen`. A second
copy of those controls would be a second source of truth for the same buttons.
`.controls__more` gets its own `[hidden] { display: none }` rule — an author
`display` beats the user agent's `[hidden]` whatever the specificity.

### A2. The top panel becomes a full-width sheet

`left/right: 0`, no `translateX`, flush under the header, 60vh open and 88vh
tall. **The tab strip stops wrapping and scrolls sideways instead**: ten tabs in
three wrapped rows is most of a phone screen. The grow and collapse controls
stick to the right end so the panel can always be closed.

### A3. The bottom dock becomes one row of touch-sized boxes

`min(184px, 30vh)`, one grid row, 132px columns, a box about 100px tall.

This deliberately overrides the "TWO ROWS, always" rule. That rule exists so the
row count is a decision rather than a leftover of the container's height; this is
a decision. Two rows in a phone-sized dock leave a 40px box, which is not a touch
target.

### A4. The floating overlays stop colliding

`#terror` (236px) and `#inbox` (262px) both float at `top: 58px` on opposite
edges. On a 360px screen they overlap.

They gain a shared `<div class="overlays">` parent that is `display: contents` on
desktop — literally no change, the children stay absolutely positioned against
`.layout` — and a bottom-anchored flex column above the build dock on mobile.
Alerts keep the top band.

A `--dock` custom property replaces the hardcoded `min(156px, 25vh)` in
`.maptools`, so the zoom label tracks the dock at both sizes.

### A5. The panes

- Goods' thirteen columns go in a `.scroller`, the box Ranks already uses.
- `.diplomacy` two columns become one; `.summary__inner` three become two;
  `.countries` three become two.
- Touch targets of at least 36px on `.tab`, `.build-tab`, `.flag` and `.dip__act`.

### A6. Pinch to zoom

A phone has no wheel, so today the map cannot zoom at all. `map.js` tracks two
active pointers and zooms on the ratio of the distance between them, holding the
midpoint the way the wheel handler holds the cursor. **No zoom buttons** — the
"no scrollbars and no zoom buttons" rule stands.

---

## Part B — countries that think

### B0. Two shared modules

`worldDemand`, `worldSupply`, `worldOffer` and `scarcityOf` live inside
`stateIndustry.js` today; research and the military both want them.
`src/systems/worldBalance.js` holds them, memoised per tick.
`src/systems/worldIndex.js` holds `tilesByCountry` (already cached on
`state.tiles` + `mapVersion`), so `stateMilitary` reuses the index
`stateIndustry` has already paid for rather than scanning a million tiles again.

### B1. Industry builds the missing upstream link

`bestSite` rejects a plan outright when an input is neither produced at home nor
standing in a warehouse somewhere, so a nation with no coal never builds the coal
mine that would unlock its steel.

One level of lookahead: when a high-scoring plan is blocked *only* by a missing
input, the plant that makes that input scores `blockedScore x CONFIG.stateChain.lookahead`.
One level only — two needs a real planner, and 258 nations cannot afford one.

### B2. Trade

- **Sellers undercut.** `askPrice` is `max(local, floor) * 1.02` for everybody, so
  every seller posts nearly the same number and matching is arbitrary. A seller
  now undercuts the best standing ask by a hair when it can still clear its floor.
- **`bestSeller` scores the deal, not only the distance.** Freight still counts,
  and so does the seller's own price and how the two nations stand (below).
- **`seekContract` falls through.** It chases a nation's single largest shortage
  and gives up if that one is covered; it now tries the next.

### B3. Research picks the tech that pays

`chooseTech` scores `useful ? 1_000_000 : 0` minus cost. It becomes the value of
what the tech unlocks — at that nation's own prices, times world scarcity of the
outputs, gated by terrain and by whether the feedstock is reachable — over the
tech's cost. The extraction/terrain hard filter stays.

### B4. An army with somewhere to go

`orderArmy` sends idle formations at a terrorist cell or at the nearest enemy
*site*, and does nothing at all when the enemy has no reachable buildings.
It becomes a priority ladder:

1. a terrorist cell on its own soil
2. **an enemy formation standing on its own soil** — defending home outranks
   marching abroad
3. the nearest enemy site, fanned out as now
4. **the nearest enemy-owned tile** — taking ground is how a war is won, and
   `takeGround` runs on every step of a march

(4) walks the enemy's tile list from the shared index, nearest enemy by centroid
first, strided so no more than about two thousand tiles are examined, and only
for formations that have no better target.

### B5. The world declares war — rarely

`declareWar` is called today only by the player's button and by `dragInAllies`,
so every war on the planet starts with you.

`warAppetite(state, from, to)` mirrors `relationAppetite`: much stronger than the
target, near enough to reach it, and no standing worth keeping. Three brakes,
because a world permanently at war is not a world:

- `CONFIG.diplomacy.warAppetite` is a high threshold,
- `warsPerReview` is 1,
- `warQuiet` is a worldwide cooldown in ticks between any two declarations the
  world makes on its own.

A declaration on the player goes through the same `declareWar`, so it writes an
ultimatum and you get the full fifty ticks of warning.

### B6. OPINION — how two governments feel about each other

New persisted state. `state.diplomacy.opinion[a][b]` is how much `a` thinks of
`b`, in -1..+1, **asymmetric** (a victim's view of an aggressor is not the
aggressor's view of the victim) and **sparse** — only a pair somebody has
actually moved is stored, exactly as the relation table is, and an entry that
decays below 0.005 is dropped. `opinionOf` returns 0 for a pair it has never
heard of.

It lives in `core/state.js` beside the other state accessors, not in
`relations.js`, because `contracts.js` writes to it and everything already
imports `state.js` — no import cycle to reason about.

**What moves it**

| Event | Effect |
|---|---|
| A contract signed | both sides up (`opinionPerContract`) |
| A contract runs its full term | both sides up (`opinionPerDelivery`) |
| A side defaults on one | the wronged side's view drops (`opinionOnDefault`) |
| War declared, A on B | B's view of A drops hard (`opinionOnWar`) |
| ...and B's friends | every C that likes B, or is allied with or granting access to B, lowers its view of A by `opinionWarFriends` **scaled by how much C actually likes B** |
| Every review | everything decays toward 0 (`opinionDecay`) |

Opinion is nudged on **events**, never per tick per contract: a signing, a
completion and a default are all rare, and a per-tick trickle over every standing
contract would be hundreds of writes a tick for a figure that moves slowly.

**What reads it**

- `relationAppetite` gains an opinion term, so a government that likes you says
  yes to an alliance it would otherwise refuse — and the Diplomacy tab shows that
  answer before you ask, because the function stays pure in `state`.
- `warAppetite` subtracts it. You do not invade somebody you get on with.
- `bestSeller` and `bestPartnerFor` prefer a friend, which is what makes
  "allies trade with each other" true rather than decorative.

**Where it is SEEN.** Every row of the Diplomacy tab carries the figure, as a
word and a tinted bar (`hostile / cold / neutral / warm / friendly`), and the
head line says how the world as a whole regards you. Opinion that only moved
other numbers would be a mechanic the player could not play, so it goes in the
row's `dataset.sig` — the rows diff on a signature and a figure left out of one
simply never repaints.

**Save.** `state.diplomacy.opinion` is a plain nested object of numbers, rounded
in `packState` like `uptime` and the ledger. `SAVE_VERSION` goes **14 -> 15**.

---

## Testing

`test/run.js`, beside the existing 202. Every behaviour above gets a test; the
opinion table additionally gets a save round-trip, because it is new persisted
state and a save that dropped it would load into a world with no history and no
error anywhere.

## Sequence

A (mobile) -> B0/B1 -> B2/B3 -> B6 (opinion, since B4/B5 read it) -> B4/B5.
`node tools/test.js` at every step.
