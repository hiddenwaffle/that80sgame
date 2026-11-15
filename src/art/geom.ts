/** Small geometry helpers for drawing clipped shapes with Pixi Graphics. */

export type Pt = [number, number];

/** Polygon for a circle, or a Pac-Man pie with a mouth of half-angle `mouth` facing `angle`. */
export function piePoly(r: number, angle = 0, mouth = 0, segments = 40): Pt[] {
  if (mouth <= 0.001) {
    const pts: Pt[] = [];
    for (let i = 0; i < segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      pts.push([Math.cos(a) * r, Math.sin(a) * r]);
    }
    return pts;
  }
  const pts: Pt[] = [[0, 0]];
  const start = angle + mouth;
  const sweep = Math.PI * 2 - mouth * 2;
  const n = Math.max(8, Math.round((segments * sweep) / (Math.PI * 2)));
  for (let i = 0; i <= n; i++) {
    const a = start + (sweep * i) / n;
    pts.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  return pts;
}

/** Clips a polygon (any shape) to an axis-aligned rectangle (Sutherland-Hodgman). */
export function clipToRect(poly: Pt[], x0: number, y0: number, x1: number, y1: number): Pt[] {
  let out = poly;
  const edges: Array<[(p: Pt) => boolean, (a: Pt, b: Pt) => Pt]> = [
    [(p) => p[0] >= x0, (a, b) => lerpAt(a, b, (x0 - a[0]) / (b[0] - a[0]))],
    [(p) => p[0] <= x1, (a, b) => lerpAt(a, b, (x1 - a[0]) / (b[0] - a[0]))],
    [(p) => p[1] >= y0, (a, b) => lerpAt(a, b, (y0 - a[1]) / (b[1] - a[1]))],
    [(p) => p[1] <= y1, (a, b) => lerpAt(a, b, (y1 - a[1]) / (b[1] - a[1]))],
  ];
  for (const [inside, cut] of edges) {
    const input = out;
    out = [];
    if (input.length === 0) break;
    let prev = input[input.length - 1]!;
    for (const cur of input) {
      const curIn = inside(cur);
      const prevIn = inside(prev);
      if (curIn) {
        if (!prevIn) out.push(cut(prev, cur));
        out.push(cur);
      } else if (prevIn) {
        out.push(cut(prev, cur));
      }
      prev = cur;
    }
  }
  return out;
}

/** Keeps the part of a polygon where nx * x + ny * y <= 0, the side of a line through the origin. */
export function clipHalfPlane(poly: Pt[], nx: number, ny: number): Pt[] {
  if (poly.length === 0) return [];
  const side = (p: Pt) => nx * p[0] + ny * p[1];
  const out: Pt[] = [];
  let prev = poly[poly.length - 1]!;
  for (const cur of poly) {
    const a = side(prev);
    const b = side(cur);
    if ((a <= 0) !== (b <= 0)) out.push(lerpAt(prev, cur, a / (a - b)));
    if (b <= 0) out.push(cur);
    prev = cur;
  }
  return out;
}

function lerpAt(a: Pt, b: Pt, t: number): Pt {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

export function flat(poly: Pt[]): number[] {
  const out: number[] = [];
  for (const [x, y] of poly) out.push(x, y);
  return out;
}

/** Five-pointed star polygon. */
export function starPoly(cx: number, cy: number, r: number, inner = 0.42, rot = -Math.PI / 2): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i < 10; i++) {
    const rr = i % 2 === 0 ? r : r * inner;
    const a = rot + (i * Math.PI) / 5;
    pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
  }
  return pts;
}

export type Dir = 'up' | 'down' | 'left' | 'right';

export function dirVector(d: Dir): [number, number] {
  switch (d) {
    case 'right':
      return [1, 0];
    case 'down':
      return [0, 1];
    case 'left':
      return [-1, 0];
    case 'up':
      return [0, -1];
  }
}

/** Whether a facing is to one side, left or right. */
export function isSide(d: Dir): d is 'left' | 'right' {
  return d === 'left' || d === 'right';
}

export function dirFromVector(dx: number, dy: number, fallback: Dir = 'down'): Dir {
  if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) return fallback;
  if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? 'right' : 'left';
  return dy > 0 ? 'down' : 'up';
}

/**
 * The way someone faces as they take a step of (dx, dy), facing `current`. A side is kept while the step goes its way
 * within about 50 degrees; up or down gives way to a side once the step is within a few degrees of a diagonal, so a
 * diagonal walk faces the side, as `dirFromVector`'s ties and keys' diagonals do. Between the two (about 46 to 50
 * degrees off level) either is kept. Taken afresh every step, a walk near a diagonal flipped between two ways every step
 * or two, and a rolling ball, turned a quarter each time, flickered (Gorbie, the owner, 2026-10-03).
 */
export function walkFacing(dx: number, dy: number, current: Dir): Dir {
  if (isSide(current)) {
    const along = current === 'right' ? dx : -dx;
    return along > 0 && Math.abs(dy) <= along * 1.2 ? current : dirFromVector(dx, dy, current);
  }
  if (dx !== 0 && Math.abs(dx) >= Math.abs(dy) * 0.95) return dx > 0 ? 'right' : 'left';
  return dirFromVector(dx, dy, current);
}
