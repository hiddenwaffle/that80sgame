import { Graphics } from 'pixi.js';
import { INK } from '../render/palette.ts';
import { LINE, THIN, pens } from './berlin_buildings.ts';
import { lump, REBAR, scatter } from './berlin_street_sketch.ts';

const WOOD = 0xb07d45;
const WOOD_LIGHT = 0xd2a56c;
const WOOD_DARK = 0x7a4a2a;

/** A colour taken part of the way to another. */
const toward = (color: number, to: number, k: number): number => {
  const part = (shift: number) => Math.round(((color >> shift) & 255) * (1 - k) + ((to >> shift) & 255) * k);
  return (part(16) << 16) | (part(8) << 8) | part(0);
};

/** A length of timber or pipe: its colour over a wider ink line; a thick one is also lit along its upper left and dark along its lower right. */
function timber(g: Graphics, x0: number, h0: number, x1: number, h1: number, width: number, color: number): void {
  const line = (a: number, b: number, c: number, d: number, weight: number, tone: number) => g.moveTo(a, -b).lineTo(c, -d).stroke({ width: weight, color: tone, cap: 'round' });
  line(x0, h0, x1, h1, width + 1.8, INK);
  line(x0, h0, x1, h1, width, color);
  if (width < 2.4) return;
  const long = Math.hypot(x1 - x0, h1 - h0) || 1;
  // Across the length, whichever way faces the light at the upper left.
  let [nx, nh] = [-(h1 - h0) / long, (x1 - x0) / long];
  if (nh - nx < 0) [nx, nh] = [-nx, -nh];
  const off = width * 0.28;
  line(x0 + nx * off, h0 + nh * off, x1 + nx * off, h1 + nh * off, width * 0.3, toward(color, 0xffffff, 0.38));
  line(x0 - nx * off, h0 - nh * off, x1 - nx * off, h1 - nh * off, width * 0.3, toward(color, INK, 0.42));
}

/** A heap of builders' sand with a shovel stuck in it. */
function sand(g: Graphics, w: number): void {
  const { shape, stroke } = pens(g);
  const x = w * 0.62;
  timber(g, x, 10, x + 6, 33, 1.7, WOOD);
  timber(g, x + 3, 34.4, x + 9, 32.8, 1.7, WOOD_DARK);
  const pile = [0, 0, 1.5, 4, 5, 8.5, 9, 12, 13, 15.5, 17.5, 17.5, 22, 16, 26, 12.5, 30, 8, 33.5, 3.5, w, 0];
  shape(pile, 0xe9cf8b, 0);
  shape([5, 8.5, 9, 12, 13, 15.5, 17.5, 17.5, 16, 11, 10, 6], 0xf6e5b4, 0);
  shape([22, 0, 24, 6, 22, 16, 26, 12.5, 30, 8, 33.5, 3.5, w, 0], 0xcfb06a, 0);
  g.poly(pile.map((v, i) => (i % 2 ? -v : v))).stroke({ width: LINE, color: INK, join: 'round' });
  stroke(8, 5, 11, 7, 0.8);
  stroke(14, 3, 17, 5, 0.8);
  stroke(26, 4, 28, 6, 0.8);
}

/** A pallet of red bricks with a couple left on top. */
function bricks(g: Graphics, w: number): void {
  const { box, outline, stroke, shade, hatching } = pens(g);
  const RED = 0xc65a3a;
  const LIT = 0xe07d5a;
  for (const x of [1, w / 2 - 2, w - 5]) box(x, 0, x + 4, 2.4, WOOD_DARK);
  box(0, 2.4, w, 4.6, WOOD, LINE);
  const [low, high] = [4.6, 19];
  box(1, low, w - 1, high, RED, 0);
  const rows = 4;
  const rowH = (high - low) / rows;
  for (let row = 0; row < rows; row++) {
    const h = low + row * rowH;
    if (row) stroke(1, h, w - 1, h, 0.8);
    for (let x = 1 + (row % 2 ? 4 : 8); x < w - 1; x += 8) stroke(x, h, x, h + rowH, 0.8);
  }
  shade(w - 8, low, w - 1, high, 0.24);
  hatching(w - 8, low, w - 1, low + 8, 2.6);
  box(1, high, w - 1, high + 3.6, LIT, 0);
  outline(1, low, w - 1, high + 3.6);
  stroke(1, high, w - 1, high, THIN);
  box(7, high + 3.6, 18, high + 6.6, RED);
  box(7, high + 6.6, 18, high + 8.2, LIT);
}

/** The builders' bench: a plank on two trestles, a hammer, a saw, the plans in a roll, a thermos, and a bucket under it. */
function workbench(g: Graphics, w: number): void {
  const { box, shape, stroke, dot, hatching } = pens(g);
  const TOP = 20;
  for (const x of [7, w - 7]) {
    timber(g, x - 5, 0, x - 1, TOP, 2, WOOD_DARK);
    timber(g, x + 5, 0, x + 1, TOP, 2, WOOD_DARK);
  }
  timber(g, 3, 7, w - 3, 7, 1.7, WOOD);
  // The bucket, under the plank.
  shape([15, 0, 25, 0, 26.6, 9, 13.4, 9], 0x8e969c);
  g.poly([21, 0, 25, 0, 26.6, -9, 21, -9]).fill({ color: INK, alpha: 0.24 });
  g.ellipse(20, -9, 6.6, 1.6).fill(0x4e5358).stroke({ width: THIN, color: INK });
  // The thermos, behind the plank's far edge.
  g.roundRect(w - 13.5, -(TOP + 19), 6.6, 13, 1.4).fill(0xd8352a).stroke({ width: THIN, color: INK });
  box(w - 12.6, TOP + 19, w - 7.8, TOP + 21, 0xc5cbd0);
  // The plank from a little above.
  shape([0, TOP + 3.4, w, TOP + 3.4, w - 3, TOP + 8.4, 3, TOP + 8.4], WOOD_LIGHT, LINE);
  box(0, TOP, w, TOP + 3.4, WOOD, LINE);
  hatching(w - 12, TOP, w, TOP + 3.4, 2.2);
  // The plans, rolled, along the back.
  g.roundRect(6, -(TOP + 10.6), 19, 3.8, 1.9).fill(0x3f7fd0).stroke({ width: THIN, color: INK });
  stroke(11, TOP + 6.9, 11, TOP + 10.5, 0.8, 0xf8f0d8);
  // A hammer and a saw laid on it.
  timber(g, 7, TOP + 5, 16, TOP + 6, 1, WOOD_DARK);
  box(15.4, TOP + 4, 19, TOP + 7.4, 0x4e5358, 0.8);
  shape([24, TOP + 4.6, 36, TOP + 4.6, 24, TOP + 7.2], 0xd7dbde, 0.8);
  dot(22.4, TOP + 5.6, 1.5, WOOD_DARK, 0.8);
}

/** A big broken slab of the old Wall, on its back with its graffiti up, its torn end showing the steel. */
function slab(g: Graphics, w: number): void {
  const { shape, stroke, hatching } = pens(g);
  const right = w - 7;
  const face = [0, 6, right, 4, right + 4, 10, right - 2, 14, right + 3, 19, right - 4, 25, 9, 28];
  for (const [x0, h0, x1, h1] of [[right + 3, 10, right + 10, 13], [right + 2, 18, right + 8, 23], [right - 1, 23, right + 4, 29]] as const) {
    stroke(x0, h0, x1, h1, 1.2, REBAR);
  }
  shape([0, 6, right, 4, right, 0, 1, 0], 0x7f7d72, LINE);
  hatching(right - 20, 0.6, right - 1, 4, 2.4);
  shape(face, 0xb7b6ac, 0);
  // What was on it, its colours gone grubby, running off its edges.
  shape([9, 10, 23, 8, 28, 15, 20, 22, 10, 21], 0xc65f8c, 0);
  shape([30, 8, 44, 7, 47, 15, 37, 21, 31, 17], 0x3f82ae, 0);
  shape([40, 17, 50, 14, 49, 22, 42, 25], 0xd2b13f, 0);
  stroke(13, 15, 34, 13, 1.8, INK);
  stroke(34, 13, 26, 19, 1.8, INK);
  stroke(36, 11, 44, 13, 1.4, INK);
  stroke(44, 13, 39, 17, 1.4, INK);
  // The light across it and what is on it: its upper left catches it, and it falls away to the lower right.
  g.poly([0, -6, 9, -28, 16, -27.5, 6.5, -6]).fill({ color: 0xffffff, alpha: 0.36 });
  g.poly([right - 16, -4.4, right, -4, right + 4, -10, right - 2, -14, right + 3, -19, right - 4, -25, right - 12, -25.6]).fill({ color: INK, alpha: 0.2 });
  hatching(right - 12, 5, right - 3, 13, 2.6);
  // Cracks across it.
  stroke(24, 6, 29, 15, 1);
  stroke(29, 15, 26, 25, 1);
  g.poly(face.map((v, i) => (i % 2 ? -v : v))).stroke({ width: LINE, color: INK, join: 'round' });
  lump(g, right + 6, 0, 4.2, 3);
  lump(g, -2, 0, 3.4, 8);
}

/** Rubble at the foot of the break: heaps against each torn end and only a few bits across the way through. */
function rubble(g: Graphics, w: number): void {
  const { stroke } = pens(g);
  const heap = (from: number, to: number, count: number, seed: number) => {
    for (let i = 0; i < count; i++) {
      const x = from + (to - from) * ((i + scatter(seed, i)) / count);
      const reach = 3 + scatter(seed + 1, i) * 4.4;
      const h = scatter(seed + 2, i) * 11;
      if (i % 3 === 1) stroke(x, h + reach, x + 4 - scatter(seed, i) * 8, h + reach + 6, 1.2, REBAR);
      lump(g, x, h, reach, seed + i);
    }
  };
  heap(0, w * 0.27, 13, 21);
  heap(w * 0.72, w, 12, 47);
  heap(w * 0.34, w * 0.66, 4, 83);
}

/** A striped post on a rubber foot, with a builders' amber lamp on top. */
function tapePost(g: Graphics, x: number): void {
  const { box, dot, shade } = pens(g);
  const HIGH = 26;
  box(x - 5, 0, x + 5, 2.4, 0x26252b);
  box(x - 1.8, 2.4, x + 1.8, HIGH, 0xf8f0d8);
  for (let h = 2.4; h < HIGH; h += 7) box(x - 1.8, h, x + 1.8, Math.min(h + 3.5, HIGH), 0xd8352a, 0);
  shade(x + 0.4, 2.4, x + 1.8, HIGH, 0.24);
  g.rect(x - 1.8, -HIGH, 1, HIGH - 2.4).fill({ color: 0xffffff, alpha: 0.3 });
  g.rect(x - 1.8, -HIGH, 3.6, HIGH - 2.4).stroke({ width: THIN, color: INK });
  dot(x, HIGH + 2.6, 3, 0xf5a81e);
}

/** A run of barrier tape in red and white along these points, over an ink line. */
function tapeRun(g: Graphics, points: number[]): void {
  const at = (i: number): [number, number] => [points[i * 2]!, -points[i * 2 + 1]!];
  const pieces = points.length / 2 - 1;
  const line = (width: number, color: (i: number) => number) => {
    for (let i = 0; i < pieces; i++) {
      const [x0, y0] = at(i);
      const [x1, y1] = at(i + 1);
      g.moveTo(x0, y0).lineTo(x1, y1).stroke({ width, color: color(i), cap: 'round' });
    }
  };
  line(3.8, () => INK);
  line(2.2, i => (i % 2 ? 0xf8f0d8 : 0xd8352a));
}

/** Barrier tape across the break, between two posts. */
function tape(g: Graphics, w: number): void {
  const [left, right] = [3, w - 3];
  tapePost(g, left);
  tapePost(g, right);
  const points: number[] = [];
  const n = 18;
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    points.push(left + (right - left) * u, 22 - Math.sin(u * Math.PI) * 5);
  }
  tapeRun(g, points);
}

/** The same tape once someone has walked through it: down off its posts, lying along the ground. */
function tapeFallen(g: Graphics, w: number): void {
  const [left, right] = [3, w - 3];
  tapePost(g, left);
  tapePost(g, right);
  tapeRun(g, [left, 22, left + 2, 12, left + 5, 3, left + 11, 1, left + 17, 3, left + 23, 1.2, left + 28, 3.4]);
  tapeRun(g, [right, 22, right - 2, 12, right - 5, 3, right - 11, 1.2, right - 17, 3.2, right - 22, 1, right - 27, 2.6]);
}

/** The snack bar's stand-up table: a round top on one leg, a paper plate with a sausage, the mustard, a glass. */
function table(g: Graphics, w: number): void {
  const { box, stroke } = pens(g);
  const c = w / 2;
  const TOP = 24;
  g.ellipse(c, -1.4, 9.6, 2.4).fill(0x4e5358).stroke({ width: THIN, color: INK });
  box(c - 1.5, 1.4, c + 1.5, TOP - 2, 0x8e969c);
  box(c + 0.3, 1.8, c + 1, TOP - 2, 0x5d646a, 0);
  g.ellipse(c, -(TOP - 3.4), 17.6, 4.6).fill(0xb9b4a8).stroke({ width: LINE, color: INK });
  g.ellipse(c, -TOP, 17.6, 4.6).fill(0xf8f0d8).stroke({ width: LINE, color: INK });
  g.ellipse(c + 3, -(TOP - 0.8), 12.6, 2.8).fill({ color: INK, alpha: 0.09 });
  g.ellipse(c - 5, -(TOP + 0.2), 6.4, 2.1).fill(0xffffff).stroke({ width: 0.8, color: INK });
  g.roundRect(c - 9.4, -(TOP + 1.5), 8.8, 2.4, 1.2).fill(0xb5532a).stroke({ width: 0.7, color: INK });
  stroke(c - 8.4, TOP + 0.4, c - 6.8, TOP - 0.2, 0.7, 0xf5d020);
  stroke(c - 6.8, TOP - 0.2, c - 5, TOP + 0.4, 0.7, 0xf5d020);
  stroke(c - 5, TOP + 0.4, c - 3.2, TOP - 0.2, 0.7, 0xf5d020);
  g.roundRect(c + 4, -(TOP + 8.6), 3.4, 8.2, 1.2).fill(0xf5c518).stroke({ width: 0.9, color: INK });
  box(c + 5, TOP + 8.6, c + 6.4, TOP + 10.4, 0xd8352a, 0.7);
  box(c + 9.4, TOP - 0.6, c + 13, TOP + 5.2, 0xf2c766, 0.9);
}

/** The inner wall behind the strip: plain concrete panels under a flat cap, no pipe and no paint, each lit on its left and dark on its right, a streak of rain here and there. */
function innerWall(g: Graphics, w: number): void {
  const { box, outline, stroke, shade, hatching } = pens(g);
  const HIGH = 44;
  const PANEL = 64;
  // Its shadow on the ground at its foot.
  g.rect(0, 0, w, 5).fill({ color: INK, alpha: 0.2 });
  box(0, 0, w, HIGH, 0x9fa6a4, 0);
  for (let i = 0; i * PANEL < w; i++) {
    const x = i * PANEL;
    const end = Math.min(x + PANEL, w);
    box(x, 0, Math.min(x + 5, end), HIGH, 0xbcc3c0, 0);
    if (end - x > 22) {
      box(end - 13, 0, end, HIGH, 0x868d8b, 0);
      for (let k = 0; k < 2; k++) {
        if (scatter(i + 3, k) < 0.5) continue;
        const [at, wide, long] = [x + 14 + scatter(i, k + 9) * (end - x - 34), 4 + scatter(i, k) * 6, 8 + scatter(i, k + 5) * 14];
        // A short, uneven run of damp, not a spike.
        g.poly([at, -HIGH, at + wide, -HIGH, at + wide * 0.9, -(HIGH - long * 0.5), at + wide * 0.62, -(HIGH - long * 0.72), at + wide * 0.45, -(HIGH - long), at + wide * 0.2, -(HIGH - long * 0.6)]).fill({ color: INK, alpha: 0.16 });
      }
      if (scatter(i, 2) < 0.5) hatching(end - 13, HIGH - 11, end, HIGH, 2.6);
    }
    stroke(x, 0, x, HIGH, 1.3);
  }
  shade(0, HIGH - 8, w, HIGH, 0.36);
  shade(0, 0, w, 7, 0.2);
  outline(0, 0, w, HIGH);
  box(-2, HIGH, w + 2, HIGH + 4.6, 0x7a8181, 0);
  box(-2, HIGH + 3.2, w + 2, HIGH + 4.6, 0x969d9d, 0);
  outline(-2, HIGH, w + 2, HIGH + 4.6);
}

/** The signal fence along the strip: concrete posts, cranked at the top, with wire mesh between that the ground shows through. */
function signalFence(g: Graphics, w: number): void {
  const { box, stroke } = pens(g);
  const HIGH = 30;
  const BAY = 46;
  const STEP = 13;
  const WIRE = 0x2a3331;
  g.rect(0, -HIGH, w, HIGH).fill({ color: WIRE, alpha: 0.1 });
  const span = HIGH - 1;
  const inside = (a: number) => Math.max(0, Math.min(w, a));
  for (let x = -span; x < w; x += STEP) {
    const [x0, x1] = [inside(x), inside(x + span)];
    g.moveTo(x0, -(x0 - x)).lineTo(x1, -(x1 - x));
    g.moveTo(x0, -(span - (x0 - x))).lineTo(x1, -(span - (x1 - x)));
  }
  g.stroke({ width: 1, color: WIRE, alpha: 0.72 });
  stroke(0, 1, w, 1, 1.2, WIRE);
  stroke(0, HIGH, w, HIGH, 1.2, WIRE);
  stroke(0, HIGH + 6, w, HIGH + 6, 0.9, WIRE);
  for (let x = BAY / 2; x < w; x += BAY) {
    box(x - 3, 0, x + 3, 4, 0x8e918c);
    box(x + 0.6, 0.5, x + 2.5, 3.5, 0x696c67, 0);
    box(x - 2, 4, x + 2, HIGH, 0xd2d5ca);
    box(x + 0.2, 4.5, x + 1.5, HIGH - 0.5, 0x8f9288, 0);
    box(x - 1.5, 4.5, x - 0.6, HIGH - 0.5, 0xf0f2e8, 0);
    stroke(x, HIGH, x + 4, HIGH + 7, 2.4);
    stroke(x, HIGH, x + 4, HIGH + 7, 1, 0xc2c5ba);
  }
}

/** A tank trap: three steel beams crossed and riveted, gone to rust. */
function tankTrap(g: Graphics, w: number): void {
  const { dot } = pens(g);
  const c = w / 2;
  timber(g, c, 0, c + 1, 25, 3, 0x8a6349);
  timber(g, c - 11, 1, c + 9, 22, 3, 0x6a4a36);
  timber(g, c + 11, 1, c - 9, 22, 3, 0x7d5a42);
  dot(c, 11.6, 2.4, 0x4f3727, 0.9);
  dot(c - 0.6, 12.2, 0.8, 0xa98a70, 0);
}

/** A concrete light mast over the strip: bare, tall, its one lamp under a flat shade, nothing like the West's gas lamps. */
function lightMast(g: Graphics, w: number): void {
  const { box, shape } = pens(g);
  const c = w / 2;
  const HIGH = 84;
  shape([c - 2.5, 5, c + 2.5, 5, c + 1.5, HIGH, c - 1.5, HIGH], 0xbcbfb4, 0);
  g.poly([c + 0.3, -5, c + 2.5, -5, c + 1.5, -HIGH, c + 0.2, -HIGH]).fill({ color: INK, alpha: 0.26 });
  g.poly([c - 2.5, -5, c - 1.2, -5, c - 0.6, -HIGH, c - 1.5, -HIGH]).fill({ color: 0xffffff, alpha: 0.32 });
  g.poly([c - 2.5, -5, c + 2.5, -5, c + 1.5, -HIGH, c - 1.5, -HIGH]).stroke({ width: LINE, color: INK, join: 'round' });
  box(c - 4.2, 0, c + 4.2, 5, 0x8e918c);
  shape([c - 7, HIGH + 2, c + 7, HIGH + 2, c + 4.8, HIGH - 1, c - 4.8, HIGH - 1], 0xf6eeb8, THIN);
  shape([c - 9, HIGH + 2, c + 9, HIGH + 2, c + 5.6, HIGH + 6.4, c - 5.6, HIGH + 6.4], 0x3f4247, LINE);
}

/** Concrete barriers end to end closing the strip's end, seen along their length from the Wall back to the guard building: their tops running away, the near one's end to the viewer. */
function barrierLine(g: Graphics, w: number): void {
  const { box, outline, stroke, hatching, shade } = pens(g);
  const FACE = 15;
  const TOP = 70;
  box(0, FACE, w, TOP, 0xb0b3a8, 0);
  box(0, FACE, 3.4, TOP, 0xcfd2c6, 0);
  box(w - 4.6, FACE, w, TOP, 0x7b7e73, 0);
  for (let h = FACE + 13.75; h < TOP; h += 13.75) {
    stroke(0, h, w, h, 1.2);
    shade(0, h - 2.2, w, h, 0.2);
    g.rect(0, -(h + 1.6), w, 1.6).fill({ color: 0xffffff, alpha: 0.26 });
  }
  outline(0, FACE, w, TOP);
  // The near one's end, striped.
  box(0, 0, w, FACE, 0xa9aca2, 0);
  for (let i = 0; i < 4; i++) box((i * w) / 4, 2, ((i + 1) * w) / 4, FACE - 3, i % 2 ? 0xf8f0d8 : 0xd8352a, 0);
  shade(w - 4.6, 0, w, FACE, 0.24);
  hatching(w - 4.6, 2, w, FACE - 3, 2.4);
  outline(0, 0, w, FACE);
}

const ITEMS: Record<string, (g: Graphics, w: number) => void> = {
  sand,
  bricks,
  workbench,
  slab,
  rubble,
  tape,
  tape_fallen: tapeFallen,
  table,
  inner_wall: innerWall,
  signal_fence: signalFence,
  tank_trap: tankTrap,
  light_mast: lightMast,
  barrier_line: barrierLine,
};

/** A small thing in West Berlin, standing on its foot at the origin, its left at x 0, `w` wide: an upright sketch, before it has art. */
/** The items a placeholder can name as its `piece` (the content check reads this; an unknown one drew nothing). */
export const ITEM_KINDS: readonly string[] = Object.keys(ITEMS);
export function drawItem(kind: string, w: number): Graphics {
  const g = new Graphics();
  ITEMS[kind]?.(g, w);
  return g;
}
