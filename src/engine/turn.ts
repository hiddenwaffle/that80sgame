/**
 * The upright lock. On a phone the game keeps its upright layout however the phone is held, and
 * stays square to the phone's body, as an app locked to portrait does. A browser tab cannot lock
 * the screen itself, so when the phone is turned, the game turns its whole stage the other way
 * inside the canvas. Tablets and desktop windows are never turned. The maths here is pure; one
 * reader of the screen is called by the game on each relayout.
 */

import type { Insets } from './layout.ts';

/** How far the screen is turned from the phone's own upright, which the game undoes: none, a quarter either way, or a half. */
export type Turn = 0 | 90 | 180 | 270;

/** A screen whose short side is under this many CSS pixels, with a finger as its main pointer, is a phone. */
export const PHONE_SHORT_SIDE = 600;

/** After the phone turns, how long a reading of its angle that does not fit the page's shape counts as stale. */
export const STALE_MS = 1000;

/** A reading of the screen's angle as a turn: -90 is 270; anything not a multiple of 90 is no reading. */
export function quarter(a: unknown): Turn | null {
  if (typeof a !== 'number' || !Number.isFinite(a)) return null;
  const q = ((Math.round(a) % 360) + 360) % 360;
  return q === 0 || q === 90 || q === 180 || q === 270 ? q : null;
}

/**
 * The turn to undo. Never on a tablet or desktop. On a phone, the screen's angle when it fits the
 * page's shape: a quarter turn for a landscape page, none or a half for an upright one. A reading
 * that does not fit is taken as stale while the page is still catching up with a turn (`fresh`, see
 * `readingIsFresh`), or when there is no reading at all, and the last turn that fits the shape is
 * kept, else a quarter turn to the left. Otherwise it is believed: an upright phone showing a
 * landscape window (split screen) is not turned.
 */
export function chooseTurn(o: { phone: boolean; vw: number; vh: number; angle: Turn | null; last: Turn; fresh: boolean }): Turn {
  if (!o.phone) return 0;
  const landscape = o.vw > o.vh;
  const a = o.angle;
  if (landscape && (a === 90 || a === 270)) return a;
  if (!landscape && (a === 0 || a === 180)) return a;
  if (a !== null && !o.fresh) return 0;
  if (landscape) return o.last === 90 || o.last === 270 ? o.last : 90;
  return o.last === 180 ? 180 : 0;
}

/**
 * Whether the page may still be catching up with a turn of the phone: within `STALE_MS` of the turn,
 * and still the size it was when the phone turned. A browser can report the new angle before the page
 * takes its new size, so a reading that does not fit the old size is not trusted then. Once the page
 * has changed size it has caught up, and the reading is believed at once: an upright phone in split
 * screen, whose window stays wider than tall, is then not turned.
 */
export function readingIsFresh(o: { now: number; turnedAt: number; size: [number, number]; sizeAtTurn: [number, number] | null }): boolean {
  if (o.now - o.turnedAt >= STALE_MS) return false;
  const at = o.sizeAtTurn;
  return at !== null && at[0] === o.size[0] && at[1] === o.size[1];
}

/** The layout's size for a canvas: its own, or with the sides swapped for a quarter turn. */
export function uprightSize(t: Turn, cw: number, ch: number): [number, number] {
  return t === 90 || t === 270 ? [ch, cw] : [cw, ch];
}

/** Where a point of the upright layout lands on a canvas `cw` by `ch`. */
export function toCanvas(t: Turn, cw: number, ch: number, x: number, y: number): [number, number] {
  if (t === 90) return [y, ch - x];
  if (t === 270) return [cw - y, x];
  if (t === 180) return [cw - x, ch - y];
  return [x, y];
}

/** The point of the upright layout under a point on the canvas. */
export function fromCanvas(t: Turn, cw: number, ch: number, cx: number, cy: number): [number, number] {
  if (t === 90) return [ch - cy, cx];
  if (t === 270) return [cy, cw - cx];
  if (t === 180) return [cw - cx, ch - cy];
  return [cx, cy];
}

/** How the stage's root is turned and placed so the upright layout lands as `toCanvas` says. */
export function rootPlacement(t: Turn, cw: number, ch: number): { rotation: number; x: number; y: number } {
  if (t === 90) return { rotation: -Math.PI / 2, x: 0, y: ch };
  if (t === 270) return { rotation: Math.PI / 2, x: cw, y: 0 };
  if (t === 180) return { rotation: Math.PI, x: cw, y: ch };
  return { rotation: 0, x: 0, y: 0 };
}

/** The screen's safe-area insets (read in the canvas's frame) on the sides of the upright layout they fall on. */
export function turnInsets(s: Insets, t: Turn): Insets {
  if (t === 90) return { top: s.left, right: s.top, bottom: s.right, left: s.bottom };
  if (t === 270) return { top: s.right, right: s.bottom, bottom: s.left, left: s.top };
  if (t === 180) return { top: s.bottom, right: s.left, bottom: s.top, left: s.right };
  return { ...s };
}

/** Whether this is a phone, and the screen's angle: the newer reading first, then the older one iPhones before Safari 16.4 give. */
export function readScreen(): { phone: boolean; angle: Turn | null } {
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const short = Math.min(screen.width, screen.height);
  const legacy = (window as unknown as { orientation?: unknown }).orientation;
  const angle = quarter(screen.orientation?.angle ?? legacy);
  return { phone: coarse && short > 0 && short < PHONE_SHORT_SIDE, angle };
}

/** The turn in force and the canvas's size, set by each relayout, for code with no game at hand. */
export const screenTurn: { turn: Turn; cw: number; ch: number } = { turn: 0, cw: 0, ch: 0 };

/** How far down the upright layout a point on the canvas is, such as a finger dragging a list. */
export function uprightY(p: { x: number; y: number }): number {
  return fromCanvas(screenTurn.turn, screenTurn.cw, screenTurn.ch, p.x, p.y)[1];
}
