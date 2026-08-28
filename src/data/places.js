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

const PROVINCES = {
  AF: ['Badakhshan', 'Badghis', 'Baghlan', 'Balkh', 'Bamyan', 'Daykundi', 'Farah', 'Faryab', 'Ghazni', 'Ghor', 'Helmand', 'Herat', 'Jowzjan', 'Kabul', 'Kandahar', 'Kapisa', 'Khost', 'Kunar', 'Kunduz', 'Laghman', 'Logar', 'Nangarhar', 'Nimruz', 'Nuristan', 'Paktia', 'Paktika', 'Panjshir', 'Parwan', 'Samangan', 'Sar-e Pol', 'Takhar', 'Uruzgan', 'Wardak', 'Zabul'],
  AR: ['Buenos Aires', 'Cordoba', 'Santa Fe', 'Mendoza', 'Tucuman', 'Salta'],
  AU: ['New South Wales', 'Victoria', 'Queensland', 'Western Australia', 'South Australia', 'Tasmania'],
  BD: ['Dhaka', 'Chittagong', 'Rajshahi', 'Khulna', 'Sylhet', 'Barisal'],
  BR: ['Sao Paulo', 'Rio de Janeiro', 'Minas Gerais', 'Bahia', 'Parana', 'Rio Grande do Sul'],
  CA: ['Ontario', 'Quebec', 'British Columbia', 'Alberta', 'Manitoba', 'Saskatchewan'],
  CD: ['Kinshasa', 'Kongo Central', 'Katanga', 'Kasai', 'Kivu', 'Equateur'],
  CL: ['Santiago Metropolitan', 'Valparaiso', 'Biobio', 'Antofagasta', 'Atacama', 'Los Lagos'],
  CN: ['Beijing', 'Guangdong', 'Sichuan', 'Yunnan', 'Shandong', 'Xinjiang'],
  CO: ['Bogota', 'Antioquia', 'Cundinamarca', 'Valle del Cauca', 'Santander', 'Bolivar'],
  DE: ['Bavaria', 'North Rhine-Westphalia', 'Baden-Wurttemberg', 'Lower Saxony', 'Hesse', 'Saxony'],
  DZ: ['Algiers', 'Oran', 'Constantine', 'Tamanrasset', 'Adrar', 'Setif'],
  EG: ['Cairo', 'Alexandria', 'Giza', 'Suez', 'Aswan', 'Luxor'],
  ES: ['Andalusia', 'Aragon', 'Catalonia', 'Castile and Leon', 'Madrid', 'Valencia'],
  ET: ['Oromia', 'Amhara', 'Tigray', 'Somali', 'Sidama', 'Addis Ababa'],
  FR: ['Ile-de-France', 'Normandy', 'Brittany', 'Occitanie', 'Provence-Alpes-Cote d Azur', 'Grand Est'],
  GB: ['England', 'Scotland', 'Wales', 'Northern Ireland'],
  ID: ['Java', 'Sumatra', 'Kalimantan', 'Sulawesi', 'Papua', 'Bali'],
  IN: ['Uttar Pradesh', 'Maharashtra', 'Gujarat', 'Tamil Nadu', 'West Bengal', 'Rajasthan'],
  IR: ['Tehran', 'Isfahan', 'Fars', 'Khuzestan', 'Kerman', 'Khorasan Razavi'],
  IQ: ['Baghdad', 'Basra', 'Nineveh', 'Anbar', 'Erbil', 'Kirkuk'],
  IT: ['Lombardy', 'Lazio', 'Veneto', 'Sicily', 'Piedmont', 'Tuscany'],
  JP: ['Tokyo', 'Osaka', 'Hokkaido', 'Aichi', 'Fukuoka', 'Okinawa'],
  KE: ['Nairobi', 'Mombasa', 'Kisumu', 'Nakuru', 'Turkana', 'Uasin Gishu'],
  KR: ['Seoul', 'Gyeonggi', 'Busan', 'Incheon', 'South Gyeongsang', 'Jeju'],
  KZ: ['Akmola', 'Almaty', 'Atyrau', 'Karaganda', 'Kostanay', 'Turkistan'],
  MX: ['Mexico City', 'Jalisco', 'Nuevo Leon', 'Veracruz', 'Sonora', 'Yucatan'],
  MY: ['Selangor', 'Johor', 'Penang', 'Sabah', 'Sarawak', 'Perak'],
  NG: ['Lagos', 'Kano', 'Kaduna', 'Rivers', 'Oyo', 'Borno'],
  NL: ['North Holland', 'South Holland', 'Utrecht', 'Groningen', 'Zeeland', 'Limburg'],
  NO: ['Oslo', 'Vestland', 'Rogaland', 'Trondelag', 'Nordland', 'Troms'],
  NZ: ['Auckland', 'Wellington', 'Canterbury', 'Otago', 'Waikato', 'Bay of Plenty'],
  PE: ['Lima', 'Arequipa', 'Cusco', 'Piura', 'La Libertad', 'Loreto'],
  PH: ['Metro Manila', 'Cebu', 'Davao', 'Iloilo', 'Pampanga', 'Palawan'],
  PK: ['Punjab', 'Sindh', 'Khyber Pakhtunkhwa', 'Balochistan', 'Islamabad', 'Gilgit-Baltistan'],
  PL: ['Masovian', 'Silesian', 'Lesser Poland', 'Greater Poland', 'Pomeranian', 'Lower Silesian'],
  RU: ['Moscow', 'Saint Petersburg', 'Tatarstan', 'Siberia', 'Krasnoyarsk', 'Sakha'],
  SA: ['Riyadh', 'Makkah', 'Eastern Province', 'Madinah', 'Asir', 'Tabuk'],
  SE: ['Stockholm', 'Vastra Gotaland', 'Skane', 'Uppsala', 'Norrbotten', 'Vasterbotten'],
  TH: ['Bangkok', 'Chiang Mai', 'Phuket', 'Nakhon Ratchasima', 'Chonburi', 'Songkhla'],
  TR: ['Istanbul', 'Ankara', 'Izmir', 'Bursa', 'Antalya', 'Konya'],
  UA: ['Kyiv', 'Lviv', 'Odesa', 'Kharkiv', 'Dnipro', 'Donetsk'],
  US: ['California', 'Texas', 'Florida', 'New York', 'Illinois', 'Washington'],
  VE: ['Capital District', 'Zulia', 'Miranda', 'Carabobo', 'Bolivar', 'Lara'],
  VN: ['Hanoi', 'Ho Chi Minh City', 'Da Nang', 'Can Tho', 'Hai Phong', 'Quang Ninh'],
  ZA: ['Gauteng', 'Western Cape', 'KwaZulu-Natal', 'Eastern Cape', 'Limpopo', 'Mpumalanga'],
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
    province: provinceNames(id)[0],
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
  const names = provinceNames(countryId);
  if (!b || !Number.isFinite(b.minX) || b.n < 16) return names[0];
  const sx = x / scaleX;
  const sy = y / scaleY;
  const wide = b.maxX - b.minX >= 4;
  const tall = b.maxY - b.minY >= 4;
  if (!wide && !tall) return names[0];
  const cols = wide && names.length > 2 ? Math.min(3, names.length) : 1;
  const rows = tall ? Math.ceil(names.length / cols) : 1;
  const col = Math.min(cols - 1, Math.floor(((sx - b.minX) / Math.max(1, b.maxX - b.minX + 1)) * cols));
  const row = Math.min(rows - 1, Math.floor(((sy - b.minY) / Math.max(1, b.maxY - b.minY + 1)) * rows));
  return names[Math.min(names.length - 1, row * cols + col)];
}

function provinceNames(id) {
  const list = PROVINCES[id];
  if (list?.length) return list;
  const city = CITY_OVERRIDES[id] ?? 'Capital';
  return [`${city} District`, `${city} Province`];
}
