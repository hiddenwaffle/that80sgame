import type { Graphics } from 'pixi.js';
import { INK } from '../render/palette.ts';
import { drawBallInk } from './ballInk.ts';
import { BALL_EYES, ballEyes, ballPolygon, outsideJaw } from './ball_face.ts';
import { drawBallShading } from './ball_shade.ts';
import { clipToRect, flat, starPoly, type Dir, type Pt } from './geom.ts';

/**
 * Placeholder character art, drawn as flat vector shapes with ink outlines so
 * the halftone screen reads them like a printed cartoon. Every look draws
 * around (0, 0), the middle of the body. The body's radius is `size`.
 */

export interface Pose {
  facing: Dir;
  /** 0 = mouth shut, 1 = wide open. */
  mouth: number;
  /** Actual walking state; an omitted value draws the standing outfit, as in a portrait. */
  moving?: boolean;
  /** Seconds, for idle wobble and similar. */
  t: number;
  /** Knocked out: drawn flat and grey. */
  ko?: boolean;
  /** Flashing after a hit. */
  hurt?: boolean;
  /** A cosmetic blink; portraits that are drawn once leave this unset. */
  blink?: boolean;
  /** Knocked silly for a moment (a patrol guard down after a missed tackle): crossed eyes where its eyes are, in
   * whatever view it is drawn, with its colours and mouth as usual. */
  dazed?: boolean;
  /** How much of its HP is lost, 0 to 1, for a figure that shows it (the tank breaking down, the look's `wreck`). */
  damage?: number;
}

export type LookId =
  | 'olli'
  | 'ronnie'
  | 'gorbie'
  | 'blue_thing'
  | 'shopkeeper'
  | 'student'
  | 'guide_blue'
  | 'guide_red'
  | 'guide_ochre'
  | 'guide_student'
  | 'guide_merchant'
  | 'resident_blue'
  | 'resident_red'
  | 'resident_ochre'
  | 'cyclist_blue'
  | 'cyclist_red'
  | 'martial_pupil'
  | 'opera_performer'
  | 'ninja_black'
  | 'ninja_blue'
  | 'german'
  | 'german_guide'
  | 'german_tourist'
  | 'german_nephew'
  | 'german_shopper'
  | 'german_student'
  | 'german_pensioner'
  | 'german_commuter'
  | 'german_gardener'
  | 'worker'
  | 'grey_hat'
  | 'ghost_green'
  | 'ghost_cream'
  | 'ghost_red'
  | 'ghost_orange'
  | 'ghost_blue'
  | 'ghost_pink'
  | 'ghost_cyan'
  | 'ghost_yellow'
  | 'ghost_lime'
  | 'ghost_purple'
  | 'ghost_white'
  | 'ghost_brown'
  | 'ghost_magenta'
  | 'ghost_teal'
  | 'ghost_grey'
  | 'ghost_giant'
  | 'guard_cap'
  | 'guard_hat'
  | 'soldier'
  | 'tank'
  | 'boss';

export interface LookInfo {
  /** Body radius in world units. */
  size: number;
  /** The flag painted on the ball, also used by its special's paths. */
  flag?: (mirror: boolean) => Band[];
  /**
   * A ball that rolls round to face up or down, as Pac-Man's sprite does: its side view turned a quarter, so its
   * eyes show on one side. Every ball rolls, a hat turning with it (the owner, 2026-10-03: "Rolled, hat and all");
   * the ghosts, the tank, and the boss do not.
   */
  rolls?: boolean;
  draw: (g: Graphics, pose: Pose, size: number) => void;
  /**
   * For a figure taller than a ball with a head drawn on it (the tank's rider), where that head is in its code drawing,
   * in sizes: `up` to its top and `chin` to its bottom from the feet, `across` from the middle facing right. Its
   * balloon points there while the code drawing stands in for its picture (`Actor.speakingPoint`).
   */
  head?: { up: number; chin: number; across: number };
}

const OUTLINE = (size: number) => Math.max(1.2, size * 0.1);

type Band = { color: number; x0: number; y0: number; x1: number; y1: number };

/** Draws a ball whose surface is painted with rectangles (a flag), clipped to the pie shape. */
function paintedBall(g: Graphics, pose: Pose, r: number, bands: (mirror: boolean) => Band[], extra?: (poly: Pt[], mirror: boolean) => void, inked = false) {
  const poly = ballPolygon(pose.facing, pose.ko ? 0 : pose.mouth, r);
  const mirror = pose.facing === 'left';
  for (const b of bands(mirror)) {
    const clipped = clipToRect(poly, b.x0 * r, b.y0 * r, b.x1 * r, b.y1 * r);
    // A front jaw can split a horizontal band into disconnected pieces. Keep each
    // half-plane separate so polygon triangulation cannot bridge across the mouth.
    const pieces = pose.facing === 'down' ? outsideJaw(clipped, pose.facing, pose.ko ? 0 : pose.mouth, r) : [clipped];
    for (const piece of pieces) if (piece.length >= 3) g.poly(flat(piece)).fill(pose.ko ? greyOut(b.color) : b.color);
  }
  extra?.(poly, mirror);
  drawBallShading(g, pose, r);
  if (inked) drawBallInk(g, pose, r, poly);
  else g.poly(flat(poly)).stroke({ width: OUTLINE(r), color: INK, join: 'round' });
  face(g, pose, r);
}

/** Native outfits retain their seeded colours, with the party's contour and dense hatch treatment. */
function inkedBall(g: Graphics, pose: Pose, r: number, bands: (mirror: boolean) => Band[], extra?: (poly: Pt[], mirror: boolean) => void) {
  paintedBall(g, pose, r, bands, extra, true);
}

function greyOut(c: number): number {
  const r = (c >> 16) & 255;
  const gg = (c >> 8) & 255;
  const b = c & 255;
  const v = Math.round((r + gg + b) / 3 * 0.6 + 60);
  return (v << 16) | (v << 8) | v;
}

/** Two cartoon eyes, looking the way the character faces. */
function face(g: Graphics, pose: Pose, r: number) {
  const look: Record<Dir, [number, number]> = { right: [0.3, 0], left: [-0.3, 0], down: [0, 0.18], up: [0, -0.2] };
  const [lx, ly] = look[pose.facing];
  for (const eye of ballEyes(pose.facing, pose.ko)) {
    const cx = eye.x * r, cy = eye.y * r, rx = eye.rx * r, ry = eye.ry * r;
    if (pose.ko || pose.dazed) {
      const sx = rx * .8, sy = ry * .65;
      g.moveTo(cx - sx, cy - sy).lineTo(cx + sx, cy + sy).moveTo(cx + sx, cy - sy).lineTo(cx - sx, cy + sy).stroke({ width: OUTLINE(r) * .8, color: INK });
      continue;
    }
    if (pose.blink && !pose.hurt) {
      g.moveTo(cx - rx * .8, cy).quadraticCurveTo(cx, cy + ry * .25, cx + rx * .8, cy).stroke({ width: OUTLINE(r), color: INK, cap: 'round' });
      continue;
    }
    g.ellipse(cx, cy, rx, ry).fill(0xffffff).stroke({ width: OUTLINE(r) * .6, color: INK });
    // Similar pupil sizes to the party pictures, independent of eye perspective.
    g.circle(cx + lx * rx, cy + ly * ry + ry * .1, r * .08).fill(INK);
  }
}

export const flags = {
  /** United States: 13 stripes and a blue canton. */
  us: (mirror: boolean): Band[] => {
    const out: Band[] = [];
    const h = 2 / 13;
    for (let i = 0; i < 13; i++) out.push({ color: i % 2 === 0 ? 0xc8102e : 0xffffff, x0: -1, y0: -1 + i * h, x1: 1, y1: -1 + (i + 1) * h });
    out.push(mirror ? { color: 0x1f3a93, x0: 0.1, y0: -1, x1: 1, y1: -1 + 7 * h } : { color: 0x1f3a93, x0: -1, y0: -1, x1: -0.1, y1: -1 + 7 * h });
    return out;
  },
  /** White, blue, red thirds. */
  ru: (): Band[] => [
    { color: 0xffffff, x0: -1, y0: -1, x1: 1, y1: -1 / 3 },
    { color: 0x1c57a5, x0: -1, y0: -1 / 3, x1: 1, y1: 1 / 3 },
    { color: 0xd52b1e, x0: -1, y0: 1 / 3, x1: 1, y1: 1 },
  ],
  /** Finland: white with a blue Nordic cross, its upright toward the back, where Olli's approved sprite has it. */
  fi: (mirror: boolean): Band[] => [
    { color: 0xffffff, x0: -1, y0: -1, x1: 1, y1: 1 },
    { color: 0x0083fc, x0: mirror ? 0.09 : -0.48, y0: -1, x1: mirror ? 0.48 : -0.09, y1: 1 },
    { color: 0x0083fc, x0: -1, y0: 0.19, x1: 1, y1: 0.5 },
  ],
  /** Black, red, gold. */
  de: (): Band[] => [
    { color: 0x1b1b1b, x0: -1, y0: -1, x1: 1, y1: -1 / 3 },
    { color: 0xdd0000, x0: -1, y0: -1 / 3, x1: 1, y1: 1 / 3 },
    { color: 0xffce00, x0: -1, y0: 1 / 3, x1: 1, y1: 1 },
  ],
};

function plainBall(color: number) {
  return (_mirror: boolean): Band[] => [{ color, x0: -1, y0: -1, x1: 1, y1: 1 }];
}

function drawGhost(color: number) {
  return (g: Graphics, pose: Pose, r: number) => {
    const wobble = Math.sin(pose.t * 10) * 0.08;
    const pts: Pt[] = [];
    for (let i = 0; i <= 16; i++) {
      const a = Math.PI + (i / 16) * Math.PI;
      pts.push([Math.cos(a) * r, Math.sin(a) * r * 1.05 - r * 0.05]);
    }
    const skirt = 4;
    for (let i = 0; i <= skirt * 2; i++) {
      const x = r - (i / (skirt * 2)) * 2 * r;
      const y = r * (i % 2 === 0 ? 0.95 : 0.7) + (i % 2 === 0 ? wobble * r : -wobble * r);
      pts.push([x, y]);
    }
    const fill = pose.ko ? greyOut(color) : pose.hurt ? 0xffffff : color;
    g.poly(flat(pts)).fill(fill).stroke({ width: OUTLINE(r), color: INK, join: 'round' });
    const look: Record<Dir, [number, number]> = { right: [0.35, 0], left: [-0.35, 0], down: [0, 0.3], up: [0, -0.35] };
    const [lx, ly] = look[pose.facing];
    for (const ex of [-0.34, 0.3]) {
      const cx = ex * r;
      const cy = -0.2 * r;
      if (pose.blink && !pose.ko && !pose.hurt) {
        g.moveTo(cx - r * .2, cy).lineTo(cx + r * .2, cy).stroke({ width: OUTLINE(r), color: INK, cap: 'round' });
        continue;
      }
      g.ellipse(cx, cy, r * 0.24, r * 0.3).fill(0xffffff).stroke({ width: OUTLINE(r) * 0.5, color: INK });
      g.circle(cx + lx * r * 0.15, cy + ly * r * 0.15, r * 0.12).fill(0x1f3a93);
    }
  };
}

/**
 * A frightened ghost, as Pac-Man's turn when a power pellet is eaten: deep blue, with two small pale eyes
 * and a pale wavy mouth, the same whichever way it faces. The first ghost of the maze, the weak one.
 */
function drawScaredGhost(g: Graphics, pose: Pose, r: number) {
  const wobble = Math.sin(pose.t * 10) * 0.08;
  const pts: Pt[] = [];
  for (let i = 0; i <= 16; i++) {
    const a = Math.PI + (i / 16) * Math.PI;
    pts.push([Math.cos(a) * r, Math.sin(a) * r * 1.05 - r * 0.05]);
  }
  for (let i = 0; i <= 8; i++) pts.push([r - (i / 8) * 2 * r, r * (i % 2 === 0 ? 0.95 : 0.7) + (i % 2 === 0 ? wobble : -wobble) * r]);
  const pale = pose.ko ? 0xd8d8d8 : 0xffc8b8;
  g.poly(flat(pts)).fill(pose.ko ? greyOut(0x2b3bd8) : pose.hurt ? 0xffffff : 0x2b3bd8).stroke({ width: OUTLINE(r), color: INK, join: 'round' });
  for (const ex of [-0.3, 0.3]) {
    if (pose.blink && !pose.ko && !pose.hurt) g.moveTo((ex - .12) * r, -r * .3).lineTo((ex + .12) * r, -r * .3).stroke({ width: OUTLINE(r), color: INK, cap: 'round' });
    else g.rect(ex * r - r * 0.12, -r * 0.42, r * 0.24, r * 0.24).fill(pale);
  }
  const mouth: number[] = [];
  for (let i = 0; i <= 6; i++) mouth.push(-r * 0.6 + (i / 6) * r * 1.2, r * (i % 2 === 0 ? 0.32 : 0.16));
  g.moveTo(mouth[0]!, mouth[1]!);
  for (let i = 2; i < mouth.length; i += 2) g.lineTo(mouth[i]!, mouth[i + 1]!);
  g.stroke({ width: Math.max(1, r * 0.12), color: pale, join: 'miter' });
}

/** A pale round head with a hat drawn by `hat`. Used for guards and soldiers. */
function drawHead(hat: (g: Graphics, r: number, pose: Pose) => void) {
  return (g: Graphics, pose: Pose, r: number) => {
    inkedBall(g, pose, r, plainBall(0xf2d6b0));
    hat(g, r, pose);
  };
}

const capHat = (g: Graphics, r: number, pose: Pose) => {
  const dirX = pose.facing === 'left' ? -1 : 1;
  g.poly(flat([
    [-r * 0.95, -r * 0.58],
    [-r * 0.8, -r * 0.95],
    [r * 0.8, -r * 0.95],
    [r * 0.95, -r * 0.58],
  ])).fill(0xc8102e).stroke({ width: OUTLINE(r) * 0.8, color: INK });
  // Peak
  if (pose.facing !== 'up') {
    g.poly(flat([
      [dirX * r * 0.2, -r * 0.63],
      [dirX * r * 1.25, -r * 0.63],
      [dirX * r * 1.1, -r * 0.51],
      [dirX * r * 0.1, -r * 0.51],
    ])).fill(0x7a0a1a).stroke({ width: OUTLINE(r) * 0.6, color: INK });
  }
  g.poly(flat(starPoly(0, -r * 0.76, r * 0.15))).fill(0xffd23f);
};

const tallHat = (g: Graphics, r: number) => {
  g.rect(-r * 0.8, -r * 1.55, r * 1.6, r * 1.02).fill(0x8c8f93).stroke({ width: OUTLINE(r) * 0.8, color: INK });
  g.rect(-r * 0.8, -r * 0.78, r * 1.6, r * 0.25).fill(0xc8102e).stroke({ width: OUTLINE(r) * 0.6, color: INK });
};

const bow = (g: Graphics, r: number) => {
  const x = r * 0.35;
  const y = -r * 0.95;
  g.poly(flat([[x, y], [x - r * 0.45, y - r * 0.3], [x - r * 0.45, y + r * 0.3]])).fill(0xff5fa2).stroke({ width: OUTLINE(r) * 0.6, color: INK });
  g.poly(flat([[x, y], [x + r * 0.45, y - r * 0.3], [x + r * 0.45, y + r * 0.3]])).fill(0xff5fa2).stroke({ width: OUTLINE(r) * 0.6, color: INK });
  g.circle(x, y, r * 0.12).fill(0xff5fa2).stroke({ width: OUTLINE(r) * 0.6, color: INK });
};

/** Olli's cuff follows the lower eye line. The shared jaw opens below it, so no hat clipping is needed.
 * Actors roll this complete side drawing, hat included, when facing up or down.
 */
const beanie = (g: Graphics, r: number, pose: Pose) => {
  const tone = (c: number) => (pose.ko ? greyOut(c) : c);
  const ink = { width: OUTLINE(r) * 0.8, color: INK, join: 'round' as const };
  // The cuff follows the ball's outline a little outside it, from just above the eyes to the crown.
  const [bottom, top, out] = [-0.54, -0.84, 1.05];
  const edge = (y: number) => Math.sqrt(out * out - y * y);
  const cuff: Pt[] = [];
  for (let i = 0; i <= 6; i++) { const y = bottom + ((top - bottom) * i) / 6; cuff.push([-edge(y) * r, y * r]); }
  for (let i = 0; i <= 6; i++) { const y = top + ((bottom - top) * i) / 6; cuff.push([edge(y) * r, y * r]); }
  const crown: Pt[] = [];
  for (let i = 0; i <= 16; i++) { const a = Math.PI + (i / 16) * Math.PI; crown.push([Math.cos(a) * (edge(top) + 0.04) * r, (top + Math.sin(a) * 0.44) * r]); }
  g.poly(flat(crown)).fill(tone(0x5e7b9f)).stroke(ink);
  const kept = cuff;
  if (kept.length >= 3) g.poly(flat(kept)).fill(tone(0x55708f)).stroke(ink);
  // Ribs across the cuff, where it is its full height.
  for (let x = -0.525; x <= 0.53; x += 0.15) {
    const rib: Pt[] = [[(x - 0.016) * r, top * r], [(x + 0.016) * r, top * r], [(x + 0.016) * r, bottom * r], [(x - 0.016) * r, bottom * r]];
    if (rib.length >= 3) g.poly(flat(rib)).fill(tone(0x48607f));
  }
};

function drawTank(g: Graphics, pose: Pose, r: number) {
  const s = pose.facing === 'right' ? 1 : -1;
  const w = r * 3.2;
  const h = r * 1.3;
  const body = pose.ko ? 0x6b6b6b : pose.hurt ? 0xffffff : 0x4f7a3a;
  // Tracks and road wheels
  g.roundRect(-w / 2, -h * 0.1, w, h * 0.75, h * 0.35).fill(0x3a3a3a).stroke({ width: OUTLINE(r), color: INK });
  for (let i = 0; i < 5; i++) {
    g.circle(-w * 0.38 + (i * w * 0.76) / 4, h * 0.28, h * 0.2).fill(0x9a9a9a).stroke({ width: OUTLINE(r) * 0.6, color: INK });
  }
  // Hull and turret
  g.poly(flat([[-w * 0.55, -h * 0.1], [-w * 0.45, -h * 0.55], [w * 0.45, -h * 0.55], [w * 0.55, -h * 0.1]])).fill(body).stroke({ width: OUTLINE(r), color: INK });
  g.roundRect(-w * 0.22, -h * 1.05, w * 0.44, h * 0.55, h * 0.15).fill(body).stroke({ width: OUTLINE(r), color: INK });
  // Gun
  g.rect(s > 0 ? w * 0.2 : -w * 0.78, -h * 0.88, w * 0.58, h * 0.16).fill(0x2f4a22).stroke({ width: OUTLINE(r) * 0.8, color: INK });
  // Small red mark
  g.circle(-s * w * 0.3, -h * 0.33, h * 0.08).fill(0xc8102e);
  // Rider: a pale head in a red cap
  g.circle(-s * w * 0.02, -h * 1.25, r * 0.42).fill(0xf2d6b0).stroke({ width: OUTLINE(r) * 0.7, color: INK });
  g.rect(-s * w * 0.02 - r * 0.42, -h * 1.55, r * 0.84, r * 0.3).fill(0xc8102e).stroke({ width: OUTLINE(r) * 0.5, color: INK });
}

function drawBoss(g: Graphics, pose: Pose, r: number) {
  inkedBall(g, pose, r, plainBall(pose.hurt ? 0xffffff : 0xc4161c), () => {
    const star = clipToRect(starPoly(-r * 0.15, r * 0.25, r * 0.35), -r, -r, r, r);
    for (const piece of outsideJaw(star, pose.facing, pose.ko ? 0 : pose.mouth, r))
      g.poly(flat(piece)).fill(0x7a0a0a);
  });
  // A big black gun, held level and pointing the way the boss faces.
  const s = pose.facing === 'right' ? 1 : -1;
  g.rect(s > 0 ? r * 0.3 : -r * 1.9, r * 0.05, r * 1.6, r * 0.32).fill(0x1b1a1f);
  g.rect(s > 0 ? r * 0.2 : -r * 0.6, r * 0.25, r * 0.4, r * 0.5).fill(0x1b1a1f);
}

/** The guides' three paired rectangles, with the same column and heights on every jacket. */
function jacketFasteners(g: Graphics, p: Pose, r: number, poly: Pt[], bar: number, knot: number): void {
  const bx = (p.facing === 'left' ? -1 : 1) * (BALL_EYES[0].x + BALL_EYES[1].x) / 2;
  const detail = (x0: number, y0: number, x1: number, y1: number, color: number) => {
    const clipped = clipToRect(poly, x0 * r, y0 * r, x1 * r, y1 * r);
    const pieces = p.facing === 'down' ? outsideJaw(clipped, p.facing, p.ko ? 0 : p.mouth, r) : [clipped];
    for (const piece of pieces) if (piece.length >= 3) g.poly(flat(piece)).fill(color);
  };
  for (const y of [.36, .56, .76]) {
    detail(bx - .13, y - .035, bx + .13, y + .035, bar);
    detail(bx - .055, y - .055, bx + .055, y + .055, knot);
  }
}

/** Neighbours on Beijing's shopping street, with different jackets and hair. */
function resident(shirt: number, hair: number, collarNotch = false): LookInfo {
  return {
    size: 11,
    rolls: true,
    draw: (g, p, r) => inkedBall(g, p, r, () => [
      { color: 0xf0d2ab, x0: -1, y0: -1, x1: 1, y1: 1 },
      { color: hair, x0: -1, y0: -1, x1: 1, y1: -0.52 },
      { color: shirt, x0: -1, y0: 0.3, x1: 1, y1: 1 },
      // Speaking guides' fallback collars do not change with movement.
      ...(collarNotch ? [{ color: 0xe5dfc8, x0: (p.facing === 'left' ? -.6 : .6) - .1, y0: 0.3, x1: (p.facing === 'left' ? -.6 : .6) + .1, y1: 0.58 }] : []),
    ], poly => {
      // Silent residents keep a solid jacket for the whole walk, including closed-mouth beats.
      if (!collarNotch && !p.moving) jacketFasteners(g, p, r, poly, 0xfffdf6, 0xfffdf6);
    }),
  };
}

/** Bike lines stay behind the whole head, including the transparent opening of its mouth. */
function cycleLine(g: Graphics, points: Pt[], head: number, width: number, color: number): void {
  // Include half the stroke so its painted edge cannot peek into the head's cutout.
  const radius = head + width / 2;
  let end: Pt | null = null;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!, b = points[i]!;
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const length2 = dx * dx + dy * dy;
    if (!length2) continue;
    const along = a[0] * dx + a[1] * dy;
    const discriminant = along * along - length2 * (a[0] * a[0] + a[1] * a[1] - radius * radius);
    const draw = (from: number, to: number) => {
      if (to <= from) return;
      const start: Pt = [a[0] + dx * from, a[1] + dy * from];
      if (!end || Math.hypot(start[0] - end[0], start[1] - end[1]) > 1e-7) g.moveTo(...start);
      end = [a[0] + dx * to, a[1] + dy * to];
      g.lineTo(...end);
    };
    if (discriminant <= 0) { draw(0, 1); continue; }
    const root = Math.sqrt(discriminant);
    const enter = (-along - root) / length2, leave = (-along + root) / length2;
    if (leave <= 0 || enter >= 1) draw(0, 1);
    else {
      draw(0, Math.max(0, enter));
      draw(Math.min(1, leave), 1);
    }
  }
  g.stroke({ width, color, join: 'round' });
}

/** Two wheels, a simple diamond frame and a Pac perched over the saddle. */
function cyclist(shirt: number, frame: number): LookInfo {
  const rider = resident(shirt, 0x2b2a2e);
  return { size: 11, draw: (g, p, r) => {
    // Traffic rides sideways. An unreachable front/back pose uses the missing-art marker, without an animation.
    if (p.facing === 'up' || p.facing === 'down') {
      g.rect(-r, -r, r * 2, r * 2).fill(0xff69b4);
      return;
    }
    const d = p.facing === 'left' ? -1 : 1;
    const head = r * .76;
    for (const x of [-1.08, 1.08]) {
      // The wheel's fill lies outside the head; its thick rim needs the same clipping as the frame.
      g.circle(x * r, r * .64, r * .46).fill(0xe3dac4);
      const rim: Pt[] = Array.from({ length: 41 }, (_, i) => {
        const a = i * Math.PI / 20;
        return [(x + Math.cos(a) * .46) * r, (.64 + Math.sin(a) * .46) * r];
      });
      cycleLine(g, rim, head, 1.8, INK);
      const angle = p.mouth * Math.PI;
      for (let i = 0; i < 3; i++) {
        const a = angle + i * Math.PI / 3, dx = Math.cos(a) * r * .4, dy = Math.sin(a) * r * .4;
        g.moveTo(x * r - dx, r * .64 - dy).lineTo(x * r + dx, r * .64 + dy).stroke({ width: .65, color: 0x6e7774 });
      }
    }
    cycleLine(g, [[-1.08*d*r,.64*r],[-.42*d*r,-.08*r],[.08*d*r,.64*r],[-1.08*d*r,.64*r],
      [.66*d*r,-.08*r],[.08*d*r,.64*r]], head, 1.8, frame);
    cycleLine(g, [[1.08*d*r,.64*r],[.6*d*r,-.37*r],[.96*d*r,-.43*r]], head, 1.5, INK);
    cycleLine(g, [[-.65*d*r,-.13*r],[-.18*d*r,-.13*r]], head, 2.6, INK);
    rider.draw(g, p, head);
  } };
}

/**
 * A ninja of the martial arts street (the owner, 2026-11-07: two sparring on the pavement, who teach Ronnie Ronnienomics!):
 * a hood of `hood` over the whole ball but a slit for the eyes, and a headband of `band` tied at the back, its two tails
 * out behind.
 */
function ninja(hood: number, band: number): LookInfo {
  return {
    size: 11,
    rolls: true,
    draw: (g, p, r) => {
      const back = p.facing === 'left' ? 1 : -1;
      const tone = (c: number) => (p.hurt ? 0xffffff : p.ko ? greyOut(c) : c);
      // The tails first, so the ball covers where they are tied.
      for (const [dy, len] of [[-0.02, 0.62], [0.16, 0.5]] as const) {
        g.poly([back * r * 0.7, -r * 0.72, back * r * (0.95 + len), -r * (0.5 - dy), back * r * (0.9 + len * 0.8), -r * (0.3 - dy), back * r * 0.72, -r * 0.5])
          .fill(tone(band)).stroke({ width: OUTLINE(r) * 0.8, color: INK, join: 'round' });
      }
      inkedBall(g, p, r, () => [
        { color: hood, x0: -1, y0: -1, x1: 1, y1: 1 },
        { color: 0xf0d2ab, x0: -1, y0: -0.5, x1: 1, y1: 0.08 },
        { color: band, x0: -1, y0: -0.74, x1: 1, y1: -0.54 },
      ]);
    },
  };
}

/**
 * A broad straw hat is the shared visual cue for Beijing's talkable neighbours. Seen a little from above, it comes down to a
 * curve, the near half of its rim: on the maps it is all cone, and in the newspaper photos (`brim`) the cone stops short of a
 * darker brim whose edge shows under it (the owner, 13 Nov: it ended on a straight line, on a darker oval above the head).
 */
function strawHat(base: LookInfo, brim = false): LookInfo {
  return { ...base, draw: (g, p, r) => {
    base.draw(g, p, r);
    const cy = -r * .72, rx = r * 1.27, ry = r * .2, apex = -r * 1.65, lip = brim ? .55 : 1;
    // The cone's near edge, `lip` of the rim's depth: from its right end round to its left.
    const edge = (u: number) => cy + Math.sqrt(Math.max(0, 1 - u * u)) * ry * lip;
    const near: number[] = [];
    for (let i = 0; i <= 16; i++) { const u = Math.cos((i / 16) * Math.PI); near.push(u * rx, edge(u)); }
    if (brim) g.ellipse(0, cy, rx, ry).fill(0xb6914e).stroke({ width: 1, color: INK });
    g.poly([0, apex, ...near]).fill(0xe3c779).stroke({ width: 1, color: INK, join: 'round' });
    for (const x of [-.8, -.4, 0, .4, .8])
      g.moveTo(0, -r * 1.6).lineTo(r * x, edge(x / 1.27) - r * .03).stroke({ width: .6, color: 0xb08a46 });
  } };
}

/**
 * Stable, broad clothing palette; white jackets and gold fasteners identify people with dialogue. `photo` dresses them for the
 * newspaper photos, whose straw hats show their brim.
 */
export function beijingCivilianLook(look: LookId, seed: number, speaks: boolean, photo = false): LookInfo {
  let state = seed >>> 0;
  const random = () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296);
  const hue = random() * 6, saturation = .4 + random() * .3, value = .55 + random() * .3;
  const c = value * saturation, x = c * (1 - Math.abs(hue % 2 - 1)), m = value - c;
  const rgb = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][Math.floor(hue)]!;
  const color = rgb.reduce((n, v) => (n << 8) | Math.round((v + m) * 255), 0);
  const hair = [0x292a2d, 0x4b413b, 0x676963, 0x8b8880][Math.floor(random() * 4)]!;
  if (speaks) return strawHat({ size: 11, rolls: true, draw: (g, p, r) => {
    // Collar, fasteners and eyes share the same facing side of the jacket.
    const bx = (p.facing === 'left' ? -1 : 1) * (BALL_EYES[0].x + BALL_EYES[1].x) / 2;
    inkedBall(g, p, r, () => [
      { color: 0xf0d2ab, x0: -1, y0: -1, x1: 1, y1: 1 },
      { color: hair, x0: -1, y0: -1, x1: 1, y1: -.52 },
      { color: 0xfffdf6, x0: -1, y0: .14, x1: 1, y1: 1 },
      { color, x0: bx - .18, y0: .14, x1: bx + .18, y1: .24 },
      { color, x0: -1, y0: .83, x1: 1, y1: 1 },
    ], (poly) => {
      jacketFasteners(g, p, r, poly, 0xeac44d, 0xffdd64);
    });
  } }, photo);
  if (look.startsWith('cyclist_')) return cyclist(color, color);
  // Retain the theatre performer's headdress while varying its costume too.
  if (look === 'opera_performer') {
    const costume = resident(color, hair);
    return { ...costume, draw: (g, p, r) => {
      costume.draw(g, p, r);
      for (const x of [-.65, -.25, .25, .65]) g.circle(x * r, -.86 * r, r * .14).fill(0xd7a73a).stroke({ width: .6, color: INK });
    } };
  }
  return resident(color, hair);
}

/** Pens for a hat over a ball: in the ball's radius about its middle, drawn facing right and mirrored for left. */
function hatPens(g: Graphics, pose: Pose, r: number) {
  const side = pose.facing === 'left' ? -1 : 1;
  const tone = (c: number) => (pose.hurt ? 0xffffff : pose.ko ? greyOut(c) : c);
  return {
    shape: (points: number[], color: number) => g.poly(points.map((v, i) => (i % 2 ? v : v * side) * r)).fill(tone(color)).stroke({ width: OUTLINE(r), color: INK, join: 'round' }),
    /** The side away from the light, inside a shape's outline. */
    tint: (points: number[], color: number) => g.poly(points.map((v, i) => (i % 2 ? v : v * side) * r)).fill(tone(color)),
    round: (x: number, y: number, rx: number, ry: number, color: number) => g.ellipse(x * side * r, y * r, rx * r, ry * r).fill(tone(color)).stroke({ width: OUTLINE(r), color: INK }),
    line: (x0: number, y0: number, x1: number, y1: number, color: number, width = 1) => g.moveTo(x0 * side * r, y0 * r).lineTo(x1 * side * r, y1 * r).stroke({ width, color: tone(color), cap: 'round' }),
  };
}

type Hat = (g: Graphics, pose: Pose, r: number) => void;

/** What each German wears over the same German body, so no two look alike (the owner, 30 Oct); only the construction workers share theirs. */
export const LOOK_HATS: Partial<Record<LookId, Hat>> = {
  // The construction workers, all alike: a yellow hard hat with a raised ridge and a short peak.
  worker: (g, p, r) => {
    const { shape, line, tint } = hatPens(g, p, r);
    shape([-1.04, -.6, -.92, -.74, .9, -.74, 1.36, -.62, 1.3, -.54, -.98, -.54], 0xd19c10);
    shape([-.86, -.64, -.84, -1.02, -.5, -1.36, 0, -1.46, .5, -1.36, .84, -1.02, .86, -.64], 0xf5c518);
    tint([-.34, -.66, -.46, -1.36, -.82, -1.01, -.84, -.66], 0xe0ab12);
    shape([-.17, -.64, -.21, -1.4, 0, -1.5, .21, -1.4, .17, -.64], 0xffe46e);
    line(.62, -.86, .42, -1.14, 0xfff6c4, 1.3);
    line(-.86, -.64, .86, -.64, 0x8f6a08, 1.1);
  },
  // The tour guide: a navy sailor's cap with a gold cord and a black peak.
  german_guide: (g, p, r) => {
    const { shape, line, tint } = hatPens(g, p, r);
    shape([-.86, -.62, -.98, -1.22, -.5, -1.38, .6, -1.38, .98, -1.2, .84, -.62], 0x27406e);
    tint([-.34, -.84, -.46, -1.33, -.92, -1.17, -.8, -.84], 0x1b2f54);
    line(.72, -1.1, .2, -1.26, 0x5678b0, 1.2);
    shape([-.86, -.62, -.9, -.82, .88, -.82, .84, -.62], 0x1a2c4e);
    line(-.8, -.72, .8, -.72, 0xe6b23a, 1.1);
    shape([.4, -.62, 1.32, -.5, 1.22, -.68, .8, -.82], 0x17191f);
  },
  // The souvenir hunter: a bright sun visor, open on top.
  german_tourist: (g, p, r) => {
    const { shape, line, tint } = hatPens(g, p, r);
    shape([-.84, -.6, -.68, -.86, .68, -.86, .84, -.6], 0x22c3c9);
    tint([-.26, -.63, -.32, -.83, -.65, -.83, -.78, -.63], 0x128f96);
    line(-.72, -.73, .72, -.73, 0xf3fbf6, 1.2);
    shape([.46, -.62, 1.4, -.46, 1.3, -.64, .7, -.82], 0x1599a0);
  },
  // The nephew: a red baseball cap on backwards.
  german_nephew: (g, p, r) => {
    const { shape, round, line, tint } = hatPens(g, p, r);
    shape([-.7, -.64, -1.5, -.56, -1.44, -.74, -.82, -.86], 0xa82a20);
    shape([-.85, -.62, -.82, -1.02, -.45, -1.36, .1, -1.44, .55, -1.32, .85, -.98, .85, -.62], 0xd8352a);
    tint([-.28, -.66, -.32, -1.32, -.53, -1.27, -.8, -.99, -.81, -.66], 0xa92519);
    line(.62, -1.02, .36, -1.24, 0xf3847a, 1.2);
    line(.1, -1.42, -.14, -.66, 0x8d1f17);
    round(.52, -.8, .2, .15, 0x26252b);
    round(.1, -1.44, .11, .09, 0xf8f0d8);
  },
  // The shopper: a pink hat with a white ribbon and a flower on it.
  german_shopper: (g, p, r) => {
    const { shape, round, line, tint } = hatPens(g, p, r);
    round(0, -.66, 1.16, .17, 0xd96a95);
    shape([-.72, -.68, -.66, -1.14, -.3, -1.36, .3, -1.36, .66, -1.14, .72, -.68], 0xf08fb0);
    tint([-.26, -.9, -.3, -1.32, -.62, -1.12, -.67, -.9], 0xd1668f);
    line(.14, -1.28, .4, -1.24, 0xffc4d8, 1.1);
    shape([-.72, -.68, -.7, -.88, .7, -.88, .72, -.68], 0xfdf3e0);
    round(-.42, -.84, .25, .25, 0xd8352a);
    round(-.42, -.84, .09, .09, 0xf5c518);
  },
  // The student: a floppy rust beret, tipped to the back.
  german_student: (g, p, r) => {
    const { shape, line, tint } = hatPens(g, p, r);
    line(.02, -1.38, .1, -1.58, INK, 1.8);
    shape([-1.08, -.86, -.96, -1.18, -.4, -1.38, .3, -1.34, .84, -1.06, .9, -.78, .5, -.66, -.5, -.64, -.96, -.7], 0xd9622b);
    tint([-.18, -.72, -.28, -1.3, -.8, -1.1, -.92, -.8, -.48, -.7], 0xb44c1c);
    line(.7, -1.06, .3, -1.26, 0xf59a68, 1.2);
    line(-.68, -.74, .7, -.76, 0xa84818, 1.4);
  },
  // The pensioner: a green felt hat with a feather in its band.
  german_pensioner: (g, p, r) => {
    const { shape, line, tint } = hatPens(g, p, r);
    shape([-.5, -.84, -.88, -1.72, -.64, -1.68, -.38, -.98], 0xf3efe0);
    line(-.46, -.96, -.74, -1.6, 0x9a9383, 0.8);
    shape([-1.12, -.64, -.9, -.76, .9, -.76, 1.12, -.64, .8, -.6, -.8, -.6], 0x3f6a34);
    shape([-.6, -.74, -.52, -1.36, -.08, -1.24, .4, -1.4, .6, -.74], 0x4f7a3c);
    tint([-.2, -.9, -.24, -1.26, -.38, -1.3, -.55, -.9], 0x3a5f2b);
    line(.34, -1.08, .32, -1.26, 0x7fae68, 1.1);
    shape([-.6, -.74, -.58, -.92, .58, -.92, .6, -.74], 0xe3c779);
  },
  // The commuter: a slate bowler with a dark band.
  german_commuter: (g, p, r) => {
    const { shape, round, line, tint } = hatPens(g, p, r);
    round(0, -.68, 1.02, .15, 0x3a3f49);
    shape([-.66, -.72, -.68, -1.08, -.38, -1.42, .38, -1.42, .68, -1.08, .66, -.72], 0x59616e);
    tint([-.2, -.92, -.26, -1.38, -.36, -1.38, -.64, -1.08, -.63, -.92], 0x434a55);
    line(.46, -1.1, .26, -1.3, 0x8b95a4, 1.2);
    shape([-.66, -.72, -.67, -.9, .67, -.9, .66, -.72], 0x26252b);
  },
  // The gardener: a floppy olive sun hat with a wide brim and a green band.
  german_gardener: (g, p, r) => {
    const { shape, line, tint } = hatPens(g, p, r);
    shape([-1.42, -.46, -1, -.76, 1, -.76, 1.42, -.46, .9, -.6, -.9, -.6], 0x9aa35a);
    tint([-.5, -.62, -.6, -.74, -.98, -.74, -1.32, -.49, -.9, -.62], 0x7f8846);
    shape([-.62, -.72, -.54, -1.22, 0, -1.32, .54, -1.22, .62, -.72], 0xaab366);
    tint([-.2, -.9, -.22, -1.26, -.52, -1.2, -.58, -.9], 0x8c9550);
    line(.42, -1.02, .3, -1.18, 0xd6dd92, 1.1);
    shape([-.62, -.72, -.6, -.88, .6, -.88, .62, -.72], 0x3c7a45);
  },
};

/** A German with a hat over the same body, for when there is no picture. */
function germanInHat(look: LookId): LookInfo {
  return { size: 11, rolls: true, flag: flags.de, draw: (g, p, r) => {
    inkedBall(g, p, r, flags.de);
    LOOK_HATS[look]?.(g, p, r);
  } };
}

export const LOOKS: Record<LookId, LookInfo> = {
  // The fallback for Olli's approved sprite: the Finnish flag and the blue beanie.
  olli: { size: 11, rolls: true, flag: flags.fi, draw: (g, p, r) => { paintedBall(g, p, r, flags.fi); beanie(g, r, p); } },
  ronnie: { size: 11, rolls: true, flag: flags.us, draw: (g, p, r) => paintedBall(g, p, r, flags.us) },
  gorbie: { size: 11, rolls: true, flag: flags.ru, draw: (g, p, r) => paintedBall(g, p, r, flags.ru) },
  blue_thing: { size: 11, rolls: true, draw: (g, p, r) => { inkedBall(g, p, r, plainBall(0x3fd0e8)); bow(g, r); } },
  shopkeeper: { size: 11, rolls: true, draw: (g, p, r) => inkedBall(g, p, r, plainBall(0x4cd964)) },
  resident_blue: resident(0x427ba1, 0x2b2a2e),
  resident_red: resident(0xb9523e, 0x5b5147),
  resident_ochre: resident(0xd2a444, 0x90918a),
  cyclist_blue: cyclist(0x427ba1, 0x964837),
  cyclist_red: cyclist(0xb9523e, 0x3c6961),
  guide_blue: strawHat(resident(0x427ba1, 0x2b2a2e, true)),
  guide_red: strawHat(resident(0xb9523e, 0x5b5147, true)),
  guide_ochre: strawHat(resident(0xd2a444, 0x90918a, true)),
  guide_student: strawHat(resident(0xeeeee4, 0x2b2a2e, true)),
  guide_merchant: strawHat({ size: 11, rolls: true, draw: (g, p, r) => inkedBall(g, p, r, plainBall(0x4cd964)) }),
  martial_pupil: resident(0x496b73, 0x2b2a2e),
  ninja_black: ninja(0x25232b, 0xc8102e),
  ninja_blue: ninja(0x27365a, 0xe9e2cf),
  opera_performer: {
    size: 11, rolls: true,
    draw: (g, p, r) => {
      inkedBall(g, p, r, () => [
        { color: 0xf3e6ce, x0: -1, y0: -1, x1: 1, y1: 1 },
        { color: 0xb8372b, x0: -1, y0: 0.3, x1: 1, y1: 1 },
        { color: 0x2c5a86, x0: -1, y0: -1, x1: 1, y1: -0.65 },
      ]);
      for (const x of [-0.65, -0.25, 0.25, 0.65]) g.circle(x * r, -0.86 * r, r * 0.14).fill(0xd7a73a).stroke({ width: 0.6, color: INK });
    },
  },
  // A student of 1980s Beijing (revision 2, the owner's plan; the owner, 2026-10-06: make it look like Beijing): dark hair,
  // a light shirt, a satchel's strap across it, in place of the straw hat no student in the city wore.
  student: {
    size: 11,
    rolls: true,
    draw: (g, p, r) =>
      inkedBall(g, p, r, () => [
        { color: 0xf0d2ab, x0: -1, y0: -1, x1: 1, y1: 1 },
        { color: 0x2b2a2e, x0: -1, y0: -1, x1: 1, y1: -0.52 },
        { color: 0xeeeee4, x0: -1, y0: 0.3, x1: 1, y1: 1 },
        { color: 0x5d6b52, x0: -0.75, y0: 0.3, x1: -0.5, y1: 1 },
      ]),
  },
  german: { size: 11, rolls: true, flag: flags.de, draw: (g, p, r) => inkedBall(g, p, r, flags.de) },
  german_guide: germanInHat('german_guide'),
  german_tourist: germanInHat('german_tourist'),
  german_nephew: germanInHat('german_nephew'),
  german_shopper: germanInHat('german_shopper'),
  german_student: germanInHat('german_student'),
  german_pensioner: germanInHat('german_pensioner'),
  german_commuter: germanInHat('german_commuter'),
  german_gardener: germanInHat('german_gardener'),
  worker: germanInHat('worker'),
  grey_hat: { size: 11, rolls: true, draw: drawHead(tallHat) },
  ghost_green: { size: 11, draw: drawGhost(0x2e7d32) },
  ghost_cream: { size: 11, draw: drawGhost(0xf3e2b3) },
  ghost_red: { size: 11, draw: drawGhost(0x9e1b1b) },
  ghost_orange: { size: 11, draw: drawGhost(0xf28c28) },
  ghost_blue: { size: 11, draw: drawScaredGhost },
  // Every maze ghost its own colour (the owner, 2026-10-29); their pictures are tinted painted shapes (src/art/ghostTints.ts).
  ghost_pink: { size: 11, draw: drawGhost(0xf08bb8) },
  ghost_cyan: { size: 11, draw: drawGhost(0x3cc3df) },
  ghost_yellow: { size: 11, draw: drawGhost(0xf6cf2f) },
  ghost_lime: { size: 11, draw: drawGhost(0x95c43a) },
  ghost_purple: { size: 11, draw: drawGhost(0x7c47a6) },
  ghost_white: { size: 11, draw: drawGhost(0xf7f7f4) },
  ghost_brown: { size: 11, draw: drawGhost(0x8a5a36) },
  ghost_magenta: { size: 11, draw: drawGhost(0xc8247e) },
  ghost_teal: { size: 11, draw: drawGhost(0x1d8a7e) },
  ghost_grey: { size: 11, draw: drawGhost(0x8b8e90) },
  // About a regular ghost's size once it has lost all its Health: Battle draws it smaller as it is hurt.
  ghost_giant: { size: 28, draw: drawGhost(0xe58ab8) },
  guard_cap: { size: 11, rolls: true, draw: drawHead(capHat) },
  guard_hat: { size: 11, rolls: true, draw: drawHead(tallHat) },
  soldier: { size: 11, rolls: true, draw: drawHead(capHat) },
  // The rider's cap tops out 1.55 of the hull's 1.3 sizes above the middle (a size above the feet), and the head's
  // circle (0.42) is centred 1.25 of them up, 0.02 of the 3.2-size width behind the middle (drawTank).
  tank: { size: 13, draw: drawTank, head: { up: 1 + 1.55 * 1.3, chin: 1 + 1.25 * 1.3 - 0.42, across: -0.02 * 3.2 } },
  boss: { size: 16, draw: drawBoss },
};

export function isLook(id: string): id is LookId {
  return id in LOOKS;
}
