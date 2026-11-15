import { Graphics } from 'pixi.js';
import { INK, PATH } from '../render/palette.ts';

/** A repeatable scatter: the same torn ground every time. */
export const scatter = (a: number, b: number) => {
  const v = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453;
  return v - Math.floor(v);
};

export const CONCRETE = 0xc9c7bc;
export const CONCRETE_LIGHT = 0xe2e0d6;
export const CONCRETE_DARK = 0xa09e93;
export const REBAR = 0x6d5a4a;

/** A broken lump of concrete, its upper left lit and its lower right dark. It stands `h` above y 0. */
export function lump(g: Graphics, cx: number, h: number, reach: number, seed: number): void {
  const edge: number[] = [];
  for (let a = 0; a < 7; a++) {
    const angle = (a / 7) * Math.PI * 2;
    const r = reach * (0.74 + 0.42 * scatter(seed, a));
    edge.push(cx + Math.cos(angle) * r, -(h + reach * 0.62 + Math.sin(angle) * r * 0.72));
  }
  const middle = [cx, -(h + reach * 0.7)];
  g.poly(edge).fill(CONCRETE);
  // Going round from the right, its corners 1 to 4 are the top and left and its corners 5, 6 and 0 the bottom and right.
  g.poly([...edge.slice(2, 10), ...middle]).fill(CONCRETE_LIGHT);
  g.poly([...edge.slice(10, 14), ...edge.slice(0, 2), ...middle]).fill(CONCRETE_DARK);
  g.poly(edge).stroke({ width: 1, color: INK, join: 'round' });
}

/** A pole with its plate `high` above the ground, lit down its left and dark down its right. */
function pole(g: Graphics, x: number, foot: number, high: number, color = 0x6d7276): void {
  g.rect(x - 1.5, foot - high, 3, high).fill(color);
  g.rect(x - 1.5, foot - high, 1, high).fill({ color: 0xffffff, alpha: 0.32 });
  g.rect(x + 0.5, foot - high, 1, high).fill({ color: INK, alpha: 0.3 });
  g.rect(x - 1.5, foot - high, 3, high).stroke({ width: 1, color: INK });
}

/** A square plate's light, from the upper left, as the generated art has it: a lit edge, its right and bottom in shade. */
function plateLight(g: Graphics, x0: number, y0: number, x1: number, y1: number): void {
  const [w, h] = [x1 - x0, y1 - y0];
  g.rect(x1 - w * 0.3, y0, w * 0.3, h).fill({ color: INK, alpha: 0.2 });
  g.rect(x0, y1 - h * 0.16, w * 0.7, h * 0.16).fill({ color: INK, alpha: 0.2 });
  g.rect(x0, y0, w, 1.1).fill({ color: 0xffffff, alpha: 0.36 });
  g.rect(x0, y0, 1.1, h).fill({ color: 0xffffff, alpha: 0.36 });
}

/**
 * Small pieces of a German street with no words on them, in the sketch: road signs (priority road, dead end, the U-Bahn's U, the
 * bus stop's H), a yellow post box, a gas lamp. Each stands on (`x`, `foot`).
 */
/** The street pieces drawStreetPiece draws; any other throws. A unit test keeps the list and the drawing together. */
export const STREET_PIECES: readonly string[] = ['priority', 'dead_end', 'ubahn', 'bus_stop', 'post_box', 'gas_lamp'];
export function drawStreetPiece(kind: string, x: number, foot: number): Graphics {
  const g = new Graphics();
  const plateY = foot - 36;
  switch (kind) {
    case 'priority':
      pole(g, x, foot, 34);
      g.poly([x, plateY - 11, x + 11, plateY, x, plateY + 11, x - 11, plateY]).fill(0xffffff);
      g.poly([x, plateY - 7, x + 7, plateY, x, plateY + 7, x - 7, plateY]).fill(0xf5c518);
      g.poly([x + 11, plateY, x, plateY + 11, x - 5.5, plateY + 5.5, x + 5.5, plateY - 5.5]).fill({ color: INK, alpha: 0.2 });
      g.moveTo(x - 9.4, plateY).lineTo(x, plateY - 9.4).stroke({ width: 1.1, color: 0xffffff, alpha: 0.5 });
      g.poly([x, plateY - 11, x + 11, plateY, x, plateY + 11, x - 11, plateY]).stroke({ width: 1.4, color: INK, join: 'round' });
      break;
    case 'dead_end':
      pole(g, x, foot, 30);
      g.roundRect(x - 8.5, plateY - 8.5, 17, 17, 1.5).fill(0x1f5fb0);
      g.rect(x - 2, plateY - 3, 4, 10).fill(0xffffff);
      g.rect(x - 6, plateY - 6, 12, 3.6).fill(0xd8352a);
      plateLight(g, x - 8.5, plateY - 8.5, x + 8.5, plateY + 8.5);
      g.roundRect(x - 8.5, plateY - 8.5, 17, 17, 1.5).stroke({ width: 1.4, color: INK });
      break;
    case 'ubahn':
      pole(g, x, foot, 34, 0x2b4a7a);
      g.roundRect(x - 9, plateY - 11, 18, 18, 1.5).fill(0x1a4fa3);
      g.moveTo(x - 4.2, plateY - 7).lineTo(x - 4.2, plateY - 1).quadraticCurveTo(x - 4.2, plateY + 3.4, x, plateY + 3.4).quadraticCurveTo(x + 4.2, plateY + 3.4, x + 4.2, plateY - 1).lineTo(x + 4.2, plateY - 7).stroke({ width: 3, color: 0xffffff });
      plateLight(g, x - 9, plateY - 11, x + 9, plateY + 7);
      g.roundRect(x - 9, plateY - 11, 18, 18, 1.5).stroke({ width: 1.4, color: INK });
      break;
    case 'bus_stop':
      pole(g, x, foot, 30);
      g.circle(x, plateY, 10).fill(0xf5c518);
      g.circle(x, plateY, 7.4).stroke({ width: 1.2, color: 0x1f8a4c });
      g.rect(x - 4, plateY - 4.5, 2.2, 9).fill(0x1f8a4c);
      g.rect(x + 1.8, plateY - 4.5, 2.2, 9).fill(0x1f8a4c);
      g.rect(x - 2, plateY - 1, 4, 2).fill(0x1f8a4c);
      g.moveTo(x + 7.1, plateY - 7.1).arc(x, plateY, 10, -Math.PI / 4, (3 * Math.PI) / 4).closePath().fill({ color: INK, alpha: 0.2 });
      // A path of its own: Pixi 8.20 starts the path after the shade from the wrong fields of its arc, a point that is not a
      // number, and this arc drew a line in from it, a spike to the middle of the screen on Android (the owner, 13 Nov).
      g.beginPath().arc(x, plateY, 8.9, (3 * Math.PI) / 4 + 0.15, (7 * Math.PI) / 4 - 0.15).stroke({ width: 1.1, color: 0xffffff, alpha: 0.5 });
      g.circle(x, plateY, 10).stroke({ width: 1.4, color: INK });
      break;
    case 'post_box':
      pole(g, x, foot, 14, 0x3d3d3d);
      g.roundRect(x - 7.5, foot - 29, 15, 17, 3).fill(0xf5c518);
      g.rect(x - 4.5, foot - 26, 9, 1.6).fill(INK);
      // The post horn, the one mark on it.
      g.moveTo(x - 4, foot - 17).quadraticCurveTo(x, foot - 23, x + 3.2, foot - 18).stroke({ width: 1.3, color: INK });
      g.poly([x + 2.2, foot - 19, x + 5, foot - 20, x + 4.4, foot - 16.2]).fill(INK);
      plateLight(g, x - 7, foot - 28.6, x + 7, foot - 12.4);
      g.roundRect(x - 7.5, foot - 29, 15, 17, 3).stroke({ width: 1.4, color: INK });
      break;
    case 'gas_lamp':
      pole(g, x, foot, 50, 0x2b4a3a);
      g.rect(x - 6, foot - 42, 12, 1.8).fill(0x2b4a3a).stroke({ width: 0.8, color: INK });
      g.poly([x - 4, foot - 50, x + 4, foot - 50, x + 7, foot - 62, x - 7, foot - 62]).fill(0xfff0b3);
      g.poly([x, foot - 50, x + 4, foot - 50, x + 7, foot - 62, x, foot - 62]).fill({ color: 0xe0a93a, alpha: 0.45 });
      g.poly([x - 4, foot - 50, x + 4, foot - 50, x + 7, foot - 62, x - 7, foot - 62]).stroke({ width: 1.1, color: INK });
      g.moveTo(x, foot - 50).lineTo(x, foot - 62).stroke({ width: 0.8, color: INK });
      g.poly([x - 8.5, foot - 62, x + 8.5, foot - 62, x, foot - 69]).fill(0x3c6650);
      g.poly([x, foot - 62, x + 8.5, foot - 62, x, foot - 69]).fill(0x223c2e);
      g.poly([x - 8.5, foot - 62, x + 8.5, foot - 62, x, foot - 69]).stroke({ width: 1.2, color: INK, join: 'round' });
      break;
    default:
      throw new Error(`No street piece called ${kind}.`);
  }
  return g;
}

/**
 * The square torn up toward the break in the Wall (the owner's arc, 30 Oct: nice West Berlin, then the jarring hole): churned dirt where the
 * setts have been lifted, deepest under the break, with a ragged edge, loose setts round it, a stack of them, wheel ruts from the
 * builders' track, and lumps of the Wall. It lies on the ground, in the box (`x`, `y`, `w`, `h`).
 */
export function drawTornGround(x: number, y: number, w: number, h: number): Graphics {
  const g = new Graphics();
  const edge: number[] = [x, y, x + w, y];
  // Dug deepest under the break: one broad darker tone inside the edge.
  const deeper: number[] = [x + w * 0.1, y, x + w * 0.9, y];
  const steps = Math.round(w / 13);
  for (let i = steps; i >= 0; i--) {
    const u = i / steps;
    const deep = h * (0.4 + 0.6 * Math.sqrt(Math.sin(Math.PI * u))) * (0.78 + 0.3 * scatter(i, 3));
    edge.push(x + u * w + (scatter(i, 7) - 0.5) * 8, y + deep);
    deeper.push(x + w * (0.1 + 0.8 * u), y + deep * 0.6);
  }
  g.poly(edge).fill(PATH).stroke({ width: 1.5, color: 0x8a6a3a, join: 'round' });
  g.poly(deeper).fill({ color: INK, alpha: 0.09 });
  // Wheel ruts, off the track along the Wall's foot and round to where the slab came down.
  for (const [off, shade] of [[0, 0x96733f], [17, 0x96733f]] as const) {
    g.moveTo(x + w, y + 6 + off).bezierCurveTo(x + w * 0.72, y + 8 + off, x + w * 0.5, y + 12 + off, x + w * 0.26, y + 2 + off).stroke({ width: 3, color: shade, cap: 'round' });
  }
  // Loose setts round the edge, some on the dirt and some on the setts still down.
  const sett = (sx: number, sy: number, turn: number) => {
    const [dx, dy] = [Math.cos(turn) * 3.2, Math.sin(turn) * 3.2];
    const corners = [sx - dx + dy, sy - dy - dx, sx + dx + dy, sy + dy - dx, sx + dx - dy, sy + dy + dx, sx - dx - dy, sy - dy + dx];
    // Its thickness, dark below and to its right, then its top with the upper left catching the light.
    g.poly(corners.map((v, i) => v + (i % 2 ? 1.6 : 1.1))).fill(0x5a554a);
    g.poly(corners).fill(0xbdb8ab).stroke({ width: 0.8, color: INK, join: 'round' });
    g.poly(corners.map((v, i) => (i % 2 ? sy - 0.8 + (v - sy) * 0.5 : sx - 0.7 + (v - sx) * 0.5))).fill(0xe2ddcf);
  };
  for (let k = 0; k < 34; k++) {
    const u = (k + scatter(k, 19)) / 34;
    const deep = h * (0.4 + 0.6 * Math.sqrt(Math.sin(Math.PI * u))) * 0.92;
    sett(x + u * w, y + deep + (scatter(k, 23) - 0.62) * 26, scatter(k, 29) * 1.5);
  }
  // A stack of them, lifted and kept to lay again.
  g.rect(x + 8, y + 27.5, 39, 2.2).fill({ color: INK, alpha: 0.22 });
  for (let row = 0; row < 4; row++) for (let k = 0; k < 5 - row; k++) {
    const [sx, sy] = [x + 8 + k * 7.5 + row * 3.75, y + 22 - row * 5.5];
    g.rect(sx, sy, 7, 5.5).fill(0xb9b4a8);
    g.rect(sx, sy, 7, 1.4).fill(0xe2ddcf);
    g.rect(sx + 4.9, sy + 1.4, 2.1, 4.1).fill(0x87837a);
    g.rect(sx, sy, 7, 5.5).stroke({ width: 0.8, color: INK });
  }
  // Lumps of the Wall, where it came down.
  for (const [lx, ly, r, seed] of [[0.42, 8, 8, 1], [0.5, 16, 11, 2], [0.61, 9, 7, 3], [0.68, 20, 9, 4], [0.35, 21, 6, 5]] as const) lump(g, x + lx * w, -(y + ly + r * 0.62), r, seed);
  return g;
}
