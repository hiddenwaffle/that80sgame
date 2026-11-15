import { Container, Graphics } from 'pixi.js';

/** Full sheets with freely visible corners. No stack-shaped clipping mask. */
export function paperSurround(w: number, h: number, side: number, gap: number): Container {
  const out = new Container();
  out.label = 'chapter_surround_fanned';
  out.eventMode = 'none';
  const base = new Graphics();
  base.label = 'paper_stack_carrier';
  out.addChild(base);
  const pages = [[-.06, -.08, .96, .94, -.29, 0xcac1af], [.13, .04, .91, 1.02, .26, 0xd8cfbc], [-.09, .06, .98, .90, -.16, 0xe8dfce]];
  for (const [dx, dy, rw, rh, angle, color] of pages) {
    const pw = w * rw!, ph = (h + gap * .85) * rh!;
    const c = new Container();
    c.pivot.set(pw / 2, ph / 2);
    c.position.set(w / 2 + w * dx!, h / 2 + h * dy!);
    c.rotation = angle!;
    const g = new Graphics()
      .rect(5, 8, pw, ph).fill({color: 0x252624, alpha: .25})
      .rect(2, 4, pw, ph).fill({color: 0x252624, alpha: .25})
      .rect(0, 0, pw, ph).fill(color!).stroke({color: 0x887d68, width: .8});
    const f = 22;
    g.poly([pw-f, 0, pw, f, pw-f, f]).fill(0xaaa08b);
    g.poly([pw-f, 0, pw, f, pw, 0]).fill(0xf1e9d7);
    c.addChild(g);
    out.addChild(c);
  }
  // Extend the opaque carrier beyond every sheet's real extent. The map wipe uses this same extent,
  // so no map can show through the gaps while the freely rotated pages travel across the screen.
  const b = out.getLocalBounds();
  const left = Math.min(-side, b.minX - 2), right = Math.max(w + side, b.maxX + 2);
  const top = Math.min(-gap, b.minY - 2), bottom = Math.max(h + gap, b.maxY + 2);
  base.rect(left, top, right-left, bottom-top).fill(0xb7afa0);
  return out;
}
