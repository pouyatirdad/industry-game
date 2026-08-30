import { createInitialState, createUiState, saveState, loadState, clearSave, pushAlert,
  pruneAlerts, pruneOffers, dismissAlert, buildingById } from './core/state.js';
import { createLoop } from './core/loop.js';
import { CONFIG } from './core/config.js';
import { runTick } from './systems/index.js';
import { build, canBuild, demolish, toggleExport, toggleImport,
  setAllExports, setAllImports, setSpeed, togglePause, setResearch, setResearchShare, buyTech, acceptTechOffer, declineTechOffer,
  proposeContract, acceptContractOffer, declineContractOffer, cancelContract,
  postListing, cancelListing, take, takeLoan, repayLoan, changeRelation,
  deployUnit, standDown, standDownUnit, orderMove, groupUnits, ungroupUnit,
  answerPact, withdrawPact, standDownWar } from './actions.js';
import { unitOnTile } from './systems/military.js';
import { suggestListing } from './systems/exchange.js';
import { sellersOf } from './systems/research.js';
import { COUNTRIES } from './data/countries.js';
import { createRenderer } from './ui/render.js';
import { TABS } from './ui/tabs.js';
import { buildCategory } from './ui/dashboard.js';

const ctx = {
  state: createInitialState(),
  ui: createUiState(),

  onTileClick(tileId) {
    const tile = ctx.state.tiles[tileId];
    // Clicking the world puts the panel away. It is the counterpart of clicking
    // a tab to open one: the panel docks OVER the map, so reaching for the map
    // is the plainest possible statement that you have finished reading. Set
    // before every branch below, so it holds whether the click was a build, a
    // deployment, an order or a plain selection.
    ctx.ui.panelOpen = false;
    // ...and so does the topbar sheet, for exactly the same reason: reaching for
    // the map is the plainest statement that you are finished with a menu.
    ctx.ui.menuOpen = false;
    // Assembling a group takes priority over everything else: the pointer was
    // put into "group" mode from the Selected pane, and this click names the
    // companion. Clicking anything that is NOT one of your formations is how
    // you say you are finished — the mode ends and the click falls through to
    // an ordinary selection.
    if (ctx.ui.groupUnit != null) {
      const other = unitOnTile(ctx.state, tileId);
      if (other && other.owner === ctx.state.home && other.id !== ctx.ui.groupUnit) {
        groupUnits(ctx.state, ctx.ui.groupUnit, other.id);
        ctx.ui.selectedTileId = tileId;
        render();
        return;
      }
      ctx.ui.groupUnit = null;
    }
    // An order for a formation you already have takes priority over everything
    // else the pointer could mean: it was put into "move" mode from the
    // Selected pane, and this click is where it goes.
    if (ctx.ui.moveUnit != null) {
      orderMove(ctx.state, ctx.ui.moveUnit, tile);
      ctx.ui.moveUnit = null;
      ctx.ui.selectedTileId = tileId;
      render();
      return;
    }
    // A formation in hand is the same gesture as a building in hand: click your
    // own ground and it appears there — paid for out of your WAREHOUSES rather
    // than out of the treasury, because an army is supplies, not capital. It
    // announces itself, so laying out a line of them does not throw you out of
    // the tab you are working in.
    if (ctx.ui.unit) {
      deployUnit(ctx.state, ctx.ui.unit, tile);
      ctx.ui.selectedTileId = tileId;
      render();
      return;
    }
    if (ctx.ui.tool) {
      const check = canBuild(ctx.state, ctx.ui.tool, tile);
      if (check.ok) {
        // build() announces itself, so laying out a chain does not throw you
        // out of the tab you are working in.
        build(ctx.state, ctx.ui.tool, tile);
        ctx.ui.selectedTileId = tileId;
        render();
        return;
      }
      pushAlert(ctx.state, check.reason, 'warn');
    }
    ctx.ui.selectedTileId = tileId;
    // Clicking bare ground with no tool in hand IS the question "what is this",
    // so Selected is the pane the panel will show when it is next opened. It is
    // primed rather than shown, because the click just closed the panel — one
    // click to put the world back, one on the tab strip to read about what you
    // clicked. Still guarded on `tool`, or laying a row of mines would leave the
    // panel primed on Selected instead of the list you were working from.
    if (!ctx.ui.tool) ctx.ui.tab = 'selected';
    render();
  },

  // Right-click clears a tile: a building is demolished for half its cost, and
  // a formation standing on bare ground is stood down. One gesture, because
  // from the map's point of view they are the same question.
  onTileRightClick(tileId) {
    const tile = ctx.state.tiles[tileId];
    // A right-click is a click on the world too, so it puts the panel away for
    // the same reason a left-click does.
    ctx.ui.panelOpen = false;
    if (tile.buildingId != null) demolish(ctx.state, tile);
    else standDown(ctx.state, tile);
    render();
  },

  onSelectTool(type) {
    ctx.ui.tool = ctx.ui.tool === type ? null : type;
    ctx.ui.unit = null;
    ctx.ui.moveUnit = null;
    ctx.ui.groupUnit = null;
    render();
  },
  // Picking up a formation puts down whatever building was in hand, and the
  // other way round: the pointer only ever carries one thing.
  onSelectUnit(type) {
    ctx.ui.unit = ctx.ui.unit === type ? null : type;
    ctx.ui.tool = null;
    ctx.ui.moveUnit = null;
    ctx.ui.groupUnit = null;
    render();
  },
  onBuildView(view) {
    ctx.ui.buildView = view;
    if (ctx.ui.tool && buildCategory(ctx.ui.tool) !== view) ctx.ui.tool = null;
    if (ctx.ui.unit && view !== 'military') ctx.ui.unit = null;
    render();
  },
  // Put a standing formation into "move" mode from the Selected pane. The next
  // tile click is the order; picking up a build tool or another formation
  // cancels it, same as it cancels any other pointer mode.
  onMoveUnit(unitId) {
    ctx.ui.moveUnit = unitId;
    ctx.ui.tool = null;
    ctx.ui.unit = null;
    ctx.ui.groupUnit = null;
    render();
  },
  // ...and into "group" mode, which is the same shape of gesture: the next
  // click on one of your own formations puts the two together, and it stays on
  // so a column can be assembled in a run of clicks.
  onGroupUnit(unitId) {
    ctx.ui.groupUnit = ctx.ui.groupUnit === unitId ? null : unitId;
    ctx.ui.tool = null;
    ctx.ui.unit = null;
    ctx.ui.moveUnit = null;
    render();
  },
  // The keyboard's way into "move" mode: it acts on whatever formation of yours
  // is currently selected, so `M` is the same gesture as the Move button and
  // goes through the same door. Pressing it again puts the order back down,
  // exactly as clicking the button again does.
  onMoveSelected() {
    const unit = ctx.ui.selectedTileId == null ? null : unitOnTile(ctx.state, ctx.ui.selectedTileId);
    if (!unit || unit.owner !== ctx.state.home) {
      pushAlert(ctx.state, 'Select one of your own formations first, then press M to move it.', 'warn');
      render();
      return;
    }
    ctx.onMoveUnit(ctx.ui.moveUnit === unit.id ? null : unit.id);
  },
  onUngroupUnit(unitId) {
    ungroupUnit(ctx.state, unitId);
    render();
  },
  onStandDownUnit(unitId) {
    standDownUnit(ctx.state, unitId);
    if (ctx.ui.moveUnit === unitId) ctx.ui.moveUnit = null;
    if (ctx.ui.groupUnit === unitId) ctx.ui.groupUnit = null;
    render();
  },

  // Clicking a nation in the list selects one of its tiles, which is what puts
  // its figures in the inspector. It also swings the price panel over, since
  // "what does this country pay" is the next question.
  onFocusCountry(countryId) {
    // Empty ground on purpose: land in the inspector for the NATION rather than
    // for whatever happens to be built on the first tile it owns.
    const tile = ctx.state.tiles.find((t) => t.countryId === countryId
      && t.terrain === 'plain' && t.buildingId == null)
      ?? ctx.state.tiles.find((t) => t.countryId === countryId && t.buildingId == null);
    if (tile) ctx.ui.selectedTileId = tile.id;
    ctx.ui.marketCountry = countryId;
    renderer.refs.pricesCountry.value = countryId;
    render();
  },

  // --- the exchange -------------------------------------------------------

  onListingDraft(patch) { Object.assign(ctx.ui.listing, patch); render(); },
  onPostListing() { postListing(ctx.state, ctx.ui.listing); render(); },
  onCancelListing(id) { cancelListing(ctx.state, id); render(); },
  onTakeListing(id) { take(ctx.state, id); render(); },
  onBorrow(amount) { takeLoan(ctx.state, amount); render(); },
  onRepay(amount) { repayLoan(ctx.state, amount); render(); },

  onZoom(index) { ctx.ui.zoom = index; render(); },

  // --- technology ---------------------------------------------------------

  // Clicking the subject you are already studying puts the laboratories back on
  // the shelf, which is the only way to stop spending on research entirely.
  onResearch(techId) {
    setResearch(ctx.state, ctx.state.countries[ctx.state.home].researching === techId ? null : techId);
    render();
  },
  onResearchShare(share) { setResearchShare(ctx.state, share); render(); },
  // The nearest nation that holds it is the one you buy from; the tree shows
  // which, and how many others could have sold it to you.
  onBuyTech(techId) {
    const seller = sellersOf(ctx.state, ctx.state.home, techId)[0];
    if (seller) buyTech(ctx.state, techId, seller);
    render();
  },
  onAcceptTech(techId) { acceptTechOffer(ctx.state, techId); render(); },
  onDeclineTech(techId) { declineTechOffer(ctx.state, techId); render(); },

  // --- contracts ----------------------------------------------------------

  onDraft(patch) { Object.assign(ctx.ui.draft, patch); render(); },
  onSignContract() { proposeContract(ctx.state, ctx.ui.draft); render(); },
  onAcceptContract(offer) { acceptContractOffer(ctx.state, offer); render(); },
  onDeclineContract(offer) { declineContractOffer(ctx.state, offer); render(); },
  onCancelContract(id) { cancelContract(ctx.state, id); render(); },

  onGoodsView(view) { ctx.ui.goodsView = view; render(); },

  onRankSort(column) { ctx.ui.rankSort = column; render(); },

  onSelectTab(tab) {
    // Clicking the tab you are already on folds the panel away, so the strip
    // itself is the show/hide control.
    if (ctx.ui.tab === tab && ctx.ui.panelOpen) ctx.ui.panelOpen = false;
    else { ctx.ui.tab = tab; ctx.ui.panelOpen = true; }
    render();
  },

  onTogglePanel() { ctx.ui.panelOpen = !ctx.ui.panelOpen; render(); },
  // How much room the panel gets. Nine views do not want the same height: the
  // summary is read in one look, the ranks table and the tech tree are not, and
  // scrolling a pane that was sized for a card is the wrong answer to both.
  onTogglePanelHeight() {
    ctx.ui.panelTall = !ctx.ui.panelTall;
    ctx.ui.panelOpen = true;
    render();
  },
  // Walking the strip without reaching for the mouse. Wraps, because a nine-tab
  // strip you have to back out of is a strip you stop using.
  onStepTab(by) {
    const at = TABS.findIndex((t) => t.id === ctx.ui.tab);
    const next = TABS[((at < 0 ? 0 : at) + by + TABS.length) % TABS.length];
    ctx.ui.tab = next.id;
    ctx.ui.panelOpen = true;
    render();
  },
  // There is deliberately no peek/hide pair any more. The panel opened on hover
  // and closed the instant the pointer left it, which meant it could not be kept
  // open while you did anything else — reading a table and reaching for the map
  // dismissed the table. It is opened and closed by CLICKING now: a tab, the
  // collapse control, or the map.

  // The topbar's overflow sheet, which only exists on a phone. It holds no
  // controls of its own — speed, save, load, the nation select and New game are
  // the same buttons that sit on the bar at desktop width — so this decides
  // only whether they are on screen.
  onToggleMenu() { ctx.ui.menuOpen = !ctx.ui.menuOpen; render(); },
  onCloseMenu() { if (ctx.ui.menuOpen) { ctx.ui.menuOpen = false; render(); } },

  onToggleLeft() { ctx.ui.leftOpen = true; render(); },
  onPeekLeft() { if (!ctx.ui.leftOpen) { ctx.ui.leftOpen = true; render(); } },
  onHideLeft() {},
  onCenterHome() { renderer.centerOnCountry(ctx.state.home); },

  // A row in the factory list is both a disclosure and a way to find the site:
  // it unfolds the numbers and puts the map over the tile they describe.
  onToggleFactory(id) {
    const building = buildingById(ctx.state, id);
    ctx.ui.openFactoryId = ctx.ui.openFactoryId === id ? null : id;
    if (building) {
      ctx.ui.selectedTileId = building.tileId;
      renderer.centerOn(building.x, building.y);
    }
    render();
  },

  onRemoveBuilding(id) {
    const building = buildingById(ctx.state, id);
    if (!building) return;
    if (ctx.ui.openFactoryId === id) ctx.ui.openFactoryId = null;
    demolish(ctx.state, ctx.state.tiles[building.tileId]);
    render();
  },

  onDismissAlert(alert) {
    if (dismissAlert(ctx.state, ctx.state.alerts.indexOf(alert))) render();
  },

  onMarketCountry(countryId) { ctx.ui.marketCountry = countryId; render(); },

  // The terms your own government would have posted for you, filled into the
  // form: what you actually have spare (or are actually short of) and the price
  // it would have asked. It is a draft like any other — nothing is posted until
  // you press Post.
  onSuggestListing() {
    const { side, commodity } = ctx.ui.listing;
    Object.assign(ctx.ui.listing, suggestListing(ctx.state, ctx.state.home, side, commodity));
    render();
  },

  onBookFilter(filter) { ctx.ui.bookFilter = filter; render(); },

  // The red card over the map is a way to GET there: clicking it puts the cell
  // in the middle of the screen and selects the ground it is standing on.
  // The red card, whether it is showing a standing cell or the ground one is
  // about to appear on. Both are a place on the map, so both do the same thing.
  onFocusTerror() {
    const at = ctx.state.terrorism?.active ?? ctx.state.terrorism?.warning;
    if (!at) return;
    ctx.ui.selectedTileId = at.tileId;
    renderer.centerOn(at.x, at.y);
    render();
  },

  // One door for all four moves. Three of them are proposals the other
  // government answers; "war" is the one that is declared rather than asked,
  // and `changeRelation` is what routes it — so a click on Ally and a click on
  // War cannot reach code paths the other could not.
  onRelation(countryId, relation) { changeRelation(ctx.state, countryId, relation); render(); },
  onEventFilter(filter) { ctx.ui.eventFilter = filter; render(); },
  onAnswerPact(proposalId, accept) { answerPact(ctx.state, proposalId, accept); render(); },
  onWithdrawPact(proposalId) { withdrawPact(ctx.state, proposalId); render(); },
  onCallOffWar(ultimatumId) { standDownWar(ctx.state, ultimatumId); render(); },

  onToggleExport(commodityId) { toggleExport(ctx.state, commodityId); render(); },
  onToggleImport(commodityId) { toggleImport(ctx.state, commodityId); render(); },
  onSetAllExports(on) { setAllExports(ctx.state, on); render(); },
  onSetAllImports(on) { setAllImports(ctx.state, on); render(); },
  onSpeed(speed) { setSpeed(ctx.state, speed); render(); },
  onTogglePause() { togglePause(ctx.state); render(); },

  onSave() {
    const result = saveState(ctx.state);
    pushAlert(ctx.state, result.ok ? 'Game saved.' : `Save failed: ${result.reason}`, result.ok ? 'good' : 'danger');
    render();
  },

  onLoad() {
    const loaded = loadState();
    if (!loaded) { pushAlert(ctx.state, 'No compatible save found.', 'warn'); render(); return; }
    replaceState(loaded, `Save loaded — ${COUNTRIES[loaded.home].name}.`);
  },

  onReset() {
    const home = renderer.refs.homeSelect.value;
    clearSave();
    replaceState(createInitialState(Date.now() >>> 0, home), opening(home));
  },
};

function opening(home) {
  return `You govern ${COUNTRIES[home].name}. Build a Warehouse first — nothing moves without one.`;
}

function replaceState(next, message) {
  const { zoom, tab, panelOpen, panelTall, leftOpen, buildView, goodsView, rankSort, eventFilter } = ctx.ui;
  ctx.state = next;
  ctx.state.paused = true;
  ctx.ui = createUiState(next.home);
  // View preferences, not part of the game being replaced.
  ctx.ui.zoom = zoom;
  ctx.ui.tab = tab;
  ctx.ui.panelOpen = panelOpen;
  ctx.ui.panelTall = panelTall;
  ctx.ui.leftOpen = leftOpen;
  ctx.ui.buildView = buildView;
  ctx.ui.goodsView = goodsView;
  ctx.ui.rankSort = rankSort;
  ctx.ui.eventFilter = eventFilter;
  renderer.remountMap();
  renderer.refs.homeSelect.value = ctx.state.home;
  renderer.refs.pricesCountry.value = ctx.ui.marketCountry;
  pushAlert(ctx.state, message, 'info');
  render();
}

const renderer = createRenderer(ctx);
const render = () => renderer.render();

const loop = createLoop({
  ctx,
  onTick: () => runTick(ctx.state),
  onRender: render,
});

document.addEventListener('keydown', (event) => {
  if (event.target.matches('input, textarea, select')) return;
  if (event.code === 'Space') { event.preventDefault(); ctx.onTogglePause(); }
  if (event.key === 'Escape') {
    ctx.ui.tool = null; ctx.ui.unit = null; ctx.ui.moveUnit = null; ctx.ui.groupUnit = null;
    // Escape drops whatever the pointer is carrying AND whatever is covering the
    // map, which on a phone includes the topbar sheet.
    ctx.ui.menuOpen = false;
    render();
  }
  if (event.key === 'b' || event.key === 'B') ctx.onToggleLeft();
  if (event.key === 't' || event.key === 'T') ctx.onTogglePanelHeight();
  // Move the selected formation, and find your own country again. Both are
  // things you reach for constantly once an army is on the map — a column is
  // ordered every few ticks, and at high zoom a planet is very easy to get lost
  // on — so both have a letter rather than only a button.
  if (event.key === 'm' || event.key === 'M') ctx.onMoveSelected();
  if (event.key === 'h' || event.key === 'H') ctx.onCenterHome();
  if (event.key === '+' || event.key === '=') ctx.onZoom(Math.min(CONFIG.zoomLevels.length - 1, ctx.ui.zoom + 1));
  if (event.key === '-' || event.key === '_') ctx.onZoom(Math.max(0, ctx.ui.zoom - 1));
  // The arrows walk the tab strip, so a nine-view panel can be read through
  // without the pointer ever leaving the map.
  if (event.key === 'ArrowLeft') { event.preventDefault(); ctx.onStepTab(-1); }
  if (event.key === 'ArrowRight') { event.preventDefault(); ctx.onStepTab(1); }
  // 1..9 pick a panel, in the order the tab strip shows them — and the strip
  // now prints that number on each tab, so the shortcut is discoverable rather
  // than folklore.
  const slot = Number(event.key);
  if (Number.isInteger(slot) && slot >= 1 && slot <= TABS.length) ctx.onSelectTab(TABS[slot - 1].id);
});

// Alerts expire in real time rather than in ticks, so the sweep is a timer of
// its own: a message you have read clears itself whether the game is running at
// 4x or sitting paused.
//
// Offers are different. An unanswered proposal still means "no", but its five
// seconds are active game time: a stopped or paused game should not quietly
// decline a decision the player has not had running time to answer.
let offerClock = 0;
let lastOfferWall = Date.now();
setInterval(() => {
  const now = Date.now();
  const swept = pruneAlerts(ctx.state, now);
  if (!ctx.state.paused) offerClock += now - lastOfferWall;
  lastOfferWall = now;
  const answered = ctx.state.paused ? false : pruneOffers(ctx.state, offerClock, ctx.ui.inboxHeld);
  if (swept || answered) render();
}, 500);

pushAlert(ctx.state, opening(ctx.state.home), 'info');
render();
loop.start();

globalThis.__game = ctx;
