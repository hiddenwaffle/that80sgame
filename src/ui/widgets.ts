import { CanvasTextMetrics, Container, fontStringFromTextStyle, Graphics, Rectangle, Text, type FederatedPointerEvent, type PointData, type TextStyle, type TextStyleOptions } from 'pixi.js';
import { currentDevice, watchDevice, type Input } from '../engine/input.ts';
import { FONT } from '../render/fonts.ts';
import { BEAT_S, EASE, motion, MS, onBeat } from '../render/motion.ts';
import { CAPTION, INK, INK_FAINT, INK_SOFT, PAPER, POP_PINK, POP_YELLOW } from '../render/palette.ts';
import { anim, pastePanel } from './anim.ts';
import { benDay, dashPoly, dashRect, drawPanel, glove, GLOVE_PAGE, GLOVE_SLAB, icon, keyTop, LEAN, letterStyle, measures, panel, SMALL_TEXT, stepKey, Tab, TOUCH_MIN, type IconKind, type TabInk } from './print.ts';
import { uprightY } from '../engine/turn.ts';

/** The command panel's lean, steeper than a tab's: about 17 degrees. */
export const ACT_LEAN = 0.3;

/** The cursor's words: white, and on a list of poster lettering with an ink outline, with a solid ink extrude. */
const CURSOR_WORDS = 0xffffff;

/**
 * An arrow in a row's detail ("40 → 80 Health") is drawn in ink, not set in type: no font the game loads has one (their
 * latin files stop at the up and down arrows), and a browser's stand-in differs from device to device (the owner,
 * 2026-11-11, in place of ">"). The words leave this much room for it.
 */
export const ARROW = '→';
const ARROW_ROOM = '\u2003';

let digitCanvas: CanvasRenderingContext2D | null | undefined;
/** How tall a digit stands above the line in `style`, by the browser's own measure of a zero. */
function digitHeight(style: TextStyle): number {
  if (digitCanvas === undefined) digitCanvas = typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d');
  if (!digitCanvas) return Number(style.fontSize) * 0.7;
  digitCanvas.font = fontStringFromTextStyle(style);
  return digitCanvas.measureText('0').actualBoundingBoxAscent;
}

/** Shared interface pieces in the newspaper style: boxes, text, buttons, and menus. */

export { SMALL_TEXT, TOUCH_MIN };

export function text(s: string, style: TextStyleOptions): Text {
  return new Text({ text: s, style: { fill: INK, ...style } });
}

export function headline(s: string, size: number, extra: TextStyleOptions = {}): Text {
  return text(s, { fontFamily: FONT.headline, fontWeight: '700', fontSize: size, ...extra });
}

/**
 * A printed box: paper, square at the corners, with an ink border and a hard shadow whose weights
 * come from the text unit (without one, those of the smallest unit).
 */
export function box(g: Graphics, x: number, y: number, w: number, h: number, opts: { fill?: number; border?: number; shadow?: boolean; unit?: number } = {}): Graphics {
  return drawPanel(g, x, y, w, h, measures(opts.unit ?? 13), { fill: opts.fill, shadow: opts.shadow, border: opts.border });
}

/**
 * Corner brackets around a rectangle: the selection cursor. `under` draws a wider
 * stroke of that colour first, so the brackets read on any ground, dark or light.
 */
export function brackets(g: Graphics, x: number, y: number, w: number, h: number, len: number, color = INK, width = 2.5, under?: number): void {
  const l = Math.min(len, w / 2, h / 2);
  const path = () => {
    g.moveTo(x, y + l).lineTo(x, y).lineTo(x + l, y);
    g.moveTo(x + w - l, y).lineTo(x + w, y).lineTo(x + w, y + l);
    g.moveTo(x + w, y + h - l).lineTo(x + w, y + h).lineTo(x + w - l, y + h);
    g.moveTo(x + l, y + h).lineTo(x, y + h).lineTo(x, y + h - l);
  };
  if (under !== undefined) {
    path();
    g.stroke({ width: width + 3, color: under, cap: 'square' });
  }
  path();
  g.stroke({ width, color, cap: 'square' });
}

export interface MenuItem {
  label: string;
  /** Right-hand detail, such as a count or price. */
  detail?: string;
  /** The detail in faint ink, as for a price the player cannot afford (the row can still be chosen). */
  faint?: boolean;
  /** A line about the row, shown in the page's caption while the cursor is on it. */
  help?: string;
  /** A pointer-only link to the existing help: at the row end, or just after its label. */
  info?: 'right' | 'after_label';
  enabled?: boolean;
  onChoose: () => void;
  /**
   * A row whose value steps down and up (a volume, a speed): left and right step it, and so do
   * the keys drawn on either side of its detail, each a tap target of its own. A tap on the detail
   * between them chooses the row (stepping it on, as the confirm key does); a tap on its words only
   * puts the cursor there, showing its help (the owner, 2026-10-26).
   */
  onAdjust?: (dir: -1 | 1) => void;
  /** For a row that steps: the ends its value has reached, where that way's key is faint. */
  ends?: { low?: boolean; high?: boolean };
  /** A small drawing before the words, in an icon slot (shapes until the art arrives). */
  icon?: IconKind;
  /** What the row stands for, so a list built again can keep its cursor on the same thing. 'back' for the row that leaves the list (Back, Leave). */
  id?: string;
  /** Key names to show as small key caps in the detail's place, where they fit; the detail's words otherwise. */
  caps?: string[];
  /** Waiting for this row's new key (the Controls page): an empty dashed cap before its keys, its caret blinking on the beat. */
  capWaiting?: boolean;
  /** Printed buttons only: the page's main action, a little bigger than the others (a wider share of the row, larger lettering). */
  main?: boolean;
}

/** A main button's share of a row of printed buttons, against 1 for the others, and how much larger its lettering is. */
const MAIN_SHARE = 1.5;
const MAIN_LETTER = 1.15;

/**
 * Where a list was left, kept for the next time it opens or comes back (the owner, 2026-11-12): the row chosen last, by its
 * id or else its words. A page keeps one for as long as the place should last, and gives it to the list with `restOn`.
 */
export interface MenuPlace {
  key: string | null;
}

/** What a row is known by from one build of a list to the next: its id, or else its words. */
const rowKey = (item: MenuItem): string => item.id ?? item.label;

/** Keep a usable remembered row; otherwise start at the first enabled row (Back if nothing else works). */
export function enabledMenuIndex(items: readonly Pick<MenuItem, 'enabled'>[], preferred = 0): number {
  if (items[preferred] && items[preferred]!.enabled !== false) return preferred;
  const first = items.findIndex((item) => item.enabled !== false);
  return first >= 0 ? first : 0;
}

/**
 * A caption strip for a page, in the caption style: what the player just did (a save, an item
 * used) or a line about the row under the cursor. Its height is set when it is made, for the
 * longest of the lines it may show, so nothing below or above it moves as its words change.
 * A page that reflows with the current text can opt into measuring only its supplied lines.
 * It is pressed onto the page when it first shows.
 */
export class Caption {
  readonly container: Container;
  private readonly face: Container;
  private readonly text: Text;
  private readonly shadowOffset: number;
  /** Set once the page has shown its first words: only later appearances are pressed on. */
  private placed = false;
  readonly width: number;
  readonly height: number;
  private readonly verticalPadding: number;

  constructor(unit: number, width: number, longest: string[], opts: { actual?: boolean } = {}) {
    const style = { fontFamily: FONT.body, fontStyle: 'italic' as const, fontSize: Math.round(unit * Math.max(SMALL_TEXT, 0.95)), fill: INK, wordWrap: true, wordWrapWidth: width - unit * 1.4, lineHeight: Math.round(unit * 1.25) };
    let tallest = 0;
    for (const s of opts.actual ? longest.filter(Boolean) : ['Ag', ...longest]) {
      const t = new Text({ text: s, style });
      tallest = Math.max(tallest, t.height);
      t.destroy();
    }
    this.width = Math.round(width);
    this.verticalPadding = unit * 0.9;
    this.height = opts.actual && !tallest ? 0 : Math.round(tallest + this.verticalPadding);
    this.text = new Text({ text: '', style });
    this.text.position.set(Math.round(unit * 0.7), Math.round(unit * 0.45));
    // Its plate takes taps, so one on it stays on the page rather than reaching the shade and leaving.
    const p = panel(this.width, this.height, unit, { fill: CAPTION });
    this.container = p.root;
    this.face = p.face;
    this.face.addChild(this.text);
    this.shadowOffset = measures(unit).S;
    this.container.visible = false;
  }

  /** Shows these words, or hides the strip when there are none. */
  set(s: string): void {
    const was = this.container.visible;
    this.text.text = s;
    this.container.visible = s !== '';
    if (this.placed && !was && this.container.visible) pastePanel(this, this.face, this.shadowOffset);
    this.placed = true;
  }

  get shown(): string {
    return this.container.visible ? this.text.text : '';
  }

  /** Height of these words alone, for a page that relays out when its current caption changes. */
  heightFor(s: string): number {
    if (!s) return 0;
    const text = new Text({ text: s, style: this.text.style });
    const height = Math.round(text.height + this.verticalPadding);
    text.destroy();
    return height;
  }

  /** What moves as the page opens. */
  skins(): Container[] {
    return [this.face];
  }
}

/**
 * The key cap a new key will fill: empty, with a dashed outline, and a caret that blinks on the beat (steady with reduced
 * motion). The Controls page shows it while it waits for a key (the owner, 2026-10-29: no words, "a visual indicator that it
 * is waiting for the user to press a key").
 */
function waitingCap(u: number): Container {
  const c = new Container();
  const h = Math.round(u * 1.35), w = Math.round(h * 1.6);
  const g = new Graphics();
  g.roundRect(1.5, 1.5, w, h, 3).fill({ color: INK, alpha: 0.28 });
  g.roundRect(0, 0, w, h, 3).fill(PAPER);
  dashRect(g, 0, 0, w, h, u * 0.6, INK);
  const caret = new Graphics().rect(Math.round(w / 2 - 1), Math.round(h * 0.2), Math.max(2, Math.round(u * 0.12)), Math.round(h * 0.6)).fill(INK);
  c.addChild(g, caret);
  c.eventMode = 'none';
  anim.loop(c, caret, (t) => (caret.visible = motion.reduced || t % BEAT_S < BEAT_S / 2));
  return c;
}

/** Cuts a text down, with an ellipsis, until it is no wider than `w`. */
export function clip(t: Text, w: number): void {
  if (t.width <= w) return;
  const full = t.text;
  let n = full.length;
  while (n > 1 && t.width > w) t.text = full.slice(0, --n).trimEnd() + '…';
}

type Row = { item: MenuItem; label: Text; detail: Text | null; arrow: Graphics | null; hit: Graphics; labelRoom: number; detailRoom: number; slotX: number | null; icon: Graphics | null; caps: Container | null };

/**
 * A vertical list of choices. Arrows or a gamepad move the cursor and confirm chooses; a tap
 * chooses directly. Rows are big enough for thumbs. The row under the cursor is a pink band with
 * white lettering, and a glove points at it. On touch a finger lights the row it presses, and a tap
 * leaves the band on its row (see `touchRow`); otherwise the band rests where the page says, with or
 * without the glove (`restOn`), and a list the page says nothing of rests on its only row, or on the
 * choice of one choice and Back (`restRow`). A greyed row is faint and struck through. A list taller than its
 * room scrolls, with a bar at its side: the cursor keeps its row in view, and a finger or the
 * mouse wheel moves the rows.
 *
 * It is built in layers, so motion never moves what is tapped: a fixed backing that takes taps
 * between rows and drags; the skin (its plate and title tab) and the face (the band, words, and
 * keys), which a page may move as it opens; and the hits (rows and step keys), which only scroll.
 */
export class MenuList {
  readonly container = new Container();
  private readonly bg = new Graphics();
  private readonly skin = new Container();
  private readonly plate = new Graphics();
  /** The rows, which move together when the list scrolls. */
  private readonly body = new Container();
  private readonly face = new Container();
  private readonly hits = new Container();
  private readonly rules = new Graphics();
  private readonly band = new Graphics();
  /** The glove pointing at the cursor's row: the pointer slides in, the hand inside it pokes on the beat. */
  private readonly pointer = new Container();
  private hand: Container | null = null;
  private readonly clipMask = new Graphics();
  private readonly bar = new Graphics();
  private tab: Tab | null = null;
  private rows: Row[] = [];
  /** For rows that step: the width of the space for the value between the keys, and of each key's tap target. */
  private slot = 0;
  private arrowW = 0;
  /** The row width and padding of the last build, for refreshing rows in place. */
  private rowW = 0;
  private pad = 0;
  private unit = 13;
  index = 0;
  items: MenuItem[] = [];
  width = 0;
  height = 0;
  /** How far the rows are scrolled, and the most they can be. */
  private scroll = 0;
  private scrollMax = 0;
  /** The visible band of rows, in the list's own coordinates. */
  private view = { top: 0, bottom: 0 };
  private rowH = TOUCH_MIN;
  private barW = 0;
  private drag: { y: number; scroll: number; moved: boolean } | null = null;
  /** The row whose words are set as the cursor's. */
  private lit = -1;
  /**
   * On touch (the owner's design, 2026-11-11, tried on a phone first): no row is lit when a list appears but where it rests (`restRow`). A finger lights only the
   * row it presses, and nothing while it is off that row. Lifted where it pressed, it taps that part of the row (the words, the (i),
   * a step key); lifted on another part of the same row it only leaves the band there; lifted off the row it chooses nothing and
   * lights nothing. A tap that leaves the list on screen leaves the band on its row. This is that row, or -1.
   */
  private touchRow = -1;
  /** The finger pressing a row; whether it is still on that row (not once the list scrolls under it); whether the page has heard of the row. */
  private press: { id: number; row: number; over: boolean; told: boolean } | null = null;
  /** The finger last lifted from a row, so that only its tap counts: a second finger's does nothing. */
  private lifted: { id: number; told: boolean } | null = null;
  /**
   * On touch, where the page rests the band while no finger lights a row and no tap has left it on one (`restOn`): the row's key,
   * whether the glove shows there, and a place kept from before, which wins while its row is there and not greyed.
   */
  private rest: { key: string | null; glove: boolean; place: MenuPlace | null } | null = null;
  /** Whether the band was last drawn for touch, so a change of device draws it again. */
  private drawnTouch: boolean;
  /** The Input the list last took input from, and its step then: a list that missed steps was under another page. */
  private input: Input | null = null;
  private lastStep = -1;
  /** Built only to be measured: drawn as for keys on every device, so the room it takes is the same everywhere. */
  private readonly measuring: boolean;
  /** Set while the list tells the page of a move it made itself (the band coming back as keys take over from touch), which makes no sound. */
  quietMove = false;
  onCancel: (() => void) | null = null;
  /** The band has moved to row `i`, or (on touch) off every row, -1. */
  onMove: ((i: number) => void) | null = null;
  /** A press on a greyed row, so the page can answer it (a sound) rather than ignore it. */
  onRefuse: (() => void) | null = null;
  title: string | null = null;
  /** No plate of its own: the list sits on a page's sheet. */
  readonly bare: boolean;
  /**
   * Printed buttons side by side instead of rows (a question's answers, the save code pages), or stacked
   * full width where they do not fit across. Left and right move between them too.
   */
  readonly buttons: boolean;
  /** Left and right move the cursor as down and up do: for a list whose rows stand for things set side by side on the page. */
  readonly across: boolean;
  /** Each button's rectangle, in the list's own coordinates. */
  private cells: Array<{ x: number; y: number; w: number; h: number }> = [];

  /** Width kept free beside the title's tab, for what a page puts there. */
  private readonly titleRoom: number;
  /** 'action': the fight's command panel, leaning on its left edge; 'page': square. */
  readonly style: 'page' | 'action';
  /** Opacity of the menu backing and selection fill; lettering and hit areas stay opaque. */
  private readonly backgroundOpacity: number;
  /** The command list's larger rows and words. */
  private readonly command: boolean;
  /** Whether this list is the fight's poster panel (the action style), lettered in poster capitals. */
  private get slab(): boolean {
    return this.style === 'action';
  }
  /** A line under the tab in soft ink, such as a list's name and the member's MP. */
  private subtitleText: string | null;
  private subtitle: Text | null = null;
  private tabInk: TabInk;
  /** The title tab's size: the poster panel's larger one, or a name's where room is short. */
  private readonly tabSize: 'title' | 'name';
  /** A width and a least height fixed by the page, so the panel never changes size between lists. */
  private readonly fixedW: number | null;
  private readonly minH: number;
  /** Reserve empty row spaces below a short list, without adding choices or scrolling to them. */
  private readonly minRows: number;
  /** A page may match another list's tap targets without changing its lettering. */
  private readonly fixedRowH: number | undefined;
  private readonly verticalPadding: number | undefined;
  /** How far the left edge leans in, at the top of the plate, and where the plate's top is. The command panel is an ink slab. */
  private lean = 0;
  private plateTop = 0;
  private icons: Graphics[] = [];

  constructor(items: MenuItem[], opts: { title?: string; bare?: boolean; buttons?: boolean; across?: boolean; titleRoom?: number; style?: 'page' | 'action'; command?: boolean; subtitle?: string; width?: number; minHeight?: number; minRows?: number; rowHeight?: number; verticalPadding?: number; tabInk?: TabInk; tabSize?: 'title' | 'name'; backgroundOpacity?: number; measuring?: boolean } = {}) {
    this.measuring = opts.measuring ?? false;
    this.drawnTouch = this.touching;
    this.bare = opts.bare ?? false;
    this.buttons = opts.buttons ?? false;
    this.across = opts.across ?? false;
    this.titleRoom = opts.titleRoom ?? 0;
    this.style = opts.style ?? 'page';
    this.backgroundOpacity = opts.backgroundOpacity ?? 1;
    this.plate.alpha = this.band.alpha = this.backgroundOpacity;
    this.command = opts.command ?? false;
    this.subtitleText = opts.subtitle ?? null;
    this.tabInk = opts.tabInk ?? 'ink';
    this.tabSize = opts.tabSize ?? (this.style === 'action' ? 'title' : 'name');
    this.fixedW = opts.width ?? null;
    this.minH = opts.minHeight ?? 0;
    this.minRows = opts.minRows ?? 0;
    this.fixedRowH = opts.rowHeight;
    this.verticalPadding = opts.verticalPadding;
    this.face.addChild(this.rules, this.band, this.pointer);
    this.face.eventMode = 'none';
    this.body.addChild(this.face, this.hits);
    this.skin.addChild(this.plate);
    this.skin.eventMode = 'none';
    this.container.addChild(this.bg, this.skin, this.body, this.clipMask, this.bar);
    this.title = opts.title ?? null;
    this.setItems(items);
    // The backing takes its own taps, so a tap between rows does not reach what is behind it.
    // (Only the backing and the rows are interactive: Pixi tells a passive parent nothing, and an
    // interactive parent would take taps on the row words for itself.)
    this.bg.eventMode = 'static';
    this.wire(this.bg);
    // Dragging anywhere on a long list scrolls it; a drag that moved is not a tap.
    this.bg.on('globalpointermove', (e) => {
      if (this.drag) {
        // A mouse whose button came up somewhere the list never heard about.
        if (e.pointerType === 'mouse' && !e.buttons) this.drag = null;
        else {
          const dy = uprightY(e.global) - this.drag.y;
          if (Math.abs(dy) > 8) this.drag.moved = true;
          if (this.drag.moved) this.setScroll(this.drag.scroll - dy);
        }
      }
      if (this.press && e.pointerId === this.press.id) this.follow(e.global);
    });
    // The band follows the device at once, even under a finger, as it changes no layout.
    if (!this.measuring) this.container.once('destroyed', watchDevice(() => this.deviceChanged()));
  }

  /** Whether the list answers touch now: the device used last is a finger or a pen, and the list is not one built only to be measured. */
  get touching(): boolean {
    return !this.measuring && currentDevice() === 'touch';
  }

  /**
   * The row the band is on, or -1 for none: with keys and the mouse, the cursor's row; on touch, the row a finger is pressing, or
   * else the row tapped last. What a page shows of the row under the cursor (a caption, a count, a target's marks) follows this.
   */
  get shown(): number {
    const p = this.press;
    const row = !this.touching ? this.index : p ? (p.over ? p.row : -1) : this.touchRow >= 0 ? this.touchRow : this.restRow;
    return this.items[row] ? row : -1;
  }

  /**
   * On touch, the row the band rests on while no finger has lit one (the owner, 2026-11-12): where the page rests it, or the row
   * of its place kept from before; for a list the page says nothing of, a list's only row, with the glove, and of two, the row keys
   * start on when the other is Back. Otherwise none, -1.
   */
  private get restRow(): number {
    return this.resting().row;
  }

  /** Where the band rests on touch, and whether the glove shows there: only on the page's own row, not on a place kept from before. */
  private resting(): { row: number; glove: boolean } {
    const r = this.rest;
    if (!r) {
      if (this.items.length === 1) return { row: 0, glove: true };
      if (this.items.length !== 2) return { row: -1, glove: false };
      return { row: this.items[1 - this.index]?.id === 'back' ? this.index : -1, glove: false };
    }
    const at = (key: string | null) => (key === null ? -1 : this.items.findIndex((it) => rowKey(it) === key));
    const kept = at(r.place?.key ?? null);
    if (kept >= 0 && this.items[kept]!.enabled !== false) return { row: kept, glove: false };
    const row = at(r.key);
    return { row, glove: r.glove || this.items.length === 1 };
  }

  /**
   * On touch, rests the band on row `row` (-1 for none) while no finger lights a row and no tap has left it on one (the owner,
   * 2026-11-12), with the glove too if `glove`. With `place`, it rests instead on the row last chosen there, while that row is in
   * the list and not greyed, and each row the player chooses or taps, but Back, is kept there. Keys and the mouse are unchanged.
   */
  restOn(row: number, opts: { glove?: boolean; place?: MenuPlace } = {}): this {
    const was = this.shown;
    const it = this.items[row];
    this.rest = { key: it ? rowKey(it) : null, glove: opts.glove ?? false, place: opts.place ?? null };
    if (this.rows.length && this.touching) {
      if (this.shown !== was) this.tell(this.shown, true);
      this.drawBand(false);
    }
    return this;
  }

  /** Row `i` chosen or tapped: kept as the list's place, if it has one, unless it is Back or greyed. */
  private keep(i: number): void {
    const place = this.rest?.place;
    const it = this.items[i];
    if (place && it && it.id !== 'back' && it.enabled !== false) place.key = rowKey(it);
  }

  /** On touch, whether the band is where it rests with the glove: no finger on a row, no tap leaving it on one. */
  private get gloveResting(): boolean {
    return !this.press && this.touchRow < 0 && this.resting().glove;
  }

  /** On touch, the row a tap left the band on, or -1: what a list built again in this one's place keeps, with `setTapped`. */
  get tapped(): number {
    return this.touchRow;
  }

  /** On touch, leaves the band on a row as a tap would (-1 for none), without telling the page: for a list built again in place of one in use. */
  setTapped(row: number): void {
    this.touchRow = this.items[row] ? row : -1;
    if (this.touching) this.drawBand(false);
  }

  /**
   * The page's pointer on something standing for row `i` (a member's card): the cursor goes to the row, as the mouse over it
   * would take it; on touch the band goes too, as a tap on the row leaves it.
   */
  aim(i: number): void {
    if (!this.rows[i]) return;
    const was = this.shown;
    this.index = i;
    if (this.touching) {
      this.touchRow = i;
      this.keep(i);
    }
    if (this.shown === was) return;
    this.drawBand();
    this.keepInView();
    this.onMove?.(i);
  }

  /** The row under a point on the screen, or -1: anywhere across a row, any part of it, and within the view of a list that scrolls. */
  private rowAt(global: PointData): number {
    const p = this.body.toLocal(global);
    if (this.buttons) return this.cells.findIndex((c) => p.x >= c.x && p.x < c.x + c.w && p.y >= c.y && p.y < c.y + c.h);
    const v = this.container.toLocal(global);
    if (v.y < this.view.top || v.y >= this.view.bottom || p.x < 0 || p.x >= this.rowW) return -1;
    return this.rows.findIndex((r) => p.y >= r.hit.y && p.y < r.hit.y + this.rowH);
  }

  /**
   * After something that may have moved the band: the page hears of its new row (-1 for none), and it is drawn there. Gone back
   * by itself to where it rests (`restRow`), with no finger on it, it makes no sound.
   */
  private shownChanged(was: number): void {
    const now = this.shown;
    if (now === was) return;
    if (this.press && now === this.press.row) this.press.told = true;
    this.tell(now, !this.press && this.touchRow < 0);
    this.drawBand();
  }

  /** The page hears of the band's row; `quiet` for a move the list made itself, which makes no sound. */
  private tell(row: number, quiet: boolean): void {
    const before = this.quietMove;
    this.quietMove = before || quiet;
    try {
      this.onMove?.(row);
    } finally {
      this.quietMove = before;
    }
  }

  /**
   * A finger or the mouse pressed row `i` (`words`: on its words, not its (i) or step keys). With the mouse, a press on the words
   * puts the cursor there, as before. On touch the row tapped last lets go of the band, and the pressed row alone is lit.
   */
  private pressRow(e: FederatedPointerEvent, i: number, words: boolean): void {
    if (!this.touching) {
      if (words) this.point(i);
      return;
    }
    // One finger at a time. One whose lift Pixi never passed on (the system took it) is no longer down, and gives way.
    if (this.press && this.press.id !== e.pointerId && this.input?.pointerDown(this.press.id) !== false) return;
    const was = this.shown;
    this.press = { id: e.pointerId, row: i, over: true, told: false };
    this.lifted = null;
    this.touchRow = -1;
    this.index = i;
    this.shownChanged(was);
  }

  /** The pressing finger moved: the band shows while it is on the row it pressed, and not while it is off it or scrolling the list. */
  private follow(global: PointData): void {
    const p = this.press!;
    const over = !this.drag?.moved && this.rowAt(global) === p.row;
    if (over === p.over) return;
    const was = this.shown;
    p.over = over;
    this.shownChanged(was);
  }

  /** The pressing finger lifted: the band stays on its row if the finger is on it still, any part of it, and goes otherwise. A tap follows, if any. */
  private lift(e: FederatedPointerEvent): void {
    const p = this.press;
    if (!p || e.pointerId !== p.id) return;
    this.follow(e.global);
    const was = this.shown;
    this.press = null;
    this.lifted = { id: p.id, told: p.told };
    this.touchRow = p.over ? p.row : -1;
    // Lifted off the row, the band goes back where it rests, if anywhere.
    this.shownChanged(was);
  }

  /** Whether a tap counts: never at the end of a drag that scrolled; on touch, only from the finger that pressed a row of this list. */
  private tapOk(e: FederatedPointerEvent): boolean {
    if (this.drag?.moved) return false;
    return !this.touching || this.lifted?.id === e.pointerId;
  }

  /** A tap on a part of row `i`: the cursor goes there, and on touch the band stays on it after the tap. */
  private tapRow(i: number): void {
    if (!this.touching) return this.point(i);
    const was = this.shown;
    this.index = i;
    this.touchRow = i;
    this.keep(i);
    this.shownChanged(was);
  }

  /** The player changed device: the band is drawn for the new one at once (on touch, where it rests until a row is pressed; with keys and the mouse, on the cursor). */
  private deviceChanged(): void {
    const touch = this.touching;
    if (touch === this.drawnTouch) return;
    const was = this.lit;
    this.press = null;
    this.lifted = null;
    this.touchRow = -1;
    if (!this.rows.length) return void (this.drawnTouch = touch);
    const now = this.shown;
    if (now !== was) this.tell(now, true);
    this.drawBand(false);
  }

  /** Lets a part of the list start and end a drag, and take the mouse wheel. */
  private wire(o: Container): void {
    o.on('pointerdown', (e) => {
      if (this.scrollMax > 0) this.drag = { y: uprightY(e.global), scroll: this.scroll, moved: false };
    });
    // Cleared after the tap that ends the drag has been seen, so a drag does not choose. A finger pressing a row lifts here too,
    // before its tap: on the part it pressed, on the row's other parts, or off them (pointerupoutside, on the part it pressed).
    const end = (e: FederatedPointerEvent) => {
      this.lift(e);
      if (this.drag) setTimeout(() => (this.drag = null));
    };
    o.on('pointerup', end);
    o.on('pointerupoutside', end);
    o.on('pointercancel', end);
    o.on('wheel', (e) => this.setScroll(this.scroll + e.deltaY));
  }

  setItems(items: MenuItem[]): void {
    this.items = items;
    this.index = Math.min(this.index, Math.max(0, items.length - 1));
  }

  /** Where the left edge is at `y`: in on a leaning panel, from the full lean at the plate's top to none at its foot. */
  private leftAt(y: number): number {
    if (!this.lean) return 0;
    const span = Math.max(1, this.height - this.plateTop);
    return this.lean * Math.max(0, Math.min(1, 1 - (y - this.plateTop) / span));
  }

  /** New words for the tab, and its ink, without building the list again. */
  setTab(text: string, ink: TabInk = this.tabInk): void {
    this.title = text;
    this.tabInk = ink;
    this.tab?.setText(text);
    this.tab?.setInk(ink);
  }

  /** The title tab's height at this unit, before a list is made. */
  private static tabHeight(unit: number): number {
    const t = new Tab('A', unit);
    const h = t.height;
    t.container.destroy({ children: true });
    return h;
  }

  /**
   * Lays the list out at a given text size and minimum width. `room` is the most
   * space it may take: a wider row cuts its words short, and a taller list scrolls.
   */
  build(unit: number, minWidth = 0, room: { w?: number; h?: number } = {}): void {
    for (const r of this.rows) {
      r.label.destroy();
      r.detail?.destroy();
      r.arrow?.destroy();
      r.hit.destroy();
      r.caps?.destroy({ children: true });
    }
    for (const a of this.arrows) {
      a.zone.destroy();
      a.mark.destroy({ children: true });
    }
    this.arrows = [];
    for (const h of this.helpLinks) { h.zone.destroy(); h.mark.destroy(); }
    this.helpLinks = [];
    this.tab?.container.destroy({ children: true });
    this.tab = null;
    this.subtitle?.destroy();
    this.subtitle = null;
    for (const g of this.icons) g.destroy();
    this.icons = [];
    this.rows = [];
    this.lit = -1;
    // Built again (a new size), the list keeps the row a tap left the band on, and a finger on a row still pressing it.
    if (!this.items[this.touchRow]) this.touchRow = -1;
    if (this.press && !this.items[this.press.row]) this.press = null;
    this.unit = unit;
    const m = measures(unit);
    const pad = m.P;
    const rowH = (this.rowH = this.fixedRowH ?? (this.command ? m.cmdRowH : m.rowH));
    const size = Math.round(unit * (this.slab ? (this.command ? 1.55 : 1.3) : this.command ? 1.2 : 1.05));
    // How far a row's words sit in from its left: past the glove's fingertip on a page's list.
    const indent = Math.round(unit * (this.slab ? 0.4 : 1.2));
    this.hand?.destroy({ children: true });
    this.hand = glove(Math.round(unit * (this.slab ? GLOVE_SLAB : GLOVE_PAGE)), unit);
    this.pointer.addChild(this.hand);
    const vpad = this.verticalPadding ?? pad;
    let y = vpad;
    if (this.title) {
      // The title is a lettering tab straddling the top edge of the list's plate.
      this.tab = new Tab(this.title, unit, { keyline: true, ink: this.tabInk, size: this.tabSize });
      // On the slab the name's tab is larger, turned a few degrees.
      if (this.slab) this.tab.container.rotation = -0.07;
      this.tab.container.position.set(Math.round(unit * 0.5), 0);
      this.skin.addChild(this.tab.container);
      y = this.tab.height + Math.round(pad * 0.5);
    }
    if (this.subtitleText) {
      this.subtitle = headline(this.subtitleText.toUpperCase(), Math.round(unit * SMALL_TEXT), { fill: this.slab ? INK : INK_SOFT, fontWeight: '400', letterSpacing: 0.5 });
      this.subtitle.y = y;
      this.face.addChild(this.subtitle);
      y += this.subtitle.height + Math.round(pad * 0.3);
    }
    const listTop = y;
    // Whether it scrolls depends only on heights, so it is known before the widths.
    const full = listTop + this.items.length * rowH + vpad;
    // A list that scrolls shows whole rows, so no row is left cut in half at an edge.
    // (A row that fits within half a pixel counts as fitting: heights measured from text are fractional.)
    const shown = Math.max(1, Math.floor(((room.h ?? Infinity) - listTop - vpad + 0.5) / rowH));
    const contentH = Math.min(full, listTop + shown * rowH + vpad);
    this.view = { top: listTop, bottom: contentH - vpad };
    this.scrollMax = Math.max(0, full - vpad - this.view.bottom);
    this.barW = this.scrollMax > 0 ? Math.round(unit * 0.9) : 0;
    // A page may ask for a least height, so the panel keeps its size between lists; the rows start at its top.
    const minH = Math.max(this.minH, listTop + Math.min(this.minRows, shown) * rowH + vpad);
    this.height = Math.max(contentH, Math.min(minH, Math.floor(room.h ?? Infinity)));
    this.plateTop = this.tab ? Math.round(this.tab.height / 2) : 0;
    // The command panel's left edge leans in toward the top, about 12 degrees.
    this.lean = this.style === 'action' ? Math.round(Math.min(unit * 1.9, ACT_LEAN * (this.height - this.plateTop))) : 0;
    const iconW = this.items.some((it) => it.icon) ? Math.round(unit * (this.command ? 1.3 : 1.2)) + Math.round(unit * 0.3) : 0;
    const iconS = Math.round(unit * (this.command ? 1.3 : 1.2));

    let want = Math.max(minWidth, this.tab ? this.lean + this.tab.width + unit * 1.5 + this.titleRoom : 0);
    // The line under the tab fits across the plate as the rows do, past the lean where it sits.
    if (this.subtitle) want = Math.max(want, this.lean + this.subtitle.width + pad * 2 + indent + this.barW);
    // Words are measured as the cursor's (bold, or outlined and extruded), so a row fits whether or not the cursor is on it.
    const made = this.items.map((item) => {
      const label = this.slab ? new Text({ text: item.label.toUpperCase(), style: letterStyle(size, CURSOR_WORDS, { outline: true, extrude: true }) }) : headline(item.label.toUpperCase(), size, { fill: item.enabled === false ? INK_FAINT : INK });
      if (this.slab) label.anchor.set(0, 0.5);
      else label.style.dropShadow = this.litShadow();
      const detail = item.detail ? headline(item.detail.replace(ARROW, ARROW_ROOM), this.slab ? Math.round(unit * 1.05) : size, { fill: item.faint ? INK_FAINT : INK_SOFT }) : null;
      const arrow = item.detail?.includes(ARROW) ? new Graphics() : null;
      // Key caps, a little apart, right-aligned where the detail would go.
      let caps: Container | null = null;
      if (item.caps?.length || item.capWaiting) {
        caps = new Container();
        caps.eventMode = 'none';
        let cx = 0;
        if (item.capWaiting) {
          const k = waitingCap(unit);
          caps.addChild(k);
          cx += k.width + Math.round(unit * 0.3);
        }
        for (const name of item.caps ?? []) {
          const k = keyTop(name, unit);
          k.x = cx;
          caps.addChild(k);
          cx += k.width + Math.round(unit * 0.3);
        }
      }
      return { item, label, detail, arrow, caps };
    });
    if (this.buttons) return this.buildButtons(made, unit, minWidth, room);
    // The gap between a row's words and its value: tighter in the fight's command panel, whose width is fixed.
    const gapLD = unit * (this.style === 'action' ? 0.8 : 1.6);
    // Rows that step share one column for their values, wide enough for the widest, between two keys.
    this.arrowW = Math.max(TOUCH_MIN, Math.round(unit * 2.2));
    this.slot = Math.max(unit * 4, ...made.filter((mm) => mm.item.onAdjust && mm.detail).map((mm) => mm.detail!.width));
    for (const mm of made) {
      const right = mm.item.onAdjust ? this.arrowW * 2 + this.slot : mm.caps ? mm.caps.width + gapLD : mm.detail ? mm.detail.width + gapLD : 0;
      want = Math.max(want, mm.label.width + right + this.infoSpace(mm.item) + pad * 2 + unit + (indent - unit * 0.4) + this.barW + this.lean + iconW);
    }
    // Rounded up, so a row that just fits is not cut short by a fraction of a pixel.
    this.width = this.fixedW ?? Math.min(Math.ceil(want), Math.floor(room.w ?? Infinity));
    const rowW = (this.rowW = this.width - this.barW);
    this.pad = pad;
    for (const [i, mm] of made.entries()) {
      // In a narrow list the detail gives way first, then the label. A row that steps keeps its keys.
      // The room across the row: less the padding either side, the words' indent, the lean where the words sit, and any icon.
      const inset = this.leftAt(y + rowH / 2) + iconW;
      const infoSpace = this.infoSpace(mm.item);
      const inner = rowW - infoSpace - pad * 2 - indent - inset;
      const stepper = mm.item.onAdjust ? this.arrowW * 2 + this.slot : 0;
      const rightW = mm.caps?.width ?? mm.detail?.width;
      const labelRoom = stepper ? Math.max(inner * 0.3, inner - stepper) : rightW !== undefined ? Math.max(inner * 0.45, inner - rightW - gapLD) : inner;
      // Words too long for their row step down to the smallest interface size before they are cut short.
      if (mm.label.width > labelRoom) mm.label.style.fontSize = Math.round(unit * SMALL_TEXT);
      // A narrow row that steps, or a help row beside its mark, can keep its full label on two lines.
      if ((mm.item.onAdjust || (mm.item.info === 'after_label' && mm.item.help)) && mm.label.width > labelRoom) {
        mm.label.style.wordWrap = true;
        // Pixi adds the cursor shadow after wrapping; leave a pixel for fractional glyph bounds too.
        mm.label.style.wordWrapWidth = Math.max(1, Math.floor(labelRoom - this.litShadow().distance - 1));
        mm.label.style.lineHeight = Math.round(unit);
      }
      clip(mm.label, labelRoom);
      const detailRoom = stepper ? this.slot : inner - mm.label.width - gapLD;
      // Key caps that do not fit beside the words give way to the detail's words.
      if (mm.caps && mm.caps.width > detailRoom) {
        mm.caps.destroy({ children: true });
        mm.caps = null;
      }
      if (mm.detail) clip(mm.detail, detailRoom);
      if (mm.detail && mm.caps) mm.detail.visible = false;
      mm.label.style.fontWeight = '400';
      if (!this.slab) mm.label.style.dropShadow = false;
      if (mm.detail) mm.detail.style.fontWeight = '400';
      const hit = this.rowHit(i, 0, y, rowW - infoSpace, rowH);
      const mid = y + rowH / 2;
      mm.label.position.set(Math.round(this.leftAt(mid) + iconW + pad + indent), this.slab ? Math.round(mid) : y + (rowH - mm.label.height) / 2);
      let rowIcon: Graphics | null = null;
      if (mm.item.icon) {
        const ic = (rowIcon = icon(mm.item.icon, iconS, unit, mm.item.enabled === false ? INK_FAINT : INK));
        ic.position.set(Math.round(this.leftAt(mid) + pad + unit * 0.3), Math.round(mid - iconS / 2));
        this.face.addChild(ic);
        this.icons.push(ic);
      }
      const slotX = stepper ? rowW - this.arrowW - this.slot : null;
      if (mm.detail) mm.detail.position.set(slotX !== null ? slotX + (this.slot - mm.detail.width) / 2 : rowW - infoSpace - pad - mm.detail.width, y + (rowH - mm.detail.height) / 2);
      this.hits.addChild(hit);
      this.face.addChild(mm.label);
      if (mm.detail) this.face.addChild(mm.detail);
      if (mm.arrow) this.face.addChild(mm.arrow);
      if (mm.caps) {
        mm.caps.position.set(Math.round(rowW - pad - mm.caps.width), Math.round(y + (rowH - mm.caps.height) / 2));
        this.face.addChild(mm.caps);
      }
      if (slotX !== null) {
        // The keys: each its own tap target, a fingertip wide, stepping the value without choosing the row.
        for (const [dir, x] of [[-1, slotX - this.arrowW], [1, slotX + this.slot]] as const) {
          const zone = new Graphics().rect(0, 0, this.arrowW, rowH).fill({ color: 0xffffff, alpha: 0.001 });
          zone.position.set(x, y);
          zone.eventMode = 'static';
          zone.cursor = 'pointer';
          this.wire(zone);
          zone.on('pointerdown', (e) => this.pressRow(e, i, false));
          zone.on('pointertap', (e) => {
            if (!this.tapOk(e)) return;
            this.tapRow(i);
            this.adjust(dir);
          });
          // Over the row's words or its controls, the mouse puts the cursor on the row alike.
          zone.on('pointerover', (e) => this.hover(e, i));
          this.hits.addChild(zone);
          const a = { zone, mark: new Container(), dir, row: i, faint: false };
          this.arrows.push(a);
          this.drawKey(a);
        }
        // The detail between them steps the value on, as the confirm key does, back to the start past the end.
        const value = new Graphics().rect(0, 0, this.slot, rowH).fill({ color: 0xffffff, alpha: 0.001 });
        value.position.set(slotX, y);
        value.eventMode = 'static';
        value.cursor = 'pointer';
        this.wire(value);
        value.on('pointerdown', (e) => this.pressRow(e, i, false));
        value.on('pointertap', (e) => {
          if (!this.tapOk(e)) return;
          this.tapRow(i);
          this.choose();
        });
        value.on('pointerover', (e) => this.hover(e, i));
        this.hits.addChild(value);
      }
      this.rows.push({ ...mm, hit, labelRoom, detailRoom, slotX, icon: rowIcon, caps: mm.caps });
      if (mm.item.info && mm.item.help) this.addHelpLink(i);
      y += rowH;
    }
    this.clipMask.clear();
    if (this.scrollMax > 0) {
      // Open to the left as far as the glove reaches, with its sweep, and the band's jut past the lean.
      const reach = Math.round(unit * (this.slab ? 5 : 2.5));
      this.clipMask.rect(-reach, this.view.top, this.width + reach, this.view.bottom - this.view.top).fill(0xffffff);
      this.body.mask = this.clipMask;
    } else this.body.mask = null;
    this.plate.clear();
    const plateTop = this.plateTop;
    if (this.tab) this.tab.container.x = Math.round(this.lean + unit * 0.5);
    if (this.subtitle) {
      this.subtitle.x = Math.round(this.leftAt(this.subtitle.y + this.subtitle.height / 2) + pad + indent);
      // Cut short only on a panel held narrower than it needs.
      clip(this.subtitle, rowW - this.subtitle.x - pad);
    }
    // The backing takes taps on the plate and on the tab, and none on the strip beside the tab above the plate.
    this.bg.clear().rect(0, plateTop, this.width, this.height - plateTop).fill({ color: 0xffffff, alpha: 0.001 });
    if (this.tab) this.bg.rect(this.tab.container.x, 0, this.tab.width, plateTop).fill({ color: 0xffffff, alpha: 0.001 });
    if (this.lean) {
      // A leaning poster panel: a solid ink shadow, yellow, a field of pink dots growing toward its foot on the right, and a heavy ink line.
      const shape = (dx: number) => [this.lean + dx, plateTop + dx, this.width + dx, plateTop + dx, this.width + dx, this.height + dx, dx, this.height + dx];
      const d = m.S * 1.2;
      // A translucent face needs only the exposed shadow along its right and
      // bottom edges. Ink beneath the whole face would hide the view behind it.
      const shadow = this.backgroundOpacity < 1
        ? [this.width, plateTop + d, this.width + d, plateTop + d, this.width + d, this.height + d,
          d, this.height + d, d + this.lean * d / (this.height - plateTop), this.height, this.width, this.height]
        : shape(d);
      this.plate.poly(shadow).fill(INK);
      this.plate.poly(shape(0)).fill(POP_YELLOW);
      const h = this.height;
      benDay(this.plate, { x: 0, y: plateTop, w: this.width, h: h - plateTop }, {
        color: POP_PINK,
        alpha: 0.45,
        pitch: unit * 0.62,
        from: [this.width * 0.45, plateTop + (h - plateTop) * 0.3],
        to: [this.width, h],
        inside: (px, py) => px > this.leftAt(py) + m.L * 2 && px < this.width - m.L * 2 && py > plateTop + m.L * 2 && py < h - m.L * 2,
      });
      this.plate.poly(shape(0)).stroke({ width: m.L, color: INK, join: 'miter' });
    } else if (!this.bare) drawPanel(this.plate, 0, plateTop, this.width, this.height - plateTop, m);
    else if (this.tab) this.plate.rect(0, plateTop, this.width, m.l).fill(INK);
    // Measuring uses the cursor's lettering. Give every row its own ink before showing the list.
    for (const i of this.rows.keys()) this.setLook(i, false);
    this.drawRules();
    this.scroll = Math.min(this.scroll, this.scrollMax);
    // Built at rest: a page plays its opening motion itself, once.
    this.drawBand(false);
    this.keepInView();
  }

  /** A row's or a button's tap target: a finger landing on it moves the cursor there, and the tap itself chooses it. */
  private rowHit(i: number, x: number, y: number, w: number, h: number): Graphics {
    const hit = new Graphics();
    hit.rect(0, 0, w, h).fill({ color: 0xffffff, alpha: 0.001 });
    hit.position.set(x, y);
    hit.eventMode = 'static';
    // A row that steps changes only at its detail and its keys, so its words are not a button.
    const steps = Boolean(this.items[i]?.onAdjust);
    hit.cursor = steps ? 'default' : 'pointer';
    this.wire(hit);
    hit.on('pointerdown', (e) => this.pressRow(e, i, true));
    hit.on('pointertap', (e) => {
      if (!this.tapOk(e)) return;
      if (this.touching) this.tapRow(i);
      else this.index = i;
      if (!steps) this.choose();
    });
    hit.on('pointerover', (e) => this.hover(e, i));
    return hit;
  }

  /** The mouse over a part of row `i` puts the cursor there. A finger does not: on touch only a press lights a row. */
  private hover(e: FederatedPointerEvent, i: number): void {
    if (e.pointerType === 'mouse' && !this.touching && !this.drag?.moved) this.point(i);
  }

  /**
   * The answers as printed buttons: paper, an ink line, and a hard shadow, side by side and sharing the
   * width (a main button a larger share), or stacked full width where they do not fit across. Each keeps
   * room for the glove before its words.
   */
  private buildButtons(made: Array<{ item: MenuItem; label: Text; detail: Text | null; arrow: Graphics | null; caps: Container | null }>, unit: number, minWidth: number, room: { w?: number; h?: number }): void {
    const m = measures(unit);
    const h = this.rowH;
    const gap = m.G + m.S;
    const lead = Math.round(unit * GLOVE_PAGE * 0.85);
    for (const mm of made) {
      mm.detail?.destroy();
      mm.detail = null;
      mm.arrow?.destroy();
      mm.arrow = null;
      mm.caps?.destroy({ children: true });
      mm.caps = null;
      if (mm.item.main) mm.label.style.fontSize = Math.round(Number(mm.label.style.fontSize) * MAIN_LETTER);
    }
    const n = made.length;
    const share = made.map((mm) => (mm.item.main ? MAIN_SHARE : 1));
    const shares = share.reduce((a, b) => a + b, 0);
    const needs = made.map((mm) => Math.ceil(mm.label.width + lead + m.P * 2));
    const need = Math.max(0, ...needs);
    const most = Math.floor(room.w ?? Infinity);
    // Side by side, each button's share must hold its own words.
    const across = Math.ceil(Math.max(0, ...needs.map((w, i) => (w * shares) / share[i]!))) + (n - 1) * gap + m.S;
    this.width = this.fixedW ?? Math.min(most, Math.max(minWidth, across));
    const side = across <= this.width;
    if (!side) this.width = this.fixedW ?? Math.min(most, Math.max(minWidth, need + m.S));
    const inner = this.width - m.S - (n - 1) * gap;
    let x = 0;
    this.cells = made.map((_, i) => {
      if (!side) return { x: 0, y: i * (h + gap), w: this.width - m.S, h };
      const w = Math.floor((inner * share[i]!) / shares);
      const c = { x, y: 0, w, h };
      x += w + gap;
      return c;
    });
    this.height = (side ? h : n * h + (n - 1) * gap) + m.S;
    this.rowW = this.width;
    this.pad = m.P;
    this.scrollMax = 0;
    this.barW = 0;
    this.view = { top: 0, bottom: this.height };
    this.plateTop = 0;
    this.lean = 0;
    this.body.mask = null;
    this.clipMask.clear();
    this.plate.clear();
    this.bg.clear().rect(0, 0, this.width, this.height).fill({ color: 0xffffff, alpha: 0.001 });
    for (const [i, mm] of made.entries()) {
      const c = this.cells[i]!;
      const labelRoom = c.w - lead - m.P * 2;
      if (mm.label.width > labelRoom) mm.label.style.fontSize = Math.round(unit * SMALL_TEXT);
      clip(mm.label, labelRoom);
      // The glove's room and the words centred together, so the words stay put as the cursor comes and goes.
      mm.label.position.set(Math.round(c.x + (c.w - lead - mm.label.width) / 2 + lead), Math.round(c.y + (h - mm.label.height) / 2));
      drawPanel(this.plate, c.x, c.y, c.w, c.h, m);
      const hit = this.rowHit(i, c.x, c.y, c.w, c.h);
      this.hits.addChild(hit);
      this.face.addChild(mm.label);
      this.rows.push({ ...mm, hit, labelRoom, detailRoom: 0, slotX: null, icon: null, caps: null });
    }
    // Measured as the cursor's words, every button is lettered as a plain one until the cursor comes to it.
    for (let i = 0; i < this.rows.length; i++) this.setLook(i, false);
    this.drawRules();
    this.drawBand(false);
    this.setScroll(0);
  }

  /** A step key's drawing, centred in its tap target, faint at the end its value has reached. */
  private drawKey(a: { zone: Graphics; mark: Container; dir: -1 | 1; row: number; faint: boolean }): void {
    const item = this.items[a.row];
    const faint = item?.enabled === false || Boolean(a.dir < 0 ? item?.ends?.low : item?.ends?.high);
    if (a.mark.parent && faint === a.faint) return;
    a.mark.destroy({ children: true });
    a.faint = faint;
    a.mark = stepKey(a.dir, this.unit, faint);
    const s = Math.round(this.unit * 1.3);
    a.mark.position.set(a.zone.x + (this.arrowW - s) / 2, a.zone.y + (this.rowH - s) / 2);
    this.face.addChild(a.mark);
  }

  /** Hairlines between rows, and a strike through each greyed row's words. */
  private drawRules(): void {
    const m = measures(this.unit);
    const g = this.rules.clear();
    for (let i = 1; !this.buttons && i < this.rows.length; i++) {
      const y = this.rows[i]!.hit.y;
      const x = this.leftAt(y) + this.pad;
      g.rect(x, y, this.rowW - this.pad - x, this.slab ? m.l : 1).fill({ color: INK, alpha: this.slab ? 0.5 : 0.14 });
    }
    for (const r of this.rows) {
      if (r.item.enabled !== false) continue;
      // Poster lettering hangs from its middle; a page's words from their top.
      const sy = this.slab ? r.label.y : r.label.y + r.label.height * 0.55;
      g.rect(r.label.x - this.unit * 0.1, Math.round(sy), r.label.width + this.unit * 0.2, m.l).fill(this.slab ? INK_SOFT : INK_FAINT);
    }
  }

  /** Moves the cursor to a row a finger or the mouse is on, without choosing it. */
  private point(i: number): void {
    if (this.index === i) return;
    this.index = i;
    this.onMove?.(i);
    this.drawBand();
  }

  /**
   * Moves the cursor to a row for the page, without `onMove`: the fight's target list follows a target chosen on the field. On
   * touch the band stays where the finger left it, and only the row keys would start from moves.
   */
  select(i: number): void {
    if (this.index === i || !this.rows[i]) return;
    const was = this.shown;
    this.index = i;
    if (this.touching) {
      // On touch the band moves only where it rests on the cursor's row.
      if (this.shown !== was) this.drawBand(false);
      return;
    }
    this.drawBand();
    this.keepInView();
  }

  /**
   * Shows new words, details, and greyed rows in place, keeping the rows themselves, so a finger
   * already on a row still taps it and a scroll stays where it is. It works only when the rows
   * are the same in number and in which have details; otherwise it returns false and the list
   * must be built again.
   */
  refresh(items: MenuItem[], title?: string, subtitle?: string): boolean {
    if (items.length !== this.rows.length || items.some((it, i) => Boolean(it.detail) !== Boolean(this.rows[i]!.detail) || Boolean(it.detail?.includes(ARROW)) !== Boolean(this.rows[i]!.arrow) || it.info !== this.rows[i]!.item.info || Boolean(it.help) !== Boolean(this.rows[i]!.item.help))) return false;
    this.items = items;
    if (title !== undefined && this.tab) {
      this.title = title;
      this.tab.setText(title);
    }
    if (subtitle !== undefined && this.subtitle) {
      this.subtitleText = subtitle;
      this.subtitle.text = subtitle.toUpperCase();
      clip(this.subtitle, this.rowW - this.subtitle.x - this.pad);
    }
    for (const [i, r] of this.rows.entries()) {
      const it = items[i]!;
      r.item = it;
      r.label.text = it.label.toUpperCase();
      // Cut to fit as the cursor's words, as build() measured them.
      if (this.slab) r.label.style = letterStyle(Number(r.label.style.fontSize), CURSOR_WORDS, { outline: true, extrude: true });
      else {
        r.label.style.fontWeight = '700';
        r.label.style.dropShadow = this.litShadow();
      }
      clip(r.label, r.labelRoom);
      if (r.detail) {
        r.detail.text = it.detail!.replace(ARROW, ARROW_ROOM);
        r.detail.style.fontWeight = '700';
        clip(r.detail, r.detailRoom);
      }
    }
    for (const a of this.arrows) this.drawKey(a);
    // Every row's words as a plain row's, then the cursor's row as the cursor's, where it already was.
    for (const i of this.rows.keys()) this.setLook(i, false);
    this.drawRules();
    this.drawBand(false);
    return true;
  }

  /** How tall a list of `rows` rows is when built at `unit`, with or without a title, before it is made. */
  static heightFor(rows: number, unit: number, titled: boolean, opts: { command?: boolean; subtitle?: boolean } = {}): number {
    const m = measures(unit);
    let top = titled ? MenuList.tabHeight(unit) + Math.round(m.P * 0.5) : m.P;
    if (opts.subtitle) {
      const t = headline('AG', Math.round(unit * SMALL_TEXT), { fontWeight: '400' });
      top += t.height + Math.round(m.P * 0.3);
      t.destroy();
    }
    return top + rows * (opts.command ? m.cmdRowH : m.rowH) + m.P;
  }

  /** Where the title's tab sits in the list, for pages that put something beside it. */
  titleArea(): { x: number; y: number; w: number; h: number; titleW: number } | null {
    const t = this.tab;
    if (!t) return null;
    const x = t.container.x;
    return { x, y: t.container.y, w: this.width - this.barW - x * 2, h: t.height, titleW: t.width };
  }

  /** Whether the list is too tall for its room and scrolls. */
  get scrolls(): boolean {
    return this.scrollMax > 0;
  }

  /** What a page moves as it opens: the plate and tab, and the drawing on the rows. Never the rows' tap targets. */
  skins(): Container[] {
    return [this.skin, this.face];
  }

  /** Fades every row but `keep` back, for a page waiting on that row; null brings them all back. */
  dimExcept(keep: number | null): void {
    this.rows.forEach((r, i) => {
      const a = keep === null || i === keep ? 1 : 0.35;
      for (const s of [r.label, r.detail, r.arrow, r.caps, r.icon]) if (s) s.alpha = a;
    });
  }

  /** A row's words and key caps, for a page that moves or marks them. */
  rowParts(i: number): { label: Text; caps: Container | null } | null {
    const r = this.rows[i];
    return r ? { label: r.label, caps: r.caps } : null;
  }

  private setScroll(s: number): void {
    this.scroll = Math.max(0, Math.min(this.scrollMax, s));
    this.body.y = -this.scroll;
    this.bar.clear();
    if (!this.scrollMax) return;
    // A thin rule with a thumb showing where in the list the view is.
    const x = this.width - this.barW / 2;
    const h = this.view.bottom - this.view.top;
    const thumb = Math.max(this.barW * 1.5, (h * h) / (h + this.scrollMax));
    const ty = this.view.top + ((h - thumb) * this.scroll) / this.scrollMax;
    this.bar.moveTo(x, this.view.top).lineTo(x, this.view.bottom).stroke({ width: 1, color: INK_FAINT });
    this.bar.rect(x - this.barW * 0.2, ty, this.barW * 0.4, thumb).fill(INK_SOFT);
  }

  /** Scrolls just enough to show the cursor's row. */
  private keepInView(): void {
    const r = this.rows[this.index];
    if (!r) return this.setScroll(this.scroll);
    const top = r.hit.y - this.scroll;
    if (top < this.view.top) this.setScroll(r.hit.y - this.view.top);
    else if (top + this.rowH > this.view.bottom) this.setScroll(r.hit.y + this.rowH - this.view.bottom);
    else this.setScroll(this.scroll);
  }

  /** The solid extrude under the cursor's words on a page list. */
  private litShadow() {
    return { color: INK, alpha: 1, angle: Math.PI / 4, blur: 0, distance: Math.max(1.5, Math.round(this.unit * 0.12)) };
  }

  /** A row's words as the cursor's (white on the pink band: outlined and extruded poster capitals, or bold with an extrude) or as a plain row's. */
  private setLook(i: number, on: boolean): void {
    const r = this.rows[i];
    if (!r) return;
    const enabled = r.item.enabled !== false;
    const lit = on && enabled;
    if (this.slab) r.label.style = letterStyle(Number(r.label.style.fontSize), lit ? CURSOR_WORDS : enabled ? INK : INK_SOFT, { outline: lit, extrude: lit });
    else {
      r.label.style.fill = lit ? CURSOR_WORDS : enabled ? INK : INK_FAINT;
      r.label.style.dropShadow = lit ? this.litShadow() : false;
    }
    if (r.icon) r.icon.tint = lit ? CURSOR_WORDS : enabled ? INK : INK_FAINT;
    // A greyed row keeps its regular weight under the cursor (its dashed band marks it), so its strike still covers its words.
    if (!this.slab) r.label.style.fontWeight = lit || (this.buttons && enabled) ? '700' : '400';
    if (r.detail) {
      r.detail.style.fill = r.item.faint ? INK_FAINT : lit ? INK : INK_SOFT;
      r.detail.style.fontWeight = on && enabled ? '700' : '400';
      // A detail right-aligned in its row stays so at either weight.
      r.detail.x = r.slotX !== null ? r.slotX + (this.slot - r.detail.width) / 2 : this.rowW - this.infoSpace(r.item) - this.pad - r.detail.width;
      this.drawArrow(r);
    }
    this.drawHelpLink(i, lit);
  }

  /** A detail's arrow, across the room its words leave for it, level with their digits, in their ink and weight; none where the words were cut short before it. */
  private drawArrow(r: Row): void {
    const a = r.arrow, t = r.detail;
    if (!a || !t) return;
    a.clear();
    const at = t.text.indexOf(ARROW_ROOM);
    a.visible = t.visible && at >= 0;
    if (!a.visible) return;
    const before = CanvasTextMetrics.measureText(t.text.slice(0, at), t.style);
    const room = CanvasTextMetrics.measureText(ARROW_ROOM, t.style).width;
    const y = t.y + before.fontProperties.ascent - digitHeight(t.style) / 2;
    const x0 = t.x + before.width + room * 0.12, x1 = t.x + before.width + room * 0.88;
    // About the lettering's own strokes: Oswald's stems at each weight.
    const w = Math.max(1, Number(t.style.fontSize) * (t.style.fontWeight === '700' ? 0.135 : 0.09));
    const head = room * 0.32;
    const ink = { width: w, color: t.style.fill as number, cap: 'round', join: 'round' } as const;
    a.moveTo(x0, y).lineTo(x1 - w / 2, y).stroke(ink);
    a.moveTo(x1 - head, y - head * 0.85).lineTo(x1, y).lineTo(x1 - head, y + head * 0.85).stroke(ink);
    a.alpha = t.alpha;
  }

  /** The cursor: a pink band, with a glove pointing at its words (on touch only where it rests with one), or a dashed band on a greyed row; on the row `shown`. */
  private drawBand(animate = true): void {
    const m = measures(this.unit);
    const prev = this.lit;
    const at = this.shown;
    this.drawnTouch = this.touching;
    if (prev !== at) this.setLook(prev, false);
    // The band and glove's last sweep is finished first, so a quick second move starts them from the new row.
    anim.finish(this);
    this.band.clear();
    const r = this.rows[at];
    this.lit = r ? at : -1;
    this.pointer.visible = Boolean(r) && r!.item.enabled !== false && (!this.drawnTouch || this.items.length === 1 || this.gloveResting);
    if (!r) return;
    if (this.buttons) return this.drawButtonBand(r, prev, animate);
    const inset = this.bare ? m.l : m.L / 2 + m.l;
    const y = r.hit.y + m.l;
    const h = this.rowH - m.l * 2;
    const right = this.rowW - inset;
    // On a leaning panel the band is a parallelogram along the lean.
    const xt = this.leftAt(y) + inset;
    const xb = this.leftAt(y + h) + inset;
    if (r.item.enabled === false) {
      if (this.lean) dashPoly(this.band, [xt, y, right, y, right, y + h, xb, y + h], this.unit, INK_SOFT);
      else dashRect(this.band, xt, y, right - xt, h, this.unit, INK_SOFT);
    } else {
      // On the poster panel the band juts out past the lean.
      const out = this.slab ? Math.round(this.unit * 0.5) : 0;
      const pts = [xt - out, y, right, y, right, y + h, xb - out, y + h];
      this.band.poly(pts).fill(POP_PINK);
      this.band.moveTo(pts[0]!, y).lineTo(right, y).moveTo(pts[6]!, y + h).lineTo(right, y + h).stroke({ width: m.l, color: INK });
      // The glove's fingertip stops just short of the row's drawing, or its words.
      const hand = this.hand!;
      const s = Math.round(this.unit * (this.slab ? GLOVE_SLAB : GLOVE_PAGE));
      const tip = (r.icon ? r.icon.x : r.label.x) - this.unit * 0.12;
      this.pointer.position.set(Math.round(tip - s), Math.round(r.hit.y + this.rowH / 2 - s * 0.2));
      const u = this.unit;
      anim.loop(this, hand, (t) => (hand.x = onBeat(t) * u * 0.22));
      if (animate && prev !== at) {
        anim.play(this, this.band, { dx: -u * (this.slab ? 1.1 : 0.6) }, MS.cursor, EASE.pop);
        anim.play(this, this.pointer, { dx: -u * (this.slab ? 1.6 : 0.9) }, MS.cursor, EASE.pop);
        if (this.slab) anim.play(this, r.label, { scale: 1.3 }, MS.cursorWords, EASE.pop);
      }
    }
    this.setLook(at, true);
  }

  /** The cursor on a button: its face printed pink, pressed in a little as the cursor arrives, with the glove before its words. */
  private drawButtonBand(r: Row, prev: number, animate: boolean): void {
    const m = measures(this.unit);
    const u = this.unit;
    const c = this.cells[this.lit]!;
    // Drawn about the button's middle, so the press squashes it there.
    this.band.position.set(c.x + c.w / 2, c.y + c.h / 2);
    if (r.item.enabled === false) dashRect(this.band, -c.w / 2 + m.L, -c.h / 2 + m.L, c.w - m.L * 2, c.h - m.L * 2, u, INK_SOFT);
    else {
      this.band.rect(-c.w / 2, -c.h / 2, c.w, c.h).fill(POP_PINK).stroke({ width: m.L, color: INK });
      const hand = this.hand!;
      const s = Math.round(u * GLOVE_PAGE);
      this.pointer.position.set(Math.round(r.label.x - u * 0.12 - s), Math.round(c.y + c.h / 2 - s * 0.2));
      anim.loop(this, hand, (t) => (hand.x = onBeat(t) * u * 0.22));
      if (animate && prev !== this.lit) {
        anim.play(this, this.band, { scale: 0.9 }, MS.cursor, EASE.pop);
        anim.play(this, this.pointer, { dx: -u * 0.9 }, MS.cursor, EASE.pop);
      }
    }
    this.setLook(this.lit, true);
  }

  /**
   * The glove's hand back at the start of its poke, as far left as it reaches, until the beat moves it again: so a list
   * measured for the room it takes measures the same at any moment.
   */
  restGlove(): void {
    if (this.hand) this.hand.x = 0;
  }

  /** Help targets remain separate from choosing a row, including disabled rows. */
  helpLinks: Array<{ row: number; zone: Graphics; mark: Graphics }> = [];

  private infoSpace(item: MenuItem): number {
    if (!item.help) return 0;
    if (item.info === 'right') return TOUCH_MIN;
    // Reserve the mark and gaps while measuring the bold cursor label.
    return item.info === 'after_label' ? Math.max(7, Math.min(10, this.unit * 0.42)) * 2 + 8 : 0;
  }

  private addHelpLink(row: number): void {
    const zone = new Graphics();
    const mark = new Graphics();
    zone.eventMode = 'static';
    zone.cursor = 'pointer';
    this.wire(zone);
    zone.on('pointerdown', (e) => this.pressRow(e, row, false));
    zone.on('pointertap', (e) => {
      e.stopPropagation();
      if (!this.tapOk(e) || !this.items[row]?.help) return;
      if (!this.touching) {
        this.select(row);
        // The same callback as browsing a row, also when a result notice covers its help.
        this.onMove?.(row);
        return;
      }
      // On touch the band stays on the row. The page hears of it once: the press told it already if it lit the row.
      const told = this.lifted?.told ?? false;
      this.tapRow(row);
      if (!told) this.onMove?.(row);
    });
    this.hits.addChild(zone);
    this.face.addChild(mark);
    this.helpLinks.push({ row, zone, mark });
    this.drawHelpLink(row, false);
  }

  private drawHelpLink(i: number, lit: boolean): void {
    const link = this.helpLinks.find(h => h.row === i);
    const row = this.rows[i];
    if (!link || !row) return;
    const r = Math.max(7, Math.min(10, this.unit * 0.42));
    const right = row.item.info === 'right';
    const end = row.slotX !== null ? row.slotX - this.arrowW : row.detail?.x ?? this.rowW - this.pad;
    const x = right ? this.rowW - TOUCH_MIN : row.label.x + row.label.width + 4;
    const w = right ? TOUCH_MIN : Math.max(r * 2 + 2, Math.min(TOUCH_MIN, end - x - 3));
    link.zone.clear().rect(0, 0, w, this.rowH).fill({ color: 0xffffff, alpha: 0.001 });
    link.zone.position.set(x, row.hit.y);
    const ink = lit ? CURSOR_WORDS : INK_SOFT;
    const cx = x + w / 2, cy = row.hit.y + this.rowH / 2;
    link.mark.clear().circle(cx, cy, r).stroke({ width: Math.max(1, this.unit * 0.06), color: ink });
    link.mark.circle(cx, cy - r * 0.45, r * 0.11).fill(ink);
    link.mark.rect(cx - r * 0.1, cy - r * 0.1, r * 0.2, r * 0.65).fill(ink);
  }

  /** The keys of rows that step, for the browser checks. */
  arrows: Array<{ zone: Graphics; mark: Container; dir: -1 | 1; row: number; faint: boolean }> = [];

  /** Steps the value of the row under the cursor, if it is a row that steps. */
  private adjust(dir: -1 | 1): void {
    const item = this.items[this.index];
    if (!item?.onAdjust || item.enabled === false) return;
    item.onAdjust(dir);
  }

  choose(): void {
    const item = this.items[this.index];
    if (!item) return;
    if (item.enabled === false) return void this.onRefuse?.();
    this.keep(this.index);
    item.onChoose();
  }

  update(input: Input): void {
    // A list that missed steps was under another page (a confirmation, the Save Code page): it comes back as a list newly shown.
    const covered = this.lastStep >= 0 && input.steps > this.lastStep + 1;
    this.input = input;
    this.lastStep = input.steps;
    if (covered && !this.press && this.touchRow >= 0) {
      const was = this.shown;
      this.touchRow = -1;
      this.shownChanged(was);
    }
    // A finger the system took away (a call, a gesture) never sends its lift to Pixi: it is let go of, and lights nothing.
    if (this.press && input.pointerDown?.(this.press.id) === false) {
      const was = this.shown;
      this.press = null;
      this.touchRow = -1;
      this.shownChanged(was);
    }
    if (!this.items.length) return;
    // On a row that steps, left and right step it, and while they are pressed the cursor stays: a diagonal
    // on a D-pad would otherwise move down and step each row it passed. On other rows they are left for the page.
    const sideways = Boolean(this.items[this.index]?.onAdjust) && (['left', 'right'] as const).some((a) => input.pressed(a) || input.isHeld(a));
    if (sideways) {
      for (const [a, dir] of [['left', -1], ['right', 1]] as const) {
        if (input.pressedOrRepeat(a)) {
          input.consume(a);
          this.adjust(dir);
        }
      }
    } else {
      // Buttons side by side, and a list of things set side by side, move with left and right as well.
      const sideBySide = this.buttons || this.across;
      const across = sideBySide && input.pressedOrRepeat('right');
      const back = sideBySide && input.pressedOrRepeat('left');
      if (sideBySide) {
        input.consume('left');
        input.consume('right');
      }
      if (input.pressedOrRepeat('down') || across) {
        this.index = (this.index + 1) % this.items.length;
        this.onMove?.(this.index);
        this.drawBand();
        this.keepInView();
      }
      if (input.pressedOrRepeat('up') || back) {
        this.index = (this.index - 1 + this.items.length) % this.items.length;
        this.onMove?.(this.index);
        this.drawBand();
        this.keepInView();
      }
    }
    // A press a menu uses is used up, so the dialogue or a screen underneath does not act on it too.
    if (input.pressed('confirm')) {
      input.consume('confirm');
      this.choose();
    } else if (input.pressed('cancel')) {
      input.consume('cancel');
      this.onCancel?.();
    }
  }

  destroy(): void {
    anim.finish(this);
    anim.unloop(this);
    this.container.destroy({ children: true });
  }
}

/** The usual sounds for a list: a blip as the cursor moves, and the cancel sound for a greyed row. */
export function withSounds(m: MenuList, play: (sound: string) => void): MenuList {
  // No blip for the band leaving every row (a finger slid off), or for a move the list made itself.
  m.onMove = (i) => {
    if (i >= 0 && !m.quietMove) play('blip');
  };
  m.onRefuse = () => play('cancel');
  return m;
}

/** A printed button; `setLit` paints it as a list's cursor row, for an owner that handles its presses itself. */
export type PrintedButton = Container & { setLit(lit: boolean): void; isLit(): boolean };

/**
 * A printed button: paper, an ink line, and a hard shadow. Pressed, its face drops onto its shadow
 * and comes back up; what is tapped never moves. `cut` angles its outer end like a tab, `backArrow`
 * puts a drawn arrow before a Back, and `icon` a small picture. Whoever handles its presses itself can light it with
 * `setLit`, as a list lights its cursor's row. With `light` (the sound for it, the blip), it lights itself as Play again
 * under FIN does: while the mouse is over it, and while a finger presses it and is on it (the owner, 2026-11-13, for the
 * map's and the fight's corner buttons: "Okay we can give it a try").
 */
export function button(label: string, unit: number, onTap: () => void, opts: { w?: number; h?: number; size?: number; cut?: 'right'; backArrow?: boolean; icon?: Container; slab?: boolean; light?: () => void } = {}): PrintedButton {
  const m = measures(unit);
  const c = new Container();
  // A loud button (the map's and the fight's corner buttons) is yellow, lettered in poster capitals.
  const letter = Math.round((opts.size ?? unit) * 1.2);
  const t = opts.slab ? new Text({ text: label.toUpperCase(), style: letterStyle(letter, INK) }) : headline(label.toUpperCase(), opts.size ?? Math.round(unit * SMALL_TEXT));
  const h = opts.h ?? m.btnH;
  const cut = opts.cut === 'right' || opts.slab ? h * (opts.slab ? ACT_LEAN : LEAN) : 0;
  const arrowW = opts.backArrow ? Math.round(unit * 0.45) : 0;
  const gap = Math.round(unit * 0.3);
  const lead = (arrowW ? arrowW + gap : 0) + (opts.icon ? opts.icon.width + gap : 0);
  const w = opts.w ?? Math.round(t.width + lead + unit * 1.6 + cut);
  const shape = (g: Graphics, x: number, y: number) => (cut ? g.poly([x, y, x + w, y, x + w - cut, y + h, x, y + h]) : g.rect(x, y, w, h));
  const shadow = shape(new Graphics(), m.S, m.S).fill(INK);
  const face = new Container();
  face.label = 'button_face';
  const plate = new Graphics();
  face.addChild(plate);
  let x = Math.round((w - cut - (lead + t.width)) / 2);
  let arrow: Graphics | null = null;
  if (arrowW) {
    const a = Math.round(unit * 0.55);
    const cy = h / 2;
    // Drawn white and tinted, so a lit button shows it white.
    arrow = new Graphics().poly([x, cy, x + arrowW, cy - a / 2, x + arrowW, cy + a / 2]).fill(0xffffff);
    arrow.tint = INK;
    face.addChild(arrow);
    x += arrowW + gap;
  }
  if (opts.icon) {
    opts.icon.position.set(x, Math.round((h - opts.icon.height) / 2));
    face.addChild(opts.icon);
    x += opts.icon.width + gap;
  }
  t.position.set(x, Math.round((h - t.height) / 2));
  const rest = { x: t.x, y: t.y };
  face.addChild(t);
  c.addChild(shadow, face);
  const iconTint = opts.icon?.tint ?? 0xffffff;
  // Lit, it is the cursor's row of a list: the pink band, its words white (poster capitals with an ink outline and extrude).
  let litNow = false;
  const paint = (lit: boolean) => {
    litNow = lit;
    plate.clear();
    shape(plate, 0, 0).fill(lit ? POP_PINK : opts.slab ? POP_YELLOW : PAPER).stroke({ width: m.L, color: INK, join: 'miter' });
    if (opts.slab) {
      const style = letterStyle(letter, lit ? CURSOR_WORDS : INK, { outline: lit, extrude: lit });
      t.style = style;
      // Pixi draws an outlined word half the outline in from its corner: moved back by that, the letters stay where they
      // were as it lights (the owner, 2026-11-13: the text dropped down and right a little on mousing over).
      const half = lit ? (style.stroke as { width: number }).width / 2 : 0;
      t.position.set(rest.x - half, rest.y - half);
    } else t.style.fill = lit ? CURSOR_WORDS : INK;
    if (arrow) arrow.tint = lit ? CURSOR_WORDS : INK;
    if (opts.icon) opts.icon.tint = lit ? CURSOR_WORDS : iconTint;
  };
  paint(false);
  // What is tapped is the button's own rectangle, wherever its face is while pressed.
  c.hitArea = new Rectangle(0, 0, w, h);
  c.eventMode = 'static';
  c.cursor = 'pointer';
  c.on('pointerdown', () => {
    anim.finish(c);
    face.position.set(m.S, m.S);
  });
  const up = () => {
    if (face.x === 0 && face.y === 0) return;
    face.position.set(0, 0);
    anim.play(c, face, { dx: m.S, dy: m.S }, MS.press, EASE.out);
  };
  c.on('pointerup', up);
  c.on('pointerupoutside', up);
  c.on('pointercancel', up);
  c.on('pointertap', (e) => {
    e.stopPropagation();
    onTap();
  });
  if (opts.light) {
    const sound = opts.light;
    // The finger pressing it, if one is: it lights the button only while it is on it.
    let finger: number | null = null;
    const show = (on: boolean) => {
      if (on === litNow) return;
      paint(on);
      if (on) sound();
    };
    const hovers = (e: FederatedPointerEvent) => e.pointerType !== 'touch';
    c.on('pointerover', (e) => { if (hovers(e)) show(true); });
    c.on('pointerout', (e) => { if (hovers(e)) show(false); });
    // The pressing finger is followed as a list follows one, by where it is, not by Pixi's over and out (which needs the
    // browser's pointerover first).
    c.on('globalpointermove', (e) => {
      if (finger !== e.pointerId) return;
      const at = c.toLocal(e.global);
      show((c.hitArea as Rectangle).contains(at.x, at.y));
    });
    c.on('pointerdown', (e) => {
      if (!hovers(e)) finger = e.pointerId;
      show(true);
    });
    // A finger let go of leaves nothing lit; the mouse keeps it lit while it is still over it.
    c.on('pointerup', (e) => {
      if (hovers(e)) return;
      finger = null;
      show(false);
    });
    for (const gone of ['pointerupoutside', 'pointercancel'] as const) c.on(gone, () => { finger = null; show(false); });
  }
  return Object.assign(c, { setLit: paint, isLit: () => litNow });
}
