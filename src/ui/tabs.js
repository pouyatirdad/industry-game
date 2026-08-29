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
  { id: 'events', label: 'News', title: 'What every government on earth has just done — pacts, wars, contracts, armies and terrorism. Kept for 50 ticks.' },
  { id: 'tech', label: 'Tech', title: 'The technology tree — what you may build, what you are studying, and what you can licence.' },
  { id: 'ranks', label: 'Ranks', title: 'All forty-six nations scored against each other.' },
  { id: 'selected', label: 'Selected', title: 'Whatever you last clicked on the map.' },
];

export function mountTabs(refs, ctx) {
  const buttons = TABS.map((tab, index) => {
    const btn = html(`
      <button type="button" class="tab" role="tab" id="tab-${tab.id}" data-tab="${tab.id}">
        <span class="tab__key">${index + 1}</span>
        <span class="tab__label">${tab.label}</span><span class="tab__badge"></span>
      </button>`);
    // The number on the tab is the key that opens it. A nine-view panel is one
    // you move around in constantly, and reaching for the mouse every time is
    // what made it feel heavy.
    btn.title = `${tab.title}\nPress ${index + 1} to open it, or click the tab again to fold the panel away.`;
    btn.addEventListener('click', () => ctx.onSelectTab(tab.id));
    return btn;
  });

  // Two controls, not one, and they answer two different questions: how TALL
  // should the panel be, and should it be here at all. The tall state is what
  // makes the Ranks table and the tech tree readable without scrolling a pane
  // that was sized for a summary card.
  const grow = html('<button type="button" class="tab tab--grow" title="Make this panel taller (T) — the ranks table and the tech tree are worth the height">⤢</button>');
  grow.addEventListener('click', () => ctx.onTogglePanelHeight());

  const collapse = html('<button type="button" class="tab tab--collapse" title="Show or hide this panel">▾</button>');
  collapse.addEventListener('click', () => ctx.onTogglePanel());

  refs.tabs.replaceChildren(...buttons, grow, collapse);

  // THE PANEL IS OPENED AND CLOSED BY CLICKING, and by nothing else.
  //
  // It used to unfold on hover and fold again the moment the pointer left it,
  // which made it impossible to keep open while doing anything: reading a table
  // and reaching for the map dismissed the table. So there are no pointer
  // listeners here at all — a tab click opens it, the active tab or the collapse
  // control closes it, and a click on the MAP closes it (`onTileClick`), which
  // is the gesture that means "I am done reading, I want the world back".

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
      // The two chrome buttons: one says how tall, the other says whether at
      // all, and each shows the state it is currently in.
      if (btn.classList.contains('tab--grow')) {
        setText(btn, ui.panelTall ? '⤡' : '⤢');
        setAttr(btn, 'data-active', ui.panelTall ? 'true' : null);
      } else {
        setText(btn, ui.panelOpen ? '▾' : '▸');
      }
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
    // A pact put to you, or a war counting down, is the most urgent thing the
    // strip can carry — so Diplomacy badges what is HAPPENING rather than how
    // many pacts you happen to hold.
    const pacts = (state.diplomacy?.proposals ?? []).filter((p) => p.to === state.home).length;
    const looming = (state.diplomacy?.ultimatums ?? [])
      .filter((u) => u.from === state.home || u.to === state.home).length;
    const wars = Object.values(state.diplomacy?.relations?.[state.home] ?? {})
      .filter((relation) => relation === 'war').length;
    const count = id === 'factories' ? mine.length
      : id === 'trade' ? waiting
        : id === 'market' ? listings
          : id === 'diplomacy' ? (pacts + looming + wars || activeDiplomacy(state, state.home))
            : id === 'tech' ? licences : 0;
    setText(badge, count ? String(count) : id === 'tech' && idleLab ? '!' : '');
    setAttr(badge, 'data-alarm', (id === 'factories' && troubled) || (id === 'trade' && waiting)
      || (id === 'diplomacy' && (pacts || looming || wars))
      || (id === 'tech' && (licences || idleLab)) ? 'true' : null);
    setAttr(btn, 'data-urgent', id === 'diplomacy' && (looming || wars) ? 'true' : null);
  }

  setAttr(refs.panel, 'data-open', String(ui.panelOpen));
  setAttr(refs.panel, 'data-tall', String(Boolean(ui.panelTall)));
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
