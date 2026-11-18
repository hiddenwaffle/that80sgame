import { Container, Graphics, Matrix, Sprite } from 'pixi.js';
import { BALL_EYES, ballPolygon, jawEdges, type Edge } from '../art/ball_face.ts';
import { cherryPair } from '../art/cherries.ts';
import { beijingCivilianLook, LOOKS, type LookId, type LookInfo, type Pose } from '../art/characters.ts';
import { art } from '../art/images.ts';
import { drawLookArt } from '../art/lookArt.ts';
import { sceneryProp } from '../art/map_scenery.ts';
import { PROPS } from '../art/props.ts';
import { clipWreckArtifact } from '../art/wreck_art.ts';
import { hashSeed } from '../battle/formula.ts';

/**
 * Newspaper photos as isometric scenes (the owner, 2026-11-10: "let's go back to isometric, but use the character sprites, and
 * try to make these high-quality polished"): rooms, mazes, a bridge and a temple built as shaded solids in code, inked and hatched
 * like the game's art, and every figure drawn by the game itself from its own sprite (drawLookArt), trees and flowers from the
 * maps' own pictures. Each scene is written in a 1536 x 1024 drawing on a 2:1 tile grid, then zoomed about a focus to fill the photo.
 */

type P = [number, number];
const W = 1536, H = 1024;
/** A tile's width on screen; a tile's edge rises `ZU` for one tile of height (a cube looks like a cube). */
const T = 128;
const ZU = T * 0.612;
const INK = 0x17161c;

const flat = (pts: readonly P[]): number[] => pts.flatMap((q) => q);

/** Points round part of an ellipse about (cx, cy) from angle a0 to a1: 0 is its right end, π/2 its foot, π its left end. */
const ellipseArc = (cx: number, cy: number, rx: number, ry: number, a0: number, a1: number, n = 16): P[] =>
  Array.from({ length: n + 1 }, (_, i) => { const a = a0 + ((a1 - a0) * i) / n; return [cx + Math.cos(a) * rx, cy + Math.sin(a) * ry] as P; });

/**
 * Where a round thing's side meets its foot, as the photo looks down on it: the near half of its foot's ellipse, from its
 * right end round under to its left. A cylinder, a stem or a dome ends on this curve, never on a straight line across.
 */
const footCurve = (cx: number, cy: number, rx: number, ry: number, n = 16): P[] => ellipseArc(cx, cy, rx, ry, 0, Math.PI, n);

/** How far below the middle line of a round foot its near edge runs, `dx` from its middle. */
const footDrop = (dx: number, rx: number, ry: number): number => ry * Math.sqrt(Math.max(0, 1 - (dx / rx) ** 2));

/** The convex outline round a set of points on screen. */
function hull(pts: readonly P[]): P[] {
  const s = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: P, a: P, b: P) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo: P[] = [], up: P[] = [];
  for (const q of s) { while (lo.length >= 2 && cross(lo[lo.length - 2]!, lo[lo.length - 1]!, q) <= 0) lo.pop(); lo.push(q); }
  for (const q of s.reverse()) { while (up.length >= 2 && cross(up[up.length - 2]!, up[up.length - 1]!, q) <= 0) up.pop(); up.push(q); }
  return [...lo.slice(0, -1), ...up.slice(0, -1)];
}

function rng(seed: number): () => number {
  let a = seed;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** A colour toward white (k > 0) or black (k < 0). */
function tone(c: number, k: number): number {
  const f = (v: number) => Math.round(k >= 0 ? v + (255 - v) * k : v * (1 + k));
  return (f((c >> 16) & 255) << 16) | (f((c >> 8) & 255) << 8) | f(c & 255);
}

/** Ground x runs down and right, y down and left, z straight up, all in tiles. */
type Proj = (x: number, y: number, z?: number) => P;
const projector = (ox: number, oy: number): Proj => (x, y, z = 0) => [ox + ((x - y) * T) / 2, oy + ((x + y) * T) / 4 - z * ZU];

/**
 * Ink hatching across a convex face, as the sprites shade their dark sides: strokes along `angle`, `gap` apart, each running
 * from the face's far edge back across it by `reach` of its length, raggedly.
 */
function hatch(g: Graphics, poly: readonly P[], angle: number, gap: number, width: number, alpha: number, reach = 1, seed = 7, color = INK): void {
  const dx = Math.cos(angle), dy = Math.sin(angle), nx = -dy, ny = dx;
  const pts = poly.map(([x, y]) => [x * dx + y * dy, x * nx + y * ny] as P);
  let n0 = Infinity, n1 = -Infinity;
  for (const [, n] of pts) { n0 = Math.min(n0, n); n1 = Math.max(n1, n); }
  const r = rng(seed);
  let any = false;
  for (let s = n0 + gap * 0.5; s < n1; s += gap) {
    let t0 = Infinity, t1 = -Infinity;
    for (let i = 0; i < pts.length; i++) {
      const [ta, na] = pts[i]!, [tb, nb] = pts[(i + 1) % pts.length]!;
      if ((na - s) * (nb - s) > 0 || na === nb) continue;
      const t = ta + ((s - na) / (nb - na)) * (tb - ta);
      t0 = Math.min(t0, t); t1 = Math.max(t1, t);
    }
    if (!(t1 > t0 + 1)) continue;
    const from = Math.max(t0, t1 - (t1 - t0) * Math.min(1, reach * (0.65 + 0.7 * r())));
    g.moveTo(from * dx + s * nx, from * dy + s * ny).lineTo(t1 * dx + s * nx, t1 * dy + s * ny);
    any = true;
  }
  if (any) g.stroke({ width, color, alpha, cap: 'round' });
}

/** A solid's colours: its top, its lit side (facing down and left), and how much darker its shaded side is. */
interface Mat { top: number; side: number; dark?: number; ink?: number; line?: number; hatch?: number; edge?: number }

/** A block on the grid, footprint (x, y, w, d) from height z up h; its lit +y face, shaded +x face and top, inked. */
function box(g: Graphics, p: Proj, x: number, y: number, z: number, w: number, d: number, h: number, m: Mat): void {
  const ink = m.ink ?? INK, lw = m.line ?? 3.5;
  const left: P[] = [p(x, y + d, z), p(x + w, y + d, z), p(x + w, y + d, z + h), p(x, y + d, z + h)];
  const right: P[] = [p(x + w, y + d, z), p(x + w, y, z), p(x + w, y, z + h), p(x + w, y + d, z + h)];
  const top: P[] = [p(x, y, z + h), p(x + w, y, z + h), p(x + w, y + d, z + h), p(x, y + d, z + h)];
  g.poly(flat(left)).fill(m.side);
  g.poly(flat(right)).fill(tone(m.side, -(m.dark ?? 0.3)));
  if (m.hatch) hatch(g, right, -1.05, 6.5, 1.6, m.hatch, 0.55, Math.round(x * 31 + y * 17));
  g.poly(flat(top)).fill(m.top);
  if (m.edge !== undefined) g.poly(flat([p(x, y + d, z + h), p(x + w, y + d, z + h), p(x + w, y, z + h)]), false).stroke({ width: lw * 0.6, color: m.edge, alpha: 0.8 });
  g.poly(flat([p(x + w, y + d, z + h), p(x + w, y + d, z)]), false).stroke({ width: lw * 0.65, color: ink, cap: 'round' });
  g.poly(flat([p(x, y + d, z + h), p(x + w, y + d, z + h), p(x + w, y, z + h)]), false).stroke({ width: lw * 0.65, color: ink, join: 'round' });
  g.poly(flat([p(x, y, z + h), p(x + w, y, z + h), p(x + w, y, z), p(x + w, y + d, z), p(x, y + d, z), p(x, y + d, z + h)])).stroke({ width: lw, color: ink, join: 'round' });
}

/**
 * A box's two near walls alone, its lit +y face and shaded +x face with their ink, as `box` draws them: drawn again over
 * what stands inside an open box, so only what rises above its rim shows.
 */
function nearWalls(g: Graphics, p: Proj, x: number, y: number, z: number, w: number, d: number, h: number, m: Mat): void {
  const ink = m.ink ?? INK, lw = m.line ?? 3.5;
  const left: P[] = [p(x, y + d, z), p(x + w, y + d, z), p(x + w, y + d, z + h), p(x, y + d, z + h)];
  const right: P[] = [p(x + w, y + d, z), p(x + w, y, z), p(x + w, y, z + h), p(x + w, y + d, z + h)];
  g.poly(flat(left)).fill(m.side);
  g.poly(flat(right)).fill(tone(m.side, -(m.dark ?? 0.3)));
  if (m.hatch) hatch(g, right, -1.05, 6.5, 1.6, m.hatch, 0.55, Math.round(x * 31 + y * 17));
  g.poly(flat([p(x + w, y + d, z + h), p(x + w, y + d, z)]), false).stroke({ width: lw * 0.65, color: ink, cap: 'round' });
  g.poly(flat([p(x + w, y, z + h), p(x + w, y, z), p(x + w, y + d, z), p(x, y + d, z), p(x, y + d, z + h)]), false).stroke({ width: lw, color: ink, join: 'round' });
}

/** Points on a face of constant y (u along x, v up) or constant x (u along y). */
const onY = (p: Proj, x: number, y: number, z: number, u0: number, u1: number, v0: number, v1: number): P[] => [p(x + u0, y, z + v0), p(x + u1, y, z + v0), p(x + u1, y, z + v1), p(x + u0, y, z + v1)];
const onX = (p: Proj, x: number, y: number, z: number, u0: number, u1: number, v0: number, v1: number): P[] => [p(x, y + u0, z + v0), p(x, y + u1, z + v0), p(x, y + u1, z + v1), p(x, y + u0, z + v1)];

/**
 * A figure as the game draws it, from its own art where it has some, else its code drawing (or the drawing given, as a
 * townsperson dressed by the map): its middle at the origin, its feet `r` below.
 */
function lookFigure(look: LookId | LookInfo, pose: Partial<Pose>, r: number): Container {
  const c = new Container();
  const full: Pose = { facing: 'right', mouth: 0.3, t: 0, ...pose };
  if (typeof look !== 'string' || !drawLookArt(c, look, full, r)) {
    const g = new Graphics();
    (typeof look === 'string' ? LOOKS[look] : look).draw(g, full, r);
    c.addChild(g);
  }
  return c;
}

/**
 * A Beijing townsperson dressed as the game dresses them on its map (beijingCivilianLook): a shirt of their own colour, or,
 * for the straw-hatted students who speak there, a white jacket trimmed in it. `who` picks the colours.
 */
const townsperson = (look: LookId, who: string): LookInfo => beijingCivilianLook(look, hashSeed(`photo_clothes:${who}`), look.startsWith('guide_'), true);

/** A prop as its map stands it, from its own picture on its foot, `height` tall, else its code drawing. */
function propFigure(map: string, kind: string, height: number, flip = false): Container {
  const info = PROPS[kind]!;
  const tex = sceneryProp(map, kind);
  if (tex) {
    const s = new Sprite(tex);
    s.anchor.set(0.5, 1);
    const k = height / tex.height;
    s.scale.set(flip ? -k : k, k);
    if (kind !== 'tank_wreck') return s;
    const c = new Container();
    c.addChild(clipWreckArtifact(s));
    return c;
  }
  const g = new Graphics();
  info.draw(g, 0);
  const k = height / (info.drawn ?? info.height);
  g.scale.set(flip ? -k : k, k);
  return g;
}

/** The layers of a scene: ground, soft shadows, the solids and figures in depth order, neon's glow, and what floats over all. */
class Stage {
  readonly root = new Container();
  readonly ground = new Graphics();
  readonly shadow = new Graphics();
  readonly things = new Container({ sortableChildren: true });
  readonly glow = new Graphics();
  /** Glow on the floor (dots, pellets), under everything standing, so none of it lights a figure in front. */
  readonly glowUnder = new Graphics();
  /** Light thrown on the ground (a lamp's pool, a doorway's spill): added, softened, under everything standing. */
  readonly light = new Graphics();
  readonly over = new Container();
  readonly p: Proj;

  private readonly dark: number;

  constructor(ox: number, oy: number, bg: number, shadow = 0.3) {
    this.p = projector(ox, oy);
    this.dark = shadow;
    this.root.addChild(new Graphics().rect(-W, -H, W * 3, H * 3).fill(bg));
    // Added light, softened by drawing it in layers rather than blurring it: a blur filter over a layer this size cut off at its
    // texture's edge, a faint seam down the photo.
    this.glow.blendMode = 'add';
    this.glowUnder.blendMode = 'add';
    this.light.blendMode = 'add';
    this.root.addChild(this.ground, this.light, this.glowUnder, this.shadow, this.things, this.glow, this.over);
  }

  /** A soft shadow on the ground: darkest in the middle, fading out to its edge. */
  soft(x: number, y: number, rx: number, ry: number, k = 1): void {
    for (const f of [1, 0.86, 0.72, 0.56]) this.shadow.ellipse(x, y, rx * f, ry * f).fill({ color: 0x000000, alpha: (this.dark * k) / 3.2 });
  }

  draw(depth: number, fn: (g: Graphics) => void): Graphics {
    const g = new Graphics();
    fn(g);
    return this.put(depth, g);
  }

  put<C extends Container>(depth: number, node: C): C {
    node.zIndex = depth;
    this.things.addChild(node);
    return node;
  }

  /** One of the game's figures standing at (x, y), raised by z (a ghost floats), its shadow on the ground below. */
  figure(look: LookId | LookInfo, x: number, y: number, r: number, pose: Partial<Pose> = {}, opt: { z?: number; depth?: number; shadow?: number } = {}): Container {
    const [fx, fy] = this.p(x, y, opt.z ?? 0);
    const c = lookFigure(look, pose, r);
    c.position.set(fx, fy - r);
    this.put(opt.depth ?? x + y + 0.01, c);
    const [sx, sy] = this.p(x, y, 0);
    const k = opt.shadow ?? 1;
    if (k > 0) this.soft(sx, sy, r * 1.05 * k, r * 0.38 * k);
    return c;
  }

  /** A prop from its map's own picture at (x, y), `height` tall. */
  prop(map: string, kind: string, x: number, y: number, height: number, opt: { flip?: boolean; depth?: number; shadow?: number } = {}): Container {
    const [fx, fy] = this.p(x, y);
    const c = propFigure(map, kind, height, opt.flip);
    c.position.set(fx, fy);
    this.put(opt.depth ?? x + y, c);
    if (opt.shadow) this.soft(fx, fy, opt.shadow, opt.shadow * 0.36);
    return c;
  }

  /**
   * A low block of the arcade's maze, dark with neon along its top edges, in tile-long pieces so each sorts with the figures
   * beside it: one long block would draw over a figure standing in front of its far end. Its edges sit `inset` in from (x, y, w, d).
   */
  neonBlock(x: number, y: number, w: number, d: number, h: number, color: number, lw = 4.5, inset = 0.12): void {
    const p = this.p;
    const nx = Math.max(1, Math.round(w)), ny = Math.max(1, Math.round(d));
    for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
      const ex = i === nx - 1, ey = j === ny - 1, bx = i === 0, by = j === 0;
      const x0 = x + (w * i) / nx + (bx ? inset : 0), x1 = x + (w * (i + 1)) / nx - (ex ? inset : 0);
      const y0 = y + (d * j) / ny + (by ? inset : 0), y1 = y + (d * (j + 1)) / ny - (ey ? inset : 0);
      this.draw(x1 + y1, (g) => {
        // Only the faces on the block's outside: its top, and its near sides where they are its edge.
        if (ex) g.poly(flat([p(x1, y1), p(x1, y0), p(x1, y0, h), p(x1, y1, h)])).fill(0x03040e);
        if (ey) g.poly(flat([p(x0, y1), p(x1, y1), p(x1, y1, h), p(x0, y1, h)])).fill(0x060818);
        g.poly(flat([p(x0, y0, h), p(x1, y0, h), p(x1, y1, h), p(x0, y1, h)])).fill(0x080b26);
        if (ey) this.tube(g, [p(x0, y1, h), p(x1, y1, h)], color, lw);
        if (ex) this.tube(g, [p(x1, y0, h), p(x1, y1, h)], color, lw);
        if (bx) this.tube(g, [p(x0, y0, h), p(x0, y1, h)], color, lw * 0.7, 0.6);
        if (by) this.tube(g, [p(x0, y0, h), p(x1, y0, h)], color, lw * 0.7, 0.6);
        if (ey) this.tube(g, [p(x0, y1, 0.03), p(x1, y1, 0.03)], tone(color, -0.35), 2.5, 0.45);
        if (ex) this.tube(g, [p(x1, y0, 0.03), p(x1, y1, 0.03)], tone(color, -0.35), 2.5, 0.45);
        if (ex && ey) this.tube(g, [p(x1, y1, 0.03), p(x1, y1, h)], color, 2.5, 0.5);
      });
    }
  }

  /** A soft round glow: rings of light, faint at the edge, brighter to the middle. */
  halo(x: number, y: number, r: number, color: number, a = 0.5, layer = this.glowUnder): void {
    for (const k of [1, 0.75, 0.52, 0.32]) layer.circle(x, y, r * k).fill({ color, alpha: a / 3 });
  }

  /** A neon tube along `pts`: a glow in the glow layer, and a bright core with a white-hot middle drawn into `g`. */
  tube(g: Graphics, pts: readonly P[], color: number, width = 5, glow = 1): void {
    for (const [k, a] of [[7, 0.05], [4.6, 0.08], [3, 0.12]] as const) this.glow.poly(flat(pts), false).stroke({ width: width * k, color, alpha: a * glow * 1.6, join: 'round', cap: 'round' });
    g.poly(flat(pts), false).stroke({ width: width * 1.7, color: tone(color, -0.35), alpha: 0.9, join: 'round', cap: 'round' });
    g.poly(flat(pts), false).stroke({ width, color, join: 'round', cap: 'round' });
    g.poly(flat(pts), false).stroke({ width: width * 0.36, color: tone(color, 0.75), join: 'round', cap: 'round' });
  }
}

// ---- small things, drawn about a point on screen -------------------------------------------------------------------------

/** A glass soda bottle standing on `q`, `s` its scale (46 tall at 1). Plain label: no brand. */
function bottle(g: Graphics, q: P, s: number): void {
  const [x, y] = q;
  // Round, so its foot, its label's edges and its cap's all curve as the photo looks down on them.
  const RX = 7.2 * s, RY = 3.6 * s;
  const drop = (dx: number) => footDrop(dx, RX, RY);
  const body: P[] = [[-7, 0], [-7.4, -22], [-6.4, -27], [-3.2, -33], [-2.8, -41], [2.8, -41], [3.2, -33], [6.4, -27], [7.4, -22], [7, 0]];
  const pts = [...body.map(([a, b]) => [x + a * s, y + b * s] as P), ...footCurve(x, y, 7 * s, 3.5 * s).slice(1, -1)];
  g.poly(flat(pts)).fill(0x3b1a0c);
  // A band round the glass from height v0 up to v1, between u0 and u1 across it.
  const band = (u0: number, u1: number, v0: number, v1: number): P[] => {
    const at = (u: number, v: number): P => [x + u * s, y - v * s + drop(u * s)];
    const us = Array.from({ length: 13 }, (_, i) => u0 + ((u1 - u0) * i) / 12);
    return [...us.map((u) => at(u, v1)), ...us.reverse().map((u) => at(u, v0))];
  };
  // The cola's shine, the label's band and its wave, the shade on its far side, the cap.
  g.poly(flat(band(-5.2, -2.9, 3, 21))).fill({ color: 0xffffff, alpha: 0.28 });
  g.poly(flat(band(-7.2, 7.2, 9, 17))).fill(0xd6332b);
  g.poly(flat(Array.from({ length: 25 }, (_, i) => { const u = -1 + i / 12; return [x + u * RX, y - (13 + 2.2 * Math.sin(Math.PI * (u + 1))) * s + drop(u * RX)] as P; })), false)
    .stroke({ width: 1.6 * s, color: 0xfff3e0, cap: 'round' });
  g.poly(flat(band(3.3, 5.8, 2, 20))).fill({ color: 0x000000, alpha: 0.25 });
  g.poly(flat(pts)).stroke({ width: 2.2 * s, color: INK, join: 'round' });
  const cr = 3.6 * s, cry = 1.8 * s, c0 = y - 41 * s, c1 = y - 45 * s;
  g.poly(flat([[x - cr, c1], ...footCurve(x, c0, cr, cry).reverse(), ...ellipseArc(x, c1, cr, cry, 0, -Math.PI).slice(0, -1)])).fill(0xe0b23a).stroke({ width: 1.8 * s, color: INK, join: 'round' });
  g.ellipse(x, c1, cr, cry).fill(0xf0c85a).stroke({ width: 1.2 * s, color: INK });
}

/** A 1UP: a green mushroom with white spots, standing on `q`, 40 tall at scale 1. */
function mushroom(g: Graphics, q: P, s: number): void {
  const [x, y] = q;
  const RX = 8 * s, RY = 4 * s;
  g.ellipse(x, y + 0.5 * s, 12 * s, 5.5 * s).fill({ color: 0x000000, alpha: 0.25 });
  // The stem, widening at the foot, its foot round.
  const side: P[] = [[-8, 0], [-9, -6], [-7.5, -17], [7.5, -17], [9, -6], [8, 0]];
  const stem = [...side.map(([a, b]) => [x + a * s, y + b * s] as P), ...footCurve(x, y, RX, RY).slice(1, -1)];
  g.poly(flat(stem)).fill(0xf3e6c4);
  g.poly(flat([[x + 4.5 * s, y - 16 * s], [x + 7.5 * s, y - 16 * s], [x + 9 * s, y - 6 * s], ...ellipseArc(x, y, RX, RY, 0, Math.acos(3 / 8), 8)])).fill({ color: 0xc9b48b, alpha: 0.9 });
  g.poly(flat(stem)).stroke({ width: 2.2 * s, color: INK, join: 'round' });
  // The cap: a dome with a rim, darker away from the light, hatched there.
  const cx = x, cy = y - 17 * s, rx = 19 * s, ry = 18 * s;
  g.moveTo(cx - rx, cy).bezierCurveTo(cx - rx, cy - ry * 1.35, cx + rx, cy - ry * 1.35, cx + rx, cy)
    .bezierCurveTo(cx + rx * 0.6, cy + 4.5 * s, cx - rx * 0.6, cy + 4.5 * s, cx - rx, cy).fill(0x3fae3c);
  g.moveTo(cx + rx * 0.2, cy - ry * 0.98).bezierCurveTo(cx + rx * 0.85, cy - ry * 0.9, cx + rx, cy - ry * 0.3, cx + rx, cy)
    .bezierCurveTo(cx + rx * 0.7, cy + 3.5 * s, cx + rx * 0.3, cy + 3.8 * s, cx + rx * 0.15, cy + 3.8 * s).fill(0x2a8a2c);
  for (const [a, b, rr] of [[-10, -9, 5.2], [3, -15, 4.2], [11, -6, 3.6], [-2, -4, 3]] as const) g.ellipse(cx + a * s, cy + b * s, rr * s, rr * 0.8 * s).fill(0xfbfbf4).stroke({ width: 1.4 * s, color: INK, alpha: 0.6 });
  g.ellipse(cx - 9 * s, cy - 14 * s, 4 * s, 2 * s).fill({ color: 0xffffff, alpha: 0.55 });
  g.moveTo(cx - rx, cy).bezierCurveTo(cx - rx, cy - ry * 1.35, cx + rx, cy - ry * 1.35, cx + rx, cy)
    .bezierCurveTo(cx + rx * 0.6, cy + 4.5 * s, cx - rx * 0.6, cy + 4.5 * s, cx - rx, cy).stroke({ width: 2.6 * s, color: INK, join: 'round' });
}

/** A bandage roll standing on `q`: a short white cylinder with its wound layers showing on top. */
function bandageRoll(g: Graphics, q: P, s: number): void {
  const [x, y] = q;
  const rx = 12 * s, ry = 6 * s, h = 13 * s;
  // Its side, ending below on the near half of its foot; the shade on its far side follows the same curve.
  const side: P[] = [[x - rx, y - h], ...footCurve(x, y, rx, ry).reverse(), [x + rx, y - h]];
  g.poly(flat(side)).fill(0xf5f1e6);
  const shade: P[] = [[x + rx * 0.35, y - h], [x + rx, y - h], ...ellipseArc(x, y, rx, ry, 0, Math.acos(0.35), 8)];
  g.poly(flat(shade)).fill(0xd9d2bf);
  hatch(g, shade, -1.2, 3.2 * s, 0.9 * s, 0.55, 0.8, 3);
  g.ellipse(x, y - h, rx, ry).fill(0xfbf9f2);
  for (const k of [0.72, 0.46]) g.ellipse(x, y - h, rx * k, ry * k).stroke({ width: 1 * s, color: 0xb9b19c });
  g.ellipse(x, y - h, rx * 0.22, ry * 0.22).fill(0x8e8672);
  g.poly(flat(side), false).stroke({ width: 2.2 * s, color: INK, join: 'round' });
  g.ellipse(x, y - h, rx, ry).stroke({ width: 2.2 * s, color: INK });
}

/**
 * A bandage roll lying on its side at (x, y, z) on the grid, its axis along y, `r` its radius and `len` its length in tiles,
 * its loose end let out flat along +x for `tail` tiles. The gauze is as wide as the roll is long, and the roll sits on it.
 */
function bandageLying(g: Graphics, p: Proj, x: number, y: number, z: number, r: number, len: number, tail: number, lw: number): void {
  const y0 = y - len / 2, y1 = y + len / 2, zc = z + r;
  // The gauze along the ground from under the roll, wandering a little, two threads of its weave showing.
  const wob = (t: number) => Math.sin(t * Math.PI * 1.3) * 0.04;
  const edge = (yy: number): P[] => Array.from({ length: 13 }, (_, i) => { const t = i / 12; return p(x + t * tail, yy + wob(t), z + 0.004); });
  g.poly(flat([...edge(y0), ...edge(y1).reverse()])).fill(0xfbf9f2);
  for (const k of [0.33, 0.67]) g.poly(flat(edge(y0 + len * k)), false).stroke({ width: lw * 0.35, color: 0xc8c0aa });
  g.poly(flat([...edge(y0), ...edge(y1).reverse()])).stroke({ width: lw * 0.8, color: INK, join: 'round' });
  // Its shadow on the gauze.
  g.poly(flat([p(x - r * 0.8, y0, z), p(x + r * 1.15, y0, z), p(x + r * 1.15, y1 + 0.03, z), p(x - r * 0.8, y1 + 0.03, z)])).fill({ color: 0x000000, alpha: 0.2 });
  // The roll: its round body, darker and hatched on its side away from the light (+x, as the boxes' are), its near end
  // showing the wound layers.
  const ring = (yy: number, k = 1, n = 32): P[] => Array.from({ length: n }, (_, i) => { const a = (i / n) * Math.PI * 2; return p(x + r * k * Math.cos(a), yy, zc + r * k * Math.sin(a)); });
  const body = hull([...ring(y0), ...ring(y1)]);
  g.poly(flat(body)).fill(0xf5f1e6);
  const A0 = -0.88, A1 = 0.7, at = (a: number, yy: number): P => p(x + r * Math.cos(a), yy, zc + r * Math.sin(a));
  const shade: P[] = [];
  for (let i = 0; i <= 10; i++) shade.push(at(A0 + ((A1 - A0) * i) / 10, y0));
  for (let i = 10; i >= 0; i--) shade.push(at(A0 + ((A1 - A0) * i) / 10, y1));
  g.poly(flat(shade)).fill(0xd9d2bf);
  hatch(g, shade, -1.2, lw * 1.45, lw * 0.4, 0.55, 0.8, 5);
  g.poly(flat(ring(y1))).fill(0xfbf9f2);
  for (const k of [0.72, 0.46]) g.poly(flat(ring(y1, k))).stroke({ width: lw * 0.45, color: 0xb9b19c });
  g.poly(flat(ring(y1, 0.22, 16))).fill(0x8e8672);
  g.poly(flat(body)).stroke({ width: lw, color: INK, join: 'round' });
  g.poly(flat(ring(y1))).stroke({ width: lw, color: INK, join: 'round' });
}

/** A flame as the game's fires draw theirs (src/art/fire.ts): an inked red-orange tongue, an orange one inside, a yellow heart. */
function flame(g: Graphics, x: number, y: number, size: number, flip = false): void {
  const h = size * 0.9, w = size * 0.4 * (flip ? -1 : 1);
  const tongue = (k: number, color: number, ink: boolean) => {
    const hw = w * k, hh = h * k;
    const pts = [x - hw, y, x - hw * 0.8, y - hh * 0.45, x - hw * 0.25, y - hh * 0.62, x + hw * 0.1, y - hh, x + hw * 0.35, y - hh * 0.55, x + hw * 0.85, y - hh * 0.4, x + hw, y];
    g.poly(pts).fill(color);
    if (ink) g.poly(pts).stroke({ width: Math.max(1, size * 0.07), color: INK, join: 'round' });
  };
  tongue(1, 0xe8541e, true);
  tongue(0.68, 0xffa62b, false);
  tongue(0.38, 0xffe066, false);
}

/** A five-pointed star's points. */
const star = (cx: number, cy: number, r: number, inner = 0.45, rot = -Math.PI / 2): P[] =>
  Array.from({ length: 10 }, (_, i) => { const a = rot + (i * Math.PI) / 5, k = i % 2 ? r * inner : r; return [cx + Math.cos(a) * k, cy + Math.sin(a) * k] as P; });

/** A comic hit: a jagged burst in yellow over white, inked. */
function burst(g: Graphics, cx: number, cy: number, r: number, seed: number): void {
  const n = 12, rnd = rng(seed);
  const pts = (k: number): P[] => Array.from({ length: n * 2 }, (_, i) => {
    const a = (i / (n * 2)) * Math.PI * 2 + 0.2, rr = (i % 2 ? r * 0.5 : r * (0.82 + rnd() * 0.3)) * k;
    return [cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * 0.86] as P;
  });
  g.poly(flat(pts(1))).fill(0xfff4c2).stroke({ width: 3.2, color: INK, join: 'miter' });
  g.poly(flat(pts(0.62))).fill(0xffd23a);
  g.poly(flat(pts(0.3))).fill(0xffffff);
}

/** Speed lines trailing from a point the way a figure came. */
function speed(g: Graphics, cx: number, cy: number, dx: number, dy: number, n: number, len: number, spread: number): void {
  const nx = -dy, ny = dx;
  for (let i = 0; i < n; i++) {
    const o = (i - (n - 1) / 2) * spread, l = len * (0.6 + ((i * 37) % 10) / 22);
    g.moveTo(cx + nx * o, cy + ny * o).lineTo(cx + nx * o - dx * l, cy + ny * o - dy * l);
  }
  g.stroke({ width: 3, color: INK, cap: 'round', alpha: 0.85 });
}

/** Dazed stars over a head. */
function dizzy(g: Graphics, cx: number, cy: number, r: number): void {
  for (const [dx, dy] of [[-1, 0.15], [0, -0.3], [1, 0.1]] as const) g.poly(flat(star(cx + dx * r, cy + dy * r, r * 0.34))).fill(0xffd23a).stroke({ width: 2.4, color: INK, join: 'round' });
}

// ---- the scenes ------------------------------------------------------------------------------------------------------

/** A scene: where its grid's corner sits in the drawing, the colour beyond its edges, how dark its shadows are, where the photo looks and how far it zooms in. Its art is listed in src/art/iso_scene_art.ts. */
interface IsoScene {
  origin: [x: number, y: number];
  bg: number;
  shadow?: number;
  focus: [x: number, y: number, zoom: number];
  /** What must stay in the photo whatever its box's shape (a game-over page's is long and low): zoomed out to fit, if need be. */
  keep?: [x0: number, y0: number, x1: number, y1: number];
  build: (s: Stage) => void;
}

const PINK = 0xff3fcf, BLUE = 0x3a5bff, YELLOW = 0xffd23a;

/** 1. Gearing up at home: the trio about the table, laying out bandages, sodas, 1UP mushrooms, the map and cherries. */
const houseGearup = (s: Stage): void => {
  const p = s.p;
  const g = s.ground;
  const RX = 9, RY = 7, WH = 2.5;
  // The door, in the back wall just past the bed: the Blue Thing stands in it, behind the table.
  const DX = 3.3;
  // The floor: dark, a faint magenta grid as the house's is, a rug under the table.
  g.poly(flat([p(0, 0), p(RX, 0), p(RX, RY), p(0, RY)])).fill(0x0c0812);
  for (let i = 1; i < RX; i++) g.moveTo(...p(i, 0)).lineTo(...p(i, RY));
  for (let j = 1; j < RY; j++) g.moveTo(...p(0, j)).lineTo(...p(RX, j));
  g.stroke({ width: 1.6, color: 0x3c1442, alpha: 0.9 });
  const rug: P[] = [p(2.4, 1.9), p(7.0, 1.9), p(7.0, 5.3), p(2.4, 5.3)];
  g.poly(flat(rug)).fill(0x2b1446).stroke({ width: 3, color: INK });
  g.poly(flat([p(2.65, 2.15), p(6.75, 2.15), p(6.75, 5.05), p(2.65, 5.05)])).stroke({ width: 3, color: 0xc8399f });
  g.poly(flat([p(2.85, 2.35), p(6.55, 2.35), p(6.55, 4.85), p(2.85, 4.85)])).stroke({ width: 1.6, color: 0x6f86ff });
  for (let i = 0; i < 9; i++) { const x = 2.4 + (i / 8) * 4.6; g.moveTo(...p(x, 5.3)).lineTo(...p(x - 0.05, 5.48)); }
  g.stroke({ width: 2, color: 0xc8399f });
  // The doorway's light, falling in across the floor, fading as it goes; the lamp's warm pool under the table.
  for (let k = 0; k < 5; k++) {
    const f = 0.55 + k * 0.45;
    s.light.poly(flat([p(DX, 0), p(DX + 1, 0), p(DX + 1 + f * 0.35, f), p(DX + f * 0.2, f)])).fill({ color: 0xffb04a, alpha: 0.12 });
  }
  for (let i = 0; i < 12; i++) { const k = 1 - i * 0.06; s.light.ellipse(...p(4.7, 3.4), 440 * k, 220 * k).fill({ color: 0xffc070, alpha: 0.045 }); }

  // The walls, dark, edged in the house's pink neon.
  s.draw(-10, (w) => {
    const wallA = { top: 0x1d1030, side: 0x110a1e, dark: 0.1 };
    box(w, p, -0.3, -0.3, 0, RX + 0.3, 0.3, WH, wallA);
    box(w, p, -0.3, 0, 0, 0.3, RY, WH, { ...wallA, side: 0x150c24 });
    // Wainscot lines, faint.
    for (const z of [0.9]) {
      w.poly(flat([p(0, RY, z), p(0, 0, z), p(RX, 0, z)]), false).stroke({ width: 2, color: 0x2a1540 });
    }
    // The window on the left wall: a night outside with the arcade's dots.
    const win = onX(p, 0, 0, 0, 2.3, 4.3, 1.0, 2.0);
    w.poly(flat(win)).fill(0x070b2a);
    const r = rng(5);
    for (let i = 0; i < 9; i++) { const [a, b] = p(0, 2.5 + r() * 1.6, 1.15 + r() * 0.75); w.rect(a - 2.5, b - 2.5, 5, 5).fill(YELLOW); s.halo(a, b, 9, YELLOW, 0.5, s.glow); }
    w.circle(...p(0, 3.9, 1.8), 9).fill(0xfff1b8);
    s.tube(w, [...win, win[0]!], BLUE, 4.5);
    s.tube(w, [p(0, 3.3, 1.0), p(0, 3.3, 2.0)], BLUE, 3.5);
    s.tube(w, [p(0, 2.3, 1.5), p(0, 4.3, 1.5)], BLUE, 3.5);
    // The door on the back wall, open, warm light beyond.
    const door = onY(p, DX, 0, 0, 0, 1.0, 0, 1.75);
    w.poly(flat(door)).fill(0xffd27a);
    w.poly(flat(onY(p, DX, 0, 0, 0.12, 0.88, 0, 1.6))).fill(0xffe9b8);
    w.poly(flat([p(DX, 0, 0), p(DX, 0.75, 0), p(DX, 0.75, 1.75), p(DX, 0, 1.75)])).fill(0x2a1640).stroke({ width: 3, color: INK });
    w.circle(...p(DX, 0.62, 0.85), 3.5).fill(YELLOW);
    s.tube(w, [p(DX, 0, 0), p(DX, 0, 1.75), p(DX + 1, 0, 1.75), p(DX + 1, 0, 0)], PINK, 5);
    // Neon along the tops and feet of the walls, and up the corner.
    s.tube(w, [p(0, RY, WH), p(0, 0, WH), p(RX, 0, WH)], PINK, 6);
    s.tube(w, [p(0, RY, 0.06), p(0, 0, 0.06), p(DX, 0, 0.06)], PINK, 5);
    s.tube(w, [p(DX + 1, 0, 0.06), p(RX, 0, 0.06)], PINK, 5);
    s.tube(w, [p(0, 0, 0.06), p(0, 0, WH)], PINK, 5);
  });

  // The bed in the back corner, where they rest.
  s.draw(0.9 + 2.9, (b) => {
    box(b, p, 0.25, 0.2, 0, 2.6, 1.5, 0.32, { top: 0x2c2a72, side: 0x1a1850, hatch: 0.5 });
    box(b, p, 0.3, 0.25, 0.32, 2.5, 1.4, 0.12, { top: 0x7b4fd0, side: 0x5a37a3 });
    box(b, p, 0.4, 0.35, 0.44, 0.7, 1.2, 0.14, { top: 0xf2ecff, side: 0xc8bde8 });
    box(b, p, 0.2, 0.15, 0, 0.18, 1.6, 0.9, { top: 0x2c2a72, side: 0x1a1850 });
    s.tube(b, [p(0.38, 0.15, 0.9), p(0.38, 1.75, 0.9), p(0.38, 1.75, 0)], BLUE, 3.5, 0.7);
    s.tube(b, [p(0.25, 1.7, 0.32), p(2.85, 1.7, 0.32), p(2.85, 0.2, 0.32)], BLUE, 3.5, 0.7);
  });

  // The save star, glowing on the floor.
  s.draw(1.5 + 5.6, (b) => {
    const [x, y] = p(1.5, 5.6, 0.25);
    s.soft(...p(1.5, 5.6), 30, 11);
    s.halo(x, y, 46, YELLOW, 0.55);
    b.poly(flat(star(x, y, 26))).fill(0xffd23a).stroke({ width: 3.5, color: INK, join: 'round' });
    b.poly(flat(star(x - 3, y - 4, 11))).fill({ color: 0xfff6c8, alpha: 0.9 });
  });

  // The table: a dark top edged in blue neon, a pool of lamplight on it.
  const TX = 3.05, TY = 2.4, TW = 3.3, TD = 2.0, TH = 0.72;
  s.draw(TX + TW + TY + TD - 0.6, (t) => {
    const leg = { top: 0x232a5c, side: 0x161b42, hatch: 0.4 };
    for (const [lx, ly] of [[TX + 0.1, TY + 0.1], [TX + TW - 0.28, TY + 0.1], [TX + 0.1, TY + TD - 0.28], [TX + TW - 0.28, TY + TD - 0.28]] as const) box(t, p, lx, ly, 0, 0.18, 0.18, TH - 0.12, leg);
    box(t, p, TX, TY, TH - 0.12, TW, TD, 0.12, { top: 0x2a3170, side: 0x1a2050 });
    t.poly(flat([p(TX + 0.4, TY + 0.25, TH), p(TX + TW - 0.4, TY + 0.25, TH), p(TX + TW - 0.25, TY + TD - 0.25, TH), p(TX + 0.25, TY + TD - 0.25, TH)])).fill({ color: 0x5a63c8, alpha: 0.5 });
    s.tube(t, [p(TX, TY + TD, TH), p(TX + TW, TY + TD, TH), p(TX + TW, TY, TH)], 0x6f86ff, 3.5, 0.8);

    // The map, unfolded at the front left: three panels, folded in a shallow zigzag, the maze printed on it and a route marked.
    const MX = TX + 0.25, MY = TY + 0.95, MW = 1.55, MD = 0.85;
    const fold = (u: number) => (1 - Math.abs(((u * 3) % 2) - 1)) * 0.045;
    const at = (u: number, v: number): P => p(MX + u * MW, MY + v * MD, TH + fold(u));
    for (let k = 0; k < 3; k++) {
      const u0 = k / 3, u1 = (k + 1) / 3;
      t.poly(flat([at(u0, 0), at(u1, 0), at(u1, 1), at(u0, 1)])).fill(k % 2 ? 0xe2d1a4 : 0xf4e8c8);
    }
    const ml = (pts: Array<[number, number]>) => t.poly(flat(pts.map(([u, v]) => at(u, v))), false);
    ml([[0.08, 0.12], [0.45, 0.12], [0.45, 0.4]]); ml([[0.6, 0.1], [0.92, 0.1], [0.92, 0.55]]); ml([[0.1, 0.3], [0.1, 0.88], [0.35, 0.88]]);
    ml([[0.25, 0.55], [0.6, 0.55], [0.6, 0.88], [0.85, 0.88]]); ml([[0.75, 0.3], [0.75, 0.7]]);
    t.stroke({ width: 2.4, color: 0x2a4bd8, join: 'round' });
    for (const [u, v] of [[0.2, 0.2], [0.35, 0.2], [0.55, 0.28], [0.68, 0.45], [0.2, 0.45], [0.47, 0.72], [0.72, 0.8]] as const) t.circle(...at(u, v), 2.2).fill(0xc08a1a);
    const route: P[] = [[0.05, 0.72], [0.18, 0.72], [0.18, 0.42], [0.52, 0.42], [0.52, 0.72], [0.68, 0.72], [0.68, 0.22], [0.86, 0.22]].map(([u, v]) => at(u!, v!));
    for (let i = 0; i < route.length - 1; i++) {
      const [a, b] = [route[i]!, route[i + 1]!];
      const n = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / 9));
      for (let k = 0; k < n; k += 2) t.moveTo(a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n).lineTo(a[0] + ((b[0] - a[0]) * (k + 1)) / n, a[1] + ((b[1] - a[1]) * (k + 1)) / n);
    }
    t.stroke({ width: 2.6, color: 0xd42a2a, cap: 'round' });
    const [xx, xy] = at(0.88, 0.2);
    t.moveTo(xx - 6, xy - 4).lineTo(xx + 6, xy + 4).moveTo(xx + 6, xy - 4).lineTo(xx - 6, xy + 4).stroke({ width: 3.2, color: 0xd42a2a, cap: 'round' });
    for (let k = 0; k <= 3; k++) t.poly(flat([at(k / 3, 0), at(k / 3, 1)]), false).stroke({ width: 1.3, color: 0xa08d5c });
    t.poly(flat([at(0, 0), at(1 / 3, 0), at(2 / 3, 0), at(1, 0), at(1, 1), at(2 / 3, 1), at(1 / 3, 1), at(0, 1)])).stroke({ width: 2.4, color: INK, join: 'round' });

    // Along the back: three 1UPs and a first-aid tin; sodas at the right; bandages and the cherry bowl at the front right.
    mushroom(t, p(TX + 0.5, TY + 0.42, TH), 1.4);
    mushroom(t, p(TX + 1.0, TY + 0.32, TH), 1.25);
    mushroom(t, p(TX + 0.9, TY + 0.78, TH), 1.35);
    const KX = TX + 1.45, KY = TY + 0.22, KW = 0.78, KD = 0.52, KH = 0.32;
    box(t, p, KX, KY, TH, KW, KD, KH, { top: 0xf6f3ea, side: 0xdcd6c8, hatch: 0.35, line: 2.8 });
    const cross = (u0: number, u1: number, v0: number, v1: number): P[] => [p(KX + u0 * KW, KY + v0 * KD, TH + KH), p(KX + u1 * KW, KY + v0 * KD, TH + KH), p(KX + u1 * KW, KY + v1 * KD, TH + KH), p(KX + u0 * KW, KY + v1 * KD, TH + KH)];
    t.poly(flat(cross(0.4, 0.6, 0.18, 0.82))).fill(0xd8322b);
    t.poly(flat(cross(0.22, 0.78, 0.38, 0.62))).fill(0xd8322b);
    for (const [bx, by] of [[TX + 2.5, TY + 0.22], [TX + 2.85, TY + 0.3], [TX + 2.35, TY + 0.55], [TX + 2.72, TY + 0.68]] as const) bottle(t, p(bx, by, TH), 1.45);
    bandageRoll(t, p(TX + 2.0, TY + 1.2, TH), 1.45);
    bandageLying(t, p, TX + 1.9, TY + 1.65, TH, 0.17, 0.22, 0.45, 3);
    // The cherry bowl.
    const [bx, by] = p(TX + 2.6, TY + 1.35, TH);
    t.ellipse(bx, by + 5, 44, 15).fill({ color: 0x000000, alpha: 0.3 });
    t.moveTo(bx - 44, by - 18).bezierCurveTo(bx - 42, by + 16, bx + 42, by + 16, bx + 44, by - 18).fill(0xf2f2f6).stroke({ width: 3, color: INK });
    t.moveTo(bx - 39, by - 5).bezierCurveTo(bx - 13, by + 7, bx + 16, by + 7, bx + 40, by - 6).stroke({ width: 4.5, color: 0x3a5bd8 });
    t.ellipse(bx, by - 18, 44, 14).fill(0x7a0a1c).stroke({ width: 3, color: INK });
    for (const [dx, dy, sp] of [[-21, -23, -0.4], [5, -29, 0.3], [24, -21, 0.9], [-5, -18, -1.1], [16, -12, 2.2], [-26, -13, 2.8], [-10, -32, 1.6]] as const) cherryPair(t, bx + dx, by + dy, 8.5, sp);
    // Two cherries rolled loose on the table, by Ronnie.
    cherryPair(t, ...p(TX + TW - 0.22, TY + 0.95, TH + 0.16), 8.5, 0.5);
  });

  // The hanging lamp over the table.
  s.draw(100, (l) => {
    const [x, y] = p(TX + TW / 2, TY + TD / 2, 2.45);
    l.moveTo(x, y - 160).lineTo(x, y - 22).stroke({ width: 3, color: 0x4a3a5a });
    l.poly(flat([[x - 10, y - 24], [x + 10, y - 24], [x + 34, y + 6], [x - 34, y + 6]])).fill(0x261836).stroke({ width: 3.2, color: INK, join: 'round' });
    l.ellipse(x, y + 6, 34, 8).fill(0xfff0c0).stroke({ width: 3, color: INK });
    s.tube(l, [[x - 34, y + 6], [x - 10, y - 24], [x + 10, y - 24], [x + 34, y + 6]], PINK, 3, 0.6);
    for (const [k, a] of [[1, 0.12], [0.7, 0.18], [0.45, 0.25]] as const) s.glow.ellipse(x, y + 14, 80 * k, 30 * k).fill({ color: 0xffe2a0, alpha: a });
  });

  // A crate of sodas on the floor by the table, and a bandage unrolling across the rug.
  s.draw(6.7 + 3.9 + 1, (c) => {
    const crate: Mat = { top: 0x8a5a2e, side: 0xb47a42, dark: 0.32, hatch: 0.45 };
    const slats = () => { for (const v of [0.14, 0.28]) c.poly(flat([p(6.7, 4.68, v), p(7.7, 4.68, v)]), false).stroke({ width: 2, color: 0x6b4220 }); };
    box(c, p, 6.7, 3.9, 0, 1.0, 0.78, 0.42, crate);
    slats();
    c.poly(flat([p(6.75, 3.95, 0.42), p(7.65, 3.95, 0.42), p(7.65, 4.63, 0.42), p(6.75, 4.63, 0.42)])).fill(0x3a2412);
    // The bottles, farthest first; then the crate's near walls again over them, as they stand inside it: only what rises
    // above its rim shows. The rim along those walls' tops, inked on its outside.
    const spots: P[] = [];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) spots.push([6.9 + i * 0.3, 4.1 + j * 0.32]);
    for (const [bx, by] of spots.sort((a, b) => a[0] + a[1] - (b[0] + b[1]))) bottle(c, p(bx, by, 0.08), 1.2);
    nearWalls(c, p, 6.7, 3.9, 0, 1.0, 0.78, 0.42, crate);
    slats();
    c.poly(flat([p(6.7, 4.68, 0.42), p(7.7, 4.68, 0.42), p(7.7, 3.9, 0.42), p(7.65, 3.95, 0.42), p(7.65, 4.63, 0.42), p(6.75, 4.63, 0.42)])).fill(crate.top);
    c.poly(flat([p(6.7, 4.68, 0.42), p(7.7, 4.68, 0.42), p(7.7, 3.9, 0.42)]), false).stroke({ width: 3, color: INK, join: 'round' });
  });
  s.draw(4.6 + 5.5, (b) => bandageLying(b, p, 4.6, 5.5, 0, 0.15, 0.2, 1.0, 2.6));
  // The knapsack they are packing, open on the floor, a soda and a 1UP already in.
  s.draw(3.3 + 5.5, (k) => {
    const [x, y] = p(3.3, 5.5);
    s.soft(x, y + 2, 46, 15);
    bottle(k, [x + 6, y - 36], 1);
    mushroom(k, [x - 14, y - 34], 0.8);
    const bag: P[] = [[-38, 0], [-42, -30], [-34, -52], [34, -52], [42, -30], [38, 0]];
    const bp = bag.map(([a, b]) => [x + a, y + b] as P);
    k.moveTo(...bp[0]!).lineTo(...bp[1]!).quadraticCurveTo(x - 44, y - 50, x - 34, y - 52).lineTo(x + 34, y - 52).quadraticCurveTo(x + 44, y - 50, x + 42, y - 30).lineTo(...bp[5]!)
      .quadraticCurveTo(x, y + 12, x - 38, y).fill(0xb98a4a);
    k.moveTo(x + 8, y - 50).lineTo(x + 34, y - 52).quadraticCurveTo(x + 44, y - 50, x + 42, y - 30).lineTo(x + 38, y).quadraticCurveTo(x + 20, y + 9, x + 8, y + 8).fill(0x96693a);
    hatch(k, [[x + 10, y - 48], [x + 40, y - 48], [x + 40, y], [x + 10, y + 6]], -1.1, 5, 1.3, 0.5, 0.6, 13);
    // The opening's dark mouth, the flap thrown back, two straps, a pocket.
    k.ellipse(x, y - 52, 34, 9).fill(0x3a2412).stroke({ width: 3, color: INK });
    k.moveTo(x - 30, y - 56).quadraticCurveTo(x - 6, y - 82, x + 26, y - 60).quadraticCurveTo(x + 6, y - 68, x - 30, y - 56).fill(0xc99a58).stroke({ width: 3, color: INK, join: 'round' });
    k.roundRect(x - 22, y - 30, 30, 22, 6).fill(0xa87a40).stroke({ width: 2.4, color: INK });
    for (const dx of [-24, 18]) k.moveTo(x + dx, y - 52).lineTo(x + dx + 2, y - 4).stroke({ width: 5, color: 0x5a3818, cap: 'round' });
    k.moveTo(...bp[0]!).lineTo(...bp[1]!).quadraticCurveTo(x - 44, y - 50, x - 34, y - 52).lineTo(x + 34, y - 52).quadraticCurveTo(x + 44, y - 50, x + 42, y - 30).lineTo(...bp[5]!)
      .quadraticCurveTo(x, y + 12, x - 38, y).stroke({ width: 3.4, color: INK, join: 'round' });
  });
  s.draw(7.2 + 4.9, (m) => mushroom(m, p(7.2, 4.9), 1.35));

  // The trio and the Blue Thing: Olli studying the map, Ronnie going for the cherries, Gorbie counting the sodas, the Blue Thing
  // looking in at the door.
  s.figure('olli', 2.35, 3.9, 46, { facing: 'right', mouth: 0.25 });
  s.figure('ronnie', 7.15, 3.0, 46, { facing: 'left', mouth: 0.95 });
  s.figure('gorbie', 6.05, 1.55, 46, { facing: 'left', mouth: 0.35 });
  s.figure('blue_thing', 3.85, 0.55, 40, { facing: 'right', mouth: 0.5 });
};

/** 2. Ghostbusting in the maze: neon corridors, dots, the trio chomping into the maze ghosts, the giant ghost rising out of its house. */
const mazeGhostbusting = (s: Stage): void => {
  const p = s.p;
  const g = s.ground;
  const X0 = -4, X1 = 18, Y0 = -4, Y1 = 17;
  g.poly(flat([p(X0, Y0), p(X1, Y0), p(X1, Y1), p(X0, Y1)])).fill(0x05060f);
  for (let i = X0; i <= X1; i++) g.moveTo(...p(i, Y0)).lineTo(...p(i, Y1));
  for (let j = Y0; j <= Y1; j++) g.moveTo(...p(X0, j)).lineTo(...p(X1, j));
  g.stroke({ width: 1.4, color: 0x0e1748, alpha: 0.9 });
  // Islands of wall between one-tile corridors, as the maze's are; the ghosts' house in the middle, its door open.
  const walls: Array<[number, number, number, number]> = [
    [-4, -4, 22, 1], [-4, -3, 1, 20],
    [-2, -2, 3, 2], [2, -2, 4, 2], [7, -2, 2, 4], [10, -2, 4, 2], [15, -2, 2, 2],
    [-2, 1, 3, 1], [2, 1, 1, 4], [10, 1, 2, 1], [13, 1, 4, 2],
    [-2, 3, 3, 4], [12, 3, 1, 4], [14, 4, 3, 1],
    [-2, 8, 3, 1], [2, 6, 1, 3], [14, 6, 3, 2], [11, 8, 3, 1],
    [-2, 10, 4, 1], [3, 10, 1, 3], [7, 11, 3, 1], [11, 10, 1, 3], [13, 10, 4, 1],
    [-2, 12, 4, 3], [5, 13, 5, 2], [13, 12, 4, 3],
  ];
  // The ghosts' house: a box of four walls, open at the back where its door is.
  const house: Array<[number, number, number, number]> = [[4, 3, 0.4, 5], [4, 7.6, 6, 0.4], [9.6, 3, 0.4, 5], [4, 3, 2, 0.4], [8, 3, 2, 0.4]];
  const HT = 0.45;
  for (const [wx, wy, ww, wd] of walls) s.neonBlock(wx, wy, ww, wd, HT, BLUE);
  for (const [wx, wy, ww, wd] of house) s.neonBlock(wx, wy, ww, wd, HT, BLUE, 3.6, 0.04);
  // Dots along every corridor, a dot to a tile; a trail of them already eaten behind the trio; a power pellet in two corners.
  const solid = [...walls, ...house.map(([x, y]) => [x, y, 0, 0] as [number, number, number, number]), [4, 3, 6, 5] as [number, number, number, number]];
  const inside = (x: number, y: number) => solid.some(([wx, wy, ww, wd]) => x > wx && x < wx + ww && y > wy && y < wy + wd);
  const eaten = (x: number, y: number) => (y === 9.5 && x < 6) || (x === 10.5 && y > 3 && y < 6.3) || (x === 3.5 && y > 6.2 && y < 9.6);
  const dots = new Graphics();
  for (let x = X0 + 0.5; x < X1; x++) for (let y = Y0 + 0.5; y < Y1; y++) {
    if (inside(x, y) || eaten(x, y) || ((x === 0.5 && y === 11.5) || (x === 14.5 && y === 0.5))) continue;
    const [a, b2] = p(x, y, 0.05);
    dots.poly(flat([[a, b2 - 5], [a + 7, b2], [a, b2 + 5], [a - 7, b2]])).fill(YELLOW);
    s.halo(a, b2, 13, YELLOW, 0.4);
  }
  s.put(-5, dots);
  for (const [x, y] of [[0.5, 11.5], [14.5, 0.5]] as const) s.draw(x + y, (b) => {
    const [a, c] = p(x, y, 0.2);
    s.halo(a, c, 54, YELLOW, 0.9);
    b.circle(a, c, 15).fill(0xffe46a).stroke({ width: 3, color: INK });
    b.ellipse(a - 4, c - 5, 5, 3).fill(0xffffff);
  });

  // The giant ghost, rising out of its house, its eyes on the trio; a white flower left by the door.
  s.figure('ghost_giant', 7.0, 5.4, 118, { facing: 'down' }, { z: 0.5, shadow: 0.85, depth: 12.2 });
  s.prop('maze', 'flower_white', 8.4, 6.9, 34, { depth: 15.2 });
  // All close round the ghosts' house: Olli chomping the red one along the front;
  // Ronnie coming down the right side into the cyan one; Gorbie chasing the pink one up the left side, past the orange one, out cold.
  const O: P = [6.0, 9.5], R: P = [10.5, 6.3], K: P = [3.5, 8.4], Q: P = [3.5, 4.5];
  const red = s.figure('ghost_red', 7.25, 9.4, 42, { facing: 'left' }, { z: 0.25, shadow: 0.8 });
  red.rotation = 0.22;
  s.figure('ghost_cyan', 10.5, 7.7, 42, { facing: 'right', dazed: true }, { z: 0.25, shadow: 0.8 });
  s.figure('ghost_orange', ...K, 40, { facing: 'right', ko: true }, { z: 0.02, shadow: 0.8 });
  s.figure('ghost_pink', ...Q, 40, { facing: 'right' }, { z: 0.3, shadow: 0.7 });
  s.figure('olli', ...O, 48, { facing: 'right', mouth: 1 });
  // Over the house's right wall, which he stands in front of: by its tile's near corner it would sort over his face.
  s.figure('ronnie', ...R, 48, { facing: 'left', mouth: 1 }, { depth: 17.4 });
  s.figure('gorbie', 3.5, 6.2, 48, { facing: 'right', mouth: 0.55 });
  // The action: hits, speed lines, stars.
  s.draw(60, (fx) => {
    const [ox, oy] = p(...O);
    speed(fx, ox - 62, oy - 52, 0.9, 0.44, 4, 52, 13);
    burst(fx, red.x - 40, red.y - 6, 32, 3);
    const [rx, ry] = p(...R);
    burst(fx, rx - 62, ry - 18, 24, 9);
    speed(fx, rx + 58, ry - 50, -0.95, 0.3, 3, 40, 13);
    const [kx, ky] = p(...K, 0.02);
    dizzy(fx, kx, ky - 104, 28);
    const [px, py] = p(...Q, 0.3);
    speed(fx, px - 40, py - 30, 0.89, -0.45, 3, 40, 15);
  });
};

/** 3. Over the river: the trio crossing the plank bridge out of the arcade's neon maze, into grass, birches and spruces. */
const bridgeCrossing = (s: Stage): void => {
  const p = s.p;
  const g = s.ground;
  const X0 = -6, X1 = 18, Y0 = -6, Y1 = 14;
  // The arcade's edge: a stepped line in y, the maze's floor on its far side.
  const edge = (y: number) => 2.4 + (Math.floor(y / 2) % 2 === 0 ? 0 : 0.8) + (y < 0 ? -0.6 : 0);
  const riverX = (y: number) => 6.2 + Math.sin(y * 0.45) * 0.25;
  const RW = 2.4;
  const pathY0 = 3.45, pathY1 = 4.75;
  // Grass, in two greens by tile.
  for (let x = X0; x < X1; x++) for (let y = Y0; y < Y1; y++) {
    if (x + 1 <= edge(y)) continue;
    g.poly(flat([p(x, y), p(x + 1, y), p(x + 1, y + 1), p(x, y + 1)])).fill((x + y) % 2 ? 0x6cbf47 : 0x74c74e);
  }
  // The maze's floor and its grid, up to the edge.
  for (let y = Y0; y < Y1; y++) {
    const e = edge(y);
    g.poly(flat([p(X0, y), p(e, y), p(e, y + 1), p(X0, y + 1)])).fill(0x05060f);
    for (let x = X0; x < e; x++) g.moveTo(...p(x, y)).lineTo(...p(x, y + 1));
    g.moveTo(...p(X0, y)).lineTo(...p(e, y));
  }
  g.stroke({ width: 1.4, color: 0x101a52 });
  // The dirt path, to the bridge and on toward us.
  const dirt = (x0: number, x1: number) => g.poly(flat([p(x0, pathY0), p(x1, pathY0), p(x1, pathY1), p(x0, pathY1)])).fill(0xc99a5c);
  dirt(edge(4), riverX(4) - 0.1); dirt(riverX(4) + RW + 0.1, X1);
  g.poly(flat([p(edge(4), pathY1), p(riverX(4) - 0.1, pathY1)]), false).stroke({ width: 2, color: 0x9a7240 });
  g.poly(flat([p(riverX(4) + RW + 0.1, pathY1), p(X1, pathY1)]), false).stroke({ width: 2, color: 0x9a7240 });
  const r = rng(11);
  for (let i = 0; i < 70; i++) {
    const x = edge(4) + r() * (X1 - edge(4)), y = pathY0 + 0.1 + r() * (pathY1 - pathY0 - 0.2);
    if (x > riverX(y) - 0.2 && x < riverX(y) + RW + 0.2) continue;
    g.ellipse(...p(x, y), 2.4 + r() * 1.6, 1.4 + r()).fill(0x8c6a3a);
  }
  // Grass tufts, scattered by tile.
  for (let x = X0; x < X1; x++) for (let y = Y0; y < Y1; y++) {
    if (x <= edge(y) || (x + 1 > riverX(y) - 0.2 && x < riverX(y) + RW + 0.2) || (y + 1 > pathY0 && y < pathY1)) continue;
    for (let k = 0; k < 2; k++) {
      const [a, b] = p(x + r(), y + r());
      for (const dx of [-5, 0, 5]) g.moveTo(a + dx * 0.4, b).lineTo(a + dx, b - 9 - Math.abs(dx) * 0.6);
    }
  }
  g.stroke({ width: 2.2, color: 0x3f8a2c, cap: 'round' });
  // The arcade's dots, thinning out past the edge onto the grass in bright bits.
  for (let i = 0; i < 26; i++) {
    const y = Y0 + r() * (Y1 - Y0), x = edge(y) + r() * r() * 3.2;
    if (x > riverX(y) - 0.3) continue;
    const [a, b] = p(x, y, 0.02);
    g.rect(a - 3, b - 3, 6, 6).fill([0x4ad2ff, YELLOW, 0xff5fc8][i % 3]!);
  }

  // The river, sunk a little, with its near bank's face showing and ripples on it.
  const ZW = -0.22;
  const bank: P[] = [], bankFar: P[] = [];
  for (let y = Y0; y <= Y1; y += 0.25) { bank.push(p(riverX(y), y)); bankFar.push(p(riverX(y) + RW, y)); }
  const water: P[] = [];
  for (let y = Y0; y <= Y1; y += 0.25) water.push(p(riverX(y), y, ZW));
  for (let y = Y1; y >= Y0; y -= 0.25) water.push(p(riverX(y) + RW, y, ZW));
  g.poly(flat(water)).fill(0x3d8fd8);
  const face: P[] = [];
  for (let y = Y0; y <= Y1; y += 0.25) face.push(p(riverX(y), y));
  for (let y = Y1; y >= Y0; y -= 0.25) face.push(p(riverX(y), y, ZW));
  g.poly(flat(face)).fill(0x5a4630);
  hatch(g, face, -1.1, 6, 1.4, 0.45, 1, 5);
  for (let y = Y0; y < Y1; y += 0.25) g.moveTo(...p(riverX(y), y, ZW)).lineTo(...p(riverX(y) + 0.18, y, ZW));
  g.stroke({ width: 5, color: 0x2f73b8 });
  for (let i = 0; i < 46; i++) {
    const y = Y0 + r() * (Y1 - Y0), x = riverX(y) + 0.3 + r() * (RW - 0.6);
    const [a, b] = p(x, y, ZW);
    g.moveTo(a - 12, b).bezierCurveTo(a - 6, b - 4, a - 2, b + 3, a + 4, b - 1).bezierCurveTo(a + 8, b - 4, a + 12, b + 1, a + 14, b - 1);
  }
  g.stroke({ width: 2.4, color: 0xe2f3ff, cap: 'round' });
  for (let i = 0; i < 6; i++) {
    const y = Y0 + 4 + r() * (Y1 - Y0 - 8), x = riverX(y) + 0.4 + r() * (RW - 0.8);
    const [a, b] = p(x, y, ZW);
    g.poly(flat(star(a, b, 6, 0.25, 0))).fill(0xffffff);
  }
  g.poly(flat(bank), false).stroke({ width: 4, color: INK, join: 'round' });
  g.poly(flat(bankFar), false).stroke({ width: 4, color: INK, join: 'round' });

  // The maze side: low neon walls and its dots, the path's mouth kept open, a cream kerb along the edge.
  const mazeWalls: Array<[number, number, number, number]> = [[-3.2, -3, 0.5, 2.6], [-1.8, 0.4, 2.6, 0.5], [0.2, 2.6, 1.6, 0.5], [-3.2, 1.6, 0.5, 1.4], [-1.2, 5.6, 2.4, 0.5], [0.4, 7.2, 0.5, 2.4], [-3.2, 6.4, 0.5, 3], [-1.8, -2.2, 2.2, 0.5], [-2, 10.2, 2.6, 0.5]];
  for (const [wx, wy, ww, wd] of mazeWalls) s.neonBlock(wx, wy, ww, wd, 0.4, BLUE, 4.5, 0);
  s.draw(-4, (d) => {
    for (let x = -5.75; x < 3; x += 0.5) for (let y = -5.75; y < 13; y += 0.5) {
      if (x > edge(y) - 0.3 || mazeWalls.some(([wx, wy, ww, wd]) => x > wx - 0.3 && x < wx + ww + 0.3 && y > wy - 0.3 && y < wy + wd + 0.3)) continue;
      if (Math.round(x * 2 + y * 2) % 3) continue;
      const [a, b] = p(x, y, 0.04);
      d.rect(a - 3, b - 3, 6, 6).fill(YELLOW);
      s.halo(a, b, 11, YELLOW, 0.35);
    }
    // The kerb: cream, a little raised, along every step of the edge.
    for (let y = Y0; y < Y1; y++) {
      const e = edge(y), e2 = edge(y + 1);
      d.poly(flat([p(e, y, 0.06), p(e, y + 1, 0.06)]), false);
      if (e2 !== e) d.poly(flat([p(e, y + 1, 0.06), p(e2, y + 1, 0.06)]), false);
    }
    d.stroke({ width: 7, color: INK, cap: 'round' });
    for (let y = Y0; y < Y1; y++) {
      const e = edge(y), e2 = edge(y + 1);
      d.poly(flat([p(e, y, 0.06), p(e, y + 1, 0.06)]), false);
      if (e2 !== e) d.poly(flat([p(e, y + 1, 0.06), p(e2, y + 1, 0.06)]), false);
    }
    d.stroke({ width: 4, color: 0xeee4c8, cap: 'round' });
  });

  // The bridge: planks across two beams, posts at each end, nails at the plank ends.
  const BX0 = riverX(4) - 0.45, BX1 = riverX(4) + RW + 0.45, DZ = 0.1;
  s.draw(BX1 + pathY1 - 0.4, (b) => {
    for (const x of [BX0 + 0.15, BX1 - 0.3]) for (const y of [pathY0 - 0.08, pathY1 - 0.08]) box(b, p, x, y, ZW - 0.1, 0.16, 0.16, DZ - ZW + 0.08, { top: 0x7a5228, side: 0x8f6132, hatch: 0.5 });
    box(b, p, BX0, pathY0 - 0.05, DZ - 0.05, BX1 - BX0, pathY1 - pathY0 + 0.1, 0.07, { top: 0xb27b42, side: 0x8a5a2c, hatch: 0.55, line: 3 });
    const n = Math.round((BX1 - BX0) / 0.24);
    for (let i = 0; i < n; i++) {
      const x0 = BX0 + ((BX1 - BX0) * i) / n, x1 = BX0 + ((BX1 - BX0) * (i + 1)) / n;
      b.poly(flat([p(x0, pathY0 - 0.05, DZ + 0.02), p(x1, pathY0 - 0.05, DZ + 0.02), p(x1, pathY1 + 0.05, DZ + 0.02), p(x0, pathY1 + 0.05, DZ + 0.02)])).fill(i % 3 === 0 ? 0xbd8650 : i % 3 === 1 ? 0xb47c45 : 0xc69159);
      b.poly(flat([p(x1, pathY0 - 0.05, DZ + 0.02), p(x1, pathY1 + 0.05, DZ + 0.02)]), false).stroke({ width: 1.8, color: 0x5a3818 });
      for (const y of [pathY0 + 0.05, pathY1 - 0.05]) b.circle(...p((x0 + x1) / 2, y, DZ + 0.02), 1.8).fill(0x3a2a1a);
      // Grain.
      b.poly(flat([p(x0 + 0.08, pathY0 + 0.3, DZ + 0.02), p(x0 + 0.1, pathY0 + 0.75, DZ + 0.02)]), false).stroke({ width: 1, color: 0x8a5a2c, alpha: 0.7 });
    }
    b.poly(flat([p(BX0, pathY0 - 0.05, DZ + 0.02), p(BX1, pathY0 - 0.05, DZ + 0.02), p(BX1, pathY1 + 0.05, DZ + 0.02), p(BX0, pathY1 + 0.05, DZ + 0.02)])).stroke({ width: 3.5, color: INK, join: 'round' });
    // Low rails along both sides.
    for (const x of [BX0 + 0.1, (BX0 + BX1) / 2, BX1 - 0.18]) box(b, p, x, pathY0 - 0.08, DZ, 0.08, 0.08, 0.55, { top: 0x9a6a38, side: 0x8f6132, line: 2.6 });
  });
  s.draw(BX0 + pathY0 - 0.2, (b) => {
    box(b, p, BX0 + 0.06, pathY0 - 0.08, DZ + 0.5, BX1 - BX0 - 0.12, 0.08, 0.08, { top: 0xc69159, side: 0x9a6a38, line: 2.6 });
  });

  // Trees and flowers: birches and spruces from the border's own pictures, nearer ones bigger, framing the way ahead.
  const tree = (kind: 'birch' | 'spruce', x: number, y: number, h: number, flip = false) => s.prop('border', kind, x, y, h, { flip, shadow: h * 0.2 });
  tree('birch', 4.0, 0.6, 230); tree('spruce', 5.0, -1.4, 250); tree('birch', 9.8, 0.4, 250, true); tree('spruce', 11.6, 1.6, 280);
  tree('birch', 4.6, 7.2, 240, true); tree('spruce', 3.6, 9.8, 270);
  tree('birch', 12.4, 9.6, 280); tree('spruce', 13.4, 5.2, 300); tree('birch', 9.6, 10.4, 300, true); tree('spruce', 14.8, 9.6, 330);
  const flowers = ['flower_poppy', 'flower_white', 'flower_yellow', 'flower_cornflower', 'flower_daisy', 'flower_marigold', 'flower_cosmos', 'flower_lupine'];
  const fr = rng(21);
  for (let i = 0; i < 26; i++) {
    const x = 3.4 + fr() * 12, y = -1 + fr() * 12;
    if ((y > pathY0 - 0.3 && y < pathY1 + 0.3) || (x > riverX(y) - 0.4 && x < riverX(y) + RW + 0.4) || x < edge(y) + 0.3) continue;
    s.prop('border', flowers[i % flowers.length]!, x, y, 30 + fr() * 8);
  }

  // The trio on the bridge, heading out; Gorbie, last, looking back at the maze.
  // Spaced across the screen (x - y) so none hides another; all drawn over the deck.
  for (const [look, x, y, facing, mouth] of [['gorbie', 6.2, 4.3, 'left', 0.2], ['ronnie', 7.35, 3.95, 'right', 0.3], ['olli', 8.6, 3.7, 'right', 0.45]] as const)
    s.figure(look, x, y, 46, { facing, mouth }, { z: DZ + 0.02, depth: BX1 + pathY1 + (x + y) / 100 });
};

/** 5. After the tank: the students crowding the water temple's steps and the square below it, the tank burning off by the lake. */
const templeStudents = (s: Stage): void => {
  const p = s.p;
  const g = s.ground;
  const X0 = -6, X1 = 20, Y0 = -8, Y1 = 16;
  // The lake behind, the square's paving in front of it.
  const shore = (x: number) => -0.4 + Math.sin(x * 0.7) * 0.2;
  g.poly(flat([p(X0, Y0), p(X1, Y0), p(X1, Y1), p(X0, Y1)])).fill(0xb3a88f);
  const lake: P[] = [p(X0, Y0), p(X1, Y0)];
  for (let x = X1; x >= X0; x -= 0.25) lake.push(p(x, shore(x)));
  g.poly(flat(lake)).fill(0x3f8fd4);
  const r = rng(31);
  for (let i = 0; i < 40; i++) {
    const x = X0 + r() * (X1 - X0), y = Y0 + r() * (shore(x) - Y0 - 0.3);
    const [a, b] = p(x, y);
    g.moveTo(a - 12, b).bezierCurveTo(a - 6, b - 4, a - 2, b + 3, a + 4, b - 1).bezierCurveTo(a + 8, b - 4, a + 12, b + 1, a + 14, b - 1);
  }
  g.stroke({ width: 2.4, color: 0xe2f3ff, cap: 'round' });
  // The stone kerb along the water.
  const kerb: P[] = [];
  for (let x = X0; x <= X1; x += 0.25) kerb.push(p(x, shore(x), 0.08));
  g.poly(flat(kerb), false).stroke({ width: 12, color: INK, join: 'round' });
  g.poly(flat(kerb), false).stroke({ width: 8, color: 0xe8e2d2, join: 'round' });
  // Paving slabs, a little uneven in tone; lawns along the lake beside the temple, under the tank and at the square's sides
  // (the owner, 13 Nov: "the picture generally looks kind of plain -- seems like it would benefit from some grass").
  // Tile by tile, so their kerbs run straight along the paving's joints.
  const lawn = (x: number, y: number) => (y < 2 && (x >= 6 || x < 1)) || x >= 12 || y >= 9;
  for (let x = X0; x < X1; x++) for (let y = 0; y < Y1; y++) {
    if (y < shore(x) + 0.1) continue;
    const tile = flat([p(x, y), p(x + 1, y), p(x + 1, y + 1), p(x, y + 1)]);
    if (lawn(x, y)) g.poly(tile).fill((x + y) % 2 ? 0x6cbf47 : 0x74c74e);
    else g.poly(tile).fill(tone(0xb3a88f, (r() - 0.5) * 0.1)).stroke({ width: 1.8, color: 0x857a63 });
  }
  // Tufts in the grass, and a stone kerb along each edge where a lawn meets the paving.
  const tr = rng(41);
  const kerbs: P[][] = [];
  for (let x = X0; x < X1; x++) for (let y = 0; y < Y1; y++) {
    if (!lawn(x, y)) continue;
    for (let k = 0; k < 3; k++) {
      const [a, b] = p(x + 0.1 + tr() * 0.8, y + 0.1 + tr() * 0.8);
      for (const dx of [-5, 0, 5]) g.moveTo(a + dx * 0.4, b).lineTo(a + dx, b - 9 - Math.abs(dx) * 0.6);
    }
    if (!lawn(x + 1, y)) kerbs.push([p(x + 1, y), p(x + 1, y + 1)]);
    if (!lawn(x - 1, y)) kerbs.push([p(x, y), p(x, y + 1)]);
    if (y + 1 < Y1 && !lawn(x, y + 1)) kerbs.push([p(x, y + 1), p(x + 1, y + 1)]);
    if (y > 0 && !lawn(x, y - 1)) kerbs.push([p(x, y), p(x + 1, y)]);
  }
  g.stroke({ width: 2.2, color: 0x3f8a2c, cap: 'round' });
  for (const [w, c] of [[7, INK], [4, 0xe0dacb]] as const) {
    for (const k of kerbs) g.poly(flat(k), false);
    g.stroke({ width: w, color: c, cap: 'round' });
  }

  // The burning tank, off by the lake past the temple, smoke climbing out of it.
  const TK: P = [10.0, 2.2];
  const [tx, ty] = p(...TK);
  s.prop('field', 'tank_wreck', ...TK, 190, { shadow: 110 });
  s.draw(TK[0] + TK[1] + 0.2, (f) => {
    const k = 190 / 106;
    const spots = (PROPS.tank_wreck!.burning ?? []).map(([a, b]) => [tx + a * k, ty + b * k] as [number, number]);
    // Flames only: the column below is its smoke.
    for (const [x, y] of spots) flame(f, x, y, 20 * k);
  });
  // The smoke: a column of puffs billowing up and drifting off with the wind, dark at the fire, paler as it climbs; inked only round its outside.
  s.draw(200, (sm) => {
    const sr = rng(77);
    const puffs: Array<[number, number, number]> = [];
    for (let i = 0; i < 26; i++) {
      const u = i / 25, rise = 150 + u * 430, drift = u * u * 260 + Math.sin(u * 7) * 18;
      for (let k = 0; k < 2; k++) puffs.push([tx - 10 + drift + (sr() - 0.5) * (30 + u * 70), ty - rise + (sr() - 0.5) * 30, 22 + u * 52 + sr() * 14]);
    }
    for (const [x, y, rr] of puffs) sm.circle(x, y, rr + 3.5).fill(INK);
    puffs.forEach(([x, y, rr], i) => sm.circle(x, y, rr).fill(tone(0x45423e, Math.min(0.45, (i / puffs.length) * 0.5))));
    puffs.forEach(([x, y, rr], i) => sm.circle(x - rr * 0.2, y - rr * 0.22, rr * 0.7).fill(tone(0x45423e, Math.min(0.45, (i / puffs.length) * 0.5) + 0.1)));
  });
  // Willows by the water.
  s.prop('field', 'willow', 9.2, 0.2, 230, { shadow: 50 });
  s.prop('field', 'willow', 15.6, 1.4, 250, { flip: true, shadow: 50 });
  s.prop('field', 'willow', -0.6, 0.3, 220, { shadow: 50 });

  // The water temple: a stone base with steps, a red-pillared hall, a curving roof, an upper storey and its roof.
  const TX0 = 1.6, TX1 = 4.6, TY0 = 1.6, TY1 = 6.4;
  // Drawn before everything standing in front of it (the crowd is all on its near sides); only the willow behind it comes first.
  s.draw(1, (t) => {
    const stone = { top: 0xc9c4b6, side: 0xa9a496, hatch: 0.45 };
    box(t, p, TX0 - 0.35, TY0 - 0.35, 0, TX1 - TX0 + 0.7, TY1 - TY0 + 0.7, 0.36, stone);
    t.poly(flat([p(TX0 - 0.35, TY1 + 0.35, 0.18), p(TX1 + 0.35, TY1 + 0.35, 0.18), p(TX1 + 0.35, TY0 - 0.35, 0.18)]), false).stroke({ width: 1.4, color: 0x7f7a6c });
    // Steps down from the door, toward the square.
    for (let k = 0; k < 3; k++) box(t, p, TX1 + 0.35 + k * 0.25, 3.3 - k * 0.05, 0, 0.25, 1.8 + k * 0.1, 0.36 - k * 0.12, { top: 0xd3cec1, side: 0xb1ac9e, line: 2.6 });
    // The hall: plaster on a grey brick dado, red pillars.
    const z0 = 0.36, z1 = 1.55;
    box(t, p, TX0, TY0, z0, TX1 - TX0, TY1 - TY0, z1 - z0, { top: 0x7a2420, side: 0xe9dfc6, dark: 0.18 });
    t.poly(flat(onY(p, TX0, TY1, z0, 0, TX1 - TX0, 0, 0.32))).fill(0x8c8a84);
    t.poly(flat(onX(p, TX1, TY0, z0, 0, TY1 - TY0, 0, 0.32))).fill(0x75736e);
    for (let v = 0.08; v < 0.32; v += 0.08) { t.poly(flat([p(TX0, TY1, z0 + v), p(TX1, TY1, z0 + v)]), false); t.poly(flat([p(TX1, TY0, z0 + v), p(TX1, TY1, z0 + v)]), false); }
    t.stroke({ width: 1.2, color: 0x55534e });
    hatch(t, onX(p, TX1, TY0, z0, 0, TY1 - TY0, 0.32, z1 - z0), -1.05, 7, 1.4, 0.35, 0.45, 41);
    // Pillars.
    for (const u of [0, 1.0, 2.0, 3.0]) t.poly(flat(onY(p, TX0, TY1, z0, u, u + 0.16, 0, z1 - z0))).fill(0xb8322a).stroke({ width: 2.2, color: INK });
    for (const u of [0.06, 1.25, 2.4, 3.55, 4.64]) t.poly(flat(onX(p, TX1, TY0, z0, u, u + 0.16, 0, z1 - z0))).fill(0x9a2820).stroke({ width: 2.2, color: INK });
    // Lattice windows on the side, the red doors with their gold knockers on the front, lattice windows beside them.
    const lattice = (pts: P[]) => {
      t.poly(flat(pts)).fill(0x7a1e18).stroke({ width: 2.2, color: INK });
      const [a, b, c, d] = pts as [P, P, P, P];
      for (let k = 1; k < 5; k++) t.moveTo(a[0] + ((b[0] - a[0]) * k) / 5, a[1] + ((b[1] - a[1]) * k) / 5).lineTo(d[0] + ((c[0] - d[0]) * k) / 5, d[1] + ((c[1] - d[1]) * k) / 5);
      for (let k = 1; k < 4; k++) t.moveTo(a[0] + ((d[0] - a[0]) * k) / 4, a[1] + ((d[1] - a[1]) * k) / 4).lineTo(b[0] + ((c[0] - b[0]) * k) / 4, b[1] + ((c[1] - b[1]) * k) / 4);
      t.stroke({ width: 1.6, color: 0xe7b84a });
    };
    lattice(onY(p, TX0, TY1, z0, 0.35, 0.82, 0.45, 0.95));
    lattice(onY(p, TX0, TY1, z0, 2.25, 2.72, 0.45, 0.95));
    lattice(onX(p, TX1, TY0, z0, 0.45, 1.05, 0.45, 0.95));
    lattice(onX(p, TX1, TY0, z0, 3.75, 4.35, 0.45, 0.95));
    for (const [u0, u1] of [[1.65, 2.35], [2.35, 3.05]] as const) {
      t.poly(flat(onX(p, TX1, TY0, z0, u0, u1, 0, 1.0))).fill(0xb8322a).stroke({ width: 2.4, color: INK });
      for (let i = 0; i < 3; i++) for (let j = 0; j < 4; j++) t.circle(...p(TX1, TY0 + u0 + 0.14 + i * 0.2, z0 + 0.2 + j * 0.2), 1.8).fill(0xe7b84a);
    }
    for (const u of [2.22, 2.48]) t.circle(...p(TX1, TY0 + u, z0 + 0.5), 4).stroke({ width: 2.4, color: 0xe7b84a });
    // The painted band under the eaves: blue and green with gold.
    const band = (pts: P[], c: number) => t.poly(flat(pts)).fill(c).stroke({ width: 2, color: INK });
    band(onY(p, TX0, TY1, z1, -0.05, TX1 - TX0 + 0.05, -0.16, 0), 0x2f5f9e);
    band(onX(p, TX1, TY0, z1, -0.05, TY1 - TY0 + 0.05, -0.16, 0), 0x234a7c);
    t.poly(flat([p(TX0, TY1, z1 - 0.04), p(TX1, TY1, z1 - 0.04), p(TX1, TY0, z1 - 0.04)]), false).stroke({ width: 2.4, color: 0xe7b84a });
    for (let u = 0.2; u < TX1 - TX0; u += 0.42) t.poly(flat(onY(p, TX0, TY1, z1, u, u + 0.16, -0.14, -0.02))).fill(0x3c8a5a);
    for (let u = 0.2; u < TY1 - TY0; u += 0.42) t.poly(flat(onX(p, TX1, TY0, z1, u, u + 0.16, -0.14, -0.02))).fill(0x2f6e48);

    // A hipped roof with upturned corners, its tiles in rows.
    const roof = (x0: number, x1: number, y0: number, y1: number, ze: number, rise: number, inset: number) => {
      const lift = (u: number) => Math.pow(Math.abs(2 * u - 1), 4) * 0.22;
      const rx0 = x0 + inset, rx1 = x1 - inset, ry0 = y0 + inset * 1.2, ry1 = y1 - inset * 1.2, zr = ze + rise;
      // The front (+x) slope, from its eave to the ridge.
      const eaveX: P[] = [], eaveY: P[] = [];
      for (let k = 0; k <= 24; k++) { const u = k / 24; eaveX.push(p(x1, y0 + (y1 - y0) * u, ze + lift(u))); }
      for (let k = 0; k <= 24; k++) { const u = k / 24; eaveY.push(p(x0 + (x1 - x0) * u, y1, ze + lift(u))); }
      const ridge0 = p((rx0 + rx1) / 2, ry0, zr), ridge1 = p((rx0 + rx1) / 2, ry1, zr);
      const front = [...eaveX, ridge1, ridge0];
      t.poly(flat(front)).fill(0x56606c);
      hatch(t, front, -0.46, 8, 2.2, 0.55, 1, 51, 0x2a3038);
      t.poly(flat([...eaveY, ridge1])).fill(0x6c7682);
      for (let k = 1; k < 16; k++) { const u = k / 16; const e = p(x0 + (x1 - x0) * u, y1, ze + lift(u)); t.moveTo(e[0], e[1]).lineTo(ridge1[0] + (e[0] - ridge1[0]) * 0.02, ridge1[1] + (e[1] - ridge1[1]) * 0.02); }
      t.stroke({ width: 2, color: 0x3a424c, alpha: 0.8 });
      for (let k = 1; k < 22; k++) { const u = k / 22; const e = p(x1, y0 + (y1 - y0) * u, ze + lift(u)); const m = p((rx0 + rx1) / 2, ry0 + (ry1 - ry0) * u, zr); t.moveTo(e[0], e[1]).lineTo(m[0], m[1]); }
      t.stroke({ width: 2, color: 0x3a424c, alpha: 0.7 });
      // The eaves' lip of end tiles, and the ridge, inked.
      t.poly(flat(eaveX), false).stroke({ width: 7, color: INK, cap: 'round' });
      t.poly(flat(eaveX), false).stroke({ width: 3.5, color: 0x8a949e, cap: 'round' });
      t.poly(flat(eaveY), false).stroke({ width: 7, color: INK, cap: 'round' });
      t.poly(flat(eaveY), false).stroke({ width: 3.5, color: 0x8a949e, cap: 'round' });
      t.poly(flat([eaveX[0]!, ridge0, ridge1, eaveY[0]!]), false).stroke({ width: 3, color: INK, join: 'round' });
      t.poly(flat([ridge1, eaveX[eaveX.length - 1]!]), false).stroke({ width: 3, color: INK });
      t.poly(flat([ridge0, ridge1]), false).stroke({ width: 9, color: INK, cap: 'round' });
      t.poly(flat([ridge0, ridge1]), false).stroke({ width: 5, color: 0x6c7682, cap: 'round' });
      // Curled ridge ends.
      for (const [q, dir] of [[ridge0, -1], [ridge1, 1]] as const) {
        t.moveTo(q[0], q[1]).bezierCurveTo(q[0] + dir * 6, q[1] - 22, q[0] + dir * 20, q[1] - 20, q[0] + dir * 16, q[1] - 8).stroke({ width: 6, color: INK, cap: 'round' });
      }
    };
    roof(TX0 - 0.55, TX1 + 0.55, TY0 - 0.55, TY1 + 0.55, z1, 0.62, 0.9);
    // The upper storey, set back, its dark board framed in red, then its own roof.
    box(t, p, TX0 + 0.8, TY0 + 1.0, 2.0, TX1 - TX0 - 1.6, TY1 - TY0 - 2.0, 0.55, { top: 0x7a2420, side: 0xb8322a, dark: 0.22 });
    t.poly(flat(onX(p, TX1 - 0.8, TY0 + 1.0, 2.0, 0.25, TY1 - TY0 - 2.25, 0.08, 0.47))).fill(0x23302c).stroke({ width: 3, color: 0xe7b84a });
    t.poly(flat(onY(p, TX0 + 0.8, TY1 - 1.0, 2.0, 0.2, TX1 - TX0 - 1.8, 0.1, 0.45))).fill(0x7a1e18).stroke({ width: 2, color: INK });
    roof(TX0 + 0.35, TX1 - 0.35, TY0 + 0.6, TY1 - 0.6, 2.55, 0.55, 0.75);
  });

  // A speed pellet, glowing on the top step, the students' thanks.
  s.draw(TX1 + 4.2, (b) => {
    const [a, c] = p(TX1 + 0.55, 4.2, 0.4);
    s.halo(a, c, 34, 0x9ff0ff, 0.45, s.glow);
    b.circle(a, c, 11).fill(0xd9fbff).stroke({ width: 3, color: INK });
  });

  // A banner on bamboo poles at the back of the crowd: cloth strung along x, striped, sagging a little.
  const bannerAt = (y: number, x0: number, x1: number, zTop: number) => s.draw(x1 + y - 0.6, (b) => {
    const at = (u: number, v: number) => { const sag = Math.sin(u * Math.PI) * 0.1; return p(x0 + (x1 - x0) * u, y, zTop - v - sag * (1 + v)); };
    for (const x of [x0, x1]) {
      b.poly(flat([p(x, y, 0), p(x, y, zTop + 0.2)]), false).stroke({ width: 8, color: INK, cap: 'round' });
      b.poly(flat([p(x, y, 0), p(x, y, zTop + 0.2)]), false).stroke({ width: 4.5, color: 0xd8b25a, cap: 'round' });
    }
    const edge = (v: number) => Array.from({ length: 17 }, (_, k) => at(k / 16, v));
    const cloth = [...edge(0), ...edge(0.42).reverse()];
    b.poly(flat(cloth)).fill(0xf6f0e2);
    for (const [a, c] of [[0.1, 0.18], [0.24, 0.32]] as const) b.poly(flat([...edge(a), ...edge(c).reverse()])).fill(0xd8322b);
    b.poly(flat(cloth)).stroke({ width: 3, color: INK, join: 'round' });
  });
  bannerAt(0.8, 5.4, 7.4, 1.3);

  // The crowd: students, the straw-hatted ones from the north of the city among them, each dressed in their own colours as the
  // map dresses them, from the temple's steps to the tank and round the trio in front of its door, cheering toward the temple
  // and the tank. All face to one side or the other, so every face shows (the owner, 13 Nov: "several students that have no faces").
  const crowd: Array<[LookId, number, number, 'left' | 'right', number]> = [
    ['student', 5.4, 0.8, 'right', 0.5], ['student', 6.2, 2.4, 'left', 0.6], ['guide_student', 6.7, 3.7, 'left', 0.4], ['student', 7.5, 2.0, 'right', 0.7],
    ['student', 7.8, 4.7, 'left', 0.5], ['guide_student', 8.2, 3.4, 'left', 0.6], ['student', 6.4, 5.4, 'left', 0.8], ['student', 9.6, 4.4, 'left', 0.6],
    ['guide_student', 11.2, 3.4, 'left', 0.5], ['student', 11.8, 5.0, 'left', 0.7], ['student', 7.4, 6.4, 'left', 0.6], ['guide_student', 8.8, 5.6, 'right', 0.5],
    ['student', 5.8, 7.4, 'right', 0.6], ['guide_student', 4.6, 7.8, 'right', 0.4], ['student', 6.0, 8.6, 'right', 0.5], ['student', 12.6, 6.4, 'left', 0.6],
    ['guide_student', 13.2, 5.6, 'left', 0.5], ['student', 12.8, 4.0, 'left', 0.6], ['student', 8.2, 10.4, 'right', 0.6], ['guide_student', 6.8, 9.8, 'right', 0.4],
  ];
  crowd.forEach(([look, x, y, facing, mouth], i) => s.figure(townsperson(look, `temple_${i}`), x, y, 36, { facing, mouth }, { shadow: 1.1 }));
  // The trio among them, at the front.
  s.figure('olli', 9.6, 7.4, 44, { facing: 'right', mouth: 0.5 });
  s.figure('ronnie', 10.8, 6.6, 44, { facing: 'left', mouth: 0.7 });
  s.figure('gorbie', 8.4, 7.8, 44, { facing: 'right', mouth: 0.5 });
};

/** A sweat drop by a worried head. */
function sweat(g: Graphics, x: number, y: number, s: number): void {
  // From its round foot up to the tip, then the right side down from the tip as a line of its own: a curve ending on the arc's
  // first point gave that point twice, which builds vertices that are not numbers (the line some Android GPUs draw across the
  // screen). The same points, and the line still ends at the tip.
  g.beginPath().arc(x, y + 4 * s, 7 * s, 0, Math.PI).bezierCurveTo(x - 7 * s, y - 1 * s, x - 3 * s, y - 6 * s, x, y - 14 * s)
    .moveTo(x, y - 14 * s).bezierCurveTo(x + 3 * s, y - 6 * s, x + 7 * s, y - 1 * s, x + 7 * s, y + 4 * s)
    .fill(0x9fd8ff).stroke({ width: 2.4 * s, color: INK, join: 'round' });
  g.ellipse(x - 2.5 * s, y + 2 * s, 2 * s, 3 * s).fill(0xffffff);
}

/** Points round an arc about (cx, cy), radius r, from angle a0 to a1. */
const arc = (cx: number, cy: number, r: number, a0: number, a1: number, n = 48): P[] =>
  Array.from({ length: n + 1 }, (_, i) => { const a = a0 + ((a1 - a0) * i) / n; return [cx + Math.cos(a) * r, cy + Math.sin(a) * r] as P; });

/**
 * The Pac-Devil: a giant red pac with horns, its eyes looking down at whoever is there,
 * without lids (the owner, 14 Nov). Its eyes and its open mouth are where every pac's are (src/art/ball_face.ts), facing left
 * (the owner, 13 Nov: "I don't think he should have those little fangs or a tail"). Its feet on (x, y), `R` its radius; inked and
 * shaded as the party's pictures are, a thick outline, hatching on its dark side, and the fire's light along its underside.
 */
function devil(g: Graphics, glow: Graphics, x: number, y: number, R: number): void {
  const cx = x, cy = y - R;
  const RED = 0xd42a24, DARK = 0x8e1418, lw = R * 0.05, OPEN = 0.9;
  // Horns, the far one first: out from the crown, curving up to a point.
  const horn = (at: number, out: number, far: boolean) => {
    const b1: P = [cx + Math.cos(at - 0.2) * R * 0.96, cy + Math.sin(at - 0.2) * R * 0.96], b2: P = [cx + Math.cos(at + 0.2) * R * 0.96, cy + Math.sin(at + 0.2) * R * 0.96];
    const tip: P = [cx + Math.cos(at) * R * 1.05 + out * R * 0.42, cy + Math.sin(at) * R * 1.05 - R * 0.62];
    const pts: P[] = [];
    for (let i = 0; i <= 12; i++) { const u = i / 12; pts.push([b1[0] + (tip[0] - b1[0]) * u + out * R * 0.16 * Math.sin(u * Math.PI), b1[1] + (tip[1] - b1[1]) * u + R * 0.1 * Math.sin(u * Math.PI)]); }
    for (let i = 12; i >= 0; i--) { const u = i / 12; pts.push([b2[0] + (tip[0] - b2[0]) * u + out * R * 0.1 * Math.sin(u * Math.PI), b2[1] + (tip[1] - b2[1]) * u - R * 0.02 * Math.sin(u * Math.PI)]); }
    g.poly(flat(pts)).fill(far ? 0x6e0c10 : 0x9a141a);
    // Ridges round it, and a light down its lit edge.
    for (const u of [0.25, 0.45, 0.65]) g.moveTo(...pts[Math.round(u * 12)]!).lineTo(...pts[25 - Math.round(u * 12)]!);
    g.stroke({ width: lw * 0.45, color: INK, alpha: 0.7 });
    g.poly(flat(pts.slice(1, 10).map(([a, b]) => [a + out * R * 0.03, b + R * 0.01] as P)), false).stroke({ width: lw * 0.5, color: 0xe0503a, alpha: far ? 0.4 : 0.8, cap: 'round' });
    g.poly(flat(pts)).stroke({ width: lw * 0.9, color: INK, join: 'round' });
  };
  horn(-Math.PI / 2 + 0.55, 1, true);
  // The body: a pac's, its upper lip level below the eyes and its lower jaw dropped, open toward the left, and like every
  // pac's mouth the opening shows what is behind it (the owner, 15 Nov: "you don't actually see through it").
  const outline: P[] = ballPolygon('left', OPEN, R).map(([a, b]) => [cx + a, cy + b] as P);
  const [, lower] = jawEdges('left', OPEN, R, R) as [Edge, Edge];
  const aLower = Math.atan2(lower[3], lower[2]);
  g.poly(flat(outline)).fill(RED);
  // The highlight, up and to the left.
  g.ellipse(cx - R * 0.3, cy - R * 0.5, R * 0.36, R * 0.24).fill({ color: 0xff7a62, alpha: 0.45 });
  g.ellipse(cx - R * 0.42, cy - R * 0.6, R * 0.12, R * 0.07).fill({ color: 0xffd6c8, alpha: 0.7 });
  // The dark side: a crescent round its back and underside to its lower jaw, hatched as the sprites shade theirs.
  const ox = cx - R * 0.26, oy = cy - R * 0.2, R2 = R * 1.04;
  const inner = (a: number): number => {
    const ux = Math.cos(a), uy = Math.sin(a), b = ux * (cx - ox) + uy * (cy - oy), k = (cx - ox) ** 2 + (cy - oy) ** 2 - R2 * R2;
    return Math.min(R, -b + Math.sqrt(b * b - k));
  };
  const A0 = -Math.PI / 2 - 0.3, A1 = Math.min(Math.PI / 2 + 0.75, aLower);
  const cres: P[] = [];
  for (let i = 0; i <= 60; i++) { const a = A0 + ((A1 - A0) * i) / 60; cres.push([cx + Math.cos(a) * R, cy + Math.sin(a) * R]); }
  for (let i = 60; i >= 0; i--) { const a = A0 + ((A1 - A0) * i) / 60, d = inner(a); cres.push([cx + Math.cos(a) * d, cy + Math.sin(a) * d]); }
  g.poly(flat(cres)).fill(DARK);
  const hr = rng(19);
  for (let i = 0; i <= 70; i++) {
    const a = A0 + ((A1 - A0) * i) / 70, d = inner(a), depth = R - d;
    if (depth < R * 0.04) continue;
    const len = Math.min(depth * (0.9 + hr() * 0.5), R * 0.3);
    const sx = cx + Math.cos(a) * (R - lw * 0.3), sy = cy + Math.sin(a) * (R - lw * 0.3);
    const ang = a + Math.PI + 0.55;
    g.moveTo(sx, sy).lineTo(sx + Math.cos(ang) * len, sy + Math.sin(ang) * len);
  }
  g.stroke({ width: lw * 0.32, color: INK, alpha: 0.75, cap: 'round' });
  // The fire's light along the underside, to the lower jaw.
  g.poly(flat(arc(cx, cy, R * 0.955, 0.35, aLower - 0.08, 40)), false).stroke({ width: lw * 1.1, color: 0xff9a3a, alpha: 0.85, cap: 'round' });
  for (const [wd, a] of [[lw * 5, 0.12], [lw * 2.6, 0.2]] as const) glow.poly(flat(arc(cx, cy, R * 1.01, 0.25, aLower - 0.05, 40)), false).stroke({ width: wd, color: 0xff6a1e, alpha: a, cap: 'round' });
  // The near horn, over the crown.
  horn(-Math.PI / 2 - 0.5, -1, false);
  // Eyes where a pac's are, mirrored to face left, looking down at whoever stands there.
  for (const e of BALL_EYES) {
    const ex = cx - e.x * R, ey = cy + e.y * R, rx = e.rx * R, ry = e.ry * R;
    g.ellipse(ex, ey, rx, ry).fill(0xffffff);
    const px = ex - rx * 0.3, py = ey + ry * 0.28;
    g.circle(px, py, R * 0.08).fill(INK);
    g.circle(px - R * 0.025, py - R * 0.03, R * 0.022).fill(0xffffff);
    g.ellipse(ex, ey, rx, ry).stroke({ width: lw * 0.75, color: INK });
  }
  // The outline, round the body and into the mouth.
  g.poly(flat(outline)).stroke({ width: lw, color: INK, join: 'round' });
}

/** A trident planted in the ground at (x, y): an iron shaft `len` long leaning `lean`, its three barbed prongs at the top. */
function trident(g: Graphics, x: number, y: number, len: number, lean: number): void {
  const ux = Math.sin(lean), uy = -Math.cos(lean), nx = -uy, ny = ux;
  const top: P = [x + ux * len, y + uy * len], hs = len * 0.2;
  const at = (a: number, b: number): P => [top[0] + nx * a + ux * b, top[1] + ny * a + uy * b];
  for (const [wd, col] of [[22, INK], [13, 0x9a98ac]] as const) g.moveTo(x, y).lineTo(...top).stroke({ width: wd, color: col, cap: 'round' });
  g.moveTo(x - nx * 3, y - ny * 3).lineTo(top[0] - nx * 3, top[1] - ny * 3).stroke({ width: 3.5, color: 0xeceaf6, alpha: 0.9 });
  // The head: a curved bar, three prongs, a barb at each tip.
  const prong = (a: number, from: number, rise: number) => {
    const pts: P[] = [at(a * 0.86, from), at(a, from + rise * 0.6), at(a, from + rise)];
    for (const [wd, col] of [[18, INK], [10, 0x9a98ac]] as const) g.poly(flat(pts), false).stroke({ width: wd, color: col, cap: 'round', join: 'round' });
    const tip = at(a, from + rise + hs * 0.32);
    g.poly(flat([tip, at(a - hs * 0.16, from + rise - hs * 0.04), at(a, from + rise + hs * 0.06), at(a + hs * 0.16, from + rise - hs * 0.04)])).fill(0xb4b2c4).stroke({ width: 3.5, color: INK, join: 'round' });
  };
  const bar: P[] = Array.from({ length: 13 }, (_, i) => { const a = -hs * 0.62 + (hs * 1.24 * i) / 12; return at(a, (a * a) / (hs * 2.4) - hs * 0.05); });
  for (const [wd, col] of [[22, INK], [13, 0x9a98ac]] as const) g.poly(flat(bar), false).stroke({ width: wd, color: col, cap: 'round', join: 'round' });
  prong(-hs * 0.62, hs * 0.1, hs * 0.75);
  prong(hs * 0.62, hs * 0.1, hs * 0.75);
  prong(0, -hs * 0.05, hs * 1.05);
}

/**
 * 6. Game over: the floor of the underworld tiled with flames, and the Pac-Devil, giant on its rock at the
 * back, its trident planted beside it, looking down at the trio standing in a row before it.
 */
const pacDevil = (s: Stage): void => {
  const p = s.p;
  const g = s.ground;
  const X0 = -8, X1 = 18, Y0 = -10, Y1 = 16;
  // The rock the devil stands on, and the trio's spot; no flames on either.
  const RX0 = 5.5, RX1 = 8.7, RY0 = -3.1, RY1 = -0.1, RZ = 0.45;
  // The trio below the rock, in a row toward its grin; left of the photo's lower right, where the page sets its stamp.
  const trio: Array<[LookId, number, number, number]> = [['olli', 4.61, 2.27, 0.15], ['ronnie', 4.22, 3.44, 0.3], ['gorbie', 3.83, 4.61, 0.2]];
  // The floor: dark tiles, each with its seam, lit red by the fires.
  const fr = rng(66);
  for (let x = X0; x < X1; x++) for (let y = Y0; y < Y1; y++) g.poly(flat([p(x, y), p(x + 1, y), p(x + 1, y + 1), p(x, y + 1)])).fill(tone(0x241008, (fr() - 0.5) * 0.25)).stroke({ width: 2.2, color: 0x4a1a0c });
  // Flames all about, all alike but scattered; taller behind the devil. Fewer and bigger, one at most in each block of
  // 1.5 tiles (the owner, 15 Nov: "maybe there should be fewer flames but they are bigger?").
  const STEP = 1.5, BIG = 1.5;
  const clear = (x: number, y: number) => {
    if (x > RX0 - 0.6 && x < RX1 + 0.4 && y > RY0 - 0.6 && y < RY1 + 0.4) return true;
    // Nothing in front of the devil's grin, between it and the trio.
    if (x > RX0 - 1.6 && x < RX0 + 0.6 && y > RY0 && y < RY1 + 1.6) return true;
    return trio.some(([, tx, ty]) => Math.abs(x - tx) + Math.abs(y - ty) < 1.6) || (x + y > 6.0 && x + y < 9.4 && x - y > -1.8 && x - y < 3.6);
  };
  // The two that would stand behind the devil's grin, showing through its open mouth, slide that many tiles left along their
  // rows into open floor (the owner, 15 Nov: "move those two flame pictures between to the left into that open space").
  const slide: Record<string, number> = { '7,4': 3, '8,4': 1.75 };
  const rows = new Map<number, Array<[number, number, number, boolean]>>();
  for (let i = 0; X0 + i * STEP < X1; i++) for (let j = 0; Y0 + j * STEP < Y1; j++) {
    let cxg = X0 + STEP * (i + 0.2 + fr() * 0.6), cyg = Y0 + STEP * (j + 0.2 + fr() * 0.6);
    if (fr() < 0.42 || clear(cxg, cyg)) continue;
    const by = slide[`${i},${j}`] ?? 0;
    cxg -= by;
    cyg += by;
    const behind = Math.max(0, Math.min(1, ((RX0 + RY0 + 2) - (cxg + cyg)) / 6));
    const size = 64 * BIG * (0.85 + fr() * 0.3) * (1 + behind * 0.6);
    const d = Math.floor(cxg) + Math.floor(cyg), row = rows.get(d) ?? [];
    row.push([cxg, cyg, size, (i - j) % 4 === 0]);
    rows.set(d, row);
  }
  for (const [d, row] of rows) s.draw(d + 1, (f) => {
    for (const [x, y, size, flip] of row) {
      const [a, b] = p(x, y);
      for (let i = 0; i < 7; i++) { const k = 1 - i * 0.12; s.light.ellipse(a, b, size * 0.95 * k, size * 0.42 * k).fill({ color: 0xff5a14, alpha: 0.04 }); }
      f.ellipse(a, b, size * 0.36, size * 0.13).fill({ color: 0x000000, alpha: 0.35 });
      flame(f, a, b, size, flip);
    }
  });
  const DXg = 7.0, DYg = -1.5;
  const [dx, dy] = p(DXg, DYg, RZ);
  // Sparks and embers rising through it all, none on the devil.
  s.draw(500, (e) => {
    const r = rng(5);
    for (let i = 0; i < 70; i++) {
      const x = -100 + r() * 1750, y = -80 + r() * 1100, k = 1.5 + r() * 3.2;
      if (Math.hypot(x - dx - 20, y - dy + 200) < 250) continue;
      e.poly(flat([[x, y - k * 1.6], [x + k, y], [x, y + k * 1.6], [x - k, y]])).fill(r() < 0.5 ? 0xffd23a : 0xff8a2a);
      s.halo(x, y, k * 5, 0xff7a1e, 0.25, s.glow);
    }
  });

  // The devil's rock: dark basalt, stepped, glowing cracks of fire in it.
  s.draw(RX1 + RY1 - 0.5, (rk) => {
    const basalt = { top: 0x3a2a2c, side: 0x2c1f22, dark: 0.35, hatch: 0.6 };
    box(rk, p, RX0, RY0, 0, RX1 - RX0, RY1 - RY0, RZ * 0.55, basalt);
    box(rk, p, RX0 + 0.35, RY0 + 0.3, RZ * 0.55, RX1 - RX0 - 0.7, RY1 - RY0 - 0.6, RZ * 0.45, basalt);
    const crack = (pts: P[]) => {
      s.tube(rk, pts, 0xff7a1e, 3, 0.7);
    };
    crack([p(RX0 + 0.4, RY1, 0.12), p(RX0 + 0.9, RY1, 0.3), p(RX0 + 1.1, RY1, 0.22), p(RX0 + 1.6, RY1, 0.42)]);
    crack([p(RX1, RY0 + 0.6, 0.1), p(RX1, RY0 + 1.2, 0.34), p(RX1, RY0 + 1.5, 0.28), p(RX1, RY0 + 2.3, 0.44)]);
    crack([p(RX0 + 2.6, RY1, 0.04), p(RX0 + 3.0, RY1, 0.22), p(RX0 + 3.5, RY1, 0.16)]);
    crack([p(RX0 + 0.8, RY0 + 2.6, RZ), p(RX0 + 1.5, RY0 + 2.2, RZ), p(RX0 + 1.7, RY0 + 2.7, RZ)]);
  });

  // The devil on its rock, its pitchfork standing upright on the floor just past the rock's corner, clear of its body (the owner,
  // 13 Nov: a pitchfork; 14 Nov: "vertical instead of slanted"; upright at its back, the
  // body hid all but its prongs); pacs have no hands, so it stands on its own.
  const [tx, ty] = p(RX1 - 0.05, RY0 - 0.4, 0);
  s.draw(RX1 + RY1 - 0.4, (t) => trident(t, tx, ty, 300, 0));
  // Heat and smoke over the far fires, darkening up into the dark, so the devil stands out against them.
  s.draw(RX1 + RY1 - 0.45, (h) => { for (let i = 0; i < 9; i++) h.rect(-400, -400, 2400, 760 - i * 70).fill({ color: 0x140303, alpha: 0.085 }); });
  s.draw(RX1 + RY1 - 0.3, (sh) => { for (const f of [1, 0.8, 0.6]) sh.ellipse(dx, dy, 170 * f, 58 * f).fill({ color: 0x000000, alpha: 0.18 }); });
  s.draw(RX1 + RY1 - 0.2, (d) => devil(d, s.glow, dx, dy, 190));

  // The trio in a row before it, small beside it, facing up at it; Ronnie and Gorbie sweating.
  for (const [look, x, y, mouth] of trio) s.figure(look, x, y, 50, { facing: 'right', mouth });
  s.draw(60, (sw) => {
    for (const [, x, y] of trio.slice(1)) { const [a, b] = p(x, y); sweat(sw, a - 33, b - 100, 1.25); }
  });
};

/** Book spines filling shelves on a wall-facing (+x) face at `x`, along y from y0 to y1, one row on each shelf in `shelves` (z, gap). */
function books(g: Graphics, p: Proj, x: number, y0: number, y1: number, shelves: readonly number[], gap: number, seed: number): void {
  const r = rng(seed);
  const SPINES = [0x8e2a2a, 0x2a4a8e, 0x2f6e48, 0xc89a3a, 0x5a2a6e, 0x2e2a28, 0xa8552a, 0x7a8a9a, 0xd8cfb8];
  for (const z of shelves) {
    let y = y0 + 0.03;
    while (y < y1 - 0.05) {
      const w = Math.min(y1 - 0.03 - y, 0.05 + r() * 0.07), h = gap * (0.62 + r() * 0.3), c = SPINES[Math.floor(r() * SPINES.length)]!;
      if (r() < 0.07) { y += 0.12; continue; }
      g.poly(flat(onX(p, x, y, z, 0, w, 0, h))).fill(c).stroke({ width: 1.2, color: INK, alpha: 0.85 });
      if (r() < 0.6) g.poly(flat([p(x, y + w * 0.2, z + h * 0.78), p(x, y + w * 0.8, z + h * 0.78)]), false).stroke({ width: 1.4, color: 0xe7c45a, alpha: 0.8 });
      y += w;
    }
  }
}

/** A tall lattice radio mast drawn up from (x, y) on screen, `h` high, a red light at its top. */
function mast(g: Graphics, glow: Graphics, x: number, y: number, h: number, dishes: number): void {
  const w = h * 0.07;
  const L = (k: number) => x - w * (1 - k), Rr = (k: number) => x + w * (1 - k), Y = (k: number) => y - h * k;
  g.moveTo(L(0), Y(0)).lineTo(x, Y(1)).lineTo(Rr(0), Y(0));
  for (let i = 0; i < 9; i++) { const a = i / 9, b = (i + 1) / 9; g.moveTo(L(a), Y(a)).lineTo(Rr(b), Y(b)).moveTo(Rr(a), Y(a)).lineTo(L(b), Y(b)).moveTo(L(b), Y(b)).lineTo(Rr(b), Y(b)); }
  g.stroke({ width: 1.6, color: 0x1a1830, join: 'round' });
  for (let i = 0; i < dishes; i++) { const k = 0.55 + i * 0.12, s = i % 2 ? 1 : -1; g.ellipse(x + s * w * 0.9, Y(k), w * 0.35, w * 0.6).fill(0x2a2840).stroke({ width: 1.2, color: 0x1a1830 }); }
  g.circle(x, Y(1) - 3, 3.5).fill(0xff4a3a);
  for (const [k, a] of [[1, 0.25], [0.5, 0.45]] as const) glow.circle(x, Y(1) - 3, 14 * k).fill({ color: 0xff3a2a, alpha: a });
}

/** 7. The epilogue's last picture: Olli, CEO of the world's largest telecom company, behind the desk, bookshelves behind, masts outside. */
const ceoOffice = (s: Stage): void => {
  const p = s.p;
  const g = s.ground;
  const RX = 9, RY = 7, WH = 2.7;
  // A parquet floor, planks along x, a rug under the desk.
  const fr = rng(14);
  for (let y = 0; y < RY; y += 0.5) for (let x = (y * 2) % 2 ? -0.5 : 0; x < RX; x += 1.5) {
    const x0 = Math.max(0, x), x1 = Math.min(RX, x + 1.5);
    g.poly(flat([p(x0, y), p(x1, y), p(x1, y + 0.5), p(x0, y + 0.5)])).fill(tone(0x8a5a32, (fr() - 0.5) * 0.18)).stroke({ width: 1.4, color: 0x5a3818 });
  }
  const rug = (x0: number, y0: number, x1: number, y1: number, c: number) => g.poly(flat([p(x0, y0), p(x1, y0), p(x1, y1), p(x0, y1)])).fill(c);
  // The desk, its chair and its rug stand toward the window, so the photo can come in close and still see out.
  const SX = 1.2;
  rug(1.4 + SX, 0.9, 6.4 + SX, 5.9, 0x6e1a20);
  g.poly(flat([p(1.4 + SX, 0.9), p(6.4 + SX, 0.9), p(6.4 + SX, 5.9), p(1.4 + SX, 5.9)])).stroke({ width: 3, color: INK });
  g.poly(flat([p(1.65 + SX, 1.15), p(6.15 + SX, 1.15), p(6.15 + SX, 5.65), p(1.65 + SX, 5.65)])).stroke({ width: 4, color: 0xd8a84a });
  g.poly(flat([p(1.9 + SX, 1.4), p(5.9 + SX, 1.4), p(5.9 + SX, 5.4), p(1.9 + SX, 5.4)])).stroke({ width: 2, color: 0x2a3a6e });
  for (const [cx, cy] of [[3.9 + SX, 3.4]] as const) {
    g.poly(flat([p(cx - 1.2, cy), p(cx, cy - 1.2), p(cx + 1.2, cy), p(cx, cy + 1.2)])).fill(0x8a2a28).stroke({ width: 2.5, color: 0xd8a84a });
    g.poly(flat([p(cx - 0.6, cy), p(cx, cy - 0.6), p(cx + 0.6, cy), p(cx, cy + 0.6)])).fill(0x2a3a6e).stroke({ width: 2, color: 0xd8a84a });
  }
  // The evening coming in through the window, falling across the floor; the lamp's pool on the desk.
  for (const [u0, u1] of [[2.7, 4.15], [4.35, 5.8], [6.0, 7.45]] as const) {
    for (let k = 0; k < 5; k++) {
      const f = 1.2 + k * 0.6;
      s.light.poly(flat([p(u0, 0), p(u1, 0), p(u1 - 0.25 * f, f), p(u0 - 0.25 * f, f)])).fill({ color: 0xffa860, alpha: 0.07 });
    }
  }

  // The walls: wood below, cream above; on the right one the window, on the left the shelves.
  s.draw(-10, (w) => {
    box(w, p, -0.3, -0.3, 0, RX + 0.3, 0.3, WH, { top: 0x5a3a22, side: 0xe6dac0, dark: 0.12 });
    box(w, p, -0.3, 0, 0, 0.3, RY, WH, { top: 0x5a3a22, side: 0xe6dac0, dark: 0.12 });
    w.poly(flat(onY(p, 0, 0, 0, 0, RX, 0, 0.9))).fill(0x6a4224);
    w.poly(flat(onX(p, 0, 0, 0, 0, RY, 0, 0.9))).fill(0x55341c);
    for (let u = 0.5; u < RX; u += 1) w.poly(flat(onY(p, u - 0.42, 0, 0, 0, 0.84, 0.12, 0.78))).stroke({ width: 1.6, color: 0x4a2c14 });
    w.poly(flat([p(0, RY, 0.9), p(0, 0, 0.9), p(RX, 0, 0.9)]), false).stroke({ width: 4, color: 0x3a2412 });
    w.poly(flat([p(0, RY, WH - 0.12), p(0, 0, WH - 0.12), p(RX, 0, WH - 0.12)]), false).stroke({ width: 5, color: 0xcbb994 });

    // The window: dusk over the city, its masts carrying the company's signal.
    const WX0 = 2.7, WX1 = 7.45, WZ0 = 0.5, WZ1 = 2.45;
    const F = (u: number, v: number): P => p(u, 0, v);
    const SKY = [0xffb36a, 0xff9a6a, 0xf27c78, 0xc8648a, 0x8a5294, 0x5a4290, 0x3a3478];
    SKY.forEach((c, i) => { const v0 = WZ0 + ((WZ1 - WZ0) * i) / SKY.length, v1 = WZ0 + ((WZ1 - WZ0) * (i + 1)) / SKY.length; w.poly(flat([F(WX0, v0), F(WX1, v0), F(WX1, v1), F(WX0, v1)])).fill(c); });
    // The sun going down behind the towers.
    const [sx, sy] = F(5.1, WZ0 + 0.32);
    w.circle(sx, sy, 34).fill({ color: 0xffe2a0, alpha: 0.9 });
    // Towers, far ones paler, lit windows in them.
    const cr = rng(8);
    for (const [u, wd, ht, far] of [[2.8, 0.35, 0.7, 1], [3.15, 0.3, 0.5, 1], [3.5, 0.42, 1.0, 0], [4.05, 0.3, 0.62, 1], [4.4, 0.5, 0.82, 0], [5.0, 0.28, 0.45, 1], [5.35, 0.4, 1.15, 0], [5.9, 0.34, 0.58, 1], [6.3, 0.46, 0.9, 0], [6.85, 0.3, 0.66, 1], [7.1, 0.35, 0.5, 0]] as const) {
      const c = far ? 0x6a4a86 : 0x3a2a5e;
      w.poly(flat([F(u, WZ0), F(u + wd, WZ0), F(u + wd, WZ0 + ht), F(u, WZ0 + ht)])).fill(c);
      for (let a = u + 0.06; a < u + wd - 0.05; a += 0.09) for (let b = WZ0 + 0.06; b < WZ0 + ht - 0.06; b += 0.1) if (cr() < 0.35) { const [q0, q1] = F(a, b); w.rect(q0 - 1.5, q1 - 2, 3, 4).fill(0xffd27a); }
    }
    // The masts, the one on the tallest tower short enough that its light stays below the window's top. Signal rings spread
    // from each light, sized to its mast, drawn only where they cross the glass: most of them would fall on the frame and wall.
    const masts = ([[5.55, WZ0 + 1.15, 46, 2], [3.7, WZ0 + 1.0, 52, 1], [6.95, WZ0, 120, 3]] as const).map(([u, v, h, dishes]) => {
      const [x, y] = F(u, v);
      mast(w, s.glow, x, y, h, dishes);
      return [x, y, h] as const;
    });
    const [ox, oy] = F(0, 0), [ux, uy] = F(1, 0), [, vy] = F(0, 1);
    const onGlass = (x: number, y: number): boolean => {
      const u = (x - ox) / (ux - ox), v = (oy + u * (uy - oy) - y) / (oy - vy);
      return u > WX0 + 0.03 && u < WX1 - 0.03 && v > WZ0 + 0.03 && v < WZ1 - 0.03;
    };
    for (const [mx, my, h] of masts) {
      const k = h / 120;
      for (const [r0, alpha] of [[16, 0.7], [36, 0.5], [60, 0.34], [88, 0.2]] as const) {
        const rr = r0 * k;
        let on = false;
        for (let i = 0; i <= 180; i++) {
          const t = (i / 180) * Math.PI * 2, x = mx + Math.cos(t) * rr, y = my - h - 4 + Math.sin(t) * rr;
          if (!onGlass(x, y)) { on = false; continue; }
          if (on) w.lineTo(x, y); else w.moveTo(x, y);
          on = true;
        }
        w.stroke({ width: 3 * Math.max(0.75, k), color: 0xfff4e0, alpha });
      }
    }
    // Frame and mullions.
    for (const u of [4.25, 5.9]) w.poly(flat([F(u, WZ0), F(u, WZ1)]), false).stroke({ width: 7, color: 0x2a2a30 });
    w.poly(flat([F(WX0, WZ0), F(WX1, WZ0), F(WX1, WZ1), F(WX0, WZ1)])).stroke({ width: 8, color: 0x2a2a30, join: 'round' });
    w.poly(flat([F(WX0, WZ0), F(WX1, WZ0), F(WX1, WZ1), F(WX0, WZ1)])).stroke({ width: 3, color: INK });
    w.poly(flat([F(WX0 - 0.05, WZ0 - 0.04), F(WX1 + 0.05, WZ0 - 0.04)]), false).stroke({ width: 6, color: 0xcbb994 });

    // On the right wall's other end: the network, a glowing web of links on a dark board.
    const N = (u: number, v: number): P => p(0.35 + u * 1.85, 0, 1.05 + v * 1.15);
    w.poly(flat([N(0, 0), N(1, 0), N(1, 1), N(0, 1)])).fill(0x0e1a3a).stroke({ width: 5, color: 0xb8954a, join: 'round' });
    const nr = rng(3);
    const nodes: P[] = Array.from({ length: 13 }, () => [0.08 + nr() * 0.84, 0.1 + nr() * 0.8] as P);
    const hub: P = [0.5, 0.5];
    for (const n of nodes) w.moveTo(...N(...hub)).lineTo(...N(...n));
    for (let i = 0; i < nodes.length; i++) w.moveTo(...N(...nodes[i]!)).lineTo(...N(...nodes[(i + 3) % nodes.length]!));
    w.stroke({ width: 1.6, color: 0x4ad2ff, alpha: 0.8 });
    for (const n of nodes) { const [a, b] = N(...n); w.circle(a, b, 3.2).fill(0xbff2ff); s.halo(a, b, 9, 0x4ad2ff, 0.5, s.glow); }
    { const [a, b] = N(...hub); w.circle(a, b, 6).fill(0xffffff); s.halo(a, b, 22, 0x4ad2ff, 0.7, s.glow); }

    // The shelves on the left wall, floor to ceiling either side of the score chart.
    const shelf = (y0: number, y1: number, seed: number) => {
      box(w, p, 0, y0, 0, 0.42, y1 - y0, WH - 0.2, { top: 0x4a2c16, side: 0x6a4224, dark: 0.25 });
      const levels = [0.08, 0.6, 1.12, 1.64, 2.0];
      for (const z of levels.slice(0, -1)) w.poly(flat(onX(p, 0.42, y0, z, 0.06, y1 - y0 - 0.06, 0, 0.47))).fill(0x2a1a0e);
      books(w, p, 0.42, y0 + 0.06, y1 - 0.06, levels.slice(0, -1), 0.47, seed);
      w.poly(flat(onX(p, 0.42, y0, 0, 0, y1 - y0, 0, WH - 0.2))).stroke({ width: 3, color: INK });
    };
    shelf(0.35, 2.35, 4);
    shelf(4.45, 6.6, 9);
    // The trophy for the high score, on top of the shelves.
    const [tx, ty] = p(0.2, 1.35, WH - 0.2);
    w.rect(tx - 13, ty - 12, 26, 12).fill(0x3a2412).stroke({ width: 2, color: INK });
    w.rect(tx - 4, ty - 26, 8, 14).fill(0xe0b23a).stroke({ width: 2, color: INK });
    w.moveTo(tx - 18, ty - 54).bezierCurveTo(tx - 18, ty - 26, tx + 18, ty - 26, tx + 18, ty - 54).closePath().fill(0xf0c84a).stroke({ width: 2.4, color: INK });
    for (const sx of [-1, 1]) w.moveTo(tx + sx * 17, ty - 50).bezierCurveTo(tx + sx * 30, ty - 50, tx + sx * 28, ty - 34, tx + sx * 12, ty - 34).stroke({ width: 3, color: 0xc89a2a });
    w.poly(flat(star(tx, ty - 44, 7))).fill(0xffffff);
    // The chart of the company's score, up and up.
    // Reading left to right on screen, which is toward smaller y on this wall.
    const Cc = (u: number, v: number): P => p(0, 2.6 + (1 - u) * 1.6, 1.05 + v * 1.15);
    w.poly(flat([Cc(0, 0), Cc(1, 0), Cc(1, 1), Cc(0, 1)])).fill(0xf6f0e0).stroke({ width: 5, color: 0xb8954a, join: 'round' });
    for (const v of [0.25, 0.5, 0.75]) w.poly(flat([Cc(0.08, v), Cc(0.92, v)]), false).stroke({ width: 1, color: 0xb8b0a0 });
    const pts: Array<[number, number]> = [[0.08, 0.12], [0.2, 0.18], [0.32, 0.15], [0.44, 0.3], [0.56, 0.36], [0.68, 0.55], [0.8, 0.7], [0.92, 0.92]];
    pts.forEach(([u, v], i) => w.poly(flat([Cc(u - 0.04, 0.06), Cc(u + 0.04, 0.06), Cc(u + 0.04, 0.06 + v * 0.7), Cc(u - 0.04, 0.06 + v * 0.7)])).fill(i === pts.length - 1 ? 0xd8322b : 0x6a8ab8));
    w.poly(flat(pts.map(([u, v]) => Cc(u, 0.1 + v * 0.8))), false).stroke({ width: 3.5, color: 0xd8322b, join: 'round' });
    const [ax, ay] = Cc(0.92, 0.84);
    w.poly(flat([[ax + 10, ay - 12], [ax - 6, ay - 9], [ax + 5, ay + 5]])).fill(0xd8322b);
  });

  // The arcade cabinet in the window's corner: he never stopped playing.
  s.draw(7.6 + 1.1 + 0.2, (c) => {
    const x0 = 7.6, y0 = 0.25, cw = 0.85, cd = 0.75;
    box(c, p, x0, y0, 0, cw, cd, 1.25, { top: 0x14122a, side: 0x1e1a3a, dark: 0.3 });
    box(c, p, x0, y0, 1.25, cw, 0.35, 0.72, { top: 0x14122a, side: 0x1e1a3a, dark: 0.3 });
    // The control panel, sloping, its stick and buttons.
    c.poly(flat([p(x0, y0 + 0.35, 1.25), p(x0 + cw, y0 + 0.35, 1.25), p(x0 + cw, y0 + cd + 0.1, 1.05), p(x0, y0 + cd + 0.1, 1.05)])).fill(0x2a2650).stroke({ width: 3, color: INK });
    const [jx, jy] = p(x0 + 0.3, y0 + 0.58, 1.15);
    c.moveTo(jx, jy).lineTo(jx, jy - 16).stroke({ width: 3, color: INK });
    c.circle(jx, jy - 17, 5).fill(0xd8322b).stroke({ width: 2, color: INK });
    for (const [bx, col] of [[0.55, YELLOW], [0.7, 0x4ad2ff]] as const) { const [a, b] = p(x0 + bx, y0 + 0.62, 1.14); c.ellipse(a, b, 5, 3).fill(col).stroke({ width: 1.6, color: INK }); }
    // Its screen, the maze glowing on it, and the marquee above.
    const scr = onY(p, x0 + 0.1, y0 + 0.35, 1.32, 0, cw - 0.2, 0, 0.5);
    c.poly(flat(scr)).fill(0x050818).stroke({ width: 3, color: INK });
    const S = (u: number, v: number): P => p(x0 + 0.1 + u * (cw - 0.2), y0 + 0.35, 1.32 + v * 0.5);
    for (const seg of [[[0.1, 0.8], [0.45, 0.8], [0.45, 0.6]], [[0.6, 0.85], [0.9, 0.85]], [[0.15, 0.45], [0.15, 0.2], [0.4, 0.2]], [[0.6, 0.55], [0.85, 0.55], [0.85, 0.25]]] as const) c.poly(flat(seg.map(([u, v]) => S(u, v))), false);
    c.stroke({ width: 2.2, color: BLUE });
    for (const [u, v] of [[0.3, 0.68], [0.55, 0.7], [0.7, 0.4], [0.3, 0.35]] as const) { const [a, b] = S(u, v); c.rect(a - 1.5, b - 1.5, 3, 3).fill(YELLOW); }
    { const [a, b] = S(0.5, 0.45); c.circle(a, b, 6).fill(YELLOW); }
    s.halo(...S(0.5, 0.5), 44, 0x4a6aff, 0.3, s.glow);
    s.tube(c, [p(x0, y0 + 0.35, 1.97), p(x0 + cw, y0 + 0.35, 1.97)], PINK, 4, 0.8);
    s.tube(c, [p(x0 + cw, y0 + cd, 0), p(x0 + cw, y0 + cd, 1.05)], PINK, 3, 0.6);
    c.poly(flat(onY(p, x0 + 0.06, y0 + 0.35, 1.72, 0, cw - 0.12, 0, 0.2))).fill(0xffe46a).stroke({ width: 2.4, color: INK });
    const [mx, my] = p(x0 + cw / 2, y0 + 0.35, 1.82);
    c.poly(flat(Array.from({ length: 13 }, (_, i) => { const a = 0.5 + (i / 12) * (Math.PI * 2 - 1); return [mx + Math.cos(a) * 7, my + Math.sin(a) * 7] as P; }).concat([[mx, my]]))).fill(0x14122a);
  });

  // The big chair behind the desk, its tufted leather back.
  const OY = 3.65;
  s.draw(4.6 + SX, (ch) => {
    box(ch, p, 1.75 + SX, OY - 0.45, 0, 0.75, 0.95, 0.42, { top: 0x2a1a14, side: 0x3a2418, hatch: 0.4 });
    box(ch, p, 1.5 + SX, OY - 0.55, 0.3, 0.26, 1.15, 1.45, { top: 0x5a2418, side: 0x7a3022, dark: 0.3, hatch: 0.35 });
    for (let i = 0; i < 3; i++) for (let j = 0; j < 4; j++) ch.circle(...p(1.76 + SX, OY - 0.35 + i * 0.36, 0.55 + j * 0.3), 2.4).fill(0x3a140c);
  });
  // Olli in it, peeking over the desk.
  s.figure('olli', 2.35 + SX, OY, 54, { facing: 'right', mouth: 0.5 }, { z: 0.3, depth: 5.2 + SX, shadow: 0 });

  // The desk: dark wood, a gilt line round its front panels, a green blotter and the tools of the trade on it.
  const DX0 = 3.05 + SX, DX1 = 4.3 + SX, DY0 = 1.35, DY1 = 5.2, DH = 0.8;
  s.draw(7 + SX, (d) => {
    const wood = { top: 0x5a2e18, side: 0x6e3a1e, dark: 0.32, hatch: 0.45 };
    box(d, p, DX0 + 0.08, DY0 + 0.08, 0, DX1 - DX0 - 0.16, DY1 - DY0 - 0.16, DH - 0.08, wood);
    box(d, p, DX0, DY0, DH - 0.08, DX1 - DX0, DY1 - DY0, 0.08, { top: 0x6a3820, side: 0x4a2412, line: 3 });
    for (const [u0, u1] of [[0.2, 1.35], [1.5, 2.35], [2.5, 3.5]] as const) d.poly(flat(onX(p, DX1 - 0.08, DY0 + 0.08, 0.1, u0, u1, 0, DH - 0.3))).stroke({ width: 2, color: 0xc8a050 });
    d.poly(flat(onY(p, DX0 + 0.08, DY1 - 0.08, 0.1, 0.12, DX1 - DX0 - 0.28, 0, DH - 0.3))).stroke({ width: 2, color: 0xc8a050 });
    const T = DH;
    // The blotter, a letter on it, a pen.
    d.poly(flat([p(DX0 + 0.35, OY - 0.6, T), p(DX1 - 0.2, OY - 0.6, T), p(DX1 - 0.2, OY + 0.6, T), p(DX0 + 0.35, OY + 0.6, T)])).fill(0x2f5a3a).stroke({ width: 2, color: INK });
    d.poly(flat([p(DX0 + 0.5, OY - 0.35, T + 0.01), p(DX1 - 0.4, OY - 0.3, T + 0.01), p(DX1 - 0.42, OY + 0.25, T + 0.01), p(DX0 + 0.48, OY + 0.2, T + 0.01)])).fill(0xfbf8ee).stroke({ width: 1.5, color: INK });
    for (let k = 0; k < 4; k++) d.poly(flat([p(DX0 + 0.62 + k * 0.12, OY - 0.23, T + 0.01), p(DX0 + 0.62 + k * 0.12, OY + 0.1, T + 0.01)]), false).stroke({ width: 1.2, color: 0x8a8a90 });
    d.poly(flat([p(DX1 - 0.3, OY + 0.4, T + 0.02), p(DX0 + 0.6, OY + 0.55, T + 0.02)]), false).stroke({ width: 3.5, color: 0x1a1a1a, cap: 'round' });
    // The desk phone: a beige set, its handset on the cradle, a coiled cord.
    const PX = DX0 + 0.5, PY = 2.05;
    box(d, p, PX, PY, T, 0.48, 0.55, 0.12, { top: 0xe8dcc0, side: 0xcbbd9c, line: 2.4 });
    for (let i = 0; i < 3; i++) for (let j = 0; j < 4; j++) d.rect(...p(PX + 0.18 + i * 0.09, PY + 0.12 + j * 0.09, T + 0.12), 3.5, 2.5).fill(0x6a6458);
    box(d, p, PX + 0.04, PY + 0.02, T + 0.12, 0.12, 0.52, 0.08, { top: 0xd8cbac, side: 0xbcae8c, line: 2.4 });
    const [c0x, c0y] = p(PX + 0.1, PY + 0.55, T + 0.14);
    d.moveTo(c0x, c0y);
    for (let k = 1; k <= 14; k++) { const u = k / 14; d.lineTo(c0x - 18 * u + Math.sin(k * 2.2) * 4, c0y + 24 * u + Math.cos(k * 2.2) * 3); }
    d.stroke({ width: 2, color: 0xbcae8c });
    // The red line: a second phone, for the calls that matter.
    box(d, p, DX0 + 0.62, 1.5, T, 0.36, 0.4, 0.1, { top: 0xd8322b, side: 0xa8221c, line: 2.4 });
    box(d, p, DX0 + 0.65, 1.52, T + 0.1, 0.1, 0.36, 0.07, { top: 0xe84a3a, side: 0xb8281e, line: 2.2 });
    // The brick of a mobile phone, standing up, its antenna out.
    const [bx, by] = p(DX0 + 0.3, 2.85, T);
    d.roundRect(bx - 10, by - 58, 20, 58, 4).fill(0x3a3a40).stroke({ width: 2.6, color: INK });
    d.rect(bx - 6, by - 50, 12, 9).fill(0x9ad87a).stroke({ width: 1.4, color: INK });
    for (let i = 0; i < 3; i++) for (let j = 0; j < 4; j++) d.rect(bx - 6 + i * 4.5, by - 36 + j * 6, 3, 3).fill(0xb8b8c0);
    d.moveTo(bx + 5, by - 58).lineTo(bx + 5, by - 80).stroke({ width: 3.5, color: INK, cap: 'round' });
    // The banker's lamp, green shade, its light on the blotter.
    const [lx, ly] = p(DX1 - 0.3, 4.9, T);
    d.ellipse(lx, ly, 12, 5).fill(0xc8a050).stroke({ width: 2, color: INK });
    d.moveTo(lx, ly).lineTo(lx, ly - 34).stroke({ width: 3.5, color: 0xc8a050 });
    // Its shade, round under at its rim as the photo looks down on it.
    const shade = () => { d.moveTo(lx - 26, ly - 34).bezierCurveTo(lx - 25, ly - 52, lx + 25, ly - 52, lx + 26, ly - 34); for (const [a, b] of footCurve(lx, ly - 34, 26, 9).slice(1)) d.lineTo(a, b); return d.closePath(); };
    shade().fill(0x2f7a4a).stroke({ width: 2.4, color: INK, join: 'round' });
    for (const [k, a] of [[1, 0.1], [0.7, 0.14], [0.45, 0.18]] as const) s.glow.ellipse(lx + 30, ly + 14, 70 * k, 26 * k).fill({ color: 0xffe6a0, alpha: a });
  });

  // The globe by the shelves, and a tall plant by the window.
  s.draw(1.2 + 5.9, (gl) => {
    const [x, y] = p(1.2, 5.9);
    s.soft(x, y, 36, 12);
    gl.moveTo(x - 22, y).lineTo(x, y - 40).lineTo(x + 22, y).stroke({ width: 4.5, color: 0x5a3818, cap: 'round' });
    gl.moveTo(x, y - 40).lineTo(x, y - 56).stroke({ width: 4, color: 0x5a3818 });
    const cy = y - 96;
    gl.circle(x, cy, 38).fill(0x3a7ac8).stroke({ width: 3, color: INK });
    gl.moveTo(x - 24, cy - 22).bezierCurveTo(x - 6, cy - 34, x + 6, cy - 14, x - 6, cy - 2).bezierCurveTo(x - 18, cy + 8, x - 30, cy - 6, x - 24, cy - 22).fill(0x5aa84a).stroke({ width: 1.6, color: INK });
    gl.moveTo(x + 10, cy + 2).bezierCurveTo(x + 26, cy - 4, x + 30, cy + 16, x + 18, cy + 28).bezierCurveTo(x + 8, cy + 20, x + 4, cy + 10, x + 10, cy + 2).fill(0x5aa84a).stroke({ width: 1.6, color: INK });
    gl.moveTo(x + 4, cy - 40).bezierCurveTo(x + 50, cy - 30, x + 44, cy + 34, x - 4, cy + 40).stroke({ width: 4, color: 0xd8a84a });
    gl.ellipse(x - 14, cy - 16, 10, 6).fill({ color: 0xffffff, alpha: 0.35 });
  });
  // The plant in its square planter, drawn as the room's boxes are. Its leaves are set round the stem in the room's own space,
  // each leaning out from upright, arching and drooping at its tip, the farthest drawn first, lit as the room's solids are.
  s.draw(8.2 + 2.6, (pl) => {
    const [x, y] = p(8.2, 2.6);
    s.soft(x, y, 34, 12);
    const Z = 0.52;
    box(pl, p, 8.0, 2.4, 0, 0.4, 0.4, Z, { top: 0xece6d8, side: 0xd8d0c0, dark: 0.35, hatch: 0.25, line: 2.6 });
    pl.poly(flat([p(8.05, 2.45, Z), p(8.35, 2.45, Z), p(8.35, 2.75, Z), p(8.05, 2.75, Z)])).fill(0x3a2614);
    const lr = rng(12);
    const leaves = Array.from({ length: 13 }, (_, i) => {
      const phi = (i / 13) * Math.PI * 2 + (lr() - 0.5) * 0.5, th = 0.18 + lr() * 0.7, len = 1.3 - th * 0.6 + lr() * 0.2;
      return { phi, th, len, dx: Math.sin(th) * Math.cos(phi), dy: Math.sin(th) * Math.sin(phi), dz: Math.cos(th) };
    }).sort((a, b) => a.dx + a.dy - (b.dx + b.dy));
    for (const l of leaves) {
      const b0 = 8.2 + l.dx * 0.06, b1 = 2.6 + l.dy * 0.06, droop = Math.sin(l.th) ** 2 * 0.45;
      const B = p(b0, b1, Z - 0.02);
      const M = p(b0 + l.dx * l.len * 0.5, b1 + l.dy * l.len * 0.5, Z + l.dz * l.len * 0.5 + Math.sin(l.th) * 0.1);
      const T = p(b0 + l.dx * l.len, b1 + l.dy * l.len, Z + l.dz * l.len - droop * l.len);
      const ex = T[0] - B[0], ey = T[1] - B[1], el = Math.hypot(ex, ey) || 1, nx = -ey / el, ny = ex / el, wd = 9 + l.len * 3;
      // Facing +y is lit and +x shaded, as on the boxes; the leaves behind the stem a little darker still.
      const lit = Math.sin(l.phi - Math.PI / 4), back = l.dx + l.dy < 0 ? -0.12 : 0;
      const c = tone(0x3f8a3a, (lit > 0 ? lit * 0.18 : lit * 0.32) + back);
      pl.moveTo(B[0], B[1]).quadraticCurveTo(M[0] + nx * wd, M[1] + ny * wd, T[0], T[1]).quadraticCurveTo(M[0] - nx * wd, M[1] - ny * wd, B[0], B[1])
        .fill(c).stroke({ width: 1.8, color: INK, join: 'round' });
      pl.moveTo(B[0], B[1]).quadraticCurveTo(M[0], M[1], T[0], T[1]).stroke({ width: 1, color: tone(c, 0.35), alpha: 0.7 });
    }
  });
};

/**
 * An armchair at (x, y), its seat `w` square, facing +x or +y; its back, far arm, seat and cushion drawn at `back`, the near arm
 * at `front`, so a figure drawn between sits on the cushion, its top 0.44 up, with the near arm before it (the owner, 13 Nov:
 * "they are behind the seat cushions").
 */
function armchair(s: Stage, x: number, y: number, faces: 'x' | 'y', back: number, front: number, cloth: number): void {
  const p = s.p, w = 1.0, seat = 0.42, arm = 0.18, ARM = 0.75, mat = { top: tone(cloth, 0.12), side: cloth, dark: 0.32, hatch: 0.45 };
  // Footprint: the seat from (x, y); the back on the far side of the facing; arms either side.
  if (faces === 'x') {
    s.draw(back, (g) => {
      box(g, p, x - 0.24, y - arm, 0, 0.24, w + arm * 2, 1.25, mat);
      box(g, p, x - 0.24, y - arm, 0, w + 0.24, arm, ARM, mat);
      box(g, p, x, y, 0, w, w, seat - 0.12, mat);
      box(g, p, x + 0.02, y + 0.02, seat - 0.12, w - 0.04, w - 0.04, 0.14, { ...mat, top: tone(cloth, 0.22) });
    });
    s.draw(front, (g) => {
      box(g, p, x - 0.24, y + w, 0, w + 0.24, arm, ARM, mat);
      for (const [a, b] of [[x - 0.24, y + w + arm]] as const) for (let k = 0; k < 6; k++) g.circle(...p(a + 0.12 + k * 0.17, b, ARM - 0.08), 2.2).fill(0xe0b84a);
    });
  } else {
    s.draw(back, (g) => {
      box(g, p, x - arm, y - 0.24, 0, w + arm * 2, 0.24, 1.25, mat);
      box(g, p, x - arm, y - 0.24, 0, arm, w + 0.24, ARM, mat);
      box(g, p, x, y, 0, w, w, seat - 0.12, mat);
      box(g, p, x + 0.02, y + 0.02, seat - 0.12, w - 0.04, w - 0.04, 0.14, { ...mat, top: tone(cloth, 0.22) });
    });
    s.draw(front, (g) => {
      box(g, p, x + w, y - 0.24, 0, arm, w + 0.24, ARM, mat);
      for (let k = 0; k < 6; k++) g.circle(...p(x + w + arm, y - 0.12 + k * 0.17, ARM - 0.08), 2.2).fill(0xe0b84a);
    });
  }
}

/** Steam curling up from (x, y). */
function steam(g: Graphics, x: number, y: number, h: number): void {
  for (const dx of [-4, 4]) g.moveTo(x + dx, y).bezierCurveTo(x + dx - 8, y - h * 0.3, x + dx + 8, y - h * 0.6, x + dx, y - h).stroke({ width: 2.4, color: 0xffffff, alpha: 0.6, cap: 'round' });
}

/** 8. The fireside chat: Ronnie and Gorbie in armchairs either side of the fire, a game of chess between them, snow at the window. */
const firesideChat = (s: Stage): void => {
  const p = s.p;
  const g = s.ground;
  const RX = 8, RY = 7, WH = 2.6;
  // Floorboards, a rug before the fire.
  const fr = rng(31);
  for (let x = 0; x < RX; x += 0.5) for (let y = (x * 2) % 2 ? -0.7 : 0; y < RY; y += 1.4) {
    const y0 = Math.max(0, y), y1 = Math.min(RY, y + 1.4);
    g.poly(flat([p(x, y0), p(x + 0.5, y0), p(x + 0.5, y1), p(x, y1)])).fill(tone(0x6a4024, (fr() - 0.5) * 0.2)).stroke({ width: 1.4, color: 0x3e2410 });
  }
  const rugPts = (k: number) => Array.from({ length: 48 }, (_, i) => { const a = (i / 48) * Math.PI * 2; return p(2.9 + Math.cos(a) * 2.0 * k, 2.4 + Math.sin(a) * 1.7 * k); });
  g.poly(flat(rugPts(1))).fill(0x7a2a24).stroke({ width: 3, color: INK });
  for (const [k, c] of [[0.88, 0xd8a84a], [0.72, 0x2a3a5e], [0.5, 0xd8a84a], [0.32, 0x8a3a2a]] as const) g.poly(flat(rugPts(k))).stroke({ width: k === 0.72 ? 9 : 3, color: c });
  // The fire's warm light thrown out across the room.
  for (let i = 0; i < 26; i++) { const k = 1 - i * 0.034; s.light.ellipse(...p(1.6, 1.6), 560 * k, 280 * k).fill({ color: 0xff9a40, alpha: 0.026 }); }

  s.draw(-10, (w) => {
    // Green striped paper over wood panelling.
    box(w, p, -0.3, -0.3, 0, RX + 0.3, 0.3, WH, { top: 0x4a2e1a, side: 0x2f5040, dark: 0.15 });
    box(w, p, -0.3, 0, 0, 0.3, RY, WH, { top: 0x4a2e1a, side: 0x2f5040, dark: 0.15 });
    for (let u = 0.25; u < RX; u += 0.5) w.poly(flat([p(u, 0, 0.95), p(u, 0, WH)]), false);
    for (let u = 0.25; u < RY; u += 0.5) w.poly(flat([p(0, u, 0.95), p(0, u, WH)]), false);
    w.stroke({ width: 5, color: 0x3a5e4c, alpha: 0.8 });
    w.poly(flat(onY(p, 0, 0, 0, 0, RX, 0, 0.95))).fill(0x5a361c);
    w.poly(flat(onX(p, 0, 0, 0, 0, RY, 0, 0.95))).fill(0x48290f);
    w.poly(flat([p(0, RY, 0.95), p(0, 0, 0.95), p(RX, 0, 0.95)]), false).stroke({ width: 5, color: 0x2e1a0a });

    // The window on the left wall, behind Ronnie's chair: snow falling at night, frost in its corners, icicles hanging outside, curtains drawn back.
    const Y0 = 2.3, Y1 = 4.1, Z0 = 0.95, Z1 = 2.15;
    const Wd = (u: number, v: number): P => p(0, Y0 + u * (Y1 - Y0), Z0 + v * (Z1 - Z0));
    w.poly(flat([Wd(0, 0), Wd(1, 0), Wd(1, 1), Wd(0, 1)])).fill(0x1a2a5a);
    w.poly(flat([Wd(0, 0), Wd(1, 0), Wd(1, 0.22), Wd(0.7, 0.3), Wd(0.4, 0.2), Wd(0, 0.28)])).fill(0xe8f0ff);
    const sr = rng(4);
    for (let i = 0; i < 40; i++) { const [a, b] = Wd(0.04 + sr() * 0.92, 0.3 + sr() * 0.66); w.circle(a, b, 1.5 + sr() * 2).fill(0xffffff); }
    for (const [u, v, k] of [[0, 1, 1], [1, 1, -1], [0, 0.28, 1]] as const) {
      const [a, b] = Wd(u, v);
      for (let i = 0; i < 4; i++) w.circle(a + k * (6 + i * 4), b + (v > 0.5 ? 6 + i * 3 : -4 - i * 2), 9 - i * 1.8).fill({ color: 0xe8f4ff, alpha: 0.5 });
    }
    for (let i = 0; i < 7; i++) { const u = 0.08 + i * 0.14, l = 0.1 + sr() * 0.12; w.poly(flat([Wd(u - 0.03, 1), Wd(u + 0.03, 1), Wd(u, 1 - l)])).fill(0xdff0ff).stroke({ width: 1.2, color: 0x8ab0d8 }); }
    w.poly(flat([Wd(0.5, 0), Wd(0.5, 1)]), false).stroke({ width: 6, color: 0xe6dcc4 });
    w.poly(flat([Wd(0, 0.55), Wd(1, 0.55)]), false).stroke({ width: 6, color: 0xe6dcc4 });
    w.poly(flat([Wd(0, 0), Wd(1, 0), Wd(1, 1), Wd(0, 1)])).stroke({ width: 7, color: 0xe6dcc4 }).stroke({ width: 2.4, color: INK });
    for (const side of [0, 1]) {
      const u0 = side ? 1.0 : -0.22, u1 = side ? 1.22 : 0;
      const drape: P[] = [Wd(u0, 1.12), Wd(u1, 1.12), Wd(u1 + (side ? -0.04 : 0.04), 0.5), Wd(side ? u1 : u0 + 0.06, -0.62), Wd(side ? u0 - 0.04 : u0, -0.62)];
      w.poly(flat(drape)).fill(0x8a1e24).stroke({ width: 2.6, color: INK, join: 'round' });
      for (let k = 1; k < 4; k++) w.poly(flat([Wd(u0 + ((u1 - u0) * k) / 4, 1.1), Wd(u0 + ((u1 - u0) * k) / 4, -0.55)]), false).stroke({ width: 1.6, color: 0x5a1014 });
    }
    w.poly(flat([Wd(-0.3, 1.14), Wd(1.3, 1.14)]), false).stroke({ width: 6, color: 0xc89a3a, cap: 'round' });

    // The chimney breast on the back wall: stone, a mantel, the fire in its hearth, a winter painting above.
    const FX0 = 0.6, FX1 = 2.6, FD = 0.5;
    box(w, p, FX0, -0.3, 0, FX1 - FX0, FD + 0.3, WH, { top: 0x6a6258, side: 0xa89c88, dark: 0.3, hatch: 0.4 });
    const sr2 = rng(9);
    for (let v = 0.2; v < WH; v += 0.22) for (let u = (Math.round(v * 10) % 2 ? 0.1 : 0.3); u < FX1 - FX0 - 0.1; u += 0.4) {
      w.poly(flat(onY(p, FX0, FD, 0, u, u + 0.36, v - 0.2, v - 0.02))).stroke({ width: 1.3, color: 0x7a6e5c, alpha: 0.6 + sr2() * 0.3 });
    }
    // The opening: an arch, sooty inside, the fire on its logs.
    const arch: P[] = [p(FX0 + 0.4, FD, 0.05), p(FX1 - 0.4, FD, 0.05)];
    for (let k = 0; k <= 12; k++) { const a = (k / 12) * Math.PI; arch.push(p(FX0 + 1.0 + Math.cos(a) * 0.6, FD, 0.62 + Math.sin(a) * 0.32)); }
    w.poly(flat(arch)).fill(0x1a0e08).stroke({ width: 4, color: INK, join: 'round' });
    for (const [a, b] of [[0.62, 1.32], [0.75, 1.25]] as const) box(w, p, FX0 + a, FD - 0.35, 0.05, b - a, 0.16, 0.12, { top: 0x6a3a1a, side: 0x4a2a12, line: 2 });
    const [fx, fy] = p(FX0 + 1.0, FD - 0.1, 0.12);
    for (let i = 0; i < 8; i++) s.glow.ellipse(fx, fy - 24, 110 - i * 11, 70 - i * 7).fill({ color: 0xff8a2a, alpha: 0.035 });
    flame(w, fx - 18, fy, 64);
    flame(w, fx + 16, fy + 2, 56, true);
    flame(w, fx, fy + 4, 82);
    // Mantel, its candles.
    box(w, p, FX0 - 0.12, -0.3, 1.25, FX1 - FX0 + 0.24, FD + 0.45, 0.12, { top: 0x5a3018, side: 0x6e3a1e, dark: 0.3, line: 3 });
    for (const u of [0.14, 1.86]) {
      const [cx, cy] = p(FX0 + u, FD - 0.05, 1.37);
      w.poly(flat([[cx - 4, cy - 26], ...footCurve(cx, cy, 4, 1.8, 8).reverse(), [cx + 4, cy - 26]])).fill(0xf6f0e0).stroke({ width: 1.8, color: INK, join: 'round' });
      w.ellipse(cx, cy - 26, 4, 1.8).fill(0xfffaf0).stroke({ width: 1.4, color: INK });
      flame(w, cx, cy - 26, 14);
      s.halo(cx, cy - 33, 16, 0xffc060, 0.25, s.glow);
    }
    // The painting: snow on pines under a pale sky.
    const Pn = (u: number, v: number): P => p(FX0 + 0.4 + u * 1.2, FD, 1.55 + v * 0.75);
    w.poly(flat([Pn(0, 0), Pn(1, 0), Pn(1, 1), Pn(0, 1)])).fill(0xbcd2e8);
    w.poly(flat([Pn(0, 0), Pn(1, 0), Pn(1, 0.3), Pn(0.6, 0.42), Pn(0.3, 0.32), Pn(0, 0.4)])).fill(0xf6faff);
    for (const [u, k] of [[0.2, 0.5], [0.42, 0.62], [0.75, 0.55]] as const) { w.poly(flat([Pn(u - 0.1, 0.32), Pn(u + 0.1, 0.32), Pn(u, 0.32 + k)])).fill(0x2f5a4a); w.poly(flat([Pn(u - 0.05, 0.32 + k * 0.6), Pn(u + 0.05, 0.32 + k * 0.6), Pn(u, 0.32 + k)])).fill(0xffffff); }
    w.poly(flat([Pn(0, 0), Pn(1, 0), Pn(1, 1), Pn(0, 1)])).stroke({ width: 7, color: 0xc89a3a, join: 'round' }).stroke({ width: 2, color: INK });
  });

  // A floor lamp in the corner by the window, its fringed shade lit.
  s.draw(0.6 + 6.2, (l) => {
    const [x, y] = p(0.6, 6.2);
    s.soft(x, y, 26, 9);
    l.ellipse(x, y, 16, 6).fill(0x3a2412).stroke({ width: 2, color: INK });
    l.moveTo(x, y).lineTo(x, y - 150).stroke({ width: 4, color: 0x3a2412 });
    l.poly(flat([[x - 16, y - 186], [x + 16, y - 186], [x + 32, y - 146], [x - 32, y - 146]])).fill(0xf0d8a0).stroke({ width: 2.6, color: INK, join: 'round' });
    for (let k = -30; k <= 30; k += 5) l.moveTo(x + k, y - 146).lineTo(x + k, y - 138);
    l.stroke({ width: 1.6, color: 0xc89a3a });
    for (const [k, a] of [[1, 0.06], [0.7, 0.08], [0.45, 0.1]] as const) s.glow.ellipse(x, y - 164, 64 * k, 44 * k).fill({ color: 0xffe2a0, alpha: a });
  });

  // The chairs, Ronnie's facing across to Gorbie's; between them, a low table with the game and two mugs of cocoa.
  const RCX = 1.85, RCY = 2.55, GCX = 3.75, GCY = 0.95;
  armchair(s, RCX, RCY, 'x', 3.0, 5.0, 0x8a1e24);
  armchair(s, GCX, GCY, 'y', 3.1, 5.1, 0x2f5a46);
  // Each sits toward the seat's near side, so the far arm's top passes behind the eyes: nearer it, it ran through the open
  // mouth and read as in front (the owner, 13 Nov: "Ronnie is also behind the far armrest").
  s.figure('ronnie', RCX + 0.5, RCY + 0.65, 44, { facing: 'right', mouth: 0.7 }, { z: 0.44, depth: 4.0, shadow: 0 });
  s.figure('gorbie', GCX + 0.65, GCY + 0.5, 44, { facing: 'left', mouth: 0.4 }, { z: 0.44, depth: 4.1, shadow: 0 });
  const TX = 3.35, TY = 2.55, TW = 0.95, TH = 0.48;
  s.draw(TX + TY + TW * 2, (t) => {
    s.soft(...p(TX + TW / 2, TY + TW / 2), 60, 20);
    for (const [lx, ly] of [[TX + 0.06, TY + TW - 0.14], [TX + TW - 0.14, TY + TW - 0.14], [TX + TW - 0.14, TY + 0.06]] as const) box(t, p, lx, ly, 0, 0.08, 0.08, TH - 0.06, { top: 0x4a2a12, side: 0x5a3418 });
    box(t, p, TX, TY, TH - 0.06, TW, TW, 0.06, { top: 0x6a3a1e, side: 0x4a2612, line: 2.6 });
    // The board, a game well under way.
    const B0 = 0.14, BS = (TW - 0.28) / 8;
    for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) t.poly(flat([p(TX + B0 + i * BS, TY + B0 + j * BS, TH), p(TX + B0 + (i + 1) * BS, TY + B0 + j * BS, TH), p(TX + B0 + (i + 1) * BS, TY + B0 + (j + 1) * BS, TH), p(TX + B0 + i * BS, TY + B0 + (j + 1) * BS, TH)])).fill((i + j) % 2 ? 0x3a2a1a : 0xe8dcc0);
    t.poly(flat([p(TX + B0, TY + B0, TH), p(TX + TW - B0, TY + B0, TH), p(TX + TW - B0, TY + TW - B0, TH), p(TX + B0, TY + TW - B0, TH)])).stroke({ width: 2, color: INK });
    const piece = (i: number, j: number, white: boolean, tall: number) => {
      const [a, b] = p(TX + B0 + (i + 0.5) * BS, TY + B0 + (j + 0.5) * BS, TH);
      t.ellipse(a, b, 5, 2.4).fill(white ? 0xf6f0e0 : 0x2a2422).stroke({ width: 1.2, color: INK });
      t.poly(flat([[a - 2, b - tall], ...footCurve(a, b, 3.4, 1.6, 8).reverse(), [a + 2, b - tall]])).fill(white ? 0xf6f0e0 : 0x2a2422).stroke({ width: 1.2, color: INK, join: 'round' });
      t.circle(a, b - tall - 2.5, 3).fill(white ? 0xf6f0e0 : 0x2a2422).stroke({ width: 1.2, color: INK });
    };
    for (const [i, j, w, h] of [[1, 1, false, 9], [2, 2, false, 9], [4, 1, false, 15], [5, 2, false, 9], [6, 4, false, 12], [2, 5, true, 9], [3, 6, true, 12], [5, 6, true, 9], [6, 5, true, 15], [4, 4, true, 9]] as const) piece(i, j, w, h);
    // Two mugs of cocoa, steaming.
    for (const [mx, my] of [[TX + 0.08, TY + 0.5], [TX + 0.5, TY + 0.08]] as const) {
      const [a, b] = p(mx, my, TH);
      const mug: P[] = [[a - 7, b - 16], ...footCurve(a, b, 7, 2.6, 12).reverse(), [a + 7, b - 16]];
      t.poly(flat(mug)).fill(0xfbf6ea);
      t.poly(flat(mug), false).stroke({ width: 2, color: INK, join: 'round' });
      t.ellipse(a, b - 16, 7, 2.6).fill(0x5a2a12).stroke({ width: 1.6, color: INK });
      t.moveTo(a + 7, b - 13).bezierCurveTo(a + 14, b - 13, a + 14, b - 4, a + 7, b - 4).stroke({ width: 2, color: INK });
      steam(t, a, b - 22, 26);
    }
  });
};

/**
 * An upright prism on a convex footprint (grid points, going round clockwise as seen from above), from z0 to z1: the sides that
 * face the viewer, lit by how much they face down and left, its top, inked. Many sides make a cylinder.
 */
function prism(g: Graphics, p: Proj, foot: readonly P[], z0: number, z1: number, m: Mat): void {
  const n = foot.length, ink = m.ink ?? INK, lw = m.line ?? 3.5;
  let cx = 0, cy = 0;
  for (const [x, y] of foot) { cx += x / n; cy += y / n; }
  for (let i = 0; i < n; i++) {
    const a = foot[i]!, b = foot[(i + 1) % n]!;
    let nx = b[1] - a[1], ny = -(b[0] - a[0]);
    const mx = (a[0] + b[0]) / 2 - cx, my = (a[1] + b[1]) / 2 - cy;
    if (nx * mx + ny * my < 0) { nx = -nx; ny = -ny; }
    if (nx + ny <= 1e-6) continue;
    const l = Math.hypot(nx, ny), k = (ny - nx) / l; // 1 facing +y (lit), -1 facing +x (shaded)
    const face: P[] = [p(a[0], a[1], z0), p(b[0], b[1], z0), p(b[0], b[1], z1), p(a[0], a[1], z1)];
    g.poly(flat(face)).fill(tone(m.side, -(m.dark ?? 0.3) * (1 - k) * 0.5));
    if (m.hatch && k < 0) hatch(g, face, -1.05, 6.5, 1.4, m.hatch * -k, 0.55, i * 7 + 3);
    if (n <= 8) g.poly(flat([p(a[0], a[1], z0), p(a[0], a[1], z1)]), false).stroke({ width: lw * 0.5, color: ink, alpha: 0.7 });
  }
  g.poly(flat(foot.map(([x, y]) => p(x, y, z1)))).fill(m.top).stroke({ width: lw * 0.8, color: ink, join: 'round' });
  // The silhouette: the outline of everything, drawn as the base's near edges and the top's.
  const near = foot.map(([x, y]) => p(x, y, z0));
  g.poly(flat(near)).stroke({ width: lw, color: ink, alpha: 0 });
  const xs = foot.map(([x, y]) => x - y), lo = xs.indexOf(Math.min(...xs)), hi = xs.indexOf(Math.max(...xs));
  for (const i of [lo, hi]) g.poly(flat([p(foot[i]![0], foot[i]![1], z0), p(foot[i]![0], foot[i]![1], z1)]), false).stroke({ width: lw, color: ink });
  const front: P[] = [];
  for (let i = lo; ; i = (i + n - 1) % n) { front.push(p(foot[i]![0], foot[i]![1], z0)); if (i === hi) break; }
  const back: P[] = [];
  for (let i = lo; ; i = (i + 1) % n) { back.push(p(foot[i]![0], foot[i]![1], z0)); if (i === hi) break; }
  // Whichever run from leftmost to rightmost lies lower on screen is the near base edge.
  const lower = front.reduce((s, q) => s + q[1], 0) / front.length > back.reduce((s, q) => s + q[1], 0) / back.length ? front : back;
  g.poly(flat(lower), false).stroke({ width: lw, color: ink, join: 'round' });
}

/** A circle's footprint, as grid points round (x, y), radius r, `n` sides. */
const disc = (x: number, y: number, r: number, n = 28): P[] => Array.from({ length: n }, (_, i) => { const a = (i / n) * Math.PI * 2; return [x + Math.cos(a) * r, y + Math.sin(a) * r] as P; });

/** An onion dome sitting on (x, y) on screen, `r` its half width: gold, shaded on its right, a spire on top. */
function onion(g: Graphics, x: number, y: number, r: number, color = 0xe6b422): void {
  // Its foot is round, so it ends below on the near half of its foot's ellipse, sitting just inside its tower's top.
  const ry = r * 0.5;
  const path = () => {
    g.moveTo(x - r, y).bezierCurveTo(x - r * 1.45, y - r * 0.9, x - r * 0.45, y - r * 1.45, x, y - r * 2.15)
      .bezierCurveTo(x + r * 0.45, y - r * 1.45, x + r * 1.45, y - r * 0.9, x + r, y);
    for (const [a, b] of footCurve(x, y, r, ry).slice(1)) g.lineTo(a, b);
    return g.closePath();
  };
  path().fill(color);
  g.moveTo(x + r * 0.15, y - r * 1.9).bezierCurveTo(x + r * 0.8, y - r * 1.3, x + r * 1.45, y - r * 0.9, x + r, y);
  for (const [a, b] of ellipseArc(x, y, r, ry, 0, Math.acos(0.35), 8).slice(1)) g.lineTo(a, b);
  g.bezierCurveTo(x + r * 0.7, y - r * 0.8, x + r * 0.5, y - r * 1.4, x + r * 0.15, y - r * 1.9).fill(tone(color, -0.3));
  for (const k of [-0.5, 0, 0.5]) g.moveTo(x + r * k, y + footDrop(r * k, r, ry)).bezierCurveTo(x + r * k * 1.5, y - r * 0.9, x + r * k * 0.5, y - r * 1.45, x, y - r * 2.15);
  g.stroke({ width: Math.max(1.2, r * 0.06), color: tone(color, -0.45), alpha: 0.8 });
  g.ellipse(x - r * 0.45, y - r * 0.85, r * 0.16, r * 0.3).fill({ color: 0xffffff, alpha: 0.55 });
  path().stroke({ width: Math.max(2, r * 0.09), color: INK, join: 'round' });
  g.moveTo(x, y - r * 2.1).lineTo(x, y - r * 2.75).stroke({ width: Math.max(2, r * 0.1), color: INK, cap: 'round' });
  g.circle(x, y - r * 2.45, r * 0.12).fill(color).stroke({ width: 1.6, color: INK });
}

/** 9. Their separate ways: a crossroads in the fields, a signpost painted in their colours, each road to one of their new lives. */
const separateWays = (s: Stage): void => {
  const p = s.p;
  const g = s.ground;
  const X0 = -1, X1 = 14, Y0 = -1, Y1 = 14, J = 8;
  // The three places stand close to the crossroads, so the photo can come in on the three and still take them all in:
  // the hall and the domes drawn moved in by N along their roads, the tower moved in along its own.
  const N = 1.2;
  const ph: Proj = (x, y, z = 0) => p(x + N, y, z), pg: Proj = (x, y, z = 0) => p(x, y + N, z);
  // Grass, in two greens by tile, with tufts.
  for (let x = X0; x < X1; x++) for (let y = Y0; y < Y1; y++) g.poly(flat([p(x, y), p(x + 1, y), p(x + 1, y + 1), p(x, y + 1)])).fill((x + y) % 2 ? 0x6cbf47 : 0x74c74e);
  const r = rng(17);
  for (let i = 0; i < 260; i++) {
    const x = X0 + r() * (X1 - X0), y = Y0 + r() * (Y1 - Y0);
    const [a, b] = p(x, y);
    for (const dx of [-5, 0, 5]) g.moveTo(a + dx * 0.4, b).lineTo(a + dx, b - 9 - Math.abs(dx) * 0.6);
  }
  g.stroke({ width: 2.2, color: 0x3f8a2c, cap: 'round' });
  // Three roads from the crossroads: to the hall with the dome (along x), to the gold domes (along y), to the tower (between).
  const road = (pts: P[], w: number) => {
    const L = (pts.map(([x, y]) => p(x, y)));
    g.poly(flat(L), false).stroke({ width: w + 8, color: 0x9a7a4a, join: 'round', cap: 'round' });
    g.poly(flat(L), false).stroke({ width: w, color: 0xd8c08a, join: 'round', cap: 'round' });
  };
  road([[J, J], [3.6 + N, J]], 74);
  road([[J, J], [J, 3.6 + N]], 74);
  road([[J, J], [4.6 + N, 4.6 + N]], 60);
  road([[J, J], [X1, X1]], 74);
  g.ellipse(...p(J, J), 120, 60).fill(0xd8c08a);
  for (let i = 0; i < 80; i++) { const t = r(), k = r(); const [a, b] = k < 0.33 ? p(J - t * 4.4, J + (r() - 0.5) * 0.5) : k < 0.66 ? p(J + (r() - 0.5) * 0.5, J - t * 4.4) : p(J - t * 3.4 + (r() - 0.5) * 0.3, J - t * 3.4); g.ellipse(a, b, 2.4, 1.4).fill(0xa88a5a); }

  // Ronnie's: a grey hall of columns under a dome.
  s.draw(3.6 + N + 9.4, (h) => {
    const m = { top: 0xd8d6d0, side: 0xcfccc4, dark: 0.3, hatch: 0.35 };
    box(h, ph, 0.4, 6.4, 0, 3.0, 3.2, 1.05, m);
    for (let u = 0.25; u < 3.2; u += 0.42) h.poly(flat(onX(ph, 3.4, 6.4, 0, u, u + 0.18, 0.35, 0.8))).fill(0x6a7480);
    for (let u = 0.25; u < 3.0; u += 0.42) h.poly(flat(onY(ph, 0.4, 9.6, 0, u, u + 0.18, 0.35, 0.8))).fill(0x8a94a0);
    // The portico toward the road: steps, columns, a pediment.
    for (let k = 0; k < 3; k++) box(h, ph, 3.4 + k * 0.12, 7.0 - k * 0.05, 0, 0.6 - k * 0.12, 2.0 + k * 0.1, 0.18 - k * 0.05, { top: 0xe8e6e0, side: 0xd0cec6, line: 2.4 });
    for (let k = 0; k < 6; k++) prism(h, ph, disc(3.85, 7.2 + k * 0.32, 0.075, 8), 0.18, 1.05, { top: 0xf2f0ea, side: 0xf2f0ea, dark: 0.35, line: 2.4 });
    box(h, ph, 3.4, 7.0, 1.05, 0.6, 2.1, 0.14, { top: 0xe8e6e0, side: 0xdedcd4, line: 2.6 });
    const ped: P[] = [ph(4.0, 7.0, 1.19), ph(4.0, 9.1, 1.19), ph(4.0, 8.05, 1.62)];
    h.poly(flat(ped)).fill(0xc8c6be).stroke({ width: 3, color: INK, join: 'round' });
    h.poly(flat([ph(4.0, 7.25, 1.24), ph(4.0, 8.85, 1.24), ph(4.0, 8.05, 1.52)])).stroke({ width: 1.6, color: 0x8a8a84 });
    h.poly(flat([ph(3.4, 7.0, 1.19), ph(4.0, 7.0, 1.19), ph(4.0, 8.05, 1.62), ph(3.4, 8.05, 1.62)])).fill(0xb8b6ae).stroke({ width: 2.6, color: INK, join: 'round' });
    // The drum and its dome.
    prism(h, ph, disc(1.9, 8.0, 0.95), 1.05, 1.6, { top: 0xd8d6d0, side: 0xe0ded6, dark: 0.35, hatch: 0.3, line: 3 });
    for (let k = 0; k < 10; k++) { const a = -0.2 + (k / 9) * (Math.PI / 2 + 0.4); const [a1, b1] = ph(1.9 + Math.cos(a) * 0.95, 8.0 + Math.sin(a) * 0.95, 1.12); h.moveTo(a1, b1).lineTo(a1, b1 - 30); }
    h.stroke({ width: 3, color: 0xa8a69e });
    // The dome's foot is round: it ends below on the near half of its foot's ellipse, inside the drum's top, as the lantern on
    // its crown and the lantern's roof end on theirs.
    const [dx, dy] = ph(1.9, 8.0, 1.6), R = 0.95 * T * 0.5 * 1.15, RY = R * 0.5;
    const dome = () => {
      h.moveTo(dx - R, dy).bezierCurveTo(dx - R, dy - R * 1.25, dx + R, dy - R * 1.25, dx + R, dy);
      for (const [a, b] of footCurve(dx, dy, R, RY).slice(1)) h.lineTo(a, b);
      return h.closePath();
    };
    dome().fill(0xeceae4);
    h.moveTo(dx + R * 0.2, dy - R * 0.92).bezierCurveTo(dx + R * 0.8, dy - R * 0.8, dx + R, dy - R * 0.4, dx + R, dy);
    for (const [a, b] of ellipseArc(dx, dy, R, RY, 0, Math.acos(0.4), 8).slice(1)) h.lineTo(a, b);
    h.bezierCurveTo(dx + R * 0.5, dy - R * 0.5, dx + R * 0.4, dy - R * 0.8, dx + R * 0.2, dy - R * 0.92).fill(0xc8c6be);
    for (const k of [-0.6, -0.2, 0.2, 0.6]) h.moveTo(dx + R * k, dy + footDrop(R * k, R, RY)).quadraticCurveTo(dx + R * k * 0.8, dy - R * 0.8, dx, dy - R * 0.94);
    h.stroke({ width: 2, color: 0x9a9890 });
    dome().stroke({ width: 3.2, color: INK, join: 'round' });
    const lb = dy - R * 0.94, lt = lb - 26;
    h.poly(flat([[dx - 8, lt], ...footCurve(dx, lb, 8, 4, 10).reverse(), [dx + 8, lt]])).fill(0xeceae4).stroke({ width: 2.4, color: INK, join: 'round' });
    h.poly(flat([[dx, lt - 14], ...footCurve(dx, lt, 11, 5.5, 10).reverse()])).fill(0xc8c6be).stroke({ width: 2.4, color: INK, join: 'round' });
  });

  // Gorbie's: white walls under gold onion domes.
  s.draw(9.4 + 3.6 + N, (h) => {
    const wall = { top: 0xe8e2d4, side: 0xf2ece0, dark: 0.28, hatch: 0.3 };
    box(h, pg, 6.4, 0.4, 0, 3.2, 3.0, 1.15, wall);
    for (let u = 0.3; u < 3.0; u += 0.5) { const q = onY(pg, 6.4, 3.4, 0, u, u + 0.2, 0.45, 0.85); h.poly(flat(q)).fill(0x5a6a8a); }
    for (let u = 0.3; u < 2.8; u += 0.5) { const q = onX(pg, 9.6, 0.4, 0, u, u + 0.2, 0.45, 0.85); h.poly(flat(q)).fill(0x4a5a7a); }
    h.poly(flat(onY(pg, 6.4, 3.4, 0, 1.3, 1.9, 0, 0.75))).fill(0x8a2a24).stroke({ width: 2.6, color: INK });
    h.poly(flat([pg(6.4, 3.4, 1.15), pg(9.6, 3.4, 1.15), pg(9.6, 0.4, 1.15)]), false).stroke({ width: 4, color: 0xd8322b });
    // Towers at two corners and the great drum in the middle, each with its dome.
    const tower = (x: number, y: number, rr: number, z1: number, dome: number, col: number) => {
      prism(h, pg, disc(x, y, rr, 20), 1.15, z1, { top: 0xe8e2d4, side: 0xf6f0e4, dark: 0.3, hatch: 0.25, line: 3 });
      for (let k = 0; k < 6; k++) { const a = (k / 5) * (Math.PI / 2) - 0.1; const [a1, b1] = pg(x + Math.cos(a) * rr, y + Math.sin(a) * rr, z1 - 0.15); h.rect(a1 - 2.5, b1 - 14, 5, 14).fill(0x5a6a8a); }
      const [ox, oy] = pg(x, y, z1);
      onion(h, ox, oy, dome, col);
    };
    tower(9.0, 0.95, 0.36, 2.0, 30, 0xe6b422);
    tower(6.95, 2.85, 0.36, 2.0, 30, 0xe6b422);
    tower(8.0, 1.9, 0.62, 2.55, 52, 0xf0c030);
  });

  // Olli's: the company's tower of blue glass, rounded at its corners, a mast on its roof sending out the signal.
  s.draw(4.4 + 4.4 + N * 2 + 0.3, (h) => {
    const c = 0.45, x0 = 2.0 + N, x1 = 4.4 + N, y0 = 2.0 + N, y1 = 4.4 + N, Z = 3.0, mid = 3.2 + N, MH = 90;
    const foot: P[] = [[x0 + c, y0], [x1 - c, y0], [x1, y0 + c], [x1, y1 - c], [x1 - c, y1], [x0 + c, y1], [x0, y1 - c], [x0, y0 + c]];
    prism(h, p, foot, 0, Z, { top: 0x2a4a8a, side: 0x5a9ae8, dark: 0.45, line: 3.4 });
    // Its glass in a grid of floors and mullions, the evening sun caught on one side.
    for (let z = 0.35; z < Z; z += 0.3) h.poly(flat([p(x0, y1 - c, z), p(x0 + c, y1, z), p(x1 - c, y1, z), p(x1, y1 - c, z), p(x1, y0 + c, z)]), false);
    h.stroke({ width: 1.6, color: 0x1a3a7a, alpha: 0.8 });
    for (let u = x0 + c + 0.3; u < x1 - c; u += 0.3) h.poly(flat([p(u, y1, 0), p(u, y1, Z)]), false);
    for (let u = y0 + c + 0.3; u < y1 - c; u += 0.3) h.poly(flat([p(x1, u, 0), p(x1, u, Z)]), false);
    h.stroke({ width: 1.2, color: 0x1a3a7a, alpha: 0.6 });
    h.poly(flat([p(x0 + c + 0.2, y1, 0.6), p(x0 + c + 0.6, y1, 0.6), p(x0 + c + 1.0, y1, Z - 0.5), p(x0 + c + 0.6, y1, Z - 0.5)])).fill({ color: 0xffffff, alpha: 0.25 });
    // The doors, at the corner facing the road. They have no canopy: Olli stands in front of them, and it showed over his head
    // alone (the owner, 13 Nov: "there is a white tile above Olli's head for seemingly no reason").
    h.poly(flat([p(x1, y1 - c, 0), p(x1 - c, y1, 0), p(x1 - c, y1, 0.55), p(x1, y1 - c, 0.55)])).fill(0x1a2a4a).stroke({ width: 2.4, color: INK });
    // Its crown, and the mast.
    prism(h, p, foot.map(([a, b]) => [a + (a < mid ? 0.25 : -0.25), b + (b < mid ? 0.25 : -0.25)] as P), Z, Z + 0.25, { top: 0x1a2a5a, side: 0x3a6ab8, dark: 0.4, line: 3 });
    const [mx, my] = p(mid, mid, Z + 0.25);
    mast(h, s.glow, mx, my, MH, 4);
    for (const [k, a] of [[1, 0.8], [1.6, 0.6], [2.2, 0.4]] as const) {
      const a0 = -Math.PI * 0.85, rr = 22 * k;
      // Each arc a path of its own: a moveTo to its first point gave that point twice, as the replay arrow's did (f5621aa).
      h.beginPath().arc(mx, my - MH - 6, rr, a0, -Math.PI * 0.15).stroke({ width: 3.4, color: 0xffffff, alpha: a });
    }
  });

  // Trees about the fields, flowers in the grass.
  const tree = (kind: 'birch' | 'spruce', x: number, y: number, hh: number, flip = false) => s.prop('border', kind, x, y, hh, { flip, shadow: hh * 0.2 });
  tree('spruce', 0.6, 3.0, 240); tree('birch', 5.2, 0.4, 220, true); tree('spruce', 11.2, 2.6, 260); tree('birch', 2.4, 11.4, 260);
  tree('birch', 11.6, 6.0, 260, true); tree('spruce', 5.4, 11.8, 280); tree('birch', 0.2, 5.0, 210);
  const flowers = ['flower_poppy', 'flower_white', 'flower_yellow', 'flower_cornflower', 'flower_daisy', 'flower_marigold', 'flower_cosmos', 'flower_lupine'];
  const fr = rng(23);
  for (let i = 0; i < 40; i++) {
    const x = 1 + fr() * 12, y = 1 + fr() * 12;
    const onRoad = (Math.abs(x - J) < 2.6 && Math.abs(y - J) < 2.6) || Math.abs(y - J) < 0.7 && x < J + 0.5 || Math.abs(x - J) < 0.7 && y < J + 0.5 || Math.abs(x - y) < 0.7 || (x < 4.2 + N && y > 6 && y < 10) || (y < 4 + N && x > 6 && x < 10) || (x < 5 + N && y < 5 + N);
    if (onRoad) continue;
    s.prop('border', flowers[i % flowers.length]!, x, y, 28 + fr() * 8);
  }

  // The signpost at the crossroads, an arm along each road, painted in its traveller's colours.
  s.draw(J + J + 1.6, (sp) => {
    const PX = J + 0.85, PY = J + 0.85;
    box(sp, p, PX - 0.06, PY - 0.06, 0, 0.12, 0.12, 1.75, { top: 0x8a5a2a, side: 0x7a4e24, line: 2.6 });
    const arm = (to: P, z: number, colors: number[], stripes: 'h' | 'v') => {
      const at = (t: number, v: number): P => p(PX + to[0] * t, PY + to[1] * t, z + v);
      const L = 0.72;
      const outline: P[] = [at(0.05, 0), at(L, 0), at(L + 0.18, 0.11), at(L, 0.22), at(0.05, 0.22)];
      sp.poly(flat(outline)).fill(colors[0]!);
      if (stripes === 'h') colors.forEach((c, i) => sp.poly(flat([at(0.05, (i * 0.22) / colors.length), at(L + 0.18 * (1 - Math.abs(((i + 0.5) / colors.length) * 2 - 1)), (i * 0.22) / colors.length), at(L + 0.18 * (1 - Math.abs(((i + 0.5) / colors.length) * 2 - 1)), ((i + 1) * 0.22) / colors.length), at(0.05, ((i + 1) * 0.22) / colors.length)])).fill(c));
      else {
        for (let k = 0; k < 7; k++) sp.poly(flat([at(0.05, (k * 0.22) / 7), at(L, (k * 0.22) / 7), at(L, ((k + 1) * 0.22) / 7), at(0.05, ((k + 1) * 0.22) / 7)])).fill(k % 2 ? 0xf6f2ea : 0xc8302a);
        sp.poly(flat([at(0.05, 0.1), at(0.42, 0.1), at(0.42, 0.22), at(0.05, 0.22)])).fill(0x2a3a7a);
      }
      sp.poly(flat(outline)).stroke({ width: 2.6, color: INK, join: 'round' });
    };
    arm([-1, 0], 1.45, [], 'v');
    arm([0, -1], 1.18, [0xd8322b, 0x2a52b8, 0xf6f2ea], 'h');
    arm([-0.72, -0.72], 0.92, [0xf6f2ea, 0x2a62c8, 0xf6f2ea], 'h');
    sp.circle(...p(PX, PY, 1.78), 6).fill(0x8a5a2a).stroke({ width: 2.4, color: INK });
  });

  // The three, each a few steps down their own road: Ronnie to the hall, Gorbie to the domes, Olli to the tower.
  // Drawn over the hall and the domes behind them, whose depth (their far corners) would otherwise put them in front.
  s.figure('ronnie', 6.0, J, 46, { facing: 'left', mouth: 0.45 }, { depth: 14.5 });
  s.figure('gorbie', J, 6.0, 46, { facing: 'right', mouth: 0.4 }, { depth: 14.5 });
  s.figure('olli', 6.3, 6.3, 46, { facing: 'right', mouth: 0.4 });
  s.draw(60, (d) => {
    for (const [x, y, dir] of [[6.0, J, 1], [J, 6.0, -1], [6.3, 6.3, -1]] as const) {
      const [a, b] = p(x, y);
      for (let k = 0; k < 3; k++) d.circle(a + dir * (52 + k * 14), b - 6 - k * 3, 7 - k * 1.8).fill({ color: 0xe8dcc0, alpha: 0.85 }).stroke({ width: 1.6, color: INK, alpha: 0.6 });
    }
  });
};

/**
 * A chunk of broken concrete lying at `q`, about `r` across: one solid lump, its rough top lit and its sides darker, inked
 * round its whole outline (the owner, 13 Nov, on the rescue: "please clean up those wires, the look a little odd at low
 * resolutions"; the rebar bent out of the chunks and the Wall's broken ends went, and the chunks were pale outlines).
 */
function chunk(g: Graphics, q: P, r: number, seed: number): void {
  const rr = rng(seed), [x, y] = q;
  const n = 6, top: P[] = [], base: P[] = [];
  for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2 + rr() * 0.5, k = r * (0.7 + rr() * 0.4); top.push([x + Math.cos(a) * k, y - r * 0.55 + Math.sin(a) * k * 0.5]); base.push([x + Math.cos(a) * k, y + Math.sin(a) * k * 0.5]); }
  const outline = hull([...base, ...top]);
  g.poly(flat(outline)).fill(0x86827a);
  g.poly(flat(top)).fill(0xbdb9ae).stroke({ width: 1.6, color: INK, alpha: 0.8, join: 'round' });
  g.poly(flat(outline)).stroke({ width: 2.8, color: INK, join: 'round' });
}

/** An ambulance standing along y from (x, y), its cab at the far end and its back doors open toward us, blue lights on. */
function ambulance(s: Stage, x: number, y: number, depth: number): void {
  const p = s.p, L = 2.75, Wd = 1.15, Z0 = 0.24;
  s.soft(...p(x + Wd / 2 + 0.3, y + L / 2 + 0.3), 150, 52, 0.9);
  s.draw(depth, (g) => {
    const white = { top: 0xf2f2ee, side: 0xf6f6f2, dark: 0.22, line: 3.2 };
    // The cab, lower, and the box behind it.
    box(g, p, x + 0.04, y, Z0, Wd - 0.08, 0.9, 0.72, white);
    g.poly(flat(onX(p, x + Wd - 0.04, y, Z0, 0.12, 0.7, 0.36, 0.66))).fill(0x6a8aa8).stroke({ width: 2, color: INK });
    g.poly(flat(onX(p, x + Wd - 0.04, y, Z0, 0.18, 0.4, 0.4, 0.62))).fill({ color: 0xffffff, alpha: 0.35 });
    box(g, p, x, y + 0.82, Z0, Wd, L - 0.82, 1.0, white);
    // The band round it, and a blue square with a white star of six on its side.
    g.poly(flat(onX(p, x + Wd, y + 0.82, Z0, 0, L - 0.82, 0.36, 0.5))).fill(0xe8542a);
    g.poly(flat(onX(p, x + Wd - 0.04, y, Z0, 0, 0.82, 0.3, 0.42))).fill(0xe8542a);
    g.poly(flat(onY(p, x, y + L, Z0, 0, Wd, 0.36, 0.5))).fill(0xe8542a);
    const [sx, sy] = p(x + Wd, y + 1.85, Z0 + 0.72);
    g.poly(flat([[sx - 12, sy - 6], [sx + 10, sy - 17], [sx + 10, sy + 6], [sx - 12, sy + 17]])).fill(0x2a5ab8).stroke({ width: 1.8, color: INK });
    for (let k = 0; k < 3; k++) { const a = (k / 3) * Math.PI; g.moveTo(sx - Math.cos(a) * 8, sy - Math.sin(a) * 8 + 2).lineTo(sx + Math.cos(a) * 8, sy + Math.sin(a) * 8 - 2); }
    g.stroke({ width: 3, color: 0xffffff, cap: 'round' });
    // Wheels.
    for (const v of [0.45, 2.2]) {
      const [a, b] = p(x + Wd, y + v, 0.22);
      g.ellipse(a, b, 13, 19).fill(0x1e1e22).stroke({ width: 2.4, color: INK });
      g.ellipse(a + 1, b, 6, 9).fill(0x8a8a90);
    }
    // Inside, through the open back: a dark hold, a cot on its floor.
    g.poly(flat(onY(p, x, y + L, Z0, 0.08, Wd - 0.08, 0.06, 0.94))).fill(0x2a2e36).stroke({ width: 2.6, color: INK });
    g.poly(flat(onY(p, x, y + L - 0.6, Z0, 0.25, Wd - 0.25, 0.12, 0.32))).fill(0xb8c0c8).stroke({ width: 1.6, color: INK });
    g.poly(flat([p(x + 0.1, y + L, Z0 + 0.06), p(x + Wd - 0.1, y + L, Z0 + 0.06), p(x + Wd - 0.1, y + L - 0.9, Z0 + 0.06), p(x + 0.1, y + L - 0.9, Z0 + 0.06)])).fill({ color: 0x6a7480, alpha: 0.6 });
    // The doors swung open either side.
    for (const [hx, ox] of [[x, -0.42], [x + Wd, 0.42]] as const) {
      const A: P = [hx, y + L], B: P = [hx + ox, y + L + 0.38];
      const door: P[] = [p(A[0], A[1], Z0 + 0.04), p(B[0], B[1], Z0 + 0.04), p(B[0], B[1], Z0 + 0.96), p(A[0], A[1], Z0 + 0.96)];
      g.poly(flat(door)).fill(ox < 0 ? 0xe8e8e2 : 0xd0d0ca).stroke({ width: 2.8, color: INK, join: 'round' });
      const at = (u: number, v: number): P => p(A[0] + (B[0] - A[0]) * u, A[1] + (B[1] - A[1]) * u, Z0 + v);
      g.poly(flat([at(0.2, 0.6), at(0.8, 0.6), at(0.8, 0.86), at(0.2, 0.86)])).fill(0x4a5a6a).stroke({ width: 1.6, color: INK });
      g.poly(flat([at(0, 0.36), at(1, 0.36), at(1, 0.5), at(0, 0.5)])).fill(0xe8542a);
    }
    // Blue lights on the roof, flashing.
    for (const [lx, ly, lz] of [[x + 0.2, y + 0.2, Z0 + 0.72], [x + Wd - 0.3, y + 0.2, Z0 + 0.72], [x + 0.1, y + L - 0.15, Z0 + 1.0], [x + Wd - 0.2, y + L - 0.15, Z0 + 1.0]] as const) {
      box(g, p, lx, ly, lz, 0.12, 0.12, 0.1, { top: 0x8ab8ff, side: 0x2a5ae8, line: 2 });
      const [a, b] = p(lx + 0.06, ly + 0.06, lz + 0.1);
      s.halo(a, b - 4, 22, 0x3a7aff, 0.45, s.glow);
    }
  });
}

/**
 * 10. The rescue, after an unprepared defeat by the Warsaw Pac: by the Wall's broken stretch, students carrying the knocked-out
 * trio on stretchers to two ambulances, to take them back to Beijing. The Wall is the map's own painted panels.
 */
const studentsRescue = (s: Stage): void => {
  const p = s.p;
  const g = s.ground;
  const X0 = -6, X1 = 18, Y0 = -12, Y1 = 12, WY = 0, WH = 1.3;
  // The far side: the sand of the strip, a patrol track; the near side: a pavement along the Wall, then the street.
  g.poly(flat([p(X0, Y0), p(X1, Y0), p(X1, WY), p(X0, WY)])).fill(0xd6c8a2);
  g.poly(flat([p(X0, -2.6), p(X1, -2.6), p(X1, -1.9), p(X0, -1.9)])).fill(0xb8a888);
  for (let x = X0; x < X1; x += 0.5) for (let y = WY; y < 1.4; y += 0.5) g.poly(flat([p(x, y), p(x + 0.5, y), p(x + 0.5, y + 0.5), p(x, y + 0.5)])).fill(0xc2c0b8).stroke({ width: 1.3, color: 0x8e8c84 });
  g.poly(flat([p(X0, 1.4), p(X1, 1.4), p(X1, Y1), p(X0, Y1)])).fill(0x5a5a62);
  g.poly(flat([p(X0, 1.4, 0.02), p(X1, 1.4, 0.02)]), false).stroke({ width: 6, color: 0xd8d6ce });
  for (let x = X0; x < X1; x += 1.2) g.poly(flat([p(x, 6.2), p(x + 0.6, 6.2), p(x + 0.6, 6.32), p(x, 6.32)])).fill(0xe8e4d8);
  const ar = rng(8);
  for (let i = 0; i < 160; i++) { const [a, b] = p(X0 + ar() * (X1 - X0), 1.5 + ar() * (Y1 - 1.5)); g.circle(a, b, 1.2).fill({ color: 0x8a8a92, alpha: 0.6 }); }

  // Beyond the Wall: a watchtower and the grey blocks of the east.
  s.draw(-30, (e) => {
    const grey = { top: 0x9a9c9e, side: 0xb4b6b8, dark: 0.28, hatch: 0.3 };
    for (const [bx, by, bw, bd, bh] of [[-3, -7.5, 3.2, 1.6, 3.2], [1.4, -7.2, 4, 1.6, 2.6], [7.4, -7.5, 3.2, 1.6, 3.4], [12, -7.2, 3.6, 1.6, 2.8]] as const) {
      box(e, p, bx, by, 0, bw, bd, bh, grey);
      for (let u = 0.2; u < bw - 0.1; u += 0.4) for (let v = 0.3; v < bh - 0.2; v += 0.36) e.poly(flat(onY(p, bx, by + bd, 0, u, u + 0.2, v, v + 0.18))).fill(0x6a7078);
    }
    const [wx, wy] = [3.4, -3.4];
    box(e, p, wx, wy, 0, 0.6, 0.6, 2.3, { top: 0xb8b6b0, side: 0xc8c6c0, hatch: 0.35 });
    box(e, p, wx - 0.25, wy - 0.25, 2.3, 1.1, 1.1, 0.55, { top: 0x8a8c8e, side: 0xc8c6c0, hatch: 0.35 });
    e.poly(flat(onY(p, wx - 0.25, wy + 0.85, 2.3, 0.12, 0.98, 0.18, 0.42))).fill(0x3a4048);
    e.poly(flat(onX(p, wx + 0.85, wy - 0.25, 2.3, 0.12, 0.98, 0.18, 0.42))).fill(0x2a3038);
    box(e, p, wx + 0.15, wy + 0.15, 2.85, 0.3, 0.3, 0.14, { top: 0x6a6c6e, side: 0x8a8c8e, line: 2.4 });
  });

  // The Wall: concrete slabs under a round coping, painted on this side; blown out in the middle, rubble spilled over the pavement.
  const tex = art('scenery/berlin/wall/panels');
  const LEN = 7.8, A0 = -2.4, GAP0 = A0 + LEN, GAP1 = GAP0 + 1.9;
  const segment = (x0: number) => {
    s.draw(-5, (w) => box(w, p, x0, WY - 0.25, 0, LEN, 0.25, WH, { top: 0xb8b6ae, side: 0xc4c2ba, dark: 0.3, hatch: 0.3 }));
    if (tex) {
      const sp = new Sprite(tex);
      const [tx0, ty0] = p(x0, WY, WH), [ex, ey] = [(LEN * T) / 2, (LEN * T) / 4];
      sp.setFromMatrix(new Matrix(ex / tex.width, ey / tex.width, 0, (WH * ZU) / tex.height, tx0, ty0));
      s.put(-5, sp);
    }
    s.draw(-5, (w) => {
      const pipe = [p(x0, WY - 0.12, WH + 0.06), p(x0 + LEN, WY - 0.12, WH + 0.06)];
      w.poly(flat(pipe), false).stroke({ width: 16, color: INK, cap: 'round' });
      w.poly(flat(pipe), false).stroke({ width: 11, color: 0xd8d6ce, cap: 'round' });
      w.poly(flat(pipe.map(([a, b]) => [a, b - 3] as P)), false).stroke({ width: 3, color: 0xf2f0ea, cap: 'round' });
      w.poly(flat(onY(p, x0, WY, 0, 0, LEN, 0, WH))).stroke({ width: 3, color: INK });
    });
  };
  segment(A0);
  segment(GAP1);
  // The broken ends of the gap: jagged concrete.
  s.draw(-4.9, (w) => {
    const jag = (x: number, dir: number, seed: number) => {
      const rr = rng(seed), pts: P[] = [p(x, WY, 0)];
      for (let v = 0; v <= WH; v += 0.18) pts.push(p(x + dir * (0.05 + rr() * 0.28), WY, Math.min(WH, v)));
      pts.push(p(x, WY, WH + 0.1));
      w.poly(flat(pts)).fill(0xa8a69e).stroke({ width: 2.6, color: INK, join: 'round' });
    };
    jag(GAP0, 1, 3);
    jag(GAP1, -1, 7);
  });
  // Rubble in the gap and over the pavement, a few chunks out into the street.
  for (const [x, y, r, seed] of [[GAP0 + 0.3, 0.1, 30, 1], [GAP0 + 0.9, -0.05, 38, 2], [GAP0 + 1.5, 0.15, 28, 3], [GAP0 + 0.6, 0.7, 24, 4], [GAP0 + 1.2, 0.9, 20, 5], [GAP0 + 1.9, 0.6, 22, 6], [GAP0 - 0.3, 0.9, 16, 7], [GAP0 + 0.4, 1.5, 14, 8], [GAP0 + 2.4, 1.3, 15, 9]] as const) {
    s.draw(x + y + 0.3, (c) => chunk(c, p(x, y), r, seed));
  }
  // A street lamp along the pavement.
  s.draw(1.5 + 1.0, (l) => {
    const [x, y] = p(1.5, 1.0);
    l.moveTo(x, y).lineTo(x, y - 200).quadraticCurveTo(x, y - 214, x + 20, y - 214).lineTo(x + 34, y - 214).stroke({ width: 5, color: 0x3a4a48, cap: 'round' });
    l.ellipse(x + 38, y - 210, 14, 6).fill(0xf6f0d8).stroke({ width: 2.4, color: INK });
    s.soft(x, y, 18, 6);
  });

  // The ambulances in the street side by side, backs open toward us.
  ambulance(s, 8.4, 1.75, 8.4 + 1.75 + 2.0);
  ambulance(s, 10.6, 1.75, 10.6 + 1.75 + 2.0);

  // The stretchers, a student at each end, each in their own colours as Beijing's map dresses them, a knocked-out member on
  // each, seeing stars. Olli's is going in first.
  const stretcher = (cx: number, cy: number, who: LookId, toward: -1 | 1, looks: [LookId, LookId]) => {
    const facing = toward < 0 ? 'right' : 'left';
    s.figure(townsperson(looks[0], `rescue_${who}_front`), cx, cy + toward * 0.95, 38, { facing, mouth: 0.6 }, { shadow: 1.1 });
    s.figure(townsperson(looks[1], `rescue_${who}_back`), cx, cy - toward * 0.95, 38, { facing, mouth: 0.4 }, { shadow: 1.1 });
    s.draw(cx + cy, (t) => {
      s.soft(...p(cx, cy), 46, 18);
      for (const dx of [-0.3, 0.3]) t.poly(flat([p(cx + dx, cy - 1.0, 0.44), p(cx + dx, cy + 1.0, 0.44)]), false).stroke({ width: 6, color: INK, cap: 'round' }).stroke({ width: 3, color: 0x8a6a3a, cap: 'round' });
      box(t, p, cx - 0.28, cy - 0.7, 0.42, 0.56, 1.4, 0.05, { top: 0xb9c98a, side: 0x8fa060, line: 2.6 });
    });
    const f = s.figure(who, cx, cy, 38, { facing: 'right', ko: true }, { z: 0.47, depth: cx + cy + 0.05, shadow: 0 });
    s.draw(cx + cy + 0.06, (st) => dizzy(st, f.x, f.y - 48, 24));
  };
  stretcher(8.975, 6.35, 'olli', -1, ['student', 'guide_student']);
  stretcher(11.175, 5.9, 'ronnie', -1, ['guide_student', 'student']);
  stretcher(6.3, 2.6, 'gorbie', 1, ['student', 'student']);
  // One more, by the far van, waving them on.
  s.figure(townsperson('guide_student', 'rescue_waving'), 12.3, 3.0, 38, { facing: 'left', mouth: 0.9 }, { shadow: 1.1 });
};

const SCENES: Record<string, IsoScene> = {
  house_gearup: { origin: [640, 300], bg: 0x05040a, focus: [745, 520, 2.55], shadow: 0.7, build: houseGearup },
  maze_ghostbusting: { origin: [700, 120], bg: 0x05060f, focus: [669, 465, 2.03], shadow: 0.6, build: mazeGhostbusting },
  bridge_crossing: { origin: [620, 200], bg: 0x05060f, focus: [838, 500, 1.8], build: bridgeCrossing },
  temple_students: { origin: [560, 150], bg: 0x3f8fd4, focus: [760, 495, 1.83], shadow: 0.42, build: templeStudents },
  inferno: { origin: [640, 380], bg: 0x120403, focus: [1100, 460, 2.0], keep: [512, 130, 1500, 700], shadow: 0.6, build: pacDevil },
  ceo: { origin: [640, 300], bg: 0x120c08, focus: [818, 440, 2.08], shadow: 0.5, build: ceoOffice },
  fireside: { origin: [700, 260], bg: 0x100a06, focus: [745, 335, 2.51], shadow: 0.55, build: firesideChat },
  separate_ways: { origin: [768, 150], bg: 0xa8d8f0, focus: [768, 385, 1.65], shadow: 0.4, build: separateWays },
  warsaw_rescue: { origin: [420, 160], bg: 0xc8d2da, focus: [760, 500, 2.2], keep: [470, 282, 1045, 762], shadow: 0.45, build: studentsRescue },
};

/** Whether a picture is one of these isometric scenes. */
export const isIsoScene = (name: string): boolean => name in SCENES;

/** The scene called `name`, filling a `w` by `h` photo. */
export function buildIsoScene(name: string, w: number, h: number): { view: Container; destroy(): void } | null {
  const sc = SCENES[name];
  if (!sc) return null;
  const stage = new Stage(sc.origin[0], sc.origin[1], sc.bg, sc.shadow);
  sc.build(stage);
  const view = new Container({ label: 'iso_scene' });
  view.addChild(stage.root);
  // Cover the photo's box, as a picture would, zoomed about the focus.
  const [fx, fy, zoom] = sc.focus;
  let k = Math.max(w / W, h / H) * zoom, cx = fx, cy = fy;
  if (sc.keep) {
    const [x0, y0, x1, y1] = sc.keep;
    k = Math.min(k, w / (x1 - x0), h / (y1 - y0));
    const hw = w / 2 / k, hh = h / 2 / k;
    cx = Math.min(Math.max(cx, x1 - hw), x0 + hw);
    cy = Math.min(Math.max(cy, y1 - hh), y0 + hh);
  }
  stage.root.scale.set(k);
  stage.root.position.set(w / 2 - cx * k, h / 2 - cy * k);
  return { view, destroy: () => view.destroy({ children: true, context: true }) };
}
