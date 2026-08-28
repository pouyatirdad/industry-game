import { createInitialState, createUiState, saveState, loadState, clearSave, pushAlert,
  pruneAlerts, pruneOffers, dismissAlert, buildingById } from './core/state.js';
import { createLoop } from './core/loop.js';
import { CONFIG } from './core/config.js';
import { runTick } from './systems/index.js';
import { build, canBuild, demolish, toggleExport, toggleImport,
  setAllExports, setAllImports, setSpeed, togglePause, setResearch, setResearchShare, buyTech, acceptTechOffer, declineTechOffer,
  proposeContract, acceptContractOffer, declineContractOffer, cancelContract,
  postListing, cancelListing, take, takeLoan, repayLoan } from './actions.js';
import { suggestListing } from './systems/exchange.js';
import { sellersOf } from './systems/research.js';
import { COUNTRIES } from './data/countries.js';
import { createRenderer } from './ui/render.js';
import { TABS } from './ui/tabs.js';

const ctx = {
  state: createInitialState(),
  ui: createUiState(),

  onTileClick(tileId) {
    const tile = ctx.state.tiles[tileId];
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
    // so the panel answers it — but only then, or placing a row of mines would
    // yank the panel away from the list you were reading.
    if (!ctx.ui.tool) ctx.ui.tab = 'selected';
    render();
  },

  onTileRightClick(tileId) {
    demolish(ctx.state, ctx.state.tiles[tileId]);
    render();
  },

  onSelectTool(type) {
    ctx.ui.tool = ctx.ui.tool === type ? null : type;
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
  onPeekPanel() { if (!ctx.ui.panelOpen) { ctx.ui.panelOpen = true; render(); } },

  onToggleLeft() { ctx.ui.leftOpen = !ctx.ui.leftOpen; render(); },
  onPeekLeft() { if (!ctx.ui.leftOpen) { ctx.ui.leftOpen = true; render(); } },

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
  const { zoom, tab, panelOpen, leftOpen, goodsView, rankSort } = ctx.ui;
  ctx.state = next;
  ctx.state.paused = true;
  ctx.ui = createUiState(next.home);
  // View preferences, not part of the game being replaced.
  ctx.ui.zoom = zoom;
  ctx.ui.tab = tab;
  ctx.ui.panelOpen = panelOpen;
  ctx.ui.leftOpen = leftOpen;
  ctx.ui.goodsView = goodsView;
  ctx.ui.rankSort = rankSort;
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
  if (event.key === 'Escape') { ctx.ui.tool = null; render(); }
  if (event.key === 'b' || event.key === 'B') ctx.onToggleLeft();
  if (event.key === '+' || event.key === '=') ctx.onZoom(Math.min(CONFIG.zoomLevels.length - 1, ctx.ui.zoom + 1));
  if (event.key === '-' || event.key === '_') ctx.onZoom(Math.max(0, ctx.ui.zoom - 1));
  // 1..5 pick a panel, in the order the tab strip shows them.
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
