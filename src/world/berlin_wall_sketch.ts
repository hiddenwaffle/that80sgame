import { Graphics } from 'pixi.js';
import { INK } from '../render/palette.ts';
import { LINE, pens } from './berlin_buildings.ts';
import { REBAR } from './berlin_street_sketch.ts';

/** The pipe along the Wall's top in flat bands, each to this fraction of its height: turning away over its crown, lit, then falling into shadow below. */
const PIPE: Array<[number, number]> = [[0.09, 0xb4b3ab], [0.46, 0xeeede5], [0.72, 0xcac9c1], [0.9, 0x9b9a93], [1, 0x63625d]];

const pipeColour = (f: number): number => (PIPE.find(([to]) => f <= to) ?? PIPE[PIPE.length - 1]!)[1];

/** The torn concrete's four faces: what looks toward the light above and to the left, and what looks away, each as a flat step or a steep break. */
const TORN = { litFlat: 0xe2e0d6, litSteep: 0xc9c7bc, darkFlat: 0xb0aea4, darkSteep: 0x85837a };

/**
 * The Berlin tile sketch's Wall top (the owner, 30 Oct): a round pipe, the top-most part of the Wall, with the rings of its
 * sections going round it, then each panel's seam down the face to `faceH` below the top.
 */
export function drawWallTop(x: number, y: number, w: number, h: number, faceH: number, seamFrom: number, section: number, seamWidth = 1.6): Graphics {
  const g = new Graphics();
  const pipeY = y, pipeH = h, foot = y + faceH;
  let from = 0;
  for (const [to, colour] of PIPE) {
    g.rect(x, pipeY + pipeH * from, w, pipeH * (to - from) + 0.5).fill(colour);
    from = to;
  }
  for (const line of [pipeY, pipeY + pipeH]) g.moveTo(x, line).lineTo(x + w, line).stroke({ width: LINE, color: INK });
  const { hatching } = pens(g);
  for (let sx = seamFrom; sx <= x + w; sx += section) {
    // A ring seen a little from the side, so it bows round the pipe, with the light catching its near lip.
    g.moveTo(sx, pipeY).quadraticCurveTo(sx + 7, pipeY + pipeH / 2, sx, pipeY + pipeH).stroke({ width: 1.3, color: INK });
    g.moveTo(sx - 1.4, pipeY + 1).quadraticCurveTo(sx + 5.6, pipeY + pipeH / 2, sx - 1.4, pipeY + pipeH - 1).stroke({ width: 0.8, color: 0xffffff, alpha: 0.45 });
    // Each section darkest under its right end.
    if (sx - 24 >= x) hatching(sx - 24, -(pipeY + pipeH), sx - 3, -(pipeY + pipeH * 0.74), 3);
    g.moveTo(sx, pipeY + pipeH).lineTo(sx, foot).stroke({ width: seamWidth, color: 0x1b1b1a, alpha: 0.85 });
    if (seamWidth > 1.6) g.moveTo(sx + seamWidth / 2 + 0.5, pipeY + pipeH).lineTo(sx + seamWidth / 2 + 0.5, foot).stroke({ width: 1, color: 0xffffff, alpha: 0.22 });
  }
  return g;
}

/**
 * A blown-out end of the Wall (the owner, 30 Oct): `front` is the torn top edge of its face, from the end of the pipe down to its
 * foot at the gap. Above that edge the torn top of the slab shows the Wall's thickness. The pipe stops short of it in a ragged
 * end. Its rings bow as seen from the left, so only the end facing left shows inside the pipe.
 */
export function drawWallBreak(front: number[], thick: number, y: number, pipeBottom: number, foot: number, seams: number[], gapOn: 'left' | 'right'): Graphics {
  const g = new Graphics();
  const pts: Array<[number, number]> = [];
  for (let i = 0; i < front.length; i += 2) pts.push([front[i]!, front[i + 1]!]);
  const edgeAt = (x: number) => {
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = pts[i - 1]!, [x1, y1] = pts[i]!;
      if (x >= Math.min(x0, x1) && x <= Math.max(x0, x1)) return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0 || 1);
    }
    return foot;
  };
  // The torn top in facets: on the far end it looks up and left toward the light, on the near end away from it.
  const facing = gapOn === 'left';
  const top = (py: number) => Math.min(py, foot) - thick;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1]!, [x1, y1] = pts[i]!;
    const steep = Math.abs(y1 - y0) > Math.abs(x1 - x0);
    g.poly([x0, y0, x1, y1, x1, top(y1), x0, top(y0)]).fill(facing ? (steep ? TORN.litSteep : TORN.litFlat) : steep ? TORN.darkSteep : TORN.darkFlat);
    if (!facing && steep) {
      for (const k of [0.3, 0.65]) g.moveTo(x0 + (x1 - x0) * k, y0 + (y1 - y0) * k - 1).lineTo(x0 + (x1 - x0) * k + 2, y0 + (y1 - y0) * k - thick * 0.7);
      g.stroke({ width: 0.8, color: INK, alpha: 0.8, cap: 'round' });
    }
  }
  g.poly([...pts.flat(), ...[...pts].reverse().flatMap(([x, py]) => [x, top(py)])]).stroke({ width: LINE, color: INK, join: 'round' });
  for (const sx of seams) g.moveTo(sx, edgeAt(sx)).lineTo(sx, foot).stroke({ width: 1.6, color: 0x1b1b1a, alpha: 0.85 });
  // Reinforcing bars sticking up out of the torn slab.
  for (let i = 1; i < pts.length - 1; i += 2) {
    const [bx, by] = pts[i]!;
    const rod = (width: number, color: number) => g.moveTo(bx, by - thick * 0.4).lineTo(bx + (i % 4 === 1 ? 3 : -3), by - thick - 3).stroke({ width, color, cap: 'round' });
    rod(2.6, INK);
    rod(1.2, REBAR);
  }
  // The pipe and the Wall's top end in teeth.
  const end = gapOn === 'right' ? pts[0]![0] : pts[pts.length - 1]![0];
  const dir = gapOn === 'right' ? 1 : -1;
  const h = pipeBottom - y;
  const teeth = [0, 5, 1, 7, 2, 9, 3, 6, 0];
  if (gapOn === 'left') {
    const cy = (y + pipeBottom) / 2, ry = (pipeBottom - y) / 2;
    g.ellipse(end, cy, 7, ry).fill(0xd8d7cf).stroke({ width: 1.3, color: INK });
    g.ellipse(end, cy, 4.2, ry * 0.62).fill(0x2f2f2d).stroke({ width: 0.8, color: INK });
  }
  // Carrying the pipe's own bands out to the broken edge.
  const row = (i: number) => y + (h * i) / (teeth.length - 1);
  for (let i = 1; i < teeth.length; i++) g.poly([end, row(i - 1), end + dir * teeth[i - 1]!, row(i - 1), end + dir * teeth[i]!, row(i), end, row(i)]).fill(pipeColour((i - 0.5) / (teeth.length - 1)));
  // The first tooth starts on the pipe's end itself: naming that point twice built vertices that are not numbers, which drew
  // spikes to the middle of the screen on Android (the owner, 13 Nov).
  g.poly(teeth.flatMap((d, i) => [end + dir * d, row(i)])).stroke({ width: LINE, color: INK, join: 'round' });
  return g;
}

/** The Wall's weight over its panels (the owner, 31 Oct): the pipe's overhang shading the top, damp darkening the foot, and on the lawn side weeds where it meets the ground. */
export function drawWallMass(x: number, y: number, w: number, h: number, weeds: boolean): Graphics {
  const g = new Graphics();
  g.rect(x, y, w, h * 0.11).fill({ color: 0x14161c, alpha: 0.38 });
  g.rect(x, y + h * 0.11, w, h * 0.09).fill({ color: 0x14161c, alpha: 0.16 });
  g.rect(x, y + h * 0.72, w, h * 0.28).fill({ color: 0x14161c, alpha: 0.13 });
  g.rect(x, y + h * 0.87, w, h * 0.13).fill({ color: 0x14161c, alpha: 0.17 });
  if (weeds) {
    const foot = y + h;
    let at = x, i = 0;
    while (at < x + w) {
      at += 9 + (i * 7) % 11; i++;
      if (at >= x + w) break;
      g.moveTo(at - 2.2, foot + 1).lineTo(at - 3.4, foot - 4.5).moveTo(at, foot + 1).lineTo(at, foot - 6.5).moveTo(at + 2.2, foot + 1).lineTo(at + 3.4, foot - 4.5);
    }
    g.stroke({ width: 1.1, color: 0x3f7a30, cap: 'round' });
  }
  return g;
}

/** The Wall's shadow on the ground, falling down and right from the upper left's light, in two flat steps. */
export function drawWallCast(x: number, y: number, w: number, h: number, dx: number): Graphics {
  const g = new Graphics();
  g.poly([x, y, x + w, y, x + w + dx, y + h, x + dx, y + h]).fill({ color: 0x14241a, alpha: 0.15 });
  g.poly([x, y, x + w, y, x + w + dx * 0.5, y + h * 0.5, x + dx * 0.5, y + h * 0.5]).fill({ color: 0x14241a, alpha: 0.13 });
  return g;
}
