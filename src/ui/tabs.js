import { setAttr, setText, html } from './format.js';

// The seven views the side panel can show. `id` matches a `data-pane` in
// index.html and `ui.tab`; nothing else in the UI hardcodes the list, so adding
// a view is a new entry here plus a <section class="pane"> in the markup.
//
// Seven no longer fit one row of a 352px panel, so the strip wraps (see
// panel.css) rather than shrinking every label into an ellipsis.
export const TABS = [
  { id: 'summary', label: 'Summary', title: 'Treasury, industry, resources and trade on one screen.' },
  { id: 'resources', label: 'Prices', title: 'Prices, what a nation wants per tick, and what you hold.' },
  { id: 'factories', label: 'Factories', title: 'Every site you own — what it takes in, turns out, and how hard it is working.' },
  { id: 'goods', label: 'Goods', title: 'Every commodity you make, burn, sell, ship out and buy in.' },
  { id: 'trade', label: 'Trade', title: 'Deals, what they are worth, and the nations you can strike them with.' },
  { id: 'ranks', label: 'Ranks', title: 'All forty-six nations scored against each other.' },
  { id: 'selected', label: 'Selected', title: 'Whatever you last clicked on the map.' },
];

export function mountTabs(refs, ctx) {
  const buttons = TABS.map((tab) => {
    const btn = html(`
      <button type="button" class="tab" role="tab" id="tab-${tab.id}" data-tab="${tab.id}">
        <span class="tab__label">${tab.label}</span><span class="tab__badge"></span>
      </button>`);
    btn.title = `${tab.title} Click it again to fold the panel away.`;
    btn.addEventListener('click', () => ctx.onSelectTab(tab.id));
    return btn;
  });

  // Collapsing the whole panel is the other half of "show and hide": on a small
  // screen the map is the thing worth the width.
  const collapse = html('<button type="button" class="tab tab--collapse" title="Show or hide this panel">▾</button>');
  collapse.addEventListener('click', () => ctx.onTogglePanel());

  refs.tabs.replaceChildren(...buttons, collapse);

  // The left panel is a modal over the map too, so it needs the same pair of
  // controls: a close on the panel and a handle that brings it back.
  refs.leftClose.addEventListener('click', () => ctx.onToggleLeft());
  refs.leftToggle.addEventListener('click', () => ctx.onToggleLeft());
}

// Both floating panels, and the badge that says whether the factory list is
// worth opening.
export function updatePanels(refs, ctx) {
  const { state, ui } = ctx;

  const mine = state.buildings.filter((b) => b.owner === state.home);
  const troubled = mine.filter((b) => b.status === 'starved' || b.status === 'unstaffed' || b.status === 'blocked').length;

  for (const btn of refs.tabs.children) {
    const id = btn.dataset.tab;
    if (!id) {
      setText(btn, ui.panelOpen ? '▾' : '▸');
      continue;
    }
    const active = id === ui.tab;
    setAttr(btn, 'data-active', active ? 'true' : null);
    setAttr(btn, 'aria-selected', String(active));
    // The badge is the reason to look: how many sites you own, whether any of
    // them is in trouble, and whether a nation is waiting on your answer.
    const badge = btn.querySelector('.tab__badge');
    const offers = (state.offers ?? []).length;
    const count = id === 'factories' ? mine.length : id === 'trade' ? offers : 0;
    setText(badge, count ? String(count) : '');
    setAttr(badge, 'data-alarm', (id === 'factories' && troubled) || (id === 'trade' && offers) ? 'true' : null);
  }

  setAttr(refs.panel, 'data-open', String(ui.panelOpen));
  setAttr(refs.layout, 'data-left', String(ui.leftOpen));
  for (const pane of refs.panes.children) {
    setAttr(pane, 'data-active', String(pane.dataset.pane === ui.tab));
  }
}
