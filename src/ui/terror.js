import { COUNTRIES } from '../data/countries.js';
import { terroristForce } from '../systems/military.js';
import { html, num } from './format.js';

// The red card. There is only ever ONE terrorist presence in the world, so this
// is one card rather than a list — and unlike an alert it does not expire,
// because it is not news, it is a standing situation. Clicking it is how you
// find the cell: it puts the camp in the middle of the map.
//
// It floats over everything for the same reason the inbox does, and it diffs on
// a signature string like the rest of the panel: it is repainted on every
// render whether the information dock is open or not.
export function updateTerror(host, ctx) {
  const active = ctx.state.terrorism?.active;
  const force = terroristForce(active);
  const sig = active
    ? [active.id, active.countryId, force.infantry, force.armoredCar, active.destroyed ?? 0].join('|')
    : '';
  if (host.dataset.sig === sig) return;
  host.dataset.sig = sig;

  if (!active) {
    host.replaceChildren();
    host.hidden = true;
    return;
  }
  host.hidden = false;
  const where = COUNTRIES[active.countryId]?.name ?? active.countryId;
  const mine = active.countryId === ctx.state.home;
  const wrecked = active.destroyed ?? 0;
  const card = html(`
    <button type="button" class="terror" data-home="${mine}">
      <span class="terror__mark">⚠</span>
      <span class="terror__body">
        <b class="terror__name">${active.name}</b>
        <span class="terror__where">${mine ? 'In your own territory' : where} &middot; (${active.x}, ${active.y})</span>
        <span class="terror__force">${num(force.infantry)} infantry &middot; ${num(force.armoredCar)} armoured car${force.armoredCar === 1 ? '' : 's'}${wrecked ? ` &middot; ${num(wrecked)} site${wrecked === 1 ? '' : 's'} destroyed` : ''}</span>
        <span class="terror__hint">Click to jump to it</span>
      </span>
    </button>`);
  card.addEventListener('click', () => ctx.onFocusTerror());
  host.replaceChildren(card);
}
