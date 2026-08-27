import { mountMap, updateMap, centerMapOn } from './map.js';
import { mountDashboard, updateDashboard, updateResources, updateTrade, updateAlerts } from './dashboard.js';
import { mountTabs, updatePanels } from './tabs.js';
import { updateSummary } from './summary.js';
import { updateFactories } from './factories.js';
import { mountGoods, updateGoods } from './goods.js';
import { mountRanks, updateRanks } from './ranks.js';
import { updateInspector } from './inspector.js';

const ID_MAP = {
  map: 'map', alerts: 'alerts', inspector: 'inspector', buildMenu: 'build-menu',
  countries: 'country-list', homeSelect: 'home-select', zoom: 'zoom-buttons',
  marketCountry: 'market-country', marketNote: 'market-note', flows: 'trade-flows',
  tradeHead: 'trade-head', offers: 'pact-offers', tradeGoods: 'trade-goods',
  goodsView: 'goods-view', goodsBody: 'goods-body', goodsNote: 'goods-note',
  ranksHead: 'ranks-head', ranksCols: 'ranks-cols', ranksBody: 'ranks-body',
  nationName: 'nation-name', nationCard: 'nation-card',
  market: 'market-body', speeds: 'speed-buttons', cash: 'stat-cash', net: 'stat-net',
  wages: 'stat-wages', trade: 'stat-trade', supply: 'stat-supply', demand: 'stat-demand',
  tick: 'stat-tick', pause: 'btn-pause', save: 'btn-save',
  load: 'btn-load', reset: 'btn-reset',
  panel: 'side-panel', tabs: 'tabs', panes: 'panes', summary: 'summary-card',
  factoryHead: 'factory-head', factoryList: 'factory-list',
  layout: 'layout', leftPanel: 'left-panel', leftToggle: 'btn-left', leftClose: 'btn-left-close',
};

// Only the tab on screen is repainted. Everything outside the panel — the
// topbar, the build menu, the map and the alerts — is always live, because it
// is always visible.
const PANES = {
  summary: (refs, ctx) => updateSummary(refs.summary, ctx),
  resources: updateResources,
  factories: updateFactories,
  goods: updateGoods,
  trade: updateTrade,
  ranks: updateRanks,
  selected: (refs, ctx) => updateInspector(refs.inspector, ctx),
};

export function createRenderer(ctx) {
  const refs = {};
  for (const [key, id] of Object.entries(ID_MAP)) {
    const el = document.getElementById(id);
    if (!el) throw new Error(`Missing DOM node #${id} required by the renderer.`);
    refs[key] = el;
  }

  let mapView = mountMap(refs.map, ctx);
  mountDashboard(refs, ctx);
  mountTabs(refs, ctx);
  // Both of these are fixed lists — twenty-one commodities, forty-six nations —
  // so their rows are built once here and only their figures are written each
  // tick, exactly as the market table and the factory list work.
  mountGoods(refs, ctx);
  mountRanks(refs, ctx);

  return {
    refs,
    remountMap() { mapView.dispose?.(); mapView = mountMap(refs.map, ctx); },
    centerOn(x, y) { centerMapOn(refs.map, mapView, ctx, x, y); },
    render() {
      updateDashboard(refs, ctx);
      updatePanels(refs, ctx);
      updateMap(refs.map, mapView, ctx);
      updateAlerts(refs.alerts, ctx);
      if (!ctx.ui.panelOpen) return;
      (PANES[ctx.ui.tab] ?? PANES.summary)(refs, ctx);
    },
  };
}
