import { PROVINCE_W, PROVINCE_H, PROVINCE_OWNER, PROVINCE_RLE } from './worldProvinces.js';

// The world, painted at 3 degrees of longitude per column and 2.35 degrees of
// latitude per row — 84N at the top edge, 57S at the bottom, 120 x 60 cells.
//
// One character per cell. '.' is ocean. '-' is real land that belongs to none
// of the playable countries — it stays on the map so the continents read
// correctly, but nothing can be built there. Every other character is a
// country's `char` from countries.js.
//
// Geography is DATA, not generation: the same continents appear in every game.
// Only where the deposits sit inside a country is seeded (see generateWorld).
//
// The outlines were traced from real lon/lat coastlines, so the projection is
// plain equirectangular and everything that follows from that is true here too:
// Russia and Canada are stretched near the poles and the tropics are squeezed,
// exactly as on a Plate Carree wall map.
export const SOURCE_ROWS = [
  '.........................................------------...................................................................',
  '..........................----------...---------------..................................................................',
  '......................-------------...----------------..................................................................',
  '....................--------------...-----------------....................................RRRRR.........................',
  '...................--CCCCCCCC........-----------------.............................RRRRRRRRRRRRRRRRRR...................',
  '.......UUUUU............CCCCCCCCC.....----------------.............ww...........-RRRRRRRRRRRRRRRRRRRRRRRRR..............',
  '.....UUUUUUUUCCCCCCCCCCCCCCCCCCCCC.....--------------............wWW---RRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRR...',
  '....UUUUUUUUUCCCCCCCCCCCCCCCCCCCCC......-----------.----........wWWW--RRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRR',
  '....UUUUUUUUUCCCCCCCCCCCCCCCCCCCCC.......--------...----.......wWW..--RRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRR-',
  '....UUUUUUUUUCCCCCCCCCCCCCCC......CCC......----...............wwW....RRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRR---',
  '.....UUUUUUUUCCCCCCCCCCCCCCC......CCCCCCC.....................ww.....RRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRR------',
  '.......UUU.....CCCCCCCCCCCCC......CCCCCCC-................G...-W....-RRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRR............',
  '................CCCCCCCCCCCC......CCCCCCCC..............-GG...DDDO.O-RRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRR.............',
  '.................CCCCCCCCCCC......CCCCCCCC..............-GG..nDDDOOOKKKKKRRRRRRRRRzzRRRRRRRRRRRRRRRRRRRRRRR.............',
  '..................CCCCCCCCCCCCCCCCCCCCCCC.................GGFFDDDOOOKKKKKK--zzzzzzzzzzzzRRRRRVVVVVVVRRRRRR..............',
  '..................UUUUUUUUUUUUCCCCCCCCCCC..................FFFDDD--KKKKKKK--zzzzzzzzzzzzzVVVVVVVVVVVVRRRR...............',
  '..................UUUUUUUUUUUUU-CCCUUU-....................FFFFTT--KK......z..zzzzzzzzzVVVVVVVVVVVVVVVRR...1............',
  '..................UUUUUUUUUUUUUUUUUUU....................EEEFF.TT----......-..zzzzzzzVVVVVVVVVVVVVVVVV--...11...........',
  '..................UUUUUUUUUUUUUUUUUU.....................EEEE...TT--YYYYYYY-..------VVVVVVVVVVVVVVVVV--...11............',
  '...................UUUUUUUUUUUUUUUUU.....................EEE....TT..YYYYYYYI.III----VVVVVVVVVVVVVVVVV.2...1.............',
  '...................UUUUUUUUUUUUUUUU......................EEggg.......YYYYY.IIIIII---.VVVVVVVVVVVVVVV.22..1..............',
  '....................UUUUUUUUUUUUUUU......................--ggggg........-q.qIIIII--QQJVVVVVVVVVVVVVVV...................',
  '.....................MMMMUUUUUUUUU......................---ggggg--.-XXXXSqqqIIIII-Q.JJJVVVVVVVVVVVVVV...................',
  '.....................MMMMMMUUUU.UU......................---ggggg----XXXXSSSS...IIQQQJJJJVVVVVVVVVVVV....................',
  '.......................MMMMM....U......................----ggggg----XXX.SSSS...IQQQJJJJJJJJVVVVVVVVV....................',
  '.......................MMMMM.....-.....................----ggggg----XXX..SSSSSa-.QQJJJJJJJb-VVVVVVV.-...................',
  '........................MMMM....---...................-----ggggg----XXX..SSSSSa....JJJJJJJb---hVVV..-...................',
  '.........................MMMM--....---................-----ggggg-------..SSSSS......JJJJJ..-ttth....pp..................',
  '.........................-MMM---......................-----------------...SSSS......JJJ....-ttth....pp..................',
  '.............................M---.....................-------NNNN------...SSS.......JJJ.....ttth....pp..................',
  '...............................---..c..................-----NNNNN------eeeee.........JJ.....tthh....pp..................',
  '...............................--c.cvvv................-----NNNNN------eeeee-........JJ.....tthh....pp..................',
  '................................-ccccvvv-...............----NNNNN------eeeee-.........-......ty....ppp..................',
  '..................................ccccvvBB-..............---NNNNN--ZZZ-eeeee.................yy....ppp..................',
  '..................................ccccvBBBB....................--ZZZZZ-kkkee...............33yy..yy33...................',
  '.................................-ccccBBBBBB...................-ZZZZZZZkkk-.................33..333333..................',
  '.................................-cccBBBBBBBBB..................ZZZZZZZkkk...................3..333333.3333.............',
  '.................................PP-BBBBBBBBBBB.................ZZZZZZZkkk...................33..33.33.3333-............',
  '.................................PPPBBBBBBBBBBBB................ZZZZZZZ--.....................3333..3...333--...........',
  '.................................PPPBBBBBBBBBBBB................-ZZZZZ----.....................3333.....333---..........',
  '..................................PPPBBBBBBBBBBB................---ZZZ----.............................44444............',
  '..................................PPP-BBBBBBBBB.................-----Z------..........................444444............',
  '...................................PP---BBBBBBB.................-------------........................4444444............',
  '....................................L---BBBBBBB.................---------.---.......................444444444...........',
  '....................................LL--BBBBBBB..................--------.--......................444444444444..........',
  '....................................LAAA-BBBBB...................-HHHHH-...-.....................44444444444444.........',
  '....................................LAAAA-BB.....................HHHHHH-..........................4444444444444.........',
  '....................................LAAAAABB.....................HHHHHH...........................4444444444444.........',
  '....................................LAAAAAB......................HHHHH-...........................4444444444444.........',
  '....................................LAAAAAB.......................HHHH............................4444444444444.........',
  '....................................LAAAA-.........................-...............................4.....444444......5..',
  '...................................LLAAAA-................................................................4444.......55.',
  '...................................LLAAA....................................................................4........55.',
  '...................................LAAA.....................................................................44......55..',
  '...................................LAAA.............................................................................55..',
  '...................................LAA.............................................................................55...',
  '...................................LAA..................................................................................',
  '...................................LAA..................................................................................',
  '....................................A...................................................................................',
  '........................................................................................................................',
];

export const SOURCE_W = 120;
export const SOURCE_H = 60;

// The live world is a QUARTER-DEGREE raster of real polygons, decoded once here
// from `worldProvinces.js`. Two grids used to exist — a coarse ownership grid
// upscaled into a playable one — and now there is one: a tile IS a source cell,
// so a coastline on screen is the coastline in the data rather than a staircase
// of whatever the upscale happened to sample.
export const SOURCE_COUNTRY_W = PROVINCE_W;
export const SOURCE_COUNTRY_H = PROVINCE_H;

// Province index per cell, -1 for sea. This is the one raster everything else
// is derived from, and it is a typed array because it has a million entries.
export const PROVINCE_AT = decodeProvinces();

function decodeProvinces() {
  const out = new Int16Array(PROVINCE_W * PROVINCE_H).fill(-1);
  for (let y = 0; y < PROVINCE_H; y++) {
    const line = PROVINCE_RLE[y];
    if (!line) continue;
    let x = 0;
    for (const run of line.split(' ')) {
      const star = run.indexOf('*');
      const token = star < 0 ? run : run.slice(0, star);
      const length = star < 0 ? 1 : parseInt(run.slice(star + 1), 36);
      if (token !== '-') {
        const value = parseInt(token, 36);
        out.fill(value, y * PROVINCE_W + x, y * PROVINCE_W + x + length);
      }
      x += length;
    }
  }
  return out;
}

// Who owns a cell is DERIVED from which province it is in — the union of a
// country's provinces is the country — so the two can never disagree. Kept as
// rows of ids because that is what every consumer has always read.
export const SOURCE_COUNTRY_ROWS = (() => {
  const rows = [];
  for (let y = 0; y < PROVINCE_H; y++) {
    const row = new Array(PROVINCE_W);
    for (let x = 0; x < PROVINCE_W; x++) {
      const province = PROVINCE_AT[y * PROVINCE_W + x];
      row[x] = province < 0 ? null : PROVINCE_OWNER[province];
    }
    rows.push(row);
  }
  return rows;
})();

export const OCEAN_CHAR = '.';
export const NEUTRAL_CHAR = '-';

// The playable grid is the raster itself: 1440x720, a quarter of a degree a
// tile, 1,036,800 tiles. It is not an upscale of anything, which is the whole
// point — Italy has a boot, Japan has four islands, and the Gulf is a gulf.
//
// Three things are load-bearing at this size and will bite if changed:
//   * tiles are NOT saved (see core/state.js) — a million objects would blow
//     past the localStorage quota many times over. They are regenerated from
//     `seed`, which works only because nothing mutates terrain or ownership.
//   * the map is drawn to a canvas in RUNS of one colour, not a rect per tile.
//     A million fillRect calls a frame is not a map, it is a slideshow.
//   * anything that walks every tile has to be indexed or cached. At 180,000
//     tiles a full scan per decision was affordable; at a million it is not.
export const WORLD_W = SOURCE_COUNTRY_W;
export const WORLD_H = SOURCE_COUNTRY_H;

// Deposit counts in countries.js were authored against a 360x180 grid and are
// still written in those units, because rewriting forty-six hand-balanced
// countries every time the map gets sharper is how balance rots. This is the
// conversion, and it is the AUTHORING resolution on the bottom — not the source
// grid, which is now the same size as the playable one.
export const AUTHORED_W = 360;
export const AUTHORED_H = 180;
export const AREA_SCALE = (WORLD_W * WORLD_H) / (AUTHORED_W * AUTHORED_H);

function expand(rows, srcW, srcH, dstW, dstH) {
  const out = [];
  for (let y = 0; y < dstH; y++) {
    const sy = Math.min(srcH - 1, Math.floor((y * srcH) / dstH));
    const row = rows[sy];
    let line = '';
    for (let x = 0; x < dstW; x++) {
      line += row[Math.min(srcW - 1, Math.floor((x * srcW) / dstW))];
    }
    out.push(line);
  }
  return out;
}

export const WORLD_ROWS = expand(SOURCE_ROWS, SOURCE_W, SOURCE_H, WORLD_W, WORLD_H);

// The playable grid IS the source grid now, so there is nothing to upscale and
// nothing to keep in step. A second copy of a million cells would cost eight
// megabytes to say the same thing.
export const WORLD_COUNTRY_ROWS = SOURCE_COUNTRY_ROWS;
