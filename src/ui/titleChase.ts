/**
 * How the title globe's pacs choose what to chase and how the title keeps its dots apart: the arithmetic, apart from any drawing
 * (src/ui/titleGlobe.ts uses it; tests/title_chase.test.ts holds it to what the title promises).
 */

/** The latitude band shared by globe pac movement and player dot placement. */
export const PAC_LAT_LIMIT = 80;

const D2R = Math.PI / 180;

/** The shorter way round from one longitude to another, in degrees (-180 to 180); the date line is no wall. */
export const lonDelta = (from: number, to: number): number => ((to - from + 540) % 360 + 360) % 360 - 180;

/** The great-circle distance between two places, in degrees. */
export function arcDegrees(lon0: number, lat0: number, lon1: number, lat1: number): number {
  const f0 = lat0 * D2R, f1 = lat1 * D2R, dl = lonDelta(lon0, lon1) * D2R;
  const c = Math.sin(f0) * Math.sin(f1) + Math.cos(f0) * Math.cos(f1) * Math.cos(dl);
  return Math.acos(Math.max(-1, Math.min(1, c))) / D2R;
}

/** One thing a pac might chase: a light of the map or a dot of the player's, where it is and where it shows on the disc. */
export interface Chase {
  /** Its place in the list the caller keeps (lights first, then dots). */
  id: number;
  lon: number;
  lat: number;
  /** On the disc in globe radii (y down), and how far it faces us (1 at the middle, 0 at the rim). */
  x: number;
  y: number;
  z: number;
}

/** Only what faces us well enough to be walked to, as before. */
export const FACING = 0.25;
/**
 * The middle of what the screen shows of the globe, in globe radii from the disc's own middle (x right, y down), and how far from it
 * the shown part reaches each way (so 1 is the disc's rim when the whole globe shows). The globe is drawn close, so the window cuts
 * it: the middle of the screen is not the disc's.
 */
export interface Focus { x: number; y: number; sx: number; sy: number }
export const WHOLE: Focus = { x: 0, y: 0, sx: 1, sy: 1 };

/** How far a thing shows from the middle of the screen, as a share of how far the screen's part of the globe reaches (1 at its edge). */
export const awayFrom = (f: Focus, x: number, y: number): number => Math.hypot((x - f.x) / f.sx, (y - f.y) / f.sy);

/**
 * How strongly the middle of the screen draws the pacs: a thing there costs nothing extra, one at the edge of what shows costs this
 * many degrees of walking (and a quarter of it halfway out, so the pull is gentle near the middle and firm toward the edge). About
 * a hemisphere's walk, so a pac picks a light at the middle of the screen 160 degrees away over one at the edge next to it.
 */
export const CENTRE_PULL = 160;
/** A pac keeps the chase it is on unless another costs this many degrees less, so a fresh dot nearby draws it but two like ones do not flip it. */
export const HOLD = 10;

/** What chasing a thing costs a pac at (lon, lat): the walk to it, and how far from the middle of the screen it shows. */
export function cost(lon: number, lat: number, c: Chase, f: Focus = WHOLE): number {
  const q = awayFrom(f, c.x, c.y);
  return arcDegrees(lon, lat, c.lon, c.lat) + CENTRE_PULL * q * q;
}

/**
 * What a pac chases next: the dearest-to-leave-alone thing that faces us and no other pac is after, or the thing it is on while
 * that is still within HOLD of the best. -1 when nothing faces us.
 */
export function pick(lon: number, lat: number, chases: readonly Chase[], n: number, current: number, taken: (id: number) => boolean, f: Focus = WHOLE): number {
  let best = -1, bs = Infinity, held = Infinity;
  for (let i = 0; i < n; i++) {
    const c = chases[i]!;
    if (c.z <= FACING || taken(c.id)) continue;
    const s = cost(lon, lat, c, f);
    if (c.id === current) held = s;
    if (s < bs) { bs = s; best = c.id; }
  }
  // Keep it only if it is still there to chase (found above) and not much worse than the best.
  return held < Infinity && held <= bs + HOLD ? current : best;
}

/** Where a pac rests when nothing is worth chasing: its own place round the place at the middle of the screen, which the turn carries along. */
export function anchor(index: number, count: number, middle: { lon: number; lat: number }): { lon: number; lat: number } {
  const k = count > 1 ? index / (count - 1) - 0.5 : 0;
  return { lon: middle.lon + k * 36, lat: middle.lat + (index % 2 ? 6 : -6) };
}

/** A unit vector (north up, x east, z toward longitude 0) for a place, as the dots keep theirs. */
export function unit(lon: number, lat: number, out: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
  const f = lat * D2R, l = lon * D2R;
  out.x = Math.cos(f) * Math.sin(l); out.y = Math.sin(f); out.z = Math.cos(f) * Math.cos(l);
  return out;
}

/** Whether a place is nearer than `minArc` radians to any of these unit vectors (a light or a dot: the title keeps them apart). */
export function crowded(lon: number, lat: number, minArc: number, others: Iterable<{ x: number; y: number; z: number }>): boolean {
  const p = unit(lon, lat, { x: 0, y: 0, z: 0 }), c = Math.cos(minArc);
  for (const o of others) if (p.x * o.x + p.y * o.y + p.z * o.z > c) return true;
  return false;
}
