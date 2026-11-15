import { Container, Graphics, Text } from 'pixi.js';
import { BAR_PAD } from '../battle/tierLayout.ts';
import { LOW_HP } from '../battle/cues.ts';
import type { GameContext } from '../game/context.ts';
import { xpToNext } from '../game/state.ts';
import { FONT } from '../render/fonts.ts';
import { EASE, motion, MS } from '../render/motion.ts';
import { anim } from './anim.ts';
import { BOX, INK, INK_FAINT, INK_SOFT, PAPER, PAPER_DARK, POP_CYAN, POP_YELLOW, RED_INK } from '../render/palette.ts';
import { benDay, drawPanel, letterStyle, measures, SMALL_TEXT, Tab } from './print.ts';
import { portrait } from './portrait.ts';

import type { Aim } from './boxScore.ts';
import { TargetBox, decorateTargetCard, targetCardFill, targetGain } from './target_box.ts';
import { TargetItemPop } from './target_item_pop.ts';
import { DRIFT_S, numberHalo, VITAL, vitalFill } from './vital_fill.ts';

type Rect = { x: number; y: number; w: number; h: number };
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/**
 * How much air the sheets get, from 0 on a narrow or short phone at large text to 1 on a tall phone at the first size
 * (the owner, 2026-10-28: "use the extra space on bigger phones to give the stats page overall more padding to look more
 * like other pages", and the vitals "lack padding" too; less on the smallest phones, but "even on the smallest phone ...
 * some opportunity for padding and margin in all directions"). Across goes by the width in text units, down by the panel's
 * height in text units.
 */
export function sheetAir(u: number, w: number, h: number): { across: number; down: number } {
  return { across: clamp01((w / u - 22) / 10), down: clamp01((h / u - 36) / 24) };
}

const ROWS = ['level', 'hp', 'mp', 'next', 'speed', 'strength', 'accuracy'] as const;
type Field = (typeof ROWS)[number];

/** Phone member sheets: vitals, the five other stats as the desktop's cards, or one item's affected bar. */
export class PhoneSheets {
  readonly container = new Container();
  width = 0;
  height = 0;
  /** Whether the cards are stacked one above another, and the height through the first card, for a page that must scroll it. */
  readonly stacked = true;
  readonly fields: readonly Field[];
  private readonly mode: { stats: boolean; stat?: 'hp' | 'mp'; match?: boolean; reserveHeading?: boolean; cut?: number; smallPortrait?: boolean };
  private readonly targetBox = new TargetBox();
  private readonly itemPop = new TargetItemPop();
  private readonly plates: Graphics[] = [];
  private readonly faces: Array<Partial<Record<'hp' | 'mp', { root: Container; sources: Text[]; label: Text }>>> = [];
  firstCardBottom = 0;
  /** How much height each matched card keeps below its own rows for the Stats page's third row (none on the Stats page). */
  spare = 0;
  /** How much of that each matched card has given up. */
  cut = 0;
  /** How much taller a matched card's portrait is than its bars (a small portrait goes no lower than the smallest kept). */
  portraitOver = 0;
  /** Whether the cards are framed (Stats, or sheets matched to it), so marking an aimed item keeps the frame. */
  private framed = false;
  /** Each card's rectangle, how far its member is toward the next level, and whether it shows a portrait, for the checks. */
  readonly cards: Array<{ rect: Rect; xpFrac: number; portrait: boolean }> = [];
  /** Portrait bounds for effects that follow the card through resizing and scrolling. */
  readonly portraits: Array<Rect | null> = [];
  private readonly gauges: Array<{ hp: Rect; mp: Rect }> = [];
  private readonly tabs: Tab[] = [];
  private readonly vitalLayer = new Container();
  private readonly vitalDraws: Array<Partial<Record<'hp' | 'mp', (frac: number) => void>>> = [];
  private readonly members: Array<{ hp: number; maxHp: number; mp: number; maxMp: number }> = [];
  private readonly marksG = new Graphics();
  private readonly u: number;
  private aim: Aim | null = null;

  /**
   * `match`: draw the Vitals and item sheets in the Stats page's own card frames, so the cards stay put between the pages and
   * a tall phone shows no gap above the menu (the owner, 2026-10-28, option A). The party menu asks for it on every phone, the
   * smallest too ("let's try this first and then we can get back to figuring out what to do about scrolling").
   */
  // `reserveHeading`: a page without a heading keeps the Stats page's heading room above its cards, so they sit where the Stats
  // page's do (the party menu asks for it where every page shares one menu row). `cut`: each matched card gives up this much
  // of its spare height, no more than it has (the party menu asks for it where the cards would still scroll). `smallPortrait`: a
  // matched card's portrait is no taller than its bars, and what that frees counts as spare.
  constructor(game: GameContext, u: number, maxW: number, mode: { stats: boolean; stat?: 'hp' | 'mp'; match?: boolean; reserveHeading?: boolean; cut?: number; smallPortrait?: boolean }) {
    this.container.addChild(this.targetBox.container, this.itemPop.container);
    this.mode = mode;
    this.fields = mode.stats ? ['level', 'next', 'speed', 'strength', 'accuracy'] : mode.stat ? [mode.stat] : ['hp', 'mp'];
    this.u = u;
    this.buildPhone(game, maxW);
  }

  /** Phone sheets separate vitals, the five other stats, and an item's one affected bar. */
  private buildPhone(g: GameContext, maxW: number): void {
    const u = this.u, m = measures(u), air = sheetAir(u, maxW, g.layout.panel.h);
    const pad = Math.round(u * (0.5 + 0.4 * air.across));
    const ps = Math.round(u * (1.65 + 1.0 * air.down)), side = Math.round(u * (0.45 + 0.45 * air.across));
    const stats = this.mode.stats;
    for (const id of g.state.order) {
      const mm = g.state.members[id]!;
      this.members.push({ hp: mm.hp, maxHp: mm.maxHp, mp: mm.mp, maxMp: mm.maxMp });
      const tab = new Tab(g.content.party.members[id]!.name, u, { ink: mm.hp > 0 ? 'ink' : 'faint' });
      this.tabs.push(tab);
    }
    // The names at 0.82 of a tab's size, but never under the small-text floor: an upright page at the frame's own scale took them
    // to 14.8 px against 15.
    const tabScale = Math.max(0.82, ...this.tabs.map(t => Math.round(u * SMALL_TEXT) / Number(t.label.style.fontSize)));
    for (const t of this.tabs) t.container.scale.set(tabScale);
    const tabH = (this.tabs[0]?.height ?? m.nameTabH) * tabScale;
    const left = Math.ceil(Math.max(ps, ...this.tabs.map(t => t.width * tabScale))) + side;
    const cw = Math.floor(maxW - pad * 2 - Math.round(u * 0.9));
    const x0 = pad + left, room = cw - left - side;
    // The Stats page keeps its heading; the pages that would say "Stats/Item" have none on a phone, their cards starting under a
    // margin, and the Dots go to the Items row (the owner, 2026-10-28: "Only remove the Stats/Items, not other headings").
    const heading = stats || this.mode.reserveHeading ? new Text({ text: g.msg('party', 'stats').toUpperCase(), style: letterStyle(Math.round(u * 1.8), POP_YELLOW, { outline: true, extrude: true }) }) : null;
    heading?.position.set(pad, Math.round(u * (0.35 + 0.2 * air.down)));
    const cardTop = heading ? Math.ceil(heading.y + heading.height + tabH / 2 + u * (0.15 + 0.15 * air.down)) : Math.ceil(u * (0.4 + 0.3 * air.down) + tabH / 2);
    // Only the Stats page prints it; a page keeping its room leaves the room plain.
    const title = stats ? heading : null;
    if (heading && !stats) heading.destroy();
    if (stats || this.mode.match) {
      const head = { cardTop, pad, tabH, air };
      let layout = this.statsLayout(g, maxW, head);
      if (!stats) {
        // The portrait otherwise grows with the text up to its cap, so where the width still allows it a smaller text size
        // could print a taller card than a larger one (the owner, 2026-10-29: "the difference is supposed to be in text size").
        const most = Math.max(this.vitalRows().contentH, Math.round(u * 2.4));
        this.portraitOver = layout.withPortrait ? Math.max(0, layout.ps - most) : 0;
        const portraitMax = this.mode.smallPortrait && this.portraitOver > 0 ? most : undefined;
        if (portraitMax) layout = this.statsLayout(g, maxW, { ...head, portraitMax });
        this.spare = this.matchedSpare(layout);
        this.cut = Math.min(this.spare, Math.max(0, Math.ceil(this.mode.cut ?? 0)));
        if (this.cut > 0) layout = this.statsLayout(g, maxW, { ...head, cut: this.cut, portraitMax });
      }
      this.drawBand(maxW, layout.height, title && { title, cardTop, tabH });
      if (stats) this.buildStatsCards(g, layout);
      else this.buildMatched(g, layout);
      return;
    }
    const barH = Math.round(u * (1.1 + 0.3 * air.down)), barGap = Math.round(u * (0.18 + 0.45 * air.down));
    const contentH = this.fields.length * barH + (this.fields.length - 1) * barGap;
    // Room above and below the bars inside each card, and between the cards; down the page only from spare height, so a
    // short phone at large text still fits without scrolling.
    const padV = Math.round(u * 0.45 * air.down);
    const portraitH = tabH / 2 + ps + u * (0.12 + 0.2 * air.down);
    const cardH = Math.ceil(Math.max(portraitH, contentH + padV * 2));
    const gapV = Math.ceil(tabH / 2 + u * (0.08 + 0.75 * air.down)), n = g.state.order.length;
    // The foot keeps its own, smaller margin: the side margins grow on every phone, the foot only with spare height.
    const foot = Math.round(u * (0.35 + 0.3 * air.down));
    this.width = maxW; this.height = cardTop + n * cardH + (n - 1) * gapV + foot;
    this.firstCardBottom = cardTop + cardH;
    this.drawBand(maxW, this.height, null);
    g.state.order.forEach((id, i) => {
      const mm = g.state.members[id]!, top = cardTop + i * (cardH + gapV);
      const card = new Graphics().rect(pad, top, cw, cardH).fill(PAPER);
      if (i < n - 1) card.moveTo(pad, top + cardH + gapV / 2).lineTo(pad + cw, top + cardH + gapV / 2).stroke({ width: m.l, color: INK_FAINT });
      this.container.addChild(card); this.plates.push(card);
      const pic = portrait(g.content.party.members[id]!.look, ps, u, mm.hp <= 0);
      pic.position.set(Math.round(pad + (left - side - ps) / 2), Math.round(top + tabH / 2 + u * (0.1 + 0.1 * air.down)));
      this.container.addChild(pic); this.portraits.push({ x: pic.x, y: pic.y, w: ps, h: ps });
      this.tabs[i]!.container.position.set(pad, Math.round(top - tabH / 2));
      const topY = top + (cardH - contentH) / 2;
      const first = { x: x0, y: topY, w: room, h: barH };
      const second = { ...first, y: topY + barH + barGap };
      const hp = first;
      const mp = this.mode.stat ? first : second;
      this.drawGauges(g, i, { hp, mp });
      this.cards.push({ rect: { x: pad, y: top, w: cw, h: cardH }, xpFrac: Math.max(0, Math.min(1, mm.xp / Math.max(1, xpToNext(g.content, mm.level)))), portrait: true });
    });
    this.container.addChild(this.vitalLayer, ...this.tabs.map(t => t.container), this.marksG);
  }

  /**
   * The Stats page's cards, drawn as the desktop box score draws its own (src/ui/boxScore.ts) and stacked for a phone held
   * upright (the owner, 2026-10-28: "looks more like the desktop stats/item menu's character cards" / "Maybe not side by side
   * since phones are vertical. But a similar design."): a framed card with its shadow, the member's name on a tab across its
   * top edge, the portrait at the left while the rows still fit beside it, and the desktop's labels and numbers in two
   * columns, Level and Next XP over its cyan gauge, then Speed, Strength and Accuracy. Each column's numbers start at one
   * place on every card, as the desktop's start after its shared labels.
   */
  /** Where the Stats page puts its cards on this phone: their frames, the portrait, and the two columns of numbers. */
  private statsLayout(g: GameContext, maxW: number, head: { cardTop: number; pad: number; tabH: number; air: { across: number; down: number }; cut?: number; portraitMax?: number }) {
    const u = this.u, m = measures(u), { cardTop, pad, tabH, air } = head;
    const n = g.state.order.length;
    const cpad = Math.round(u * (0.5 + 0.4 * air.across)), minGap = Math.round(u * 0.6), valueGap = Math.round(u * 0.45);
    const rowH = Math.round(u * (1.35 + 0.25 * air.down)), gaugeH = Math.max(4, Math.round(u * 0.4));
    const label = (key: Field) => new Text({ text: g.msg('party', key), style: { fontFamily: FONT.body, fontSize: Math.round(u * 0.95), fill: INK_SOFT } });
    const value = (words: string) => new Text({ text: words, style: { fontFamily: FONT.headline, fontWeight: '700', fontSize: Math.round(u * 1.05), fill: INK } });
    const words = (id: string, key: Field): string => {
      const mm = g.state.members[id]!;
      return key === 'next' ? String(xpToNext(g.content, mm.level) - mm.xp) : String(mm[key as 'level' | 'speed' | 'strength' | 'accuracy']);
    };
    const widthOf = (t: Text) => { const w = t.width; t.destroy(); return w; };
    const columns = ([['level', 'next'], ['speed', 'strength', 'accuracy']] as const).map(keys => {
      const labelW = Math.ceil(Math.max(...keys.map(k => widthOf(label(k)))));
      const valueW = Math.ceil(Math.max(...g.state.order.flatMap(id => keys.map(k => widthOf(value(words(id, k)))))));
      return { keys, labelW, w: labelW + valueGap + valueW };
    });
    const [left, right] = columns as [typeof columns[0], typeof columns[0]];
    const cw = Math.floor(maxW - pad * 2 - m.S);
    const rowsH = rowH * 3;
    // A desktop card holds its portrait only when wide enough. Here it shrinks to the room the two columns leave beside it
    // (with at least minGap round each), and only a narrow, large-text card too tight for even a small one goes without.
    const ps = Math.min(Math.round(u * 3.6), rowsH, cw - cpad - minGap * 3 - left.w - right.w, head.portraitMax ?? Infinity);
    const withPortrait = ps >= Math.round(u * 2.4);
    // The room right of the portrait is shared out evenly: the same space before the first column, between the two, and
    // after the second to the card's edge (the owner, 2026-10-28: the first column sat against the portrait while the
    // second ended a quarter of the way in from the right).
    const start = pad + cpad + (withPortrait ? ps : 0), end = pad + cw;
    const spread = Math.max(minGap, Math.floor((end - start - left.w - right.w) / 3));
    const x0 = start + spread, x1 = x0 + left.w + spread;
    const inner = Math.round(tabH / 2 + u * (0.2 + 0.35 * air.down));
    const cardH = inner + Math.max(withPortrait ? ps : 0, rowsH) + Math.round(u * (0.35 + 0.35 * air.down)) - (head.cut ?? 0);
    const gapV = Math.ceil(tabH / 2 + m.S + u * (0.25 + 0.5 * air.down));
    const height = cardTop + n * cardH + (n - 1) * gapV + m.S + Math.round(u * (0.35 + 0.3 * air.down));
    const frame = (i: number): Rect => ({ x: pad, y: cardTop + i * (cardH + gapV), w: cw, h: cardH });
    return { width: maxW, cardTop, pad, tabH, cpad, rowH, gaugeH, valueGap, label, value, words, left, right, cw, rowsH, ps, withPortrait, start, x0, x1, inner, cardH, gapV, height, frame };
  }

  /** Where the cards end: the last card's foot, its frame's shadow included. Below it the band is plain paper. */
  get contentBottom(): number {
    const last = this.cards.at(-1)?.rect;
    return last ? last.y + last.h + (this.framed ? measures(this.u).S : 0) : this.height;
  }

  /**
   * Ends the band at `height`, no higher than the cards' foot: where only plain paper below the last card would make the
   * cards scroll, the paper is trimmed instead (the owner, 2026-10-28: there it "is invisible space that is being adjusted").
   */
  trimTo(height: number): void {
    const h = Math.max(this.contentBottom, Math.min(this.height, height));
    this.band?.clear().rect(0, 0, this.width, h).fill(PAPER);
    this.height = h;
  }

  private band: Graphics | null = null;

  /** The paper band behind the cards, with the page's heading over its cyan dots where it has one; a tap on it stays on the page. */
  private drawBand(maxW: number, height: number, head: { title: Text; cardTop: number; tabH: number } | null): void {
    const u = this.u;
    const band = new Graphics().rect(0, 0, maxW, height).fill(PAPER);
    this.band = band;
    band.eventMode = 'static';
    this.container.addChild(band);
    if (!head) return;
    const dw = Math.min(maxW * 0.6, head.title.width + u * 2);
    benDay(band, { x: u * 0.3, y: u * 0.2, w: dw, h: head.cardTop - head.tabH / 2 - u * 0.3 }, { color: POP_CYAN, alpha: 0.6, pitch: u * 0.5, from: [dw, head.cardTop], to: [0, 0] });
    this.container.addChild(head.title);
  }

  /** A framed card, as the desktop box score draws its own, with the member's name on a tab across its top edge. */
  private drawFrame(i: number, r: Rect, tabH: number): Graphics {
    const u = this.u, m = measures(u);
    const card = new Graphics();
    drawPanel(card, r.x, r.y, r.w, r.h, m, { fill: BOX });
    const edge = new Graphics().rect(r.x, r.y, r.w, r.h).stroke({ width: Math.max(2.5, m.L * 1.4), color: INK });
    this.container.addChild(card, edge);
    this.tabs[i]!.container.position.set(r.x + Math.round(u * 0.4), Math.round(r.y - tabH / 2));
    this.framed = true;
    return card;
  }

  private buildStatsCards(g: GameContext, layout: ReturnType<PhoneSheets['statsLayout']>): void {
    const u = this.u, m = measures(u);
    const { cardTop, pad, tabH, cpad, rowH, gaugeH, valueGap, label, value, words, left, right, rowsH, ps, withPortrait, x0, x1, inner, cardH, height } = layout;
    this.width = layout.width;
    this.height = height;
    this.firstCardBottom = cardTop + cardH;
    const bars = new Graphics();
    g.state.order.forEach((id, i) => {
      const mm = g.state.members[id]!, r = layout.frame(i), top = r.y;
      this.drawFrame(i, r, tabH);
      if (withPortrait) {
        const pic = portrait(g.content.party.members[id]!.look, ps, u, mm.hp <= 0);
        pic.position.set(pad + cpad, top + inner);
        this.container.addChild(pic); this.portraits.push({ x: pic.x, y: pic.y, w: ps, h: ps });
      } else this.portraits.push(null);
      const rowsTop = top + inner + Math.max(0, Math.round(((withPortrait ? ps : 0) - rowsH) / 2));
      for (const [col, x] of [[left, x0], [right, x1]] as const) {
        col.keys.forEach((key, r) => {
          const mid = rowsTop + r * rowH + rowH / 2;
          const name = label(key), number = value(words(id, key));
          name.anchor.set(0, 0.5); number.anchor.set(0, 0.5);
          name.position.set(x, mid); number.position.set(x + col.labelW + valueGap, mid);
          this.container.addChild(name, number);
        });
      }
      // The XP still needed sits over a cyan gauge of the way there, as on the desktop card.
      const xpFrac = Math.max(0, Math.min(1, mm.xp / Math.max(1, xpToNext(g.content, mm.level))));
      const q = { x: x0, y: rowsTop + rowH * 2 + Math.round(u * 0.05), w: left.w, h: gaugeH };
      bars.rect(q.x, q.y, q.w, q.h).fill(PAPER_DARK);
      if (xpFrac > 0) bars.rect(q.x, q.y, q.w * xpFrac, q.h).fill(POP_CYAN);
      bars.rect(q.x, q.y, q.w, q.h).stroke({ width: m.l, color: INK });
      this.cards.push({ rect: layout.frame(i), xpFrac, portrait: withPortrait });
    });
    this.container.addChild(bars, this.vitalLayer, ...this.tabs.map(t => t.container), this.marksG);
  }

  /**
   * The Vitals and item sheets in the Stats page's very frames (option A): the same card in the same place on every page,
   * only what is inside it changing. The portrait stands where the Stats card has it, and Health and Energy (or the one bar
   * an item touches) sit beside it, centred on it.
   */
  /** The matched cards' bars: each one's height, the gap between them, and all of them together. */
  private vitalRows(): { barH: number; barGap: number; contentH: number } {
    const u = this.u, barH = Math.round(u * 1.35), barGap = Math.round(u * 0.45), n = this.fields.length;
    return { barH, barGap, contentH: n * barH + (n - 1) * barGap };
  }

  /**
   * How far a matched card's frame reaches below its bars and portrait: the room it keeps for the Stats page's third row. A
   * narrow phone at large text shrinks the portrait, so there the bars, centred on it, leave much of the card empty below
   * them (the owner, 2026-10-28, of the first iPhone SE at the largest text: "why is there so much padding at the bottom of
   * each character's card?").
   */
  private matchedSpare(layout: ReturnType<PhoneSheets['statsLayout']>): number {
    const { contentH } = this.vitalRows(), { ps, withPortrait, rowsH } = layout;
    const used = withPortrait ? Math.max(ps, Math.ceil((ps + contentH) / 2)) : contentH;
    return Math.max(0, Math.floor(Math.max(withPortrait ? ps : 0, rowsH) - used));
  }

  private buildMatched(g: GameContext, layout: ReturnType<PhoneSheets['statsLayout']>): void {
    const u = this.u, { cardTop, tabH, cpad, ps, withPortrait, inner, cardH, height } = layout;
    this.width = layout.width;
    this.height = height;
    this.firstCardBottom = cardTop + cardH;
    const { barH, barGap, contentH } = this.vitalRows(), side = Math.round(u * 0.9);
    g.state.order.forEach((id, i) => {
      const mm = g.state.members[id]!, r = layout.frame(i);
      this.plates.push(this.drawFrame(i, r, tabH));
      let x0 = r.x + cpad;
      if (withPortrait) {
        const pic = portrait(g.content.party.members[id]!.look, ps, u, mm.hp <= 0);
        pic.position.set(r.x + cpad, r.y + inner);
        this.container.addChild(pic); this.portraits.push({ x: pic.x, y: pic.y, w: ps, h: ps });
        x0 = pic.x + ps + side;
      } else this.portraits.push(null);
      const mid = withPortrait ? r.y + inner + ps / 2 : r.y + inner + (r.h - inner) / 2;
      const first = { x: x0, y: Math.round(mid - contentH / 2), w: r.x + r.w - side - x0, h: barH };
      const second = { ...first, y: first.y + barH + barGap };
      this.drawGauges(g, i, { hp: first, mp: this.mode.stat ? first : second });
      this.cards.push({ rect: r, xpFrac: Math.max(0, Math.min(1, mm.xp / Math.max(1, xpToNext(g.content, mm.level)))), portrait: withPortrait });
    });
    this.container.addChild(this.vitalLayer, ...this.tabs.map(t => t.container), this.marksG);
  }

  /** Paints only the visible vitals, keeping the native words for an item preview. */
  private drawGauges(g: GameContext, i: number, r: { hp: Rect; mp: Rect }): void {
    const u = this.u;
    const m = measures(u);
    const mm = g.state.members[g.state.order[i]!]!;
    const { hp, mp } = r;
    this.vitalDraws[i] = {};
    this.faces[i] = {};
    const number = (stat: 'hp' | 'mp', atMax = false): string[] => {
      if (atMax) return this.members.flatMap(mem => stat === 'hp'
        ? [g.msg('battle', 'hp_line', { hp: mem.maxHp, max: mem.maxHp })]
        : [`${mem.maxMp}/${mem.maxMp}`]);
      return [stat === 'hp'
        ? mm.hp > 0 ? g.msg('battle', 'hp_line', { hp: mm.hp, max: mm.maxHp }) : g.msg('battle', 'down')
        : `${mm.mp}/${mm.maxMp}`];
    };
    const style = (font: number, fill = INK) => ({ fontFamily: FONT.headline, fontWeight: '700' as const, fontSize: font, fill });
    const width = (words: string, font: number) => { const t = new Text({ text: words, style: style(font) }); const w = t.width; t.destroy(); return w; };
    /** A number's width with its halo, which the stroke adds to the text's bounds. */
    const numberWidth = (words: string, font: number) => { const t = new Text({ text: words, style: { ...style(font), stroke: numberHalo(font) } }); const w = t.width; t.destroy(); return w; };
    const pad = Math.round(u * BAR_PAD);
    const health = g.msg('battle', 'hp_label'), energy = g.msg('battle', 'mp_label');
    const labelGap = Math.round(u * 0.6);
    const maxFont = Math.min(Math.round(u * 1.2), Math.floor(Math.min(hp.h, mp.h) / 1.15));
    let font = maxFont, labelW = 0;
    for (; font > 0; font--) {
      labelW = Math.ceil(Math.max(width(health, font), width(energy, font)));
      const barW = Math.min(hp.w, mp.w) - labelW - labelGap;
      const words = [...number('hp', true), ...number('mp', true), g.msg('battle', 'down')];
      if (Math.max(...words.map(t => numberWidth(t, font))) <= barW - pad * 2) break;
    }
    if (!font) throw new Error('Party numbers have no fitting one-line size');
    // All pages and members share a label column; only the numbers occupy the gauge.
    const gauge = (r: Rect): Rect => ({ ...r, x: r.x + labelW + labelGap, w: r.w - labelW - labelGap });
    const hpGauge = gauge(hp), mpGauge = gauge(mp);
    for (const [stat, q, labelX] of [['hp', hpGauge, hp.x], ['mp', mpGauge, mp.x]] as const) {
      if (!this.fields.includes(stat)) continue;
      const root = new Container(), paint = new Graphics(), ink = new Container(), edge = new Graphics();
      const words = number(stat)[0]!;
      const label = new Text({ text: stat === 'hp' ? health : energy, style: style(font, INK) });
      label.anchor.set(0, 0.5);
      label.position.set(labelX, q.y + q.h / 2 - font * 0.05);
      const labelPlate = new Graphics().rect(label.x - pad, label.y - label.height / 2 - m.l / 2, label.width + pad * 2, label.height + m.l).fill(PAPER);
      this.faces[i]![stat] = { root, sources: [], label };
      // The number carries a paper halo so it reads the same wherever the fill ends, with the fill running on behind it; the gauge's outline
      // (`edge`) is drawn over the number, so the halo never crosses it.
      const value = new Text({ text: words, style: { ...style(font, stat === 'hp' && mm.hp / mm.maxHp <= LOW_HP ? RED_INK : INK), stroke: numberHalo(font) } });
      value.anchor.set(1, 0.5);
      value.position.set(q.x + q.w - pad, q.y + q.h / 2 - font * 0.05);
      ink.addChild(value);
      this.faces[i]![stat]!.sources.push(value);
      root.addChild(paint, ink, edge, labelPlate, label);
      this.vitalLayer.addChild(root);
      const down = stat === 'hp' && mm.hp <= 0;
      const fill = stat === 'hp' && mm.hp / mm.maxHp <= LOW_HP ? VITAL.low : VITAL[stat];
      // The dots drift slowly along the fill while the page is open (held still with reduced motion), redrawn at most
      // thirty times a second; a gauge growing after an item draws through the same function.
      let shown = 0, drift = 0, drawnAt = -1;
      const draw = (frac: number) => {
        if (paint.destroyed) return;
        shown = frac;
        paint.clear().rect(q.x, q.y, q.w, q.h).fill(PAPER_DARK);
        vitalFill(paint, q, frac, fill, u, drift);
        if (down) {
          for (let hx = -q.h;hx < q.w;hx += Math.max(4, u * 0.4)) {
            const a = Math.max(0, hx), b = Math.min(q.w, hx + q.h);
            if (b > a) paint.moveTo(q.x + a, q.y + q.h - (a - hx)).lineTo(q.x + b, q.y + q.h - (b - hx));
          }
          paint.stroke({ width: 1, color: INK, alpha: 0.35 });
        }
        edge.clear().rect(q.x, q.y, q.w, q.h).stroke({ width: m.l, color: INK });
      };
      this.vitalDraws[i]![stat] = draw;
      draw(stat === 'hp' ? mm.hp / mm.maxHp : mm.maxMp ? mm.mp / mm.maxMp : 0);
      if (!down) anim.loop(paint, paint, (t) => {
        if (motion.reduced || t - drawnAt < 1 / 30) return;
        drawnAt = t;
        drift = (t / DRIFT_S) % 1;
        draw(shown);
      });
    }
    this.gauges.push({ hp: hpGauge, mp: mpGauge });
  }

  /** Marks the cards for an item being aimed, or clears the marks with null. */
  mark(aim: Aim | null): void {
    this.aim = aim;
    const u = this.u;
    const m = measures(u);
    const g = this.marksG.clear();
    this.plates.forEach((plate, i) => {
      const r = this.cards[i]!.rect;
      if (this.framed) {
        plate.clear(); drawPanel(plate, r.x, r.y, r.w, r.h, m, { fill: aim?.cursor === i ? targetCardFill() : BOX });
        if (aim?.cursor === i) decorateTargetCard(plate, r, u);
        for (const f of Object.values(this.faces[i] ?? {})) if (f) f.root.visible = true;
        return;
      }
      plate.clear().rect(r.x, r.y, r.w, r.h).fill(aim?.cursor === i ? targetCardFill() : PAPER);
      if (aim?.cursor === i) decorateTargetCard(plate, r, u);
      if (i < this.cards.length - 1) plate.moveTo(r.x, r.y + r.h + (this.cards[i + 1]!.rect.y - r.y - r.h) / 2).lineTo(r.x + r.w, r.y + r.h + (this.cards[i + 1]!.rect.y - r.y - r.h) / 2).stroke({ width: m.l, color: INK_FAINT });
      for (const f of Object.values(this.faces[i] ?? {})) if (f) f.root.visible = true;
    });
    this.tabs.forEach((t, i) => t.setInk(aim?.cursor === i ? 'pink' : aim?.cannot.includes(i) || this.members[i]!.hp <= 0 ? 'faint' : 'ink'));
    if (!aim) { this.targetBox.show(null); this.itemPop.show(null); return; }
    for (const i of aim.cannot) { const r = this.cards[i]?.rect; if (r) g.rect(r.x, r.y, r.w, r.h).fill({ color: PAPER, alpha: .6 }); }
    const c = this.cards[aim.cursor];
    if (!c) { this.targetBox.show(null); this.itemPop.show(null); return; }
    this.container.addChildAt(this.targetBox.container, this.container.getChildIndex(this.plates[aim.cursor]!) + 1);
    // Leave room for the frame's square-ended glow inside the phone's left paper edge.
    const glowOutset = Math.SQRT2 * (Math.max(4, u * 0.3) + 12) / 2;
    const inset = Math.max(0, Math.ceil(glowOutset - c.rect.x));
    this.targetBox.show({ ...c.rect, x: c.rect.x + inset, w: c.rect.w - inset }, u);
    const p = aim.preview, mem = this.members[aim.cursor];
    if (p && mem) {
      const gr = this.gauges[aim.cursor]![p.stat], max = p.stat === 'hp' ? mem.maxHp : mem.maxMp;
      targetGain(g, gr, p.from, p.to, max, u);
      const f = this.faces[aim.cursor]![p.stat]!; f.root.visible = false;
      this.container.addChild(this.itemPop.container);
      const label = f.label, labelPad = Math.round(u * BAR_PAD);
      const top = Math.min(gr.y, label.y - label.height / 2 - m.l / 2);
      const popup = { x: label.x - labelPad, y: top, w: gr.x + gr.w - label.x + labelPad, h: Math.max(gr.y + gr.h, label.y + label.height / 2 + m.l / 2) - top };
      this.itemPop.show({
        key: `${aim.cursor}:${p.stat}`, kind: p.stat, rect: popup, u, from: p.from, to: p.to, max,
        native: { kind: 'battle', gauge: gr, sources: f.sources, label: f.label, fill: p.stat === 'hp' ? (mem.hp / mem.maxHp <= LOW_HP ? VITAL.low : VITAL.hp) : VITAL.mp, line: m.l, halo: true }
      });
    } else this.itemPop.show(null);
  }

  /** The marks shown, for the checks. */
  marks(): Aim | null {
    return this.aim;
  }

  /**
   * After an item, a member's gauge grows from where it stood to what it now shows. Its lettering masks
   * follow the fill on the shared stepper. The number has already changed. Reduce motion shows the
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
    const draw = this.vitalDraws[i]?.[stat];
    if (!draw) return;
    this.growing = { i, stat, from: a, to: b };
    draw(a);
    void anim.run(this, MS.gaugeGrow, EASE.out, (k) => {
      draw(a + (b - a) * k);
      if (k >= 1) this.growing = null;
    });
  }

  /** A gauge still growing, as shares of its length, for the checks; null when none is. */
  growing: { i: number; stat: 'hp' | 'mp'; from: number; to: number } | null = null;
}
