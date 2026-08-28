import { COUNTRIES, COUNTRY_IDS } from '../data/countries.js';
import { RELATIONS, relationOf, terroristForce } from '../systems/military.js';
import { setAttr, setText, html } from './format.js';

export function mountDiplomacy(refs, ctx) {
  refs.diplomacyList.replaceChildren(...COUNTRY_IDS
    .filter((id) => id !== ctx.state.home)
    .map((id) => {
      const row = html(`
        <div class="diplomacy__row" data-country="${id}">
          <span class="diplomacy__name"></span>
          <select class="diplomacy__relation"></select>
        </div>`);
      const select = row.querySelector('.diplomacy__relation');
      select.replaceChildren(...RELATIONS.map((relation) => {
        const opt = document.createElement('option');
        opt.value = relation;
        opt.textContent = label(relation);
        return opt;
      }));
      select.addEventListener('change', () => ctx.onRelation(id, select.value));
      return row;
    }));
}

export function updateDiplomacy(refs, ctx) {
  const { state } = ctx;
  const active = state.terrorism?.active;
  const force = terroristForce(active);
  setText(refs.diplomacyHead, active
    ? `${active.name} active in ${COUNTRIES[active.countryId]?.name ?? active.countryId}`
      + ` · ${force.infantry} infantry, ${force.armoredCar} armoured car${force.armoredCar === 1 ? '' : 's'}`
      + ` · ${active.destroyed ?? 0} site${(active.destroyed ?? 0) === 1 ? '' : 's'} destroyed`
    : `No terrorist presence · next risk at tick ${state.terrorism?.nextSpawnTick ?? 200}`);

  for (const row of refs.diplomacyList.children) {
    const id = row.dataset.country;
    const relation = relationOf(state, state.home, id);
    setText(row.querySelector('.diplomacy__name'), COUNTRIES[id].name);
    setAttr(row, 'data-relation', relation);
    const select = row.querySelector('.diplomacy__relation');
    if (select.value !== relation) select.value = relation;
  }
}

function label(relation) {
  return relation === 'alliance' ? 'Alliance'
    : relation === 'access' ? 'Military access'
      : relation === 'war' ? 'War'
        : 'Neutral';
}
