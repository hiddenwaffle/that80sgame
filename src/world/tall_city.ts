import { Color, Container, FillGradient, Graphics, type Texture } from 'pixi.js';
import { art } from '../art/images.ts';
import { TILE } from '../content/terrain.ts';
import { INK } from '../render/palette.ts';
import { LINE, pens } from './berlin_buildings.ts';
import { GROUND_FLOOR, MIN_HIGH, hash, planBlocks, planSpans, type PlanFrame, type PlanReach, type SpanKind, type TallBlock, type TallSpan } from './tall_plan.ts';

/** Lines inside a building, thin beside the firm one round it, as the shops' pictures have them. */
const THIN = 0.65;
/** How wide a building's wall along an alley shows beside its front. */
const SIDE = 7;
/** How far a building's shadow falls across the ground, per unit of its height: to the right and a little down, as the light is from the upper left. */
const SHADOW_X = 0.14;
const SHADOW_Y = 0.05;
const SHADOW_ALPHA = 0.2;
const SHADOW_COLOR = 0x24262e;
/** How much of a figure's width counts when asking whether a building hides it, in world units: its flanks may touch a wall. */
const FIGURE_HALF_WIDTH = 10;
/** How much taller a building looks per world unit south of the middle of the view, and shorter north of it. */
const STRETCH_FAR = 6500;

interface Look { wall: number; line: number; frame: number; side: number }
const LOOKS: readonly Look[] = [
  { wall: 0x9c9c94, line: 0x7f7f78, frame: 0xc9c7b8, side: 0x74746e }, // grey brick
  { wall: 0xa9654f, line: 0x87503e, frame: 0xd6c8ae, side: 0x7c4a3a }, // red brick
  { wall: 0xc4b595, line: 0xa3947a, frame: 0xe6dcc4, side: 0x93876e }, // buff render
  { wall: 0xd3c9b1, line: 0xb3a992, frame: 0xf0e8d4, side: 0xa09783 }, // pale plaster
  { wall: 0xaeb0a6, line: 0x8e9087, frame: 0xd8d8cc, side: 0x82847b }, // concrete
];
const TILE_ROOF = 0x525a5f;
const TILE_DARK = 0x363b3f;
const SLAB = 0xd9d5c6;
const RED = 0xa33c2b;
const WASH = [0xece4cf, 0x5f86a3, 0xb0523f, 0x7e9a72, 0xd6b65a, 0x8a6f9a];

/**
 * Shades that fade to nothing, so none ends in a hard edge across a wall or a roof (the owner, 2026-11-02: "slightly see through rectangles
 * on top of each other"). One of each serves every building, stretched over whatever it fills.
 */
/** The pictures of roofs and ground floors, at the density of the street's shops: 512 px for 144 units. */
const PICTURES = 'scenery/field/tall/';
const UNITS_A_PIXEL = 144 / 512;
const makeFades = () => {
  const ink = (a: number) => new Color(INK).setAlpha(a).toRgbaString();
  // A gradient paints onto a canvas as it's filled, and the unit tests build the city with no document.
  const ramp = (x: number, y: number, stops: Array<[number, string]>) =>
    typeof document === 'object' ? new FillGradient({ type: 'linear', start: { x: 0, y: 0 }, end: { x, y }, colorStops: stops.map(([offset, color]) => ({ offset, color })), textureSpace: 'local' }) : { color: 0, alpha: 0 };
  return {
    /** Under what overhangs: darkest at the top. */
    under: ramp(0, 1, [[0, ink(0.38)], [1, ink(0)]]),
    /** A mark running down a wall from a sill. */
    stain: ramp(0, 1, [[0, ink(0.12)], [1, ink(0)]]),
    /** Light falling off toward the ground. */
    foot: ramp(0, 1, [[0, ink(0)], [1, ink(0.2)]]),
    /** A wall's far side, away from the light. */
    far: ramp(1, 0, [[0, ink(0)], [1, ink(0.2)]]),
    /** A wall's near edge, in the light. */
    near: ramp(1, 0, [[0, 'rgba(255,255,255,0.16)'], [1, 'rgba(255,255,255,0)']]),
    /** A roof: its left end lit, its right in shade. */
    roof: ramp(1, 0, [[0, 'rgba(255,255,255,0.12)'], [0.25, 'rgba(255,255,255,0)'], [0.7, ink(0)], [1, ink(0.24)]]),
  };
};
let fades: ReturnType<typeof makeFades> | undefined;

const mix = (a: number, b: number, t: number): number => {
  const ch = (s: number) => Math.round(((a >> s) & 255) * (1 - t) + ((b >> s) & 255) * t) << s;
  return ch(16) | ch(8) | ch(0);
};

/** Draws a building's front and says how high it stands: its roof's top, or a narrow wall's coping. */
function drawFront(g: Graphics, b: TallBlock, whole: number): number {
  const p = pens(g, THIN);
  const fade = (fades ??= makeFades());
  /** The shade under something overhanging, from height `top` down by `depth`. */
  const under = (x0: number, top: number, x1: number, depth: number) => { g.rect(x0, -top, x1 - x0, depth).fill(fade.under); };
  /** A picture with its foot at height `low`. */
  const picture = (texture: Texture, x: number, low: number, pw: number, ph: number) => { g.texture(texture, 0xffffff, x, -(low + ph), pw, ph); };
  const sL = b.insetL ? Math.min(SIDE, whole * 0.15) : 0;
  const sR = b.insetR ? Math.min(SIDE, whole * 0.15) : 0;
  // The face, between the walls along its alleys. Everything on it is drawn from its own left.
  const w = whole - sL - sR;
  const look = LOOKS[b.look]!;
  const F = b.floorH;
  const rnd = (k: number) => hash(b.seed, b.id, k);
  const bays = Math.max(1, Math.floor(w / 34));
  const bayW = w / bays;
  // Narrower than one bay, a building has no room for a door or a window: it is a plain wall to the top (the owner, 2026-11-02: "It's
  // almost like this should just be a wall").
  const narrow = w < 34;
  // How high the building is drawn: a narrow wall to its coping, any other to its roof. The fades toward the foot stop there, so a
  // building lower than they are tall doesn't darken what's behind it.
  const drawnTop = narrow ? b.wall + 3 : b.total;
  const cx = (i: number) => (i + 0.5) * bayW;
  const lows: number[] = [0];
  for (let i = 1; i < b.floors; i++) lows.push(GROUND_FLOOR + (i - 1) * F);
  // The top floor stands back from one end of some buildings, on a terrace.
  // One standing over a walkway keeps its full height across, or the people behind it would show over the terrace.
  const stepped = b.floors >= 4 && w >= 90 && !b.bare && rnd(1) < 0.5;
  const stepW = stepped ? Math.round(bayW * (rnd(2) < 0.6 ? 1 : 2)) : 0;
  const stepLeft = rnd(3) < 0.5;
  const topLow = lows[lows.length - 1]!;
  const [topX0, topX1] = stepped ? (stepLeft ? [stepW, w] : [0, w - stepW]) : [0, w];

  const clothes = (x0: number, x1: number, h: number) => {
    // Each line has its own run of things: a shirt, trousers, a towel, each its own shape.
    let n = Math.round(x0 * 7 + h * 13);
    for (let x = x0 + 3; x < x1 - 6; x += 2 + rnd(n) * 5) {
      const [cw, ch] = [6 + rnd(n + 7) * 4, 8 + rnd(n + 13) * 6];
      const color = WASH[Math.floor(rnd(n + 21) * WASH.length)]!;
      const kind = rnd(n + 27);
      if (kind < 0.35) p.shape([x, h, x + cw, h, x + cw + 2, h - 3, x + cw, h - 4.2, x + cw - 0.6, h - 3, x + cw - 0.6, h - ch, x + 0.6, h - ch, x + 0.6, h - 3, x, h - 4.2, x - 2, h - 3], color, 0.6);
      else if (kind < 0.6) p.shape([x, h, x + cw, h, x + cw + 0.4, h - ch, x + cw * 0.62, h - ch, x + cw / 2, h - 3, x + cw * 0.38, h - ch, x - 0.4, h - ch], color, 0.6);
      else p.shape([x, h, x + cw, h, x + cw, h - ch + rnd(n + 31) * 2.5, x, h - ch], color, 0.6);
      // A fold down it.
      p.stroke(x + cw * 0.62, h - 1, x + cw * (0.5 + rnd(n + 33) * 0.2), h - ch + 1.5, 0.5, mix(color, INK, 0.32));
      x += cw;
      n++;
    }
    // Over the clothes' top edges, so they hang from it.
    p.stroke(x0, h, x1, h, 0.9, 0x3a3a3a);
  };
  const pots = (x0: number, x1: number, h: number) => {
    // Never quite a row: their sizes, what grows in them and the gaps between differ.
    let n = Math.round(x0 * 11 + h * 5);
    for (let x = x0 + rnd(n) * 2; x < x1 - 2; x += 2 + rnd(n + 2) * 5) {
      const [pw, ph] = [3.4 + rnd(n + 3) * 1.8, 2.8 + rnd(n + 4) * 1.4];
      const mid = x + pw / 2;
      const kind = rnd(n + 5);
      const green = rnd(n + 6) < 0.5 ? 0x4f7f4a : 0x6c9a55;
      if (kind < 0.45) {
        // A leafy clump, lopsided.
        for (let k = 0; k < 3; k++) p.dot(mid + (k - 1) * (1.3 + rnd(n + 7 + k)), h + ph + 1.6 + rnd(n + 11 + k) * 2.4, 1.2 + rnd(n + 15 + k) * 0.9, k === 1 ? mix(green, 0xffffff, 0.14) : green, 0.45);
      } else if (kind < 0.8) {
        // Stems and a leaf or two.
        for (let k = 0; k < 3; k++) {
          const [tx, th] = [mid + (k - 1) * (1.6 + rnd(n + 7 + k)), h + ph + 3 + rnd(n + 11 + k) * 3];
          p.stroke(mid, h + ph, tx, th, 0.6, 0x3f6b3f);
          p.dot(tx, th, 0.9, green, 0.3);
        }
      } else {
        // In flower.
        for (let k = 0; k < 3; k++) p.stroke(mid, h + ph, mid + (k - 1) * 1.5, h + ph + 2.6, 0.6, 0x3f6b3f);
        for (let k = 0; k < 3; k++) p.dot(mid + (k - 1) * 1.6, h + ph + 3 + (k % 2) * 0.8, 0.9, rnd(n + 9) < 0.5 ? 0xd8352a : 0xe2b93f, 0.3);
      }
      p.shape([x, h, x + pw, h, x + pw + 0.5, h + ph, x - 0.5, h + ph], 0x9d5a3c, 0.5);
      x += pw;
      n++;
    }
  };
  const quilt = (x: number, top: number, qw: number, qh: number, k: number) => {
    const color = WASH[Math.floor(rnd(k) * WASH.length)]!;
    p.shape([x, top + 1.5, x + qw, top + 1.5, x + qw, top - qh + rnd(k + 1) * 3, x + qw * 0.5, top - qh - 0.4, x, top - qh + rnd(k + 2) * 2], color, 0.65);
    // Laid over the rail: it folds there and hangs in soft creases.
    p.shade(x, top - 0.4, x + qw, top + 1.5, 0.16);
    p.stroke(x + qw * 0.28, top - 1, x + qw * (0.22 + rnd(k + 3) * 0.1), top - qh + 2, 0.45, mix(color, INK, 0.3));
    p.stroke(x + qw * 0.68, top - 1, x + qw * (0.64 + rnd(k + 4) * 0.12), top - qh + 2, 0.45, mix(color, INK, 0.3));
  };
  const stovePipe = (x: number, h: number) => {
    p.stroke(x, h, x + 8, h, 2.4, 0x4f5355);
    p.stroke(x + 8, h, x + 8, h + 15, 2.4, 0x4f5355);
    p.stroke(x + 5.5, h + 15, x + 10.5, h + 15, 1.6, 0x3f4345);
  };
  const glassWindow = (x: number, low: number, ww = 14, wh = 17, bars = 0) => {
    const v = rnd(Math.round(x * 3 + low * 5) + 500);
    // Not every pane catches the sky.
    p.window(x, low, ww, wh, { frame: look.frame, glass: 0x34424c, lit: v < 0.4 ? 0x5a7080 : v < 0.7 ? 0x46565f : 0x3b4a54, centre: true, rail: false, bars });
    // A few have a curtain across one side.
    if (v > 0.8) {
      const left = v > 0.9;
      g.rect(left ? x - ww / 2 + 0.3 : x + 0.3, -(low + wh - 2.6), ww / 2 - 0.6, (wh - 2.6) * (0.5 + (v - 0.8) * 3)).fill({ color: 0xe3dbc4, alpha: 0.82 });
    }
    // Rain has marked the wall under some sills.
    if (v < 0.3) {
      g.rect(x - ww / 2 + 2, -(low - 3), ww - 4, 8).fill(fade.stain);
    }
  };
  /** A concrete edge standing proud: its top catches the light, its underside doesn't. */
  const slab = (x0: number, low: number, x1: number, high: number, line = THIN) => {
    p.box(x0, low, x1, high, SLAB, line);
    g.rect(x0 + 0.4, -(high - 0.3), x1 - x0 - 0.8, 0.7).fill({ color: 0xffffff, alpha: 0.6 });
    g.rect(x0 + 0.4, -(low + 0.9), x1 - x0 - 0.8, 0.7).fill({ color: INK, alpha: 0.2 });
  };
  const door = (x: number, low: number, h: number, dw: number, color: number) => {
    p.box(x - dw / 2 - 1.8, low, x + dw / 2 + 1.8, low + h + 2, look.frame, THIN);
    p.box(x - dw / 2, low, x + dw / 2, low + h, color, THIN);
    p.shade(x - dw / 2, low + h - 3, x + dw / 2, low + h, 0.35);
    p.stroke(x, low, x, low + h, 0.8);
    p.dot(x + dw / 4, low + h * 0.45, 0.9, 0xd4bd75, 0.5);
  };
  const lattice = (x: number, low: number, ww: number, wh: number) => {
    p.box(x - ww / 2, low, x + ww / 2, low + wh, 0xe0d2a9, 0.8);
    for (let k = 1; k < 3; k++) p.stroke(x - ww / 2 + (k * ww) / 3, low, x - ww / 2 + (k * ww) / 3, low + wh, 0.5, 0x805941);
    for (let k = 1; k < 3; k++) p.stroke(x - ww / 2, low + (k * wh) / 3, x + ww / 2, low + (k * wh) / 3, 0.5, 0x805941);
    p.shade(x - ww / 2, low + wh - 2.5, x + ww / 2, low + wh, 0.3);
  };
  // A wall along an alley, going back from the front's corner: its foot and floors climb away from the corner, as the ground does, and it stays still.
  const alleyWall = (corner: number, edge: number, high: number, lit: boolean) => {
    const rise = Math.abs(edge - corner) * 0.9;
    const up = (x: number) => (Math.abs(x - corner) / Math.abs(edge - corner)) * rise;
    p.shape([corner, 0, edge, rise, edge, high + rise, corner, high], lit ? mix(look.side, 0xffffff, 0.14) : mix(look.side, INK, 0.1), 0);
    const [x1, x2] = [corner + (edge - corner) * 0.26, corner + (edge - corner) * 0.76];
    for (let f = 1; f < (narrow ? 1 : b.floors); f++) {
      const h = lows[f]!;
      if (h >= high) break;
      p.stroke(corner, h, edge, h + rise, 0.9, mix(look.side, INK, 0.45));
      const [wl, wh] = [h + F * 0.3, h + F * 0.74];
      p.shape([x1, wl + up(x1), x2, wl + up(x2), x2, wh + up(x2), x1, wh + up(x1)], 0x2f3a42, 0);
      p.stroke(x1, wl + up(x1) - 1, x2, wl + up(x2) - 1, 1.1, look.frame);
    }
    // Darker toward the ground, as the light falls off down the alley.
    const dark = Math.min(GROUND_FLOOR * 1.2, narrow ? high : drawnTop);
    g.poly([corner, 0, edge, -rise, edge, -(dark + rise), corner, -dark]).fill(fade.foot);
    p.stroke(corner, 0, edge, rise, THIN);
    p.stroke(edge, rise, edge, high + rise, THIN);
  };
  if (sL) alleyWall(sL, 0, stepped && stepLeft ? topLow : b.wall, true);
  if (sR) alleyWall(whole - sR, whole, stepped && !stepLeft ? topLow : b.wall, false);
  g.translateTransform(sL, 0);

  // The wall, its bricks, its light. Each floor is drawn from the ground up, so what stands proud above throws its shadow over what is below.
  p.box(0, 0, w, stepped ? topLow : b.wall, look.wall, 0);
  if (stepped) p.box(topX0, topLow, topX1, b.wall, look.wall, 0);
  // The bricks show in patches, toward the wall's ends and low down; its middle stays quiet. Render shows a crack or a mended patch instead.
  const brick = b.look < 2;
  for (let k = 0; k < (w * b.wall) / 3200; k++) {
    const e = rnd(k + 40);
    const px = (e < 0.5 ? 2 * e * e : 1 - 2 * (1 - e) * (1 - e)) * Math.max(1, w - 22);
    const ph = (1 - rnd(k + 90) ** 2) * Math.max(1, b.wall - 18) + 5;
    if (brick) {
      const rows = 3 + Math.floor(rnd(k + 130) * 3);
      for (let r = 0; r < rows; r++) {
        const y = ph + r * 3;
        const start = px + (r % 2) * 3.5 + rnd(k + r + 140) * 2.5;
        const bricks = 1 + Math.floor(rnd(k + r + 150) * 3);
        g.moveTo(start, -y).lineTo(start + bricks * 7, -y);
        for (let j = 0; j <= bricks; j++) g.moveTo(start + j * 7, -y).lineTo(start + j * 7, -(y + 3));
      }
    } else if (rnd(k + 160) < 0.6) {
      const [dx, dh] = [3 + rnd(k + 170) * 4, 4 + rnd(k + 171) * 5];
      g.moveTo(px, -ph).lineTo(px + dx, -(ph - dh)).lineTo(px + dx * 0.6, -(ph - dh * 2)).lineTo(px + dx * 1.5, -(ph - dh * 3));
    } else {
      const [pw, ph2] = [9 + rnd(k + 180) * 12, 6 + rnd(k + 181) * 7];
      g.poly([px, -ph, px + pw, -(ph + rnd(k + 182) * 2), px + pw - rnd(k + 183) * 3, -(ph + ph2), px + rnd(k + 184) * 3, -(ph + ph2 - rnd(k + 185) * 2)]);
    }
  }
  g.stroke({ width: 0.5, color: look.line, cap: 'round' });
  const faceTop = stepped ? topLow : b.wall;
  const farWidth = Math.min(26, w * 0.2);
  g.rect(0, -faceTop, Math.min(10, w * 0.2), faceTop).fill(fade.near);
  // Light falls off down the canyon.
  const canyon = Math.min(GROUND_FLOOR * 1.3, drawnTop);
  g.rect(0, -canyon, w, canyon).fill(fade.foot);

  // The ground floor.
  p.box(0, 0, w, 5, mix(look.wall, INK, 0.38), 0);
  const doorBay = Math.floor(rnd(4) * bays);
  for (let i = 0; i < (narrow ? 0 : bays); i++) {
    const q = rnd(i + 500);
    const front = art(`${PICTURES}${i === doorBay ? 'ground_door' : b.style === 'timber' || q < 0.45 ? 'ground_lattice' : q < 0.85 ? 'ground_barred' : 'ground_hatch'}`);
    // One bay is 34 units across and a ground floor 40. A narrower bay takes a smaller picture, never a larger one.
    const fit = Math.min(1, bayW / 34);
    if (front) picture(front, cx(i) - 17 * fit, 0, 34 * fit, 40 * fit);
    else if (i === doorBay) door(cx(i), 0, 30, 14, rnd(5) < 0.55 ? 0x8f3f2e : 0x4f6f5f);
    else if (b.style === 'timber') lattice(cx(i), 12, 18, 16);
    else glassWindow(cx(i), 12, 14, 16, 3);
  }
  if (b.floors > 1 && !narrow) p.stroke(0, GROUND_FLOOR - 1, w, GROUND_FLOOR - 1, 1.2, look.line);

  for (let f = 1; f < b.floors; f++) {
    const low = lows[f]!;
    const top = f === b.floors - 1;
    const [x0, x1] = top ? [topX0, topX1] : [0, w];
    const fw = x1 - x0;
    if (b.style === 'gallery') {
      // An open corridor along the whole floor, the doors at the back of it in the dark.
      p.box(x0 + 2, low + 3, x1 - 2, low + F, mix(look.wall, INK, 0.5), 0);
      for (let x = x0 + 14, n = 0; x < x1 - 8; x += 30, n++) {
        door(x, low + 4, 23, 10, n % 3 === 1 ? 0x4f6f5f : 0x7f3a2c);
        // A window beside the door only where it fits in the corridor: past the wall it hung in the air beside a lower neighbour.
        if (x + 22 > x1 - 2) continue;
        p.box(x + 10, low + 12, x + 22, low + 24, 0x7a8f96, 0.8);
        p.stroke(x + 16, low + 12, x + 16, low + 24, 0.6);
      }
      under(x0 + 2, low + F, x1 - 2, 15);
      p.hatching(x1 - Math.min(30, fw * 0.3), low + F - 13, x1 - 2, low + F, 2.6);
      // Clothes on a line under the slab, in the corridor.
      if (rnd(f + 200) < 0.65) clothes(x0 + 8 + rnd(f + 201) * fw * 0.3, x0 + fw * (0.5 + rnd(f + 202) * 0.42), low + F - 7);
      // The slab's edge and a parapet of pierced brick.
      slab(x0, low, x1, low + 3.5);
      under(x0, low, x1, 7);
      p.box(x0 + 1.5, low + 3.5, x1 - 1.5, low + 14.5, mix(look.wall, 0xffffff, 0.12), THIN);
      for (let x = x0 + 6; x < x1 - 4; x += 8) p.shape([x, low + 6, x + 2.6, low + 9, x, low + 12, x - 2.6, low + 9], mix(look.wall, INK, 0.55), 0);
      slab(x0, low + 14.5, x1, low + 16.5);
      for (let x = x0 + fw / Math.max(1, Math.round(fw / 48)); x < x1 - 8; x += fw / Math.max(1, Math.round(fw / 48))) {
        p.box(x - 2, low + 16.5, x + 2, low + F, mix(look.wall, 0xffffff, 0.08), THIN);
        p.shade(x + 0.6, low + 16.5, x + 2, low + F, 0.3);
      }
      if (rnd(f + 210) < 0.7) quilt(x0 + rnd(f + 211) * (fw - 24), low + 15, 12 + rnd(f + 212) * 8, 11, f + 213);
      if (rnd(f + 215) < 0.6) pots(x0 + 6 + rnd(f + 216) * (fw - 34), x0 + 6 + rnd(f + 216) * (fw - 34) + 20, low + 16.5);
    } else if (b.style === 'timber') {
      // A timber floor over a brick one: lattice windows, a railed gallery, a little roof of tiles over it.
      p.box(x0, low, x1, low + F, 0x6f3a2c, 0);
      for (let i = 0; i < bays; i++) lattice(cx(i), low + 12, Math.min(22, bayW - 10), 15);
      for (let i = 0; i <= bays; i++) {
        p.box(i * bayW - 1.6, low, i * bayW + 1.6, low + F, RED, THIN);
        g.rect(i * bayW - 1.2, -(low + F), 0.7, F).fill({ color: 0xffffff, alpha: 0.22 });
        g.rect(i * bayW + 0.5, -(low + F), 0.8, F).fill({ color: INK, alpha: 0.24 });
      }
      p.box(x0, low + 3, x1, low + 12, 0x4f7a62, THIN);
      for (let x = x0 + 4; x < x1; x += 5) p.stroke(x, low + 3, x, low + 12, 0.55, 0x2f4f40);
      p.box(x0 - 2, low, x1 + 2, low + 3, 0x8c3f2c, THIN);
      under(x0, low, x1, 7);
    } else if (b.style === 'balconies' || b.style === 'loggias') {
      const proud = b.style === 'balconies';
      for (let i = 0; i < bays; i++) {
        const x = cx(i);
        if (x < x0 + 10 || x > x1 - 10) continue;
        // Every other bay of the building, the same bays all the way up.
        if ((i + Math.floor(b.seed)) % 2 !== 0) { glassWindow(x, low + 10, 14, 17); if (rnd(f * 7 + i) < 0.22) stovePipe(x + 6, low + 22); continue; }
        const bw = Math.min(bayW - 5, 36);
        const [l, r] = [x - bw / 2, x + bw / 2];
        if (proud) {
          // Standing out from the wall: its shadow on the wall below, to the right, as the light is from the upper left.
          under(l + 3, low + 1, r + 4, 12);
          door(x - 8, low + 3, 25, 11, 0x5e6e6a);
          glassWindow(x + 9, low + 11, 11, 13);
          // The slab over it, from the floor above, shades the top of its opening.
          under(l, low + F, r, 12);
          // Its posts, lit and dark, and a slab and rail in front of everything.
          p.box(l, low + 3, l + 2.4, low + F - 1, mix(look.wall, 0xffffff, 0.3), THIN);
          p.box(r - 2.4, low + 3, r, low + F - 1, mix(look.wall, INK, 0.3), THIN);
          slab(l - 2.5, low + F - 2, r + 2.5, low + F + 1.2);
          slab(l - 2.5, low, r + 2.5, low + 3.2);
          under(l - 2.5, low, r + 2.5, 4);
          p.box(l - 1, low + 3.2, r + 1, low + 14.5, mix(look.wall, 0xffffff, 0.2), THIN);
          for (let k = l + 4; k < r - 1; k += 4.5) p.stroke(k, low + 4, k, low + 14, 0.9, mix(look.wall, INK, 0.5));
          slab(l - 1.5, low + 14.5, r + 1.5, low + 16.5);
        } else {
          // Let into the wall: a dark hole, its far side lit, the wall's edge thrown across it.
          p.box(l, low + 2, r, low + F - 5, mix(look.wall, INK, 0.58), LINE);
          door(x - 8, low + 3, 23, 10, 0x4c5a56);
          p.box(x + 4, low + 11, x + 14, low + 22, 0x7a8f96, 0.8);
          p.box(r - 3, low + 2, r, low + F - 5, mix(look.wall, 0xffffff, 0.25), 0);
          under(l, low + F - 5, r, 14);
          p.hatching(r - 12, low + F - 15, r, low + F - 5, 2.4);
          slab(l - 2, low, r + 2, low + 2.8);
          p.box(l, low + 2.8, r, low + 13.5, mix(look.wall, 0xffffff, 0.14), THIN);
          for (let k = l + 4; k < r - 1; k += 4.5) p.stroke(k, low + 3.5, k, low + 13, 0.9, mix(look.wall, INK, 0.45));
          slab(l - 1, low + 13.5, r + 1, low + 15.2);
        }
        const q = rnd(f * 11 + i);
        if (q < 0.3) quilt(l + 2 + rnd(f + i + 300) * (bw - 16), low + (proud ? 16 : 15), 12, 10, f + i + 301);
        else if (q < 0.55) pots(l + 3, r - 5, low + (proud ? 16.5 : 15.2));
        // A bamboo pole of washing, out past the rail.
        else if (q < 0.8) { const out = rnd(f + i + 302) < 0.5 ? l - 14 : r + 14; p.stroke(x, low + F - 9, out, low + F - 7, 1.5, 0xb49a5a); clothes(Math.min(x, out) + 1, Math.max(x, out) - 1, low + F - 9); }
      }
      p.stroke(x0, low, x1, low, 1, look.line);
    } else if (!narrow) {
      // A narrow end: a stair's small windows.
      glassWindow(w / 2, low + 12, 10, 14);
      p.stroke(0, low, w, low, 1, look.line);
      if (rnd(f + 310) < 0.4) stovePipe(w / 2 + 5, low + 24);
    }
  }
  // Pipes down the wall.
  if (w > 50) {
    p.stroke(w - 3.5, 2, w - 3.5, stepped ? topLow : b.wall, 1.5, 0x54585a);
    p.shade(w - 2.8, 2, w - 1.8, stepped ? topLow : b.wall, 0.3);
  }
  g.rect(w - farWidth, -faceTop, farWidth, faceTop).fill(fade.far);
  p.hatching(w - farWidth * 1.5, faceTop - 5, w, faceTop, 2.8);

  // What stands on the terrace the top floor steps back from.
  if (stepped) {
    const [a, c] = stepLeft ? [0, stepW] : [w - stepW, w];
    p.box(a, topLow, c, topLow + 9, 0x9a9a90, THIN);
    slab(a - 0.5, topLow, c + 0.5, topLow + 3);
    p.box(a + 2, topLow + 7, c - 2, topLow + 9, 0xb0b0a5, 0);
    pots(a + 4, c - 8, topLow + 3);
    p.stroke(a + 3, topLow + 3, a + 3, topLow + 15, 1.3, 0x4f5355);
    p.stroke(c - 3, topLow + 3, c - 3, topLow + 15, 1.3, 0x4f5355);
    clothes(a + 3, c - 3, topLow + 15);
    p.shade(stepLeft ? stepW : w - stepW - 4, topLow + 3, stepLeft ? stepW + 4 : w - stepW, b.wall, 0.2);
    p.outline(topX0, topLow, topX1, b.wall, LINE);
  }
  p.outline(0, 0, w, stepped ? topLow : b.wall, LINE);

  g.resetTransform();
  // The roof, a thin strip of it over the front and the walls beside it, as the street's shops show theirs.
  const [rx0, rx1] = stepped ? (stepLeft ? [topX0 + sL, whole] : [0, topX1 + sL]) : [0, whole];
  if (narrow) {
    // A wall's coping, flush with it: nothing overhangs to stand under.
    p.box(rx0, b.wall, rx1, b.wall + 3, mix(look.wall, INK, 0.3), THIN);
  } else if (b.roof === 'pitched') {
    const over = 5;
    const inset = Math.min(7, (b.total - b.wall) * 0.4);
    under(rx0, b.wall, rx1, 11);
    p.hatching(rx1 - 18, b.wall - 8, rx1, b.wall, 2.4);
    const [e0, e1, r0, r1] = [rx0 - over, rx1 + over, rx0 - over + inset, rx1 + over - inset];
    const [roofLeft, roofMid, roofRight] = [art(`${PICTURES}roof_left`), art(`${PICTURES}roof_mid`), art(`${PICTURES}roof_right`)];
    if (roofLeft && roofMid && roofRight) {
      // 85 px high, 72 of them above the wall and the rest hanging as the eave. Fitted by shrinking, never by enlarging: the height to this roof's band, the width by as many middles as it takes, each a little narrower.
      const fit = Math.min(1, (b.total - b.wall + 1) / (72 * UNITS_A_PIXEL));
      const units = fit * UNITS_A_PIXEL;
      const [leftW, midW, rightW] = [roofLeft.width * units, roofMid.width * units, roofRight.width * units];
      const span = e1 - e0;
      const mids = Math.max(0, Math.ceil((span - leftW - rightW) / midW));
      const squeeze = Math.min(1, span / (leftW + rightW + mids * midW));
      const [foot, tall] = [b.wall - 13 * units, 85 * units];
      picture(roofLeft, e0, foot, leftW * squeeze, tall);
      for (let m = 0; m < mids; m++) picture(roofMid, e0 + (leftW + m * midW) * squeeze, foot, midW * squeeze, tall);
      picture(roofRight, e1 - rightW * squeeze, foot, rightW * squeeze, tall);
    } else {
    // Rafter ends in the shadow under the eaves.
    const n = Math.max(3, Math.round((e1 - e0) / 6.4));
    const at = (i: number, t: number) => { const k = (i + 0.5) / n; return e0 + (e1 - e0) * k + (0.5 - k) * inset * 2 * t; };
    for (let i = 0; i < n; i += 2) g.circle(at(i, 0), -(b.wall - 2.6), 1).fill({ color: 0x8a6a45 });
    // The channels between the tiles, dark, then one rounded run of tiles over each gap, up to the ridge: all at one pitch, so their ends line up with them.
    p.shape([e0, b.wall, e1, b.wall, r1, b.total, r0, b.total], TILE_DARK, 0);
    const half = ((e1 - e0) / n) * 0.38;
    const run = (from: number, to: number) => {
      for (let i = 0; i < n; i++) g.poly([at(i, 0) + half * from, -b.wall, at(i, 0) + half * to, -b.wall, at(i, 1) + half * to * 0.82, -(b.total - 1), at(i, 1) + half * from * 0.82, -(b.total - 1)]);
    };
    run(-1, 1);
    g.fill(TILE_ROOF);
    run(-0.8, -0.2);
    g.fill(0x6f777c);
    run(0.45, 1);
    g.fill(0x41484c);
    // Each tile laps over the one below.
    const tall = b.total - b.wall;
    for (let i = 0; i < n; i++) {
      for (let t = (i % 2) * 0.17 + 0.2; t < 0.95; t += 0.34) {
        const [x, y] = [at(i, t), b.wall + tall * t];
        g.moveTo(x - half, -(y - 0.4)).quadraticCurveTo(x, -(y + 1), x + half, -(y - 0.4));
      }
    }
    g.stroke({ width: 0.5, color: TILE_DARK });
    // The light across the whole roof.
    g.poly([e0, -b.wall, e1, -b.wall, r1, -b.total, r0, -b.total]).fill(fade.roof);
    // The eave: a dark edge and the round end of every run of tiles.
    p.box(e0, b.wall - 1, e1, b.wall + 1, TILE_DARK, 0);
    for (let i = 0; i < n; i++) p.dot(at(i, 0), b.wall - 0.1, half * 0.82, 0x6f777c, 0.5);
    for (let i = 0; i < n; i++) g.circle(at(i, 0) + 0.2, -(b.wall - 0.25), half * 0.42).fill({ color: 0x41484c });
    // The ridge, its top catching the light.
    p.box(r0 - 1, b.total - 2.5, r1 + 1, b.total + 1, TILE_DARK, THIN);
    p.stroke(r0, b.total + 1, r1, b.total + 1, 0.8, 0x9aa2a5);
    g.poly([e0, -b.wall, e1, -b.wall, r1, -b.total, r0, -b.total]).stroke({ width: 1.2, color: INK });
    // The corners turn up, at the ridge and at the eaves.
    for (const [x, dir] of [[r0, -1], [r1, 1]] as const) g.moveTo(x, -(b.total - 1)).quadraticCurveTo(x + dir * 4, -(b.total + 1), x + dir * 3.5, -(b.total + 6)).stroke({ width: 2.2, color: TILE_DARK, cap: 'round' });
    for (const [x, dir] of [[e0, -1], [e1, 1]] as const) g.moveTo(x - dir * 1.5, -(b.wall + 0.2)).quadraticCurveTo(x + dir * 0.6, -b.wall, x + dir * 1.4, -(b.wall + 1.8)).stroke({ width: 1.2, color: TILE_DARK, cap: 'round' });
    }
  } else {
    // A flat roof you can stand on: the parapet in front, the floor beyond it, what people keep up there.
    const floor = 0x96958a;
    p.box(rx0 + 1, b.wall + 2, rx1 - 1, b.total, floor, 0);
    for (let k = 7; k < b.total - b.wall; k += 7) p.stroke(rx0 + 1, b.wall + k, rx1 - 1, b.wall + k, 0.6, 0x7b7a70);
    p.shade(rx0 + 1, b.wall + 4, rx1 - 1, b.wall + 8, 0.2);
    p.box(rx0 + 1, b.total - 2.5, rx1 - 1, b.total, 0xa9a89d, THIN);
    slab(rx0 - 1, b.wall - 1, rx1 + 1, b.wall + 4.5, 1.2);
    under(rx0, b.wall - 1, rx1, 7);
    const s = b.total - b.wall;
    const mx = rx0 + 8 + rnd(10) * Math.max(1, rx1 - rx0 - 44);
    const y = b.wall + 5;
    const pick = b.bare ? 1 : rnd(11);
    if (rx1 - rx0 > 44 && pick < 0.45) {
      // A water tank on legs.
      p.stroke(mx + 3, y, mx + 3, y + 8, 1.4);
      p.stroke(mx + 21, y, mx + 21, y + 8, 1.4);
      p.box(mx, y + 8, mx + 24, y + 22, 0x8a8d88, LINE);
      p.shade(mx + 16, y + 8, mx + 24, y + 22, 0.28);
      p.box(mx - 1, y + 22, mx + 25, y + 24, 0x6f726e, THIN);
    } else if (rx1 - rx0 > 44 && pick < 0.8) {
      // The stair's little house.
      p.box(mx, y, mx + 22, y + 22, LOOKS[(b.look + 2) % 5]!.wall, LINE);
      door(mx + 8, y, 16, 8, 0x5e6e6a);
      p.box(mx - 1.5, y + 22, mx + 23.5, y + 25, SLAB, THIN);
      p.shade(mx + 15, y, mx + 22, y + 22, 0.25);
    } else if (rx1 - rx0 > 30 && !b.bare) {
      p.stroke(rx0 + 7, y, rx0 + 7, y + 15, 1.3, 0x4f5355);
      p.stroke(rx1 - 7, y, rx1 - 7, y + 15, 1.3, 0x4f5355);
      clothes(rx0 + 7, rx1 - 7, y + 15);
    }
    if (rx1 - rx0 > 30 && rnd(12) < 0.5) pots(rx1 - 26, rx1 - 6, y - 1);
    if (!b.bare && rnd(13) < 0.35) p.aerial(rx0 + 5 + rnd(14) * (rx1 - rx0 - 10), y + s * 0.2, y + s * 0.2 + 22);
  }
  return narrow ? b.wall + 3 : b.total;
}

/** A thing across an alley, drawn with its left at 0 and its line at height 0, heights up as a front's are. */
function drawSpan(g: Graphics, s: TallSpan, w: number): void {
  const rnd = (k: number) => hash(s.seed, s.row, k);
  const sag = (x: number) => 7 * (1 - ((2 * x) / w - 1) ** 2);
  const sagging = (dy: number, width: number, color: number) => {
    g.moveTo(0, -dy).quadraticCurveTo(w / 2, -dy + 14, w, -dy).stroke({ width, color, cap: 'round' });
  };
  if (s.kind === 'washing') {
    // A few things pegged out near the middle, not a string of flags: a shirt, trousers, a towel, each its own shape.
    const n = 3 + Math.floor(rnd(1) * 3);
    let x = w * (0.26 + rnd(2) * 0.14);
    for (let k = 0; k < n; k++) {
      const y = sag(x + 5);
      const color = rnd(k + 50) < 0.45 ? WASH[0]! : WASH[Math.floor(rnd(k + 60) * WASH.length)]!;
      const kind = rnd(k + 70);
      const line = { width: 1, color: INK };
      if (kind < 0.4) {
        g.poly([x, y, x + 13, y, x + 16, y + 5, x + 13, y + 6.5, x + 12, y + 4.5, x + 12, y + 17, x + 1, y + 17, x + 1, y + 4.5, x, y + 6.5, x - 3, y + 5]).fill(color).stroke(line);
        g.rect(x + 8, y + 3, 4, 13.5).fill({ color: INK, alpha: 0.13 });
        x += 22;
      } else if (kind < 0.7) {
        g.poly([x, y, x + 11, y, x + 12, y + 20, x + 7.4, y + 20, x + 5.5, y + 6, x + 3.6, y + 20, x - 1, y + 20]).fill(color).stroke(line);
        x += 18;
      } else {
        g.rect(x, y, 9, 13).fill(color).stroke(line);
        x += 15;
      }
      x += rnd(k + 80) * 7;
      if (x > w * 0.8) break;
    }
    // Over the clothes' top edges, so they hang from it.
    sagging(0, 1.1, 0x33342f);
  } else if (s.kind === 'wires') {
    sagging(0, 1, 0x26272a);
    sagging(5, 0.9, 0x26272a);
    sagging(-4, 0.8, 0x33342f);
  } else if (s.kind === 'lanterns') {
    sagging(0, 1, 0x26272a);
    for (let x = 14; x < w - 8; x += 22) {
      const y = sag(x);
      g.moveTo(x, y).lineTo(x, y + 4).stroke({ width: 0.9, color: INK });
      g.ellipse(x, y + 9, 5, 6).fill(0xc9392b).stroke({ width: 1, color: INK });
      g.rect(x - 3, y + 3.4, 6, 1.6).fill(0xd4a93a);
      g.ellipse(x + 1.4, y + 9, 2.2, 5).fill({ color: INK, alpha: 0.18 });
    }
  }
}

/** One item of the tall city, drawn once. */
interface Tall { b: TallBlock; front: Graphics; x0: number; x1: number; y1: number; top: number }
interface Span { s: TallSpan; g: Graphics; y: number; x0: number; x1: number }

/** How far below its line each kind of span hangs, its sag and what is pegged to it, in units. */
const HANG: Record<SpanKind, number> = { washing: 26, lanterns: 24, wires: 11 };

/**
 * Beijing's tall buildings. Each is drawn once with its foot on the ground, upright as the street's shops are; only how tall it looks
 * changes with how far it is up or down the view, so taller ones rise over those behind them.
 */
export class TallCity {
  private readonly items: Tall[] = [];
  private spans: Span[] = [];

  constructor(parent: Container, width: number, height: number, idAt: (c: number, r: number) => string, ground: number, frame: PlanFrame, reach: PlanReach = {}) {
    const isSolid = (c: number, r: number) => idAt(c, r) === 'roofs';
    const blocks = planBlocks(width, height, isSolid, (c, r) => idAt(c, r) === 'water', TILE * ground, frame, reach);
    const spans = planSpans(width, height, isSolid, (c, r) => idAt(c, r) === 'path', blocks, frame.moved);
    const open = (c: number, r: number) => c >= 0 && c < width && r >= 0 && r < height && idAt(c, r) !== 'roofs' && idAt(c, r) !== 'water';
    parent.addChild(buildShadows(blocks, width, height));
    const feet = new Graphics();
    feet.label = 'tall_city_feet';
    feet.zIndex = -1e9 + 0.6;
    feet.eventMode = 'none';
    drawFeet(feet, blocks, open);
    parent.addChild(feet);
    for (const b of blocks) {
      const x0 = b.c0 * TILE + b.insetL;
      const x1 = (b.c1 + 1) * TILE - b.insetR;
      const y1 = (b.r1 + 1) * TILE;
      const front = new Graphics();
      front.eventMode = 'none';
      front.label = `tall_front_${b.id}`;
      const top = drawFront(front, b, x1 - x0);
      front.position.set(x0, y1 + b.drop);
      front.zIndex = y1;
      parent.addChild(front);
      this.items.push({ b, front, x0, x1, y1, top });
    }
    for (const s of spans) {
      // It runs on a little under the walls at both ends, which draw over those ends.
      const x = s.c0 * TILE - 22;
      const w = (s.c1 - s.c0 + 1) * TILE + 44;
      const g = new Graphics();
      g.eventMode = 'none';
      g.label = `tall_span_${s.kind}`;
      drawSpan(g, s, w);
      const y = (s.row + 0.5) * TILE;
      g.position.x = x;
      g.zIndex = y;
      parent.addChild(g);
      this.spans.push({ s, g, y, x0: x, x1: x + w });
    }
  }

  /**
   * Moves each line across an alley up or down, within the walls it hangs between, until nothing standing in the alley meets it on the
   * screen: a line across a stall or a sack looks as if it holds it up (the owner, 2026-11-02). A line with no clear height goes.
   * `things` stand on the ground: their foot, their extent across, how tall they stand upright. Checked as the view tips, up to a quarter taller,
   * and as a line's height stretches with where it is in the view (update), which a prop's does not: up to 8% either way, as hides() allows.
   */
  clearOf(things: ReadonlyArray<{ x0: number; x1: number; y: number; h: number }>): void {
    const ROOM = 6;
    this.spans = this.spans.filter((it) => {
      // Only what stands across the line's width can meet it, and each line tries many heights.
      const under = things.filter((t) => t.x1 > it.x0 && t.x0 < it.x1);
      const meets = (high: number) => under.some((t) => {
        // Out of the line's reach at its highest and at its lowest, whatever the tip and stretch (a hair wide of the steps below).
        if (t.y <= it.y - high * 1.26 * 1.09 - 5 * 1.26 - ROOM) return false;
        if (it.y - high * 0.91 + (HANG[it.s.kind] + t.h) * 1.26 + ROOM <= t.y) return false;
        for (let u = 1; u <= 1.2501; u += 0.05) {
          for (let stretch = 0.92; stretch <= 1.0801; stretch += 0.04) {
            const line = it.y - high * u * stretch;
            if (line - 5 * u - ROOM < t.y && line + HANG[it.s.kind] * u + ROOM > t.y - t.h * u) return true;
          }
        }
        return false;
      });
      for (let d = 0; d <= it.s.top - MIN_HIGH; d += 2) {
        for (const high of [it.s.high - d, it.s.high + d]) {
          if (high < MIN_HIGH || high > it.s.top || meets(high)) continue;
          it.s.high = high;
          return true;
        }
      }
      it.g.destroy();
      return false;
    });
  }

  /** Whether a building stands in front of someone with their feet at (x, y), so they can't be seen: for placing people who must be, as in a fight. */
  hides(x: number, y: number, upright: number): boolean {
    for (const { b, x0, x1, y1, top } of this.items) {
      if (y >= y1 || x + FIGURE_HALF_WIDTH <= x0 || x - FIGURE_HALF_WIDTH >= x1) continue;
      // A little over its height, for how tall it can look low in the view.
      if (y > y1 + b.drop - top * upright * 1.08) return true;
    }
    return false;
  }

  /** Sets how tall everything in view looks, for a view centred at `camY`. */
  update(camY: number, upright: number, top: number, bottom: number): void {
    for (const it of this.items) {
      const stretch = 1 + (it.y1 - camY) / STRETCH_FAR;
      const shown = it.y1 + 8 > top && it.y1 - it.b.total * upright * stretch - 40 < bottom;
      it.front.visible = shown;
      if (shown) it.front.scale.set(1, upright * stretch);
    }
    for (const it of this.spans) {
      const high = it.s.high * upright * (1 + (it.y - camY) / STRETCH_FAR);
      const shown = it.y + 8 > top && it.y - high - 40 < bottom;
      it.g.visible = shown;
      if (!shown) continue;
      it.g.position.y = it.y - high;
      it.g.scale.y = upright;
    }
  }
}

/**
 * Every building's shadow on the ground, under everyone. One mask holds them all, so where two meet the ground is no darker than where
 * there is one: a flat shadow, as the game's other shadows are, which starts at the foot of the building's walls.
 */
function buildShadows(blocks: readonly TallBlock[], width: number, height: number): Container {
  const layer = new Container();
  layer.label = 'tall_city_shadows';
  layer.zIndex = -1e9 + 0.5;
  layer.eventMode = 'none';
  const shape = new Graphics();
  for (const b of blocks) {
    // A building set lower (drop) casts from where its walls now stand.
    const [x0, x1, y0, y1] = [b.c0 * TILE + b.insetL, (b.c1 + 1) * TILE - b.insetR, b.r0 * TILE + b.drop, (b.r1 + 1) * TILE + b.drop];
    const [dx, dy] = [b.total * SHADOW_X, b.total * SHADOW_Y];
    shape.poly([x0, y0, x1, y0, x1 + dx, y0 + dy, x1 + dx, y1 + dy, x0 + dx, y1 + dy, x0, y1]).fill(0xffffff);
  }
  const dark = new Graphics().rect(-TILE * 4, -TILE * 4, (width + 8) * TILE, (height + 8) * TILE).fill({ color: SHADOW_COLOR, alpha: SHADOW_ALPHA });
  dark.mask = shape;
  layer.addChild(shape, dark);
  return layer;
}

/** A thin dark line where each building's walls meet the ground. */
function drawFeet(g: Graphics, blocks: readonly TallBlock[], open: (c: number, r: number) => boolean): void {
  for (const b of blocks) {
    for (const dir of [-1, 1] as const) {
      const c = dir < 0 ? b.c0 : b.c1;
      const foot = dir < 0 ? c * TILE + b.insetL : (c + 1) * TILE - b.insetR - 2;
      for (let r = b.r0; r <= b.r1; r++) if (open(c + dir, r)) g.rect(foot, r * TILE + b.drop, 2, TILE).fill({ color: SHADOW_COLOR, alpha: 0.4 });
    }
    // A building set lower meets the ground lower: its drop stays within the row in front, which is what `open` asks about.
    const [x0, x1, y1] = [b.c0 * TILE + b.insetL, (b.c1 + 1) * TILE - b.insetR, (b.r1 + 1) * TILE + b.drop];
    for (let k = b.c0; k <= b.c1; k++) {
      if (!open(k, b.r1 + 1)) continue;
      const [a, z] = [Math.max(x0, k * TILE), Math.min(x1, (k + 1) * TILE)];
      g.rect(a, y1 - 0.5, z - a, 2.5).fill({ color: SHADOW_COLOR, alpha: 0.4 });
    }
  }
}
