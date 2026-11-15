import { clipHalfPlane, piePoly, type Dir, type Pt } from './geom.ts';

/** Mean measured Olli/Ronnie/Gorbie side eyes (LOOK_EYES relative to LOOK_FIT), in body radii.
 * The near eye is wider; the far eye sits at the facing edge. Code lids and KO marks use these same centres.
 */
export const BALL_EYES = [
  { x: .365, y: -.192, rx: .223, ry: .261 },
  { x: .826, y: -.211, rx: .145, ry: .266 },
] as const;

export function ballEyes(facing: Dir, ko = false) {
  if (facing === 'up' && !ko) return [];
  return BALL_EYES.map((eye, i) => ({ ...eye,
    x: facing === 'left' ? -eye.x : facing === 'right' ? eye.x : (i ? .27 : -.27),
    rx: facing === 'up' || facing === 'down' ? BALL_EYES[0].rx : eye.rx,
  }));
}

export type Edge = [number, number, number, number];

/** Shared image/code jaw: a level upper lip below the eyes, with the lower lip dropping away. */
export function jawShape(facing: Dir, open: number, size: number): { apex: Pt; dirs: Pt[]; wedge: number[] } | null {
  if (open <= .001 || facing === 'up') return null;
  const front = facing === 'down';
  const a = facing === 'left' ? Math.PI : 0;
  const left = Math.cos(a) < 0;
  const f: Pt = front ? [0, 1] : [Math.cos(a), Math.sin(a)];
  const p: Pt = front ? [1, 0] : left ? [Math.sin(a), -Math.cos(a)] : [-Math.sin(a), Math.cos(a)];
  const apex: Pt = front ? [0, size * .12] : [f[0] * -size * .05 + p[0] * size * .14, f[1] * -size * .05 + p[1] * size * .14];
  const turn = (t: number): Pt => [f[0] * Math.cos(t) + p[0] * Math.sin(t), f[1] * Math.cos(t) + p[1] * Math.sin(t)];
  const [d0, d1] = front ? [turn(-open * .45), turn(open * .45)] : [f, turn(open * .95)];
  const cut = size * 1.4;
  const wedge = [apex[0], apex[1]];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    const d = [d0[0] + (d1[0] - d0[0]) * t, d0[1] + (d1[1] - d0[1]) * t];
    const n = Math.hypot(d[0]!, d[1]!) || 1;
    wedge.push(apex[0] + d[0]! / n * cut, apex[1] + d[1]! / n * cut);
  }
  return { apex, dirs: [d0, d1], wedge };
}

/** Rays stop exactly on the requested circle, for both bitmap lips and the code body's outline. */
export function jawEdges(facing: Dir, open: number, size: number, reach: number): Edge[] {
  const shape = jawShape(facing, open, size);
  if (!shape) return [];
  const { apex } = shape;
  return shape.dirs.map((d): Edge => {
    const b = apex[0] * d[0] + apex[1] * d[1];
    const k = -b + Math.sqrt(Math.max(0, b * b - (apex[0] ** 2 + apex[1] ** 2 - reach * reach)));
    return [apex[0], apex[1], apex[0] + d[0] * k, apex[1] + d[1] * k];
  });
}

/** The solid body around the shared jaw. Closed and back-facing mouths keep the complete circle. */
export function ballPolygon(facing: Dir, open: number, r: number): Pt[] {
  const edges = jawEdges(facing, open, r, r);
  if (!edges.length) return piePoly(r);
  const [a, b] = edges as [Edge, Edge];
  const angles = [Math.atan2(a[3], a[2]), Math.atan2(b[3], b[2])];
  const clockwise = facing === 'right';
  const start = angles[clockwise ? 1 : 0]!;
  let end = angles[clockwise ? 0 : 1]!;
  while (end <= start) end += Math.PI * 2;
  const n = Math.max(8, Math.ceil((end - start) * 40 / (Math.PI * 2)));
  const poly: Pt[] = [[a[0], a[1]]];
  for (let i = 0; i <= n; i++) {
    const t = start + (end - start) * i / n;
    poly.push([Math.cos(t) * r, Math.sin(t) * r]);
  }
  return poly;
}

/** Remove the actual offset jaw from a detail polygon, splitting the two remaining half-planes without overlap. */
export function outsideJaw(poly: Pt[], facing: Dir, open: number, r: number, shape = jawShape(facing, open, r)): Pt[][] {
  if (!shape) return [poly];
  const [a, b] = shape.dirs as [Pt, Pt];
  const sign = Math.sign(a[0] * b[1] - a[1] * b[0]);
  const upper: Pt = [-a[1] * sign, a[0] * sign];
  const lower: Pt = [b[1] * sign, -b[0] * sign];
  const local: Pt[] = poly.map(([x, y]) => [x - shape.apex[0], y - shape.apex[1]]);
  const above = clipHalfPlane(local, ...upper);
  const below = clipHalfPlane(clipHalfPlane(local, ...lower), -upper[0], -upper[1]);
  return [above, below].filter(p => p.length >= 3).map(p => p.map(([x, y]): Pt => [x + shape.apex[0], y + shape.apex[1]]));
}

export function insideJaw(x: number, y: number, facing: Dir, open: number, r: number, shape = jawShape(facing, open, r)): boolean {
  if (!shape) return false;
  const [a, b] = shape.dirs as [Pt, Pt];
  const sign = Math.sign(a[0] * b[1] - a[1] * b[0]);
  const dx = x - shape.apex[0], dy = y - shape.apex[1];
  return sign * (a[0] * dy - a[1] * dx) > 1e-8 && sign * (b[0] * dy - b[1] * dx) < -1e-8;
}
