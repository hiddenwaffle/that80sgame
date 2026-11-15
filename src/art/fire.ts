import type { Graphics } from 'pixi.js';
import { INK } from '../render/palette.ts';

/** Where flames and smoke come from on a figure or prop, in its own units from its base (y up is negative). */
export type FireSpot = [number, number];

/**
 * Flames and smoke, drawn in code and moving with time (the look's `wreck`): the tank breaking down through its
 * fight, the Warsaw Pac smoking as it weakens, the wreck left burning below the tank's gap. `level` runs from 0 (nothing)
 * through smoke alone (up to 0.5) to flames growing with it; `smokeOnly` keeps flames out (the Warsaw Pac). Each
 * flame is three tongues of colour inside an ink line, flickering on its own phase; each smoke puff rises, swells,
 * and fades. With `still` (Reduce motion) they stand at a fixed moment.
 */
export function drawFire(g: Graphics, t: number, spots: readonly FireSpot[], size: number, level: number, opts: { smokeOnly?: boolean; still?: boolean } = {}): void {
  if (level <= 0) return;
  const at = opts.still ? 0.37 : t;
  const flames = opts.smokeOnly ? 0 : Math.max(0, Math.min(1, (level - 0.5) / 0.5));
  spots.forEach(([x, y], i) => {
    // Smoke: four puffs a spot, each a quarter of the way up its rise from the last.
    const puffs = 4;
    for (let k = 0; k < puffs; k++) {
      const ph = (at * 0.45 + k / puffs + i * 0.31) % 1;
      const r = size * (0.18 + ph * 0.42) * (0.6 + level * 0.5);
      const px = x + Math.sin(ph * 5 + i * 2) * size * 0.25 + ph * size * 0.5;
      const py = y - size * 0.2 - ph * size * (1.4 + level);
      const a = (1 - ph) * 0.55 * Math.min(1, level * 2);
      g.circle(px, py, r).fill({ color: level > 0.75 ? 0x3d3a36 : 0x7a766e, alpha: a });
    }
    if (flames <= 0) return;
    // A flame: outer red-orange in ink, then orange, then a yellow heart.
    const h = size * (0.35 + 0.55 * flames) * (0.85 + 0.15 * Math.sin(at * 11 + i * 1.7));
    const w = size * (0.22 + 0.18 * flames);
    const sway = Math.sin(at * 7 + i) * w * 0.35;
    const tongue = (k: number, color: number, ink: boolean) => {
      const hw = w * k;
      const hh = h * k;
      const pts = [x - hw, y, x - hw * 0.8, y - hh * 0.45, x - hw * 0.25 + sway * 0.5, y - hh * 0.62, x + sway, y - hh, x + hw * 0.35 + sway * 0.5, y - hh * 0.55, x + hw * 0.85, y - hh * 0.4, x + hw, y];
      g.poly(pts).fill(color);
      if (ink) g.poly(pts).stroke({ width: Math.max(0.8, size * 0.06), color: INK, join: 'round' });
    };
    tongue(1, 0xe8541e, true);
    tongue(0.68, 0xffa62b, false);
    tongue(0.38, 0xffe066, false);
  });
}
