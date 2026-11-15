import type { Graphics } from 'pixi.js';
import { burstPoints } from '../ui/print.ts';
import { INK, PAPER, POP_YELLOW } from './palette.ts';

const clamp = (v: number) => Math.max(0, Math.min(1, v));

/** The recovery number's height above the feet, in radii: clear of the halo, and high enough that in a column of
 * fighters it passes over the face of the one above rather than across it. */
export const REVIVAL_NUMBER_HEADROOM = 4.3;

/** The halo's way down: it fades in just over the head and settles, swaying like a feather, hovers a moment, then
 * drops onto it with one small bounce. It stays that low because in a column of fighters anything higher hangs over
 * the face of the one above. Height in radii above the resting place, the sway to the side (radii) and its tilt
 * (radians), how far it has faded in, and how hard it has just landed (1 on touching down, fading), for the squash.
 */
function haloDrop(
  t: number,
  at: Pick<typeof FIGHT_AT, 'float' | 'hover' | 'drop' | 'land' | 'settle'>,
  high: number,
  hang: number,
): { lift: number; sway: number; tilt: number; shown: number; impact: number } {
  const { float, hover, drop, land, settle } = at;
  const shown = clamp((t - float) / 0.3);
  if (t < float) return { lift: high, sway: 0, tilt: 0, shown, impact: 0 };
  if (t < hover) {
    const k = (t - float) / (hover - float);
    const swing = Math.sin(k * Math.PI * 2.5) * (1 - k);
    return { lift: high + (hang - high) * (1 - (1 - k) ** 2), sway: swing * 0.45, tilt: swing * 0.35, shown, impact: 0 };
  }
  if (t < drop) return { lift: hang + Math.sin(((t - hover) / (drop - hover)) * Math.PI) * 0.06, sway: 0, tilt: 0, shown, impact: 0 };
  if (t < land) return { lift: hang * (1 - ((t - drop) / (land - drop)) ** 2), sway: 0, tilt: 0, shown, impact: 0 };
  const since = t - land;
  if (t < settle) {
    const k = since / (settle - land);
    return { lift: 0.25 * 4 * k * (1 - k), sway: 0, tilt: 0, shown, impact: clamp(1 - since / 0.12) };
  }
  return { lift: 0, sway: 0, tilt: 0, shown, impact: clamp(1 - (t - settle) / 0.12) * 0.5 + clamp(1 - since / 0.12) };
}

/** An ellipse turned by `tilt` radians, as a closed outline. */
function tilted(cx: number, cy: number, rx: number, ry: number, tilt: number): number[] {
  const c = Math.cos(tilt), n = Math.sin(tilt), pts: number[] = [];
  for (let i = 0; i < 32; i++) {
    const a = (i / 32) * Math.PI * 2;
    const [x, y] = [Math.cos(a) * rx, Math.sin(a) * ry];
    pts.push(cx + x * c - y * n, cy + x * n + y * c);
  }
  return pts;
}

/**
 * Seconds Revival runs in a fight; the turn waits for it. The owner chose
 * concept I of tmp/fx_ideas/index.html (2026-10-16): "grand with cut-in, but I'd like for there to just be two big
 * wings instead of the six, and they sort of look like they are slightly flapping up and out as they fade away".
 * The concept took its scale from the owner's "Sephiroth/Macross Zero-like grandeur" and "Persona flashiness"; the look
 * is the game's own: ink, paper, pop yellow, comic sunburst.
 */
export const FIGHT_REVIVAL_DURATION = 3.6;
/** Seconds of the fight picture's fade at the end. */
const FIGHT_FADE = 0.5;

/** When each part of the fight's picture happens, in seconds from the start. */
const FIGHT_AT = {
  /** A column of light comes down from the top of the screen and lands, with one soft flash... */
  beam: 0.12,
  landed: 0.42,
  /** ...the halo floats in over the head, hangs, and drops onto it with a bounce... */
  float: 0.35,
  hover: 0.95,
  drop: 1.05,
  land: 1.25,
  settle: 1.45,
  /** ...the wings snap open as it lands and hold, then beat twice, slightly, rising and spreading as they fade. */
  wings: 1.2,
  lift: 2.35,
  wingsFade: 2.6,
  wingsGone: 3.5,
};

const easeOut = (k: number) => 1 - (1 - clamp(k)) ** 3;
const easeInOut = (k: number) => clamp(k) ** 2 * (3 - 2 * clamp(k));
/** Past 1 and back, for a snap open. */
const easeBack = (k: number) => 1 + 2.4 * (clamp(k) - 1) ** 3 + 1.4 * (clamp(k) - 1) ** 2;

/** The wings' feathers: paper and cream, outlined in a light gold rather than ink (the owner, 2026-10-16: "use lighter
 * colors for the outlines of each feather instead of the black"). */
const FEATHER = { line: 0xdcbc62, long: 0xfffbf0, mid: PAPER, short: 0xfff4d6 };

/** One slender feather from (x, y) along `ang`, `len` long and `wid` wide, swelling near its root and tapering to a
 * point, filled `fill` and outlined in light gold `line` wide. */
function feather(g: Graphics, x: number, y: number, ang: number, len: number, wid: number, line: number, fill: number): void {
  const c = Math.cos(ang), n = Math.sin(ang);
  const P = (u: number, v: number): [number, number] => [x + u * c - v * n, y + u * n + v * c];
  g.moveTo(...P(0, 0))
    .quadraticCurveTo(...P(len * 0.3, wid * 1.1), ...P(len * 0.6, wid * 0.7))
    .quadraticCurveTo(...P(len * 0.9, wid * 0.3), ...P(len, 0))
    .quadraticCurveTo(...P(len * 0.85, -wid * 0.35), ...P(len * 0.55, -wid * 0.55))
    .quadraticCurveTo(...P(len * 0.25, -wid * 0.7), ...P(0, 0))
    .fill(fill)
    .stroke({ color: FEATHER.line, width: line, join: 'round' });
}

const lerp = (a: [number, number], b: [number, number], u: number): [number, number] => [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];

/**
 * One big wing on `side` (1 right, -1 left), kept simple in the manner of Sephiroth's (the owner, 2026-10-16: "could it
 * be a little simpler, not as many lines ... close to sephiroth's wing design"): an arm from its root at (rx, ry) radii
 * through elbow and wrist to the tip, raised `arm` radians (negative up), with slender pointed feathers hung along it:
 * five long ones at the hand fanning down and out to the tip, five along the forearm, and one row of short ones over
 * their roots. `open` unfolds it from hanging down (past 1 snaps a little further); `k` sizes it.
 */
function bigWing(g: Graphics, s: number, side: number, rx: number, ry: number, arm: number, open: number, k: number, line: number): void {
  if (open <= 0.01) return;
  const fold = 1.45;
  const a = fold + (arm - fold) * open;
  const grow = (0.35 + 0.65 * Math.min(1, open)) * k;
  const c = Math.cos(a), n = Math.sin(a);
  // From the wing's own frame (x out along the arm, y down) to the world, mirrored on the left.
  const P = (u: number, v: number): [number, number] => [(rx + (u * c - v * n) * grow) * side * s, (ry + (u * n + v * c) * grow) * s];
  const dir = (local: number) => (side > 0 ? a + local : Math.PI - (a + local));
  const S: [number, number] = [0, 0], E: [number, number] = [1.5, -0.5], W: [number, number] = [3.0, -0.2], T: [number, number] = [4.9, 0.7];
  const put = (at: [number, number], local: number, len: number, wid: number, fill: number) =>
    feather(g, ...P(...at), dir(local), len * grow * s, wid * grow * s, line, fill);
  const long = [4, 3, 2, 1, 0].map((j) => ({ at: lerp(W, T, j / 4), local: 1.2 - 0.75 * (j / 4), len: 3.0 + 1.8 * (j / 4), wid: 0.42, fill: FEATHER.long }));
  const mid = [4, 3, 2, 1, 0].map((j) => ({ at: lerp(S, W, 0.2 + 0.8 * (j / 4)), local: 1.6 - 0.35 * (j / 4), len: 2.4, wid: 0.48, fill: FEATHER.mid }));
  // The wing's base, solid behind the feathers: each feather narrows to a point at its root, so without it a dark
  // field shows through between the roots as holes (the owner, 2026-10-16, in the maze). It runs along the arm and a
  // third of the way down each long feather, where they are widest and hide its edge; the tips fan apart as before.
  const base = [S, E, W, T, ...[...long, ...mid].map((f): [number, number] => [f.at[0] + Math.cos(f.local) * f.len * 0.3, f.at[1] + Math.sin(f.local) * f.len * 0.3])];
  g.poly(base.flatMap((q) => P(...q))).fill(FEATHER.mid);
  for (const f of [...long, ...mid]) put(f.at, f.local, f.len, f.wid, f.fill);
  const along = (u: number): [number, number] => (u < 1 / 3 ? lerp(S, E, u * 3) : u < 2 / 3 ? lerp(E, W, u * 3 - 1) : lerp(W, T, u * 3 - 2));
  const angleAt = (u: number) => (u < 1 / 3 ? 1.7 : u < 2 / 3 ? 1.55 - 0.25 * (u * 3 - 1) : 1.25 - 0.75 * (u * 3 - 2));
  for (let j = 5; j >= 0; j--) { const u = 0.04 + 0.86 * (j / 5); put(along(u), angleAt(u), 1.2, 0.42, FEATHER.short); }
  // The leading edge, in the same light gold.
  const edge = [S, E, W, T].map((q) => P(...q));
  g.moveTo(...edge[0]!);
  for (const q of edge.slice(1)) g.lineTo(...q);
  g.stroke({ color: FEATHER.line, width: Math.max(1, 0.16 * grow * s), join: 'round', cap: 'round' });
}

/**
 * How far the wings reach from the middle of the figure at their widest, to either side, in radii at full size (as they
 * spread on the way up; tests/revival.test.ts keeps it true). A fight zoomed in close, on a phone, has less room.
 */
export const FIGHT_WING_REACH = 12.5;
/** How far out from the middle the wings' roots sit, in radii, a little away from the body (the owner, 2026-10-16:
 * "start just a little away from the body before flapping up"); they stay there at any size. */
const WING_ROOT: [number, number] = [1.35, -1.45];

/** The wings' size for a fight with `room` radii beside the fighter on the nearer side: all of it at most, and never
 * under about half size. Their roots stay at the shoulders, so only the rest shrinks. */
export function fightWingSize(room: number): number {
  return Math.max(0.55, Math.min(1, (room - WING_ROOT[0]) / (FIGHT_WING_REACH - WING_ROOT[0])));
}

/** Where the right wing's root is `t` seconds in, in radii from the feet: behind the shoulder, and on the way out
 * rising and moving outward (by less for smaller wings); the left mirrors it. */
export function fightWingRoot(t: number, still: boolean, wingSize = 1): [number, number] {
  const rise = still ? 0 : easeInOut((t - FIGHT_AT.lift) / (FIGHT_AT.wingsGone - FIGHT_AT.lift));
  return [WING_ROOT[0] + 0.8 * rise * wingSize, WING_ROOT[1] - 1.4 * rise * wingSize];
}

/** The fight picture's layers, each drawn from the feet (0, 0): `back` and `wings` behind the figure, `front` over it. */
export interface FightRevivalLayers {
  /** The sunburst, the column of light with streaks rising in it, rings thrown along the ground, the light on it. */
  back: Graphics;
  /** The pair of wings. They fade on their own, as one piece: the caller applies the opacity drawFightRevival returns. */
  wings: Graphics;
  /** The halo, its ding, feathers shed and sparkles. */
  front: Graphics;
}

/**
 * Revival in a fight, `t` seconds in, `s` per radius; `still` (reduced motion) shows the settled picture with nothing
 * moving, only fading in and out. `wingSize` scales the wings, from 1 (full size, FIGHT_WING_REACH) down where the
 * fight has less room. Returns the wings' opacity, which the caller gives them as a whole (overlapping feathers faded
 * one by one would show through each other).
 */
export function drawFightRevival({ back: g, wings, front }: FightRevivalLayers, t: number, s: number, still: boolean, wingSize = 1): number {
  const A = FIGHT_AT;
  g.clear();
  wings.clear();
  front.clear();
  const alpha = clamp(t / 0.15) * clamp((FIGHT_REVIVAL_DURATION - t) / FIGHT_FADE);
  g.alpha = alpha;
  front.alpha = alpha;
  const ink = Math.max(0.8, s * 0.06);
  const top = -s * 40;
  const down = still ? 1 : easeOut((t - A.beam) / (A.landed - A.beam));
  const bottom = top * (1 - down);
  const pulse = still ? 1 : 1 + 0.18 * Math.sin(Math.max(0, t - A.landed) * 7) * clamp(1 - (t - A.landed) / 1.6);

  // The sunburst behind, turning slowly, clear of the figure.
  const sun = still ? 1 : easeOut((t - A.landed + 0.1) / 0.5);
  if (sun > 0) {
    const n = 22, r0 = s * 1.7, r1 = s * (6 + 9 * sun), turn = still ? 0 : t * 0.25, cy = -s;
    for (let i = 0; i < n; i++) {
      const a0 = turn + (i / n) * Math.PI * 2, a1 = a0 + (Math.PI / n) * 0.9;
      g.poly([Math.cos(a0) * r0, cy + Math.sin(a0) * r0, Math.cos(a0) * r1, cy + Math.sin(a0) * r1, Math.cos(a1) * r1, cy + Math.sin(a1) * r1, Math.cos(a1) * r0, cy + Math.sin(a1) * r0])
        .fill({ color: i % 2 ? POP_YELLOW : 0xffffff, alpha: (i % 2 ? 0.32 : 0.16) * sun });
    }
  }
  // The column of light: a wide glow, a brighter band, a white core.
  for (const [w, color, a] of [[4.2, POP_YELLOW, 0.16], [2.6, POP_YELLOW, 0.3], [1.5, 0xfff6d0, 0.5], [0.7, 0xffffff, 0.75]] as const) {
    const ww = w * pulse;
    g.poly([-s * ww, top, s * ww, top, s * ww * 0.85, bottom, -s * ww * 0.85, bottom]).fill({ color, alpha: a });
  }
  if (!still) {
    // Streaks rising in the light.
    if (down >= 1) {
      for (let i = 0; i < 18; i++) {
        const k = (t * (0.9 + (i % 5) * 0.17) + i * 0.137) % 1;
        const x = (((i * 7919) % 100) / 100 - 0.5) * s * 4.2;
        const y = -s * 1 - k * s * 22, len = s * (1.2 + (i % 3));
        g.moveTo(x, y).lineTo(x, y - len).stroke({ color: 0xffffff, width: Math.max(1, s * 0.12), alpha: 0.8 * Math.sin(k * Math.PI), cap: 'round' });
      }
    }
    // Rings thrown out along the ground: as the light lands, and as the halo does.
    for (const at of [A.landed, A.land]) {
      const k = (t - at) / 0.7;
      if (k <= 0 || k >= 1) continue;
      const r = s * (1.5 + 8 * easeOut(k));
      g.ellipse(0, 0, r, r * 0.26).stroke({ color: POP_YELLOW, width: s * 0.35 * (1 - k), alpha: 1 - k });
      g.ellipse(0, 0, r * 0.82, r * 0.82 * 0.26).stroke({ color: 0xffffff, width: s * 0.18 * (1 - k), alpha: 1 - k });
    }
  }
  g.ellipse(0, 0, s * 2.6 * pulse, s * 0.6 * pulse).fill({ color: POP_YELLOW, alpha: 0.35 }).stroke({ color: POP_YELLOW, width: s * 0.14 });

  // The wings: one big pair a little out from the body, snapping open as the halo lands. Then two slight beats, each
  // stroke down first and the second smaller, carry them up and out, spreading a little, as they fade away.
  const open = still ? 1 : easeBack((t - A.wings) / 0.42);
  const away = still ? 0 : clamp((t - A.lift) / (A.wingsGone - A.lift));
  const rise = easeInOut(away);
  const flap = Math.sin(away * Math.PI * 4) * 0.2 * (1 - 0.4 * away);
  const [rx, ry] = fightWingRoot(t, still, wingSize);
  for (const side of [-1, 1]) bigWing(wings, s, side, rx, ry, -0.8 - 0.2 * rise + flap, open, 1.15 * (1 + 0.08 * rise) * wingSize, ink * 0.9);
  const wingsShown = alpha * (still ? 1 : 1 - easeInOut((t - A.wingsFade) / (A.wingsGone - A.wingsFade)));

  // The halo, its ding, and a streak of light across it as it lands.
  const d = still ? { lift: 0, sway: 0, tilt: 0, shown: 1, impact: 0 } : haloDrop(t, A, 0.7, 0.42);
  const hx = s * d.sway, hy = -s * (2.3 + d.lift);
  // It appears by growing from small, at full strength, since its ink and yellow faded together would turn olive.
  const grown = 0.35 + 0.65 * (1 - (1 - d.shown) ** 2), sq = d.impact * 0.35;
  if (d.shown > 0) {
    const [hw, hh] = [s * 0.95 * (1 + sq) * grown, s * 0.3 * (1 - sq) * grown];
    front.poly(tilted(hx, hy, hw, hh, d.tilt)).stroke({ color: INK, width: s * 0.3 * grown, join: 'round' });
    front.poly(tilted(hx, hy, hw, hh, d.tilt)).stroke({ color: POP_YELLOW, width: s * 0.18 * grown, join: 'round' });
  }
  if (!still) {
    const ding = clamp((t - A.land) / 0.45);
    if (ding > 0 && ding < 1) {
      for (let i = 0; i < 12; i++) {
        const a = -Math.PI - 0.3 + (i * (Math.PI + 0.6)) / 11;
        const from = 1.3 + 1.2 * ding, to = from + 0.3 + 0.8 * (1 - ding);
        const [cx, cy] = [Math.cos(a) * s, Math.sin(a) * s * 0.6];
        for (const [color, w] of [[INK, 0.2], [POP_YELLOW, 0.11]] as const) {
          front.moveTo(hx + cx * from, hy + cy * from).lineTo(hx + cx * to, hy + cy * to).stroke({ color, width: s * w * (1 - ding * 0.5), cap: 'round', alpha: 1 - ding });
        }
      }
      const streak = s * 14 * easeOut(ding * 2), h = s * 0.14 * (1 - ding);
      front.poly([hx - streak, hy, hx, hy - h, hx + streak, hy, hx, hy + h]).fill({ color: 0xffffff, alpha: 1 - ding });
      front.poly(burstPoints(hx, hy, s * 1.3 * (1 - ding * 0.6), 4, 0.18, Math.PI / 4)).fill({ color: 0xffffff, alpha: 1 - ding });
    }
    // Feathers shed from the wings, drifting down and turning.
    for (let i = 0; i < 12; i++) {
      const born = A.wings + 0.3 + (i % 6) * 0.16;
      const k = (t - born) / 1.9;
      if (k <= 0 || k >= 1) continue;
      const side = i % 2 ? 1 : -1;
      const x = side * s * (2 + ((i * 37) % 50) / 10) + Math.sin(k * 7 + i) * s * 0.8;
      const y = -s * (6.5 - (i % 4)) + k * s * 6.5;
      const ang = Math.sin(k * 5 + i) * 0.9 + (side > 0 ? 0.4 : Math.PI - 0.4);
      feather(front, x, y, ang, s * 0.9, s * 0.26, ink * 0.8, FEATHER.long);
    }
  }
  // Sparkles rising either side, held in place with reduced motion.
  if (still || t >= A.landed) {
    for (let i = 0; i < 14; i++) {
      const k = still ? (i + 1) / 15 : (t / 1.8 + i / 14) % 1;
      const x = (i % 2 ? 1 : -1) * s * (1.6 + (i % 4) * 0.7);
      const size = s * 0.32 * Math.sin(k * Math.PI);
      if (size < 0.5) continue;
      front.poly(burstPoints(x, -s * (0.4 + k * 6), size, 4, 0.25, 0)).fill(POP_YELLOW).stroke({ color: INK, width: ink * 0.8 });
    }
  }
  return wingsShown;
}

/** The one soft flash over the whole field as the light lands, as an opacity (no strobing); none with reduced motion. */
export function revivalFlash(t: number, still: boolean): number {
  if (still) return 0;
  const f = t - FIGHT_AT.landed + 0.06;
  return f < 0 ? 0 : f < 0.05 ? (f / 0.05) * 0.5 : 0.5 * clamp(1 - (f - 0.05) / 0.3);
}

/** When the "1UP!" panel slams across the fight, in seconds: in, held, out. */
export const REVIVAL_BANNER = { from: 0.32, in: 0.12, hold: 0.75, out: 0.16 };
/** The panel's tilt, radians (up to the right). */
export const REVIVAL_BANNER_TILT = -0.13;

/**
 * The panel's band for a screen `width` wide whose middle it holds at `cx`, the band `h` tall: its length `long`, just
 * enough to cover the screen while it holds, and how far it slides in from the left and out to the right, `reach`, so
 * it starts and ends wholly off the screen.
 */
export function revivalBannerSpan(cx: number, width: number, h: number): { long: number; reach: number } {
  const half = Math.max(cx, width - cx) + h;
  return { long: (2 * half) / Math.cos(REVIVAL_BANNER_TILT), reach: 2 * half };
}

/**
 * In a fight, the rest of the field goes darker round Revival's column of light while the turn waits; the column and
 * its light on the ground stay clear. Drawn from the feet on its own layer under the picture; it fades with it.
 */
export function drawRevivalDim(g: Graphics, t: number, s: number): void {
  g.clear();
  const k = clamp(t / 0.3) * clamp((FIGHT_REVIVAL_DURATION - t) / FIGHT_FADE);
  if (k <= 0) return;
  const far = 1e4;
  g.rect(-far, -far, far * 2, far * 2).fill({ color: INK, alpha: 0.5 * k });
  g.poly([-s * 3.6, -s * 40, s * 3.6, -s * 40, s * 3.1, 0, s * 2.6, s * 0.4, -s * 2.6, s * 0.4, -s * 3.1, 0]).cut();
}
