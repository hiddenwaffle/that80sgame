import { Container, Graphics } from 'pixi.js';
import { onBeat } from '../render/motion.ts';
import { anim } from './anim.ts';
import { INK, POP_CYAN } from '../render/palette.ts';

/**
 * The mark over whoever the party can talk to, or whatever it can use, from where the
 * leader stands: a small speech balloon with three dots, so the player knows before
 * pressing that Confirm or a tap will do something. It is only a drawing; a tap on it
 * goes to the map like any other tap, which treats it as a tap on its target.
 */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Where the mark's balloon is drawn, in panel coordinates, pointing down at `anchor` and kept inside the panel. */
export function markRect(anchor: [number, number], unit: number, panel: { w: number; h: number }): Rect {
  const w = Math.round(unit * 2.2);
  const h = Math.round(unit * 1.3);
  const tail = unit * 0.6;
  const x = Math.max(unit * 0.3, Math.min(panel.w - w - unit * 0.3, anchor[0] - w / 2));
  const y = Math.max(unit * 0.3, Math.min(panel.h - h - unit * 0.3, anchor[1] - tail - h));
  return { x: Math.round(x), y: Math.round(y), w, h };
}

/** Whether a panel point is on the mark, with a little to spare for a finger. */
export function onMark(r: Rect, px: number, py: number, unit: number): boolean {
  const m = unit * 0.5;
  return px > r.x - m && px < r.x + r.w + m && py > r.y - m && py < r.y + r.h + m;
}

export class TalkMark {
  readonly container = new Container();
  private readonly g = new Graphics();
  private unit = 0;
  /** Where it was last drawn, for the browser checks. */
  rect: Rect | null = null;

  constructor() {
    this.container.addChild(this.g);
    this.container.visible = false;
  }

  /** Shows the mark pointing at `anchor`, or hides it when there is nothing to point at. */
  update(anchor: [number, number] | null, unit: number, panel: { w: number; h: number }): void {
    if (!anchor) {
      this.container.visible = false;
      this.rect = null;
      return;
    }
    if (unit !== this.unit) this.draw(unit);
    const r = markRect(anchor, unit, panel);
    this.rect = r;
    // A hop on every other beat of 120 to the minute, in time with the cursor's glove (the stepper's clock), still with reduced motion.
    const bob = -onBeat(anim.clock * 0.5) * unit * 0.3;
    this.container.position.set(r.x, r.y + bob);
    this.container.visible = true;
  }

  private draw(unit: number): void {
    this.unit = unit;
    const g = this.g;
    const w = Math.round(unit * 2.2);
    const h = Math.round(unit * 1.3);
    const tail = unit * 0.6;
    g.clear();
    const off = Math.max(2, Math.round(unit * 0.22));
    const line = Math.max(2, Math.round(unit * 0.14));
    g.roundRect(off, off, w, h, h / 2).fill(POP_CYAN);
    g.poly([w / 2 - unit * 0.35 + off, h - 1 + off, w / 2 + unit * 0.35 + off, h - 1 + off, w / 2 + off, h + tail + off]).fill(POP_CYAN);
    g.poly([w / 2 - unit * 0.35, h - 1, w / 2 + unit * 0.35, h - 1, w / 2, h + tail]).fill(0xffffff).stroke({ width: line, color: INK, join: 'round' });
    g.roundRect(0, 0, w, h, h / 2).fill(0xffffff).stroke({ width: line, color: INK });
    // Covers the tail's top edge, so the balloon and its tail read as one outline.
    g.rect(w / 2 - unit * 0.3, h - line - 0.5, unit * 0.6, line).fill(0xffffff);
    for (const k of [-1, 0, 1]) g.circle(w / 2 + k * unit * 0.52, h / 2, unit * 0.17).fill(INK);
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}
