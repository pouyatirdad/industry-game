const grouped = new Intl.NumberFormat('en-US');

export function num(value) {
  return grouped.format(Math.round(value));
}

export function money(value) {
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  return `${sign}$${grouped.format(Math.round(abs))}`;
}

// A price short enough to sit next to a name in half a panel: $18k, $1.2M.
// The build menu is thirty-four industries and they all have to be on screen at
// once, so four digits of precision are worth less than the row they cost.
export function moneyShort(value) {
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
  if (abs >= 1_000) return `${sign}$${Math.round(abs / 1000)}k`;
  return `${sign}$${Math.round(abs)}`;
}

export function price(value) {
  return `$${value.toFixed(2)}`;
}

// Table figures, kept to a width that does not squeeze the commodity beside
// them into two lines. A dear commodity does not need its cents, and a warehouse
// holding twelve thousand tonnes does not need its units.
export function priceShort(value) {
  if (value >= 1000) return `$${grouped.format(Math.round(value))}`;
  if (value >= 100) return `$${value.toFixed(0)}`;
  return `$${value.toFixed(1)}`;
}

export function qtyShort(value) {
  const abs = Math.abs(value);
  if (abs >= 10_000) return `${Math.round(value / 1000)}k`;
  // Under ten, the fraction IS the figure: half a unit of aluminium a tick is a
  // real rate, and rounding it to "0" reads as nothing happening at all.
  if (abs < 10 && !Number.isInteger(value)) return value.toFixed(1);
  return grouped.format(Math.round(value));
}

export function signed(value) {
  return `${value >= 0 ? '+' : '-'}${money(Math.abs(value)).replace('-', '')}`;
}

export function setText(el, value) {
  if (!el) return;
  const next = String(value);
  if (el.textContent !== next) el.textContent = next;
}

export function setAttr(el, name, value) {
  if (!el) return;
  const next = value == null ? null : String(value);
  if (next === null) { if (el.hasAttribute(name)) el.removeAttribute(name); return; }
  if (el.getAttribute(name) !== next) el.setAttribute(name, next);
}

export function setToggle(el, name, on) {
  if (!el) return;
  if (el.classList.contains(name) !== on) el.classList.toggle(name, on);
}

export function html(markup) {
  const tpl = document.createElement('template');
  tpl.innerHTML = markup.trim();
  return tpl.content.firstElementChild;
}

export function pct(value) {
  return `${Math.round(value * 100)}%`;
}
