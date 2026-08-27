import { pushAlert, siteWages, allOwners, isPlayer } from '../core/state.js';

// Payroll is settled per nation. Every one of the forty-six — you included —
// meets its own wage bill or idles its own sites; nobody is exempt and nobody
// subsidises anybody. Only your own insolvency is worth an alert.
export function payWages(state) {
  const bill = new Map();
  for (const b of state.buildings) {
    bill.set(b.owner, (bill.get(b.owner) ?? 0) + siteWages(b));
  }

  for (const owner of allOwners(state)) {
    const wages = bill.get(owner.id) ?? 0;
    owner.cash -= wages;
    owner.report.wages = wages;

    const solvent = owner.cash >= 0;
    if (isPlayer(state, owner.id)) {
      if (!solvent && owner.solvent) pushAlert(state, 'Payroll missed — every site idles until the treasury recovers.', 'danger');
      if (solvent && !owner.solvent) pushAlert(state, 'Payroll met — sites restarting.', 'good');
    }
    owner.solvent = solvent;
  }

  for (const b of state.buildings) {
    b.staffed = Boolean(state.countries[b.owner]?.solvent);
  }
}
