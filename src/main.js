import { createInitialState, createUiState, saveState, loadState, clearSave, pushAlert,
  pruneAlerts, dismissAlert, buildingById } from './core/state.js';
import { createLoop } from './core/loop.js';
import { CONFIG } from './core/config.js';
import { runTick } from './systems/index.js';
import { build, canBuild, demolish, openPact, acceptOffer, declineOffer, toggleExport, toggleImport,
  setSpeed, togglePause } from './actions.js';
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
  // its terms and its pact button in the inspector. It also swings the market
  // panel over, since "what does this country pay" is the next question.
  onFocusCountry(countryId) {
    // Empty ground on purpose: land in the inspector for a nation, so you get
    // its terms and its pact button rather than whatever happens to be built on
    // the first tile it owns.
    const tile = ctx.state.tiles.find((t) => t.countryId === countryId
      && t.terrain === 'plain' && t.buildingId == null)
      ?? ctx.state.tiles.find((t) => t.countryId === countryId && t.buildingId == null);
    if (tile) ctx.ui.selectedTileId = tile.id;
    ctx.ui.marketCountry = countryId;
    renderer.refs.marketCountry.value = countryId;
    render();
  },

  onOpenPact(countryId) {
    openPact(ctx.state, countryId);
    render();
  },

  // A pact somebody else asked for. Accepting pays you, so the answer is worth
  // thinking about rather than automatic — and either answer clears it off the
  // table.
  onAcceptOffer(countryId) { acceptOffer(ctx.state, countryId); render(); },
  onDeclineOffer(countryId) { declineOffer(ctx.state, countryId); render(); },

  onZoom(index) { ctx.ui.zoom = index; render(); },

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

  onToggleLeft() { ctx.ui.leftOpen = !ctx.ui.leftOpen; render(); },

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

  onToggleExport(commodityId) { toggleExport(ctx.state, commodityId); render(); },
  onToggleImport(commodityId) { toggleImport(ctx.state, commodityId); render(); },
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
  renderer.refs.marketCountry.value = ctx.ui.marketCountry;
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
setInterval(() => {
  if (pruneAlerts(ctx.state)) render();
}, 500);

pushAlert(ctx.state, opening(ctx.state.home), 'info');
render();
loop.start();

globalThis.__game = ctx;
