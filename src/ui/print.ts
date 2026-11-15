import { Container, Graphics, Text, type TextStyleOptions } from 'pixi.js';
import { thumbReach, type Layout } from '../engine/layout.ts';
import { FONT } from '../render/fonts.ts';
import { BOX, INK, INK_FAINT, PAPER, POP_CYAN, POP_PINK, POP_YELLOW } from '../render/palette.ts';

/**
 * The print kit: the pieces every page, list, and fight panel is made of, drawn as a comic page
 * of a 1980s newspaper. Panels are paper with one even ink line and a hard shadow, square at the
 * corners; names and page titles are inked lettering tabs; pages on an upright phone are sheets
 * rising from the bottom. Everything is sized from the text unit.
 */

/** The smallest height of anything tapped, in CSS pixels: about the size of a fingertip. */
export const TOUCH_MIN = 44;

/** The smallest interface text, in text units: 12 CSS pixels at the smallest unit. */
export const SMALL_TEXT = 0.92;

/** Backing opacity for overlapping active gameplay widgets; lettering and controls stay opaque. */
export const OVERLAPPING_UI_OPACITY = 0.78;

/** The lean of a tab's cut end and the fight's command panel, as a fraction of height (about 12 degrees). */
export const LEAN = 0.21;

/** The paper line round a tab set on black, outside its plate, in CSS pixels. */
export const TAB_KEYLINE = 2;

export interface Measures {
  u: number;
  /** The container line: panel borders and tab edges. */
  L: number;
  /** The detail line: gauges, strike-throughs, dashes, focus lines. */
  l: number;
  /** The hard shadow's offset, down and right. */
  S: number;
  /** The gutter between panels, and the padding inside one. */
  G: number;
  P: number;
  /** Row heights: page lists, the fight's commands, and buttons. Each at least a fingertip. */
  rowH: number;
  cmdRowH: number;
  btnH: number;
  /** Tab heights: a page's title, and a name. */
  titleTabH: number;
  nameTabH: number;
}

export function measures(u: number): Measures {
  return {
    u,
    L: Math.max(2, Math.round(u * 0.16)),
    l: Math.max(1.5, u * 0.08),
    S: Math.max(4, Math.round(u * 0.26)),
    G: Math.round(u * 0.5),
    P: Math.round(u * 0.6),
    rowH: Math.max(TOUCH_MIN, Math.round(u * 2.1)),
    cmdRowH: Math.max(TOUCH_MIN, Math.round(u * 2.3)),
    btnH: Math.max(TOUCH_MIN, Math.round(u * 1.9)),
    titleTabH: Math.round(u * 1.9),
    nameTabH: Math.round(u * 1.5),
  };
}

/** A panel drawn into a Graphics: its hard shadow, then its face with the ink line. */
export function drawPanel(g: Graphics, x: number, y: number, w: number, h: number, m: Measures, opts: { fill?: number; shadow?: boolean; raised?: boolean; border?: number } = {}): Graphics {
  const s = opts.raised ? m.S * 2 : m.S;
  if (opts.shadow !== false) g.rect(x + s, y + s, w, h).fill(INK);
  g.rect(x, y, w, h).fill(opts.fill ?? BOX).stroke({ width: opts.border ?? m.L, color: INK });
  return g;
}

/**
 * A panel as layers: the shadow stays where it is, and the face (the plate and whatever is put on
 * it) is what a motion moves or a press pushes down. The plate takes taps that land on it.
 */
export function panel(w: number, h: number, u: number, opts: { fill?: number; raised?: boolean } = {}): { root: Container; shadow: Graphics; face: Container; plate: Graphics } {
  const m = measures(u);
  const s = opts.raised ? m.S * 2 : m.S;
  const root = new Container();
  const shadow = new Graphics().rect(s, s, w, h).fill(INK);
  const face = new Container();
  const plate = new Graphics().rect(0, 0, w, h).fill(opts.fill ?? BOX).stroke({ width: m.L, color: INK });
  plate.eventMode = 'static';
  face.addChild(plate);
  root.addChild(shadow, face);
  return { root, shadow, face, plate };
}

export type TabInk = 'ink' | 'pink' | 'cyan' | 'faint';

/** Poster lettering: comic capitals with an ink outline and a solid ink extrude down and to the right. */
export function letterStyle(size: number, fill: number, opts: { outline?: boolean; extrude?: boolean } = {}): TextStyleOptions {
  const w = Math.max(2, Math.round(size * 0.13));
  return {
    fontFamily: FONT.letter,
    fontSize: size,
    fill,
    letterSpacing: Math.round(size * 0.05 * 10) / 10,
    padding: w * 2,
    ...(opts.outline ? { stroke: { color: INK, width: w, join: 'round' as const } } : {}),
    ...(opts.extrude ? { dropShadow: { color: INK, alpha: 1, angle: Math.PI / 4, blur: 0, distance: Math.max(2, Math.round(size * 0.09)) } } : {}),
  };
}

/** A tab's plate and lettering: cyan for the acting member, pink for menu focus, paper on grey for someone down. */
function tabInks(ink: TabInk): { plate: number; letter: number; outline: boolean } {
  if (ink === 'pink') return { plate: POP_PINK, letter: 0xffffff, outline: true };
  if (ink === 'cyan') return { plate: POP_CYAN, letter: INK, outline: false };
  if (ink === 'faint') return { plate: INK_FAINT, letter: PAPER, outline: false };
  return { plate: INK, letter: POP_YELLOW, outline: false };
}

/**
 * A lettering tab: a plate with its right end cut at an angle, holding a name or a page's title in
 * poster capitals. It straddles the top edge of what it names, and never takes taps.
 */
export class Tab {
  readonly container = new Container();
  private readonly plate = new Graphics();
  private readonly strike = new Graphics();
  readonly label: Text;
  private readonly u: number;
  private readonly h: number;
  private ink: TabInk;
  private readonly keyline: boolean;
  private readonly size: number;
  /** The lettering's width with its outline, whichever ink it is in, so the plate never changes size with the ink. */
  private textW = 0;

  constructor(text: string, u: number, opts: { size?: 'title' | 'name'; ink?: TabInk; keyline?: boolean } = {}) {
    const m = measures(u);
    this.u = u;
    this.ink = opts.ink ?? 'ink';
    this.keyline = opts.keyline ?? false;
    const size = (this.size = Math.round(u * (opts.size === 'title' ? 1.5 : 1.15)));
    this.label = new Text({ text: text.toUpperCase(), style: letterStyle(size, PAPER, { outline: true }) });
    this.measure();
    this.h = Math.max(opts.size === 'title' ? m.titleTabH : m.nameTabH, Math.round(size * 1.22));
    this.container.eventMode = 'none';
    this.container.addChild(this.plate, this.label, this.strike);
    this.draw();
  }

  get height(): number {
    return this.h;
  }

  get width(): number {
    return Math.round(this.textW + this.u * 0.6 + this.h * LEAN);
  }

  /** Measures the words with an outline, so a tab turning pink does not outgrow its plate. */
  private measure(): void {
    this.label.style = letterStyle(this.size, PAPER, { outline: true });
    this.textW = this.label.width;
  }

  /** New words, drawn on a plate fitted to them. */
  setText(text: string): void {
    if (this.label.text === text.toUpperCase()) return;
    this.label.text = text.toUpperCase();
    this.measure();
    this.draw();
  }

  /** Ink for a name, pink for now or you, faint for someone down. */
  setInk(ink: TabInk): void {
    if (ink === this.ink) return;
    this.ink = ink;
    this.draw();
  }

  private draw(): void {
    const w = this.width;
    const h = this.h;
    const cut = h * LEAN;
    const g = this.plate.clear();
    const shape = () => g.poly([0, 0, w, 0, w - cut, h, 0, h]);
    const inks = tabInks(this.ink);
    // On black, a thin paper line keeps the ink plate from vanishing into the floor.
    if (this.keyline) shape().stroke({ width: TAB_KEYLINE, color: PAPER, alignment: 0 });
    shape().fill(inks.plate);
    if (this.ink === 'pink') shape().stroke({ width: Math.max(1.5, measures(this.u).l), color: INK, alignment: 1 });
    this.label.style = letterStyle(this.size, inks.letter, { outline: inks.outline });
    // Poster capitals sit high in their line; the plate centres their caps, not the line.
    this.label.anchor.set(0, 0.5);
    this.label.position.set(Math.round(this.u * 0.3), Math.round(h / 2 + this.size * 0.04));
    this.strike.clear();
  }
}

/** Where a page goes, and where its contents go on it. */
export interface SheetGeometry {
  /** 'bottom': a sheet rising from the foot of an upright phone. 'card': a panel centred on the page. */
  mode: 'bottom' | 'card';
  /** The sheet's paper, in panel coordinates. */
  plate: { x: number; y: number; w: number; h: number };
  /** The top of everything the page draws, its tab included. */
  top: number;
  /** Where the contents go. */
  inner: { x: number; y: number; w: number; h: number };
}

/** How much room a page's contents have: the widest and tallest they may be. */
export function sheetRoom(l: Layout, opts: { titled: boolean; maxW?: number; above?: number }): { w: number; h: number } {
  const p = l.panel;
  const u = l.unit;
  const m = measures(u);
  const head = opts.titled ? m.titleTabH / 2 : 0;
  const padTop = opts.titled ? m.titleTabH / 2 + m.G : m.P;
  const above = opts.above ?? 0;
  if (thumbReach(l)) return { w: p.w - m.P * 2, h: Math.floor(p.h - u * 0.5 - above - head - padTop - m.P) };
  return { w: Math.min(opts.maxW ?? u * 28, p.w - u) - m.P * 2, h: Math.floor(p.h - u - above - head - padTop - m.P - m.S) };
}

/** Lays out a page of contents `w` by `h`: a bottom sheet on an upright phone, a centred card elsewhere. */
export function sheetGeometry(l: Layout, content: { w: number; h: number }, opts: { titled: boolean; maxW?: number; above?: number }): SheetGeometry {
  const p = l.panel;
  const u = l.unit;
  const m = measures(u);
  const head = opts.titled ? m.titleTabH / 2 : 0;
  const padTop = opts.titled ? m.titleTabH / 2 + m.G : m.P;
  const plateH = Math.round(padTop + content.h + m.P);
  if (thumbReach(l)) {
    const y = p.h - plateH;
    return { mode: 'bottom', plate: { x: 0, y, w: p.w, h: plateH }, top: y - head, inner: { x: m.P, y: y + padTop, w: p.w - m.P * 2, h: content.h } };
  }
  const w = Math.round(Math.min(Math.max(content.w + m.P * 2, u * 12), opts.maxW ?? u * 28, p.w - u));
  const total = head + plateH + m.S + (opts.above ?? 0);
  const top = Math.max(u * 0.5, Math.round((p.h - total) / 2)) + (opts.above ?? 0);
  const x = Math.round((p.w - w) / 2);
  const y = top + head;
  return { mode: 'card', plate: { x, y, w, h: plateH }, top, inner: { x: x + m.P, y: y + padTop, w: w - m.P * 2, h: content.h } };
}

/**
 * Draws a page's sheet. A bottom sheet runs off the panel's sides and foot, with a double rule
 * along its top; a card is a panel with a hard shadow. Either way the title's tab sits on its top edge.
 * The face is what moves as the page opens; the plate takes taps, so one on the paper stays on the page.
 */
export function drawSheet(geo: SheetGeometry, u: number, title?: string, opts: { decorations?: boolean } = {}): { root: Container; face: Container; shadow: Graphics; tab: Tab | null } {
  const m = measures(u);
  const { x, y, w, h } = geo.plate;
  const root = new Container();
  const shadow = new Graphics();
  const face = new Container();
  const plate = new Graphics();
  // What is tapped stays put while the face moves: a still target over the paper and the tab.
  const hit = new Graphics();
  if (geo.mode === 'bottom') {
    // The paper runs on below the foot by more than the rise overshoots (EASE.pop's three tenths of 2.4 units), so the foot never lifts into view.
    plate.rect(x, y, w, h + Math.round(u * 1.2)).fill(BOX);
    const gap = Math.round(u * 0.15);
    plate.rect(x, y, w, m.L).fill(INK);
    plate.rect(x, y + m.L + gap, w, m.l).fill(INK);
  } else {
    shadow.rect(x + m.S, y + m.S, w, h).fill(INK);
    plate.rect(x, y, w, h).fill(BOX).stroke({ width: m.L, color: INK });
  }
  // A field of cyan dots in the top right corner, fading toward the middle, like a poster's printed tint.
  // It stops short of the contents, so no words are printed over it; a strip too thin for it is left plain.
  const dw = Math.min(w * 0.6, u * 16);
  const dh = Math.min(h * 0.4, geo.inner.y - y - u * 0.15);
  const inset = geo.mode === 'bottom' ? m.L * 2 : m.L;
  if (dh >= u * 0.8) benDay(plate, { x: x + w - dw - inset, y: y + inset, w: dw, h: dh - inset }, { color: POP_CYAN, alpha: 0.6, pitch: u * 0.5, from: [x + w - dw, y + dh], to: [x + w, y] });
  plate.label = 'sheet_plate';
  face.addChild(plate);
  hit.rect(x, y, w, h).fill({ color: 0xffffff, alpha: 0.001 });
  let tab: Tab | null = null;
  if (title) {
    tab = new Tab(title, u, { size: 'title', keyline: true });
    const lead = Math.round(u * (geo.mode === 'bottom' ? 0.8 : 0.5));
    // A title too long for the sheet (a long list's title at the largest text) is printed smaller to fit.
    const fit = Math.min(1, (w - lead * 2) / tab.width);
    tab.container.scale.set(fit);
    const tw = tab.width * fit;
    const th = tab.height * fit;
    tab.container.position.set(x + lead, Math.round(y - th / 2));
    // Confetti along the top edge past the tab: the poster's loose shapes, where there is room for them (an empty
    // drawing would still stretch the face's bounds to its origin).
    const room = Math.min(u * 7, x + w - (tab.container.x + tw) - u * 1.4);
    if (opts.decorations !== false && room >= u * 1.5) face.addChild(confetti(new Graphics(), { x: tab.container.x + tw + u * 0.6, y: y - u * 0.9, w: room, h: u * 1.8 }, u, title.length));
    face.addChild(tab.container);
    hit.rect(tab.container.x, tab.container.y, tw, th).fill({ color: 0xffffff, alpha: 0.001 });
  }
  // A tap on the paper or the tab stays on the page.
  hit.eventMode = 'static';
  root.addChild(hit, shadow, face);
  return { root, face, shadow, tab };
}

/** The shade behind a page: flat ink over the whole panel. A tap on it is a tap outside the page. */
export function shade(w: number, h: number, alpha = 0.35): Graphics {
  const g = new Graphics().rect(0, 0, w, h).fill({ color: INK, alpha });
  g.eventMode = 'static';
  return g;
}

/**
 * A small printed key either side of a stepping value: paper with a fine ink line and a chevron
 * pointing the way it steps. At the end the value has reached, the chevron is faint.
 */
export function stepKey(dir: -1 | 1, u: number, faint: boolean): Container {
  const m = measures(u);
  const c = new Container();
  const s = Math.round(u * 1.3);
  const g = new Graphics();
  g.rect(0, 0, s, s).fill(PAPER).stroke({ width: m.l, color: INK });
  const cx = s / 2;
  const cy = s / 2;
  const a = s * 0.2;
  g.poly(dir < 0 ? [cx + a * 0.6, cy - a, cx - a * 0.8, cy, cx + a * 0.6, cy + a] : [cx - a * 0.6, cy - a, cx + a * 0.8, cy, cx - a * 0.6, cy + a]).fill(faint ? INK_FAINT : INK);
  c.addChild(g);
  c.eventMode = 'none';
  return c;
}

/** A small printed key cap with a key's name on it, for the key caps and the Controls page. It never takes taps. */
export function keyTop(label: string, u: number): Container {
  const c = new Container();
  const h = Math.round(u * 1.35);
  const g = new Graphics();
  const t = new Text({ text: label, style: { fontFamily: FONT.headline, fontWeight: '700', fontSize: Math.round(u * SMALL_TEXT), fill: INK } });
  const w = Math.max(h, Math.round(t.width + u * 0.7));
  g.roundRect(1.5, 1.5, w, h, 3).fill({ color: INK, alpha: 0.28 });
  g.roundRect(0, 0, w, h, 3).fill(PAPER).stroke({ width: 1.5, color: INK });
  t.position.set(Math.round((w - t.width) / 2), Math.round((h - t.height) / 2));
  c.addChild(g, t);
  c.eventMode = 'none';
  return c;
}

/** A dashed rectangle outline, for a greyed row under the cursor. */
export function dashRect(g: Graphics, x: number, y: number, w: number, h: number, u: number, color: number): Graphics {
  const m = measures(u);
  const dash = u * 0.5;
  const gap = u * 0.35;
  const line = (x0: number, y0: number, x1: number, y1: number) => {
    const len = Math.hypot(x1 - x0, y1 - y0);
    for (let d = 0; d < len; d += dash + gap) {
      const e = Math.min(len, d + dash);
      g.moveTo(x0 + ((x1 - x0) * d) / len, y0 + ((y1 - y0) * d) / len).lineTo(x0 + ((x1 - x0) * e) / len, y0 + ((y1 - y0) * e) / len);
    }
  };
  line(x, y, x + w, y);
  line(x + w, y, x + w, y + h);
  line(x + w, y + h, x, y + h);
  line(x, y + h, x, y);
  return g.stroke({ width: m.l, color });
}

/** A dashed outline through a closed list of points, for a greyed row under the cursor on a leaning panel. */
export function dashPoly(g: Graphics, pts: number[], u: number, color: number): Graphics {
  const m = measures(u);
  const dash = u * 0.5;
  const gap = u * 0.35;
  const n = pts.length / 2;
  for (let i = 0; i < n; i++) {
    const x0 = pts[i * 2]!;
    const y0 = pts[i * 2 + 1]!;
    const x1 = pts[((i + 1) % n) * 2]!;
    const y1 = pts[((i + 1) % n) * 2 + 1]!;
    const len = Math.hypot(x1 - x0, y1 - y0);
    for (let d = 0; d < len; d += dash + gap) {
      const e = Math.min(len, d + dash);
      g.moveTo(x0 + ((x1 - x0) * d) / len, y0 + ((y1 - y0) * d) / len).lineTo(x0 + ((x1 - x0) * e) / len, y0 + ((y1 - y0) * e) / len);
    }
  }
  return g.stroke({ width: m.l, color });
}

export type IconKind = 'burst' | 'star' | 'bottle';

/**
 * A small line drawing in an icon slot, `s` pixels square, until the art arrives: a jagged burst
 * for Attack, a star for Special, a bottle for Item and items.
 */
export function icon(kind: IconKind, s: number, u: number, color = INK): Graphics {
  const tint = color;
  color = 0xffffff;
  const m = measures(u);
  const g = new Graphics();
  const c = s / 2;
  if (kind === 'burst') {
    const pts: number[] = [];
    for (let i = 0; i < 16; i++) {
      const r = (i % 2 ? 0.26 : 0.48) * s;
      const a = (i / 16) * Math.PI * 2 - Math.PI / 2;
      pts.push(c + Math.cos(a) * r, c + Math.sin(a) * r);
    }
    g.poly(pts).stroke({ width: m.l, color, join: 'round' });
  } else if (kind === 'star') {
    const pts: number[] = [];
    for (let i = 0; i < 10; i++) {
      const r = (i % 2 ? 0.2 : 0.48) * s;
      const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
      pts.push(c + Math.cos(a) * r, c + Math.sin(a) * r);
    }
    g.poly(pts).stroke({ width: m.l, color, join: 'round' });
  } else {
    // A bottle: a neck and cork over a round-shouldered body.
    const w = s * 0.5;
    const x = c - w / 2;
    g.rect(c - s * 0.09, s * 0.06, s * 0.18, s * 0.14).stroke({ width: m.l, color });
    g.moveTo(c - s * 0.09, s * 0.2).lineTo(c - s * 0.09, s * 0.32).lineTo(x, s * 0.44).lineTo(x, s * 0.92).lineTo(x + w, s * 0.92).lineTo(x + w, s * 0.44).lineTo(c + s * 0.09, s * 0.32).lineTo(c + s * 0.09, s * 0.2).stroke({ width: m.l, color, join: 'round' });
  }
  g.tint = tint;
  g.eventMode = 'none';
  return g;
}

/**
 * A field of halftone dots, the pop-art way: a grid turned 45 degrees whose dots grow from nothing
 * at `from` to their fullest at `to`, inside `box` (and inside `inside`, if given). Drawn once, as
 * one fill.
 */
export function benDay(
  g: Graphics,
  box: { x: number; y: number; w: number; h: number },
  opts: { color: number; alpha?: number; pitch: number; from: [number, number]; to: [number, number]; inside?: (x: number, y: number) => boolean; shift?: number },
): Graphics {
  const { pitch } = opts;
  // A shifted grid (a drift) moves its dots along x, wrapping within one pitch so the field never runs out at its start.
  const shift = ((((opts.shift ?? 0) % pitch) + pitch) % pitch) - pitch;
  const rMax = pitch * 0.42;
  const [fx, fy] = opts.from;
  const dx = opts.to[0] - fx;
  const dy = opts.to[1] - fy;
  const len2 = Math.max(1, dx * dx + dy * dy);
  let any = false;
  for (let r = 0, y = box.y + pitch * 0.25; y < box.y + box.h; r++, y += pitch * 0.5) {
    for (let x = box.x + (r % 2 ? pitch * 0.5 : 0) + pitch * 0.25 + shift; x < box.x + box.w; x += pitch) {
      const k = Math.max(0, Math.min(1, ((x - fx) * dx + (y - fy) * dy) / len2));
      // A dot shrinks to stay inside its box, so a field never reaches past what it prints on.
      const rad = Math.min(rMax * k, x - box.x, box.x + box.w - x, y - box.y, box.y + box.h - y);
      if (rad < 0.6) continue;
      if (opts.inside && !opts.inside(x, y)) continue;
      g.circle(x, y, rad);
      any = true;
    }
  }
  if (any) g.fill({ color: opts.color, alpha: opts.alpha ?? 1 });
  return g;
}

/** A small generator of numbers from a seed, so the same page throws the same confetti every time. */
export function seeded(seed: number): () => number {
  let s = (seed * 2654435761) >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * Confetti: a few loose poster shapes (a zigzag, a triangle, a ring, a bolt) in the loud inks with
 * an ink line, thrown along a strip. The same seed throws the same shapes.
 */
export function confetti(g: Graphics, area: { x: number; y: number; w: number; h: number }, u: number, seed: number): Graphics {
  if (area.w < u * 1.5) return g;
  const rnd = seeded(seed + 7);
  const m = measures(u);
  const line = Math.max(1.5, m.l * 1.1);
  const inks = [POP_PINK, POP_CYAN, POP_YELLOW];
  const n = Math.max(2, Math.min(4, Math.floor(area.w / (u * 2.2))));
  for (let i = 0; i < n; i++) {
    const cx = area.x + ((i + 0.5) / n) * area.w + (rnd() - 0.5) * u * 0.6;
    const cy = area.y + area.h * (0.25 + rnd() * 0.5);
    const s = u * (0.7 + rnd() * 0.3);
    const a = rnd() * Math.PI;
    const ink = inks[(i + seed) % inks.length]!;
    const kind = (i + seed) % 4;
    const rot = (px: number, py: number): [number, number] => [cx + px * Math.cos(a) - py * Math.sin(a), cy + px * Math.sin(a) + py * Math.cos(a)];
    if (kind === 0) {
      // A zigzag.
      const pts = [-1, 0.3, -0.5, -0.3, 0, 0.3, 0.5, -0.3, 1, 0.3];
      const p0 = rot(pts[0]! * s, pts[1]! * s);
      g.moveTo(p0[0], p0[1]);
      for (let j = 2; j < pts.length; j += 2) {
        const p = rot(pts[j]! * s, pts[j + 1]! * s);
        g.lineTo(p[0], p[1]);
      }
      g.stroke({ width: line * 2.2, color: INK, cap: 'round', join: 'round' });
      g.moveTo(p0[0], p0[1]);
      for (let j = 2; j < pts.length; j += 2) {
        const p = rot(pts[j]! * s, pts[j + 1]! * s);
        g.lineTo(p[0], p[1]);
      }
      g.stroke({ width: line * 1.1, color: ink, cap: 'round', join: 'round' });
    } else if (kind === 1) {
      const pts = [0, -0.7, 0.65, 0.45, -0.65, 0.45].flatMap((v, j, arr) => (j % 2 ? [] : rot(v * s, arr[j + 1]! * s)));
      g.poly(pts).fill(ink).stroke({ width: line, color: INK, join: 'round' });
    } else if (kind === 2) {
      g.circle(cx, cy, s * 0.5).stroke({ width: line * 2.6, color: INK });
      g.circle(cx, cy, s * 0.5).stroke({ width: line * 1.2, color: ink });
    } else {
      const pts = [0.15, -0.8, -0.35, 0.1, 0.05, 0.1, -0.15, 0.8, 0.4, -0.15, 0, -0.15].flatMap((v, j, arr) => (j % 2 ? [] : rot(v * s, arr[j + 1]! * s)));
      g.poly(pts).fill(ink).stroke({ width: line, color: INK, join: 'round' });
    }
  }
  return g;
}

/**
 * Comic focus lines: thin wedges from past the edges of `area` pointing in at `centre`, white with an
 * ink line and every third in `accent`, reaching `reach` of the way in (0 draws nothing, 0.6 is most of
 * the way), each a little longer or shorter than the next. The same seed draws the same lines.
 */
export function focusLines(g: Graphics, area: { x: number; y: number; w: number; h: number }, centre: [number, number], reach: number, u: number, seed: number, accent = POP_PINK): Graphics {
  if (reach <= 0.01) return g;
  const rnd = seeded(seed + 11);
  const line = Math.max(1.5, measures(u).l);
  const [cx, cy] = centre;
  const far = Math.hypot(area.w, area.h) * 1.5;
  const n = 30;
  for (let i = 0; i < n; i++) {
    const a = ((i + rnd() * 0.6) / n) * Math.PI * 2;
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    // How far the panel's edge is from the centre this way; each line's tip is part of the way in from it.
    const tx = dx > 1e-6 ? (area.x + area.w - cx) / dx : dx < -1e-6 ? (area.x - cx) / dx : Infinity;
    const ty = dy > 1e-6 ? (area.y + area.h - cy) / dy : dy < -1e-6 ? (area.y - cy) / dy : Infinity;
    const edge = Math.max(0, Math.min(tx, ty));
    const tip = edge * (1 - reach * (0.6 + rnd() * 0.4));
    const half = (0.012 + rnd() * 0.02) * Math.PI;
    g.poly([cx + dx * tip, cy + dy * tip, cx + Math.cos(a - half) * far, cy + Math.sin(a - half) * far, cx + Math.cos(a + half) * far, cy + Math.sin(a + half) * far])
      .fill(i % 3 === 0 ? accent : 0xffffff)
      .stroke({ width: line, color: INK, join: 'miter' });
  }
  return g;
}

/** A starburst's points about (cx, cy): `n` spikes out to `r`, their valleys at `inner` of it, turned by `turn`. */
export function burstPoints(cx: number, cy: number, r: number, n: number, inner: number, turn = 0): number[] {
  const pts: number[] = [];
  for (let i = 0; i < n * 2; i++) {
    const rr = i % 2 ? r * inner : r;
    const a = (i / (n * 2)) * Math.PI * 2 + turn - Math.PI / 2;
    pts.push(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
  }
  return pts;
}

/**
 * The play-again mark: a clockwise circular arrow, about `s` pixels across, its box at 0,0. Drawn in white and tinted
 * `color`, as `icon` is, so a lit button can show it white. It never takes taps.
 */
export function replayIcon(s: number, color = INK): Container {
  const g = new Graphics();
  const r = s * 0.3;
  const k = s * 0.14;
  const c = s / 2;
  // The tail just above the right, the head just short of the top: the gap between them stays open at any size.
  const from = -0.35;
  const to = Math.PI * 1.5 - 0.17;
  g.moveTo(c + Math.cos(from) * r, c + Math.sin(from) * r).arc(c, c, r, from, to).stroke({ width: k, color: 0xffffff, cap: 'butt' });
  // The head, wider than the line, pointing the way the arrow turns.
  const tx = -Math.sin(to);
  const ty = Math.cos(to);
  const half = k * 1.15;
  const len = k * 1.5;
  g.poly([
    c + Math.cos(to) * (r + half), c + Math.sin(to) * (r + half),
    c + Math.cos(to) * r + tx * len, c + Math.sin(to) * r + ty * len,
    c + Math.cos(to) * (r - half), c + Math.sin(to) * (r - half),
  ]).fill(0xffffff);
  const box = g.getLocalBounds();
  g.position.set(-box.x, -box.y);
  const holder = new Container();
  holder.addChild(g);
  holder.tint = color;
  holder.eventMode = 'none';
  return holder;
}

/**
 * A folded newspaper, `s` pixels tall: a paper sheet with an ink line, a headline bar, a small picture,
 * and lines of print, turned a little. The Stats/Item button's icon. It never takes taps.
 */
export function newspaperIcon(s: number, u: number): Container {
  const c = new Container();
  const g = new Graphics();
  const line = Math.max(1.5, measures(u).l);
  const w = Math.round(s * 0.8);
  g.rect(0, 0, w, s).fill(0xffffff).stroke({ width: line, color: INK });
  g.rect(w * 0.14, s * 0.13, w * 0.72, s * 0.14).fill(INK);
  g.rect(w * 0.14, s * 0.38, w * 0.32, s * 0.24).fill(POP_PINK).stroke({ width: Math.max(1, line * 0.7), color: INK });
  for (const y of [0.4, 0.5, 0.6, 0.74, 0.84]) g.rect(y < 0.7 ? w * 0.54 : w * 0.14, s * y, y < 0.7 ? w * 0.32 : w * 0.72, Math.max(1, s * 0.05)).fill(INK);
  g.pivot.set(w / 2, s / 2);
  g.rotation = -0.12;
  g.position.set(w / 2 + s * 0.06, s / 2);
  c.addChild(g);
  c.eventMode = 'none';
  return c;
}

/** The glove's length on the fight's command panel and on a page's list, in text units. */
export const GLOVE_SLAB = 2.8;
export const GLOVE_PAGE = 2.0;

/**
 * How far, in text units, the command panel's glove reaches left of the panel's foot: its length, less the
 * row's padding (0.6) and the inset before a row's drawing (0.3), plus the gap its fingertip stops short by (0.12).
 */
export const GLOVE_SLAB_REACH = GLOVE_SLAB - 0.6 - 0.3 + 0.12;

/**
 * The cursor's pointing hand: a cartoon glove pointing right, `s` pixels long, white with an ink
 * line and a solid ink shadow. Its fingertip is at (s, 0.16 s); it never takes taps.
 */
export function glove(s: number, u: number): Container {
  const c = new Container();
  const g = new Graphics();
  const line = Math.max(1.5, measures(u).l * 1.25);
  const parts = (d: number, fill: number, stroke: boolean) => {
    const at = (v: number) => v * s + d * s;
    const done = () => {
      g.fill(fill);
      if (stroke) g.stroke({ width: line, color: INK, join: 'round' });
    };
    // The pointing finger along the top, the back of the hand, three curled fingers stacked on its front, the thumb across it, and the cuff.
    g.roundRect(at(0.48), at(0.08), 0.52 * s, 0.16 * s, 0.08 * s);
    done();
    g.roundRect(at(0.13), at(0.07), 0.5 * s, 0.44 * s, 0.15 * s);
    done();
    for (const [x, y] of [[0.5, 0.23], [0.49, 0.32], [0.46, 0.41]] as const) {
      g.roundRect(at(x), at(y), 0.17 * s, 0.1 * s, 0.05 * s);
      done();
    }
    g.roundRect(at(0.3), at(0.19), 0.24 * s, 0.1 * s, 0.05 * s);
    done();
    g.poly([at(0), at(0.03), at(0.16), at(0.09), at(0.16), at(0.49), at(0), at(0.55)]);
    done();
  };
  parts(0.045, INK, false);
  parts(0, 0xffffff, true);
  c.addChild(g);
  c.eventMode = 'none';
  return c;
}

/**
 * A poster tag: yellow, a heavy ink line and a solid ink shadow, poster capitals, and (unless left out) a
 * pink star at its left. It is drawn from its top left corner; its size is returned for placing it.
 * Notices, the newspaper's ear, and a chapter page's "continued" are tags.
 */
export function posterTag(text: string, u: number, opts: { size?: number; wrapW?: number; star?: boolean } = {}): { c: Container; w: number; h: number } {
  const m = measures(u);
  const c = new Container();
  const t = new Text({ text, style: { ...letterStyle(opts.size ?? Math.round(u * 1.3), INK), ...(opts.wrapW ? { wordWrap: true, wordWrapWidth: opts.wrapW } : {}) } });
  const star = opts.star === false ? 0 : Math.round(Math.max(u * 0.9, Number(t.style.fontSize) * 1.15));
  const w = Math.round(t.width + star + u * (star ? 1.4 : 1.0));
  const h = Math.round(Math.max(t.height * 0.85, star) + u * 0.7);
  const bg = new Graphics();
  bg.rect(m.S, m.S, w, h).fill(INK);
  bg.rect(0, 0, w, h).fill(POP_YELLOW).stroke({ width: m.L, color: INK });
  if (star) {
    const pts: number[] = [];
    for (let i = 0; i < 16; i++) {
      const r = (i % 2 ? 0.26 : 0.5) * star;
      const a = (i / 16) * Math.PI * 2 - Math.PI / 2;
      pts.push(u * 0.5 + star / 2 + Math.cos(a) * r, h / 2 + Math.sin(a) * r);
    }
    bg.poly(pts).fill(POP_PINK).stroke({ width: Math.max(1.5, m.l), color: INK, join: 'miter' });
  }
  t.anchor.set(0, 0.5);
  t.position.set(Math.round(star ? u * 0.9 + star : u * 0.5), Math.round(h / 2 + u * 0.05));
  c.addChild(bg, t);
  return { c, w, h };
}

/** Scissors, `s` pixels long, pointing right with their blades open: the cut line of a coupon. It never takes taps. */
export function scissors(s: number, u: number): Container {
  const c = new Container();
  const g = new Graphics();
  const line = Math.max(1.5, measures(u).l);
  const at = (x: number, y: number) => [x * s, y * s];
  // Two blades crossing at the pivot, and a finger loop at the end of each.
  g.poly([...at(0.3, 0.6), ...at(1, 0.26), ...at(0.97, 0.38), ...at(0.4, 0.67)]).fill(0xffffff).stroke({ width: line, color: INK, join: 'round' });
  g.poly([...at(0.3, 0.4), ...at(1, 0.74), ...at(0.97, 0.62), ...at(0.4, 0.33)]).fill(0xffffff).stroke({ width: line, color: INK, join: 'round' });
  for (const y of [0.24, 0.76]) g.circle(0.16 * s, y * s, 0.14 * s).fill(0xffffff).stroke({ width: line * 1.3, color: INK });
  g.circle(0.47 * s, 0.5 * s, Math.max(1.5, 0.045 * s)).fill(INK);
  c.addChild(g);
  c.eventMode = 'none';
  return c;
}
