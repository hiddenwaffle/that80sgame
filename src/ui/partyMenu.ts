import { Container, Graphics, Rectangle } from 'pixi.js';
import { thumbReach } from '../engine/layout.ts';
import { uprightY } from '../engine/turn.ts';
import { INK } from '../render/palette.ts';
import type { GameContext } from '../game/context.ts';
import { itemBlocked, neediest, previewItem } from '../game/items.ts';
import { pastePanel, riseSheet } from './anim.ts';
import { drawSheet, measures, shade, sheetGeometry } from './print.ts';
import { SettingsScreen, type Screen } from './screens.ts';
import { Caption, enabledMenuIndex, MenuList, withSounds, type MenuItem } from './widgets.ts';
import { BoxScore } from './boxScore.ts';
import { PhoneSheets } from './phone_sheets.ts';

/** How long a result stays in the caption, unless the cursor moves first. */
const NOTICE_TIME = 3;

/**
 * The Stats/Item screen: every member's numbers, the Dots, and menus to use
 * items or change settings. A caption says what the last choice did, or
 * what the row under the cursor would do. On a phone held upright the members
 * are stacked, each with their portrait beside their name, and the stack
 * scrolls when it is taller than the room the list leaves it.
 */
export class PartyMenu implements Screen {
  readonly container = new Container();
  readonly opaque = false;
  readonly blocking = true;
  readonly saveSafe = true;
  private readonly game: GameContext;
  private readonly onClose: () => void;
  private menu!: MenuList;
  /** The open lists, innermost last, each with where its cursor was. */
  private stack: Array<{ make: () => MenuList; index: number }> = [];
  private sub: SettingsScreen | null = null;
  private caption: Caption | null = null;
  /** Reflow only after the menu's current input handler has finished using its rows. */
  private captionLayoutPending = false;
  /** The fit choice belongs to the screen/text size, so changing lists never changes the cards. */
  private phoneFields = false;
  private statsPage = false;
  private fitLayoutKey = '';
  private tightForLayout = false;
  private omitSecondaryForLayout = false;
  /** One measured upright phone block keeps every list's first row in place. */
  private phoneAnchor: { top: number; row: number; height: number; requiredHeight: number; shared: boolean } | null = null;
  private phoneAnchorKey = '';
  /** Whether the pages without a heading keep its room on a phone, so their cards stay where the Stats page's are (only where the pages share one menu row). */
  private phoneReserve = false;
  /** How deep the stack was when the open list was built, so a relayout keeps its cursor. */
  private builtDepth = 0;
  /**
   * On touch, the row a tap left the band on, for the list built next at the same depth: after an item is used, and when the
   * caption's new height lays the page out again, the list stays as the player left it. Any other build starts with no row lit.
   */
  private keepTapped = -1;
  /** While the page measures trial lists: they are drawn as for keys, their caption the cursor row's, on every device. */
  private measuring = false;
  /** A result being shown in the caption, and for how much longer. */
  private notice = '';
  private noticeTime = 0;
  /** The box score, and the item being aimed at the party while its on-whom list is open. */
  box: BoxScore | PhoneSheets | null = null;
  private aiming: string | null = null;
  /** A gauge to grow on the next drawing, after an item was used. */
  private grown: { i: number; stat: 'hp' | 'mp'; from: number } | null = null;
  private shade: Graphics | null = null;
  /** What the opening presses on for the box score: the box itself, or the window it scrolls in. */
  private boxSkin: Container | null = null;
  /** The window a stacked box score scrolls in, when it is taller than its room; how far it is scrolled is kept across relayouts. */
  boxView: { max: number; viewH: number; set: (s: number) => void } | null = null;
  boxScroll = 0;
  /** Whether the finger on the stacked cards has moved enough to scroll them, so lifting it is not a tap on a card. */
  private boxDragged = false;
  /** While an item is aimed, each member's card as a tap target (for the browser checks to find). */
  cardHits: Graphics[] = [];

  /**
   * Opening: the box score is pressed onto the page, and the list with its caption rises from the foot of
   * an upright phone or is pressed on with it elsewhere. The page takes input at once.
   */
  enter(): void {
    const u = this.game.layout.unit;
    const S = measures(u).S;
    const list = [...(this.sheetFace ? [this.sheetFace] : []), ...this.menu.skins(), ...(this.caption?.skins() ?? [])];
    if (this.boxSkin) pastePanel(this, this.boxSkin, S);
    if (thumbReach(this.game.layout)) riseSheet(this, list, this.shade, u);
    else pastePanel(this, list, S);
  }

  /** Whether the lists sit on a sheet at the page's foot (a phone held upright), with their titles on its tab. */
  private onSheet = false;
  /** The open list's title, for the sheet's tab. */
  private listTitle: string | null = null;
  private sheetFace: Container | null = null;

  /** A list: bare on the sheet, its title kept for the sheet's tab, or elsewhere with its own title tab. `across`: left and right move it too. */
  private list(items: MenuItem[], title?: string, across = false): MenuList {
    this.listTitle = title ?? null;
    return new MenuList(items, { ...(this.onSheet ? { bare: true } : title ? { title } : {}), across, ...(this.phoneFields ? { verticalPadding: 0 } : {}), measuring: this.measuring });
  }

  constructor(game: GameContext, onClose: () => void) {
    this.game = game;
    this.onClose = onClose;
    this.stack = [{ make: () => this.mainMenu(), index: 0 }];
    this.layout();
    game.audio.play('confirm');
  }

  private mainMenu(): MenuList {
    this.statsPage = false;
    const g = this.game;
    const items: MenuItem[] = [
      // On a phone the Dots sit at the Items row's right end, the page having no heading for them (the owner, 2026-10-28).
      { id: 'items', label: g.msg('party', 'items'), ...(this.phoneFields ? { detail: g.msg('party', 'dots', { dots: g.state.dots }) } : {}), onChoose: () => this.push(() => this.itemMenu()) },
      ...(this.phoneFields ? [{ id: 'stats', label: g.msg('party', 'stats'), onChoose: () => this.push(() => this.statsMenu()) }] : []),
      { id: 'settings', label: g.msg('party', 'settings'), onChoose: () => this.openSettings() },
      { id: 'save_code', label: g.msg('party', 'save_code'), onChoose: () => g.openSaveCode() },
      { id: 'quit', label: g.msg('party', 'quit'), onChoose: () => g.confirmQuit(true) },
      { id: 'back', label: g.msg('party', 'close'), onChoose: () => this.close() },
    ];
    // On a short, wide panel (a short desktop window) the Close row is left out rather than make the list
    // scroll: a tap outside the menu, or Cancel, closes it just the same.
    const { panel: p, unit: u } = g.layout;
    if (p.w > p.h * 1.1 && MenuList.heightFor(items.length, u, false) > p.h - u) items.pop();
    const m = this.list(items);
    // On touch the band rests on Items, or on the row chosen last this visit (the owner, 2026-11-12).
    m.restOn(0, { place: g.menuPlace?.('party') });
    m.onCancel = () => this.close();
    return m;
  }

  /** The separate phone sheet keeps the five non-vital stats and one way back. */
  private statsMenu(): MenuList {
    this.statsPage = true;
    const m = this.list([{ id: 'back', label: this.game.msg('menu', 'back'), onChoose: () => this.pop() }], this.game.msg('party', 'stats'));
    m.onCancel = () => this.pop();
    return m;
  }

  /** What an item does, from its numbers. */
  private effect(itemId: string): string {
    const g = this.game;
    const it = g.content.items[itemId]!;
    const parts: string[] = [];
    if (it.hp > 0) parts.push(g.msg('party', 'effect_hp', { hp: it.hp }));
    if (it.mp > 0) parts.push(g.msg('party', 'effect_mp', { mp: it.mp }));
    if (it.revive) parts.push(g.msg('party', 'effect_revive'));
    return parts.join(' ');
  }

  private itemMenu(): MenuList {
    this.statsPage = false;
    const g = this.game;
    const items: MenuItem[] = Object.entries(g.content.items)
      .filter(([id]) => (g.state.items[id] ?? 0) > 0)
      .map(([id, it]) => {
        const count = g.state.items[id] ?? 0;
        const reason = itemBlocked(it, g.state.order.map((id) => g.state.members[id]!), count, false);
        return {
          id, label: it.name,
          detail: [g.msg('menu', 'count', { count }), ...(reason ? [g.msg('item_unavailable', reason)] : [])].join(' · '),
          enabled: !reason,
          help: reason ? g.msg('item_unavailable', reason) : this.effect(id),
          info: 'right' as const,
          onChoose: () => this.push(() => this.memberMenu(id)),
        };
      });
    if (!items.length) items.push({ label: g.msg('menu', 'none'), enabled: false, onChoose: () => undefined });
    // A Back row, so touch players can leave the list without a keyboard.
    items.push({ id: 'back', label: g.msg('menu', 'back'), onChoose: () => this.pop() });
    const m = this.list(items, g.msg('party', 'items'));
    // On touch the band rests on Back, or on the item chosen last this visit while it is there to use (the owner, 2026-11-12).
    m.restOn(items.length - 1, { place: g.menuPlace?.('party_items') });
    m.onCancel = () => this.pop();
    return m;
  }

  private memberMenu(itemId: string): MenuList {
    this.statsPage = false;
    const g = this.game;
    const item = g.content.items[itemId]!;
    this.aiming = itemId;
    const items: MenuItem[] = g.state.order.map((id, i) => {
      const m = g.state.members[id]!;
      const name = g.content.party.members[id]!.name;
      const vitals = { hp: m.hp, maxHp: m.maxHp, mp: m.mp, maxMp: m.maxMp };
      const reason = itemBlocked(item, [vitals], g.state.items[itemId] ?? 0, false);
      const helps = !reason;
      // What using it would do, before choosing: HP or MP before and after, or why it would do nothing in the words a
      // fight's list uses ("Health full"; the owner, 2026-11-12). The list has no help box, so the reason is in the row,
      // and someone down reads DOWN even when the item is for Energy.
      const change = previewItem(item, vitals)[0];
      const detail = reason === 'needs_living'
        ? g.msg('battle', 'down')
        : reason
          ? g.msg('item_unavailable', reason)
          : change && g.msg('party', change.stat === 'hp' ? 'preview_hp' : 'preview_mp', { from: change.stat === 'hp' && change.from <= 0 ? g.msg('battle', 'down') : change.from, to: change.to });
      return {
        id, label: name,
        detail,
        enabled: helps,
        onChoose: () => {
          if (itemBlocked(item, [m], g.state.items[itemId] ?? 0, false)) return;
          g.state.items[itemId]! -= 1;
          const before = { hp: m.hp, mp: m.mp };
          if (item.hp && (m.hp > 0 || item.revive)) m.hp = Math.min(m.maxHp, m.hp + item.hp);
          if (item.mp) m.mp = Math.min(m.maxMp, m.mp + item.mp);
          g.audio.play('heal');
          const amount = m.hp - before.hp || m.mp - before.mp;
          // The member's card grows its gauge to the gain once the page is drawn again.
          this.grown = m.hp !== before.hp ? { i, stat: 'hp', from: before.hp } : { i, stat: 'mp', from: before.mp };
          this.notice = item.message.replace('{target}', name).replace('{amount}', String(amount)).replace('{actor}', name);
          this.noticeTime = NOTICE_TIME;
          if ((g.state.items[itemId] ?? 0) <= 0) this.pop(true);
          else this.rebuild();
        },
      };
    });
    items.push({ id: 'back', label: g.msg('menu', 'back'), onChoose: () => this.pop() });
    // The members' cards stand side by side on a wide page, so left and right move along them as well.
    const m = this.list(items, g.msg('party', 'use_on', { item: item.name, count: g.state.items[itemId] ?? 0 }), true);
    // On touch the band rests on whoever needs it most, with the glove, or on Back when it would help no one (the owner, 2026-11-12).
    const most = neediest(item, g.state.order.map((id) => g.state.members[id]!));
    const helps = most >= 0 && items[most]?.enabled !== false;
    m.restOn(helps ? most : items.length - 1, { glove: helps });
    m.onCancel = () => this.pop();
    return m;
  }

  /**
   * While an item is aimed, each member's card takes the mouse and the finger as the member's row does, as a fight's
   * figures do for its target list (the owner, 2026-10-13: "you should be able to click on them, not only the menu
   * item"): a tap uses the item on them, or is refused as a greyed row is, and the mouse over a card moves the cursor
   * there. A drag that scrolls the stacked cards is not a tap.
   */
  private wireCards(): void {
    const box = this.box;
    this.cardHits = [];
    if (!box || !this.aiming) return;
    this.cardHits = box.cards.map(({ rect: r }, i) => {
      const hit = new Graphics();
      hit.rect(r.x, r.y, r.w, r.h).fill({ color: 0xffffff, alpha: 0.001 });
      hit.label = `card_hit_${i}`;
      hit.eventMode = 'static';
      hit.cursor = 'pointer';
      hit.on('pointerover', (e) => {
        if (e.pointerType === 'mouse') this.aimAt(i);
      });
      hit.on('pointertap', () => {
        if (this.boxDragged) return;
        this.aimAt(i);
        this.menu.choose();
      });
      box.container.addChild(hit);
      return hit;
    });
  }

  /** Moves the open list's cursor to a member's row from their card, with the row's line, sound and marks (on touch, its band too). */
  private aimAt(i: number): void {
    this.menu.aim(i);
  }

  /** Marks the box score's cards for the item being aimed: the member under the cursor, those it cannot help, and what it would give. */
  private markAim(): void {
    const g = this.game;
    const id = this.aiming;
    if (!this.box) return;
    if (!id) return this.box.mark(null);
    const item = g.content.items[id]!;
    const n = g.state.order.length;
    // The member the band is on: on touch, none until a row or a card is pressed.
    const i = this.menu.shown;
    const cannot = this.menu.items.slice(0, n).flatMap((it, k) => (it.enabled === false ? [k] : []));
    const mm = i >= 0 && i < n ? g.state.members[g.state.order[i]!]! : null;
    const preview = mm ? (previewItem(item, { hp: mm.hp, maxHp: mm.maxHp, mp: mm.mp, maxMp: mm.maxMp })[0] ?? null) : null;
    this.box.mark({ cursor: mm ? i : -1, cannot, preview });
    this.revealAim();
  }

  /** In a scrolling stack, scrolls the aimed member's card into the window, its name tab included. */
  private revealAim(): void {
    const v = this.boxView;
    const c = this.box?.marks() ? this.box.cards[this.box.marks()!.cursor] : undefined;
    if (!v || !c) return;
    const u = this.game.layout.unit;
    const r = c.rect;
    if (r.y - u * 1.2 < this.boxScroll) v.set(r.y - u * 1.2);
    else if (r.y + r.h + u * 0.6 > this.boxScroll + v.viewH) v.set(r.y + r.h + u * 0.6 - v.viewH);
  }

  /** Puts the stacked box score in a window `viewH` high, scrolled by a drag or the wheel, with a thin bar at its right edge. */
  private scrollBox(tbl: Container, w: number, h: number, viewH: number): Container {
    const u = this.game.layout.unit;
    const root = new Container();
    const mask = new Graphics().rect(0, 0, w, viewH).fill(0xffffff);
    const bar = new Graphics();
    tbl.mask = mask;
    root.addChild(tbl, mask, bar);
    const max = h - viewH;
    const set = (to: number) => {
      this.boxScroll = Math.max(0, Math.min(max, to));
      tbl.y = -this.boxScroll;
      const bh = Math.max(u * 1.5, (viewH * viewH) / h);
      bar.clear().roundRect(w - u * 0.5, (this.boxScroll / max) * (viewH - bh), u * 0.22, bh, u * 0.11).fill({ color: INK, alpha: 0.55 });
    };
    root.eventMode = 'static';
    root.hitArea = new Rectangle(0, 0, w, viewH);
    // Measured as the window it shows, not the whole stack behind the mask.
    root.boundsArea = new Rectangle(0, 0, w, viewH);
    // A drag follows the finger that started it, and only that one.
    let drag: { id: number; y: number; from: number } | null = null;
    // A finger the system took away (a call, a gesture) never sends its lift to Pixi: such a drag is let go of, or the cards
    // would stop scrolling and ignore taps after it.
    const stale = () => drag !== null && !this.game.input.pointerDown(drag.id);
    root.on('pointerdown', (e) => {
      if (stale()) drag = null;
      if (drag) return;
      drag = { id: e.pointerId, y: uprightY(e.global), from: this.boxScroll };
      this.boxDragged = false;
    });
    root.on('globalpointermove', (e) => {
      if (stale()) drag = null;
      if (!drag || e.pointerId !== drag.id) return;
      if (e.pointerType === 'mouse' && !e.buttons) return void (drag = null);
      const dy = uprightY(e.global) - drag.y;
      // As the lists do: a finger that has moved this far is scrolling, and lifting it chooses nothing.
      if (Math.abs(dy) > 8) this.boxDragged = true;
      set(drag.from - dy);
    });
    const end = (e: { pointerId: number }) => {
      if (drag?.id === e.pointerId) drag = null;
    };
    root.on('pointerup', end);
    root.on('pointerupoutside', end);
    root.on('wheel', (e) => set(this.boxScroll + e.deltaY));
    this.boxView = { max, viewH, set };
    set(this.boxScroll);
    return root;
  }

  private push(make: () => MenuList): void {
    this.game.audio.play('confirm');
    this.stack[this.stack.length - 1]!.index = this.menu.index;
    this.stack.push({ make, index: 0 });
    this.noticeTime = 0;
    this.layout();
  }

  /** Back one list. `keepNotice` keeps a result showing, as after using the last of an item. */
  private pop(keepNotice = false): void {
    this.game.audio.play('cancel');
    if (this.stack.length > 1) this.stack.pop();
    if (!keepNotice) this.noticeTime = 0;
    this.layout();
  }

  private openSettings(): void {
    this.sub = new SettingsScreen(this.game, () => {
      this.sub?.destroy();
      this.sub = null;
      // Back from Settings, the list shows as it does when it appears: on touch the band where it rests, on Settings as the row chosen last.
      this.rebuild(false);
    }, 'main', this.game.menuPlace?.('party_settings'));
    this.container.addChild(this.sub.container);
    this.sub.enter();
  }

  private close(): void {
    this.game.audio.play('cancel');
    this.onClose();
  }

  /** Redraws with fresh numbers, keeping the cursor where it was, and on touch the band on the row tapped (unless `keepTap` is false). */
  private rebuild(keepTap = true): void {
    this.stack[this.stack.length - 1]!.index = this.menu.index;
    this.keepTapped = keepTap ? this.menu.tapped : -1;
    this.layout();
  }

  private showCaption(): void {
    const text = this.captionText();
    if (this.caption && this.caption.heightFor(text) !== this.caption.height) {
      this.captionLayoutPending = true;
      return;
    }
    this.caption?.set(text);
  }

  private captionText(): string {
    if (this.aiming) return '';
    // The line about the row the band is on: on touch, none until a row is pressed or its (i) tapped.
    return this.noticeTime > 0 ? this.notice : (this.menu.items[this.menu.shown]?.help ?? '');
  }

  /** Only the currently shown help reserves space under the list. */
  private captionLines(): string[] {
    return [this.captionText()];
  }

  layout(): void {
    const keepCursor = this.captionLayoutPending;
    if (this.menu && this.builtDepth === this.stack.length) this.stack[this.stack.length - 1]!.index = this.menu.index;
    const phone = Math.max(innerWidth, innerHeight) < 1100 && Math.min(innerWidth, innerHeight) < 820 && matchMedia('(pointer: coarse)').matches;
    this.phoneFields = phone;
    if (phone) {
      this.tightForLayout = true;
      this.omitSecondaryForLayout = false;
      const g = this.game;
      const key = JSON.stringify([g.layout, g.settings.textSize, g.state.order, g.state.items, g.state.order.map(id => g.state.members[id])]);
      if (key !== this.phoneAnchorKey) {
        this.phoneAnchor = null;
        this.phoneReserve = false;
        if (g.layout.panel.w <= g.layout.panel.h * 1.1 && thumbReach(g.layout)) this.measurePhoneAnchor();
        this.phoneAnchorKey = key;
      }
      this.layoutCards(false, keepCursor, { tight: true });
      return;
    }
    this.phoneAnchor = null;
    this.phoneReserve = false;
    this.phoneAnchorKey = '';
    {
      const { vw, vh, panel, unit } = this.game.layout;
      const key = JSON.stringify([vw, vh, panel, unit, this.game.settings.textSize, phone]);
      if (key !== this.fitLayoutKey) {
        const stack = this.stack, scroll = this.boxScroll, noticeTime = this.noticeTime;
        this.noticeTime = 0;
        this.measuring = true;
        try {
          this.tightForLayout = this.fullLayoutScrolls(false);
          this.omitSecondaryForLayout = this.tightForLayout && this.fullLayoutScrolls(true);
          this.fitLayoutKey = key;
        } finally {
          this.measuring = false;
          this.stack = stack;
          this.boxScroll = scroll;
          this.noticeTime = noticeTime;
          // The last measured list is temporary, not a remembered player selection.
          this.builtDepth = -1;
        }
      }
    }
    this.layoutCards(this.omitSecondaryForLayout, keepCursor, { tight: this.tightForLayout });
  }

  /** Measure each real page and its longest help, without choosing an item or losing the open cursor. */
  private measurePhoneAnchor(): void {
    const stack = this.stack, scroll = this.boxScroll, noticeTime = this.noticeTime;
    let row = 0, tail = 0, pageHeight = 0;
    this.noticeTime = 0;
    this.measuring = true;
    const measure = (make: () => MenuList, depth: number) => {
      this.stack = Array.from({ length: depth }, () => ({ make, index: 0 }));
      this.builtDepth = -1;
      this.layoutCards(false, false, { measureOnly: true, tight: true });
      let tallest = 0;
      for (let i = 1; i < this.menu.items.length; i++) {
        if (this.caption!.heightFor(this.menu.items[i]!.help ?? '') > this.caption!.heightFor(this.menu.items[tallest]!.help ?? '')) tallest = i;
      }
      this.stack[depth - 1]!.index = tallest;
      this.builtDepth = -1;
      this.layoutCards(false, true, { measureOnly: true, tight: true });
      const y = this.menu.container.y - this.boxSkin!.y;
      const captionFoot = this.caption!.shown ? this.caption!.container.y + this.caption!.height + measures(this.game.layout.unit).S : 0;
      const end = Math.max(this.menu.container.y + this.menu.height + (depth === 1 ? 0 : 2), captionFoot);
      row = Math.max(row, y);
      tail = Math.max(tail, end - this.menu.container.y);
      pageHeight = Math.max(pageHeight, end - this.boxSkin!.y);
    };
    try {
      const all = () => {
        row = 0; tail = 0; pageHeight = 0;
        measure(() => this.mainMenu(), 1);
        measure(() => this.statsMenu(), 2);
        measure(() => this.itemMenu(), 2);
        for (const id of Object.keys(this.game.content.items)) {
          if ((this.game.state.items[id] ?? 0) > 0) measure(() => this.memberMenu(id), 3);
        }
        const requiredHeight = row + tail;
        return { requiredHeight, shared: requiredHeight <= this.game.layout.panel.h };
      };
      // The pages without a heading move their cards up into its room, which keeps short phones from scrolling; where every
      // page then shares one menu row anyway, they keep the room instead, so their cards stay where the Stats page's are and
      // the menu follows them (the owner, 2026-10-28: drop "Stats/Item" and move the cards up, keeping the other headings).
      this.phoneReserve = false;
      let fit = all();
      if (fit.shared) {
        this.phoneReserve = true;
        fit = all();
        if (!fit.shared) { this.phoneReserve = false; fit = all(); }
      }
      const { requiredHeight, shared } = fit;
      const height = shared ? requiredHeight : pageHeight;
      this.phoneAnchor = { top: Math.max(0, (this.game.layout.panel.h - height) / 2), row, height, requiredHeight, shared };
    } finally {
      this.stack = stack;
      this.boxScroll = scroll;
      this.noticeTime = noticeTime;
      this.builtDepth = -1;
      this.measuring = false;
    }
  }

  /** Measure the real full-stat layouts, including each list's tallest current reason, without choosing anything. */
  private fullLayoutScrolls(tight: boolean): boolean {
    const scrolls = (make: () => MenuList): boolean => {
      this.stack = [{ make, index: 0 }];
      this.builtDepth = -1;
      if (this.layoutCards(false, false, { measureOnly: true, tight })) return true;
      let tallest = this.menu.index;
      for (let i = 0; i < this.menu.items.length; i++) {
        if (this.caption!.heightFor(this.menu.items[i]!.help ?? '') > this.caption!.heightFor(this.menu.items[tallest]!.help ?? '')) tallest = i;
      }
      if (tallest === this.menu.index) return false;
      this.stack[0]!.index = tallest;
      this.builtDepth = -1;
      return this.layoutCards(false, true, { measureOnly: true, tight });
    };
    if (scrolls(() => this.mainMenu()) || scrolls(() => this.itemMenu())) return true;
    for (const id of Object.keys(this.game.content.items)) {
      if ((this.game.state.items[id] ?? 0) > 0 && scrolls(() => this.memberMenu(id))) return true;
    }
    return false;
  }

  /** The same layout routine measures trial lists and prints the chosen card layout. */
  private layoutCards(omitSecondary: boolean, keepCursor: boolean, opts: { measureOnly?: boolean; tight?: boolean } = {}): boolean {
    this.captionLayoutPending = false;
    const g = this.game;
    const p = g.layout.panel;
    const u = g.layout.unit;
    const tight = opts.tight ?? false;
    const phoneMain = this.phoneFields && this.stack.length === 1;
    const topGap = phoneMain ? 0 : this.phoneFields ? 3 : tight ? u * 0.5 : u * 0.8;
    const boxGap = tight ? u * 0.5 : u;
    const wideHeight = p.h - (tight ? u * 0.5 : u);
    // Built again for a new size (a phone turned), the open list keeps its cursor where it was.
    if (this.menu && this.builtDepth === this.stack.length) this.stack[this.stack.length - 1]!.index = this.menu.index;
    // The Settings page opened from here is kept: it lays itself out again and goes back on top below.
    for (const c of this.container.removeChildren()) if (c !== this.sub?.container) c.destroy({ children: true });
    const sh = shade(p.w, p.h);
    // A tap outside the menu goes back, like the cancel key.
    sh.on('pointertap', () => {
      if (!this.sub) this.menu.onCancel?.();
    });
    this.container.addChild(sh);
    this.shade = sh;

    const wide = p.w > p.h * 1.1;
    this.onSheet = !wide && thumbReach(g.layout);
    this.sheetFace = null;
    let sheetRoot: Container | null = null;
    const top = this.stack[this.stack.length - 1]!;
    this.aiming = null;
    this.menu = top.make();
    this.builtDepth = this.stack.length;
    // A caption reflow keeps even a disabled row: its reason is what the player is reading.
    this.menu.index = keepCursor && this.menu.items[top.index] ? top.index : enabledMenuIndex(this.menu.items, top.index);
    if (!opts.measureOnly) {
      this.menu.setTapped(this.keepTapped);
      this.keepTapped = -1;
    }
    withSounds(this.menu, (snd) => g.audio.play(snd));
    const blip = this.menu.onMove;
    // Moving the cursor ends a result, shows the new row's line, and moves an aimed item's marks.
    this.menu.onMove = (i) => {
      blip?.(i);
      this.noticeTime = 0;
      this.showCaption();
      this.markAim();
    };
    this.menu.build(u, u * 10, { w: wide ? p.w * 0.45 : p.w - u });
    // The box score takes the width the list leaves, and only if it still does not fit is it printed a little
    // smaller. On a phone held upright its cards are stacked, each member's portrait beside their name.
    const room = wide ? p.w - boxGap * 2 - this.menu.width : p.w - u;
    const item = this.aiming ? g.content.items[this.aiming]! : null;
    const phoneSheets = (cut = 0, smallPortrait = false) => new PhoneSheets(g, u, wide ? room : p.w, { stats: this.statsPage, match: true, reserveHeading: this.phoneReserve, ...(item ? { stat: item.mp > 0 && item.hp <= 0 ? 'mp' : 'hp' } : {}), ...(cut ? { cut } : {}), ...(smallPortrait ? { smallPortrait } : {}) });
    this.box = this.phoneFields ? phoneSheets() : new BoxScore(g, u, room, { stacked: this.onSheet, omitSecondary, tightSpacing: tight });
    this.boxView = null;
    let tbl: Container = this.box.container;
    this.boxSkin = tbl;
    // Retain the current base's height fit on short, wide panels.
    const heightFit = wide ? (p.h - u) / tbl.getLocalBounds().maxY : 1;
    const fit = this.box.stacked ? 1 : Math.min(1, room / this.box.width, heightFit);
    tbl.scale.set(fit);
    const tw = this.box.width * fit;
    let th = this.box.height * fit;

    // Now the table's size is known, the list and its caption get the room left. The caption takes room
    // only on lists with lines to show (the item lists); on the others it shows a result briefly, over what
    // is above the list.
    const gap = phoneMain ? 0 : Math.round(u * 0.5);
    const reserve = this.menu.items.some((i) => i.help);
    if (wide) {
      this.menu.build(u, u * 10, { w: p.w * 0.45, h: wideHeight });
      // Under the table, or on a short panel under the list, whichever has the room.
      this.caption = new Caption(u, tw, this.captionLines(), { actual: true });
      const underTable = th + gap + this.caption.height <= wideHeight;
      if (!underTable) {
        this.caption = new Caption(u, Math.max(this.menu.width, u * 12), this.captionLines(), { actual: true });
        if (reserve) this.menu.build(u, u * 10, { w: p.w * 0.45, h: wideHeight - this.caption.height - gap });
      }
      const total = tw + boxGap + Math.max(this.menu.width, underTable ? 0 : this.caption.width);
      // A changing caption below the cards must not move a row between hover and click.
      const block = Math.max(th, this.menu.height + (underTable ? 0 : gap + this.caption.height));
      tbl.position.set(Math.max(u * 0.5, (p.w - total) / 2), Math.max(u * 0.5, (p.h - block) / 2));
      this.menu.container.position.set(tbl.x + tw + boxGap, tbl.y);
      if (underTable) this.caption.container.position.set(tbl.x, tbl.y + th + gap);
      else this.caption.container.position.set(tbl.x + tw + boxGap, Math.min(p.h - u * 0.5 - this.caption.height, tbl.y + this.menu.height + gap));
    } else if (this.onSheet) {
      // On an upright phone the list follows the cards with the usual gutter. The list's title stays on
      // its tab, and help follows the last row, so it never separates the choices from the cards.
      const m = measures(u);
      const titled = this.listTitle !== null;
      // On a phone every list's sheet keeps a title's room, tab or none: the Stats/Item list then starts where the others
      // do, with the same top padding and cyan dots, and only the tab is missing (the owner, 2026-10-28, comparing the main
      // list with Items: "the main menu is lacking some padding that the items menu has ... What if we made it look like it").
      const headed = titled || this.phoneFields;
      this.caption = new Caption(u, p.w - m.P * 2, this.captionLines(), { actual: true });
      // A tab's room and the sheet's top padding, and below the last row the 2 px a titled sheet adds (the main list's has none,
      // as the anchor's measure takes it).
      const chrome = this.phoneFields ? (headed ? m.titleTabH + (phoneMain ? 2 : 4) : 0) : (titled ? m.titleTabH + m.G : m.P) + (tight ? 0 : m.P);
      const capRoom = reserve ? this.caption.height + gap + m.S : 0;
      const bottom = phoneMain ? 0 : this.phoneFields ? Math.round(u * 0.35) : u * 0.5;
      // The list is shown whole where it can be; the stack takes what is left, never less than through its
      // first card, and scrolls in that window when it is taller.
      this.menu.build(u, p.w - m.P * 2, { w: p.w - m.P * 2 });
      let viewH = Math.min(th, Math.max(this.box.firstCardBottom, p.h - topGap - gap - capRoom - chrome - this.menu.height - bottom));
      // A phone list without a tab keeps a tab's room above its sheet only while the cards fit: when they would scroll, the
      // cards take that room first and the list stays where it was (the owner, 2026-10-28: "if it scrolls, start to close the
      // gap between the top half character sheet and the bottom half menu, showing more of the element that is scrolling").
      // Plain paper below the last card never makes the cards scroll: it is trimmed first, before any tab room is taken.
      let sheets = this.box instanceof PhoneSheets ? this.box : null;
      const onlyPaper = (h: number) => sheets !== null && h < th && h >= sheets.contentBottom * fit;
      const tabRoom = this.phoneFields && !titled ? m.titleTabH / 2 : 0;
      const take = viewH < th && !onlyPaper(viewH) ? Math.min(tabRoom, th - viewH) : 0;
      viewH += take;
      // Where they would still scroll, the Vitals and item cards give up the height their frames keep for the Stats page's
      // third row, each an even share of what would scroll and never more than it has; the layouts that already fit keep
      // their frames (the owner, 2026-10-28, of the first iPhone SE at the largest text).
      if (sheets && sheets.spare > 0 && sheets.contentBottom * fit > viewH) {
        const cut = (sheets.contentBottom * fit - viewH) / fit / sheets.cards.length;
        sheets.container.destroy({ children: true });
        this.box = sheets = phoneSheets(cut);
        tbl = this.boxSkin = this.box.container;
        tbl.scale.set(fit);
        th = this.box.height * fit;
      }
      // A titled list's tab stands above its sheet, a gap above that: where the cards would still scroll, they run on behind
      // the tab down to the sheet's top edge, and the list stays where it was (the owner, 2026-10-28, of the first iPhone SE's
      // Items: "still have some room to grow behind the menu").
      const behind = this.phoneFields && titled && sheets && sheets.contentBottom * fit > viewH ? Math.min(gap + m.titleTabH / 2, sheets.contentBottom * fit - viewH) : 0;
      viewH += behind;
      // Where they would scroll even so, a matched card's portrait is no taller than its bars, and its frame gives up what that
      // frees as above (the owner, 2026-10-29, of the first iPhone SE, whose cards were taller at text 1.2 than at 1.4).
      if (sheets && sheets.portraitOver > 0 && sheets.contentBottom * fit > viewH) {
        const cut = sheets.cut + (sheets.contentBottom * fit - viewH) / fit / sheets.cards.length;
        sheets.container.destroy({ children: true });
        this.box = sheets = phoneSheets(cut, true);
        tbl = this.boxSkin = this.box.container;
        tbl.scale.set(fit);
        th = this.box.height * fit;
      }
      if (onlyPaper(viewH)) {
        sheets!.trimTo(viewH / fit);
        th = viewH;
      }
      // The window never ends across a name tab: one it would cut is left below it.
      for (const c of this.box.cards.slice(1)) if (!this.phoneFields && viewH < th && viewH > c.rect.y - u * 1.05 && viewH < c.rect.y + u) viewH = Math.round(c.rect.y - u * 1.05);
      if (viewH < th) {
        tbl = this.scrollBox(tbl, tw, th, viewH);
        this.boxSkin = tbl;
      }
      tbl.position.set(this.phoneFields ? 0 : Math.max(u * 0.5, (p.w - tw) / 2), topGap);
      const above = tbl.y + viewH - behind + gap;
      const anchoredAbove = this.phoneAnchor?.shared ? this.phoneAnchor.top + this.phoneAnchor.row - (headed ? m.titleTabH + 2 : 0) : above;
      this.menu.build(u, p.w - m.P * 2, { w: p.w - m.P * 2, h: p.h - anchoredAbove - capRoom - (chrome - take) - bottom });
      const geo = sheetGeometry(g.layout, { w: this.menu.width, h: this.menu.height }, { titled: headed });
      if (this.phoneFields) {
        const topPad = headed ? m.titleTabH / 2 + 2 : 0;
        geo.plate.h = this.menu.height + topPad + (phoneMain ? 0 : 2);
        geo.plate.y = 0;
        geo.top = -(headed ? m.titleTabH / 2 - take : 0);
        geo.inner.y = topPad;
      } else if (tight) {
        geo.plate.h -= m.P;
        geo.plate.y += m.P;
        geo.top += m.P;
        geo.inner.y += m.P;
      }
      // Reuse the sheet's measured tab and padding, moving the complete list below the cards.
      const shift = above - geo.top;
      geo.top += shift;
      geo.plate.y += shift;
      geo.inner.y += shift;
      if (this.phoneFields && this.phoneAnchor) {
        const anchor = this.phoneAnchor;
        const rowY = anchor.top + (anchor.shared ? anchor.row : geo.inner.y - tbl.y);
        const move = rowY - geo.inner.y;
        tbl.y = anchor.top;
        geo.top += move;
        geo.plate.y += move;
        geo.inner.y += move;
      }
      const sheet = drawSheet(geo, u, this.listTitle ?? undefined, { decorations: !this.phoneFields });
      // A sheet normally runs off the foot; here its paper ends after the last row.
      const end = new Graphics().rect(0, 0, p.w, geo.plate.y + geo.plate.h).fill(0xffffff);
      sheet.root.addChild(end);
      sheet.face.mask = end;
      sheetRoot = sheet.root;
      this.sheetFace = sheet.face;
      this.menu.container.position.set(geo.inner.x, geo.inner.y);
      this.caption.container.position.set(geo.inner.x, geo.plate.y + geo.plate.h + gap);
    } else {
      tbl.position.set(Math.max(u * 0.5, (p.w - tw) / 2), topGap);
      this.caption = new Caption(u, Math.min(p.w - u, Math.max(this.menu.width, tight ? tw : u * 18)), this.captionLines(), { actual: true });
      // The list's own bottom padding provides the separation below its last row.
      const room = p.h - tbl.y - th - (tight ? boxGap : u * 1.8) - (reserve ? this.caption.height + gap : 0);
      this.menu.build(u, u * 10, { w: p.w - u, h: room });
      // On a phone held upright the list sits at the bottom, within reach of a thumb; otherwise under the table. A list with
      // lines keeps their room below it, as a phone's does (the owner, 2026-10-29: the item text "appears above the item menu
      // instead of below it, where there is already space"); a result on any other list shows briefly above it.
      const below = reserve ? gap + this.caption.height : 0;
      const under = tbl.y + th + boxGap;
      const foot = p.h - this.menu.height - (tight ? 0 : u) - below;
      const listY = thumbReach(g.layout) ? Math.max(under, foot) : Math.min(foot, under);
      this.menu.container.position.set((p.w - this.menu.width) / 2, listY);
      this.caption.container.position.set((p.w - this.caption.width) / 2, reserve ? listY + this.menu.height + gap : Math.max(u * 0.5, listY - gap - this.caption.height));
    }
    // Marked once the cards are final: a phone's may have been built again shorter above.
    this.markAim();
    this.wireCards();
    this.container.addChild(tbl, ...(sheetRoot ? [sheetRoot] : []), this.caption.container, this.menu.container);
    this.showCaption();
    this.revealAim();
    if (opts.measureOnly) return Boolean(this.boxView || this.menu.scrolls);
    if (this.grown) this.box.grow(this.grown.i, this.grown.stat, this.grown.from);
    this.grown = null;
    if (this.sub) {
      this.sub.layout();
      this.container.addChild(this.sub.container);
    }
    return Boolean(this.boxView || this.menu.scrolls);
  }

  update(dt: number): void {
    const input = this.game.input;
    // The menu key closes the whole menu from anywhere in it, as it opened it.
    if (input.pressed('menu')) {
      input.consume('menu');
      this.sub?.destroy();
      this.sub = null;
      this.close();
      return;
    }
    if (this.sub) {
      this.sub.update();
      return;
    }
    if (this.noticeTime > 0) {
      this.noticeTime -= dt;
      if (this.noticeTime <= 0) this.showCaption();
    }
    this.menu.update(input);
    // Not under a finger: the new caption's height rebuilds the page, and the row the finger is on would be gone when it lifts.
    if (this.captionLayoutPending && !input.pointerHeld) {
      this.keepTapped = this.menu.tapped;
      this.layout();
    }
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}
