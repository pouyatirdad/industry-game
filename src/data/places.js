import { COUNTRIES, COUNTRY_IDS } from './countries.js';
import { PROVINCE_NAMES, PROVINCE_OWNER } from './worldProvinces.js';
import { PROVINCE_AT, SOURCE_COUNTRY_W, SOURCE_COUNTRY_H, WORLD_W, WORLD_H } from './world.js';

// Province and city labels below the nation level.
//
// These used to be DERIVED — a country's own land cut into blobs by k-means and
// given plausible names — because the repo had country polygons and nothing
// underneath them. It now has the real thing: `worldProvinces.js` is a raster of
// Natural Earth's admin-1 layer, so Iran has its thirty-one provinces where they
// actually are, and the guessing is gone. What is left here is the lookup, the
// per-country index, and the capital names, which no polygon layer carries.
//
// Provinces are presentation data: `state` and the save file still use country
// ownership as the only simulation boundary.
//
// Asking which province a tile is in is ONE typed-array read, and that is
// load-bearing: the map asks it per tile per edge while drawing.

const CITY_OVERRIDES = {
  US: 'Washington', CA: 'Ottawa', MX: 'Mexico City', BR: 'Brasilia',
  AR: 'Buenos Aires', CL: 'Santiago', CO: 'Bogota', PE: 'Lima',
  GB: 'London', FR: 'Paris', ES: 'Madrid', DE: 'Berlin', NL: 'Amsterdam',
  IT: 'Rome', PL: 'Warsaw', SE: 'Stockholm', NO: 'Oslo', UA: 'Kyiv',
  RU: 'Moscow', TR: 'Ankara', IR: 'Tehran', IQ: 'Baghdad', SA: 'Riyadh',
  AE: 'Abu Dhabi', EG: 'Cairo', DZ: 'Algiers', NG: 'Abuja',
  ET: 'Addis Ababa', KE: 'Nairobi', CD: 'Kinshasa', ZA: 'Pretoria',
  KZ: 'Astana', PK: 'Islamabad', IN: 'New Delhi', BD: 'Dhaka',
  CN: 'Beijing', JP: 'Tokyo', KR: 'Seoul', VN: 'Hanoi', TH: 'Bangkok',
  MY: 'Kuala Lumpur', ID: 'Jakarta', PH: 'Manila', AU: 'Canberra',
  NZ: 'Wellington', AF: 'Kabul',
  // Everywhere else the map can name. A capital is one word on a tile and it is
  // the cheapest thing on the screen that says a place is real.
  PT: 'Lisbon', IE: 'Dublin', BE: 'Brussels', LU: 'Luxembourg', CH: 'Bern',
  AT: 'Vienna', CZ: 'Prague', SK: 'Bratislava', HU: 'Budapest', RO: 'Bucharest',
  BG: 'Sofia', GR: 'Athens', RS: 'Belgrade', HR: 'Zagreb', SI: 'Ljubljana',
  BA: 'Sarajevo', MK: 'Skopje', AL: 'Tirana', ME: 'Podgorica', MD: 'Chisinau',
  BY: 'Minsk', LT: 'Vilnius', LV: 'Riga', EE: 'Tallinn', FI: 'Helsinki',
  DK: 'Copenhagen', IS: 'Reykjavik', CY: 'Nicosia', MT: 'Valletta',
  GE: 'Tbilisi', AM: 'Yerevan', AZ: 'Baku', UZ: 'Tashkent', TM: 'Ashgabat',
  KG: 'Bishkek', TJ: 'Dushanbe', MN: 'Ulaanbaatar', NP: 'Kathmandu',
  LK: 'Colombo', MM: 'Naypyidaw', KH: 'Phnom Penh', LA: 'Vientiane',
  SG: 'Singapore', BN: 'Bandar Seri Begawan', TW: 'Taipei', KP: 'Pyongyang',
  IL: 'Jerusalem', JO: 'Amman', LB: 'Beirut', SY: 'Damascus', KW: 'Kuwait City',
  QA: 'Doha', BH: 'Manama', OM: 'Muscat', YE: 'Sanaa',
  MA: 'Rabat', TN: 'Tunis', LY: 'Tripoli', SD: 'Khartoum', SS: 'Juba',
  ER: 'Asmara', DJ: 'Djibouti', SO: 'Mogadishu', UG: 'Kampala', TZ: 'Dodoma',
  RW: 'Kigali', BI: 'Gitega', ZM: 'Lusaka', ZW: 'Harare', MW: 'Lilongwe',
  MZ: 'Maputo', AO: 'Luanda', NA: 'Windhoek', BW: 'Gaborone', LS: 'Maseru',
  SZ: 'Mbabane', MG: 'Antananarivo', MU: 'Port Louis', GH: 'Accra',
  CI: 'Yamoussoukro', SN: 'Dakar', ML: 'Bamako', BF: 'Ouagadougou',
  NE: 'Niamey', TD: 'NDjamena', CM: 'Yaounde', CF: 'Bangui', GA: 'Libreville',
  CG: 'Brazzaville', GQ: 'Malabo', BJ: 'Porto-Novo', TG: 'Lome', GN: 'Conakry',
  GW: 'Bissau', SL: 'Freetown', LR: 'Monrovia', GM: 'Banjul', MR: 'Nouakchott',
  CV: 'Praia', EH: 'Laayoune',
  CU: 'Havana', JM: 'Kingston', HT: 'Port-au-Prince', DO: 'Santo Domingo',
  TT: 'Port of Spain', BS: 'Nassau', BZ: 'Belmopan', GT: 'Guatemala City',
  SV: 'San Salvador', HN: 'Tegucigalpa', NI: 'Managua', CR: 'San Jose',
  PA: 'Panama City', EC: 'Quito', BO: 'La Paz', PY: 'Asuncion',
  UY: 'Montevideo', VE: 'Caracas', GY: 'Georgetown', SR: 'Paramaribo',
  PG: 'Port Moresby', FJ: 'Suva', SB: 'Honiara', VU: 'Port Vila',
  NC: 'Noumea', PF: 'Papeete', WS: 'Apia', TO: 'Nukualofa',
  GL: 'Nuuk', BT: 'Thimphu', MV: 'Male', TL: 'Dili', PS: 'Ramallah',
  XK: 'Pristina',
};

// Where a capital is NOT simply the province of the same name. Most countries
// name the province after the city and match themselves; these few do not, and
// two of them would otherwise land the seat of government on the wrong side of
// the country (Washington the state, and Russia's bounding box straddling the
// dateline into Kaliningrad).
const CAPITAL_PROVINCE = {
  US: 'District of Columbia', RU: 'Moskva', CN: 'Beijing', DE: 'Berlin',
  IN: 'Delhi', BR: 'Distrito Federal', AU: 'Australian Capital Territory',
  CA: 'Ontario', ZA: 'Gauteng', NG: 'Federal Capital Territory', PK: 'Islamabad',
  KZ: 'Astana', MX: 'Distrito Federal', AR: 'Ciudad de Buenos Aires', TR: 'Ankara',
  EG: 'Al Qahirah', SA: 'Ar Riyad', ID: 'Jakarta Raya', JP: 'Tokyo',
};

// Every country's provinces, and where each one sits, indexed once. The raster
// holds a global province id per cell; almost every question the game asks is
// "which of THIS country's provinces", so the two views are built together.
const BOOK = (() => {
  const book = {};
  for (const id of COUNTRY_IDS) {
    book[id] = { ids: [], names: [], centres: [], bounds: bounds(), capital: 0 };
  }

  const acc = new Map();
  for (let y = 0; y < SOURCE_COUNTRY_H; y++) {
    for (let x = 0; x < SOURCE_COUNTRY_W; x++) {
      const province = PROVINCE_AT[y * SOURCE_COUNTRY_W + x];
      if (province < 0) continue;
      const owner = PROVINCE_OWNER[province];
      const entry = book[owner];
      if (!entry) continue;
      let cell = acc.get(province);
      if (!cell) { cell = { x: 0, y: 0, n: 0 }; acc.set(province, cell); }
      cell.x += x;
      cell.y += y;
      cell.n++;
      const b = entry.bounds;
      if (x < b.minX) b.minX = x;
      if (x > b.maxX) b.maxX = x;
      if (y < b.minY) b.minY = y;
      if (y > b.maxY) b.maxY = y;
      b.n++;
    }
  }

  // `local` is the inverse: a global province id to its place in its own
  // country's list. The map compares these per tile, so it has to be an integer
  // and it has to be free to look up.
  //
  // Two polygons under ONE name are one province — the admin-1 layer splits a
  // few (England has two Haltons) and drawing a boundary between two halves of
  // the same name, then writing that name on both sides, is not a map.
  const local = new Int16Array(PROVINCE_NAMES.length).fill(-1);
  const seenName = new Map();
  for (const [province, cell] of acc) {
    const owner = PROVINCE_OWNER[province];
    const entry = book[owner];
    if (!entry) continue;
    const name = PROVINCE_NAMES[province];
    const already = seenName.get(`${owner}|${name}`);
    if (already !== undefined) {
      local[province] = already;
      const centre = entry.centres[already];
      const total = centre.n + cell.n;
      centre.x = (centre.x * centre.n + cell.x) / total;
      centre.y = (centre.y * centre.n + cell.y) / total;
      centre.n = total;
      continue;
    }
    seenName.set(`${owner}|${name}`, entry.ids.length);
    local[province] = entry.ids.length;
    entry.ids.push(province);
    entry.names.push(name);
    entry.centres.push({ x: cell.x / cell.n, y: cell.y / cell.n, n: cell.n });
  }

  for (const id of COUNTRY_IDS) {
    const entry = book[id];
    if (!entry.names.length) {
      entry.names.push(`${COUNTRIES[id]?.name ?? id}`);
      entry.centres.push({ x: 0, y: 0, n: 0 });
    }
    // The province the capital stands in: named outright above, or the one
    // whose name IS the capital where a country works that way (Tehran, Kabul,
    // Bangkok), and otherwise the one nearest the middle of its own land.
    const want = CAPITAL_PROVINCE[id] ?? CITY_OVERRIDES[id];
    const named = want ? entry.names.findIndex((name) => name === want) : -1;
    entry.capital = named >= 0 ? named : nearestTo(entry.centres, middle(entry.bounds));
  }

  return { book, local };
})();

const PROVINCE_BOOK = BOOK.book;
const LOCAL_INDEX = BOOK.local;

function bounds() {
  return { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity, n: 0 };
}

function middle(b) {
  if (!Number.isFinite(b.minX)) return { x: 0, y: 0 };
  return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
}

function nearestTo(centres, point) {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < centres.length; i++) {
    const d = (centres[i].x - point.x) ** 2 + (centres[i].y - point.y) ** 2;
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

export const PROVINCE_BOUNDS = Object.fromEntries(
  COUNTRY_IDS.map((id) => [id, PROVINCE_BOOK[id].bounds]),
);

export function placeForCountry(id) {
  const entry = PROVINCE_BOOK[id];
  const names = entry?.names?.length ? entry.names : [COUNTRIES[id]?.name ?? id];
  return {
    province: names[entry?.capital ?? 0] ?? names[0],
    city: CITY_OVERRIDES[id] ?? 'Capital City',
    provinces: names,
    bounds: PROVINCE_BOUNDS[id],
  };
}

export function provinceForTile(tile) {
  if (!tile?.countryId) return null;
  const names = PROVINCE_BOOK[tile.countryId]?.names;
  if (!names?.length) return null;
  return names[provinceIndexForTile(tile)] ?? names[0];
}

// The integer behind the name, numbered within its own country. The map compares
// neighbouring tiles for every edge it draws, and comparing two numbers beats
// comparing two strings a million times a frame.
export function provinceIndexForTile(tile) {
  if (!tile?.countryId) return -1;
  return provinceIndexForPoint(tile.countryId, tile.x, tile.y,
    WORLD_W / SOURCE_COUNTRY_W, WORLD_H / SOURCE_COUNTRY_H);
}

export function provinceIndexForPoint(countryId, x, y, scaleX = 1, scaleY = 1) {
  const entry = PROVINCE_BOOK[countryId];
  if (!entry || entry.names.length <= 1) return 0;
  const sx = Math.min(SOURCE_COUNTRY_W - 1, Math.max(0, Math.floor(x / scaleX)));
  const sy = Math.min(SOURCE_COUNTRY_H - 1, Math.max(0, Math.floor(y / scaleY)));
  const province = PROVINCE_AT[sy * SOURCE_COUNTRY_W + sx];
  // The raster answers for LAND. Territorial water, and the cells generateWorld
  // hands to a country too small for the raster to see, belong to whichever of
  // that country's provinces is nearest.
  if (province >= 0 && PROVINCE_OWNER[province] === countryId) return LOCAL_INDEX[province];
  return nearestTo(entry.centres, { x: sx, y: sy });
}

export function provinceForPoint(countryId, x, y, scaleX = 1, scaleY = 1) {
  const names = PROVINCE_BOOK[countryId]?.names;
  if (!names?.length) return COUNTRIES[countryId]?.name ?? countryId;
  return names[provinceIndexForPoint(countryId, x, y, scaleX, scaleY)] ?? names[0];
}
