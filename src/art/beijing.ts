import type { Graphics } from 'pixi.js';
import { INK } from '../render/palette.ts';
import { flat } from './geom.ts';
import type { PropInfo } from './props.ts';
import { motion } from '../render/motion.ts';

/**
 * Beijing's buildings and street things, for revision 2's city (the owner's plan, 2026-10-04) and its look (the owner,
 * 2026-10-06: "make it look like Beijing in that Beijing has distinct architecture and colors and ornamentation and
 * signs"): grey brick and grey tiled roofs whose ridges and eaves curl up, vermilion doors and columns, beams painted
 * in lapis and jade with gold, lattice windows, red lanterns, black name boards edged in gold, white marble, and the
 * 1980s city's brick housing blocks, bicycles and winter cabbages. Code drawings until there is art, each with its base
 * at (0, 0). Words on boards, flags and banners stay blank until the owner supplies them; the road signs now carry
 * the owner's "Berlin 5 KM" (2026-10-08).
 */

const ink = (w = 1.4) => ({ width: w, color: INK, join: 'round' as const });
const GREY = 0x9b9c96;
const GREY_DARK = 0x7c7e7a;
const ROOF = 0x4f565a;
const ROOF_LIT = 0x8a9294;
const ROOF_EDGE = 0x3b4144;
const VERMILION = 0xb8372b;
const RED_DEEP = 0x8a2a20;
const PAPER_RED = 0xc8402f;
const GOLD = 0xd7a73a;
const JADE = 0x2f7a6a;
const LAPIS = 0x2c5a86;
const LACQUER = 0x1f1c19;
const MARBLE = 0xece8dc;

/** Grey brick in courses, its joints staggered. */
function brick(g: Graphics, x: number, y: number, w: number, h: number, color = GREY) {
  g.rect(x, y, w, h).fill(color).stroke(ink(1.2));
  for (let row = 7; row < h; row += 7) g.moveTo(x, y + row).lineTo(x + w, y + row);
  for (let row = 0; row < h; row += 7) for (let col = row % 14 ? 8 : 0; col < w; col += 16) g.moveTo(x + col, y + row).lineTo(x + col, y + Math.min(h, row + 7));
  g.stroke({ width: 0.5, color: 0x77796f });
}

/**
 * A roof seen from the front, over a front from x0 to x1 whose eave is at y: dark grey tiles in rows of tubes, drip
 * tiles along the eave, corners sweeping up, and a ridge `h` above whose ends curl up.
 */
function roof(g: Graphics, x0: number, x1: number, y: number, h: number) {
  g.poly(flat([[x0 - 8, y - 4], [x0 - 2, y], [x1 + 2, y], [x1 + 8, y - 4], [x1 - 3, y - h], [x0 + 3, y - h]])).fill(ROOF).stroke(ink(1.2));
  const mid = (x0 + x1) / 2;
  for (let x = x0 + 4; x < x1 - 2; x += 5) g.moveTo(x, y - 1).lineTo(x + (mid - x) * 0.06, y - h + 2);
  g.stroke({ width: 0.9, color: ROOF_LIT });
  for (let x = x0; x <= x1; x += 5) g.circle(x, y, 1.5).fill(ROOF_EDGE);
  g.rect(x0 + 3, y - h - 3, x1 - x0 - 6, 4).fill(ROOF_EDGE).stroke(ink(0.9));
  for (const [ex, s] of [[x0 + 3, -1], [x1 - 3, 1]] as const) g.moveTo(ex, y - h - 1).quadraticCurveTo(ex + s * 5, y - h - 2, ex + s * 4, y - h - 8).stroke({ width: 2.4, color: ROOF_EDGE, cap: 'round' });
}

/** A beam painted under the eaves: panels of lapis and jade in a vermilion frame, a gold line along it. */
function paintedBeam(g: Graphics, x0: number, x1: number, y: number, h = 6) {
  g.rect(x0, y, x1 - x0, h).fill(VERMILION).stroke(ink(0.8));
  const n = Math.max(2, Math.round((x1 - x0) / 14));
  const pw = (x1 - x0) / n;
  for (let i = 0; i < n; i++) g.rect(x0 + i * pw + 1.5, y + 1, pw - 3, h - 2).fill(i % 2 ? JADE : LAPIS);
  g.moveTo(x0 + 1, y + h / 2).lineTo(x1 - 1, y + h / 2).stroke({ width: 0.6, color: GOLD });
}

/** A red lantern hanging from (x, y): gold caps top and bottom, a tassel. */
function lantern(g: Graphics, x: number, y: number, r = 5) {
  g.moveTo(x, y - 3).lineTo(x, y).stroke({ width: 0.8, color: INK });
  g.rect(x - r * 0.6, y, r * 1.2, 1.6).fill(GOLD);
  g.ellipse(x, y + 1.6 + r * 0.9, r, r * 0.9).fill(0xd23b2c).stroke(ink(0.9));
  g.moveTo(x, y + 1.6).lineTo(x, y + 1.6 + r * 1.8).stroke({ width: 0.5, color: 0x8a2a20 });
  g.rect(x - r * 0.6, y + 1.6 + r * 1.8, r * 1.2, 1.6).fill(GOLD);
  g.moveTo(x, y + 3.2 + r * 1.8).lineTo(x, y + 3.2 + r * 2.7).stroke({ width: 1.4, color: GOLD });
}

/** A red double door from y0 down to y1: rows of gold studs, two ring knockers. */
function studdedDoor(g: Graphics, x0: number, x1: number, y0: number, y1: number) {
  g.rect(x0, y0, x1 - x0, y1 - y0).fill(VERMILION).stroke(ink(1));
  const mid = (x0 + x1) / 2;
  const half = (x1 - x0) / 2;
  g.moveTo(mid, y0).lineTo(mid, y1).stroke(ink(0.8));
  for (const side of [x0, mid]) for (let r = 0; r < 4; r++) for (let c = 0; c < 2; c++) g.circle(side + half * (0.3 + c * 0.4), y0 + (y1 - y0) * (0.14 + r * 0.17), 0.9).fill(GOLD);
  for (const kx of [mid - 3, mid + 3]) g.circle(kx, y0 + (y1 - y0) * 0.58, 1.7).stroke({ width: 1, color: GOLD });
}

/** A lattice window: a red frame and a grid of slats over paper. */
function lattice(g: Graphics, x: number, y: number, w: number, h: number) {
  g.rect(x, y, w, h).fill(0xe8dcc0).stroke({ width: 1.3, color: RED_DEEP });
  for (let i = 1; i < 4; i++) g.moveTo(x + (w * i) / 4, y).lineTo(x + (w * i) / 4, y + h);
  for (let i = 1; i < 3; i++) g.moveTo(x, y + (h * i) / 3).lineTo(x + w, y + (h * i) / 3);
  g.stroke({ width: 0.7, color: RED_DEEP });
}

/** A name board of black lacquer edged in gold; blank until the owner words it. */
function nameBoard(g: Graphics, x: number, y: number, w: number, h: number) {
  g.rect(x, y, w, h).fill(LACQUER).stroke({ width: 1.6, color: GOLD });
  g.rect(x + 2.5, y + 2.5, w - 5, h - 5).stroke({ width: 0.6, color: GOLD });
}

/** A pair of stone drums at a gate's foot, one each side of x0..x1. */
function drums(g: Graphics, x0: number, x1: number) {
  for (const x of [x0, x1]) {
    g.rect(x - 4, -5, 8, 5).fill(0x8f918c).stroke(ink(0.8));
    g.circle(x, -9, 4.2).fill(0xa8aaa3).stroke(ink(0.8));
  }
}

/** A head of winter cabbage, the city's store for the cold months, standing on (x, y). */
function cabbage(g: Graphics, x: number, y: number, s = 1) {
  g.ellipse(x, y - 4 * s, 5.5 * s, 4.5 * s).fill(0xc9dc9a).stroke(ink(0.7));
  g.moveTo(x - 3 * s, y - 6 * s).quadraticCurveTo(x, y - 9.5 * s, x + 3 * s, y - 6 * s).stroke({ width: 0.8, color: 0x6d8f45 });
}

/** A siheyuan's gate on its lane: the gatehouse's studded red door between stone drums under a painted beam, red paper strips either side (blank), grey brick walls running off under tiled copings. */
function courtyard(g: Graphics) {
  brick(g, -66, -30, 132, 30);
  g.poly(flat([[-68, -30], [-64, -35], [64, -35], [68, -30]])).fill(ROOF).stroke(ink(1));
  g.rect(-22, -46, 44, 46).fill(GREY_DARK).stroke(ink(1.2));
  for (const x of [-21, 17]) g.rect(x, -46, 4, 46).fill(RED_DEEP).stroke(ink(0.6));
  studdedDoor(g, -11, 11, -38, 0);
  for (const x of [-15.5, 12.5]) g.rect(x, -36, 3, 24).fill(PAPER_RED);
  paintedBeam(g, -24, 24, -50, 6);
  drums(g, -14, 14);
  roof(g, -26, 26, -50, 13);
}

/**
 * A shop: red columns and lattice above the open front, its name board (blank) under a painted beam and an upswept roof,
 * lanterns at the eaves, its flag hanging from a pole (blank), and its goods outside.
 */
function shop(flag: number, goods: (g: Graphics) => void) {
  return (g: Graphics) => {
    g.rect(-58, -54, 116, 54).fill(0x5a3a2a).stroke(ink(1.3));
    g.rect(-52, -24, 72, 24).fill(0x2e2a26);
    g.rect(26, -30, 22, 30).fill(RED_DEEP).stroke(ink(1));
    lattice(g, -52, -46, 22, 15);
    lattice(g, 28, -46, 22, 12);
    nameBoard(g, -26, -50, 50, 13);
    for (const x of [-58, -27, 22, 54]) g.rect(x, -54, 4, 54).fill(VERMILION).stroke(ink(0.7));
    paintedBeam(g, -60, 60, -60, 6);
    roof(g, -62, 62, -60, 15);
    for (const x of [-42, 42]) lantern(g, x, -56, 4);
    g.moveTo(56, -58).lineTo(70, -60).stroke({ width: 1.8, color: 0x5a3a2a });
    g.poly(flat([[63, -59], [73, -59], [73, -32], [70, -35], [68, -31], [66, -35], [63, -32]])).fill(flag).stroke(ink(0.9));
    g.rect(64.5, -57, 7, 20).stroke({ width: 0.7, color: GOLD });
    goods(g);
  };
}

/** Wheels and a frame hung on a repair shop's front, a wheel leaning by its door. */
function repairGoods(g: Graphics) {
  for (const [x, y] of [[-44, -14], [-30, -15]] as const) {
    g.circle(x, y, 6).stroke({ width: 1.4, color: 0xc9c7bc });
    g.moveTo(x - 6, y).lineTo(x + 6, y).moveTo(x, y - 6).lineTo(x, y + 6).stroke({ width: 0.5, color: 0xc9c7bc });
  }
  g.circle(20, -7, 7).stroke({ width: 1.6, color: INK });
}

/** Baskets of cabbages and fruit before a grocer's. */
function grocerGoods(g: Graphics) {
  for (const x of [-46, -32]) {
    g.poly(flat([[x - 7, -10], [x + 7, -10], [x + 5, 0], [x - 5, 0]])).fill(0xb08a4e).stroke(ink(0.8));
  }
  for (const [x, y] of [[-46, -9], [-49, -7], [-43, -7]] as const) cabbage(g, x, y + 2, 0.8);
  for (const [x, y] of [[-34, -11], [-30, -11], [-32, -14]] as const) g.circle(x, y, 2.6).fill(0xd8862e).stroke(ink(0.6));
  for (const x of [-18, -8, 2]) cabbage(g, x, 0, 1);
  cabbage(g, -13, -5, 1);
}

/** A tea house's great jars of tea by its door. */
function teaGoods(g: Graphics) {
  for (const x of [-52, -38]) {
    g.ellipse(x, -9, 7, 9).fill(0x3f6f6a).stroke(ink(0.9));
    g.rect(x - 4, -20, 8, 4).fill(0x2f5551).stroke(ink(0.7));
    g.moveTo(x - 5, -9).lineTo(x + 5, -9).stroke({ width: 0.7, color: GOLD });
  }
}

/** A flatbed tricycle, the city's cart, piled with winter cabbages. */
function tricycle(g: Graphics) {
  for (const x of [-18, 8, 30]) {
    g.circle(x, -6, 6).stroke({ width: 1.6, color: INK });
    g.circle(x, -6, 1.2).fill(INK);
  }
  g.rect(-27, -15, 42, 5).fill(0x6a5a40).stroke(ink(1));
  g.moveTo(15, -12).lineTo(30, -6).moveTo(18, -12).lineTo(26, -24).lineTo(33, -24).stroke({ width: 1.6, color: 0x3d5a3f, cap: 'round' });
  g.rect(19, -21, 7, 2.5).fill(INK);
  for (const [x, y] of [[-22, -15], [-14, -15], [-6, -15], [2, -15], [10, -15], [-18, -21], [-10, -21], [-2, -21], [6, -21], [-14, -27], [-5, -27]] as const) cabbage(g, x, y + 4, 0.9);
}

/** A produce stall with a striped cloth canopy and baskets at street level. */
function produceStall(g: Graphics) {
  for (const x of [-25, 25]) g.rect(x - 1.5, -41, 3, 41).fill(0x745438).stroke(ink(0.8));
  g.rect(-25, -17, 50, 15).fill(0x97623a).stroke(ink(1));
  g.rect(-28, -20, 56, 5).fill(0xc9975b).stroke(ink(0.9));
  for (const [x, y] of [[-18, -22], [-10, -22], [-14, -28]] as const) cabbage(g, x, y, 0.85);
  for (const [x, y] of [[2, -24], [9, -24], [16, -24], [6, -30], [13, -30]] as const) g.circle(x, y, 3.5).fill(0xe99331).stroke(ink(0.6));
  g.poly([-31, -38, -23, -49, 23, -49, 31, -38]).fill(0xe9d49a).stroke(ink(1));
  for (const x of [-21, -7, 7, 21]) g.poly([x - 4, -48, x + 2, -48, x + 5, -38, x - 5, -38]).fill(0xc74c39);
  g.rect(-31, -38, 62, 5).fill(0xc74c39).stroke(ink(0.8));
}

/** A small tea stand, its blue cloth, thermoses and cups distinct from the grocer's baskets. */
function teaStand(g: Graphics) {
  for (const x of [-21, 21]) g.rect(x - 1.5, -37, 3, 37).fill(0x76583a).stroke(ink(0.8));
  g.rect(-23, -18, 46, 18).fill(0x427a8e).stroke(ink(1));
  g.rect(-26, -21, 52, 4).fill(0xd7bc82).stroke(ink(0.8));
  for (const [x, c] of [[-15, 0xb84c36], [-5, 0x557b63]] as const) {
    g.roundRect(x, -36, 7, 15, 2).fill(c).stroke(ink(0.8));
    g.rect(x + 1, -39, 5, 3).fill(0xd5c9a6);
  }
  for (const x of [8, 16]) g.rect(x, -26, 5, 5).fill(0xece6d4).stroke(ink(0.6));
  g.poly([-27, -39, -21, -48, 21, -48, 27, -39]).fill(0x388782).stroke(ink(1));
  g.rect(-27, -39, 54, 5).fill(0xe2c36e).stroke(ink(0.8));
}

/** Washing hung out on a line between two poles. */
function laundry(g: Graphics) {
  g.moveTo(-45, 0).lineTo(-45, -38).moveTo(45, 0).lineTo(45, -38).stroke({ width: 2, color: 0x535548 });
  g.moveTo(-45, -36).quadraticCurveTo(0, -27, 45, -36).stroke(ink(1));
  for (const [x, c] of [[-31, 0xd6d4b8], [-7, 0x6e8c94], [17, 0xb0a084]] as const) g.poly([x, -33, x + 17, -33, x + 17, -12, x, -12]).fill(c).stroke({ width: 0.7, color: 0x575f58 });
}

/** Overlapping shop extensions hide the long sightline from the arrival street. Walk underneath. */
function entryOverhang(g: Graphics) {
  // Shallow tiled extensions join above the passage. Their staggered eaves match the shop roofs.
  for (const [x0, x1, bottom] of [[-58, 5, -45], [5, 58, -57]] as const) {
    g.rect(x0, -154, x1 - x0, bottom + 139).fill(ROOF);
    for (let x = x0 + 3; x < x1; x += 6.5) {
      g.moveTo(x, -154).lineTo(x, bottom - 15).stroke({ width: 1, color: ROOF_LIT });
      g.moveTo(x + 2, -154).lineTo(x + 2, bottom - 15).stroke({ width: .7, color: ROOF_EDGE });
    }
    g.rect(x0, bottom, x1 - x0, 5).fill(0x746348).stroke(ink(.7));
    roof(g, x0 - 2, x1 + 2, bottom, 18);
  }
  g.moveTo(-51, -45).lineTo(-51, -3).moveTo(51, -57).lineTo(51, -9)
    .stroke({ width: 2.4, color: 0x746348 });
}

/** Overhead stock and fabric obscure the alley beyond, but leave the ground underneath open. */
function alleyScreen(theme: 'laundry' | 'school' | 'theatre' | 'paper' | 'lanterns' | 'bamboo' | 'awning' | 'signs') {
  return (g: Graphics) => {
    for (const x of [-49, 49]) g.moveTo(x, 0).lineTo(x, -66).stroke({ width: 2.2, color: 0x6e634d });
    g.moveTo(-49, -64).quadraticCurveTo(0, -55, 49, -64).stroke(ink(1.2));
    if (theme === 'lanterns') {
      g.moveTo(-49,-46).quadraticCurveTo(0,-32,49,-46).stroke(ink(1));
      for (const [x,y,r] of [[-36,-59,7],[-12,-55,8],[16,-55,7],[39,-60,6],[-27,-42,6],[3,-37,7],[31,-42,6]])
        lantern(g,x!,y!,r!);
    } else if (theme === 'bamboo') {
      for (const [x,w,bottom] of [[-44,49,-26],[8,36,-36]]) {
        g.rect(x!,-59,w!,bottom!+59).fill(0xb59e68).stroke(ink(.8));
        for(let y=-56;y<bottom!;y+=3) g.moveTo(x!,y).lineTo(x!+w!,y).stroke({width:1,color:0x7d7650});
        for(const dx of [6,w!-6]) g.moveTo(x!+dx,-62).lineTo(x!+dx,bottom!+5).stroke({width:1,color:0xddd1aa});
        g.rect(x!-1,bottom!-2,w!+2,4).fill(0x8e774b).stroke(ink(.6));
      }
    } else if (theme === 'awning') {
      g.poly([-49,-62,49,-62,44,-39,-44,-39]).fill(0xd6c9a2).stroke(ink(1));
      for(let x=-42;x<43;x+=24) g.poly([x,-61,x+12,-61,x+10,-40,x,-40]).fill(JADE);
      g.rect(-44,-39,88,9).fill(0xb9ac86).stroke(ink(.8));
      for(let x=-42;x<43;x+=24) g.rect(x,-39,10,9).fill(0x346b5d);
    } else if (theme === 'signs') {
      for(const [x,w,bottom,c] of [[-41,23,-26,LAPIS],[-8,28,-34,RED_DEEP],[29,15,-22,JADE]]) {
        for(const dx of [4,w!-4]) g.moveTo(x!+dx,-61).lineTo(x!+dx,-51).stroke(ink(.8));
        g.rect(x!,-52,w!,bottom!+52).fill(c!).stroke({width:1.5,color:GOLD});
        // Pictorial shop markers keep provisional signs readable without invented lettering.
        const cx=x!+w!/2;
        g.circle(cx,-43,4).stroke({width:1.2,color:MARBLE});
        g.moveTo(cx-4,-35).lineTo(cx+4,-35).stroke({width:1.5,color:GOLD});
      }
    } else if (theme === 'theatre') {
      g.poly([-48,-62,48,-62,43,-39,26,-33,0,-38,-26,-33,-43,-39]).fill(RED_DEEP).stroke(ink(1));
      for (const x of [-34,-17,0,17,34]) g.moveTo(x,-61).quadraticCurveTo(x-3,-50,x,-37).stroke({width:1.2,color:VERMILION});
      g.moveTo(-43,-39).quadraticCurveTo(-26,-27,0,-38).quadraticCurveTo(26,-27,43,-39).stroke({width:2,color:GOLD});
      for (const x of [-38,38]) lantern(g,x,-36,5);
    } else if (theme === 'school') {
      // Training jackets and sashes airing outside the school.
      for (const [x,c] of [[-39,0xd8cfaf],[-13,LAPIS],[13,0xd8cfaf]] as const) {
        g.poly([x,-55,x+6,-61,x+15,-61,x+23,-55,x+19,-44,x+15,-48,x+18,-23,x+3,-23,x+5,-48,x+1,-43]).fill(c).stroke(ink(.8));
        g.moveTo(x+7,-59).lineTo(x+13,-48).lineTo(x+7,-39).stroke({width:1,color:0x776954});
        g.rect(x+4,-38,13,3).fill(RED_DEEP);
      }
      for(const x of [-46,41]) g.poly([x,-60,x+5,-60,x+7,-28,x+3,-21,x,-26]).fill(VERMILION).stroke(ink(.6));
    } else if (theme === 'paper') {
      for (const [x,bottom] of [[-44,-26],[-16,-20],[12,-29]] as const) {
        g.rect(x,-59,26,bottom+59).fill(0xeee0b9).stroke(ink(.65));
        for (const y of [-60,bottom]) g.rect(x-2,y,30,2.5).fill(0x765336);
        g.poly([x+3,bottom-6,x+11,-46,x+17,-34,x+23,bottom-6]).fill(0x70876c);
        g.circle(x+20,-51,3).fill(0xaf5340);
      }
      for(const x of [-49,45]) {g.moveTo(x,-60).lineTo(x,-33).stroke({width:2,color:0xb99b62});g.poly([x-3,-33,x+3,-33,x,-23]).fill(INK);}
    } else {
      g.poly([-45,-61,-14,-58,-14,-25,-45,-28]).fill(0xd8cca5).stroke(ink(.7));
      g.poly([-10,-58,19,-58,19,-21,-10,-23]).fill(0x6d9293).stroke(ink(.7));
      g.poly([23,-59,44,-61,44,-27,23,-24]).fill(0xb59b79).stroke(ink(.7));
      for(const x of [-39,-20,-5,14,28,39])g.rect(x,-62,2.5,7).fill(0x785d3d);
    }
  };
}

/** Solid, compact edging beside an alley mouth; the opening between two is one Pac wide. */
function entryEdging(kind: 'crate' | 'planter' | 'pier') {
  return (g: Graphics) => {
    if (kind === 'pier') {
      brick(g,-10,-32,20,32,GREY_DARK);
      g.rect(-10,-35,20,4).fill(ROOF).stroke(ink(.8));
    } else if (kind === 'crate') {
      g.rect(-10,-25,20,25).fill(0x98764e).stroke(ink(1));
      for(const y of [-22,-14,-5]) g.rect(-9,y,18,3).fill(0xb99a67).stroke(ink(.5));
      g.moveTo(-8,-24).lineTo(8,-1).stroke({width:2,color:0x67543d});
    } else {
      g.poly([-10,-14,10,-14,8,0,-8,0]).fill(0x9b6249).stroke(ink(1));
      g.rect(-10,-16,20,4).fill(0xc18a62).stroke(ink(.7));
      for(const [x,y] of [[-5,-21],[3,-26],[6,-20],[-3,-28]])
        g.ellipse(x!,y!,4,7).fill(0x6e8e51).stroke(ink(.6));
    }
  };
}

/** Ordinary shop clutter disguises a passage without looking like a pickup or a locked gate. */
function entryDisguise(kind: 'cloth' | 'plant' | 'sacks' | 'brooms' | 'mat' | 'basket' | 'crate' | 'storage' | 'jar' | 'bundles') {
  return (g: Graphics) => {
    if (kind === 'jar') {
      g.ellipse(0,-20,19,22).fill(0x747f7a).stroke(ink(.9));
      g.ellipse(0,-39,14,4).fill(0x5f6863).stroke(ink(.8));
      g.ellipse(0,-41,15,3).fill(0x929185).stroke(ink(.8));
      g.moveTo(-11,-32).quadraticCurveTo(-16,-18,-10,-6).stroke({width:1,color:0x929c91});
    } else if (kind === 'bundles') {
      for (const [x,y] of [[-9,-11],[9,-10],[0,-30]]) {
        g.roundRect(x!-11,y!-10,22,20,5).fill(0x898773).stroke(ink(.8));
        g.moveTo(x!-9,y!).lineTo(x!+9,y!).moveTo(x!,y!-9).lineTo(x!,y!+9).stroke({width:1.3,color:0x65634f});
      }
    } else if (kind === 'crate' || kind === 'storage') {
      const half = kind === 'storage' ? 18 : 14, height = kind === 'storage' ? 34 : 23;
      g.poly([-half,-height,half-4,-height-5,half,-height,half,0,-half,0]).fill(0x96866c).stroke(ink(1));
      for (let y = -height + 6; y < 0; y += 8) g.moveTo(-half + 1,y).lineTo(half - 1,y).stroke({ width: .8, color: 0x6f6555 });
      for (const x of [-half + 4, half - 5]) g.rect(x,-height,3,height).fill(0xb0a085).stroke(ink(.5));
      g.moveTo(-half,-height).lineTo(half,-height).stroke(ink(.8));
    } else if (kind === 'basket') {
      g.poly([-15,-19,15,-19,11,0,-10,0]).fill(0xa39270).stroke(ink(.9));
      for (let y=-16;y<0;y+=4) g.moveTo(-13,y).lineTo(13,y).stroke({width:.7,color:0x786e54});
      for (const x of [-8,0,8]) g.moveTo(x,-19).lineTo(x*.75,-1).stroke({width:.6,color:0x786e54});
      g.ellipse(0,-19,15,4).fill(0x84785e).stroke(ink(.8));
      // Its own path: carried on from the rim, it drew a line up from the basket's foot (its picture keeps the box drawn then,
      // src/art/map_scenery.ts).
      g.beginPath().arc(0,-19,10,Math.PI,Math.PI*2).stroke({width:2,color:0x8d7e60});
    } else if (kind === 'plant') {
      // A small, plain pot: no flowers, glow, label or reward colors.
      g.poly([-8,-14,8,-14,6,0,-6,0]).fill(0x8e795f).stroke(ink(.8));
      g.rect(-9,-15,18,3).fill(0xac967b).stroke(ink(.6));
      for (const [x,y,r] of [[-9,-26,7],[6,-31,8],[0,-40,7],[12,-22,6],[-3,-20,6]]) {
        g.moveTo(0,-12).lineTo(x!,y!).stroke({width:1,color:0x687254});
        g.ellipse(x!,y!,r!,r!*1.3).fill(0x7d8b68).stroke({width:.7,color:0x626d50});
      }
    } else if (kind === 'sacks') {
      for (const [x,y,r] of [[-10,-6,11],[9,-4,10],[1,-20,8]]) {
        g.ellipse(x!,y!-r!*.65,r!,r!*.8).fill(0xa49b80).stroke(ink(.7));
        g.moveTo(x!-3,y!-r!*1.4).lineTo(x!+3,y!-r!*1.4).stroke({width:1.7,color:0x776e5a});
      }
    } else if (kind === 'brooms') {
      for(const [x,lean] of [[-13,7],[-1,-4],[10,-6]]) {
        g.moveTo(x!, -3).lineTo(x!+lean!,-48).stroke({width:2,color:0x8b795b});
        g.poly([x!-7,0,x!+7,0,x!+3,-19,x!-2,-19]).fill(0xa89b75).stroke(ink(.6));
        for(const dx of [-4,0,4])g.moveTo(x!+dx,0).lineTo(x!,-18).stroke({width:.6,color:0x807657});
      }
    } else {
      const mat = kind === 'mat';
      g.moveTo(-24,-54).lineTo(24,-54).stroke({width:2,color:0x786d5e});
      g.poly([-21,-52,22,-52,18,-2,-4,-6,-23,-1]).fill(mat?0xa69c7d:0xa4a69b).stroke(ink(.8));
      if(mat) for(let y=-49;y<-3;y+=4)g.moveTo(-20,y).lineTo(19,y+1).stroke({width:.7,color:0x827c64});
      else for(const x of [-13,-2,11])g.moveTo(x,-51).quadraticCurveTo(x-4,-27,x-1,-5).stroke({width:1,color:0x858d83});
      // Uneven hems and gaps read as loose material, not another solid grey wall.
    }
  };
}

/** Small pots at the alley margins, kept low so the passage and its neighbours remain readable. */
function alleyFlowers(g: Graphics) {
  for (const [x, y, color] of [[-5, 0, MARBLE], [4, -2, 0xc98981]] as const) {
    g.poly([x-3,y-4,x+3,y-4,x+2,y,x-2,y]).fill(0xa8714d).stroke(ink(.6));
    g.moveTo(x,y-4).lineTo(x,y-10).stroke({width:1,color:0x58784d});
    g.ellipse(x-2,y-6,2.5,1).ellipse(x+2,y-8,2.5,1).fill(0x739558);
    for (let i=0;i<5;i++) {
      const a=i*Math.PI*2/5;
      g.circle(x+Math.cos(a)*1.8,y-10+Math.sin(a)*1.8,1.4).fill(color);
    }
    g.circle(x,y-10,.9).fill(GOLD);
  }
}

/** A lane's grey brick wall under a tiled coping whose ends curl up. */
function greyWall(g: Graphics) {
  brick(g, -62, -20, 124, 20);
  g.rect(-62, -3, 124, 3).fill(GREY_DARK);
  g.poly(flat([[-67, -20], [-62, -26], [62, -26], [67, -20]])).fill(ROOF).stroke(ink(1));
  for (let x = -60; x < 60; x += 5) g.moveTo(x, -21).lineTo(x, -25);
  g.stroke({ width: 0.8, color: ROOF_LIT });
  for (const [ex, s] of [[-62, -1], [62, 1]] as const) g.moveTo(ex, -26).quadraticCurveTo(ex + s * 4, -27, ex + s * 3, -31).stroke({ width: 2, color: ROOF_EDGE, cap: 'round' });
}

/** Closed service gates keep a dead end legible, with doors instead of an anonymous grey barrier. */
function alleyClosedGate(g: Graphics) {
  greyWall(g);
  g.rect(-28, -29, 56, 29).fill(0x836044).stroke(ink(1));
  for (let x = -24; x < 28; x += 8) g.moveTo(x, -27).lineTo(x, -1);
  g.stroke({ width: .8, color: 0xa17c51 });
  g.rect(-29, -25, 58, 4).fill(0x5b4636);
  g.rect(-29, -9, 58, 4).fill(0x5b4636);
  g.rect(-6, -17, 12, 4).fill(0x9e9987).stroke(ink(.6));
  roof(g, -34, 34, -30, 9);
}

/** A row of white marble posts, lotus buds on top. */
function postRow(g: Graphics) {
  for (const x of [-48, -24, 0, 24, 48]) {
    g.rect(x - 3, -16, 6, 16).fill(MARBLE).stroke(ink(0.9));
    g.circle(x, -17.5, 3).fill(MARBLE).stroke(ink(0.8));
  }
}

/** A lane's lamp: a red post with a lantern hung from its curved arm. */
function lanternPost(g: Graphics) {
  g.rect(-4, -3, 8, 3).fill(0x55585e).stroke(ink(0.7));
  g.rect(-1.8, -40, 3.6, 38).fill(RED_DEEP).stroke(ink(0.9));
  g.moveTo(0, -40).quadraticCurveTo(6, -46, 12, -42).stroke({ width: 1.8, color: RED_DEEP, cap: 'round' });
  lantern(g, 12, -42, 4.5);
}

/** A poplar of the kind planted along Beijing's streets: a pale trunk and a tall narrow crown. */
function poplar(g: Graphics) {
  g.rect(-3, -30, 6, 30).fill(0x9a9075).stroke(ink(1));
  g.ellipse(0, -52, 13, 28).fill(0x6c8054).stroke(ink(1.1));
  g.ellipse(-4, -46, 9, 17).fill(0x8b995d);
  g.ellipse(4, -60, 7, 13).fill(0xa3ad72);
}

/** A right-pointing road sign, with the remaining distance supplied by each map object. */
function signpost(g: Graphics) {
  g.rect(-2, -48, 4, 48).fill(0x6b5a44).stroke(ink(1));
  g.poly(flat([[-30, -56], [22, -56], [36, -40.5], [22, -25], [-30, -25]])).fill(0xfffdf2).stroke(ink(1.3));
  g.poly([25, -46, 31, -40.5, 25, -35]).fill(VERMILION);
}

/** A neighbourhood school with an open practice hall and a round school emblem. */
function martialSchool(g: Graphics) {
  brick(g, -53, -62, 106, 62);
  g.rect(-41, -47, 82, 43).fill(0x38372e).stroke(ink());
  for (const x of [-47, 43]) g.rect(x, -64, 4, 64).fill(VERMILION).stroke(ink(0.8));
  g.rect(-44, -6, 88, 6).fill(0xc5b99b).stroke(ink(0.8));
  paintedBeam(g, -54, 54, -68);
  roof(g, -55, 55, -68, 14);
  g.rect(-29, -64, 58, 21).fill(RED_DEEP).stroke({ width: 1.2, color: GOLD });
  for (const x of [-31, 31]) g.rect(x - 4, -33, 8, 21).fill(0xd3bd83).stroke(ink(0.8));
}

/** A wooden training dummy, with three arms and a low angled leg. */
function trainingDummy(g: Graphics) {
  g.ellipse(0, 0, 13, 4).fill(0x8b8068).stroke(ink(0.8));
  g.roundRect(-5, -36, 10, 35, 3).fill(0xa67545).stroke(ink());
  g.moveTo(-17, -28).lineTo(-4, -24).moveTo(4, -27).lineTo(17, -30).moveTo(0, -18).lineTo(14, -15)
    .moveTo(2, -9).lineTo(12, -4).lineTo(15, 0).stroke({ width: 4, color: 0x6c4a2d, cap: 'round' });
}

/** Several staves on one small rack, kept at the courtyard's edge. */
function staffRack(g: Graphics) {
  for (const x of [-19, 19]) g.rect(x - 2, -29, 4, 29).fill(RED_DEEP).stroke(ink(0.8));
  g.rect(-23, -24, 46, 4).fill(VERMILION).stroke(ink(0.8));
  for (const x of [-12, 0, 12]) g.moveTo(x - 3, -1).lineTo(x + 3, -42).stroke({ width: 2.6, color: 0xc7a775 });
}

/** Roast ducks under an ochre awning, an oven opening behind the counter. */
function duckShop(g: Graphics) {
  shop(GOLD, () => {})(g);
  g.roundRect(-47, -32, 28, 30, 12).fill(0x241c19).stroke(ink());
  g.rect(-44, -7, 22, 3).fill(0xb65c2c);
  for (const x of [-5, 11, 39]) {
    g.moveTo(x, -34).lineTo(x, -28).stroke(ink(0.8));
    g.ellipse(x, -17, 5, 9).fill(0xb76c35).stroke(ink(0.8));
    g.moveTo(x + 1, -23).quadraticCurveTo(x + 7, -29, x + 4, -30).stroke({ width: 3, color: 0xb76c35 });
    g.moveTo(x - 2, -10).lineTo(x - 3, -5).moveTo(x + 2, -10).lineTo(x + 3, -5).stroke(ink(1));
  }
  g.rect(-11, -3, 60, 3).fill(0xd5b275).stroke(ink(0.7));
}

/** A small open theatre: red curtains, painted backdrop, and a stage above two steps. */
function theatre(g: Graphics) {
  g.rect(-58, -66, 116, 62).fill(0x304d59).stroke(ink());
  g.circle(14, -43, 10).fill(0xd9c790);
  g.poly([-43, -10, -21, -41, -4, -24, 20, -35, 46, -10]).fill(0x56766e);
  for (const s of [-1, 1]) {
    g.poly([s * 58, -66, s * 10, -66, s * 43, -38, s * 45, -7, s * 58, -7]).fill(VERMILION).stroke(ink(1));
    g.moveTo(s * 49, -36).lineTo(s * 58, -34).stroke({ width: 3, color: GOLD });
  }
  paintedBeam(g, -59, 59, -72);
  roof(g, -61, 61, -72, 14);
  g.rect(-29, -72, 58, 21).fill(RED_DEEP).stroke({ width: 1.2, color: GOLD });
  for (const [y, w] of [[-9, 59], [-4, 64], [0, 68]]) g.rect(-w!, y!, w! * 2, 4).fill(0xbda77c).stroke(ink(0.8));
}

function teaTable(g: Graphics) {
  for (const x of [-10, 10]) g.rect(x - 1.5, -12, 3, 12).fill(0x705336);
  g.ellipse(0, -14, 19, 7).fill(0xb98851).stroke(ink(1));
  g.ellipse(-4, -17, 4, 3).fill(0x376e69).stroke(ink(0.7));
  for (const x of [6, 12]) g.ellipse(x, -15, 2.5, 1.8).fill(MARBLE).stroke(ink(0.5));
  for (const x of [-25, 25]) g.rect(x - 5, -5, 10, 5).fill(0x9b6b3d).stroke(ink(0.7));
}

/** Paper and books share the shops' ink, timber and roof palette. */
function bookGoods(g: Graphics) {
  for (const [x, h, c] of [[-43, 14, LAPIS], [-22, 9, RED_DEEP], [1, 17, JADE]] as const) {
    for (let y = -h; y < 0; y += 4) {
      g.rect(x, y, 16, 3).fill(0xe6d7b7).stroke({ width: 0.7, color: c });
    }
  }
  for (const x of [33, 43]) {
    g.moveTo(x, -29).lineTo(x, -15).stroke({ width: 2, color: 0xb3945e });
    g.poly([x - 2, -15, x + 2, -15, x, -9]).fill(INK);
  }
}

function scrollStall(g: Graphics) {
  for (const x of [-25, 25]) g.rect(x - 1.5, -46, 3, 46).fill(0x735337).stroke(ink(0.8));
  g.rect(-29, -48, 58, 4).fill(JADE).stroke(ink(1));
  for (const x of [-20, -4, 12]) {
    g.rect(x, -42, 12, 28).fill(0xf0e4c7).stroke(ink(0.6));
    for (const y of [-43, -15]) g.rect(x - 2, y, 16, 2).fill(0x765336);
    // Pictorial landscape marks, not invented Chinese writing.
    g.poly([x + 2, -21, x + 6, -33, x + 10, -21]).fill(0x74866b);
    g.circle(x + 8, -36, 2).fill(0xaf5340);
  }
  g.rect(-27, -9, 54, 9).fill(0x967243).stroke(ink(0.9));
}

function antiqueStall(g: Graphics) {
  g.rect(-26, -10, 52, 10).fill(0x74553c).stroke(ink(1));
  g.rect(-29, -13, 58, 4).fill(0xc5a16e).stroke(ink(0.9));
  for (const [x, c] of [[-18, LAPIS], [0, JADE], [19, 0xb68b44]] as const) {
    g.ellipse(x, -23, 6, 10).fill(c).stroke(ink(0.8));
    g.rect(x - 3, -36, 6, 6).fill(c).stroke(ink(0.7));
    g.moveTo(x - 4, -23).lineTo(x + 4, -23).stroke({ width: 1, color: MARBLE });
  }
}

/** A narrow neighbourhood shop, fitting beside a lane without concealing its mouth. */
function kiosk(color: number, goods: 'cloth' | 'food' | 'brushes') {
  return (g: Graphics) => {
    brick(g, -25, -49, 50, 49);
    g.rect(-21, -31, 42, 31).fill(0x39352d).stroke(ink(0.8));
    g.rect(-24, -43, 48, 11).fill(color).stroke(ink(1));
    g.rect(-23, -5, 46, 5).fill(0xac8a57).stroke(ink(0.8));
    roof(g, -27, 27, -50, 10);
    if (goods === 'cloth') {
      for (const [x,c] of [[-15,LAPIS],[3,0xd9d1b9]] as const) {
        g.poly([x,-27,x+4,-31,x+9,-31,x+13,-27,x+10,-22,x+10,-8,x+3,-8,x+3,-22]).fill(c).stroke(ink(0.7));
        g.moveTo(x+3,-16).lineTo(x+10,-16).stroke({width:2,color:RED_DEEP});
      }
    } else if (goods === 'food') {
      for (const x of [-11,10]) for (const y of [-10,-16,-22]) g.ellipse(x,y,8,3).fill(0xc8a56c).stroke(ink(0.7));
    } else {
      for (const x of [-15,-7,1,9,17]) {
        g.moveTo(x,-30).lineTo(x,-13).stroke({width:2,color:0xc5a56e});
        g.poly([x-2,-13,x+2,-13,x,-7]).fill(INK);
      }
    }
  };
}

function bookTable(g: Graphics) {
  for (const x of [-21,21]) g.rect(x-1.5,-15,3,15).fill(0x765336);
  g.rect(-26,-18,52,4).fill(0xa88451).stroke(ink(0.8));
  for (const [x,c] of [[-22,LAPIS],[-6,RED_DEEP],[10,JADE]] as const) {
    g.rect(x,-23,13,5).fill(MARBLE).stroke({width:1,color:c});
    g.rect(x,-26,13,3).fill(c).stroke(ink(0.6));
  }
}

/** A quiet lake pavilion with a large suspended timber striking the gong in its upper storey. */
function waterTemple(g: Graphics, t: number) {
  for (const [y, w] of [[-8, 48], [-4, 53], [0, 58]]) g.rect(-w!, y!, w! * 2, 4).fill(MARBLE).stroke(ink(0.9));
  g.rect(-39, -56, 78, 48).fill(0xd5c4a0).stroke(ink());
  studdedDoor(g, -12, 12, -46, -8);
  lattice(g, -32, -42, 15, 23);
  lattice(g, 17, -42, 15, 23);
  paintedBeam(g, -42, 42, -61);
  roof(g, -47, 47, -61, 13);
  // The upper chamber is open, so the gong and its striker read in silhouette.
  g.rect(-41, -117, 82, 39).fill(0x343b38).stroke(ink(1));
  for (const x of [-44, 40]) g.rect(x, -121, 4, 46).fill(VERMILION).stroke(ink(0.9));
  templeGong(g, t);
  paintedBeam(g, -46, 46, -123);
  roof(g, -50, 50, -123, 14);
}

/** The same right-hand striker plays over either the code shell or the fitted image shell. */
function templeGong(g: Graphics, t: number) {
  if (motion.reduced) t = 0;
  g.moveTo(-9, -115).lineTo(-9, -103).stroke({ width: 2, color: GOLD });
  g.ellipse(-9, -89, 15, 16).fill(0xac8743).stroke(ink(1.3));
  // Lit from the upper left, as the rest of the map: a darker band inside its lower right, a pale rim at its upper left.
  g.beginPath().arc(-9, -89, 12.6, -0.35, 1.95).stroke({ width: 3, color: 0x7d5f2c });
  g.beginPath().arc(-9, -89, 12.8, Math.PI + 0.35, Math.PI * 1.5 + 0.2).stroke({ width: 1.3, color: 0xf0d48a });
  g.ellipse(-9, -89, 11, 12).stroke({ width: 1, color: 0xe0bd6b });
  g.circle(-9, -89, 4).fill(0xd3ae59).stroke(ink(0.7));
  const angle = Math.sin(t * 1.6) * 0.51;
  const dx = Math.sin(angle) * 24, lift = (1 - Math.cos(angle)) * 24;
  // Suspended on the right, with the timber's left end swinging toward the gong.
  for (const x of [42, 24]) g.moveTo(x, -115).lineTo(x - dx, -91 + lift).stroke({ width: 1.4, color: 0xcbb993 });
  g.roundRect(18 - dx, -95 + lift, 32, 8, 3).fill(0x996d3d).stroke(ink(1));
  g.ellipse(18 - dx, -91 + lift, 2, 4).fill(0xc2995f).stroke(ink(0.8));
  g.moveTo(46 - dx, -93 + lift).lineTo(23 - dx, -93 + lift).stroke({ width: 0.8, color: 0xc2995f });
}

/** Plain red cloth and a small stepped stone base, with no national emblem. */
function squareFlag(g: Graphics) {
  g.rect(-10, -4, 20, 4).fill(GREY).stroke(ink(.8));
  g.rect(-6, -8, 12, 4).fill(MARBLE).stroke(ink(.8));
  g.rect(-1.5, -75, 3, 67).fill(0xd2c9ae).stroke(ink(.65));
  g.circle(0, -77, 2.6).fill(GOLD).stroke(ink(.7));
  g.poly([2, -72, 15, -74, 28, -70, 28, -49, 15, -53, 2, -51]).fill(VERMILION).stroke(ink(1));
  g.moveTo(15, -74).lineTo(15, -53).stroke({ width: 1, color: RED_DEEP });
}

/** Beijing's props, by kind; each foot is as wide as its picture and as deep as it is tall over the 0.8 tilt. */
export const BEIJING_PROPS: Record<string, PropInfo> = {
  alley_entry_overhang: { foot: [0, 0], height: 154, cutaway: { halfWidth: 60, front: 52, back: 154 }, draw: entryOverhang },
  alley_laundry_screen: { foot: [0, 0], height: 66, cutaway: { halfWidth: 44, front: 21, back: 66 }, draw: alleyScreen('laundry') },
  alley_lantern_screen: { foot: [0, 0], height: 66, cutaway: { halfWidth: 44, front: 20, back: 66 }, draw: alleyScreen('lanterns') },
  alley_bamboo_screen: { foot: [0, 0], height: 66, cutaway: { halfWidth: 44, front: 24, back: 66 }, draw: alleyScreen('bamboo') },
  alley_awning_screen: { foot: [0, 0], height: 66, cutaway: { halfWidth: 44, front: 30, back: 66 }, draw: alleyScreen('awning') },
  alley_sign_screen: { foot: [0, 0], height: 66, cutaway: { halfWidth: 44, front: 22, back: 66 }, draw: alleyScreen('signs') },
  alley_flowers: { foot: [0, 0], height: 14, draw: alleyFlowers },
  entry_loose_planter: { foot: [0, 0], height: 38, drawn: 50, draw: entryDisguise('plant') },
  entry_sacks: { foot: [0, 0], height: 32, draw: entryDisguise('sacks') },
  entry_basket: { foot: [0, 0], height: 29, draw: entryDisguise('basket') },
  entry_loose_crate: { foot: [0, 0], height: 28, draw: entryDisguise('crate') },
  entry_storage: { foot: [18, 16], height: 39, draw: entryDisguise('storage') },
  entry_water_jar: { foot: [18, 16], height: 44, draw: entryDisguise('jar') },
  entry_bundles: { foot: [18, 16], height: 40, draw: entryDisguise('bundles') },
  entry_crate: { foot: [10, 20], height: 25, draw: entryEdging('crate') },
  entry_planter: { foot: [10, 20], height: 35, draw: entryEdging('planter') },
  entry_pier: { foot: [10, 20], height: 35, draw: entryEdging('pier') },
  alley_school_screen: { foot: [0, 0], height: 66, draw: alleyScreen('school') },
  alley_theatre_screen: { foot: [0, 0], height: 66, draw: alleyScreen('theatre') },
  alley_paper_screen: { foot: [0, 0], height: 66, draw: alleyScreen('paper') },
  alley_closed_gate: { foot: [62, 29], height: 46, draw: alleyClosedGate },
  square_flag: { foot: [10, 8], height: 80, draw: squareFlag },
  martial_school: { foot: [55, 110], height: 90, draw: martialSchool, labels: [{ text: '武馆', x: 0, y: -53, size: 17, font: 'Heiti SC, SimHei, Noto Sans CJK SC, sans-serif', color: GOLD }] },
  training_dummy: { foot: [17, 12], height: 36, draw: trainingDummy },
  staff_rack: { foot: [24, 16], height: 42, draw: staffRack },
  shop_duck: { foot: [61, 104], height: 83, draw: duckShop },
  theatre: { foot: [68, 118], height: 94, draw: theatre, labels: [{ text: '戏院', x: 0, y: -61, size: 17, font: 'Heiti SC, SimHei, Noto Sans CJK SC, sans-serif', color: GOLD }] },
  tea_table: { foot: [25, 4], height: 20, draw: teaTable },
  shop_books: { foot: [61, 104], height: 83, draw: shop(LAPIS, bookGoods) },
  scroll_stall: { foot: [29, 60], height: 48, draw: scrollStall },
  antique_stall: { foot: [29, 45], height: 36, draw: antiqueStall },
  school_supply: { foot: [26, 86], height: 69, draw: kiosk(LAPIS, 'cloth') },
  snack_kiosk: { foot: [26, 86], height: 69, draw: kiosk(VERMILION, 'food') },
  brush_shop: { foot: [26, 86], height: 69, draw: kiosk(JADE, 'brushes') },
  book_table: { foot: [23, 4], height: 27, draw: bookTable },
  water_temple: { foot: [47, 148], height: 118, drawn: 148, animate: true, draw: waterTemple, drawOverImage: templeGong },
  courtyard: { foot: [66, 65], height: 66, draw: courtyard },
  shop_repair: { foot: [61, 87], height: 70, draw: shop(0x3f6f8a, repairGoods) },
  shop_grocer: { foot: [61, 87], height: 70, draw: shop(0xd9a930, grocerGoods) },
  shop_tea: { foot: [61, 87], height: 70, draw: shop(0x2f7a5a, teaGoods) },
  cart: { foot: [24, 17], height: 31, draw: tricycle },
  produce_stall: { foot: [26, 12], height: 49, draw: produceStall },
  tea_stand: { foot: [23, 10], height: 48, draw: teaStand },
  laundry: { foot: [0, 0], height: 36, draw: laundry },
  post_row: { foot: [0, 0], height: 22, draw: postRow },
  lantern_post: { foot: [3, 4], height: 44, draw: lanternPost },
  poplar: { foot: [4, 6], height: 80, draw: poplar },
  signpost: { foot: [3, 4], height: 56, draw: signpost, labels: [
    { text: 'BERLIN', x: -4, y: -46.5, size: 14 },
    { text: '5 KM', property: 'distance_label', x: -4, y: -33.5, size: 11 },
  ] },
};
