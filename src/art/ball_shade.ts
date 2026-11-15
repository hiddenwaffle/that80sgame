import type { Graphics } from 'pixi.js';
import type { Pose } from './characters.ts';
import { flat, type Dir, type Pt } from './geom.ts';
import { jawShape, outsideJaw } from './ball_face.ts';

/** Two shallow crescents follow the existing back/lower hatching; the light comes from the upper facing side. */
function crescent(depth: number): Pt[] {
  const points: Pt[] = [];
  for (let i = 0; i <= 16; i++) {
    const a = (55 + 190 * i / 16) * Math.PI / 180;
    points.push([Math.cos(a) * .98, Math.sin(a) * .98]);
  }
  for (let i = 16; i >= 0; i--) {
    const a = (55 + 190 * i / 16) * Math.PI / 180;
    const r = .98 - depth * Math.sin(Math.PI * i / 16);
    points.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  return points;
}
const highlight: Pt[] = Array.from({ length: 20 }, (_, i) => {
  const t = i * Math.PI / 10, x = Math.cos(t) * .27, y = Math.sin(t) * .105;
  const a = -Math.PI / 5;
  return [.25 + x * Math.cos(a) - y * Math.sin(a), -.48 + x * Math.sin(a) + y * Math.cos(a)];
});
const layers = [
  { points: crescent(.42), alpha: .095, highlight: false },
  { points: crescent(.19), alpha: .105, highlight: false },
  { points: highlight, alpha: .12, highlight: true },
];

function shadePaths(facing: Dir, mouth: number) {
  const mirror = facing === 'left' ? -1 : 1, opening = jawShape(facing, mouth, 1);
  return layers.flatMap(layer => {
    const poly: Pt[] = layer.points.map(([x, y]) => [x * mirror, y]);
    return outsideJaw(poly, facing, mouth, 1, opening).map(points => ({ points, alpha: layer.alpha, highlight: layer.highlight }));
  });
}
// Fixed-size pose table shared by the crowd, rather than clipping the same crescents for every actor redraw.
const commonShades = new Map<string, ReturnType<typeof shadePaths>>();
for (const facing of ['right', 'left', 'up', 'down'] as Dir[])
  for (const mouth of [0, .5, 1]) commonShades.set(`${facing}:${mouth}`, shadePaths(facing, mouth));

/** Filled geometry only: no texture, filter or blur. KO shadows are neutral grey and every layer avoids the jaw. */
export function ballShading(pose: Pose, r: number) {
  const mouth = pose.ko ? 0 : pose.mouth;
  const paths = commonShades.get(`${pose.facing}:${mouth}`) ?? shadePaths(pose.facing, mouth);
  return paths.map(layer => ({
    points: layer.points.map(([x, y]): Pt => [x * r, y * r]), alpha: layer.alpha,
    color: layer.highlight ? 0xffffff : pose.ko ? 0x252525 : 0x25212b,
  }));
}

export function drawBallShading(g: Graphics, pose: Pose, r: number): void {
  for (const layer of ballShading(pose, r)) g.poly(flat(layer.points)).fill({ color: layer.color, alpha: layer.alpha });
}
