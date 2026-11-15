import { Container, Graphics } from 'pixi.js';
import { EASE, motion } from '../render/motion.ts';
import { BOX, HEAL, INK, PAPER, POP_CYAN, POP_PINK, POP_YELLOW } from '../render/palette.ts';
import { anim } from './anim.ts';
import { TravellingBand } from './target_band.ts';
import { bandWave, frameMotion } from './target_motion.ts';

export type TargetRect = { x: number; y: number; w: number; h: number };
type Point = [number, number];
export const mix = (a: number, b: number, t: number) => [16, 8, 0].reduce((n, s) => n | (Math.round(((a >> s) & 255) * (1 - t) + ((b >> s) & 255) * t) << s), 0);
export const targetCardFill = () => mix(BOX, POP_YELLOW, .22);

export function decorateTargetCard(g: Graphics, r: TargetRect, u: number): void {
  for (let y = r.y + u * .35; y < r.y + r.h - u * .15; y += u * .5) {
    for (let x = r.x + u * .25; x < r.x + r.w - u * .15; x += u * .5) g.circle(x, y, u * .075).fill({ color: POP_YELLOW, alpha: .35 });
  }
}

export function targetGain(g: Graphics, r: TargetRect, from: number, to: number, max: number, u: number): void {
  const a = Math.max(0, from) / Math.max(1, max), b = Math.min(1, to / Math.max(1, max));
  if (b <= a) return;
  const x = r.x + r.w * a, w = r.w * (b - a), line = Math.max(1, u * .06);
  g.rect(x, r.y, w, r.h).fill({ color: HEAL, alpha: .35 }).stroke({ width: line * 3, color: PAPER });
  g.rect(x, r.y, w, r.h).stroke({ width: line, color: HEAL });
}

/**
 * An enemy's brackets on the field, in the motion of the member cards' target box and on its clock: they pop as they land and
 * breathe, a soft glow pulses behind them, and two colours travel round the four corners as its band travels round a card.
 */
export function fieldBrackets(g: Graphics, r: TargetRect, len: number, width: number, age: number, reduced: boolean, ink: number, lit: number, under: number): void {
  const a = frameMotion(age, reduced);
  const k = (reduced ? 1 : 1 - .035 * (1 - EASE.pop(Math.min(1, age / .15)))) + a.breath;
  const w = r.w * k, h = r.h * k, x = r.x + (r.w - w) / 2, y = r.y + (r.h - h) / 2;
  const l = Math.min(len, w / 2, h / 2);
  const round = 2 * (w + h);
  // Each corner, clockwise, as how far round the box it starts and the three points of its two arms.
  const corners: Array<[number, Point, Point, Point]> = [
    [round - l, [x, y + l], [x, y], [x + l, y]],
    [w - l, [x + w - l, y], [x + w, y], [x + w, y + l]],
    [w + h - l, [x + w, y + h - l], [x + w, y + h], [x + w - l, y + h]],
    [w + h + w - l, [x + l, y + h], [x, y + h], [x, y + h - l]],
  ];
  const path = () => { for (const [, p, q, s] of corners) g.moveTo(...p).lineTo(...q).lineTo(...s); };
  path();
  g.stroke({ width: width + 12, color: lit, alpha: a.glow * .45, cap: 'square', join: 'miter' });
  path();
  g.stroke({ width: width + 7, color: lit, alpha: a.glow, cap: 'square', join: 'miter' });
  path();
  g.stroke({ width: width + 3, color: under, cap: 'square', join: 'miter' });
  if (reduced) {
    path();
    g.stroke({ width, color: ink, cap: 'square', join: 'miter' });
    return;
  }
  const steps = Math.max(3, Math.ceil(l / Math.max(3, width)));
  for (const [start, p, q, s] of corners) {
    for (const [i, [from, to]] of ([[p, q], [q, s]] as Array<[Point, Point]>).entries()) {
      for (let n = 0; n < steps; n++) {
        const at = (start + l * i + l * (n + .5) / steps) / round;
        g.moveTo(from[0] + (to[0] - from[0]) * n / steps, from[1] + (to[1] - from[1]) * n / steps)
          .lineTo(from[0] + (to[0] - from[0]) * (n + 1) / steps, from[1] + (to[1] - from[1]) * (n + 1) / steps)
          .stroke({ width, color: mix(ink, lit, bandWave(at, a.phase)), cap: 'square' });
      }
    }
  }
}

/** Four separate outlined corners over a continuous travelling band. */
export class TargetBox {
  readonly container = new Container();
  /** The glow's two strokes, outer then inner, each its own layer so its strength is the layer's alpha and not a redraw. */
  private readonly glowOuter = new Graphics();
  private readonly glowInner = new Graphics();
  private readonly ink = new Graphics();
  private readonly band = new TravellingBand('target_band');
  private readonly cornerInk = new Graphics();
  private readonly corners = new Graphics();
  private rect: TargetRect | null = null;
  private unit = 13;
  private started = 0;
  /** The motion used by the current drawing. */
  animation = frameMotion(0, true);

  constructor() {
    this.container.eventMode = 'none';
    this.glowOuter.label = 'target_glow_outer'; this.glowInner.label = 'target_glow_inner'; this.ink.label = 'target_ink'; this.cornerInk.label = 'target_corner_ink'; this.corners.label = 'target_corners';
    this.container.addChild(this.glowOuter, this.glowInner, this.ink, this.band.view, this.cornerInk, this.corners);
    this.container.visible = false;
    anim.loop(this, this.container, time => this.draw(time));
  }

  show(rect: TargetRect | null, unit = this.unit): void {
    if (rect && (!this.rect || rect.x !== this.rect.x || rect.y !== this.rect.y || rect.w !== this.rect.w || rect.h !== this.rect.h)) this.started = anim.clock;
    this.rect = rect;
    this.unit = unit;
    this.container.visible = !!rect;
    this.draw(anim.clock);
  }

  private draw(time: number): void {
    const r = this.rect;
    if (!r) return;
    const u = this.unit, reduced = motion.reduced, age = Math.max(0, time - this.started);
    const a = this.animation = frameMotion(age, reduced);
    const land = reduced ? 1 : EASE.pop(Math.min(1, age / .15));
    this.container.position.set(r.x + r.w / 2, r.y + r.h / 2);
    this.container.scale.set(1 - .035 * (1 - land) + a.breath);
    this.container.rotation = reduced ? 0 : -.022 * (1 - EASE.out(Math.min(1, age / .15)));
    const x = -r.w / 2, y = -r.h / 2, w = r.w, h = r.h;
    const weight = Math.max(4, u * .30), cornerWeight = weight * 1.7, half = (cornerWeight + 3) / 2;
    // A Graphics drawn again makes Pixi rebuild the whole stage's draw list. What depends only on the card's size and the unit (the
    // glow's shape, the ink, the corners' shape) is drawn when they change, with its strength as the layer's alpha and the corners'
    // colour as a tint; the band, which depends on the phase too, is drawn again when that moves.
    const shape = this.shapeFor, still = shape.w === w && shape.h === h && shape.unit === u;
    if (!still) {
      shape.w = w; shape.h = h; shape.unit = u;
      // Include square stroke ends: even a short card retains a gap on every side.
      const lx = Math.max(0, Math.min(u * 2.3, w * .30 - half));
      const ly = Math.max(0, Math.min(u * 2.3, h * .30 - half));
      const paths: Point[][] = [[[x, y + ly], [x, y], [x + lx, y]], [[x + w - lx, y], [x + w, y], [x + w, y + ly]], [[x + w, y + h - ly], [x + w, y + h], [x + w - lx, y + h]], [[x + lx, y + h], [x, y + h], [x, y + h - ly]]];
      const trace = (g: Graphics) => {
        for (const line of paths) { g.moveTo(...line[0]!); for (const point of line.slice(1)) g.lineTo(...point); }
        return g;
      };
      trace(this.glowOuter.clear()).stroke({ width: weight + 12, color: POP_CYAN, cap: 'square', join: 'miter' });
      trace(this.glowInner.clear()).stroke({ width: weight + 7, color: POP_CYAN, cap: 'square', join: 'miter' });
      this.ink.clear().rect(x, y, w, h).stroke({ width: weight + 2, color: INK, join: 'miter' });
      trace(this.cornerInk.clear()).stroke({ width: cornerWeight + 3, color: INK, cap: 'square', join: 'miter' });
      trace(this.corners.clear()).stroke({ width: cornerWeight, color: 0xffffff, cap: 'square', join: 'miter' });
    }
    this.glowOuter.alpha = a.glow * .45;
    this.glowInner.alpha = a.glow;
    this.corners.tint = mix(POP_YELLOW, 0xffffff, a.corner);
    // The band is a Mesh made once per size whose per-stroke colours are rewritten when the phase moves. It leans on Pixi's
    // tessellator beyond the ordinary drawing API: read docs/pixi_dependencies.md and src/render/stroke_mesh.ts, and the tests in
    // tests/stroke_mesh.test.ts, before changing it or upgrading pixi.js.
    this.band.draw(x, y, w, h, weight, a.phase, at => mix(POP_YELLOW, POP_PINK, bandWave(at, a.phase)));
  }
  /** What the glow, ink and corners were last drawn for. Compared exactly. */
  private shapeFor = { w: NaN, h: NaN, unit: NaN };
}
