import { Container, Graphics, Text } from 'pixi.js';
import { FONT } from '../render/fonts.ts';
import { INK, PAPER, POP_CYAN, POP_PINK, POP_YELLOW } from '../render/palette.ts';
import { EASE, motion } from '../render/motion.ts';
import { letterStyle, measures } from './print.ts';

/** One round of the drawn phone's turn, in seconds: lying still, turning upright, standing, fading to start again. */
const ROUND_S = 2.4;

/**
 * The game paused while a phone is held sideways: the screen dimmed nearly black, Paused in poster
 * capitals, the line asking to turn the phone, and a drawn phone lying the way the real one is held,
 * turning upright, over and over. It is drawn square to the screen, not turned with the game, so it
 * reads the way the phone is held, and it takes every tap, so nothing under it is pressed. With Reduce
 * motion the phone stands upright and still beside the arrow.
 */
export class SidewaysCard {
  readonly container = new Container();
  private readonly title: string;
  private readonly hint: string;
  private phone: Container | null = null;
  /** The drawn phone's turn as it starts each round: the way the real one is held. */
  private from = 0;
  /** How long the card has shown, in seconds, for the phone's turn and the checks. It starts past the fade in, so the phone is there at once. */
  age = 0.15;

  constructor(title: string, hint: string) {
    this.title = title;
    this.hint = hint;
    this.container.eventMode = 'static';
  }

  /** Draws the card over a canvas `w` by `h`, with the phone lying at `from` radians (the stage's turn). */
  layout(w: number, h: number, u: number, from: number): void {
    for (const c of this.container.removeChildren()) c.destroy({ children: true });
    this.from = from;
    const m = measures(u);
    const shade = new Graphics().rect(0, 0, w, h).fill({ color: INK, alpha: 0.92 });
    shade.eventMode = 'static';
    const title = new Text({ text: this.title.toUpperCase(), style: letterStyle(Math.round(Math.min(u * 3.2, h * 0.16)), POP_YELLOW, { outline: true, extrude: true }) });
    const hint = new Text({ text: this.hint, style: { fontFamily: FONT.body, fontStyle: 'italic', fontSize: Math.round(u * 1.3), fill: PAPER } });
    // The phone and the arrow round it, in a square the phone can turn in.
    const ph = Math.round(Math.min(h * 0.42, u * 8));
    const slot = Math.round(ph * 1.35);
    const gap = Math.round(u * 1.5);
    const block = Math.max(title.width, hint.width);
    const x0 = Math.round((w - (slot + gap + block)) / 2);
    const cx = x0 + slot / 2;
    const cy = Math.round(h / 2);
    const arrow = turnArrow(ph * 0.62, from, Math.max(3, m.L * 1.2));
    arrow.position.set(cx, cy);
    const phone = drawPhone(ph, u);
    phone.position.set(cx, cy);
    const th = title.height + u * 0.3 + hint.height;
    title.position.set(x0 + slot + gap, Math.round(cy - th / 2));
    hint.position.set(x0 + slot + gap, Math.round(title.y + title.height + u * 0.3));
    this.container.addChild(shade, arrow, phone, title, hint);
    this.phone = phone;
    this.pose();
  }

  /** Moves the drawn phone on by `dt` seconds. */
  update(dt: number): void {
    this.age += dt;
    this.pose();
  }

  private pose(): void {
    const p = this.phone;
    if (!p) return;
    if (motion.reduced) {
      p.rotation = 0;
      p.alpha = 1;
      return;
    }
    const t = this.age % ROUND_S;
    const k = t < 0.5 ? 0 : t < 1.2 ? EASE.smooth((t - 0.5) / 0.7) : 1;
    p.rotation = this.from * (1 - k);
    // It fades out standing, and back in lying down, to start the next round.
    p.alpha = Math.min(1, t / 0.15, (ROUND_S - t) / 0.2);
  }
}

/** A phone drawn upright about its middle: an ink body with a paper edge, a cyan screen, a speaker slot at the top, a button at the foot. */
function drawPhone(ph: number, u: number): Container {
  const m = measures(u);
  const pw = Math.round(ph * 0.56);
  const g = new Graphics();
  const r = pw * 0.18;
  g.roundRect(-pw / 2 + m.S, -ph / 2 + m.S, pw, ph, r).fill(POP_PINK);
  g.roundRect(-pw / 2, -ph / 2, pw, ph, r).fill(INK).stroke({ width: Math.max(2, m.L), color: PAPER });
  g.rect(-pw * 0.38, -ph * 0.38, pw * 0.76, ph * 0.72).fill(POP_CYAN);
  g.roundRect(-pw * 0.15, -ph * 0.46, pw * 0.3, Math.max(2, ph * 0.025), ph * 0.0125).fill(PAPER);
  g.circle(0, ph * 0.43, Math.max(2, pw * 0.07)).fill(PAPER);
  const c = new Container();
  c.addChild(g);
  return c;
}

/** A yellow arrow round the phone, from where its top points when lying at `from` to straight up, the way to turn it. */
function turnArrow(r: number, from: number, width: number): Graphics {
  const g = new Graphics();
  const a0 = from - Math.PI / 2;
  const a1 = -Math.PI / 2;
  const dir = Math.sign(a1 - a0) || 1;
  const start = a0 + dir * 0.25;
  const end = a1 - dir * 0.2;
  g.arc(0, 0, r, start, end, dir < 0).stroke({ width, color: POP_YELLOW, cap: 'round' });
  // The head, pointing on round the way it turns.
  const hs = width * 3.2;
  const [px, py] = [r * Math.cos(end), r * Math.sin(end)];
  const [tx, ty] = [-Math.sin(end) * dir, Math.cos(end) * dir];
  const [nx, ny] = [Math.cos(end), Math.sin(end)];
  g.poly([px + tx * hs, py + ty * hs, px + nx * hs * 0.6, py + ny * hs * 0.6, px - nx * hs * 0.6, py - ny * hs * 0.6]).fill(POP_YELLOW);
  return g;
}
