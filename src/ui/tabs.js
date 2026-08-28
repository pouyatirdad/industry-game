import { setAttr, setText, html } from './format.js';

// The eight views the top panel can show. `id` matches a `data-pane` in
// index.html and `ui.tab`; nothing else in the UI hardcodes the list, so adding
// a view is a new entry here plus a <section class="pane"> in the markup.
//
// Eight do not fit one row of a 352px panel, so the strip wraps (see
// panel.css) rather than shrinking every label into an ellipsis.
export const TABS = [
  { id: 'summary', label: 'Summary', title: 'Treasury, industry, resources and trade on one screen.' },
  { id: 'resources', label: 'Goods', title: 'One line a commodity: what a market pays and needs, and what you make, burn, sell and ship.' },
  { id: 'factories', label: 'Factories', title: 'Every site you own — what it takes in, turns out, and how hard it is working.' },
  { id: 'market', label: 'Market', title: 'The global exchange — every ask and bid on earth, and the clearing fund you can borrow from.' },
  { id: 'trade', label: 'Trade', title: 'Your contracts, what they are worth, and the nations you are dealing with.' },
  { id: 'diplomacy', label: 'Diplomacy', title: 'Relations, access, alliances and wars.' },
  { id: 'tech', label: 'Tech', title: 'The technology tree — what you may build, what you are studying, and what you can licence.' },
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
    btn.addEventListener('pointerenter', () => ctx.onPeekPanel());
    return btn;
  });

  // Collapsing the whole panel is the other half of "show and hide": on a small
  // screen the map is the thing worth the width.
  const collapse = html('<button type="button" class="tab tab--collapse" title="Show or hide this panel">▾</button>');
  collapse.addEventListener('click', () => ctx.onTogglePanel());
  collapse.addEventListener('pointerenter', () => ctx.onPeekPanel());

  refs.tabs.replaceChildren(...buttons, collapse);
  refs.panel.addEventListener('pointerleave', () => ctx.onHidePanel());

  refs.leftToggle.hidden = true;
  refs.leftClose.hidden = true;
  refs.homeMap.addEventListener('click', () => ctx.onCenterHome());
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
    // Anything waiting on your answer: a pact offered, a contract proposed, a
    // licence for sale. A tab with a decision on it says so.
    const waiting = (state.contractOffers ?? []).length;
    const licences = (state.techOffers ?? []).length;
    // A nation with no subject on the bench is spending nothing on research,
    // which is a decision it is worth being told you have not made.
    const idleLab = state.countries[state.home].researching ? 0 : 1;
    const listings = (state.exchange?.listings ?? []).filter((l) => l.from !== state.home).length;
    const count = id === 'factories' ? mine.length
      : id === 'trade' ? waiting
        : id === 'market' ? listings
          : id === 'diplomacy' ? activeDiplomacy(state, state.home)
            : id === 'tech' ? licences : 0;
    setText(badge, count ? String(count) : id === 'tech' && idleLab ? '!' : '');
    setAttr(badge, 'data-alarm', (id === 'factories' && troubled) || (id === 'trade' && waiting)
      || (id === 'tech' && (licences || idleLab)) ? 'true' : null);
  }

  setAttr(refs.panel, 'data-open', String(ui.panelOpen));
  setAttr(refs.layout, 'data-left', String(ui.leftOpen));
  setAttr(refs.layout, 'data-paused', String(state.paused));
  for (const pane of refs.panes.children) {
    setAttr(pane, 'data-active', String(pane.dataset.pane === ui.tab));
  }
}

function activeDiplomacy(state, home) {
  return Object.values(state.diplomacy?.relations?.[home] ?? {})
    .filter((relation) => relation !== 'neutral').length;
}
