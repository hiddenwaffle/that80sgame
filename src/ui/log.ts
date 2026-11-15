import { CanvasTextMetrics, Container, Graphics, Text, TextStyle } from 'pixi.js';
import type { GameContext, LogEntry } from '../game/context.ts';
import { FONT } from '../render/fonts.ts';
import { INK, INK_FAINT, INK_SOFT } from '../render/palette.ts';
import { thumbReach } from '../engine/layout.ts';
import { pastePanel, riseSheet } from './anim.ts';
import { drawSheet, measures, shade, sheetGeometry, sheetRoom } from './print.ts';
import type { Screen } from './screens.ts';
import { MenuList, SMALL_TEXT, withSounds } from './widgets.ts';
import { uprightY } from '../engine/turn.ts';

/** Splits words where the first line `w` pixels wide ends: the words that fit on it, and the rest. */
export function firstLine(text: string, style: TextStyle, w: number): [string, string] {
  const words = text.split(/\s+/).filter(Boolean);
  const plain = style.clone();
  plain.wordWrap = false;
  let n = 0;
  while (n < words.length && CanvasTextMetrics.measureText(words.slice(0, n + 1).join(' '), plain).width <= w) n++;
  return [words.slice(0, n).join(' '), words.slice(n).join(' ')];
}

/** How many entries the log keeps: enough to reread a talk or a fight, not a whole game. */
export const LOG_SIZE = 40;

/**
 * A page to reread what was said lately and what happened in fights, oldest at the top and
 * newest at the bottom, where it opens. It scrolls by the arrow keys, a drag, or the mouse
 * wheel. Back, Cancel, or a tap outside closes it.
 */
export class LogScreen implements Screen {
  readonly container = new Container();
  readonly opaque = false;
  readonly blocking = true;
  readonly saveSafe = true;
  private readonly game: GameContext;
  private readonly onClose: () => void;
  /** The Back row, a list of one, so keys, pads, and taps all leave the same way. */
  menu!: MenuList;
  private readonly body = new Container();
  private readonly clipMask = new Graphics();
  private readonly bar = new Graphics();
  private scroll = 0;
  scrollMax = 0;
  private view = { x: 0, y: 0, w: 0, h: 0 };
  private drag: { y: number; scroll: number } | null = null;
  private step = 0;
  /** How many entries are shown, for the browser checks. */
  shown = 0;

  constructor(game: GameContext, onClose: () => void) {
    this.game = game;
    this.onClose = onClose;
    this.layout();
    game.audio.play('confirm');
  }

  private close(): void {
    this.game.audio.play('cancel');
    this.onClose();
  }

  /** What moves as the page opens, and how. */
  private opening: { skins: Container[]; shade: Graphics; bottom: boolean } | null = null;

  /**
   * The page: a sheet rising from the foot of an upright phone, or a card elsewhere, with RECENT LINES on its
   * tab, set as a newspaper column over the Back row. A speaker's name is run in before their words, narration
   * is italic, and fight lines are italic in soft ink with a rule at their left.
   */
  layout(): void {
    const g = this.game;
    const l = g.layout;
    const p = l.panel;
    const u = l.unit;
    // Built again for a new size: the reader keeps their place, counted from the newest line.
    const fromEnd = this.scrollMax - this.scroll;
    // The page's own lasting parts are kept; everything else, and the old entries, are destroyed.
    this.container.removeChild(this.body, this.clipMask, this.bar);
    for (const c of this.container.removeChildren()) c.destroy({ children: true });
    for (const c of this.body.removeChildren()) c.destroy();
    const sh = shade(p.w, p.h);
    // A tap outside the page closes it, like the cancel key.
    sh.on('pointertap', () => this.close());
    this.container.addChild(sh);

    this.menu = new MenuList([{ label: g.msg('menu', 'back'), onChoose: () => this.close() }], { bare: true });
    withSounds(this.menu, (s) => g.audio.play(s));
    this.menu.onCancel = () => this.close();
    const bottom = thumbReach(l);
    const maxW = u * 30;
    const room = sheetRoom(l, { titled: true, maxW });
    this.menu.build(u, room.w, { w: room.w });
    const barW = Math.round(u * 0.9);
    const textW = Math.round(room.w - barW);

    // The entries, oldest first.
    const entries = g.log;
    this.shown = entries.length;
    const rules = new Graphics();
    this.body.addChild(rules);
    const m = measures(u);
    const lineH = Math.round(u * 1.3);
    const indent = Math.round(u * 0.7);
    let y = 0;
    const gap = Math.round(u * 0.6);
    const style = (e: LogEntry, w: number) =>
      new TextStyle({ fontFamily: FONT.body, fontStyle: e.kind === 'line' ? 'normal' : 'italic', fontSize: Math.round(u * 1.0), fill: e.kind === 'fight' ? INK_SOFT : INK, wordWrap: true, wordWrapWidth: w, lineHeight: lineH });
    for (const e of entries) {
      const x = e.kind === 'fight' ? indent : 0;
      const w = textW - x;
      let rest = e.text;
      const top = y;
      if (e.speaker) {
        const name = new Text({ text: e.speaker.toUpperCase(), style: { fontFamily: FONT.headline, fontWeight: '700', fontSize: Math.round(u * SMALL_TEXT), fill: INK, letterSpacing: 1 } });
        this.body.addChild(name);
        const after = name.width + Math.round(u * 0.45);
        const [first, more] = after <= w * 0.4 ? firstLine(e.text, style(e, w), w - after) : ['', e.text];
        if (first) {
          // The name run in before the first line, on its baseline.
          name.position.set(x, Math.round(y + (lineH - name.height) / 2 + u * 0.05));
          const t = new Text({ text: first, style: style(e, w - after) });
          t.position.set(x + after, y);
          this.body.addChild(t);
          y += lineH;
          rest = more;
        } else {
          // A name too long to run in sits above its line.
          name.position.set(x, y);
          y += name.height;
        }
      }
      if (rest) {
        const t = new Text({ text: rest, style: style(e, w) });
        t.position.set(x, y);
        this.body.addChild(t);
        y += t.height;
      }
      if (e.kind === 'fight') rules.rect(0, top + u * 0.15, m.l, y - top - u * 0.3).fill(INK_SOFT);
      y += gap;
    }
    if (!entries.length) {
      const none = new Text({ text: g.msg('log', 'empty'), style: { fontFamily: FONT.body, fontStyle: 'italic', fontSize: Math.round(u * 1.0), fill: INK_FAINT } });
      this.body.addChild(none);
      y = none.height + gap;
    }
    const contentH = Math.max(0, y - gap);
    this.step = lineH * 2;

    // The column takes the room it needs, up to what the sheet has over the Back row.
    const below = gap + this.menu.height;
    const viewH = Math.max(lineH * 2, Math.round(Math.min(room.h - below, contentH)));
    const geo = sheetGeometry(l, { w: room.w, h: viewH + below }, { titled: true, maxW });
    const sheet = drawSheet(geo, u, g.msg('log', 'title'));
    this.container.addChild(sheet.root);
    this.view = { x: geo.inner.x, y: geo.inner.y, w: textW, h: viewH };
    // The column takes its own taps and drags, so they scroll it rather than close the page.
    const zone = new Graphics().rect(this.view.x, this.view.y, textW + barW, viewH).fill({ color: 0xffffff, alpha: 0.001 });
    zone.eventMode = 'static';
    zone.on('pointerdown', (e) => (this.drag = { y: uprightY(e.global), scroll: this.scroll }));
    zone.on('globalpointermove', (e) => {
      if (!this.drag) return;
      if (e.pointerType === 'mouse' && !e.buttons) return void (this.drag = null);
      this.setScroll(this.drag.scroll - (uprightY(e.global) - this.drag.y));
    });
    const end = () => (this.drag = null);
    zone.on('pointerup', end);
    zone.on('pointerupoutside', end);
    zone.on('wheel', (e) => this.setScroll(this.scroll + e.deltaY));
    // A rule closes the column over the Back row.
    sheet.face.addChild(new Graphics().rect(geo.inner.x, this.view.y + viewH + Math.round(gap / 2), geo.inner.w, m.l).fill(INK));
    this.clipMask.clear().rect(this.view.x, this.view.y, textW + barW, viewH).fill(0xffffff);
    this.body.mask = this.clipMask;
    this.scrollMax = Math.max(0, contentH - viewH);
    this.container.addChild(zone, this.body, this.clipMask, this.bar);
    // It opens at the newest line; built again, it keeps the reader's place.
    this.setScroll(this.scrollMax - fromEnd);
    this.menu.container.position.set(geo.inner.x, this.view.y + viewH + gap);
    this.container.addChild(this.menu.container);
    this.opening = { skins: [sheet.face, this.body, this.clipMask, this.bar, ...this.menu.skins()], shade: sh, bottom };
  }

  /** Opening: the sheet rises on an upright phone, or the card is pressed onto the page. It takes input at once. */
  enter(): void {
    const o = this.opening;
    if (!o) return;
    if (o.bottom) riseSheet(this, o.skins, o.shade, this.game.layout.unit);
    else pastePanel(this, o.skins, measures(this.game.layout.unit).S);
  }

  private setScroll(s: number): void {
    this.scroll = Math.max(0, Math.min(this.scrollMax, s));
    this.body.position.set(this.view.x, this.view.y - this.scroll);
    this.bar.clear();
    if (!this.scrollMax) return;
    const u = this.game.layout.unit;
    const x = this.view.x + this.view.w + u * 0.45;
    const h = this.view.h;
    const thumb = Math.max(u * 1.2, (h * h) / (h + this.scrollMax));
    const ty = this.view.y + ((h - thumb) * this.scroll) / this.scrollMax;
    this.bar.moveTo(x, this.view.y).lineTo(x, this.view.y + h).stroke({ width: 1, color: INK_FAINT });
    this.bar.roundRect(x - u * 0.18, ty, u * 0.36, thumb, u * 0.18).fill(INK_SOFT);
  }

  /** How far the log is scrolled, for the browser checks. */
  get scrolled(): number {
    return this.scroll;
  }

  update(): void {
    const input = this.game.input;
    // Up and down scroll the lines (the Back row is all the list there is).
    if (input.pressedOrRepeat('up')) this.setScroll(this.scroll - this.step);
    if (input.pressedOrRepeat('down')) this.setScroll(this.scroll + this.step);
    input.consume('up');
    input.consume('down');
    this.menu.update(input);
  }

  destroy(): void {
    this.body.destroy({ children: true });
    this.container.destroy({ children: true });
  }
}

export type { LogEntry };
