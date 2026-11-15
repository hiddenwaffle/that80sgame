import { Container, Graphics, Text } from 'pixi.js';
import { LOW_HP } from '../battle/cues.ts';
import type { GameContext } from '../game/context.ts';
import { xpToNext } from '../game/state.ts';
import { FONT } from '../render/fonts.ts';
import { EASE, motion, MS } from '../render/motion.ts';
import { anim } from './anim.ts';
import { TargetBox, decorateTargetCard, targetCardFill, targetGain } from './target_box.ts';
import { TargetItemPop } from './target_item_pop.ts';
import { DRIFT_S, VITAL, vitalFill } from './vital_fill.ts';
import { BOX, INK, INK_SOFT, PAPER, PAPER_DARK, POP_CYAN, POP_YELLOW, RED_INK } from '../render/palette.ts';
import { benDay, drawPanel, letterStyle, measures, Tab } from './print.ts';
import { portrait } from './portrait.ts';

/** What an item aimed at the party shows on the cards: the card under the cursor (-1 for none), the members it cannot help, and what it would give. */
export interface Aim {
  cursor: number;
  cannot: number[];
  preview: { stat: 'hp' | 'mp'; from: number; to: number } | null;
}

type Rect = { x: number; y: number; w: number; h: number };

const ROWS = ['level', 'hp', 'mp', 'next', 'speed', 'strength', 'accuracy'] as const;
type Field = (typeof ROWS)[number];
/** The fields shown over a gauge. */
const gauged = (k: Field) => k === 'hp' || k === 'mp' || k === 'next';

/**
 * The party page's box score: a paper band with the page's name and the Dots, and a card per member. Each
 * card has the member's name on a tab (grey while they are down), their Level, HP and MP over gauges, the XP
 * still needed over a cyan bar of the way there, and Speed, Strength and Accuracy. Side by side, the cards
 * share a column of labels, as in the fight's strip, and a wide card holds the member's portrait above its
 * rows. Stacked (on a phone held upright), each card is a row as in role-playing games' party menus: the
 * portrait at the left, the name beside it, and the numbers each after its label. An item being aimed marks
 * the cards: the target frame round the recipient, its affected widget lifted with the gain outlined, and the
 * members it cannot help printed faint.
 */
export class BoxScore {
  readonly container = new Container();
  width = 0;
  height = 0;
  /** Whether the cards are stacked one above another, and the height through the first card, for a page that must scroll it. */
  readonly stacked: boolean;
  readonly fields: readonly Field[];
  private readonly tightSpacing: boolean;
  firstCardBottom = 0;
  /** Each card's rectangle, how far its member is toward the next level, and whether it shows a portrait, for the checks. */
  readonly cards: Array<{ rect: Rect; xpFrac: number; portrait: boolean }> = [];
  /** Portrait bounds for effects that follow the card through resizing and scrolling. */
  readonly portraits: Array<Rect | null> = [];
  private readonly gauges: Array<{ hp: Rect; mp: Rect }> = [];
  private readonly tabs: Tab[] = [];
  private readonly members: Array<{ hp: number; maxHp: number; mp: number; maxMp: number }> = [];
  private readonly marksG = new Graphics();
  /** Complete card rims sit below portraits and name tabs; the selected item recipient uses the target frame. */
  private readonly cardEdges: Graphics[] = [];
  private readonly cardPlates: Graphics[] = [];
  private readonly targetBox = new TargetBox();
  private readonly itemPop = new TargetItemPop();
  private readonly cardTexts: Array<Array<{ text: Text; stat?: Field }>> = [];
  private readonly u: number;
  private aim: Aim | null = null;

  constructor(game: GameContext, u: number, maxW: number, opts: { stacked?: boolean; omitSecondary?: boolean; tightSpacing?: boolean } = {}) {
    // Even a panel closed before aiming owns and destroys its idle cue drawings.
    this.container.addChild(this.targetBox.container, this.itemPop.container);
    const g = game;
    const s = g.state;
    this.u = u;
    this.stacked = opts.stacked ?? false;
    const m = measures(u);
    const pad = Math.round(u * 0.7);
    const cpad = Math.round(u * 0.5);
    const gap = Math.round(u * 0.5) + m.S;
    const n = s.order.length;
    const rows = opts.omitSecondary ? ROWS.filter(k => !['speed', 'strength', 'accuracy'].includes(k)) : ROWS;
    this.fields = rows;
    this.tightSpacing = opts.tightSpacing ?? false;
    const labels = rows.map((k) => new Text({ text: g.msg('party', k), style: { fontFamily: FONT.body, fontSize: Math.round(u * 0.95), fill: INK_SOFT } }));
    const labelW = Math.max(...labels.map((t) => t.width)) + Math.round(u * 0.6);
    const values = s.order.map((id) => {
      const mm = s.members[id]!;
      const low = mm.hp <= 0 || mm.hp / mm.maxHp <= LOW_HP;
      const words: Record<Field, string> = {
        level: String(mm.level),
        hp: mm.hp > 0 ? `${mm.hp}/${mm.maxHp}` : g.msg('battle', 'down'),
        mp: `${mm.mp}/${mm.maxMp}`,
        next: String(xpToNext(g.content, mm.level) - mm.xp),
        speed: String(mm.speed),
        strength: String(mm.strength),
        accuracy: String(mm.accuracy),
      };
      return rows.map((k) => new Text({ text: words[k], style: { fontFamily: FONT.headline, fontWeight: '700', fontSize: Math.round(u * 1.05), fill: k === 'hp' && low ? RED_INK : INK } }));
    });
    s.order.forEach((id) => {
      const mm = s.members[id]!;
      this.members.push({ hp: mm.hp, maxHp: mm.maxHp, mp: mm.mp, maxMp: mm.maxMp });
      this.tabs.push(new Tab(g.content.party.members[id]!.name, u, { ink: mm.hp > 0 ? 'ink' : 'faint' }));
    });
    // The cards share the width left; a wide card holds the member's portrait above the rows.
    const avail = Math.floor((maxW - pad * 2 - labelW - (n - 1) * gap - m.S) / n);
    const need = Math.ceil(Math.max(...values.flat().map((t) => t.width), ...this.tabs.map((t) => t.width + u * 0.3)) + cpad * 2);
    const withPortrait = avail >= Math.round(u * 4) + cpad * 2;
    const cw = withPortrait ? Math.min(avail, u * 12) : Math.max(need, Math.min(avail, u * 9));
    const ps = withPortrait ? Math.round(Math.min(cw - cpad * 2, u * 4)) : 0;

    const title = new Text({ text: g.msg('party', 'heading').toUpperCase(), style: letterStyle(Math.round(u * 1.8), POP_YELLOW, { outline: true, extrude: true }) });
    title.position.set(pad, Math.round(u * 0.35));
    const dots = new Text({ text: g.msg('party', 'dots', { dots: s.dots }), style: { fontFamily: FONT.headline, fontSize: Math.round(u * 0.95), fill: INK_SOFT } });
    const tabH = this.tabs[0]?.height ?? m.nameTabH;
    const cardTop = Math.round(u * 0.35 + title.height + tabH / 2 + u * 0.2);
    if (this.stacked) {
      this.buildStacked(g, { labels, values, title, dots, pad, cpad, maxW, cardTop });
      return;
    }
    const rowH = Math.round(u * 1.45);
    const gaugeH = Math.max(4, Math.round(u * 0.4));
    // Where each row's words go, and each gauge, the same on every card.
    let y = cardTop + Math.round(tabH / 2 + u * 0.3) + (ps ? ps + Math.round(u * 0.3) : 0);
    const rowY: number[] = [];
    const gaugeY: Partial<Record<Field, number>> = {};
    for (const k of rows) {
      rowY.push(y);
      y += rowH;
      if (k === 'hp' || k === 'mp' || k === 'next') {
        gaugeY[k] = y - Math.round(u * 0.2);
        y += gaugeH + Math.round(u * 0.15);
      }
    }
    const cardH = y + Math.round(u * 0.2) - cardTop;
    this.width = pad * 2 + labelW + n * cw + (n - 1) * gap + m.S;
    this.height = cardTop + cardH + m.S + pad;

    const band = new Graphics();
    drawPanel(band, 0, 0, this.width, this.height, m, { fill: PAPER });
    // A field of cyan dots behind the head, fading toward the cards.
    const dw = Math.min(this.width * 0.6, title.width + u * 2);
    benDay(band, { x: u * 0.3, y: u * 0.2, w: dw, h: cardTop - tabH / 2 - u * 0.3 }, { color: POP_CYAN, alpha: 0.6, pitch: u * 0.5, from: [dw, cardTop], to: [0, 0] });
    // A tap on the box score stays on the page; only a tap outside goes back.
    band.eventMode = 'static';
    dots.position.set(this.width - m.S - pad - dots.width, Math.round(u * 0.8));
    this.container.addChild(band, title, dots);
    labels.forEach((t, r) => {
      t.position.set(pad, rowY[r]!);
      this.container.addChild(t);
    });
    const bars = new Graphics();
    s.order.forEach((id, i) => {
      const mm = s.members[id]!;
      const x = pad + labelW + i * (cw + gap);
      const card = new Graphics();
      drawPanel(card, x, cardTop, cw, cardH, m, { fill: BOX });
      const edge = new Graphics().rect(x, cardTop, cw, cardH).stroke({ width: Math.max(2.5, m.L * 1.4), color: INK });
      this.cardEdges.push(edge);
      this.cardPlates.push(card);
      this.container.addChild(card, edge);
      const tab = this.tabs[i]!;
      tab.container.position.set(x + Math.round(u * 0.4), Math.round(cardTop - tabH / 2));
      let shown = false;
      if (ps) {
        const pic = portrait(g.content.party.members[id]!.look, ps, u, mm.hp <= 0);
        pic.position.set(Math.round(x + (cw - ps) / 2), Math.round(cardTop + tabH / 2 + u * 0.3));
        this.container.addChild(pic);
        this.portraits.push({ x: pic.x, y: pic.y, w: ps, h: ps });
        shown = true;
      }
      if (!shown) this.portraits.push(null);
      this.cardTexts[i] = [];
      values[i]!.forEach((t, r) => {
        this.cardTexts[i]!.push({ text: t, stat: rows[r] });
        t.position.set(x + cpad, rowY[r]!);
        this.container.addChild(t);
      });
      const gw = cw - cpad * 2;
      const rect = (k: 'hp' | 'mp' | 'next') => ({ x: x + cpad, y: gaugeY[k]!, w: gw, h: gaugeH });
      const xpFrac = this.drawGauges(bars, g, i, { hp: rect('hp'), mp: rect('mp'), xp: rect('next') });
      this.cards.push({ rect: { x, y: cardTop, w: cw, h: cardH }, xpFrac, portrait: shown });
    });
    this.container.addChild(bars, ...this.tabs.map((t) => t.container), this.marksG);
  }

  /**
   * The cards one above another at the full width, as role-playing games' party menus lay out their members:
   * the portrait at the left, the name on a tab beside it, and the numbers each after its label, flowed into
   * lines in the room to the right, HP, MP and the XP still needed over their gauges. Every card flows the
   * same way, so the fields line up down the stack.
   */
  private buildStacked(g: GameContext, parts: { labels: Text[]; values: Text[][]; title: Text; dots: Text; pad: number; cpad: number; maxW: number; cardTop: number }): void {
    const { labels, values, title, dots, pad, cpad, maxW, cardTop } = parts;
    const rows = this.fields;
    const s = g.state;
    const u = this.u;
    const m = measures(u);
    const n = s.order.length;
    const tabH = this.tabs[0]?.height ?? m.nameTabH;
    const cw = Math.floor(maxW - pad * 2 - m.S);
    const ps = Math.round(u * 3.6);
    const side = Math.round(u * 0.6);
    const room = cw - cpad * 2 - ps - side;
    const rowH = Math.round(u * 1.45);
    const gaugeH = Math.max(4, Math.round(u * 0.4));
    const cellGap = Math.round(u * (this.tightSpacing ? 0.5 : 0.9));
    const labelGap = Math.round(u * 0.35);
    // Each field's cell is as wide as its label and the widest member's number, and a gauge's at least 4.5 units.
    const cellW = rows.map((k, r) => Math.ceil(Math.max(labels[r]!.width + labelGap + Math.max(...values.map((v) => v[r]!.width)), gauged(k) ? u * 4.5 : 0)));
    const at: Array<{ line: number; x: number }> = [];
    let line = 0;
    let lx = 0;
    rows.forEach((_, r) => {
      if (lx > 0 && lx + cellW[r]! > room) {
        line++;
        lx = 0;
      }
      at.push({ line, x: lx });
      lx += cellW[r]! + cellGap;
    });
    const lineY: number[] = [];
    let y = Math.round(tabH / 2 + u * 0.25);
    for (let l = 0; l <= line; l++) {
      lineY.push(y);
      y += rowH + (rows.some((k, r) => at[r]!.line === l && gauged(k)) ? gaugeH + Math.round(u * 0.2) : 0);
    }
    const cardH = Math.max(y + Math.round(u * 0.25), ps + cpad * 2);
    const gapV = Math.round(tabH / 2 + u * 0.3) + m.S;
    this.width = maxW;
    this.height = cardTop + n * cardH + (n - 1) * gapV + m.S + pad;
    this.firstCardBottom = cardTop + cardH + m.S;

    const band = new Graphics();
    drawPanel(band, 0, 0, this.width - m.S, this.height - m.S, m, { fill: PAPER });
    const dw = Math.min(this.width * 0.6, title.width + u * 2);
    benDay(band, { x: u * 0.3, y: u * 0.2, w: dw, h: cardTop - tabH / 2 - u * 0.3 }, { color: POP_CYAN, alpha: 0.6, pitch: u * 0.5, from: [dw, cardTop], to: [0, 0] });
    band.eventMode = 'static';
    dots.position.set(this.width - m.S - pad - dots.width, Math.round(u * 0.8));
    this.container.addChild(band, title, dots);
    const bars = new Graphics();
    s.order.forEach((id, i) => {
      const mm = s.members[id]!;
      const x = pad;
      const top = cardTop + i * (cardH + gapV);
      const card = new Graphics();
      drawPanel(card, x, top, cw, cardH, m, { fill: BOX });
      const edge = new Graphics().rect(x, top, cw, cardH).stroke({ width: Math.max(2.5, m.L * 1.4), color: INK });
      this.cardEdges.push(edge);
      this.cardPlates.push(card);
      this.container.addChild(card, edge);
      const pic = portrait(g.content.party.members[id]!.look, ps, u, mm.hp <= 0);
      pic.position.set(x + cpad, Math.round(top + (cardH - ps) / 2));
      this.container.addChild(pic);
      this.portraits.push({ x: pic.x, y: pic.y, w: ps, h: ps });
      const x0 = x + cpad + ps + side;
      this.tabs[i]!.container.position.set(x0, Math.round(top - tabH / 2));
      const gauges: Partial<Record<Field, Rect>> = {};
      this.cardTexts[i] = [];
      rows.forEach((k, r) => {
        const cx = x0 + at[r]!.x;
        const ly = top + lineY[at[r]!.line]!;
        const label = new Text({ text: labels[r]!.text, style: labels[r]!.style });
        const value = values[i]![r]!;
        label.position.set(cx, Math.round(ly + (rowH - label.height) / 2));
        value.position.set(cx + label.width + labelGap, Math.round(ly + (rowH - value.height) / 2));
        this.container.addChild(label, value);
        this.cardTexts[i]!.push({ text: label, stat: k }, { text: value, stat: k });
        if (gauged(k)) gauges[k] = { x: cx, y: ly + rowH - Math.round(u * 0.1), w: cellW[r]!, h: gaugeH };
      });
      const xpFrac = this.drawGauges(bars, g, i, { hp: gauges.hp!, mp: gauges.mp!, xp: gauges.next! });
      this.cards.push({ rect: { x, y: top, w: cw, h: cardH }, xpFrac, portrait: true });
    });
    for (const t of labels) t.destroy();
    this.container.addChild(bars, ...this.tabs.map((t) => t.container), this.marksG);
  }

  /** Draws member `i`'s HP, MP and XP gauges into `bars`, keeping the HP and MP ones for aiming and growing; returns the share of the way to the next level. */
  private drawGauges(bars: Graphics, g: GameContext, i: number, r: { hp: Rect; mp: Rect; xp: Rect }): number {
    const u = this.u;
    const m = measures(u);
    const mm = g.state.members[g.state.order[i]!]!;
    const { hp, mp, xp } = r;
    const xpFrac = Math.max(0, Math.min(1, mm.xp / Math.max(1, xpToNext(g.content, mm.level))));
    // Health and Energy in their printed colours (src/ui/vital_fill.ts); Next XP keeps its flat cyan.
    for (const [q, frac, fill, vital] of [
      [hp, mm.hp / mm.maxHp, mm.hp / mm.maxHp <= LOW_HP ? VITAL.low : VITAL.hp, true],
      [mp, mm.maxMp ? mm.mp / mm.maxMp : 0, VITAL.mp, true],
      [xp, xpFrac, POP_CYAN, false],
    ] as const) {
      if (vital) { this.vitalGauge(q, frac, fill); continue; }
      bars.rect(q.x, q.y, q.w, q.h).fill(PAPER_DARK);
      if (frac > 0) bars.rect(q.x, q.y, q.w * Math.min(1, frac), q.h).fill(fill);
      bars.rect(q.x, q.y, q.w, q.h).stroke({ width: m.l, color: INK });
    }
    // A downed member's HP gauge is hatched, as on the fight's cards.
    if (mm.hp <= 0) {
      for (let hx = -hp.h; hx < hp.w; hx += Math.max(4, u * 0.4)) {
        const a = Math.max(0, hx);
        const b = Math.min(hp.w, hx + hp.h);
        if (b > a) bars.moveTo(hp.x + a, hp.y + hp.h - (a - hx)).lineTo(hp.x + b, hp.y + hp.h - (b - hx));
      }
      bars.stroke({ width: 1, color: INK });
    }
    this.gauges.push({ hp, mp });
    return xpFrac;
  }

  /**
   * A Health or Energy gauge in a drawing of its own, its dots drifting slowly toward the fill's edge while the page is open
   * (held still with reduced motion), redrawn at most thirty times a second. Under the shared drawing, which hatches a
   * downed member's gauge over it.
   */
  private vitalGauge(q: Rect, frac: number, colour: number): void {
    const u = this.u, m = measures(u), g = new Graphics();
    this.container.addChild(g);
    let drift = 0, drawnAt = -1;
    const draw = () => {
      if (g.destroyed) return;
      g.clear().rect(q.x, q.y, q.w, q.h).fill(PAPER_DARK);
      vitalFill(g, q, frac, colour, u, drift);
      g.rect(q.x, q.y, q.w, q.h).stroke({ width: m.l, color: INK });
    };
    draw();
    if (frac > 0) anim.loop(g, g, (t) => {
      if (motion.reduced || t - drawnAt < 1 / 30) return;
      drawnAt = t;
      drift = (t / DRIFT_S) % 1;
      draw();
    });
  }

  /** Marks the cards for an item being aimed, or clears the marks with null. */
  mark(aim: Aim | null): void {
    this.aim = aim;
    const u = this.u;
    const m = measures(u);
    const g = this.marksG.clear();
    this.cardEdges.forEach((edge, i) => {
      const r = this.cards[i]!.rect;
      const selected = aim?.cursor === i;
      edge.visible = !selected;
      drawPanel(this.cardPlates[i]!.clear(), r.x, r.y, r.w, r.h, m, { fill: selected ? targetCardFill() : BOX });
      if (selected) decorateTargetCard(this.cardPlates[i]!, r, u);
      for (const t of this.cardTexts[i] ?? []) t.text.visible = true;
    });
    this.tabs.forEach((t, i) => t.setInk(aim?.cursor === i ? 'pink' : aim?.cannot.includes(i) || this.members[i]!.hp <= 0 ? 'faint' : 'ink'));
    if (!aim) { this.targetBox.show(null); this.itemPop.show(null); return; }
    for (const i of aim.cannot) {
      const r = this.cards[i]?.rect;
      if (r) g.rect(r.x, r.y, r.w + m.S, r.h + m.S).fill({ color: PAPER, alpha: 0.6 });
    }
    const c = this.cards[aim.cursor];
    if (!c) { this.targetBox.show(null); this.itemPop.show(null); return; }
    const r = c.rect;
    this.container.addChildAt(this.targetBox.container, this.container.getChildIndex(this.cardPlates[aim.cursor]!) + 1);
    this.targetBox.show(r, u);
    // Lift only the affected gauge and its existing text.
    const p = aim.preview;
    const mem = this.members[aim.cursor];
    if (p && mem) {
      const gr = this.gauges[aim.cursor]![p.stat];
      const max = p.stat === 'hp' ? mem.maxHp : mem.maxMp;
      targetGain(g, gr, p.from, p.to, max, u);
      const ts = (this.cardTexts[aim.cursor] ?? []).filter(t => t.stat === p.stat);
      const top = Math.min(...ts.map(t => t.text.y));
      const popup = { x: gr.x, y: top, w: gr.w, h: gr.y + gr.h - top };
      for (const t of ts) t.text.visible = false;
      this.container.addChild(this.itemPop.container);
      this.itemPop.show({
        key: `${aim.cursor}:${p.stat}`, kind: p.stat, rect: popup, u, from: p.from, to: p.to, max,
        native: {
          kind: 'party', gauge: gr, fill: p.stat === 'hp' ? (mem.hp / mem.maxHp <= LOW_HP ? VITAL.low : VITAL.hp) : VITAL.mp,
          line: m.l, sources: ts.map(t => t.text),
        },
      });
    } else this.itemPop.show(null);
  }

  /** The marks shown, for the checks. */
  marks(): Aim | null {
    return this.aim;
  }

  /**
   * After an item, a member's gauge grows from where it stood to what it now shows: the stretch gained is
   * uncovered over a moment on the shared stepper. The number has already changed. Reduce motion shows the
   * new length at once.
   */
  grow(i: number, stat: 'hp' | 'mp', from: number): void {
    const r = this.gauges[i]?.[stat];
    const mem = this.members[i];
    if (!r || !mem || motion.reduced) return;
    const max = stat === 'hp' ? mem.maxHp : mem.maxMp;
    const a = Math.max(0, Math.min(1, from / max));
    const b = Math.min(1, (stat === 'hp' ? mem.hp : mem.mp) / max);
    if (b <= a) return;
    const l = measures(this.u).l;
    const cover = new Graphics();
    this.container.addChildAt(cover, this.container.getChildIndex(this.marksG));
    this.growing = { i, stat, from: a, to: b };
    void anim.run(this, MS.gaugeGrow, EASE.out, (k) => {
      if (cover.destroyed) return;
      const x0 = a + (b - a) * k;
      cover.clear();
      if (b - x0 > 0.001) cover.rect(r.x + r.w * x0, r.y + l / 2, r.w * (b - x0), r.h - l).fill(PAPER_DARK);
      if (k >= 1) this.growing = null;
    });
  }

  /** A gauge still growing, as shares of its length, for the checks; null when none is. */
  growing: { i: number; stat: 'hp' | 'mp'; from: number; to: number } | null = null;
}
