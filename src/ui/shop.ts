import { Container, Graphics, Text } from 'pixi.js';
import type { GameContext } from '../game/context.ts';
import { FONT } from '../render/fonts.ts';
import { INK, INK_SOFT, POP_CYAN, POP_YELLOW } from '../render/palette.ts';
import { thumbReach } from '../engine/layout.ts';
import { pastePanel, riseSheet } from './anim.ts';
import { drawSheet, letterStyle, measures, shade, sheetGeometry, sheetRoom } from './print.ts';
import type { Screen } from './screens.ts';
import { MenuList, withSounds, type MenuItem } from './widgets.ts';

/**
 * A shop: one item per press, with the capitalism line when Dots run short.
 * Laid out as role-playing games' shops are: each row an item and its price, a price the Dots do
 * not cover faint; the Dots, and how many the party has of the item under the cursor, at the top.
 * A purchase is shown at the top for a moment.
 */
export class Shop implements Screen {
  readonly container = new Container();
  readonly opaque = false;
  readonly blocking = true;
  private readonly game: GameContext;
  private readonly onClose: () => void;
  private menu!: MenuList;
  private poorTimer = 0;
  /** What was just bought, shown at the top for a moment. */
  private bought = '';
  private boughtTimer = 0;
  /** The shopkeeper's line and the Dots, changed in place when a purchase is made or a line runs out. */
  private titleText: Text | null = null;
  private dotsText: Text | null = null;
  /** How many the party has of the item the band is on, beside the Dots; empty on Leave, and on touch until a row is pressed. */
  private haveText: Text | null = null;
  /** The items sold, in the rows' order. */
  private sold: string[] = [];
  private readonly prices: Readonly<Record<string, number>>;

  constructor(game: GameContext, onClose: () => void, prices: Readonly<Record<string, number>> = {}) {
    this.game = game;
    this.onClose = onClose;
    this.prices = prices;
    this.layout();
    game.audio.play('confirm');
  }

  private items(): MenuItem[] {
    const g = this.game;
    const sold = Object.entries(g.content.items).filter(([, it]) => it.sold);
    this.sold = sold.map(([id]) => id);
    const out: MenuItem[] = sold.map(([id, it], i) => {
      const price = this.prices[id] ?? it.price;
      return {
        label: it.name,
        // The price alone: the Dots at the top say what it is counted in.
        detail: String(price),
        // An (i) shows how many the party has without buying one: on touch the count shows only for the row the band is on
        // (the owner, 2026-11-11). The count itself is the line beside the Dots.
        help: this.have(i),
        info: 'right' as const,
        // Too dear for the Dots in hand: faint, but still chosen, for the line about capitalism.
        faint: g.state.dots < price,
        onChoose: () => {
          if (g.state.dots < price) {
            this.poorTimer = 1.6;
            this.boughtTimer = 0;
            g.audio.play('cancel');
            this.refresh();
            return;
          }
          g.state.dots -= price;
          g.state.items[id] = (g.state.items[id] ?? 0) + 1;
          g.audio.play('buy');
          this.bought = g.msg('shop', 'bought', { item: it.name });
          this.boughtTimer = 1.6;
          this.poorTimer = 0;
          this.refresh();
        },
      };
    });
    out.push({ id: 'back', label: g.msg('shop', 'leave'), onChoose: () => this.close() });
    return out;
  }

  /** What the top says now: the line about capitalism, a purchase, or the greeting. */
  private line(): string {
    const g = this.game;
    return this.poorTimer > 0 ? g.msg('shop', 'poor') : this.boughtTimer > 0 ? this.bought : g.msg('shop', 'greeting');
  }

  /** How many the party has of the item on row `i`, or nothing for Leave. */
  private have(i: number): string {
    const id = this.sold[i];
    if (id === undefined) return '';
    const item = this.game.content.items[id]!;
    const count = this.game.state.items[id] ?? 0;
    return this.game.msg('shop', 'have', { count, item: count === 1 ? item.name : item.plural ?? `${item.name}s` });
  }

  /**
   * Shows new words and numbers in place, keeping the rows themselves, so a finger already on a
   * row still taps it. The page is built again only when its rows change in number.
   */
  private refresh(): void {
    const g = this.game;
    if (!this.titleText || !this.dotsText || !this.haveText || !this.menu.refresh(this.items())) return this.layout();
    this.titleText.text = this.line();
    this.dotsText.text = g.msg('shop', 'dots', { dots: g.state.dots });
    this.haveText.text = this.have(this.menu.shown);
  }

  private close(): void {
    this.game.audio.play('cancel');
    this.onClose();
  }

  layout(): void {
    const g = this.game;
    const p = g.layout.panel;
    const u = g.layout.unit;
    const idx = this.menu?.index ?? 0;
    const items = this.items();
    for (const c of this.container.removeChildren()) c.destroy({ children: true });
    const sh = shade(p.w, p.h);
    // A tap outside leaves the shop, as on every other page.
    sh.on('pointertap', () => this.close());
    this.container.addChild(sh);

    const head = new Container();
    const hb = new Graphics();
    // The widest the balloon's words may run.
    const wordRoom = Math.min(p.w - u * 3, u * 22);
    const title = new Text({
      text: this.line(),
      style: { fontFamily: FONT.balloon, fontWeight: '700', fontSize: Math.round(u * 1.2), fill: INK, wordWrap: true, wordWrapWidth: wordRoom },
    });
    const dots = new Text({ text: g.msg('shop', 'dots', { dots: g.state.dots }), style: letterStyle(Math.round(u * 1.25), INK) });
    // How many the party has of the item under the cursor, beside the tag.
    const have = new Text({ text: this.have(idx), style: { fontFamily: FONT.balloon, fontWeight: '700', fontSize: Math.round(u * 1.1), fill: INK_SOFT } });
    this.titleText = title;
    this.dotsText = dots;
    this.haveText = have;
    // Room for the longest and widest line the top can show, so nothing moves when a purchase is shown.
    const lines = [g.msg('shop', 'greeting'), g.msg('shop', 'poor'), ...Object.values(g.content.items).map((it) => g.msg('shop', 'bought', { item: it.name }))];
    let tallest = 0;
    let widest = dots.width;
    for (const l of lines) {
      const t = new Text({ text: l, style: title.style });
      tallest = Math.max(tallest, t.height);
      widest = Math.max(widest, t.width);
      t.destroy();
    }
    // The tag and, beside it, room for the most the count may say; where that is too wide (large text on a narrow
    // phone), the count goes under the tag.
    const counts = Object.values(g.content.items).filter((it) => it.sold).flatMap((it) => [it.name, it.plural ?? `${it.name}s`]);
    const mostOf = () => {
      let mw = 0, mh = 0;
      for (const name of counts) {
        const most = new Text({ text: g.msg('shop', 'have', { count: 99, item: name }), style: have.style });
        [mw, mh] = [Math.max(mw, most.width), Math.max(mh, most.height)];
        most.destroy();
      }
      return { mw, mh };
    };
    let most = mostOf();
    const beside = dotsRoom(dots.width, u) + u + most.mw <= wordRoom;
    if (!beside) {
      have.style.wordWrap = true;
      have.style.wordWrapWidth = wordRoom;
      most = mostOf();
    }
    widest = Math.max(widest, beside ? dotsRoom(dots.width, u) + u + most.mw : most.mw);
    const w = widest + u * 2.4;
    const m = measures(u);
    title.position.set(u * 1.2, u * 0.6);
    // The Dots on a yellow tag, set a little crooked, at the balloon's foot.
    const tagH = Math.round(dots.height * 0.85 + u * 0.3);
    const tagY = Math.round(title.y + tallest + u * 0.4);
    dots.anchor.set(0, 0.5);
    dots.position.set(Math.round(u * 0.4), Math.round(tagH / 2 - u * 0.1));
    const haveY = Math.round(tagY + tagH + u * 0.4);
    const hh = beside ? tagY + tagH + u * 0.7 : haveY + most.mh + u * 0.6;
    const r = Math.min(hh / 2, u * 1.4);
    const off = Math.round(m.S * 1.1);
    hb.roundRect(off, off, w, hh, r).fill(POP_CYAN);
    hb.roundRect(0, 0, w, hh, r).fill(0xffffff).stroke({ width: Math.round(m.L * 1.2), color: INK });
    // The tag and its words turn together.
    const tag = new Container();
    const tagG = new Graphics();
    tagG.rect(m.S * 0.8, m.S * 0.8, dotsRoom(dots.width, u), tagH).fill(INK);
    tagG.rect(0, 0, dotsRoom(dots.width, u), tagH).fill(POP_YELLOW).stroke({ width: m.L, color: INK });
    tag.addChild(tagG, dots);
    tag.position.set(u * 1.2, tagY);
    tag.rotation = -0.03;
    if (beside) {
      have.anchor.set(0, 0.5);
      have.position.set(Math.round(tag.x + dotsRoom(dots.width, u) + u), Math.round(tagY + tagH / 2));
    } else have.position.set(Math.round(tag.x), haveY);
    // A tap on the box stays in the shop; only a tap outside leaves.
    hb.eventMode = 'static';
    head.addChild(hb, tag, title, have);

    this.menu = new MenuList(items, { bare: true });
    this.menu.index = idx;
    // On touch the band rests on Leave (the owner, 2026-11-12).
    this.menu.restOn(items.findIndex((it) => it.id === 'back'));
    this.menu.onCancel = () => this.close();
    withSounds(this.menu, (s) => g.audio.play(s));
    // The count follows the band: the cursor's row, or on touch the row pressed, or tapped last (Leave, with no count, when the shop opens).
    const blip = this.menu.onMove;
    this.menu.onMove = (i) => {
      blip?.(i);
      have.text = this.have(i);
    };
    // The list is on a sheet, rising from the foot of an upright phone within reach of a thumb, or a card
    // elsewhere, with the shopkeeper's balloon above it.
    const l = g.layout;
    const bottom = thumbReach(l);
    const gap = Math.round(u * 0.6);
    const above = Math.ceil(head.height) + gap;
    const maxW = u * 24;
    const room = sheetRoom(l, { titled: false, maxW, above });
    this.menu.build(u, bottom ? room.w : Math.min(room.w, Math.max(u * 14, w * 0.6)), { w: room.w, h: room.h });
    have.text = this.have(this.menu.shown);
    const geo = sheetGeometry(l, { w: this.menu.width, h: this.menu.height }, { titled: false, maxW, above });
    const sheet = drawSheet(geo, u);
    this.menu.container.position.set(geo.inner.x, geo.inner.y);
    head.position.set(Math.round(bottom ? geo.inner.x : Math.max(u * 0.5, Math.min(geo.plate.x, p.w - u * 0.5 - head.width))), Math.round(geo.top - gap - head.height));
    this.container.addChild(sheet.root, head, this.menu.container);
    this.opening = { skins: [sheet.face, head, ...this.menu.skins()], shade: sh, bottom };
  }

  /** What moves as the page opens, and how. */
  private opening: { skins: Container[]; shade: Graphics; bottom: boolean } | null = null;

  /** Opening: the sheet rises on an upright phone, or the card is pressed onto the page. It takes input at once. */
  enter(): void {
    const o = this.opening;
    if (!o) return;
    if (o.bottom) riseSheet(this, o.skins, o.shade, this.game.layout.unit);
    else pastePanel(this, o.skins, measures(this.game.layout.unit).S);
  }

  update(dt: number): void {
    if (this.poorTimer > 0) {
      this.poorTimer -= dt;
      if (this.poorTimer <= 0) this.refresh();
    }
    if (this.boughtTimer > 0) {
      this.boughtTimer -= dt;
      if (this.boughtTimer <= 0) this.refresh();
    }
    this.menu.update(this.game.input);
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}

/** The yellow tag's width: room for the most Dots the party may carry, so it does not change size as they are spent. */
function dotsRoom(w: number, u: number): number {
  return Math.round(Math.max(w, u * 6) + u * 0.8);
}
