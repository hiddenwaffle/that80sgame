import { Container, Graphics, GraphicsContext, Point, Rectangle, Text, type FederatedPointerEvent } from 'pixi.js';
import { isLook } from '../art/characters.ts';
import { COAST, MAP_STEP } from '../art/titleMapData.ts';
import { DIVE_S, diveZoomShare } from '../audio/diveTiming.ts';
import type { GameContext } from '../game/context.ts';
import { drawDensity } from '../render/density.ts';
import { FONT } from '../render/fonts.ts';
import { motion } from '../render/motion.ts';
import { Actor } from '../world/actor.ts';
import { anim } from './anim.ts';
import { GLOBE_PINK, TitleGlobe } from './titleGlobe.ts';
import { titleGlobeFields } from './title_globe_load.ts';
import { TitleBackdrop } from './title_backdrop.ts';
import { TitleTicker } from './title_ticker.ts';
import { titleBeatSwell } from './title_beat.ts';
import { DotStroke, TitleDots, TITLE_DOT_MIN_ARC, TITLE_DOT_SPACING } from './titleDots.ts';
import { PAC_LAT_LIMIT } from './titleChase.ts';
import { discShown } from './titleProjection.ts';
import type { Screen } from './screens.ts';
import { enabledMenuIndex, MenuList, SMALL_TEXT, withSounds, type MenuItem } from './widgets.ts';
import { drawSheet, sheetGeometry, sheetRoom } from './print.ts';
import { thumbReach } from '../engine/layout.ts';

/**
 * The title as a map of the world in the house's colours (the owner, 2026-10-21 and 22), a trial on its own branch: the
 * coastlines drawn as the house's neon walls, a graticule in the house's dim floor-grid pink, city lights as the game's
 * pellets, throbbing as its power pellets do but gently, and the trio eating them; the game's title menu on its coupon
 * in the panel's corner. The map is drawn on the game's title layer, behind the panel, across the whole window, in
 * Robinson's projection with the prime meridian down the middle and the equator across it.
 *
 * New Game dives straight into Tokyo, on the same map centred on the Pacific (CENTRE_LON): it opens with the map's top edge
 * on the window's, slowly at first and very fast at the end. Once Japan's coastlines have left the view, finer and finer
 * grids take over, each a third of the last and anchored on the house's floor tiles, with the Pac-World's neon walls rising
 * out of them, the ground darkening to the black round the house, and the house's own view growing in the middle until it
 * is the view the game opens on. The coastlines are built once at a few line widths, crossfaded as the zoom
 * passes each, so the dive moves geometry rather than drawing it again. With Reduce motion the map holds still and New
 * Game skips the dive.
 */

/** Where the dive lands, from the game, asked afresh every step (a relayout can move it). */
export interface TitleLanding {
  /** Where the house's view centres, in the title layer's coordinates (the window, upright). */
  x: number;
  y: number;
  /** Pixels a house tile spans once landed. */
  tile: number;
  /** The house map's tile edges from that centre, in tiles: the lines fall at ox + k and oy + k for whole k. */
  ox: number;
  oy: number;
  /** The house map's extent from that centre, in tiles, which the Pac-World's walls keep out of. */
  house: { x0: number; y0: number; x1: number; y1: number };
  /** Shows the house's own view at f of its landed size (1 once landed), at this opacity. */
  reveal(f: number, alpha: number): void;
}

// Robinson's projection: x = 0.8487 R X(lat) λ, y = 1.3523 R Y(lat), X and Y from its table every 5 degrees, read
// smoothly between the entries (Catmull-Rom) so the meridians and the oval have no corners. In units of R.
const RX = [1.0, 0.9986, 0.9954, 0.99, 0.9822, 0.973, 0.96, 0.9427, 0.9216, 0.8962, 0.8679, 0.835, 0.7986, 0.7597, 0.7186, 0.6732, 0.6213, 0.5722, 0.5322];
const RY = [0, 0.062, 0.124, 0.186, 0.248, 0.31, 0.372, 0.434, 0.4958, 0.5571, 0.6176, 0.6769, 0.7346, 0.7903, 0.8435, 0.8936, 0.9394, 0.9761, 1.0];
function table(t: number[], lat: number, odd: boolean): number {
  const a = Math.min(90, Math.abs(lat)) / 5, i = Math.min(17, Math.floor(a)), f = a - i;
  const p0 = i > 0 ? t[i - 1]! : (odd ? -t[1]! : t[1]!), p1 = t[i]!, p2 = t[i + 1]!, p3 = i < 17 ? t[i + 2]! : 2 * t[18]! - t[17]!;
  return p1 + 0.5 * f * (p2 - p0 + f * (2 * p0 - 5 * p1 + 4 * p2 - p3 + f * (3 * (p1 - p2) + p3 - p0)));
}
function robinson(lat: number, lon: number): [number, number] {
  return [0.8487 * table(RX, lat, false) * lon * Math.PI / 180, 1.3523 * Math.sign(lat) * table(RY, lat, true)];
}

/**
 * The flat map is centred on the Pacific, as world maps printed in Japan are, so the dive opens on a whole map with the house's
 * home in its middle (the owner, 2026-10-26: "imagine a flat map, a rectangle. But instead of in the center of it being the
 * intersection of the equator and the prime meridian, it is Tokyo"). 150 degrees east puts the map's seam at 30 west, in the
 * Atlantic east of Brazil, where it splits only Greenland's east coast; at Tokyo's own meridian it would cut off Brazil's tip.
 */
const CENTRE_LON = 150;
/** Robinson's latitude for a map height v (in R), by bisection: the table rises steadily from the equator to the pole. */
function robinsonLat(v: number): number {
  const target = Math.abs(v) / 1.3523;
  let lo = 0, hi = 90;
  for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (table(RY, mid, true) < target) lo = mid; else hi = mid; }
  return Math.sign(v) * (lo + hi) / 2;
}
/** A longitude east of the map's centre, in (-180, 180]. */
const fromCentre = (lon: number) => { const d = ((lon - CENTRE_LON) % 360 + 540) % 360 - 180; return d === -180 ? 180 : d; };
/** A point of the stored map (centred on Greenwich) on the Pacific-centred map, as [longitude from the centre, latitude]. */
function recentre(u: number, v: number): [number, number] {
  const lat = robinsonLat(v);
  return [fromCentre(u / (0.8487 * table(RX, lat, false) * Math.PI / 180)), lat];
}
let pacificCoast: number[][] | null = null;
/** The coastlines on the Pacific-centred map, in units of R, [u0, v0, u1, v1, ...] per line; a line that crosses the seam
 * is cut there and goes on from the map's other edge, with a point on each edge so it meets the oval. Worked out once. */
function coastOnPacificMap(): number[][] {
  if (pacificCoast) return pacificCoast;
  const out: number[][] = [];
  for (const line of COAST) {
    let u = 0, v = 0, prev: [number, number] | null = null, cur: number[] = [];
    for (let i = 0; i < line.length; i += 2) {
      u += line[i]! * MAP_STEP; v += line[i + 1]! * MAP_STEP;
      const p = recentre(u, v);
      if (prev && Math.abs(p[0] - prev[0]) > 180) {
        // Across the seam: where the line meets it, it ends at one edge and starts again at the other.
        const edge = prev[0] > 0 ? 180 : -180, b = p[0] + (prev[0] > 0 ? 360 : -360), f = (edge - prev[0]) / (b - prev[0]);
        const lat = prev[1] + f * (p[1] - prev[1]);
        cur.push(...robinson(lat, edge));
        if (cur.length >= 4) out.push(cur);
        cur = [...robinson(lat, -edge)];
      }
      cur.push(...robinson(p[1], p[0]));
      prev = p;
    }
    if (cur.length >= 4) out.push(cur);
  }
  return (pacificCoast = out);
}

/**
 * Where New Game's dive lands on the map, in units of R: Tokyo, the house's home, centred from the dive's first frame (the
 * owner, 2026-10-26: "recenter the map transition into the house on Japan instead of the middle of the atlantic ocean",
 * then "precentered before it zooms, like Tokyo is in the center of the screen when it starts").
 */
const DIVE_HOME = robinson(35.68, fromCentre(139.69));
/** The map's north edge (the pole's line), in R. */
const NORTH = robinson(90, 0)[1];

/**
 * The zoom (in R per window pixel's worth, as the dive's map scale) past which no coastline is in a W x H view centred on
 * (u, v), in R: every point of every line is then further out than half the view across or down. Along a segment the
 * nearer of those two edge measures is convex, so a ternary search finds its least.
 */
function coastGoneZoom(u: number, v: number, W: number, H: number, R: number): number {
  let z = 1;
  for (const line of coastOnPacificMap()) for (let i = 2; i < line.length; i += 2) {
    const ax = line[i - 2]! - u, ay = line[i - 1]! - v, bx = line[i]! - u, by = line[i + 1]! - v;
    // Far across the map, a segment can only leave the view early; skip it.
    if (Math.min(Math.abs(ax), Math.abs(bx)) > 0.5 && Math.sign(ax) === Math.sign(bx)) continue;
    const m = (t: number) => Math.max(Math.abs(ax + (bx - ax) * t) / W, Math.abs(ay + (by - ay) * t) / H);
    let lo = 0, hi = 1;
    for (let k = 0; k < 50; k++) { const m1 = lo + (hi - lo) / 3, m2 = hi - (hi - lo) / 3; if (m(m1) < m(m2)) hi = m2; else lo = m1; }
    const least = m((lo + hi) / 2);
    z = Math.max(z, least > 0 ? 1 / (2 * R * least) : Infinity);
  }
  return z;
}

/** R is the largest that shows Brisbane and Japan across (2.3 R either side) and Greenland's north with a margin. */
const FIT_W = 4.6, FIT_H = 2.68;
/** The scale the line widths were set at: a 1672x941 window. */
const R_REF = 351.1;
/** A pac's size in R (33 pixels at R_REF); a pellet is 4/22 of a ball, its glow 7/22, as in the game. */
const PAC = 0.093;
/**
 * The dots' tick (sfx 'dot'): each dot of a run a step up the title's C major pentatonic, then back down; at most one
 * tick every DOT_TICK_GAP s, since a quick drag sets several dots a frame; a run starts again at the bottom after a rest.
 */
const DOT_STEPS = [1, 9 / 8, 5 / 4, 3 / 2, 5 / 3, 2, 9 / 4, 5 / 2, 3, 10 / 3];
const DOT_TICK_GAP = 0.05, DOT_RUN_REST = 0.6;
/**
 * The globe drawn close, its left side off the window: on every window the same share of it shows, as at 1440 by 900 (the
 * owner, 2026-11-04: that view is the ideal, "between 50% and 75% visible"), so a short phone's globe runs off rather than
 * shrinking to show whole. On a wide window its middle stands lowest once its radius is GLOBE_ZOOM_WIDE of the height.
 */
const GLOBE_SHOWN = 0.54, GLOBE_ZOOM_WIDE = 0.72;
/** On a tall window the globe's right rim stands this far across. */
const GLOBE_PORTRAIT_RIM = 0.92;

/** The radius, at least `least`, at which GLOBE_SHOWN of the globe is inside a w by h window, given where a radius puts its middle. */
function radiusShowing(w: number, h: number, least: number, at: (r: number) => [number, number]): number {
  let lo = least, hi = 4 * Math.max(w, h);
  for (let i = 0; i < 32; i++) {
    const r = (lo + hi) / 2, [x, y] = at(r);
    if (discShown(x, y, r, w, h) > GLOBE_SHOWN) lo = r; else hi = r;
  }
  return lo;
}

/** The trio's chomp, as a share of the game's (a mouth step every 0.0563 s, not 0.05). */
const CHOMP = 0.05 / 0.0563;
/** Map units a metre at the equator, across: a house tile counts as a metre. */
const KD = 0.8487 / 6371000;
/** How many line widths the coastlines and the graticule are built at for the dive (each half the last). */
const COAST_LODS = 6, GRAT_LODS = 4;

// The house's colours (src/world/terrainView.ts drawArcade): its floor, the walls' fill, the floor grid, the neon.
/** The name's neon tube: the game's own yellow (the owner, 2026-10-25), an amber glow under it and a cream core. */
const NAME_TUBE = 0xffd23f, NAME_GLOW = 0x8a5a00, NAME_CORE = 0xfff6d0;
const FLOOR = 0x140a1a, WALL_FILL = 0x05050c, GRID = 0x4a1d47, NEON = 0xff4fa3, NEON_GLOW = 0x7a1f52, NEON_CORE = 0xdfe6ff;
// Pixi draws a stroke as triangles, and where they overlap (at every join) see-through colour adds up: on coastlines of
// thousands of close points that makes beads. So the coastlines' neon is drawn opaque, each stroke's colour worked out
// as the see-through stroke would show over the floor (and over the strokes under it), widest first.
const rgb = (c: number) => [(c >> 16) & 255, (c >> 8) & 255, c & 255];
const pack = (v: number[]) => (Math.min(255, Math.round(v[0]!)) << 16) | (Math.min(255, Math.round(v[1]!)) << 8) | Math.min(255, Math.round(v[2]!));
const mix = (a: number, b: number, t: number) => { const x = rgb(a), y = rgb(b); return pack(x.map((v, i) => v + (y[i]! - v) * t)); };
const plus = (a: number, b: number, k: number) => { const x = rgb(a), y = rgb(b); return pack(x.map((v, i) => v + y[i]! * k)); };
/** The coastlines' bloom (the house's 14, 9 and 5.5 wide strokes at 7, 12 and 22 per cent) at a strength, then the neon
 * over it (the glow, the hot-pink tube, the pale core): [width, colour] pairs, widest first, all opaque. */
function coastStack(bloom: number): [number, number][] {
  const c1 = plus(FLOOR, NEON, 0.07 * bloom), c2 = plus(c1, NEON, 0.12 * bloom), c3 = plus(c2, NEON, 0.22 * bloom);
  return [[14, c1], [9, c2], [5.5, c3], [5, mix(c3, NEON_GLOW, 0.55)], [1.9, NEON], [0.75, mix(NEON, NEON_CORE, 0.85)]];
}
/** The bloom's strength at its brightest; it breathes by a tint down from there. */
const BLOOM_TOP = 0.95;
const WALL = [[5, NEON_GLOW, 0.5], [1.9, NEON, 0.95], [0.75, NEON_CORE, 0.75]] as const;
const DUSK_GLOBE = { ...GLOBE_PINK, floor: 0x103a51, grid: 0x27758a, gridLand: 0x3e8a83 };
/** Coastlines have thousands of close points: round joins would lay a fan over each, and the see-through glows would add
 * up into beads, so they join mitred and end square. */
const COAST_JOIN = { cap: 'butt', join: 'miter', miterLimit: 2 } as const;

const grey = (k: number) => { const v = Math.max(0, Math.min(255, Math.round(255 * k))); return (v << 16) | (v << 8) | v; };
const sm = (a: number, b: number, x: number) => { const q = Math.max(0, Math.min(1, (x - a) / (b - a))); return q * q * (3 - 2 * q); };
/** Whether an edge of a grid is a wall, the same every time. */
function hash(a: number, b: number, c: number, d: number): number {
  let x = Math.imul(a, 73856093) ^ Math.imul(b, 19349663) ^ Math.imul(c, 83492791) ^ Math.imul(d, 2654435761);
  x = Math.imul(x ^ (x >>> 13), 1274126177);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}


/** Whether this browser gives WebGL 2, which Pixi then uses (the globe's shader language follows it). */
let hasWebgl2: boolean | null = null;
function webgl2(): boolean {
  if (hasWebgl2 === null) {
    try { hasWebgl2 = typeof WebGL2RenderingContext !== 'undefined' && document.createElement('canvas').getContext('webgl2') !== null; }
    catch { hasWebgl2 = false; }
  }
  return hasWebgl2;
}

export class TitleMap implements Screen {
  /** In the panel: the menu's coupon and the credit. */
  readonly container = new Container();
  readonly blocking = true;
  /** The credit, for the browser checks. */
  credit: Text | null = null;
  /** The credit tab and the disclaimer's ticker along the foot. */
  private ticker: TitleTicker | null = null;
  menu: MenuList | null = null;
  /** Seconds on top of the stack, for the browser checks; the menu takes keys after 0.35 s, as the front page's does. */
  age = 0;
  private done = false;
  private readonly game: GameContext;
  private readonly items: MenuItem[];
  /** The row the pointer starts on. */
  private readonly start: number;
  /** On the title layer, the whole window. */
  private readonly layer = new Container();
  /** What the dive scales: the ground, the graticule and the coastlines. */
  private readonly mapLayer = new Container();
  private readonly backdrop = new TitleBackdrop();
  private readonly gratBox = new Container();
  private readonly coastBox = new Container();
  private readonly black = new Graphics();
  private readonly gridG = new Graphics();
  private readonly wallG = new Graphics();
  private ground = new Graphics();
  private bloom0: Graphics | null = null;
  /** The coastlines in the window's pixels at the map's own size. */
  private paths: Float32Array[] = [];
  private W = 0;
  private H = 0;
  private R = 1;
  private K = 1;
  private cx = 0;
  private cy = 0;
  private clock = 0;
  private lastClock = -1;
  private diveRun: { t: number; landing: () => TitleLanding | null; resolve: () => void } | null = null;
  /** The zoom's logarithm at which the last coastline leaves the view, worked out as the dive starts. */
  private coastGone = 0;
  private landed = false;
  /** The turning neon globe under the name (concept D, the owner's direction of 2026-10-22, on every screen since 2026-10-23).
   * The flat map is still built under it for New Game's dive. */
  private globe: TitleGlobe | null = null;
  private globeTrio: Actor[] = [];
  private wordmark: Container | null = null;
  private wordmarkGlow: Text[] = [];
  private readonly dots = new TitleDots();
  /** How the menu stands on the globe (the coupon is the newspaper's). */
  private dotRun = 0;
  private lastDotTick = -Infinity;
  private readonly stroke = new DotStroke();
  private readonly pointerPoint = new Point();
  private readonly couponPoint = new Point();
  private readonly couponBounds = new Rectangle();
  private readonly dotLocation = { lon: 0, lat: 0 };
  private pointer: number | null = null;

  constructor(game: GameContext, items: MenuItem[], start = 0) {
    this.game = game;
    this.items = items;
    this.start = start;
    this.mapLayer.addChild(this.ground, this.gratBox, this.coastBox);
    this.layer.addChild(this.backdrop.view, this.mapLayer, this.black, this.gridG, this.wallG);
    this.layer.addChild(this.dots.view);
    this.layer.eventMode = 'static';
    game.titleLayer.addChild(this.layer);
    // The title owns the background hit both inside the panel and outside it. The game's passive root does not
    // receive Pixi capture events. Coupon children keep their own taps; these listeners never stop or prevent them.
    for (const target of [this.layer, this.container]) {
      target.on('pointerdown', this.dotDown);
      target.on('pointerup', this.dotUp);
      target.on('pointerupoutside', this.dotUp);
    }
    this.container.eventMode = 'static';
    this.container.on('globalpointermove', this.dotMove);
    window.addEventListener('pointercancel', this.endStroke);
    window.addEventListener('blur', this.endStroke);
    this.layout();
    // The neon switching on: a hum and two ticks as the coasts flicker on (step), not the newspaper's rustle.
    game.audio.play('neon_on');
    // The map moves on every step, under the title's own pages too (Settings, the code entry, the new-game question).
    anim.loop(this, this.layer, (t) => this.step(t));
  }

  /** Covers the panel, except while diving, when the house shows through as it grows. */
  get opaque(): boolean {
    return !this.diveRun && !this.landed;
  }

  /** Whether the dive is under way, for the game, which shows the house's view and hides its HUD meanwhile. */
  get diving(): boolean {
    return this.diveRun !== null;
  }

  /** Whether this page waits for a menu choice rather than a tap. */
  get hasMenu(): boolean {
    return this.menu !== null;
  }

  finish(): void {
    // The title waits for its menu.
  }

  layout(): void {
    this.endStroke();
    const g = this.game;
    const L = g.layout;
    this.W = L.vw;
    this.H = L.vh;
    this.layer.hitArea = new Rectangle(0, 0, this.W, this.H);
    this.container.hitArea = new Rectangle(0, 0, L.panel.w, L.panel.h);
    this.R = Math.min(this.W / FIT_W, this.H / FIT_H);
    this.K = this.R / R_REF;
    this.cx = this.W / 2;
    this.cy = this.H / 2;
    // Concept D on every screen (the owner, 2026-10-23, from the concepts page's desktop frame): the turning globe, the
    // neon name and the coupon; the flat map shows only in New Game's dive.
    this.buildMap();
    this.buildPanel();
    const globe = this.globe;
    this.backdrop.place(this.W, this.H, globe?.centreX ?? this.cx, globe?.centreY ?? this.cy);
    this.dots.place(globe?.centreX ?? this.cx, globe?.centreY ?? this.cy, globe?.radius ?? this.R, PAC * (globe?.radius ?? this.R));
    this.mapLayer.visible = false;
    if (this.globe) this.globe.view.visible = true;
  }

  private readonly endStroke = (): void => { this.pointer = null; this.stroke.end(); };

  private canDraw(): boolean {
    return !this.done && !this.diveRun && !this.landed && !!this.container.parent && this.container.parent.children.at(-1) === this.container;
  }

  private pointOnMap(x: number, y: number): boolean {
    if (x < 0 || x > this.W || y < 0 || y > this.H) return false;
    // The coupon's coordinates belong to the panel, whereas the map fills the window.
    this.pointerPoint.set(x, y);
    this.layer.toGlobal(this.pointerPoint, this.couponPoint);
    this.container.toLocal(this.couponPoint, undefined, this.couponPoint);
    if (this.couponBounds.contains(this.couponPoint.x, this.couponPoint.y)) return false;
    return !!this.globe?.unproject(x, y, this.dotLocation)
      // Allow only projection round-off at the boundary, not an unreachable polar cap.
      && Math.abs(this.dotLocation.lat) <= PAC_LAT_LIMIT + 1e-8;
  }

  private readonly putDot = (x: number, y: number): void => {
    if (!this.pointOnMap(x, y)) return;
    const { lon, lat } = this.dotLocation;
    // Dots keep a pellet's spacing from every other dot and light, the player's and the map's: a tap made again in one spot, or a
    // stroke over the same ground, adds nothing (and ticks nothing).
    if (this.globe?.crowded(lon, lat, TITLE_DOT_MIN_ARC)) return;
    const [u, v] = robinson(lat, lon);
    this.dots.add(u, v, lon, lat, motion.reduced);
    this.dotTick();
  };

  private dotTick(): void {
    const since = this.clock - this.lastDotTick;
    if (since < DOT_TICK_GAP) return;
    if (since > DOT_RUN_REST) this.dotRun = 0;
    this.lastDotTick = this.clock;
    const top = DOT_STEPS.length - 1, k = this.dotRun++ % (2 * top);
    this.game.audio.play('dot', DOT_STEPS[k <= top ? k : 2 * top - k]!);
  }

  private samplePointer(e: FederatedPointerEvent): void {
    if (!this.canDraw()) { this.endStroke(); return; }
    const p = e.getLocalPosition(this.layer, this.pointerPoint), x = p.x, y = p.y;
    const r = this.globe ? this.globe.radius : this.R;
    // Clip each interpolated dot, not the whole segment: a fast drag ending outside still reaches the map's edge.
    this.stroke.sample(x, y, PAC * r * TITLE_DOT_SPACING, this.putDot);
  }

  private readonly dotDown = (e: FederatedPointerEvent): void => {
    if (!e.isPrimary || e.button !== 0) { this.endStroke(); return; }
    if (!this.canDraw()) return;
    this.endStroke();
    const p = e.getLocalPosition(this.layer, this.pointerPoint);
    if (!this.pointOnMap(p.x, p.y)) return;
    this.pointer = e.pointerId;
    this.samplePointer(e);
  };

  private readonly dotMove = (e: FederatedPointerEvent): void => {
    if (e.pointerId === this.pointer) {
      if (!e.buttons) this.endStroke();
      else this.samplePointer(e);
    }
  };

  private readonly dotUp = (e: FederatedPointerEvent): void => {
    if (e.pointerId !== this.pointer) return;
    this.samplePointer(e);
    this.endStroke();
  };

  /** The globe and its own trio, made the first time an upright screen needs them. */
  private ensureGlobe(): TitleGlobe {
    if (this.globe) return this.globe;
    const members = this.game.content.party.members;
    const pacs: { pac: Actor; lat: number; lon: number }[] = [];
    for (const [id, lat, lon] of [['ronnie', 39, -98], ['olli', 47, 2.5], ['gorbie', 39, 42]] as const) {
      const look = members[id]?.look;
      if (!look || !isLook(look)) continue;
      const a = new Actor(`title_globe_${id}`, 'party', look, 0, 0);
      a.facing = id === 'olli' ? 'left' : 'right';
      this.globeTrio.push(a);
      pacs.push({ pac: a, lat, lon });
    }
    const field = titleGlobeFields.current;
    if (!field) throw new Error('The title globe is not ready.');
    this.globe = new TitleGlobe(DUSK_GLOBE, { field, fields: titleGlobeFields, webgl2: webgl2(), pacs, pacSize: PAC, chomp: CHOMP, dots: this.dots.pool, onEat: (i) => this.dots.eat(i) });
    this.layer.addChildAt(this.globe.view, this.layer.getChildIndex(this.mapLayer) + 1);
    return this.globe;
  }

  /** The name as a neon sign over the globe: the coastlines' tube round the letters' outlines, in the game's poster
   * lettering (Bangers), as concept D drew it. */
  private glint: { layer: Text; mask: Graphics; w: number } | null = null;

  private buildWordmark(x: number, y: number, size: number): void {
    this.wordmark?.destroy({ children: true });
    const k = size / 70;
    const box = new Container();
    this.wordmarkGlow = [];
    const layer = (w: number, color: number, alpha: number, glow: boolean) => {
      const t = new Text({ text: "THAT '80s\nGAME", style: {
        fontFamily: FONT.letter, fontSize: size, align: 'center', lineHeight: Math.round(size * 0.91), letterSpacing: size * 0.04,
        fill: { color: FLOOR, alpha: 0 }, stroke: { color, width: w * k, join: 'round' }, padding: Math.ceil(7 * k),
      } });
      t.anchor.set(0.5, 0);
      t.alpha = alpha;
      box.addChild(t);
      if (glow) this.wordmarkGlow.push(t);
    };
    for (const [w, a] of [[13, 0.1], [8, 0.16], [4.5, 0.3]] as const) layer(w, NAME_TUBE, a, true);
    layer(4.2, NAME_GLOW, 0.6, false);
    layer(1.9, NAME_TUBE, 1, false);
    layer(0.75, NAME_CORE, 0.9, false);
    // The glint: the pale core drawn thicker, seen only through a slanted band that crosses the letters.
    const gl = new Text({ text: "THAT '80s\nGAME", style: {
      fontFamily: FONT.letter, fontSize: size, align: 'center', lineHeight: Math.round(size * 0.91), letterSpacing: size * 0.04,
      fill: { color: FLOOR, alpha: 0 }, stroke: { color: 0xffffff, width: 2.6 * k, join: 'round' }, padding: Math.ceil(7 * k) } });
    gl.anchor.set(0.5, 0);
    const gw = gl.width, gh = gl.height, band = gw * 0.1, slant = gh * 0.35;
    const mask = new Graphics().poly([-band, 0, band, 0, band - slant, gh, -band - slant, gh]).fill(0xffffff);
    mask.y = 0;
    gl.mask = mask;
    gl.visible = false;
    box.addChild(gl, mask);
    this.glint = { layer: gl, mask, w: gw };
    box.position.set(Math.round(x), Math.round(y));
    this.wordmark = box;
    this.layer.addChild(box);
  }

  /** Map units to the window, at the map's own size. */
  private sx(u: number): number { return this.cx + u * this.R; }
  private sy(v: number): number { return this.cy - v * this.R; }

  private buildMap(): void {
    // Everything drawn at the last size goes.
    for (const c of [this.ground, ...this.gratBox.removeChildren(), ...this.coastBox.removeChildren()]) c.destroy({ children: true });
    this.bloom0 = null;
    const { W, H } = this;
    // The coastlines in the window's pixels.
    this.paths = coastOnPacificMap().map((line) => {
      const out = new Float32Array(line.length);
      for (let i = 0; i < line.length; i += 2) { out[i] = this.sx(line[i]!); out[i + 1] = this.sy(line[i + 1]!); }
      return out;
    });
    // The ground: the house's wall colour round the world's oval, its floor inside.
    const oval: number[] = [];
    for (let lat = 90; lat >= -90; lat -= 1) { const [u, v] = robinson(lat, 180); oval.push(this.sx(u), this.sy(v)); }
    for (let lat = -90; lat <= 90; lat += 1) { const [u, v] = robinson(lat, -180); oval.push(this.sx(u), this.sy(v)); }
    this.ground = new Graphics().rect(0, 0, W, H).fill(WALL_FILL).poly(oval, true).fill(FLOOR);
    this.mapLayer.addChildAt(this.ground, 0);
    this.black.clear().rect(0, 0, W, H).fill(0x000000);
    this.black.alpha = 0;
    this.gratBox.addChild(this.buildGraticule(0));
    const base0 = this.buildCoast(0);
    this.coastBox.addChild(base0);
    this.bloom0 = base0.children[0] as Graphics;
  }

  /** The coastlines as one path of continuous lines (one move, then a chain of lines each). */
  private tracePaths(g: Graphics | GraphicsContext, scale = 1, about: [number, number] = [0, 0]): void {
    for (const p of this.paths) {
      g.moveTo((p[0]! - about[0]) * scale + about[0], (p[1]! - about[1]) * scale + about[1]);
      for (let i = 2; i < p.length; i += 2) g.lineTo((p[i]! - about[0]) * scale + about[0], (p[i + 1]! - about[1]) * scale + about[1]);
    }
  }

  /** The coastlines' neon with every width divided by 2^k, for the dive's zoom near 2^k: the bloom, then the neon over it.
   * The map's own size keeps its bloom at its brightest, to breathe by a tint; the dive's hold it at 0.8. */
  private buildCoast(k: number): Container {
    const c = new Container();
    const f = this.K / 2 ** k;
    const stack = coastStack(k === 0 ? BLOOM_TOP : 0.8);
    // Pixi starts a fresh path after each stroke, so every stroke traces the lines again.
    const bloom = new Graphics();
    for (const [w, col] of stack.slice(0, 3)) { this.tracePaths(bloom); bloom.stroke({ width: w * f, color: col, ...COAST_JOIN }); }
    const base = new Graphics();
    for (const [w, col] of stack.slice(3)) { this.tracePaths(base); base.stroke({ width: w * f, color: col, ...COAST_JOIN }); }
    c.addChild(bloom, base);
    c.visible = k === 0;
    return c;
  }

  /** The graticule (every 15 degrees, inside the oval) with its width divided by 2^k. */
  private buildGraticule(k: number): Graphics {
    const g = new Graphics();
    for (let lat = -75; lat <= 75; lat += 15) for (let lon = -180; lon <= 180; lon += 2) { const [u, v] = robinson(lat, lon); if (lon === -180) g.moveTo(this.sx(u), this.sy(v)); else g.lineTo(this.sx(u), this.sy(v)); }
    for (let lon = -180; lon <= 180; lon += 15) for (let lat = -90; lat <= 90; lat += 1) { const [u, v] = robinson(lat, lon); if (lat === -90) g.moveTo(this.sx(u), this.sy(v)); else g.lineTo(this.sx(u), this.sy(v)); }
    g.stroke({ width: (1.6 * this.K) / 2 ** k, color: GRID, alpha: 0.75 });
    g.visible = k === 0;
    return g;
  }

  /** The finer line widths for the dive, one a step while the title shows. (Pixi works out a layer's triangles the first time it
   * is drawn, in the dive: a layer of a hidden map is never visited, so drawing one early warms nothing, Fable review TT-3.) */
  private buildNextLod(): void {
    if (this.coastBox.children.length < COAST_LODS) this.coastBox.addChild(this.buildCoast(this.coastBox.children.length));
    else if (this.gratBox.children.length < GRAT_LODS) this.gratBox.addChild(this.buildGraticule(this.gratBox.children.length));
  }

  /**
   * The menu's coupon in the panel's bottom-right corner, as on the front page; on the
   * globe, the credit and the disclaimer as a ticker along the foot (src/ui/title_ticker.ts).
   */
  private buildPanel(): void {
    const g = this.game;
    const p = g.layout.panel;
    const u = g.layout.unit;
    // A rebuild, as on a resize, keeps the pointer on its row.
    const row = this.menu?.index ?? this.start;
    for (const c of this.container.removeChildren()) c.destroy({ children: true });
    this.menu = null;
    const m = Math.round(u * 0.9);
    // On a phone held upright the menu is a bottom sheet across the foot, as every other page there is (the owner, 2026-11-04).
    const sheeted = thumbReach(g.layout);
    const menu = new MenuList(this.items, { bare: sheeted });
    menu.index = row;
    // On touch the band and the glove rest where keys start (New Game, Continue, or Achievements after the credits), past a greyed row (the owner, 2026-11-12).
    menu.restOn(enabledMenuIndex(this.items, this.start), { glove: true });
    withSounds(menu, (s) => g.audio.play(s));
    // The game's menu is sized by the text unit, which stays at 22 on every desktop window; on a tall window it would shrink beside the name and the globe, so it grows with the window's height (1440 by 900 is the size the owner approved, 2026-10-25).
    const mu = g.layout.orientation !== 'portrait' ? u * Math.max(1, Math.min(2, this.H / 900)) : u;
    const room = sheetRoom(g.layout, { titled: false });
    if (sheeted) menu.build(u, room.w, room);
    else menu.build(mu, mu * 11, { w: Math.min(p.w - m * 2, mu * 20), h: p.h - m * 3 });
    const cw = Math.round(menu.width), ch = Math.round(menu.height);
    let bx = p.w - m - cw, by = p.h - m - ch;
    const dpr = drawDensity();
    const wide = g.layout.orientation !== 'portrait';
    const fine = Math.round(u * SMALL_TEXT);
    // The credit and the disclaimer as a ticker along the foot, which the menu and the name stay clear of. It is drawn on the
    // window's layer, not the panel, so its line runs off both edges of the window rather than stopping at the panel's. A resize
    // keeps it, and the line it has drawn, when its words and size stay the same (title_ticker.ts).
    const credit = g.msg('title', 'credit'), disclaimer = g.msg('title', 'disclaimer');
    const resolution = g.renderResolution ?? 1;
    if (!this.ticker?.shows(credit, disclaimer, fine, resolution)) {
      this.ticker?.destroy();
      this.ticker = new TitleTicker(credit, disclaimer, fine, resolution);
    }
    const ticker = this.ticker;
    ticker.layout(this.W, p.x);
    const reserve = ticker.height;
    // A sheet takes the foot, and the ticker runs just over its rules.
    const sheetGeo = sheeted ? sheetGeometry(g.layout, { w: cw, h: ch }, { titled: false }) : null;
    const tickerY = sheetGeo ? p.y + sheetGeo.plate.y - reserve - Math.round(u * 0.2) : p.y + p.h - reserve;
    if (wide) {
      // Wide screens, as concept D's desktop frame: the globe on the left (its middle at 0.36 of the width, 0.43 of the
      // height across), the name over the coupon on the right, centred on 0.785 of the width. A screen too narrow for
      // that gets a smaller globe and name rather than an overlap.
      // Keep the approved compositions through 16:9. Beyond that, the coupon must fit the clipped panel,
      // even though the globe and name belong to the full window.
      const veryWide = this.W > this.H * 16 / 9;
      const xc = veryWide ? Math.max(p.x + m + cw / 2, Math.min(this.W * 0.785, p.x + p.w - m - cw / 2)) : this.W * 0.785;
      const creditH = reserve + m * 0.4, gap = u * 0.9;
      const size = Math.max(u * 1.4, Math.min(this.H * 0.13, this.W * 0.075, (this.H - m * 2 - creditH - ch - gap) / 2.1));
      this.buildWordmark(xc, 0, Math.round(size));
      const wm = this.wordmark!;
      const low = creditH;
      const top = Math.max(m, Math.min(this.H * 0.13, this.H - m - low - ch - gap - wm.height));
      wm.y = Math.round(top);
      const couponTop = Math.max(top + wm.height + gap, Math.min(this.H * 0.46, this.H - m - low - ch));
      bx = Math.round(xc - cw / 2 - p.x);
      by = Math.round(couponTop - p.y);
      if (veryWide) by = Math.max(m, Math.min(by, p.h - m - ch));
      // The globe is drawn close, so the screen shows part of it: its left and bottom run off the window, its right edge a gap short of
      // the name and coupon (the owner, 2026-10-24: "a percentage of it ... more casual"), sized so GLOBE_SHOWN of it shows.
      const right = xc - Math.max(cw, wm.width) / 2 - gap;
      const at = (r: number): [number, number] => [right - r * 1.06, this.H * (0.5 + 0.1 * Math.min(1, r / (this.H * GLOBE_ZOOM_WIDE)))];
      const r = radiusShowing(this.W, this.H, u * 4, at);
      this.ensureGlobe().place(...at(r), r, dpr, { w: this.W, h: this.H });
    } else {
      // Phones and tall windows (the owner, 2026-11-03: "an asymmetrical large globe on the bottom left", then "the menu at the
      // bottom instead", "with the globe up a little"): the name across the top, the coupon centred at the foot above the ticker,
      // where a thumb reaches it, and the globe big from just under the name, its left side off the screen and its rim showing at
      // the right, running behind the coupon and the ticker. The pacs keep to the middle of whatever part of the globe shows
      // (titleGlobe.ts), so they stay on the screen.
      this.buildWordmark(this.W / 2, this.H * 0.045, Math.min(this.W * 0.17, this.H * 0.085));
      const top = (this.wordmark ? this.wordmark.y + this.wordmark.height : this.H * 0.2) + u * 0.6;
      const bandTop = tickerY;
      bx = Math.round(this.W / 2 - p.x - cw / 2);
      // A clear gap over the room the credit's tab had, which the coupon overlaps across on a narrow screen.
      by = Math.round(Math.max(top, bandTop - u * 1.4 - ch) - p.y);
      if (sheetGeo) { bx = sheetGeo.inner.x; by = sheetGeo.inner.y; }
      // Its size is not held to the room above the coupon, which shrank it on a short phone until it showed whole in the middle.
      const at = (r: number): [number, number] => [this.W * GLOBE_PORTRAIT_RIM - r, top + u * 0.4 + r];
      const r = radiusShowing(this.W, this.H, u * 4, at);
      this.ensureGlobe().place(...at(r), r, dpr, { w: this.W, h: this.H });
    }
    menu.container.position.set(bx, by);
    if (sheetGeo) {
      const sheet = drawSheet(sheetGeo, u);
      this.container.addChild(sheet.root);
      this.couponBounds.set(sheetGeo.plate.x, sheetGeo.plate.y, sheetGeo.plate.w, sheetGeo.plate.h);
    } else if (!wide) {
      // The plate's shadow and the glove sit outside the measured width: keep what shows inside the margin.
      const shown = menu.container.getLocalBounds();
      const over = bx + shown.x + shown.width - (p.w - m);
      if (over > 0) { bx -= Math.ceil(over); menu.container.position.x = bx; }
    }
    if (this.done) menu.container.eventMode = 'none';
    // The game's own menu list, as the pause menu and Stats/Item have it: its cream plate, pink cursor band and glove.
    if (!sheetGeo) this.couponBounds.set(bx, by, cw, ch);
    this.container.addChild(menu.container);
    this.menu = menu;
    ticker.container.position.set(0, Math.round(tickerY));
    ticker.container.eventMode = 'none';
    this.layer.addChild(ticker.container);
    this.credit = ticker.credit;
  }

  /** Play is starting: the menu takes no more choices. */
  leave(): void {
    this.done = true;
    this.endStroke();
    if (this.menu) this.menu.container.eventMode = 'none';
  }

  /** New Game's dive into the map; resolves once the house's view has landed. */
  dive(landing: () => TitleLanding | null): Promise<void> {
    this.container.visible = false;
    if (this.ticker) this.ticker.container.visible = false;
    this.coastGone = Math.log(coastGoneZoom(DIVE_HOME[0], DIVE_HOME[1], this.W, this.H, this.R));
    // The riser follows the zoom note for note (diveTiming.ts); the house's tune comes in at the landing (game.ts).
    this.game.audio.play('dive');
    const done = new Promise<void>((resolve) => { this.diveRun = { t: 0, landing, resolve }; });
    // Its first step at once: the house, just built, starts tiny and clear. A key is read after this step's own motion,
    // so waiting for the next would draw one frame of the house at its full size (the owner saw it flash, 2026-10-22).
    this.stepDive(0);
    return done;
  }

  update(dt: number): void {
    this.age += dt;
    // A moment's grace, so a key still being mashed from before the title cannot pick for the player.
    if (this.menu && this.age >= 0.35 && !this.done) this.menu.update(this.game.input);
  }

  private step(t: number): void {
    const dt = this.lastClock < 0 ? 0 : Math.min(0.05, Math.max(0, t - this.lastClock));
    this.lastClock = t;
    this.clock += dt;
    if (this.landed) return;
    if (this.diveRun) {
      this.stepDive(dt);
      return;
    }
    this.buildNextLod();
    const still = motion.reduced, ct = this.clock;
    this.backdrop.update(dt, still);
    this.ticker?.update(dt, still);
    // The neon catching as the title appears, in step with its two ticks (neon_on): dim, on, dim, on.
    const flicker = still ? 1 : ct < 0.06 ? 0.25 : ct < 0.13 ? 1 : ct < 0.2 ? 0.35 : 1;
    if (this.globe) {
      this.globe.view.alpha = flicker;
      const playingBeat = still ? null : this.game.audio.musicBeat('title');
      const swell = playingBeat === null ? null : titleBeatSwell(playingBeat);
      if (this.wordmark) {
        // The tube is lit from the first frame, with no warm-up flicker (the owner, 2026-10-25).
        this.wordmark.alpha = 1;
        const g = this.glint;
        if (g) {
          // A highlight takes 0.9 s to cross the name, left to right: first as the title appears, then every seven seconds.
          const phase = ct % 7, on = !still && phase < 0.9;
          g.layer.visible = on;
          if (on) g.mask.x = (phase / 0.9 - 0.5) * g.w * 1.5;
        }
        // Only the outer glow swells by twelve per cent. The tube and its pale core never blink or change size.
        const glow = 0.9 + 0.12 * (swell ?? 0);
        this.wordmarkGlow.forEach((t, i) => { t.alpha = [0.1, 0.16, 0.3][i]! * glow; });
      }
      this.globe.update(dt, this.game.time, still, swell);
      // Use the turn just drawn by the globe, including the first frame after a resize.
      this.dots.update(dt, this.globe.facingLon, this.globe.tiltDeg, still);
    }
  }

  private stepDive(dt: number): void {
    const d = this.diveRun!;
    d.t += dt;
    const at = d.landing();
    const p = Math.min(1, d.t / DIVE_S);
    if (!at) { this.land(null); return; }
    const { W, H, K, R } = this;
    // A pure zoom into Tokyo, held where the house will be (no pan; the owner: "Any way to not have to pan?"), starting
    // where the map's top edge is on the window's top edge ("start the zoom from where the top edge of the map is at the
    // top edge of the viewport", 2026-10-26).
    const ty = at.y;
    const L0 = Math.log(Math.max(1, ty / (R * (NORTH - DIVE_HOME[1]))));
    // One cadence for the zoom and the riser (the owner, 2026-10-26: "you actually don't need to speed up at all ... have the
    // blips and lines be simpler"); the Pac-World's lines begin when the last coastline has left this window's view, worked
    // out as the dive starts.
    const Le = Math.log(at.tile / (KD * R)), gone = Math.min(this.coastGone, Le - 1);
    const L = L0 + (Le - L0) * diveZoomShare(p), z = Math.exp(L), pm = KD * R * z;
    const tx = at.x;
    const fx = this.sx(DIVE_HOME[0]), fy = this.sy(DIVE_HOME[1]);
    this.mapLayer.scale.set(z);
    this.mapLayer.position.set(tx - z * fx, ty - z * fy);
    // The dots fade as it starts.
    const fade = 1 - sm(0.05, 0.35, d.t);
    this.dots.view.alpha = fade;
    // From the globe: it and the name fade as the flat map, already at its middle, fades in and the zoom gathers pace.
    {
      const gone = sm(0, 0.35, d.t);
      this.backdrop.view.alpha = 1 - gone;
      this.backdrop.view.visible = gone < 1;
      this.mapLayer.visible = true;
      this.mapLayer.alpha = gone;
      if (this.globe) { this.globe.view.alpha = 1 - gone; this.globe.view.visible = gone < 1; }
      if (this.wordmark) this.wordmark.alpha = 1 - gone;
    }
    // The coastlines and the graticule at the line width nearest the zoom, crossfaded with the next.
    const lk = Math.log2(z);
    // One width shows at a time, fully opaque, except in a short crossfade where the zoom passes halfway between two
    // (an opaque layer drawn see-through would bead where its strokes meet, so the crossfades are kept brief).
    const blend = (box: Container, built: number, alpha: number) => {
      const kk = Math.min(lk, built - 1);
      box.children.forEach((c, k) => {
        if (k >= built) return;
        const w = Math.max(0, Math.min(1, (0.5 - Math.abs(kk - k)) / 0.24 + 0.5)) * alpha;
        c.visible = w > 0.003;
        c.alpha = w;
      });
    };
    // The coastlines stay until the last of them has left the view (a fade just before covers any sliver).
    blend(this.coastBox, Math.min(COAST_LODS, this.coastBox.children.length), 1 - sm(gone - 0.5, gone, L));
    if (this.bloom0) this.bloom0.tint = grey(0.8 / BLOOM_TOP);
    blend(this.gratBox, this.gratBox.children.length, 1 - sm(0.8, 2.0, L));
    this.ground.visible = z < 30;
    // The ground darkens to the black round the house as the house nears.
    this.black.alpha = sm(Le - 5.4, Le - 2.6, L);
    // The Pac-World's grids, every level a third of the last, anchored on the house's tiles; a level shows while its
    // lines are far enough apart, and no more than four draw at once.
    const xa = -tx / pm, xb = (W - tx) / pm, ya = -ty / pm, yb = (H - ty) / pm, M = Math.max(W, H);
    // They begin the moment the last coastline is out of view, and come up quickly (the owner, 2026-10-26: "the abstract
    // lines should start sooner when the last bit of Tokyo is out of frame").
    const gA = sm(gone, gone + 0.3, L) * (1 - sm(Le - 0.8, Le - 0.1, L));
    const g = this.gridG.clear();
    if (gA > 0.01) for (let n = 0; n < 15; n++) {
      const S = 3 ** n, sp = S * pm, a = sm(16, 60, sp) * (1 - sm(500, 1500, sp)) * gA;
      if (a <= 0.01) continue;
      g.beginPath();
      for (let i = Math.ceil((xa - at.ox) / S); i <= Math.floor((xb - at.ox) / S); i++) { const X = tx + (at.ox + i * S) * pm; g.moveTo(X, 0).lineTo(X, H); }
      for (let j = Math.ceil((ya - at.oy) / S); j <= Math.floor((yb - at.oy) / S); j++) { const Y = ty + (at.oy + j * S) * pm; g.moveTo(0, Y).lineTo(W, Y); }
      g.stroke({ width: 1.6 * K, color: GRID, alpha: 0.75 * 0.7 * a });
    }
    // The Pac-World's walls, along the grids' lines: an edge is a wall by its hash; none crosses the house's map.
    const wA = sm(gone + 0.2, gone + 0.7, L) * (1 - sm(Le - 0.9, Le - 0.2, L)), h = at.house;
    const out = (x0: number, y0: number, x1: number, y1: number) => x1 < h.x0 - 1 || x0 > h.x1 + 1 || y1 < h.y0 - 1 || y0 > h.y1 + 1;
    const wg = this.wallG.clear();
    if (wA > 0.01) for (let n = 0; n < 15; n++) {
      const S = 3 ** n, sp = S * pm, a = sm(36, 110, sp) * (1 - sm(1.5 * M, 4 * M, sp)) * wA;
      if (a <= 0.01) continue;
      const segs: number[] = [];
      const i0 = Math.floor((xa - at.ox) / S) - 1, i1 = Math.ceil((xb - at.ox) / S) + 1, j0 = Math.floor((ya - at.oy) / S) - 1, j1 = Math.ceil((yb - at.oy) / S) + 1;
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
        const x = at.ox + i * S, y = at.oy + j * S;
        if (hash(n, i, j, 0) < 0.16 && out(x, y, x + S, y)) segs.push(tx + x * pm, ty + y * pm, tx + (x + S) * pm, ty + y * pm);
        if (hash(n, i, j, 1) < 0.16 && out(x, y, x, y + S)) segs.push(tx + x * pm, ty + y * pm, tx + x * pm, ty + (y + S) * pm);
      }
      // Pixi starts a fresh path after each stroke, so every stroke traces the walls again.
      for (const [w, c, al] of WALL) {
        for (let q = 0; q < segs.length; q += 4) wg.moveTo(segs[q]!, segs[q + 1]!).lineTo(segs[q + 2]!, segs[q + 3]!);
        wg.stroke({ width: w * K, color: c, alpha: al * a, cap: 'round', join: 'round' });
      }
    }
    // The house's own view, growing in the middle to the size it opens at.
    at.reveal(Math.exp(L - Le), sm(Le - 5, Le - 4, L));
    if (p >= 1) this.land(at);
  }

  private land(at: TitleLanding | null): void {
    at?.reveal(1, 1);
    this.landed = true;
    const d = this.diveRun;
    this.diveRun = null;
    this.layer.visible = false;
    d?.resolve();
  }

  destroy(): void {
    window.removeEventListener('pointercancel', this.endStroke);
    window.removeEventListener('blur', this.endStroke);
    this.dots.destroy();
    anim.unloop(this);
    if (this.diveRun) this.land(null);
    for (const a of this.globeTrio) a.destroy();
    this.globeTrio = [];
    this.globe?.destroy();
    this.globe = null;
    this.backdrop.destroy();
    this.ticker?.destroy();
    this.ticker = null;
    this.layer.destroy({ children: true });
    this.container.destroy({ children: true });
  }
}

