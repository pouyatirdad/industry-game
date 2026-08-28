import { COUNTRY_IDS } from './countries.js';
import { SOURCE_COUNTRY_ROWS, SOURCE_COUNTRY_W, SOURCE_COUNTRY_H, WORLD_W, WORLD_H } from './world.js';

// Province and city labels below the nation level. The map has country
// polygons but no real administrative boundary polygons, so provinces are
// derived inside each country's own footprint. They are presentation data only:
// state and saves keep using country ownership as the simulation boundary.

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
};

function sourceBounds() {
  const out = {};
  for (const id of COUNTRY_IDS) {
    out[id] = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity, n: 0 };
  }
  for (let y = 0; y < SOURCE_COUNTRY_H; y++) {
    const row = SOURCE_COUNTRY_ROWS[y];
    for (let x = 0; x < SOURCE_COUNTRY_W; x++) {
      const id = row[x];
      if (!out[id]) continue;
      const b = out[id];
      b.minX = Math.min(b.minX, x);
      b.minY = Math.min(b.minY, y);
      b.maxX = Math.max(b.maxX, x);
      b.maxY = Math.max(b.maxY, y);
      b.n++;
    }
  }
  return out;
}

export const PROVINCE_BOUNDS = sourceBounds();

export function placeForCountry(id) {
  return {
    province: 'Central Province',
    city: CITY_OVERRIDES[id] ?? 'Capital City',
    provinces: provinceNames(id),
    bounds: PROVINCE_BOUNDS[id],
  };
}

export function provinceForTile(tile) {
  if (!tile?.countryId) return null;
  return provinceForPoint(tile.countryId, tile.x, tile.y, WORLD_W / SOURCE_COUNTRY_W, WORLD_H / SOURCE_COUNTRY_H);
}

export function provinceForPoint(countryId, x, y, scaleX = 1, scaleY = 1) {
  const b = PROVINCE_BOUNDS[countryId];
  if (!b || !Number.isFinite(b.minX) || b.n < 16) return 'Central Province';
  const sx = x / scaleX;
  const sy = y / scaleY;
  const wide = b.maxX - b.minX >= 4;
  const tall = b.maxY - b.minY >= 4;
  if (!wide && !tall) return 'Central Province';
  const west = sx <= (b.minX + b.maxX) / 2;
  const north = sy <= (b.minY + b.maxY) / 2;
  if (!wide) return north ? 'Northern Province' : 'Southern Province';
  if (!tall) return west ? 'Western Province' : 'Eastern Province';
  return `${north ? 'North' : 'South'}${west ? 'western' : 'eastern'} Province`;
}

function provinceNames(id) {
  const b = PROVINCE_BOUNDS[id];
  if (!b || !Number.isFinite(b.minX) || b.n < 16) return ['Central Province'];
  const wide = b.maxX - b.minX >= 4;
  const tall = b.maxY - b.minY >= 4;
  if (!wide && !tall) return ['Central Province'];
  if (!wide) return ['Northern Province', 'Southern Province'];
  if (!tall) return ['Western Province', 'Eastern Province'];
  return [
    'Northwestern Province',
    'Northeastern Province',
    'Southwestern Province',
    'Southeastern Province',
  ];
}
