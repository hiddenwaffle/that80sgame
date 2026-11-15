import { Container, Graphics } from 'pixi.js';
import { EASE } from './motion.ts';
import { INK, PAPER, POP_YELLOW, RED_INK } from './palette.ts';

/**
 * The Warsaw finale's strike, given the grand pass Revival had (the owner, 2026-10-16: "give it the same kind of grand
 * pass Revival just got"), from a read-only design panel's merged plan (workflow wf_2ef455a3-c13): lock on, drop, then
 * light. On the rifle's five bursts the field darkens, an INCOMING! panel slams across, and the target locks one
 * bracket a burst; a red guide beam lands and a paper warhead falls down it, touching the ground at impact, when the
 * owner's white and silence cut in, unchanged. Through the thinning white comes a paper fireball dome, an inked shock
 * ring with a wall of dust riding out with the rumble, and the cloud born hot and cooling. Nothing adds time, and no
 * sound changes. Drawing and timing only, here; src/battle/warsawFx.ts runs it.
 */
export const STRIKE = {
  /** The rifle fires a burst on the first step and every half second; five in all before impact. */
  beat: 0.5,
  impact: 2.2,
  /** The guide beam drops onto the target and holds it... */
  beam: 1.5,
  beamDown: 1.62,
  /** ...and the warhead streaks down it in the last tenth of a second, the white cutting in as it lands (the owner,
   * 2026-10-16: "the missile should hit much faster. More of a 'what was that------' boom"). */
  drop: 2.1,
  /** The INCOMING! panel: in, held, out, from the first burst; gone before the second lock. */
  banner: { from: 0, in: 0.12, hold: 0.7, out: 0.16 },
} as const;

/** After impact, in seconds of the aftermath (the white hold is its first half second). */
export const AFTER = {
  /** The dome holds, swells as the mushroom rises out of it, its ink going first, and is gone. */
  domeHold: 0.7,
  domeFade: 1.0,
  domeInkGone: 1.2,
  domeGone: 1.8,
  /** The shock ring rides out as the picture returns and the rumble rolls in; a thinner one follows. */
  shock: 0.5,
  shockRun: 1.1,
  second: 0.8,
  /** The screen shakes as the rumble rolls in, not hidden under the white. */
  shake: 0.5,
  /** The lines of the impact fly out to the edges as the picture appears. */
  linesGone: 1.2,
  /** The cloud is born hot and cools into its greys. */
  heatFrom: 0.7,
  heatCool: 1.5,
  /** Once the cooling cloud reads white (heatAt about 0.3), the mushroom shows for about whiteHold; meanwhile its puffs
   * start to rise, open outward and grow, and each thins away over whiteThin, leaving pale wisps that drift on and
   * fade over about whiteLinger. The owner, 2026-10-16: "try the white cloud appearing for 1/5 of a second before
   * enough of its disappears, grows bigger, rises, etc so that it is not a mushroom cloud anymore, but the circles are
   * moving in a natural direction and lightening". */
  whiteFrom: 1.65,
  whiteHold: 0.2,
  whiteThin: 0.25,
  whiteLinger: 2.5,
  /** Once white, each puff coasts on at the speed it had, slowing only gently with this time constant, and swings
   * round to its heading over whiteTurn; it never speeds up (the owner, 2026-10-16: "it shouldn't speed up"). */
  whiteSlow: 8,
  whiteTurn: 0.3,
} as const;

const clamp = (v: number) => Math.max(0, Math.min(1, v));

/** Which of the rifle's bursts the strike is on (0 to 4) and how long since it, from the bursts fired so far. */
export function beatAt(fired: number, t: number): { beat: number; since: number } {
  const beat = Math.max(0, Math.min(4, fired));
  return { beat, since: Math.max(0, t - beat * STRIKE.beat) };
}

/** The target on the ground round the party: their middle, the half-widths reaching past each member by 1.6 of the
 * largest's size, how much larger it starts (up to 18%), the brackets' size (smaller where room is short), and the room
 * to the band's nearer side, all kept within that room as far as they can be. */
export interface Aim {
  x: number;
  y: number;
  rx: number;
  ry: number;
  start: number;
  size: number;
  fit: number;
  room: number;
}

/** How far a bracket reaches out to the side from the ring at its 45 degrees, in sizes at full bracket size (its arm and
 * the half of its ink line), and the same for its outer tip alone. */
const BRACKET_REACH = 1.47, BRACKET_TIP = 1.273;

export function aimEllipse(members: ReadonlyArray<{ x: number; y: number; size: number }>, left: number, right: number): Aim {
  const n = Math.max(1, members.length);
  const x = members.reduce((v, m) => v + m.x, 0) / n;
  const y = members.reduce((v, m) => v + m.y, 0) / n;
  const size = Math.max(1, ...members.map((m) => m.size));
  const rx = Math.max(0, ...members.map((m) => Math.abs(m.x - x))) + 1.6 * size;
  const ry = Math.max(0, ...members.map((m) => Math.abs(m.y - y))) + 1.6 * size;
  const room = Math.min(x - left, right - x);
  // The brackets as large as the room beside the ring allows at its own size (a phone's column stands near the
  // screen's edge), never under 60%; then the ring starts as much larger as leaves room for them.
  const side = Math.SQRT1_2 * rx;
  const fit = Math.max(0.6, Math.min(1, (room - side) / (BRACKET_REACH * size)));
  const start = Math.max(1, Math.min(1.18, room / rx, (room - BRACKET_REACH * size * fit) / side));
  return { x, y, rx, ry, start, size, fit, room };
}

/** How large the target is: it steps tighter on each burst, from its start to its own size on the last. */
export function aimScale(aim: Aim, beat: number, since: number, still: boolean): number {
  if (still) return 1;
  const at = (b: number) => aim.start - ((aim.start - 1) * Math.max(0, b)) / 4;
  return at(beat - 1) + (at(beat) - at(beat - 1)) * EASE.out(clamp(since / 0.12));
}

/** How many of the four brackets have locked: one on each burst after the first. */
export const locksAt = (beat: number) => Math.max(0, Math.min(4, beat));

/** The darkened field round the target, drawn once (only its opacity changes): ink over everything, with the target
 * and the party standing in it cut out, `tall` above the ground for their bodies. */
export function drawVeil(g: Graphics, aim: Aim, tall: number): void {
  g.clear();
  const far = 1e4;
  g.rect(aim.x - far, aim.y - far, far * 2, far * 2).fill(INK);
  const pts: number[] = [];
  for (let i = 0; i < 40; i++) {
    const a = (i / 40) * Math.PI * 2;
    const [c, n] = [Math.cos(a), Math.sin(a)];
    pts.push(aim.x + c * aim.rx * 1.2, aim.y + n * aim.ry * 1.2 - (n < 0 ? -n * tall : 0));
  }
  g.poly(pts).cut();
}

/** The veil's opacity `t` seconds in: deepening to 0.45 by the last burst; with reduced motion a steady 0.35. */
export const veilAlpha = (t: number, still: boolean) => (still ? 0.35 * clamp(t / 0.3) : 0.45 * EASE.smooth(clamp(t / 2)));

/**
 * The target, `scale` times its size, with the red pulse `pulse` (0 to 1) in it: an ellipse inked under yellow, a faint
 * outer ring, and four chevrons on it pointing in, yellow, each turning red as it locks, the newest snapping in from
 * larger. Once all four have locked the ring turns red too. Drawn in the world, flattened by its tilt like the ground.
 */
export function drawReticle(g: Graphics, aim: Aim, scale: number, beat: number, since: number, pulse: number, still: boolean): void {
  const s = aim.size, [rx, ry] = [aim.rx * scale, aim.ry * scale];
  const locks = locksAt(beat), closed = locks >= 4;
  g.ellipse(aim.x, aim.y, rx, ry).fill({ color: RED_INK, alpha: 0.1 + pulse * 0.08 });
  g.ellipse(aim.x, aim.y, rx + s * 0.45, ry + s * 0.45).stroke({ width: s * 0.1, color: 0xff442d, alpha: 0.35 });
  g.ellipse(aim.x, aim.y, rx, ry).stroke({ width: s * 0.34, color: INK });
  g.ellipse(aim.x, aim.y, rx, ry).stroke({ width: s * 0.17, color: closed ? RED_INK : POP_YELLOW });
  for (let k = 0; k < 4; k++) {
    const a = Math.PI / 4 + (k * Math.PI) / 2;
    const [dx, dy] = [Math.cos(a), Math.sin(a)];
    const [px, py] = [aim.x + dx * rx, aim.y + dy * ry];
    // The newest lock snaps in from larger, but never past the room to the band's side.
    const most = Math.max(1, (aim.room - Math.SQRT1_2 * rx - 0.2 * s * aim.fit) / (BRACKET_TIP * s * aim.fit));
    const snap = !still && k === locks - 1 && since < 0.15 ? Math.min(most, 1.8 - 0.8 * EASE.out(since / 0.15)) : 1;
    // A chevron just outside the ring, its point towards the middle.
    const b = s * aim.fit;
    const at = (out: number, side: number): [number, number] => [px + (dx * out - dy * side) * b * snap, py + (dy * out + dx * side) * b * snap];
    const arm = [...at(1.15, -0.65), ...at(0.4, 0), ...at(1.15, 0.65)];
    for (const [color, width] of [[INK, 0.4], [k < locks ? RED_INK : POP_YELLOW, 0.22]] as const) {
      g.poly(arm, false).stroke({ width: b * width, color, join: 'miter', cap: 'round' });
    }
  }
}

/** The guide beam, `t` seconds in, from `h0` above the target down onto it, `s` per size; drawn upright from the
 * ground point. With reduced motion it fades in at full length. */
export function drawBeam(g: Graphics, t: number, h0: number, s: number, still: boolean): void {
  if (t < STRIKE.beam) return;
  const down = still ? 1 : EASE.out(clamp((t - STRIKE.beam) / (STRIKE.beamDown - STRIKE.beam)));
  const shown = still ? clamp((t - STRIKE.beam) / 0.25) : 1;
  for (const [w, color, a] of [[1.6, RED_INK, 0.14], [1.0, 0xff442d, 0.26], [0.5, 0xffc4b0, 0.45], [0.2, 0xffffff, 0.7]] as const) {
    g.rect((-s * w) / 2, -h0, s * w, h0 * down).fill({ color, alpha: a * shown });
  }
}

/** How high the warhead's nose is above the target `t` seconds in, from `h0`: a streak down, a little faster as it
 * goes, touching down at impact. With reduced motion it hangs halfway down. */
export function warheadHeight(t: number, h0: number, still: boolean): number {
  if (still) return h0 * 0.5;
  const k = clamp((t - STRIKE.drop) / (STRIKE.impact - STRIKE.drop));
  return h0 * (1 - k ** 1.4);
}

/** How far the warhead is stretched along its fall by its speed (1 at rest). */
export const warheadStretch = (still: boolean) => (still ? 1.25 : 1.6);

/** A fat paper warhead `long` long, nose down at (0, 0), built once and only moved: paper body inked, a yellow band,
 * a red nose, ink fins. */
export function buildWarhead(long: number, s: number): Graphics {
  const g = new Graphics();
  const w = long * 0.21, line = Math.max(1, s * 0.12);
  // Fins first, behind the body.
  for (const side of [-1, 1]) g.poly([side * w * 0.7, -long * 0.72, side * w * 1.9, -long * 1.02, side * w * 0.5, -long * 0.98]).fill(INK);
  g.rect(-w * 0.45, -long * 1.04, w * 0.9, long * 0.2).fill(INK);
  g.ellipse(0, -long * 0.5, w, long * 0.5).fill(PAPER).stroke({ width: line, color: INK });
  g.rect(-w * 0.98, -long * 0.42, w * 1.96, long * 0.1).fill(POP_YELLOW).stroke({ width: line * 0.8, color: INK });
  g.ellipse(0, -long * 0.12, w * 0.55, long * 0.12).fill(RED_INK).stroke({ width: line * 0.8, color: INK });
  return g;
}

/** The blur the warhead leaves, from its tail all the way back up the beam to `h0`, where it came from, brightest
 * nearest it; `nose` its height, `long` its length (stretched by warheadStretch). */
export function drawTrail(g: Graphics, nose: number, h0: number, long: number, s: number, still: boolean): void {
  const tail = nose + long * warheadStretch(still) * 1.05, w = long * 0.21;
  if (tail >= h0) return;
  // A wide pale smear and a white core, each in four steps fading upward.
  for (let i = 0; i < 4; i++) {
    const [from, to] = [tail + ((h0 - tail) * i) / 4, tail + ((h0 - tail) * (i + 1)) / 4];
    const fade = 1 - i / 4;
    g.rect(-w * 1.1, -to, w * 2.2, to - from).fill({ color: 0xfff1d6, alpha: 0.45 * fade });
    g.rect(-w * 0.35, -to, w * 0.7, to - from).fill({ color: 0xffffff, alpha: 0.85 * fade });
  }
  void s;
}

/** A paper fireball dome `r` across and its ink outline, upright from the ground at (0, 0), built once: pop yellow and
 * orange bands paling to a white core. */
export function buildDome(r: number, s: number): { view: Container; ink: Graphics } {
  const view = new Container();
  view.label = 'nuke_dome';
  view.eventMode = 'none';
  const fill = new Graphics();
  const half = (k: number): number[] => {
    const pts: number[] = [];
    for (let i = 0; i <= 24; i++) {
      const a = Math.PI + (i / 24) * Math.PI;
      pts.push(Math.cos(a) * r * k, Math.sin(a) * r * k * 0.9);
    }
    return pts;
  };
  for (const [k, color] of [[1, 0xff7352], [0.84, POP_YELLOW], [0.64, 0xfff1b8], [0.42, 0xffffff]] as const) fill.poly(half(k)).fill(color);
  const ink = new Graphics();
  ink.poly(half(1), false).stroke({ width: Math.max(1.5, s * 0.3), color: INK, join: 'round' });
  view.addChild(fill, ink);
  return { view, ink };
}

/** The dome's pose in the aftermath: its scale, its opacity, and its ink's opacity, which goes first so ink over
 * yellow never fades to olive. With reduced motion it fades in to half and out, unscaled. */
export function domePose(age: number, still: boolean): { scale: number; alpha: number; ink: number } {
  if (still) {
    const alpha = 0.5 * clamp(age / 0.3) * (1 - clamp((age - 1.5) / 0.5));
    return { scale: 1, alpha, ink: 1 - clamp((age - 0.7) / 0.5) };
  }
  return {
    scale: 1 + 0.08 * EASE.out(clamp((age - AFTER.domeHold) / (AFTER.domeGone - AFTER.domeHold))),
    alpha: 1 - EASE.smooth(clamp((age - AFTER.domeFade) / (AFTER.domeGone - AFTER.domeFade))),
    ink: 1 - EASE.smooth(clamp((age - 0.5) / (AFTER.domeInkGone - 0.5))),
  };
}

const noise = (n: number) => { const v = Math.sin(n * 127.1 + 311.7) * 43758.5453; return v - Math.floor(v); };

/** The finale's charred paving alone, shared by the blast and Berlin's persistent post-wipe trace. */
export function drawScorchedPaving(g: Graphics, x: number, y: number, radius: number): void {
  const rim = (scale: number) => Array.from({ length: 40 }, (_, i) => {
    const a = i * Math.PI * 2 / 40, r = radius * scale * (0.88 + noise(i) * 0.2);
    return [x + Math.cos(a) * r, y + Math.sin(a) * r * 0.62];
  }).flat();
  g.poly(rim(1.35)).fill({ color: 0x655d50, alpha: 0.4 });
  g.poly(rim(1.17)).fill({ color: 0x383433, alpha: 0.7 });
  for (let i = 0; i < 45; i++) {
    const a = noise(i + 60) * Math.PI * 2, r = Math.sqrt(noise(i + 110)) * radius;
    g.ellipse(x + Math.cos(a) * r, y + Math.sin(a) * r * 0.62, 2 + noise(i + 5) * 9, 1 + noise(i + 7) * 3)
      .fill({ color: i % 3 ? 0x211f21 : 0x807465, alpha: 0.35 });
  }
}

/**
 * The shock ring in the aftermath, round the target at (x, y) with the blast's `radius`, `s` per size: a paper ring
 * inked under yellow racing out along the ground once the white thins, a wall of dust riding its front, and a thinner
 * ring after it. With reduced motion a still ring with an ink edge.
 */
export function drawShock(g: Graphics, x: number, y: number, radius: number, age: number, s: number, still: boolean): void {
  if (still) {
    g.circle(x, y, radius * 1.4).stroke({ width: s * 0.34, color: INK }).circle(x, y, radius * 1.4).stroke({ width: s * 0.18, color: POP_YELLOW });
    return;
  }
  const k = (age - AFTER.shock) / AFTER.shockRun;
  if (k > 0 && k < 1) {
    const r = radius * (0.3 + 3.4 * EASE.out(k)), fade = 1 - k;
    for (let i = 0; i < 22; i++) {
      const a = ((i + noise(i) * 0.6) / 22) * Math.PI * 2, out = r * (1 + noise(i + 40) * 0.06);
      const lump = s * (0.7 + noise(i + 80) * 0.5) * (1 - 0.5 * k);
      g.ellipse(x + Math.cos(a) * out, y + Math.sin(a) * out, lump, lump * 0.7)
        .fill({ color: 0xd8cfc0, alpha: 0.9 * fade }).stroke({ width: s * 0.08, color: INK, alpha: fade });
    }
    g.circle(x, y, r).stroke({ width: s * 0.6 * fade, color: INK, alpha: fade });
    g.circle(x, y, r).stroke({ width: s * 0.32 * fade, color: POP_YELLOW, alpha: fade });
  }
  const k2 = (age - AFTER.second) / AFTER.shockRun;
  if (k2 > 0 && k2 < 1) g.circle(x, y, radius * (0.3 + 3 * EASE.out(k2))).stroke({ width: s * 0.15 * (1 - k2), color: POP_YELLOW, alpha: 0.7 * (1 - k2) });
}

/** How hot the cloud still is in the aftermath, from 1 at its birth to 0 once cooled into its greys. */
export const heatAt = (age: number) => 1 - EASE.smooth(clamp((age - AFTER.heatFrom) / AFTER.heatCool));

/** How far in the focus lines reach while the target locks: a step closer on each burst. */
export function strikeReach(beat: number, since: number, still: boolean): number {
  if (still) return 0.4;
  const at = (b: number) => (b < 0 ? 0 : 0.15 + 0.1 * b);
  return at(beat - 1) + (at(beat) - at(beat - 1)) * EASE.out(clamp(since / 0.15));
}

/** How far in the impact's lines reach: deep under the white, flying out to the edges as the picture appears; none
 * with reduced motion. */
export function impactReach(age: number, still: boolean): number {
  if (still) return 0;
  return age < 0.5 ? 0.6 : 0.6 * (1 - EASE.in(clamp((age - 0.5) / (AFTER.linesGone - 0.5))));
}
