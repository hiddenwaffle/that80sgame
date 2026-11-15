import { Graphics } from 'pixi.js';
import { INK } from '../render/palette.ts';

export const LINE = 1.6;
export const THIN = 1;
const GLASS = 0xa6dcea;
const GLASS_LIT = 0xd9f2f7;
const LIT = 0xf9dd8a;
const CREAM = 0xf8f0d8;
const BRASS = 0xe6b23a;
const WOOD = 0x7a4a2a;

interface WindowLook { frame?: number; glass?: number; lit?: number; centre?: boolean; rail?: boolean; bars?: number }
const EAST_WINDOW: WindowLook = { frame: 0xc4c8b6, glass: 0x2f3d46, lit: 0x4c6170, centre: false, rail: false };
const BLOCK_WINDOW: WindowLook = { frame: 0xe9dfc6, glass: 0x2f4459, lit: 0x4c6b85, rail: false };

/**
 * Pens for one front, with its left at x 0 and the ground at height 0: x across and heights up, in units on the screen. Bold lines,
 * flat colour, light from the upper left, as the forest's trees and the garden have.
 */
export function pens(g: Graphics, thin = THIN) {
  const box = (x0: number, low: number, x1: number, high: number, color: number, line = thin) => {
    g.rect(x0, -high, x1 - x0, high - low).fill(color);
    if (line) g.stroke({ width: line, color: INK });
  };
  const outline = (x0: number, low: number, x1: number, high: number, line = LINE) => {
    g.rect(x0, -high, x1 - x0, high - low).stroke({ width: line, color: INK });
  };
  const shade = (x0: number, low: number, x1: number, high: number, alpha = 0.25) => {
    g.rect(x0, -high, x1 - x0, high - low).fill({ color: INK, alpha });
  };
  const shape = (points: number[], color: number, line = thin) => {
    g.poly(points.map((v, i) => (i % 2 ? -v : v))).fill(color);
    if (line) g.stroke({ width: line, color: INK });
  };
  const stroke = (x0: number, h0: number, x1: number, h1: number, width = thin, color = INK) => {
    g.moveTo(x0, -h0).lineTo(x1, -h1).stroke({ width, color, cap: 'round' });
  };
  const dot = (x: number, h: number, r: number, color: number, line = thin) => {
    g.circle(x, -h, r).fill(color);
    if (line) g.stroke({ width: line, color: INK });
  };
  /** Ink hatching where the shadow is deepest, as the trees and the garden have: diagonal strokes filling a box. */
  const hatching = (x0: number, low: number, x1: number, high: number, step = 3, width = thin * 0.7) => {
    let n = 0;
    let any = false;
    for (let t = step - (x1 - x0); t < high - low; t += step) {
      const [xs, hs] = [x0 + Math.max(0, -t), low + Math.max(0, t)];
      const long = Math.min(x1 - xs, high - hs);
      // Uneven ends, so they read as strokes of a pen and not as a patch stuck on.
      n++;
      const [from, to] = [(long * 0.18 * ((n * 7) % 5)) / 4, long * (1 - (0.34 * ((n * 3) % 4)) / 3)];
      if (to - from > 0.5) {
        g.moveTo(xs + from, -(hs + from)).lineTo(xs + to, -(hs + to));
        any = true;
      }
    }
    if (any) g.stroke({ width, color: INK, alpha: 0.8, cap: 'round' });
  };
  const darkSide = (x0: number, x1: number) => Math.min(26, (x1 - x0) * 0.2);
  /** How a wall takes the light in the generated art, from the upper left, in broad shapes: its left lit, its right dark, its foot a little dark. Goes on before its windows. */
  const wallLight = (x0: number, low: number, x1: number, high: number) => {
    const dark = darkSide(x0, x1);
    g.rect(x0, -high, (x1 - x0) * 0.3, high - low).fill({ color: 0xffffff, alpha: 0.07 });
    g.rect(x0, -high, 5, high - low).fill({ color: 0xffffff, alpha: 0.16 });
    g.rect(x1 - dark, -high, dark, high - low).fill({ color: INK, alpha: 0.15 });
    g.rect(x0, -(low + 4), x1 - x0, 4).fill({ color: INK, alpha: 0.12 });
  };
  /** What falls across a wall and its windows alike: its dark side, and the shadow under what overhangs it, hatched where the two meet. Goes on after its windows. */
  const wallShadow = (x0: number, low: number, x1: number, high: number, hang = 8) => {
    const dark = darkSide(x0, x1);
    g.rect(x1 - dark, -high, dark, high - low).fill({ color: INK, alpha: 0.08 });
    g.rect(x0, -high, x1 - x0, hang).fill({ color: INK, alpha: 0.3 });
    hatching(x1 - dark * 1.5, high - hang - 3, x1, high, 2.8);
  };
  /** The wall's dark side carried on over what stands in front of it: a shop front, a door. */
  const sideDark = (x0: number, low: number, x1: number, high: number) => {
    const dark = darkSide(x0, x1);
    g.rect(x1 - dark, -high, dark, high - low).fill({ color: INK, alpha: 0.15 });
  };
  /** The shadow under something proud of a wall, hatched toward its right end. */
  const overhang = (x0: number, low: number, x1: number, high: number, alpha = 0.28) => {
    shade(x0, low, x1, high, alpha);
    hatching(x1 - Math.min(16, (x1 - x0) * 0.18), low, x1, high, 2.4);
  };
  /** A flat panel standing proud: lit along its top and left, dark along its bottom and right, inside any ink line round it. */
  const relief = (x0: number, low: number, x1: number, high: number, d = 1.6) => {
    const [left, right, top, base] = [x0 + 0.8, x1 - 0.8, high - 0.8, low + 0.8];
    g.rect(left, -top, right - left, d).fill({ color: 0xffffff, alpha: 0.26 });
    g.rect(left, -top, d, top - base).fill({ color: 0xffffff, alpha: 0.26 });
    g.rect(left, -(base + d), right - left, d).fill({ color: INK, alpha: 0.24 });
    g.rect(right - d, -top, d, top - base).fill({ color: INK, alpha: 0.24 });
  };
  /** A slant of light on glass. */
  const glint = (x0: number, low: number, x1: number, high: number) => {
    const w = x1 - x0;
    const h = high - low;
    g.poly([x0 + 1, -(low + h * 0.3), x0 + w * 0.5, -(high - 1), x0 + w * 0.78, -(high - 1), x0 + 1, -(low + h * 0.05)]).fill({ color: 0xffffff, alpha: 0.34 });
  };
  /** A window in a pale surround, on a sill, dark under its head and down its right. Every window in the city, in its own colours. */
  const window = (cx: number, low: number, w: number, h: number, { frame = CREAM, glass = GLASS, lit = GLASS_LIT, centre = true, rail = true, bars = 0 }: WindowLook = {}) => {
    box(cx - w / 2 - 1.8, low - 1, cx + w / 2 + 1.8, low + h + 2.4, frame);
    box(cx - w / 2, low, cx + w / 2, low + h, glass);
    shape([cx - w / 2 + 0.8, low + h * 0.42, cx + w * 0.14, low + h - 0.8, cx - w / 2 + 0.8, low + h - 0.8], lit, 0);
    g.rect(cx - w / 2, -(low + h), w, 2.6).fill({ color: INK, alpha: 0.42 });
    g.rect(cx + w / 2 - 1.5, -(low + h), 1.5, h).fill({ color: INK, alpha: 0.26 });
    if (centre) stroke(cx, low, cx, low + h);
    if (rail) stroke(cx - w / 2, low + h * 0.62, cx + w / 2, low + h * 0.62);
    for (let i = 1; i <= bars; i++) stroke(cx - w / 2 + (i * w) / (bars + 1), low, cx - w / 2 + (i * w) / (bars + 1), low + h, thin * 1.1);
    box(cx - w / 2 - 3, low - 3, cx + w / 2 + 3, low - 0.6, frame);
    g.rect(cx - w / 2 - 3, -(low - 3), w + 6, 1.7).fill({ color: INK, alpha: 0.26 });
  };
  /** A box of flowers under a window's sill. */
  const flowers = (cx: number, low: number, w: number, color = 0xd8352a) => {
    box(cx - w / 2, low - 8, cx + w / 2, low - 3, 0x3c7a45);
    g.rect(cx - w / 2, -(low - 5.6), w, 2.6).fill({ color: INK, alpha: 0.24 });
    const n = Math.max(3, Math.round(w / 5));
    for (let i = 0; i < n; i++) dot(cx - w / 2 + (i + 0.5) * (w / n), low - 2.4 + (i % 2) * 1.2, 2.1, color, 0.8);
  };
  /** A pitched roof seen from the front: narrower at the ridge, its left lit and its right in shade, a few rows of tiles. */
  const roof = (x0: number, x1: number, low: number, high: number, inset: number, color: number, light: number, dark: number, rows = 3) => {
    shape([x0, low, x1, low, x1 - inset, high, x0 + inset, high], color, 0);
    const [litW, darkW] = [(x1 - x0) * 0.16, (x1 - x0) * 0.24];
    shape([x0, low, x0 + inset, high, x0 + inset + litW * 0.8, high, x0 + litW, low], light, 0);
    shape([x1, low, x1 - inset, high, x1 - inset - darkW * 0.8, high, x1 - darkW, low], dark, 0);
    for (let i = 0; i <= rows; i++) {
      const [k0, k1] = [i / (rows + 1), (i + 1) / (rows + 1)];
      const [h0, h1] = [low + (high - low) * k0, low + (high - low) * k1];
      for (let x = x0 + inset * k1 + 7 + (i % 2) * 6; x < x1 - inset * k1 - 5; x += 12) stroke(x, h0, x, h1, 0.8, dark);
      if (i < rows) stroke(x0 + inset * k1, h1, x1 - inset * k1, h1);
    }
    hatching(x1 - darkW * 0.75, low + 1, x1 - inset * 0.5 - 1, low + (high - low) * 0.48);
    g.poly([x0, -low, x1, -low, x1 - inset, -high, x0 + inset, -high]).stroke({ width: LINE, color: INK });
  };
  /** A window standing out of a roof, with its own small roof. */
  const dormer = (cx: number, low: number, w: number, h: number, color: number) => {
    box(cx - w / 2, low, cx + w / 2, low + h, CREAM);
    box(cx - w / 2 + 1.8, low + 1.6, cx + w / 2 - 1.8, low + h - 1, GLASS);
    stroke(cx, low + 1.6, cx, low + h - 1);
    g.rect(cx - w / 2 + 1.8, -(low + h - 1), w - 3.6, 1.8).fill({ color: INK, alpha: 0.42 });
    g.rect(cx + w / 2 - 3, -(low + h), 3, h).fill({ color: INK, alpha: 0.2 });
    shape([cx - w / 2 - 2.6, low + h, cx + w / 2 + 2.6, low + h, cx, low + h + 6.5], color, 0);
    g.poly([cx, -(low + h), cx + w / 2 + 2.6, -(low + h), cx, -(low + h + 6.5)]).fill({ color: INK, alpha: 0.28 });
    g.poly([cx - w / 2 - 2.6, -(low + h), cx + w / 2 + 2.6, -(low + h), cx, -(low + h + 6.5)]).stroke({ width: THIN, color: INK, join: 'round' });
  };
  const chimney = (x0: number, x1: number, low: number, high: number) => {
    box(x0, low, x1, high, 0xb5533c, LINE);
    shade(x1 - (x1 - x0) * 0.35, low, x1, high);
    box(x0 - 1.4, high, x1 + 1.4, high + 2.6, 0x8c3f2c);
  };
  const aerial = (x: number, low: number, high: number) => {
    stroke(x, low, x, high, 1.1);
    for (let i = 0; i < 3; i++) stroke(x - 7 + i * 2, high - i * 3, x + 7 - i * 2, high - i * 3, 1.1);
  };
  /** A striped awning with a scalloped edge, and its shadow on the wall. */
  const awning = (x0: number, x1: number, low: number, high: number, a: number, b: number, stripes: number) => {
    shade(x0 + 1, low - 6, x1 - 1, low, 0.26);
    const sw = (x1 - x0) / stripes;
    for (let i = 0; i < stripes; i++) {
      g.ellipse(x0 + (i + 0.5) * sw, -(low + 2.6), sw / 2, 3).fill(i % 2 ? b : a).stroke({ width: THIN, color: INK });
    }
    const top = 3.5;
    const across = (k: number, h: number) => (h === high ? x0 + top + (x1 - x0 - 2 * top) * k : x0 + (x1 - x0) * k);
    for (let i = 0; i < stripes; i++) {
      const [k0, k1] = [i / stripes, (i + 1) / stripes];
      shape([across(k0, low), low + 2.6, across(k1, low), low + 2.6, across(k1, high), high, across(k0, high), high], i % 2 ? b : a, 0);
    }
    const middle = (low + 2.6 + high) / 2;
    g.poly([x0, -(low + 2.6), x1, -(low + 2.6), x1 - top / 2, -middle, x0 + top / 2, -middle]).fill({ color: INK, alpha: 0.16 });
    hatching(x1 - 13, low + 2.6, x1 - 3, middle, 2.6);
    g.poly([x0, -(low + 2.6), x1, -(low + 2.6), x1 - top, -high, x0 + top, -high]).stroke({ width: LINE, color: INK });
  };
  /** A round sign standing out from the wall on a bar, with its picture under its shade. */
  const hanging = (x: number, h: number, r: number, color: number, from: number, picture: () => void) => {
    stroke(from, h + r * 0.4, x, h + r * 0.4, 1.3);
    dot(x, h, r, color, LINE);
    picture();
    const k = (r - 0.8) * Math.SQRT1_2;
    g.moveTo(x + k, -h - k).arc(x, -h, r - 0.8, -Math.PI / 4, (3 * Math.PI) / 4).closePath().fill({ color: INK, alpha: 0.16 });
  };
  const star = (cx: number, h: number, r: number, color: number) => {
    const points: number[] = [];
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const k = i % 2 ? r * 0.45 : r;
      points.push(cx + Math.cos(a) * k, -h + Math.sin(a) * k);
    }
    g.poly(points).fill(color).stroke({ width: 0.8, color: INK });
  };
  /** Glass double doors, clearly taller than anyone going through them. */
  const doors = (x0: number, x1: number, high: number, frame: number, glass = 0xeec66a) => {
    const mid = (x0 + x1) / 2;
    box(x0, 0, x1, high, glass, 1.3);
    glint(x0 + 1.5, 4, mid - 1, high - 3);
    glint(mid + 1, 4, x1 - 1.5, high - 3);
    g.rect(x0 + 0.8, -high, x1 - x0 - 1.6, 3.2).fill(frame);
    g.rect(x0 + 0.8, -3, x1 - x0 - 1.6, 3).fill(frame);
    g.rect(mid - 0.9, -high, 1.8, high).fill(frame);
    g.rect(x0 + 0.8, -(high - 3.2), x1 - x0 - 1.6, 3).fill({ color: INK, alpha: 0.26 });
    g.rect(x1 - 3, -(high - 3.2), 2.2, high - 3.2).fill({ color: INK, alpha: 0.16 });
    g.roundRect(mid - 4.2, -(high * 0.55), 1.7, 8, 0.8).fill(BRASS).stroke({ width: 0.8, color: INK });
    g.roundRect(mid + 2.5, -(high * 0.55), 1.7, 8, 0.8).fill(BRASS).stroke({ width: 0.8, color: INK });
    outline(x0, 0, x1, high, 1.3);
  };
  /** A panelled door with a fanlight over it, for flats and hotels. */
  const panelDoor = (x0: number, x1: number, high: number, color: number) => {
    const mid = (x0 + x1) / 2;
    box(x0 - 2, 0, x1 + 2, high + 8, CREAM);
    box(x0, high, x1, high + 6, GLASS);
    stroke(mid, high, mid, high + 6);
    box(x0, 0, x1, high, color, 1.3);
    stroke(mid, 0, mid, high, 1.3);
    for (const [a, b] of [[x0 + 2.5, mid - 2.5], [mid + 2.5, x1 - 2.5]] as const) {
      outline(a, high * 0.56, b, high - 3, 0.8);
      outline(a, 4, b, high * 0.46, 0.8);
    }
    relief(x0, 0, x1, high, 1.4);
    g.rect(x0, -high, x1 - x0, 3).fill({ color: INK, alpha: 0.26 });
    dot(mid - 2, high * 0.5, 1.2, BRASS, 0.7);
    dot(mid + 2, high * 0.5, 1.2, BRASS, 0.7);
  };
  return { box, outline, shade, shape, stroke, dot, hatching, wallLight, wallShadow, sideDark, overhang, relief, glint, window, flowers, roof, dormer, chimney, aerial, awning, hanging, star, doors, panelDoor };
}

/**
 * The department store, a West German store of its time: two full floors of about the same height, the upper a row of tall
 * windows, a long canopy over the pavement, the escalators' tall window over the doors. Its windows sell what the people
 * here would buy: hats, paint for their flags, a lamp, a TV. One sign on the roof, with no word on it.
 */
function departmentStore(g: Graphics, w: number): void {
  const { box, outline, shade, shape, stroke, dot, glint, doors, hatching, wallLight, wallShadow, sideDark, relief, roof, window } = pens(g);
  const mid = w / 2;
  const CANOPY_LOW = 50;
  const CANOPY_HIGH = 59;
  const WALL_HIGH = 113;
  const CORNICE_HIGH = 118;
  const TOP_HIGH = 132;

  // The sign on its legs and the lift's housing, behind the top floor.
  box(mid - 9, TOP_HIGH - 4, mid - 6.5, TOP_HIGH + 8, 0x4a4f55);
  box(mid + 6.5, TOP_HIGH - 4, mid + 9, TOP_HIGH + 8, 0x4a4f55);
  box(22, TOP_HIGH - 3, 44, TOP_HIGH + 9, 0xe6d7ac, LINE);
  shade(37, TOP_HIGH - 3, 44, TOP_HIGH + 9);

  // The top floor set back and sloping away, so the building has a far side and is not a box.
  roof(13, w - 13, CORNICE_HIGH, TOP_HIGH, 6, 0x7c6650, 0x957c62, 0x5f4c3b, 1);

  // The sign: a plain mark, no word.
  g.roundRect(mid - 14, -(TOP_HIGH + 26), 28, 22, 2.5).fill(0x1f5fb0).stroke({ width: LINE, color: INK });
  shape([mid, TOP_HIGH + 23, mid + 8, TOP_HIGH + 15, mid, TOP_HIGH + 7, mid - 8, TOP_HIGH + 15], 0xffffff);
  shape([mid, TOP_HIGH + 19, mid + 4, TOP_HIGH + 15, mid, TOP_HIGH + 11, mid - 4, TOP_HIGH + 15], 0xe8761e, 0);
  relief(mid - 13.4, TOP_HIGH + 4.6, mid + 13.4, TOP_HIGH + 25.4, 1.7);

  // The upper floor: a row of tall windows between its corner piers, either side of the escalators' window.
  box(0, CANOPY_HIGH, w, WALL_HIGH, 0xcdb987, LINE);
  wallLight(0, CANOPY_HIGH, w, WALL_HIGH);
  const PIER = 6;
  const PANE = 15;
  const ROWS = 3;
  const WINDOWS = 3;
  const tileH = (WALL_HIGH - CANOPY_HIGH) / ROWS;
  for (const [from, to] of [[PIER, mid - PANE], [mid + PANE, w - PIER]] as const) {
    const pitch = (to - from) / WINDOWS;
    for (let col = 0; col < WINDOWS; col++) window(from + (col + 0.5) * pitch, CANOPY_HIGH + 13, pitch - 8, 30);
  }
  box(0, CANOPY_HIGH, PIER, WALL_HIGH, 0xe6d7ac);
  box(w - PIER, CANOPY_HIGH, w, WALL_HIGH, 0xb9a678);

  // The escalators' window.
  box(mid - PANE, CANOPY_HIGH, mid + PANE, WALL_HIGH, 0x9fd6e6, LINE);
  shape([mid - PANE + 1, CANOPY_HIGH + 16, mid - PANE + 22, WALL_HIGH - 1, mid - PANE + 8, WALL_HIGH - 1, mid - PANE + 1, CANOPY_HIGH + 34], GLASS_LIT, 0);
  shape([mid + PANE - 1, CANOPY_HIGH + 1, mid + PANE - 1, CANOPY_HIGH + 22, mid + 2, CANOPY_HIGH + 1], 0x79b8cf, 0);
  for (let row = 1; row < ROWS; row++) stroke(mid - PANE, CANOPY_HIGH + row * tileH, mid + PANE, CANOPY_HIGH + row * tileH, LINE);
  stroke(mid, CANOPY_HIGH, mid, WALL_HIGH, LINE);

  // The cornice, proud of the wall, its shadow under it.
  wallShadow(0, CANOPY_HIGH, w, WALL_HIGH, 6);
  box(-2.5, WALL_HIGH, w + 2.5, CORNICE_HIGH, 0xf3e7c4, 0);
  box(-2.5, WALL_HIGH, w + 2.5, WALL_HIGH + 1.8, 0xb39c6b, 0);
  outline(-2.5, WALL_HIGH, w + 2.5, CORNICE_HIGH);

  // The ground floor: dark piers, lit windows, glass doors.
  box(0, 0, w, CANOPY_LOW, 0x4b3829, LINE);
  relief(0, 0, w, CANOPY_LOW, 2.2);
  const DOOR = 36;
  const GAP = 5;
  const SMALL = 4;
  const pane = (w - DOOR - 2 * GAP - 2 * GAP - SMALL * 2) / 4;
  const SILL = 6;
  const HEAD = 46;
  const panes = [GAP, GAP + pane + SMALL, mid + DOOR / 2 + GAP, mid + DOOR / 2 + GAP + pane + SMALL];
  // A pale ball, lit on its upper left, dark round its lower right.
  const globe = (x: number, h: number, r: number) => {
    dot(x, h, r, 0xd6c9b0, 0);
    dot(x - r * 0.16, h + r * 0.16, r * 0.78, 0xfbf3e0, 0);
    g.circle(x, -h, r).stroke({ width: THIN, color: INK });
  };
  // A blank ball on a post, as anyone here would try a hat on.
  const form = (cx: number, hat: 'top' | 'cap' | 'bobble') => {
    const c = SILL + 21;
    stroke(cx, SILL, cx, c - 6, 1.6);
    box(cx - 3.6, SILL, cx + 3.6, SILL + 1.6, INK, 0);
    globe(cx, c, 6.2);
    if (hat === 'top') {
      box(cx - 3.8, c + 5, cx + 3.8, c + 13, 0x26252b);
      box(cx - 3.8, c + 5, cx + 3.8, c + 7, 0xd8352a, 0);
      box(cx - 6.4, c + 3.8, cx + 6.4, c + 5.4, 0x26252b);
    } else if (hat === 'cap') {
      shape([cx - 6, c + 3, cx - 5, c + 8, cx + 4, c + 8.6, cx + 6, c + 4], 0x2f8c4f);
      shape([cx + 3, c + 3.6, cx + 9.6, c + 2.4, cx + 6, c + 5], 0x1f6238);
    } else {
      shape([cx - 6, c + 3, cx - 4.4, c + 8.4, cx, c + 9.6, cx + 4.4, c + 8.4, cx + 6, c + 3], 0xd8352a);
      stroke(cx - 5.6, c + 5.2, cx + 5.6, c + 5.2, 1.4, 0xf8f0d8);
      dot(cx, c + 11, 2.2, 0xf8f0d8);
    }
  };
  const tin = (cx: number, low: number, color: number) => {
    box(cx - 4.4, low, cx + 4.4, low + 8, color);
    box(cx - 4.4, low + 8, cx + 4.4, low + 9.6, 0xc5cbd0);
  };
  for (const [i, left] of panes.entries()) {
    box(left, SILL, left + pane, HEAD, LIT, 1.3);
    const c = left + pane / 2;
    if (i === 0) {
      form(c - 6.6, 'top');
      form(c + 6.6, 'bobble');
    } else if (i === 1) {
      box(c - 11, SILL, c + 1, SILL + 10, 0xf0a51e);
      box(c - 9, SILL + 10, c - 1, SILL + 17, 0x2f9c95);
      stroke(c + 6, SILL, c + 6, SILL + 22, 1.8);
      box(c + 2.6, SILL, c + 9.4, SILL + 1.8, INK, 0);
      globe(c + 6, SILL + 25, 6);
    } else if (i === 2) {
      box(c - 10.5, SILL, c + 10.5, SILL + 6, WOOD);
      g.roundRect(c - 10, -(SILL + 26), 20, 20, 1.5).fill(WOOD).stroke({ width: THIN, color: INK });
      g.roundRect(c - 8, -(SILL + 24), 12, 16, 2).fill(0xbfe8ef).stroke({ width: THIN, color: INK });
      dot(c + 7, SILL + 20, 1.2, 0xf3e7c4, 0.6);
      dot(c + 7, SILL + 14, 1.2, 0xf3e7c4, 0.6);
      stroke(c - 4, SILL + 26, c - 8, SILL + 33, 1);
      stroke(c + 2, SILL + 26, c + 6, SILL + 33, 1);
    } else {
      tin(c - 7.5, SILL, 0xd8352a);
      tin(c + 1.8, SILL, 0xf5c518);
      tin(c - 2.8, SILL + 9.6, 0x2f6fc0);
      form(c + 7.4, 'cap');
    }
    glint(left + 1, SILL + 1, left + pane - 1, HEAD - 1);
    outline(left, SILL, left + pane, HEAD, 1.3);
  }
  // A sale's round tag in one window: the sign needs no word.
  const tagX = panes[3]! + 6.2;
  const tagH = HEAD - 7;
  dot(tagX, tagH, 5, 0xd8352a);
  stroke(tagX + 2.4, tagH + 2.8, tagX - 2.4, tagH - 2.8, 1, 0xffffff);
  dot(tagX - 2, tagH + 1.9, 0.9, 0xffffff, 0);
  dot(tagX + 2, tagH - 1.9, 0.9, 0xffffff, 0);

  const doorLeft = mid - DOOR / 2;
  doors(doorLeft, mid + DOOR / 2, 47, 0x4b3829);
  box(doorLeft + 1, 42, mid + DOOR / 2 - 1, 44, 0x4b3829, 0);

  // The plinth along the pavement.
  box(0, 0, doorLeft, 3.2, 0x7d776b);
  box(mid + DOOR / 2, 0, w, 3.2, 0x7d776b);
  sideDark(0, 0, w, CANOPY_LOW);
  outline(0, 0, w, WALL_HIGH);

  // The canopy over the pavement, and the shadow it throws on the windows.
  shade(0, CANOPY_LOW - 11, w, CANOPY_LOW, 0.3);
  hatching(w * 0.78, CANOPY_LOW - 11, w, CANOPY_LOW, 2.6);
  box(-3, CANOPY_LOW, w + 3, CANOPY_HIGH, 0xe8761e, 0);
  box(-3, CANOPY_HIGH - 2.6, w + 3, CANOPY_HIGH, 0xf7a24d, 0);
  box(-3, CANOPY_LOW, w + 3, CANOPY_LOW + 2.4, 0xb4520e, 0);
  hatching(w - 13, CANOPY_LOW + 2.4, w + 3, CANOPY_HIGH - 2.6, 2.6);
  outline(-3, CANOPY_LOW, w + 3, CANOPY_HIGH);
}

/** A cup on a saucer, steaming. */
function cup(g: Graphics, cx: number, h: number, k = 1): void {
  const { box, stroke, dot } = pens(g);
  dot(cx + 3.8 * k, h + 2.4 * k, 1.9 * k, 0xf8f0d8, 0.9);
  box(cx - 3.6 * k, h, cx + 3.6 * k, h + 5 * k, 0xf8f0d8, 0.9);
  stroke(cx - 5 * k, h - 0.4, cx + 5 * k, h - 0.4, 1.3);
  stroke(cx - 1.4 * k, h + 6.2 * k, cx - 0.6 * k, h + 8.4 * k, 0.8);
  stroke(cx + 1.2 * k, h + 6.2 * k, cx + 2 * k, h + 8.4 * k, 0.8);
}

/** The Berlin bear, standing up. */
function bear(g: Graphics, cx: number, low: number, k = 1): void {
  const BROWN = 0x6b3f20;
  const { dot } = pens(g);
  g.ellipse(cx, -(low + 6 * k), 4.6 * k, 6.4 * k).fill(BROWN).stroke({ width: 0.9, color: INK });
  dot(cx - 5 * k, low + 8.4 * k, 1.8 * k, BROWN, 0.8);
  dot(cx + 5 * k, low + 8.4 * k, 1.8 * k, BROWN, 0.8);
  dot(cx - 2.8 * k, low + 16.2 * k, 1.5 * k, BROWN, 0.8);
  dot(cx + 2.8 * k, low + 16.2 * k, 1.5 * k, BROWN, 0.8);
  dot(cx, low + 13.4 * k, 3.6 * k, BROWN, 0.9);
}

/** A café and a souvenir shop under flats, on an old plastered front with a tiled roof. The left end runs off the map. */
function cafeRow(g: Graphics, w: number): void {
  const { box, outline, shade, shape, stroke, dot, glint, window, flowers, roof, dormer, chimney, awning, hanging, wallLight, wallShadow, sideDark, overhang, relief } = pens(g);
  const FLOOR = 46;
  const EAVES = 88;
  const RIDGE = 114;
  chimney(122, 134, RIDGE - 8, RIDGE + 8);
  roof(-2, w + 2, EAVES + 3, RIDGE, 13, 0xb5533c, 0xc96a4e, 0x93402c);
  dormer(50, EAVES + 8, 16, 11, 0x93402c);
  dormer(104, EAVES + 8, 16, 11, 0x93402c);

  box(0, 0, w, EAVES, 0xecc873, LINE);
  box(0, FLOOR - 1, w, FLOOR + 2.4, CREAM);
  wallLight(0, 0, w, EAVES);
  for (const cx of [36, 68, 100, 132]) window(cx, FLOOR + 9, 16, 26);
  flowers(68, FLOOR + 9, 21);
  flowers(132, FLOOR + 9, 21, 0xf5c518);
  wallShadow(0, FLOOR - 1, w, EAVES);
  box(-2, EAVES, w + 2, EAVES + 3.4, CREAM, LINE);
  overhang(0, FLOOR - 4, w, FLOOR - 1);

  // The café: dark green, a window of cakes and cups, its door, a striped awning.
  box(14, 0, 85, 40, 0x2e6b4f, LINE);
  relief(14, 0, 85, 40, 1.8);
  box(18, 9, 51, 35, LIT, 1.3);
  stroke(26, 9, 26, 15, 1.8);
  stroke(20.5, 15, 31.5, 15, 1.6);
  g.ellipse(26, -18.4, 5, 3.4).fill(0xf08fb0).stroke({ width: THIN, color: INK });
  dot(26, 22.4, 1.5, 0xd8352a, 0.8);
  cup(g, 40, 10.4, 1.2);
  cup(g, 40, 21, 1);
  stroke(34, 19.6, 49, 19.6, 1.3);
  glint(19, 10, 50, 34);
  outline(18, 9, 51, 35, 1.3);
  box(55, 0, 81, 38, LIT, 1.3);
  glint(56, 6, 80, 36);
  g.rect(55.8, -38, 24.4, 3).fill(0x1f4d38);
  g.rect(55.8, -5, 24.4, 5).fill(0x1f4d38);
  g.roundRect(58, -23, 1.8, 8, 0.8).fill(BRASS).stroke({ width: 0.8, color: INK });
  outline(55, 0, 81, 38, 1.3);
  awning(11, 88, 39, 48, 0x2e8b5f, CREAM, 9);
  hanging(84.5, 62, 5.8, CREAM, 78, () => cup(g, 83.9, 59.2, 0.68));

  // The souvenir shop: deep blue, a window with the bear, postcards and a bit of the Wall; a line of little pennants.
  box(88, 0, w - 2, 40, 0x1f4e8c, LINE);
  relief(88, 0, w - 2, 40, 1.8);
  box(92, 0, 117, 38, LIT, 1.3);
  glint(93, 6, 116, 36);
  g.rect(92.8, -38, 23.4, 3).fill(0x163a6a);
  g.rect(92.8, -5, 23.4, 5).fill(0x163a6a);
  g.roundRect(112.6, -23, 1.8, 8, 0.8).fill(BRASS).stroke({ width: 0.8, color: INK });
  outline(92, 0, 117, 38, 1.3);
  box(121, 8, w - 6, 36, LIT, 1.3);
  box(124, 8, 136, 11, 0x8a8f94);
  bear(g, 130, 11, 1.05);
  stroke(141.5, 8, 141.5, 33, 1.3);
  for (const [x, h, color] of [[138.5, 25, 0xd8352a], [144.5, 25, 0x2f8fd0], [138.5, 16, 0xf5c518], [144.5, 16, 0x2f8c4f]] as const) {
    box(x - 2.4, h, x + 2.4, h + 7, color, 0.8);
  }
  glint(122, 9, w - 7, 35);
  outline(121, 8, w - 6, 36, 1.3);
  shade(88, 31, w - 2, 40, 0.2);
  sideDark(0, 0, w - 2, 40);
  const pennants = [0xd8352a, 0xf5c518, 0x2f8fd0, 0xf8f0d8, 0x2f8c4f];
  for (let i = 0; i < 12; i++) {
    const x = 90 + i * ((w - 94) / 12);
    shape([x, 41, x + 4.4, 41, x + 2.2, 36.2], pennants[i % pennants.length]!, 0.8);
  }
  stroke(88, 41, w - 2, 41, 1.1);
  hanging(116.2, 62, 6, CREAM, 110, () => bear(g, 116.2, 57.6, 0.47));

  box(0, 0, 14, 3.2, 0x8c8678);
  outline(0, 0, w, EAVES);
}

/** A sausage on a sign, with mustard. */
function sausage(g: Graphics, cx: number, h: number): void {
  const curve = (width: number, color: number) => g.moveTo(cx - 10, -(h - 1.4)).quadraticCurveTo(cx, -(h + 3.4), cx + 10, -(h - 1.4)).stroke({ width, color, cap: 'round' });
  curve(6.4, INK);
  curve(4.6, 0xb5532a);
  const { stroke } = pens(g);
  for (let i = 0; i < 5; i++) stroke(cx - 7 + i * 3.4, h + (i % 2 ? 1.6 : -0.2), cx - 3.6 + i * 3.4, h + (i % 2 ? -0.2 : 1.6), 1.1, 0xf5d020);
}

/** A low post-war block: a snack bar with a hatch onto the pavement, and a newsagent; plain flats over them, aerials on the flat roof. */
function snackRow(g: Graphics, w: number): void {
  const { box, outline, shade, stroke, dot, window, aerial, doors, hatching, wallLight, wallShadow, sideDark, relief, glint } = pens(g);
  const FASCIA_LOW = 42;
  const FASCIA_HIGH = 51;
  const TOP = 92;
  const PARAPET = 98;
  const split = 80;
  aerial(40, PARAPET, PARAPET + 20);
  aerial(118, PARAPET, PARAPET + 15);
  box(66, PARAPET, 86, PARAPET + 7, 0xc9ced1, LINE);
  shade(80, PARAPET, 86, PARAPET + 7);

  box(0, 0, w, TOP, 0xa6d6c8, LINE);
  wallLight(0, FASCIA_HIGH, w, TOP);
  const panes = 5;
  const paneW = (w - 16) / panes;
  for (let i = 0; i < panes; i++) {
    const x0 = 8 + i * paneW + 2;
    const x1 = 8 + (i + 1) * paneW - 2;
    window((x0 + x1) / 2, 62, x1 - x0, 20, { rail: false });
  }
  wallShadow(0, FASCIA_HIGH, w, TOP);
  box(-2, TOP, w + 2, PARAPET, CREAM, LINE);
  relief(-2, TOP, w + 2, PARAPET, 1.4);

  // The snack bar: white tiles under an open hatch, a yellow fascia with the sausage on it.
  box(0, 0, split, FASCIA_LOW, CREAM, LINE);
  for (const x of [13, 26, 39, 52, 65]) stroke(x, 0, x, 20, 0.7, 0xa0967e);
  stroke(0, 7, split, 7, 0.7, 0xa0967e);
  stroke(0, 14, split, 14, 0.7, 0xa0967e);
  relief(0, 0, split, FASCIA_LOW, 1.8);
  box(5, 20, split - 5, FASCIA_LOW, 0xf2c766, 1.3);
  // Inside: sausages hanging, a pot, bottles.
  stroke(10, 37, split - 12, 37, 1.1);
  for (const x of [15, 23, 31]) g.roundRect(x - 1.8, -36.6, 3.6, 9, 1.8).fill(0xb5532a).stroke({ width: 0.8, color: INK });
  box(42, 22.4, 56, 31, 0x8e969c);
  stroke(40, 28, 58, 28, 1.3);
  for (const [x, color] of [[62, 0xd8352a], [66.4, 0xf5d020], [70.8, 0x2f8c4f]] as const) {
    box(x - 1.6, 22.4, x + 1.6, 30, color, 0.8);
    box(x - 0.7, 30, x + 0.7, 32.4, color, 0.7);
  }
  shade(5, FASCIA_LOW - 7, split - 5, FASCIA_LOW, 0.3);
  hatching(split - 22, FASCIA_LOW - 7, split - 5, FASCIA_LOW, 2.6);
  box(2, 18.4, split - 2, 22.4, 0xcfd5d8, LINE);
  shade(0, 15.4, split, 18.4, 0.22);
  hatching(split - 20, 15.4, split, 18.4, 2.4);
  box(0, FASCIA_LOW, split, FASCIA_HIGH, 0xf5c518, LINE);
  relief(0, FASCIA_LOW, split, FASCIA_HIGH, 1.7);
  sausage(g, split / 2, 46.6);

  // The newsagent: red, a door, a window of magazines, newspapers on a rack beneath.
  box(split, 0, w, FASCIA_LOW, 0xb93a2c, LINE);
  relief(split, 0, w, FASCIA_LOW, 1.8);
  doors(split + 4, split + 34, 39, 0x7c2219, 0xf6dd98);
  const shop = split + 38;
  box(shop, 9, w - 4, 38, LIT, 1.3);
  const covers = [0x2f6fc0, 0xd8352a, 0x2f8c4f, 0xf08fb0, 0xf5a81e, 0x7a3fc8];
  for (const [i, color] of covers.entries()) {
    const x = shop + 2.4 + (i % 3) * 11.4;
    const low = i < 3 ? 24 : 11;
    box(x, low, x + 9.4, low + 12, color, 0.9);
    box(x + 1.6, low + 8.6, x + 7.8, low + 10.4, 0xf8f0d8, 0);
    dot(x + 4.7, low + 4.2, 2.3, 0xf8f0d8, 0.7);
  }
  glint(shop + 1, 10, w - 5, 37);
  outline(shop, 9, w - 4, 38, 1.3);
  box(shop, 1.4, w - 4, 7.6, 0xf1ecde);
  for (const x of [shop + 8, shop + 16, shop + 24, shop + 32]) stroke(x, 1.4, x, 7.6, 0.9);
  sideDark(0, 0, w, FASCIA_LOW);
  shade(split, FASCIA_LOW - 6, w, FASCIA_LOW, 0.28);
  hatching(w - 18, FASCIA_LOW - 6, w, FASCIA_LOW, 2.6);
  box(split, FASCIA_LOW, w, FASCIA_HIGH, 0xd8352a, LINE);
  relief(split, FASCIA_LOW, w, FASCIA_HIGH, 1.7);
  const paper = split + (w - split) / 2;
  box(paper - 8, 43.6, paper + 8, 49.6, 0xf8f0d8);
  stroke(paper, 43.6, paper, 49.6, 0.8);
  stroke(paper - 6.4, 47.8, paper - 1.6, 47.8, 0.8);
  stroke(paper - 6.4, 45.6, paper - 1.6, 45.6, 0.8);
  stroke(paper + 1.6, 47.8, paper + 6.4, 47.8, 0.8);
  stroke(paper + 1.6, 45.6, paper + 6.4, 45.6, 0.8);

  outline(0, 0, w, TOP);
}

/** A tyre, lying flat in a stack. */
function tyres(g: Graphics, cx: number, count: number): void {
  const { stroke, shade } = pens(g);
  for (let i = 0; i < count; i++) {
    g.roundRect(cx - 8, -(i + 1) * 5.4, 16, 5.4, 2).fill(0x34343a).stroke({ width: THIN, color: INK });
    stroke(cx - 5.4, (i + 0.5) * 5.4, cx + 2, (i + 0.5) * 5.4, 0.9, 0x6e6e78);
    shade(cx + 3, i * 5.4 + 0.8, cx + 7.4, (i + 1) * 5.4 - 0.8, 0.34);
  }
}

/** A workshop's wide door on the ground floor, half raised, with flats over it behind plaster, a balcony, and a slate roof. */
function workshop(g: Graphics, w: number): void {
  const { box, outline, shade, stroke, dot, window, flowers, roof, dormer, chimney, aerial, panelDoor, hatching, wallLight, wallShadow, overhang } = pens(g);
  const FLOOR = 44;
  const EAVES = 86;
  const RIDGE = 110;
  chimney(28, 39, RIDGE - 8, RIDGE + 7);
  aerial(96, RIDGE, RIDGE + 13);
  roof(-2, w + 2, EAVES + 3, RIDGE, 13, 0x66788a, 0x7f92a3, 0x50606f);
  dormer(62, EAVES + 7, 15, 11, 0x50606f);
  dormer(124, EAVES + 7, 15, 11, 0x50606f);

  box(0, 0, w, EAVES, 0xdfa08e, LINE);
  wallLight(0, FLOOR, w, EAVES);
  for (const cx of [30, 66, 102, 138]) window(cx, FLOOR + 9, 17, 25);
  wallShadow(0, FLOOR, w, EAVES);
  box(-2, EAVES, w + 2, EAVES + 3.4, CREAM, LINE);

  // Stone along the ground floor.
  box(0, 0, w, FLOOR, 0xc5bba3, LINE);
  for (const h of [10, 20, 30]) stroke(0, h, w, h, 0.7, 0xa0967e);
  box(0, FLOOR - 1, w, FLOOR + 2.4, CREAM);
  wallLight(0, 0, w, FLOOR + 2.4);
  overhang(0, FLOOR - 4, w, FLOOR - 1);
  flowers(30, FLOOR + 9, 22);
  flowers(138, FLOOR + 9, 22, 0xf0a51e);

  // The balcony on the third window: a slab casting its shadow on the wall, and an iron rail.
  shade(89, FLOOR + 1.4, 115, FLOOR + 4.4, 0.3);
  box(89, FLOOR + 4.4, 115, FLOOR + 7, CREAM);
  shade(89.5, FLOOR + 4.9, 114.5, FLOOR + 5.8, 0.26);
  for (let x = 90.5; x < 115; x += 3.4) stroke(x, FLOOR + 7, x, FLOOR + 17, 0.9);
  stroke(89, FLOOR + 17, 115, FLOOR + 17, 1.4);

  // The workshop: inside in the dark a pegboard of tools and a red toolbox; the shutter half raised over it.
  const [x0, x1] = [16, 100];
  box(x0, 0, x1, 40, 0x2f3338, LINE);
  box(x0 + 8, 13, x0 + 34, 26, 0x6f6a5e);
  stroke(x0 + 13, 15, x0 + 13, 24, 1.6, 0xd7dbde);
  stroke(x0 + 21, 15, x0 + 21, 24, 1.6, 0xd7dbde);
  stroke(x0 + 28, 16, x0 + 28, 24, 1.6, 0xd7dbde);
  dot(x0 + 28, 24, 2, 0xd7dbde, 0);
  box(x0 + 44, 0, x0 + 60, 11, 0xd8352a);
  stroke(x0 + 44, 7, x0 + 60, 7, 0.9);
  box(x1 - 16, 0, x1 - 6, 3, 0x57534b, 0);
  // The raised shutter's shadow on what is under it.
  overhang(x0 + 1, 15, x1 - 1, 21, 0.34);
  box(x0 + 1, 21, x1 - 1, 40, 0x6f8fa8, 0);
  for (const h of [25, 29, 33, 37]) stroke(x0 + 1, h, x1 - 1, h, 0.9);
  box(x0 + 1, 21, x1 - 1, 23, 0x4f6c82, 0);
  shade(x0 + 1, 34, x1 - 1, 40, 0.3);
  shade(x1 - 12, 21, x1 - 1, 34, 0.16);
  hatching(x1 - 12, 23, x1 - 1, 34, 2.8);
  stroke(x0 + 1, 21, x1 - 1, 21, 1.3);
  outline(x0, 0, x1, 40);
  tyres(g, 110, 3);
  stroke(x0 + 2, 42, x1 - 2, 42, 0.8);
  // The way up to the flats.
  panelDoor(120, 148, 34, 0x2e6b4f);
  shade(w - 26, 0, 150, 42, 0.15);

  outline(0, 0, w, EAVES);
}

/** A small hotel: narrow and tall, three floors of blue plaster and white stone, a canopy over its door, stars, and a bed on its sign. */
function hotel(g: Graphics, w: number): void {
  const { box, outline, shade, stroke, shape, window, flowers, roof, dormer, chimney, panelDoor, hanging, star, wallLight, wallShadow, overhang } = pens(g);
  const FLOOR = 46;
  const SECOND = 80;
  const EAVES = 110;
  const RIDGE = 130;
  chimney(70, 80, RIDGE - 8, RIDGE + 6);
  roof(-2, w + 2, EAVES + 3, RIDGE, 11, 0x4f5f78, 0x66789a, 0x3d4b60);
  dormer(26, EAVES + 4, 14, 9, 0x3d4b60);
  dormer(62, EAVES + 4, 14, 9, 0x3d4b60);

  box(0, 0, w, EAVES, 0x8fb7d6, LINE);
  for (const low of [0, 14, 28, 42, 56, 70, 84, 98]) {
    box(0, low, 5, low + 7, CREAM);
    box(w - 5, low, w, low + 7, CREAM);
  }
  // Stone along the ground floor, and a line of it between each floor.
  box(0, 0, w, 6, 0xc5bba3);
  box(0, FLOOR - 1, w, FLOOR + 2.6, CREAM);
  box(0, SECOND - 1, w, SECOND + 2, CREAM);
  wallLight(0, 0, w, EAVES);

  for (const cx of [18, 50, 84]) window(cx, FLOOR + 8, 15, 22);
  for (const cx of [18, 50, 84]) window(cx, SECOND + 7, 15, 19);
  for (const cx of [50, 84]) window(cx, 12, 15, 25);
  flowers(18, SECOND + 7, 19);
  flowers(84, SECOND + 7, 19);
  wallShadow(0, 0, w, EAVES);
  box(-2, EAVES, w + 2, EAVES + 3.4, CREAM, LINE);
  overhang(0, FLOOR - 4, w, FLOOR - 1, 0.26);
  overhang(0, SECOND - 4, w, SECOND - 1, 0.26);

  // The balcony in the middle of the first floor, casting its shadow on the wall.
  shade(39, FLOOR + 0.6, 61, FLOOR + 3.6, 0.3);
  box(39, FLOOR + 3.6, 61, FLOOR + 6, CREAM);
  shade(39.5, FLOOR + 4.1, 60.5, FLOOR + 4.9, 0.26);
  for (let x = 40.5; x < 61; x += 3.2) stroke(x, FLOOR + 6, x, FLOOR + 15, 0.9);
  stroke(39, FLOOR + 15, 61, FLOOR + 15, 1.4);

  // The door by the forecourt, its canopy and stars; ground floor windows along from it.
  panelDoor(4, 32, 34, 0x8c2f2f);
  shape([0, 42, 36, 42, 33, 47.4, 3, 47.4], 0xb5342c, LINE);
  g.poly([0.8, -42.4, 12, -42.4, 12, -47, 3.4, -47]).fill({ color: 0xffffff, alpha: 0.2 });
  g.poly([24, -42.4, 35.2, -42.4, 32.6, -47, 24, -47]).fill({ color: INK, alpha: 0.22 });
  stroke(1, 42.6, 35, 42.6, 1.4);
  shade(1.5, 37.4, 34.5, 41.6, 0.25);
  star(9.4, 51.2, 3.4, 0xf5c518);
  star(18, 52, 3.8, 0xf5c518);
  star(26.6, 51.2, 3.4, 0xf5c518);
  hanging(67, 66, 6, CREAM, 74, () => {
    box(62.4, 63.4, 71.6, 65, 0x8c2f2f, 0.8);
    box(62.4, 63.4, 63.8, 68.2, 0x8c2f2f, 0.8);
    box(64.8, 65, 68.2, 67, 0xffffff, 0.7);
  });

  // A clipped bay in a tub beside the door.
  box(36, 0, 44, 6.6, WOOD);
  stroke(40, 6.6, 40, 11, 1.6, WOOD);
  // In lobes as the garden's bushes are, its lower right dark and its upper left lit.
  const lobes = [[40, 13.6, 4.8], [35.8, 16.6, 4], [44.2, 16.4, 4.2], [37.6, 21, 3.8], [42.6, 21.2, 3.9]] as const;
  for (const [x, h, r] of lobes) g.circle(x, -h, r).stroke({ width: LINE * 2, color: INK });
  for (const [x, h, r] of lobes) g.circle(x, -h, r).fill(0x3c9a4a);
  for (const [x, h, r] of [[42.6, 12.8, 3.4], [45.2, 15.4, 2.8], [43.8, 19.6, 2.2]] as const) g.circle(x, -h, r).fill(0x2a7a3a);
  for (const [x, h, r] of [[35.2, 17.6, 2.3], [37, 22, 2.1], [41.4, 22.4, 1.8]] as const) g.circle(x, -h, r).fill(0x6fc25f);

  outline(0, 0, w, EAVES);
}

// The middle of the guard building's door is where the Warsaw Pac enters: boss_entry on the map, 3.6 tiles along from the building's left.
const GUARD_DOOR = { x: 115.2, half: 20, high: 46 };

/** The guard building at the strip's east end: drab plaster, a dark roof, bars below, a red star over its door, shut until the Warsaw Pac comes out of it (`guardDoorOpen`). */
function guardBuilding(g: Graphics, w: number): void {
  const { box, outline, stroke, dot, star, roof, chimney, window, wallLight, wallShadow, overhang, relief } = pens(g);
  const WALL = 0x8f9a86;
  const EAVES = 81;
  const RIDGE = 116;
  const BELT = 48;
  const { x: DOOR, half: FRAME, high: DOOR_HIGH } = GUARD_DOOR;
  chimney(36, 48, RIDGE - 8, RIDGE + 8);
  roof(-3, w + 3, EAVES + 3, RIDGE, 16, 0x56605d, 0x7b8782, 0x3a4240);
  box(0, 0, w, EAVES, WALL, 0);
  box(0, BELT - 1, w, BELT + 2, 0xa7ad9b);
  box(0, 0, w, 7, 0x62665d, 0);
  stroke(0, 7, w, 7);
  wallLight(0, 0, w, EAVES);
  // Damp coming down from the eaves and the sills.
  for (const [x, long] of [[16, 15], [44, 22], [74, 12], [128, 18]] as const) g.poly([x, -EAVES, x + 8, -EAVES, x + 5, -(EAVES - long), x + 2.5, -(EAVES - long)]).fill({ color: INK, alpha: 0.13 });
  for (const cx of [20, 56, 92, 140]) window(cx, BELT + 9, 18, 18, EAST_WINDOW);
  for (const cx of [20, 56]) window(cx, 16, 18, 20, { ...EAST_WINDOW, bars: 3 });
  overhang(0, BELT - 4, w, BELT - 1);
  // A drainpipe off the eaves.
  stroke(78, EAVES, 78, 0, 2.6);
  stroke(78, EAVES, 78, 0, 1.2, 0x6d7276);
  wallShadow(0, 0, w, EAVES, 10);
  box(-3, EAVES, w + 3, EAVES + 3.4, 0x6a6f66, LINE);
  // The door, shut: two steel leaves, nothing to walk into (the owner, 31 Oct).
  box(DOOR - FRAME - 2.4, 0, DOOR + FRAME + 2.4, DOOR_HIGH + 2.6, 0xb2b6a5, LINE);
  relief(DOOR - FRAME - 2.4, 0, DOOR + FRAME + 2.4, DOOR_HIGH + 2.6, 1.2);
  for (const [from, to, color] of [[DOOR - FRAME, DOOR, 0x56645c], [DOOR, DOOR + FRAME, 0x48554e]] as const) {
    box(from, 0, to, DOOR_HIGH, color, THIN);
    relief(from, 0, to, DOOR_HIGH, 1.3);
    stroke(from + 2.4, 28, to - 2.4, 28, 1.3, 0x343e39);
  }
  g.rect(DOOR - FRAME, -DOOR_HIGH, FRAME * 2, 3).fill({ color: INK, alpha: 0.3 });
  dot(DOOR - 3, 20, 1.2, 0xc5cbd0, 0.6);
  dot(DOOR + 3, 20, 1.2, 0xc5cbd0, 0.6);
  box(DOOR - FRAME - 5, -2.4, DOOR + FRAME + 5, 0, 0xa2a497, THIN);
  // A bare lamp and the star over the door.
  stroke(DOOR, DOOR_HIGH + 2.6, DOOR, DOOR_HIGH + 5, 1.3);
  dot(DOOR, DOOR_HIGH + 6.4, 1.9, 0xf6eeb8, 0.9);
  star(DOOR, BELT + 15, 7, 0xc9281e);
  outline(0, 0, w, EAVES);
}

/** The guard building's door standing open on the dark, drawn over the shut one when the Warsaw Pac runs out. */
function guardDoorOpen(g: Graphics): void {
  const { box, shape, dot } = pens(g);
  const { x: DOOR, half: FRAME, high: DOOR_HIGH } = GUARD_DOOR;
  box(DOOR - FRAME, 0, DOOR + FRAME, DOOR_HIGH, 0x15181c, THIN);
  shape([DOOR + FRAME - 11, 0, DOOR + FRAME, 0, DOOR + FRAME, DOOR_HIGH, DOOR + FRAME - 11, DOOR_HIGH - 3], 0x3e4a4e, THIN);
  g.rect(DOOR + FRAME - 3, -(DOOR_HIGH - 1), 3, DOOR_HIGH - 1).fill({ color: INK, alpha: 0.3 });
  dot(DOOR + FRAME - 8.6, 21, 1.1, 0xc5cbd0, 0.6);
}

/**
 * A concrete watchtower big enough for a guard to stand in (the owner, 4 Nov: "much bigger for a pac to go in it"): a short
 * shaft with a door a pac fits through, a cabin a pac fits in with windows all round, a searchlight on the roof. Stocky rather
 * than tall, so the cabin stays in view from the top of the far side. Its windows are empty, as a figure in them would be
 * smaller than the guards walking past.
 */
function watchtower(g: Graphics, w: number): void {
  const { box, outline, shade, stroke, dot, hatching, relief, wallLight, wallShadow } = pens(g);
  const c = w / 2;
  const R = 18;
  const LOW = 62;
  const TOP = 110;
  box(c - R, 0, c + R, LOW, 0xc3c5b8, 0);
  box(c - R, 0, c - R + 9, LOW, 0xd3d5c8, 0);
  shade(c + R - 11, 0, c + R, LOW, 0.18);
  for (let h = 46; h < LOW; h += 16) stroke(c - R, h, c + R, h, 1, 0x7d8075);
  shade(c - R, LOW - 14, c + R, LOW - 4, 0.3);
  hatching(c + R - 12, LOW - 14, c + R, LOW - 4, 2.6);
  hatching(c + R - 11, 14, c + R, 36, 2.8);
  box(c - 11, 0, c + 11, 40, 0x4a5052, THIN);
  dot(c + 6, 19, 1.1, 0xc5cbd0, 0.5);
  outline(c - R, 0, c + R, LOW);
  // The ledge and the cabin.
  box(-2, LOW - 4, w + 2, LOW, 0x8d9085, LINE);
  box(1, LOW, w - 1, TOP, 0xb7bbad, LINE);
  wallLight(1, LOW, w - 1, TOP);
  const pane = (w - 10) / 3;
  for (let i = 0; i < 3; i++) {
    const x0 = 3 + i * (pane + 2);
    box(x0, LOW + 8, x0 + pane, TOP - 4, 0x2f3d46, THIN);
    g.poly([x0 + 1.2, -(LOW + 16), x0 + pane * 0.6, -(TOP - 5), x0 + 1.2, -(TOP - 5)]).fill(0x4c6170);
  }
  wallShadow(1, LOW, w - 1, TOP, 5);
  relief(1, LOW, w - 1, LOW + 6.5, 1.4);
  // The flat roof and the searchlight.
  box(-4, TOP, w + 4, TOP + 6, 0x3f4247, LINE);
  stroke(c, TOP + 6, c, TOP + 13, 2);
  g.roundRect(c - 8, -(TOP + 23), 16, 10, 3).fill(0x56605d).stroke({ width: THIN, color: INK });
  dot(c + 7, TOP + 17, 4.2, 0xf6eeb8, 0.9);
}

/** East Berlin's slab block, the same one in rows to the top of the map: six bays of concrete panels, five floors, balconies down the second and fifth bays with parapets in two drab colours, one door. */
function slabBlock(g: Graphics, w: number): void {
  const { box, outline, shade, stroke, window, wallLight, wallShadow, relief } = pens(g);
  const BAYS = 6;
  const FLOORS = 5;
  const STOREY = 29.4;
  const HIGH = FLOORS * STOREY;
  const bay = w / BAYS;
  const SEAM = 0x8d7f63;
  const GLASS_DARK = 0x2f4459;
  // Its shadow on the ground, falling down and to the right as the Wall's does, which keeps one block from running into the next.
  g.poly([0, 0, w, 0, w + 12, 9, 12, 9]).fill({ color: INK, alpha: 0.2 });
  box(0, 0, w, HIGH, 0xd6c6a3, 0);
  wallLight(0, 0, w, HIGH);
  // The joins between its panels.
  for (let i = 1; i < BAYS; i++) stroke(i * bay, 0, i * bay, HIGH, 1, SEAM);
  for (let floor = 1; floor < FLOORS; floor++) stroke(0, floor * STOREY, w, floor * STOREY, 1, SEAM);
  for (let floor = 0; floor < FLOORS; floor++) {
    const low = floor * STOREY;
    for (let i = 0; i < BAYS; i++) {
      const [x0, cx] = [i * bay, (i + 0.5) * bay];
      if (i === 1 || i === 4) {
        // A balcony: set into the block, its window at the back, a coloured parapet across the front, the floor above casting its shadow in.
        box(x0 + 1.6, low + 1, x0 + bay - 1.6, low + STOREY - 1, 0x4d453a);
        box(cx - 8, low + 14, cx + 8, low + STOREY - 4, GLASS_DARK, 0.8);
        stroke(cx, low + 14, cx, low + STOREY - 4, 0.8);
        g.rect(x0 + 1.6, -(low + STOREY - 1), bay - 3.2, 5).fill({ color: INK, alpha: 0.42 });
        box(x0 + 2, low + 1.6, x0 + bay - 2, low + 13, floor % 2 ? 0xbf5f45 : 0xd9a94c);
        shade(x0 + 2, low + 1.6, x0 + bay - 2, low + 5, 0.22);
        relief(x0 + 2, low + 1.6, x0 + bay - 2, low + 13, 1.3);
        stroke(x0 + 2, low + 13.8, x0 + bay - 2, low + 13.8, 1.4);
      } else if (floor > 0 || (i !== 2 && i !== 3)) {
        window(cx, low + 8.4, 17, 15, BLOCK_WINDOW);
      }
    }
  }
  // The door in the middle of the ground floor, a small window either side of it.
  const mid = w / 2;
  window(mid - 22, 10, 7, 13, BLOCK_WINDOW);
  window(mid + 22, 10, 7, 13, BLOCK_WINDOW);
  box(mid - 13, 0, mid + 13, 25, 0xb7a988);
  box(mid - 10, 0, mid + 10, 23, 0x2c3f55);
  stroke(mid, 0, mid, 23);
  shade(mid - 13, 20, mid + 13, 25, 0.3);
  box(mid - 17, 25, mid + 17, 28, 0x6d6a62);
  wallShadow(0, 0, w, HIGH, 7);
  // The flat roof's dark cap, then its top seen from above going back, lit to the left and dark to the right, a lift's housing standing on it.
  box(-1.6, HIGH, w + 1.6, HIGH + 6, 0x3f4247, LINE);
  g.poly([-1.6, -(HIGH + 6), w + 1.6, -(HIGH + 6), w - 8, -(HIGH + 20), 8, -(HIGH + 20)]).fill(0x72757a);
  g.poly([-1.6, -(HIGH + 6), w * 0.3, -(HIGH + 6), w * 0.3, -(HIGH + 20), 8, -(HIGH + 20)]).fill({ color: 0xffffff, alpha: 0.16 });
  g.poly([w * 0.76, -(HIGH + 6), w + 1.6, -(HIGH + 6), w - 8, -(HIGH + 20), w * 0.76, -(HIGH + 20)]).fill({ color: INK, alpha: 0.2 });
  g.poly([-1.6, -(HIGH + 6), w + 1.6, -(HIGH + 6), w - 8, -(HIGH + 20), 8, -(HIGH + 20)]).stroke({ width: LINE, color: INK, join: 'round' });
  box(w * 0.62, HIGH + 11, w * 0.62 + 26, HIGH + 25, 0x8d8f91, LINE);
  shade(w * 0.62 + 18, HIGH + 11, w * 0.62 + 26, HIGH + 25);
  outline(0, 0, w, HIGH);
}

/** The block is the same drawing many times over, so those of one width share one. */
const sharedSlabs = new Map<number, Graphics>();

const BUILDINGS: Record<string, (g: Graphics, w: number) => void> = {
  store: departmentStore,
  cafe_row: cafeRow,
  snack_row: snackRow,
  workshop,
  hotel,
  slab: slabBlock,
  guard_building: guardBuilding,
  guard_door_open: guardDoorOpen,
  watchtower,
};

/** A West Berlin building in code, standing on its foot at the origin, `w` wide: an upright sketch, before it has art. */
/** The buildings a placeholder can name as its `piece` (the content check reads this; an unknown one drew nothing). */
export const BUILDING_KINDS: readonly string[] = ['slab', ...Object.keys(BUILDINGS)];
export function drawBuilding(kind: string, w: number): Graphics {
  if (kind === 'slab') {
    let shared = sharedSlabs.get(w);
    if (!shared) {
      shared = new Graphics();
      slabBlock(shared, w);
      sharedSlabs.set(w, shared);
    }
    return new Graphics(shared.context);
  }
  const g = new Graphics();
  BUILDINGS[kind]?.(g, w);
  return g;
}
