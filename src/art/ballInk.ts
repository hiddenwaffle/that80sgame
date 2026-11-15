import type { Graphics } from 'pixi.js';
import type { Pose } from './characters.ts';
import { flat, type Dir, type Pt } from './geom.ts';
import { insideJaw, outsideJaw, jawShape } from './ball_face.ts';
import { INK } from '../render/palette.ts';

function hatchPaths(facing: Dir, mouth: number): Pt[][] {
  const r = 1, mirror = facing === 'left' ? -1 : 1;
  const opening = jawShape(facing, mouth, r);
  const out: Pt[][] = [];
  for (let deg = 66, i = 0; deg <= 238; deg += 4.5, i++) {
    const a = deg * Math.PI / 180;
    const point = (radius: number, theta: number): Pt => [mirror * Math.cos(theta) * radius, Math.sin(theta) * radius];
    const reach = .82 + .035 * Math.sin(i * 1.7);
    const stroke: Pt[] = [point(r * .978, a - .007), point(r * reach, a - .10), point(r * .978, a + .007)];
    out.push(...outsideJaw(stroke, facing, mouth, r, opening));
  }
  return out;
}

// Actors use three mouth steps. Reuse their unit geometry; arbitrary preview poses still work without growing a cache.
const commonHatches = new Map<string, Pt[][]>();
for (const facing of ['right', 'left', 'up', 'down'] as Dir[])
  for (const mouth of [0, .5, 1]) commonHatches.set(`${facing}:${mouth}`, hatchPaths(facing, mouth));

/** Tapered ink strokes inside the body, clipped out of the actual mouth even in front portraits. */
export function ballHatching(pose: Pose, r: number): Pt[][] {
  const mouth = pose.ko ? 0 : pose.mouth;
  const paths = commonHatches.get(`${pose.facing}:${mouth}`) ?? hatchPaths(pose.facing, mouth);
  return paths.map(poly => poly.map(([x, y]): Pt => [x * r, y * r]));
}

/** Party-weight contour and hatching, cut around the same jaw as the bitmap characters. */
export function drawBallInk(g: Graphics, pose: Pose, r: number, poly: Pt[]): void {
  for (const stroke of ballHatching(pose, r)) g.poly(flat(stroke)).fill(INK);
  g.poly(flat(poly)).stroke({ width: r * .064, color: INK, join: 'round' });
  const mouth = pose.ko ? 0 : pose.mouth;
  const opening = jawShape(pose.facing, mouth, r);
  const mirror = pose.facing === 'left' ? -1 : 1;
  const heavierArc = (from: number, to: number, width: number) => {
    let drawing = false;
    for (let deg = from; deg <= to; deg += 3) {
      const a = deg * Math.PI / 180;
      const x = mirror * Math.cos(a) * r, y = Math.sin(a) * r;
      if (insideJaw(x, y, pose.facing, mouth, r, opening)) { drawing = false; continue; }
      if (drawing) g.lineTo(x, y); else g.moveTo(x, y);
      drawing = true;
    }
    g.stroke({ width: r * width, color: INK, cap: 'round', join: 'round' });
  };
  heavierArc(60, 126, .077);
  heavierArc(123, 240, .08);
}
