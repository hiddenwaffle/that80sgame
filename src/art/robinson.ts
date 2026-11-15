// Robinson's projection, as the title map draws the world: x = 0.8487 R X(lat) λ, y = 1.3523 R Y(lat), X and Y from its
// table every 5 degrees, read smoothly between the entries (Catmull-Rom). In units of R, y up. The same table and
// reading as src/ui/titleMap.ts, plus the way back to latitude and longitude for the globe.

const RX = [1.0, 0.9986, 0.9954, 0.99, 0.9822, 0.973, 0.96, 0.9427, 0.9216, 0.8962, 0.8679, 0.835, 0.7986, 0.7597, 0.7186, 0.6732, 0.6213, 0.5722, 0.5322];
const RY = [0, 0.062, 0.124, 0.186, 0.248, 0.31, 0.372, 0.434, 0.4958, 0.5571, 0.6176, 0.6769, 0.7346, 0.7903, 0.8435, 0.8936, 0.9394, 0.9761, 1.0];

function table(t: number[], lat: number, odd: boolean): number {
  const a = Math.min(90, Math.abs(lat)) / 5, i = Math.min(17, Math.floor(a)), f = a - i;
  const p0 = i > 0 ? t[i - 1]! : (odd ? -t[1]! : t[1]!), p1 = t[i]!, p2 = t[i + 1]!, p3 = i < 17 ? t[i + 2]! : 2 * t[18]! - t[17]!;
  return p1 + 0.5 * f * (p2 - p0 + f * (2 * p0 - 5 * p1 + 4 * p2 - p3 + f * (3 * (p1 - p2) + p3 - p0)));
}

/** Latitude and longitude, in degrees, of a map position: Y(lat) rises with latitude, so it is found by halving. */
export function unrobinson(x: number, y: number): [number, number] {
  const target = Math.min(1, Math.abs(y) / 1.3523);
  let lo = 0, hi = 90;
  for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (table(RY, mid, true) < target) lo = mid; else hi = mid; }
  const lat = Math.sign(y) * (lo + hi) / 2;
  return [lat, (x / (0.8487 * table(RX, lat, false))) * 180 / Math.PI];
}
