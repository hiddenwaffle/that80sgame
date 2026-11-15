import { unrobinson } from '../art/robinson.ts';
import { COAST, MAP_STEP } from '../art/titleMapData.ts';

/** Same source rings as the original globe, unwrapped at the antimeridian. */
export function coastLines(): number[][] {
  return COAST.map(line => {
    const out: number[] = [];
    let x = 0, y = 0, prev = 0;
    for (let i = 0; i < line.length; i += 2) {
      x += line[i]!;y += line[i + 1]!;
      const [lat, lon0] = unrobinson(x * MAP_STEP, y * MAP_STEP);
      let lon = lon0;
      if (out.length) { while (lon - prev > 180) lon -= 360;while (lon - prev < -180) lon += 360; }
      out.push(lon, lat);prev = lon;
    }
    return out;
  });
}

/** Closed land rings repeated around the seam, including Antarctica's south-pole closure. */
export function landPath(lines: number[][], X: (lon: number) => number, Y: (lat: number) => number): Path2D {
  const path = new Path2D();
  for (const shift of [-360, 0, 360]) for (const line of lines) {
    for (let i = 0; i < line.length; i += 2) {
      const x = X(line[i]! + shift), y = Y(line[i + 1]!);
      if (i === 0) path.moveTo(x, y);else path.lineTo(x, y);
    }
    const first = line[0]!, last = line[line.length - 2]!;
    if (Math.abs(last - first) > 180) {
      path.lineTo(X(last + shift), Y(-90));path.lineTo(X(first + shift), Y(-90));
    }
    path.closePath();
  }
  return path;
}

export function globeLandPath(width: number): Path2D {
  return landPath(coastLines(), lon => (lon + 180) / 360 * width, lat => (90 - lat) / 180 * width / 2);
}
