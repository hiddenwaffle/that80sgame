import type { Graphics } from 'pixi.js';
import { INK } from '../render/palette.ts';
import type { FireSpot } from './fire.ts';
import { flat, starPoly, type Pt } from './geom.ts';
import { BEIJING_PROPS } from './beijing.ts';

/**
 * Scenery drawn as flat vector shapes. Each draws with its base at (0, 0), so it
 * sorts by depth with the characters: whatever stands lower on the screen is in front.
 */

export interface PropInfo {
  /** Collision box around the base when the prop is solid, in world units: half-width and height. */
  foot: [number, number];
  /** How tall its art stands, in world units: an image in its slot (`props/<kind>`) is scaled to this. */
  height: number;
  /** How tall the code drawing is, when that differs from `height`: it is scaled to match. */
  drawn?: number;
  /** How its art moves, when it has an image: swaying about its base, or pulsing. Still with Reduce motion. */
  motion?: 'sway' | 'pulse';
  /** How far a swaying prop leans, as a skew (0.04 when not given): a tall tree less, or its top moves further than a birch's. */
  swing?: number;
  /** Drawn on the ground, below everything else. */
  flatOnGround?: boolean;
  /** Opaque passage cover above its feet, in world units; excludes its ground-reaching support poles. */
  cutaway?: { halfWidth: number; front: number; back: number };
  /** Its code drawing moves with time (a sway, a pulse), so it is drawn again as time goes on. */
  animate?: boolean;
  /** A moving detail retained over a static scenery image, in the code drawing's coordinates. */
  drawOverImage?: (g: Graphics, t: number) => void;
  /** Burning: flames and smoke rising from these spots (in its units from its base), drawn over it as time goes on. */
  burning?: FireSpot[];
  /** How big a burning prop's flames are, in its units (11 when not given). */
  fireSize?: number;
  /**
   * Standing in for another kind (a local plant for a palm, a city block for an apartment), it keeps that kind's foot,
   * so walking is unchanged; with `ownFoot`, its own instead.
   */
  ownFoot?: boolean;
  /** Printed labels on a code-drawn prop, centred at each position in its drawing's units. */
  labels?: Array<{ text: string; property?: string; x: number; y: number; size: number; font?: string; color?: number }>;
  draw: (g: Graphics, t: number) => void;
}

const ink = (w = 1.4) => ({ width: w, color: INK, join: 'round' as const });

function palm(g: Graphics, t: number) {
  const sway = Math.sin(t * 1.3) * 1.2;
  const pts: Pt[] = [];
  for (let i = 0; i <= 6; i++) {
    const y = -i * 8;
    const x = Math.sin(i * 0.45) * 5 + (i / 6) * sway;
    pts.push([x - 3.2 + i * 0.25, y]);
  }
  const right: Pt[] = pts.map(([x, y], i) => [x + 6.4 - i * 0.5, y]);
  g.poly(flat([...pts, ...right.reverse()])).fill(0x9a6a3a).stroke(ink());
  for (let i = 1; i < 6; i++) g.moveTo(pts[i]![0], pts[i]![1]).lineTo(pts[i]![0] + 5.5 - i * 0.45, pts[i]![1] - 1.5).stroke(ink(0.8));
  const top: Pt = [Math.sin(6 * 0.45) * 5 + sway, -48];
  const fronds = [-2.6, -2.0, -1.2, -0.4, 0.4, 1.2, 2.0, 2.6];
  for (const a of fronds) {
    const len = 22 - Math.abs(a) * 2;
    const ex = top[0] + Math.sin(a) * len;
    const ey = top[1] - Math.cos(a) * len * 0.55 + Math.abs(a) * 5;
    const mx = (top[0] + ex) / 2 - Math.cos(a) * 3;
    const my = (top[1] + ey) / 2 - 6;
    g.poly(flat([top, [mx - 4, my], [ex, ey], [mx + 4, my + 3]])).fill(0x3f8f35).stroke(ink(1.1));
  }
  g.circle(top[0] - 2, top[1] + 3, 2.6).fill(0x6b4a2a).stroke(ink(0.8));
  g.circle(top[0] + 2.5, top[1] + 3.5, 2.6).fill(0x6b4a2a).stroke(ink(0.8));
}

function flower(color: number) {
  return (g: Graphics, t: number) => {
    const s = Math.sin(t * 2) * 0.6;
    g.moveTo(0, 0).lineTo(s, -7).stroke({ width: 1.2, color: 0x2e7d32 });
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      g.circle(s + Math.cos(a) * 2.6, -9 + Math.sin(a) * 2.6, 2.2).fill(color).stroke(ink(0.7));
    }
    g.circle(s, -9, 1.6).fill(0xffc400);
  };
}

// Plants that grow where each map is, for the look's `plants` (src/render/look.ts), in place of palms.

/** A weeping willow, by water near Beijing: a short leaning trunk, a rounded crown, and long strands hanging from it, swaying. */
function willow(g: Graphics, t: number) {
  const sway = Math.sin(t * 1.1) * 1.6;
  g.poly(flat([[-3.5, 0], [-2.5, -20], [0, -30], [3, -29], [1.5, -19], [3.5, 0]])).fill(0x7a5a3a).stroke(ink());
  g.ellipse(0, -38, 19, 12).fill(0x8fbf55).stroke(ink(1.2));
  for (let i = 0; i < 10; i++) {
    const x = -17 + i * 3.8;
    const top = -38 + Math.abs(x) * 0.35;
    const len = 16 + ((i * 7) % 5) * 3.5;
    for (const [w, c] of [[3.6, INK], [2.2, 0x6aa53f]] as const) {
      g.moveTo(x, top).quadraticCurveTo(x + sway * 0.4, top + len * 0.5, x + sway, top + len).stroke({ width: w, color: c, cap: 'round' });
    }
  }
}

/** A spruce, as in central Europe: a straight trunk under four tiers of dark needles narrowing to a point. */
function spruce(g: Graphics) {
  g.rect(-2.5, -9, 5, 9).fill(0x6b4a2a).stroke(ink(1));
  for (let k = 0; k < 4; k++) {
    const y = -7 - k * 11;
    const hw = 15 - k * 3.3;
    g.poly(flat([[-hw, y], [-hw * 0.35, y - 6], [0, y - 20], [hw * 0.35, y - 6], [hw, y]])).fill(0x2e5e3a).stroke(ink(1.1));
  }
}

/** A birch, as in central Europe: a slim white trunk with black marks, and a light, airy crown that stirs. */
function birch(g: Graphics, t: number) {
  const sway = Math.sin(t * 1.4) * 0.8;
  g.poly(flat([[-2.6, 0], [-1.8, -42], [1.8, -42], [2.6, 0]])).fill(0xf2efe6).stroke(ink(1.1));
  for (const [y, w] of [[-8, 2], [-15, 1.4], [-23, 2.2], [-31, 1.2], [-37, 1.8]] as const) g.moveTo(-1.8, y).lineTo(-1.8 + w, y - 0.6).stroke({ width: 1.3, color: INK });
  for (const [x, y, r] of [[-8, -42, 10], [7, -47, 11], [-1, -56, 9]] as const) g.circle(x + sway, y, r).fill(0xa3cc5e).stroke(ink(1.1));
}

/** A linden on a Berlin lawn: a straight dark trunk under a full crown `wide` across, `high` tall in all. */
function linden(high: number, wide: number) {
  return (g: Graphics) => {
    g.poly(flat([[-3, 0], [-2.4, -high * 0.4], [2.4, -high * 0.4], [3, 0]])).fill(0x5d4a3a).stroke(ink(1.1));
    g.ellipse(0, -high * 0.63, wide / 2, high * 0.37).fill(0x4f8a3a).stroke(ink(1.1));
  };
}

/** A garden shed, plain until it has art: a door a pac walks through, its middle 30% across, and a window. Twice a street cart's size. */
function gardenShed(g: Graphics) {
  g.poly(flat([[-48, -48], [-40, -76], [40, -76], [48, -48]])).fill(0x9a4f2e).stroke(ink());
  g.rect(-48, -48, 96, 48).fill(0xb9844a).stroke(ink());
  g.rect(-35, -42, 32, 42).fill(0x3a2a20).stroke(ink());
  g.rect(12, -38, 24, 18).fill(0x3f6fa8).stroke(ink());
}

/** A piece of the allotment, plain until it has art: `w` wide, `h` tall, standing on its foot. */
function gardenPiece(w: number, h: number, color: number) {
  return (g: Graphics) => { g.rect(-w / 2, -h, w, h).fill(color).stroke(ink()); };
}

function saveStar(g: Graphics, t: number) {
  const pulse = 1 + Math.sin(t * 3) * 0.08;
  g.circle(0, -10, 11 * pulse).fill({ color: 0xffd23f, alpha: 0.18 });
  g.poly(flat(starPoly(0, -10, 8 * pulse))).fill(0xffd23f).stroke({ width: 1.4, color: 0xfff3b0 });
}


// The props first made as sketches of the look (src/render/look.ts): the square's and the wreck's. These code drawings
// stand in with art off.

// Street things and the Wall's broken end, code drawings until there is art.

/** A striped barrier on splayed legs, closing the service road north of the Wall's end. */
function barrier(g: Graphics) {
  g.rect(-20, -25, 40, 9).fill(0xe1d3ae).stroke(ink());
  for (let x = -16; x < 20; x += 14) g.poly([x, -25, x + 7, -25, x + 1, -16, x - 6, -16]).fill(0x864e44);
  g.moveTo(-14, -16).lineTo(-18, 0).moveTo(14, -16).lineTo(18, 0).stroke(ink(3));
}

/** A banner of plain cloth between two bamboo poles (`square`), with nothing written on it. */
function banner(g: Graphics) {
  for (const x of [-36, 36]) g.rect(x - 1.5, -34, 3, 34).fill(0xc9a85a).stroke(ink(0.8));
  g.rect(-34, -30, 68, 18).fill(0xffffff).stroke(ink(1));
  for (const y of [-26, -19]) g.rect(-33, y, 66, 4).fill(0xc8102e);
}

/** A black roadster bicycle on its stand (`square`). */
function bicycle(g: Graphics) {
  for (const x of [-11, 11]) g.circle(x, -8, 8).stroke({ width: 1.6, color: INK });
  g.moveTo(-11, -8).lineTo(-2, -8).lineTo(6, -18).lineTo(-5, -18).lineTo(-11, -8).moveTo(-2, -8).lineTo(-5, -20).moveTo(6, -18).lineTo(11, -8).moveTo(6, -18).lineTo(7, -22).stroke({ width: 1.6, color: INK });
}

/**
 * The square's statue (`square`), after the students' Goddess of Democracy: a pac in pale stone with a small bow, its torch
 * upright at its back, on a plinth. Laid out as its art is, at its size; the art cuts 民主女神 into the plinth, left blank here.
 */
function statue(g: Graphics) {
  const stone = 0xece2d6, shade = 0xcdbcaa;
  g.poly(flat([[16.6, -17], [18.6, -15], [18.6, 0], [16.6, 0]])).fill(shade).stroke(ink(1.1));
  g.rect(-16.6, -17, 33.2, 17).fill(stone).stroke(ink(1.2));
  g.rect(-11.4, -50, 3, 33).fill(stone).stroke(ink(1));
  g.poly(flat([[-15, -52], [-5, -52], [-8, -47], [-12, -47]])).fill(stone).stroke(ink(1));
  g.poly(flat([[-14, -52], [-12, -57], [-10, -60], [-8, -56], [-6, -52]])).fill(stone).stroke(ink(0.9));
  g.ellipse(5, -18.5, 11, 2).fill(shade).stroke(ink(1));
  g.circle(5, -34, 15).fill(stone).stroke(ink(1.2));
  for (const [x, rx] of [[10.5, 3.6], [17.5, 2.8]] as const) {
    g.ellipse(x, -38, rx, 4.6).fill(stone).stroke(ink(1));
    g.circle(x + rx * 0.35, -38, 1.1).fill(INK);
  }
  for (const dx of [-3.6, 3.6]) g.ellipse(-1 + dx, -49, 3.2, 2).fill(stone).stroke(ink(0.9));
  g.circle(-1, -49, 1.4).fill(stone).stroke(ink(0.9));
}

/** The tank, burnt out where it stood (`wreck`): a charred hull, the turret knocked crooked, the gun down. */
function tankWreck(g: Graphics) {
  g.roundRect(-38, -16, 76, 16, 7).fill(0x2b2b2e).stroke(ink(1.3));
  g.poly(flat([[-36, -16], [-30, -30], [30, -30], [36, -16]])).fill(0x3a3d34).stroke(ink(1.3));
  g.poly(flat([[-16, -30], [-12, -46], [12, -44], [14, -30]])).fill(0x33352f).stroke(ink(1.3));
  g.poly(flat([[10, -38], [34, -14], [30, -11], [8, -33]])).fill(0x2a2b27).stroke(ink(1));
}

export const PROPS: Record<string, PropInfo> = {
  palm: { foot: [5, 6], height: 64, motion: 'sway', animate: true, draw: palm },
  flower_white: { foot: [0, 0], height: 14, motion: 'sway', animate: true, draw: flower(0xffffff) },
  flower_yellow: { foot: [0, 0], height: 14, motion: 'sway', animate: true, draw: flower(0xffd23f) },
  flower_poppy: { foot: [0, 0], height: 14, motion: 'sway', animate: true, draw: flower(0xd8321f) },
  flower_cornflower: { foot: [0, 0], height: 14, motion: 'sway', animate: true, draw: flower(0x3f7fe0) },
  flower_cosmos: { foot: [0, 0], height: 14, motion: 'sway', animate: true, draw: flower(0xf06aa8) },
  flower_lupine: { foot: [0, 0], height: 14, motion: 'sway', animate: true, draw: flower(0x7a3fc8) },
  flower_daisy: { foot: [0, 0], height: 14, motion: 'sway', animate: true, draw: flower(0xfafafa) },
  flower_marigold: { foot: [0, 0], height: 14, motion: 'sway', animate: true, draw: flower(0xf08a1e) },
  // Berlin since its redesign (2026-10-05): each foot as wide as the picture and as deep as it is tall over the 0.8 tilt.
  barrier: { foot: [20, 9], height: 29, draw: barrier },
  save_star: { foot: [0, 0], height: 22, motion: 'pulse', animate: true, draw: saveStar },
  // The local plants, standing in for palms (src/render/look.ts); their art loads only with `plants` on, and the palm's only with it off.
  willow: { foot: [5, 6], height: 70, drawn: 52, motion: 'sway', animate: true, draw: willow },
  spruce: { foot: [5, 6], height: 76, drawn: 60, draw: spruce },
  birch: { foot: [4, 6], height: 74, drawn: 65, motion: 'sway', animate: true, draw: birch },
  // Berlin's lindens, two trees so a row does not look stamped; each foot about as wide as its trunk's base.
  linden_2: { foot: [6, 6], height: 120, motion: 'sway', swing: 0.022, animate: true, draw: linden(120, 63) },
  linden_3: { foot: [4, 5], height: 90, motion: 'sway', swing: 0.028, animate: true, draw: linden(90, 50) },
  // Berlin's allotment in pieces on the map's own lawn (the owner, 30 Oct). A street cart is 48 by 31, so the shed is about twice that.
  garden_shed: { foot: [0, 0], height: 76, draw: gardenShed },
  garden_fence: { foot: [0, 0], height: 13, draw: gardenPiece(32, 13, 0xf4f1e6) },
  garden_hedge: { foot: [0, 0], height: 46, draw: gardenPiece(26, 46, 0x3f8a3a) },
  garden_bed_cabbage: { foot: [0, 0], height: 34, draw: gardenPiece(54, 34, 0x6a4a30) },
  garden_bed_beans: { foot: [0, 0], height: 34, draw: gardenPiece(54, 34, 0x6a4a30) },
  garden_bed_carrots: { foot: [0, 0], height: 34, draw: gardenPiece(54, 34, 0x6a4a30) },
  garden_bed_flowers: { foot: [0, 0], height: 34, draw: gardenPiece(54, 34, 0x6a4a30) },
  garden_bush: { foot: [0, 0], height: 26, draw: gardenPiece(30, 26, 0x4f9a3f) },
  garden_barrel: { foot: [0, 0], height: 22, draw: gardenPiece(16, 22, 0x8a5a30) },
  garden_gnome: { foot: [0, 0], height: 12, draw: gardenPiece(8, 12, 0xd8352a) },
  // The props first made as sketches of the look (src/render/look.ts): the square's.
  banner: { foot: [0, 0], height: 34, draw: banner },
  bicycle: { foot: [0, 0], height: 24, drawn: 22, draw: bicycle },
  // A pac since 2026-11-09 (the owner). Its art is drawn on a canvas 96 tall at the drawing's scale, the statue itself
  // about 60 of it; its foot is the plinth's.
  statue: { foot: [17, 10], height: 96, draw: statue },
  // Burning: flames and smoke over it, from these spots (in its units from its base). At the tank's scale since
  // 2026-10-03, 1.85 times what it was (57 tall, its flames 11 from spots within 44).
  tank_wreck: { foot: [0, 0], height: 106, drawn: 46, draw: tankWreck, burning: [[-41, -41], [-6, -82], [37, -37]], fireSize: 20 },
  // Beijing's landmarks since its redesign after the real centre (2026-10-05), in src/art/beijing.ts.
  ...BEIJING_PROPS,
};
