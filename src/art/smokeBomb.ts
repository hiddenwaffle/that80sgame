import type { Graphics } from 'pixi.js';
import { INK, POP_PINK } from '../render/palette.ts';

const OLIVE = 0x5d6b3f, OLIVE_LIGHT = 0x7f8f57, STEEL = 0x9a9a92;

/**
 * A smoke bomb about a point, as a smoke grenade's can (the owner, 2026-11-07: "don't smoke bombs look more like cans?";
 * Ronnienomics!'s throw, and the pile the ninjas leave): an olive can banded in the smoke's pink, a steel cap with its
 * lever down one side and its pin's ring, turned by `turn`, `r` about half its height, `line` the ink's width, `rim` the
 * white edge's width (thin on the ninjas' pile, where a thick one looked like stickers). Going off, it puffs smoke from
 * its cap, `lit` seconds in; not going off, it has none.
 */
export function drawSmokeBomb(g: Graphics, x: number, y: number, r: number, turn: number, line: number, lit: number | null, rim = line * 0.7): void {
  const w = r * 1.25, h = r * 1.9, top = -h / 2 + r * 0.15, cap = r * 0.32;
  // Turned about its own middle, then moved there: Pixi's rotate turns whatever was moved before it too.
  g.save().rotateTransform(turn).translateTransform(x, y);
  g.roundRect(-w / 2 - rim, top - cap - rim, w + rim * 2, h + cap + rim * 2, r * 0.25).fill(0xffffff);
  // The cap, its lever down the right, its pin's ring on the left.
  g.rect(-w * 0.3, top - cap, w * 0.6, cap + r * 0.05).fill(STEEL).stroke({ width: line * 0.5, color: INK });
  g.poly([w * 0.18, top - cap, w * 0.5 + r * 0.14, top - cap * 0.6, w * 0.5 + r * 0.14, top + h * 0.55, w * 0.5, top + h * 0.55, w * 0.5, top - cap * 0.2])
    .fill(STEEL).stroke({ width: line * 0.5, color: INK, join: 'round' });
  g.circle(-w * 0.42, top - cap * 0.55, r * 0.2).stroke({ width: Math.max(0.6, line * 0.45), color: INK });
  // The can: olive, a pink band near the top for the smoke it makes, a lighter stripe where the light catches it.
  g.roundRect(-w / 2, top, w, h, r * 0.16).fill(OLIVE);
  g.rect(-w / 2, top + h * 0.1, w, h * 0.17).fill(POP_PINK);
  g.rect(-w * 0.32, top + h * 0.34, w * 0.13, h * 0.56).fill(OLIVE_LIGHT);
  g.roundRect(-w / 2, top, w, h, r * 0.16).stroke({ width: line * 0.6, color: INK });
  g.restore();
  if (lit === null) return;
  // Smoke puffing from the cap, rising whichever way the can is turned.
  const [cx, cy] = [x + Math.sin(turn) * (h / 2 + cap), y - Math.cos(turn) * (h / 2 + cap)];
  for (let i = 0; i < 3; i++) {
    const k = (lit * 3 + i / 3) % 1;
    const [px, py, pr] = [cx + Math.sin(k * 6 + i * 2) * r * 0.35, cy - k * r * 1.6, r * (0.22 + k * 0.38)];
    g.circle(px, py, pr + line * 0.4).fill({ color: INK, alpha: 1 - k });
    g.circle(px, py, pr).fill({ color: 0xffffff, alpha: 1 - k });
  }
}
