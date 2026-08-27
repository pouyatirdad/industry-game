import { SOURCE_COUNTRY_ROWS } from './worldCountries.js';
export { SOURCE_COUNTRY_ROWS } from './worldCountries.js';

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
export const SOURCE_COUNTRY_W = 360;
export const SOURCE_COUNTRY_H = 180;

export const OCEAN_CHAR = '.';
export const NEUTRAL_CHAR = '-';

// The playable grid is an upscale of the art above. Keeping the source coarse
// is deliberate: the whole planet stays reviewable in one screen, and a
// coastline is edited in one place rather than in a hundred adjacent tiles.
//
// The scale is not required to be a whole number — each fine tile samples the
// source cell its centre falls in. 600x300 is a round five tiles per source
// cell each way: 180,000 tiles, twenty-five times the 7,200 the source
// describes.
//
// Two things are load-bearing at this size and will bite if changed back:
//   * tiles are NOT saved (see core/state.js) — at 180,000 objects the save
//     would blow past the localStorage quota. They are regenerated from `seed`.
//   * the map is drawn to a canvas, not to DOM nodes. 180,000 tiles cannot be
//     elements, and virtualising them does not help because zooming out
//     legitimately shows every one at once.
export const WORLD_W = 720;
export const WORLD_H = 360;

// Deposit counts in countries.js are authored against the source grid, so they
// are multiplied by this to keep each country's resource *proportion* intact at
// any resolution.
export const AREA_SCALE = (WORLD_W * WORLD_H) / (SOURCE_COUNTRY_W * SOURCE_COUNTRY_H);

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

function expandCells(rows, srcW, srcH, dstW, dstH) {
  const out = [];
  for (let y = 0; y < dstH; y++) {
    const sy = Math.min(srcH - 1, Math.floor((y * srcH) / dstH));
    const row = rows[sy];
    const line = [];
    for (let x = 0; x < dstW; x++) {
      line.push(row[Math.min(srcW - 1, Math.floor((x * srcW) / dstW))]);
    }
    out.push(line);
  }
  return out;
}

export const WORLD_COUNTRY_ROWS = expandCells(
  SOURCE_COUNTRY_ROWS, SOURCE_COUNTRY_W, SOURCE_COUNTRY_H, WORLD_W, WORLD_H,
);
