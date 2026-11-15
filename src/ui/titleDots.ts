import { Container, Sprite, Texture } from 'pixi.js';
import { ARCADE_DOT } from '../render/palette.ts';
import { projectGlobe } from './titleProjection.ts';

/** Live dots; a small, separately bounded tail lets replaced dots fade without delaying a new tap. */
export const TITLE_DOT_CAP = 400;
export const TITLE_DOT_TAIL = 16;
export const TITLE_DOT_FADE_S = 0.18;
/** A maze tile (pellet spacing) relative to the title's 22-unit ball. */
export const TITLE_DOT_SPACING = 32 / 22;
/**
 * The nearest two dots or lights may be on the globe, in radians of its arc: a third of the maze's pellet spacing as the stroke lays
 * dots (a ball is 0.093 of the globe's radius, src/ui/titleMap.ts), so a stroke's own dots are never refused and a tap may land close to
 * another dot (the owner, 2026-10-25: about a third of the earlier 7.4 degrees). About 2.6 degrees.
 */
export const TITLE_DOT_MIN_ARC = 0.093 * TITLE_DOT_SPACING / 3;

/** Carries distance across samples and corners. A long pointer jump fills every intervening spacing. */
export class DotStroke {
  private x = 0;
  private y = 0;
  private left = 0;
  private active = false;

  end(): void { this.active = false; }

  sample(x: number, y: number, spacing: number, put: (x: number, y: number) => void): void {
    if (!this.active) {
      this.active = true;
      this.x = x; this.y = y; this.left = spacing;
      put(x, y);
      return;
    }
    const dx = x - this.x, dy = y - this.y, length = Math.hypot(dx, dy);
    if (!length) return;
    let at = this.left;
    while (at <= length) {
      put(this.x + dx * at / length, this.y + dy * at / length);
      at += spacing;
    }
    this.left = at - length;
    this.x = x; this.y = y;
  }
}

export interface TitleDot {
  u: number; v: number; lon: number; lat: number;
  /** Precomputed sphere vector; only the view rotation changes each frame. */
  x: number; y: number; z: number;
  fading: number;
  /** False once a pac has eaten it: the slot waits to be written over, and nothing draws or chases it. */
  alive: boolean;
}

/** Fixed storage, reused after reaching the cap. No arrays or entries are made while stepping. */
export class DotPool {
  readonly dots: TitleDot[] = [];
  count = 0;
  private next = 0;
  private tail = 0;
  retired = -1;

  constructor() {
    for (let i = 0; i < TITLE_DOT_CAP + TITLE_DOT_TAIL; i++) {
      this.dots.push({ u: 0, v: 0, lon: 0, lat: 0, x: 0, y: 0, z: 0, fading: 0, alive: false });
    }
  }

  add(u: number, v: number, lon: number, lat: number, still: boolean): number {
    const index = this.next, dot = this.dots[index]!;
    this.retired = -1;
    // A dot that is full and not eaten fades as its slot is written over; one a pac ate has already gone.
    if (this.count === TITLE_DOT_CAP && !still && dot.alive) {
      const old = this.dots[TITLE_DOT_CAP + this.tail]!;
      this.retired = TITLE_DOT_CAP + this.tail;
      Object.assign(old, dot);
      old.fading = TITLE_DOT_FADE_S;
      this.tail = (this.tail + 1) % TITLE_DOT_TAIL;
    }
    dot.u = u; dot.v = v; dot.lon = lon; dot.lat = lat;
    projectGlobe(lon, lat, 0, 0, dot);
    // projectGlobe uses screen y down; store a conventional north-positive sphere vector.
    dot.y = -dot.y;
    dot.fading = 0;
    dot.alive = true;
    this.count = Math.min(TITLE_DOT_CAP, this.count + 1);
    this.next = (index + 1) % TITLE_DOT_CAP;
    return index;
  }

  /** A pac ate it. */
  eat(index: number): void {
    if (index >= 0 && index < TITLE_DOT_CAP) this.dots[index]!.alive = false;
  }

  /** Dots still to be seen and chased. */
  get live(): number {
    let n = 0;
    for (let i = 0; i < this.count; i++) if (this.dots[i]!.alive) n++;
    return n;
  }
}

/** One shared dot-and-glow texture, one sprite batch. Flat positions change only on add or layout. */
export class TitleDots {
  readonly view = new Container({ eventMode: 'none' });
  readonly pool = new DotPool();
  private readonly texture: Texture;
  private readonly sprites: Sprite[] = [];
  private dirty = true;
  private readonly changed = new Uint8Array(TITLE_DOT_CAP + TITLE_DOT_TAIL);
  private cx = 0;
  private cy = 0;
  private radius = 1;
  private lastFacing = NaN;
  private lastTilt = NaN;

  constructor() {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    const g = canvas.getContext('2d')!;
    g.fillStyle = `#${ARCADE_DOT.toString(16).padStart(6, '0')}`;
    g.globalAlpha = 0.2;
    g.beginPath(); g.arc(32, 32, 32, 0, Math.PI * 2); g.fill();
    g.globalAlpha = 1;
    const side = 64 * 4 / 14;
    g.fillRect(32 - side / 2, 32 - side / 2, side, side);
    this.texture = Texture.from(canvas);
    for (let i = 0; i < this.pool.dots.length; i++) {
      const s = new Sprite(this.texture);
      s.anchor.set(0.5); s.visible = false;
      this.view.addChild(s);
      this.sprites.push(s);
    }
  }

  place(cx: number, cy: number, radius: number, ball: number): void {
    this.cx = cx; this.cy = cy; this.radius = radius;
    for (const s of this.sprites) s.scale.set(14 * ball / 22 / 64);
    this.dirty = true;
  }

  add(u: number, v: number, lon: number, lat: number, still: boolean): void {
    this.changed[this.pool.add(u, v, lon, lat, still)] = 1;
    if (this.pool.retired >= 0) this.changed[this.pool.retired] = 1;
  }

  /** A pac ate dot `index`. */
  eat(index: number): void {
    this.pool.eat(index);
    this.changed[index] = 1;
  }

  update(dt: number, facing: number, tilt: number, still: boolean): void {
    const moved = this.dirty || facing !== this.lastFacing || tilt !== this.lastTilt;
    const l = facing * Math.PI / 180, k = tilt * Math.PI / 180;
    const cl = Math.cos(l), sl = Math.sin(l), ct = Math.cos(k), st = Math.sin(k);
    for (let i = 0; i < this.pool.dots.length; i++) {
      const d = this.pool.dots[i]!, s = this.sprites[i]!;
      const tail = i >= TITLE_DOT_CAP;
      if (tail) {
        if (d.fading <= 0) continue;
        d.fading = still ? 0 : Math.max(0, d.fading - dt);
        if (!d.fading) { s.visible = false; continue; }
      } else if (i >= this.pool.count) break;
      if (!moved && !tail && !this.changed[i]) continue;
      this.changed[i] = 0;
      if (!tail && !d.alive) { s.visible = false; continue; }
      let alpha = tail ? d.fading / TITLE_DOT_FADE_S : 1;
      const x = d.x * cl - d.z * sl, z = d.x * sl + d.z * cl;
      const depth = d.y * st + z * ct;
      s.visible = depth > 0.05;
      if (!s.visible) continue;
      s.position.set(this.cx + x * this.radius, this.cy - (d.y * ct - z * st) * this.radius);
      alpha *= Math.min(1, depth * 3);
      s.alpha = alpha;
    }
    this.dirty = false; this.lastFacing = facing; this.lastTilt = tilt;
  }

  destroy(): void { this.view.destroy({ children: true }); this.texture.destroy(true); }
}
