import { Container, Graphics, Text } from 'pixi.js';
import { BOX, INK, PAPER, PAPER_DARK } from '../render/palette.ts';
import { portrait, type Portrait } from './portrait.ts';
import { decorateTargetCard, targetCardFill, targetGain, type TargetRect } from './target_box.ts';
import { vitalFill } from './vital_fill.ts';

export type NativeWidget = { kind: 'portrait'; look: string } | {
  kind: 'battle' | 'party'; gauge: TargetRect; sources: Text[]; fill: number; line: number; splitInk?: boolean; label?: Text;
  /** The gauge's number carries a paper halo, as the widget draws it, so its outline is drawn over the words. */
  halo?: boolean;
};

/** Copy the existing widget's inks, fonts and geometry into the lifted surface. */
export class TargetWidgetFace {
  readonly container = new Container();
  private readonly face = new Graphics();
  /** The gauge's outline, over the words when they carry a halo. */
  private readonly edge = new Graphics();
  private readonly ink = new Container();
  private readonly paper = new Container();
  private readonly inkMask = new Graphics();
  private readonly paperMask = new Graphics();
  private readonly labelLayer = new Container();
  private readonly labelPlate = new Graphics();
  private label: Text | null = null;
  private labelSource: Text | null = null;
  private pic: Portrait | null = null;
  private plateFor: number[] = [];
  /** What the masks were last drawn for (the gauge and the share), or null when they were cleared. */
  private cutFor: number[] | null = null;
  private textKey = '';
  private picKey = '';

  constructor() {
    this.container.eventMode = 'none';
    this.container.addChild(this.face, this.ink, this.paper, this.edge, this.inkMask, this.paperMask, this.labelLayer);
    this.labelLayer.addChild(this.labelPlate);
  }

  draw(n: NativeWidget, r: TargetRect, u: number, from: number, to: number, max: number): void {
    const x = -r.w / 2, y = -r.h / 2;
    this.face.clear();
    this.edge.clear();
    // Each part's visibility is set once, to what it ends as: setting it off and on again makes Pixi rebuild the whole stage's draw
    // list twice over. (The portrait's own is set where it is made.)
    if (n.kind === 'portrait') {
      this.ink.visible = this.paper.visible = false;
      this.labelLayer.visible = false;
      const key = `${n.look}:${r.w}:${u}`;
      if (key !== this.picKey) {
        this.pic?.destroy({ children: true });
        this.pic = portrait(n.look, r.w, u, true);
        this.container.addChild(this.pic);
        this.picKey = key;
      }
      this.pic!.visible = true;
      this.pic!.position.set(x, y);
      return;
    }
    if (this.pic) this.pic.visible = false;
    const gr = n.gauge, q = { x: x + gr.x - r.x, y: y + gr.y - r.y, w: gr.w, h: gr.h };
    const a = Math.max(0, Math.min(1, from / Math.max(1, max)));
    if (n.kind === 'party') {
      this.face.rect(x, y, r.w, r.h).fill(targetCardFill());
      decorateTargetCard(this.face, { x, y, w: r.w, h: r.h }, u);
    }
    this.face.rect(q.x, q.y, q.w, q.h).fill(n.kind === 'battle' ? BOX : PAPER_DARK);
    vitalFill(this.face, q, a, n.fill, u);
    this.face.rect(q.x, q.y, q.w, q.h).stroke({ color: INK, width: n.line });
    targetGain(this.face, q, from, to, max, u);
    const sources = n.sources;
    const key = sources.map(s => `${s.text}:${s.style.fontSize}:${s.style.fill}:${s.scale.x}:${s.scale.y}`).join('|');
    if (key !== this.textKey) {
      for (const c of [this.ink, this.paper]) for (const old of c.removeChildren()) old.destroy();
      for (const s of sources) {
        const t = new Text({ text: s.text, style: s.style.clone() });
        t.anchor.copyFrom(s.anchor); t.scale.copyFrom(s.scale); this.ink.addChild(t);
        const p = new Text({ text: s.text, style: s.style.clone() });
        // Over the fill a fight card's words are light with an ink outline, as on the card.
        p.style.fill = PAPER;
        if (n.kind === 'battle') p.style.stroke = { color: INK, width: Math.max(2, Math.round(u * 0.14)), join: 'round' };
        p.anchor.copyFrom(s.anchor); p.scale.copyFrom(s.scale); this.paper.addChild(p);
      }
      this.textKey = key;
    }
    sources.forEach((s, i) => {
      this.ink.children[i]!.position.set(x + s.x - r.x, y + s.y - r.y);
      this.paper.children[i]!.position.set(x + s.x - r.x, y + s.y - r.y);
    });
    if (n.halo) this.edge.rect(q.x, q.y, q.w, q.h).stroke({ color: INK, width: n.line });
    if (n.label) {
      if (!this.label) {
        this.label = new Text({ text: n.label.text, style: n.label.style.clone() });
        this.labelLayer.addChild(this.label);
      }
      this.label.text = n.label.text;
      if (this.labelSource !== n.label) {
        this.label.style = n.label.style.clone();
        this.labelSource = n.label;
      }
      this.label.anchor.copyFrom(n.label.anchor);
      this.label.scale.copyFrom(n.label.scale);
      this.label.position.set(x + n.label.x - r.x, y + n.label.y - r.y);
      const pad = Math.round(u * 0.35);
      // The plate is drawn again only when its rectangle changes.
      const plate = [this.label.x - pad, this.label.y - this.label.height / 2 - n.line / 2, this.label.width + pad * 2, this.label.height + n.line];
      if (plate.some((v, i) => v !== this.plateFor[i])) {
        this.plateFor = plate;
        this.labelPlate.clear().rect(plate[0]!, plate[1]!, plate[2]!, plate[3]!).fill(PAPER);
      }
    }
    this.labelLayer.visible = Boolean(n.label);
    const split = n.kind === 'battle' && (n.fill === INK || n.splitInk === true);
    this.ink.mask = split ? this.inkMask : null;
    this.paper.mask = split ? this.paperMask : null;
    this.ink.visible = true;
    this.paper.visible = split;
    // The masks are drawn again only when what they cut changes.
    const cut = split ? [q.x, q.y, q.w, q.h, a] : null;
    if (cut?.some((v, i) => v !== this.cutFor?.[i]) || (cut === null) !== (this.cutFor === null)) {
      this.cutFor = cut;
      this.inkMask.clear(); this.paperMask.clear();
      if (split) {
        this.inkMask.rect(q.x + q.w * a, q.y, q.w * (1 - a), q.h).fill(0xffffff);
        this.paperMask.rect(q.x, q.y, q.w * a, q.h).fill(0xffffff);
      }
    }
  }
}
