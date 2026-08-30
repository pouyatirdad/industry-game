import { COUNTRIES } from '../data/countries.js';
import { terroristForce, ticksToTerror } from '../systems/military.js';
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
  // Before a cell exists there is a WARNING: the ground has been chosen and the
  // clock is running. It is the same card in the same place — a standing
  // situation, not news — because "a cell is forming in Chad, 84 ticks out" and
  // "a cell is in Chad" are two states of one thing, and putting them in two
  // different places would make the first easy to miss.
  const warning = !active ? ctx.state.terrorism?.warning : null;
  const left = warning ? ticksToTerror(ctx.state) : null;
  const sig = active
    ? [active.id, active.countryId, force.infantry, force.armoredCar, active.destroyed ?? 0].join('|')
    : warning ? `warn|${warning.countryId}|${left}` : '';
  if (host.dataset.sig === sig) return;
  host.dataset.sig = sig;

  if (!active && !warning) {
    host.replaceChildren();
    host.hidden = true;
    return;
  }
  if (warning) {
    host.hidden = false;
    host.replaceChildren(warningCard(ctx, warning, left));
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

// The countdown card. It names the country the cell will appear in and the
// ticks remaining, and clicking it puts that ground in the middle of the map —
// so the whole point of the warning, which is that you can march an army there
// before anything happens, is one click away.
function warningCard(ctx, warning, left) {
  const where = COUNTRIES[warning.countryId]?.name ?? warning.countryId;
  const mine = warning.countryId === ctx.state.home;
  const card = html(`
    <button type="button" class="terror terror--warning" data-home="${mine}">
      <span class="terror__mark">⏳</span>
      <span class="terror__body">
        <b class="terror__name">${warning.name} forming &middot; ${num(left)} tick${left === 1 ? '' : 's'}</b>
        <span class="terror__where">${mine ? 'In YOUR territory' : where} &middot; (${warning.x}, ${warning.y})</span>
        <span class="terror__force">${mine
          ? 'March a formation onto that ground before it appears and you can clear it the tick it does.'
          : 'Not your soil — you would need access, an alliance or a war to reach it.'}</span>
        <span class="terror__hint">Click to jump to the ground</span>
      </span>
    </button>`);
  card.addEventListener('click', () => ctx.onFocusTerror());
  return card;
}
