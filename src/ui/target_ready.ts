import { Container, Graphics } from 'pixi.js';
import { INK, POP_CYAN } from '../render/palette.ts';
import { motion } from '../render/motion.ts';
import { anim } from './anim.ts';
import { mix, type TargetRect } from './target_box.ts';
import { TravellingBand } from './target_band.ts';
import { bandWave, CueClock, frameMotion } from './target_motion.ts';

type Point = [number, number];

/** A current-turn frame that holds its phase while a party target is chosen. */
export class TargetReady {
  readonly container = new Container();
  private readonly band = new TravellingBand('ready_band');
  private readonly cornerInk = new Graphics();
  private readonly corners = new Graphics();
  private readonly clock = new CueClock();
  private rect: TargetRect | null = null;
  private unit = 13;
  private paused = false;
  /** The motion used by the current drawing. */
  animation = frameMotion(0, true);

  constructor() {
    this.container.eventMode = 'none';
    this.cornerInk.label = 'ready_corner_ink'; this.corners.label = 'ready_corners';
    this.container.addChild(this.band.view, this.cornerInk, this.corners);
    this.container.visible = false;
    anim.loop(this, this.container, time => this.draw(time));
  }

  show(rect: TargetRect | null, unit: number, paused = false): void {
    this.rect = rect;
    this.unit = unit;
    this.paused = paused;
    this.container.visible = !!rect;
    this.draw(anim.clock);
  }

  /** What the corners' shape was last drawn for. Compared exactly: a stale drawing must never show. */
  private cornersFor = { w: NaN, h: NaN, unit: NaN };

  private draw(time: number): void {
    const r = this.rect;
    const age = this.clock.step(time, this.paused || !r || motion.reduced);
    if (!r) return;
    const a = this.animation = frameMotion(age, motion.reduced);
    this.container.position.set(r.x, r.y);
    const w = r.w, h = r.h, ratio = .85;
    const targetWeight = Math.max(4, this.unit * .30), weight = targetWeight * ratio;
    const blue = mix(INK, POP_CYAN, .85);
    // The band is some 430 strokes of moving colour. It is a Mesh made once per size whose per-stroke colours are rewritten when the
    // phase moves (and then not twice a step, not while paused for a party target, not under Reduce motion). It leans on Pixi's
    // tessellator beyond the ordinary drawing API: read docs/pixi_dependencies.md and src/render/stroke_mesh.ts, and the tests in
    // tests/stroke_mesh.test.ts, before changing it or upgrading pixi.js.
    this.band.draw(0, 0, w, h, weight, a.phase, at => mix(INK, blue, bandWave(at, a.phase)));
    // The corners' shape depends on the same size and unit alone; their colour moves, so they are drawn white and tinted.
    const shape = this.cornersFor;
    if (shape.w !== w || shape.h !== h || shape.unit !== this.unit) {
      shape.w = w; shape.h = h; shape.unit = this.unit;
      const cornerWeight = targetWeight * 1.7 * ratio, outline = 3 * ratio;
      const targetHalf = (targetWeight * 1.7 + 3) / 2;
      const lx = ratio * Math.max(0, Math.min(this.unit * 2.3, w * .30 - targetHalf));
      const ly = ratio * Math.max(0, Math.min(this.unit * 2.3, h * .30 - targetHalf));
      const paths: Point[][] = [[[0, ly], [0, 0], [lx, 0]], [[w - lx, 0], [w, 0], [w, ly]], [[w, h - ly], [w, h], [w - lx, h]], [[lx, h], [0, h], [0, h - ly]]];
      const trace = (g: Graphics) => {
        for (const line of paths) { g.moveTo(...line[0]!); for (const point of line.slice(1)) g.lineTo(...point); }
        return g;
      };
      trace(this.cornerInk.clear()).stroke({ width: cornerWeight + outline, color: INK, cap: 'square', join: 'miter' });
      trace(this.corners.clear()).stroke({ width: cornerWeight, color: 0xffffff, cap: 'square', join: 'miter' });
    }
    this.corners.tint = mix(blue, 0xffffff, a.corner);
  }
}
