import { CENTROIDS } from './geography.js';
import { SOURCE_COUNTRY_W, SOURCE_COUNTRY_H } from './world.js';

// Human map labels below the nation level. The game has country polygons, not
// administrative boundary data, so these are derived from each country's map
// position: continent-scale region, quadrant-sized province, and a stable city
// label at the country's centre.

const REGION_BANDS = [
  { id: 'north-america', name: 'North America', lon: [-170, -50], lat: [7, 84] },
  { id: 'south-america', name: 'South America', lon: [-90, -30], lat: [-56, 13] },
  { id: 'europe', name: 'Europe', lon: [-25, 45], lat: [35, 72] },
  { id: 'africa', name: 'Africa', lon: [-25, 55], lat: [-36, 37] },
  { id: 'middle-east', name: 'Middle East', lon: [30, 65], lat: [12, 42] },
  { id: 'central-asia', name: 'Central Asia', lon: [45, 90], lat: [35, 56] },
  { id: 'south-asia', name: 'South Asia', lon: [60, 95], lat: [5, 36] },
  { id: 'east-asia', name: 'East Asia', lon: [95, 150], lat: [18, 55] },
  { id: 'southeast-asia', name: 'Southeast Asia', lon: [95, 155], lat: [-12, 23] },
  { id: 'oceania', name: 'Oceania', lon: [110, 180], lat: [-50, 5] },
  { id: 'pacific', name: 'Pacific Islands', lon: [-180, -120], lat: [-35, 35] },
  { id: 'polar', name: 'Polar Territories', lon: [-180, 180], lat: [-90, -50] },
];

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
  NZ: 'Wellington',
};

function lonLat(id) {
  const centre = CENTROIDS[id] ?? { x: SOURCE_COUNTRY_W / 2, y: SOURCE_COUNTRY_H / 2 };
  return {
    lon: -180 + (centre.x + 0.5) * (360 / SOURCE_COUNTRY_W),
    lat: 90 - (centre.y + 0.5) * (180 / SOURCE_COUNTRY_H),
  };
}

function inRange(value, [min, max]) {
  return value >= min && value <= max;
}

function regionFor(lon, lat) {
  const hit = REGION_BANDS.find((row) => inRange(lon, row.lon) && inRange(lat, row.lat));
  if (hit) return hit;
  if (lat > 50) return { id: 'northlands', name: 'Northern Lands' };
  if (lat < -45) return { id: 'southern-ocean', name: 'Southern Ocean' };
  return { id: lon < 0 ? 'atlantic' : 'indian-ocean', name: lon < 0 ? 'Atlantic Islands' : 'Indian Ocean' };
}

function compass(latPart, lonPart) {
  if (latPart === 'central' && lonPart === 'central') return 'Central';
  if (latPart === 'central') return title(lonPart);
  if (lonPart === 'central') return title(latPart);
  return `${title(latPart)} ${title(lonPart)}`;
}

function title(word) {
  return word[0].toUpperCase() + word.slice(1);
}

function provinceFor(lon, lat, region) {
  const lonMid = (region.lon?.[0] ?? -180) + (((region.lon?.[1] ?? 180) - (region.lon?.[0] ?? -180)) / 2);
  const latMid = (region.lat?.[0] ?? -90) + (((region.lat?.[1] ?? 90) - (region.lat?.[0] ?? -90)) / 2);
  const lonSpan = Math.max(1, (region.lon?.[1] ?? 180) - (region.lon?.[0] ?? -180));
  const latSpan = Math.max(1, (region.lat?.[1] ?? 90) - (region.lat?.[0] ?? -90));
  const lonPart = Math.abs(lon - lonMid) < lonSpan * 0.18 ? 'central' : lon < lonMid ? 'western' : 'eastern';
  const latPart = Math.abs(lat - latMid) < latSpan * 0.18 ? 'central' : lat < latMid ? 'southern' : 'northern';
  return `${compass(latPart, lonPart)} ${region.name}`;
}

function cityFor(id, region) {
  return CITY_OVERRIDES[id] ?? `${region.name} Centre`;
}

export function placeForCountry(id) {
  const { lon, lat } = lonLat(id);
  const region = regionFor(lon, lat);
  return {
    region: region.name,
    province: provinceFor(lon, lat, region),
    city: cityFor(id, region),
    lon,
    lat,
  };
}
