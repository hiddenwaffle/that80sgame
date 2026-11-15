import type { Graphics } from 'pixi.js';
import { INK } from '../render/palette.ts';

/**
 * A pair of cherries about a point, turned by `spin`: the stems joined above at a leaf, each cherry glossy red
 * over a dark rim, with a white shine and a glint. Drawn in the caller's units, `r` each cherry's radius.
 */
export function cherryPair(g: Graphics, x: number, y: number, r: number, spin: number): void {
  const c = Math.cos(spin);
  const s = Math.sin(spin);
  const at = (px: number, py: number): [number, number] => [x + px * c - py * s, y + px * s + py * c];
  const lw = Math.max(0.8, r * 0.14);
  const joint = at(r * 0.15, -r * 2.5);
  // The stems, from the top of each cherry up to the joint, green over ink.
  for (const side of [-1, 1]) {
    const [bx, by] = at(side * r * 0.95, side > 0 ? -r * 0.6 : -r * 0.8);
    const [qx, qy] = at(side * r * 0.5, -r * 1.9);
    for (const [wd, col] of [[r * 0.26 + lw, INK], [r * 0.26, 0x3c8d2f]] as const) g.moveTo(bx, by).quadraticCurveTo(qx, qy, joint[0], joint[1]).stroke({ width: wd, color: col, cap: 'round' });
  }
  const leaf = ([[0, 0], [r * 0.5, -r * 0.45], [r * 1.25, -r * 0.35], [r * 0.6, r * 0.12]] as const).flatMap(([px, py]) => at(r * 0.15 + px, -r * 2.5 + py));
  g.poly(leaf).fill(0x4caf50).stroke({ width: lw * 0.8, color: INK, join: 'round' });
  for (const side of [-1, 1]) {
    const [cx, cy] = at(side * r * 0.95, side > 0 ? r * 0.15 : 0);
    g.circle(cx, cy, r).fill(0x8e0b1f).stroke({ width: lw, color: INK });
    g.circle(cx - r * 0.12, cy - r * 0.12, r * 0.8).fill(0xd81b3a);
    g.ellipse(cx - r * 0.38, cy - r * 0.36, r * 0.3, r * 0.2).fill({ color: 0xffffff, alpha: 0.9 });
    g.circle(cx + r * 0.32, cy - r * 0.48, r * 0.09).fill(0xffffff);
  }
}
