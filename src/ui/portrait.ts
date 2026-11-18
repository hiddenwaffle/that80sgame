import { Container, Graphics, Sprite } from 'pixi.js';
import { LOOKS, type LookId } from '../art/characters.ts';
import { drawLookArt } from '../art/lookArt.ts';
import { BOX, INK } from '../render/palette.ts';
import { measures } from './print.ts';

/** How many portraits exist now, for the browser checks: each is counted when made and when destroyed. */
export const portraits = { live: 0 };

/** A portrait: the frame, and whether it shows the member knocked out. */
export interface Portrait extends Container {
  ko: boolean;
}

/** A ghost's tiny picture `high` tall, about its middle: in its own colours, or a faint shadow of itself when not `on`. */
export function ghostPicture(look: LookId, high: number, on: boolean): Container {
  const size = high / 2.05;
  const one = new Container();
  const pose = { facing: 'right', mouth: 0, t: 0, ko: false, hurt: false } as const;
  if (!drawLookArt(one, look, pose, size)) {
    const g = new Graphics();
    LOOKS[look]?.draw(g, pose, size);
    one.addChild(g);
  }
  if (!on) {
    const shadow = (k: Container) => {
      if (k instanceof Sprite) k.tint = INK;
      for (const n of k.children) shadow(n as Container);
    };
    shadow(one);
    one.alpha = 0.2;
  }
  one.eventMode = 'none';
  return one;
}

/**
 * A member's portrait for a slot `size` pixels square: a frame of box paper with a fine ink line,
 * holding the member's own figure, facing out: its art where it has some, else drawn by the figure's code. The figure is drawn once to measure it (a hat
 * makes it taller), then again at the size that fills most of the frame, centred on what was drawn.
 */
export function portrait(look: string, size: number, u: number, ko: boolean, opts: { whole?: boolean } = {}): Portrait {
  const m = measures(u);
  const c = new Container() as Portrait;
  c.ko = ko;
  c.addChild(new Graphics().rect(0, 0, size, size).fill(BOX).stroke({ width: m.l, color: INK }));
  const info = LOOKS[look as LookId];
  // The figure's art, facing out, where it has some; its code drawing otherwise.
  const figure = new Container();
  figure.label = 'portrait_figure';
  // The look's `portraits`: a close-up of the member facing right, from the side, their eyes in the middle of
  // the frame and their colours filling it (the owner: "a zoom in on them facing right").
  const r = size * 0.72;
  if (info && !opts.whole && drawLookArt(figure, look as LookId, { facing: 'right', mouth: 0, t: 0, ko, hurt: false }, r)) {
    const inset = m.l;
    const mask = new Graphics().rect(inset, inset, size - inset * 2, size - inset * 2).fill(0xffffff);
    figure.mask = mask;
    figure.position.set(size / 2 - (ko ? 0 : 0.22) * r, size / 2 + 0.24 * r);
    c.addChild(figure, mask);
  } else if (info && drawLookArt(figure, look as LookId, { facing: 'down', mouth: 0, t: 0, ko, hurt: false }, size * 0.3)) {
    const b = figure.getLocalBounds();
    const k = Math.min((size * 0.8) / Math.max(1, b.width), (size * 0.8) / Math.max(1, b.height));
    figure.scale.set(k);
    figure.position.set(size / 2 - (b.x + b.width / 2) * k, size / 2 - (b.y + b.height / 2) * k);
    c.addChild(figure);
  } else if (info) {
    const g = new Graphics();
    const pose = { facing: 'down', mouth: 0, t: 0, ko, hurt: false } as const;
    const r0 = size * 0.3;
    info.draw(g, pose, r0);
    const b0 = g.getLocalBounds();
    const r = r0 * Math.min((size * 0.8) / Math.max(1, b0.width), (size * 0.8) / Math.max(1, b0.height));
    g.clear();
    info.draw(g, pose, r);
    const b1 = g.getLocalBounds();
    g.position.set(size / 2 - (b1.x + b1.width / 2), size / 2 - (b1.y + b1.height / 2));
    c.addChild(g);
  }
  c.eventMode = 'none';
  portraits.live++;
  c.once('destroyed', () => portraits.live--);
  return c;
}
