import { Container, Graphics } from 'pixi.js';
import { EASE, motion } from '../render/motion.ts';
import { INK } from '../render/palette.ts';
import { anim } from './anim.ts';
import type { TargetRect } from './target_box.ts';
import { TargetWidgetFace, type NativeWidget } from './target_widget_face.ts';

export type ItemPopModel = {
  key: string;
  kind: 'hp' | 'mp' | 'portrait';
  rect: TargetRect;
  u: number;
  from: number;
  to: number;
  max: number;
  native: NativeWidget;
};

/** Lift the affected native widget while its original input region stays put. */
export class TargetItemPop {
  readonly container = new Container();
  private readonly shadow = new Graphics();
  private readonly nativeFace = new TargetWidgetFace();
  model: ItemPopModel | null = null;
  private key = '';
  private started = 0;

  constructor() {
    this.container.eventMode = 'none';
    this.container.addChild(this.shadow, this.nativeFace.container);
    this.container.visible = false;
    anim.loop(this, this.container, time => this.draw(time));
  }

  show(model: ItemPopModel | null): void {
    const key = model ? model.key + ':' + [model.rect.x, model.rect.y, model.rect.w, model.rect.h].join(',') : '';
    if (key !== this.key) { this.key = key; this.started = anim.clock; }
    this.model = model;
    this.container.visible = !!model;
    this.draw(anim.clock);
  }

  /** Everything the last drawing read, as a string, and the moment of it. */
  private drawnFor = '';
  private drawnAt = NaN;

  /** What a drawing of this model at this moment reads: the model's own numbers, the lifted widget's, and its words. */
  private drawKey(m: ItemPopModel): string {
    const n = m.native;
    const native = n.kind === 'portrait' ? `portrait|${n.look}` : [n.kind, n.gauge.x, n.gauge.y, n.gauge.w, n.gauge.h, n.fill, n.line, n.splitInk, n.halo, n.label?.text, n.label?.x, n.label?.y,
      ...n.sources.map(t => `${t.text}:${t.style.fontSize}:${t.style.fill}:${t.scale.x}:${t.scale.y}:${t.x}:${t.y}`)].join('|');
    return [m.key, m.kind, m.rect.x, m.rect.y, m.rect.w, m.rect.h, m.u, m.from, m.to, m.max, this.started, motion.reduced, native].join('~');
  }

  private draw(time: number): void {
    const m = this.model;
    if (!m) return;
    // Shown twice a step (once from the loop, once from show) with the same everything: the second changes nothing, and a Graphics
    // drawn again makes Pixi rebuild the whole stage's draw list.
    const key = this.drawKey(m);
    if (time === this.drawnAt && key === this.drawnFor) return;
    this.drawnAt = time; this.drawnFor = key;
    const { rect: r, u } = m, age = Math.max(0, time - this.started), still = motion.reduced;
    const landed = still ? 1 : EASE.pop(Math.min(1, age / .15));
    const lift = u * .16 * landed + (still ? 0 : Math.sin(age * Math.PI * 2 * .45) * u * .04);
    this.container.position.set(r.x + r.w / 2, r.y + r.h / 2 - lift);
    this.container.scale.set(1 + .055 * landed + (still ? 0 : Math.sin(age * Math.PI * 2 * .55) * .006));
    this.shadow.clear().roundRect(-r.w / 2 + u * .16, -r.h / 2 + u * .16 + lift * .08, r.w, r.h, Math.min(3, r.h * .15)).fill({ color: INK, alpha: .58 });
    this.nativeFace.draw(m.native, r, u, m.from, m.to, m.max);
  }
}
