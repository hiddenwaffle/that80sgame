/** Orthographic globe coordinates, in radii with screen y down. Callers reuse the result. */
export interface GlobePoint { x: number; y: number; z: number }
export interface GlobeLocation { lon: number; lat: number }

export function projectGlobe(lon: number, lat: number, facing: number, tilt: number, out: GlobePoint): GlobePoint {
  const f = lat * Math.PI / 180, l = (lon - facing) * Math.PI / 180, k = tilt * Math.PI / 180;
  const x = Math.cos(f) * Math.sin(l), y = Math.sin(f), z = Math.cos(f) * Math.cos(l);
  out.x = x;
  out.y = -(y * Math.cos(k) - z * Math.sin(k));
  out.z = y * Math.sin(k) + z * Math.cos(k);
  return out;
}

/** Inverts the visible hemisphere, using the same rotation as the globe's shader. */
export function unprojectGlobe(x: number, y: number, facing: number, tilt: number, out: GlobeLocation): boolean {
  const d2 = x * x + y * y;
  if (!Number.isFinite(d2) || d2 > 1) return false;
  const z = Math.sqrt(1 - d2), k = tilt * Math.PI / 180;
  const Y = -y * Math.cos(k) + z * Math.sin(k), Z = z * Math.cos(k) + y * Math.sin(k);
  out.lat = Math.asin(Math.max(-1, Math.min(1, Y))) * 180 / Math.PI;
  out.lon = ((facing + Math.atan2(x, Z) * 180 / Math.PI + 180) % 360 + 360) % 360 - 180;
  return true;
}

/** How much of a disc (centre cx, cy, radius r) lies inside the window from 0, 0 to w, h, as a share of the whole disc. */
export function discShown(cx: number, cy: number, r: number, w: number, h: number): number {
  const a = Math.max(0, cx - r), b = Math.min(w, cx + r), n = 128, dx = (b - a) / n;
  if (!(r > 0) || b <= a) return 0;
  let area = 0;
  for (let i = 0; i < n; i++) {
    const x = a + (i + 0.5) * dx, half = Math.sqrt(Math.max(0, r * r - (x - cx) ** 2));
    area += Math.max(0, Math.min(h, cy + half) - Math.max(0, cy - half)) * dx;
  }
  return area / (Math.PI * r * r);
}
