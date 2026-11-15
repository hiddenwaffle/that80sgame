/** Signed coastline distance, in equirectangular texture pixels. */
const INF = 1e12;
export const DISTANCE_RANGE = 64;

export type GlobeMapWidth = 1024 | 2048;

/** The owner found the two larger previews indistinguishable. Keep the smaller texture budget. */
export function globeMapWidth(radius: number, resolution: number): GlobeMapWidth {
  return .7 * Math.max(1, radius) * Math.max(1, resolution) > 1024 ? 2048 : 1024;
}

/** An upper bound on the laid-out radius, available before fonts, content or Pixi are ready. */
export function globeViewportMapWidth(width: number, height: number, resolution: number): GlobeMapWidth {
  return globeMapWidth(width > height ? height * .72 : width * .62, Math.min(3, resolution));
}

export interface GlobeBakeProgress { completed: number; total: number; stage: string }

export function bakeGlobeDistance(width: number, land: Path2D, canvas: HTMLCanvasElement | OffscreenCanvas = document.createElement('canvas'), onProgress?: (p: GlobeBakeProgress) => void) {
  const started = performance.now(), height = width / 2;
  // Completed rows/columns, plus mask and final write: work units, not estimated time.
  const total = 2 + width * 2 + height * 4;
  let completed = 0, reported = -Infinity, stage = '';
  const advance = (nextStage: string, count = 1) => {
    completed += count;
    if (nextStage !== stage || completed - reported >= total / 40 || completed === total) {
      stage = nextStage;reported = completed;onProgress?.({ completed, total, stage });
    }
  };
  advance('mask', 0);
  canvas.width = width;canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!ctx) throw new Error('Distance bake needs a 2D canvas.');
  ctx.fillStyle = '#fff';ctx.fill(land);
  const image = ctx.getImageData(0, 0, width, height), maskDone = performance.now();
  advance('initialize');
  const outer = new Float32Array(width * height), inner = new Float32Array(width * height);
  for (let i = 0; i < outer.length; i++) {
    const a = image.data[i * 4 + 3]! / 255;
    outer[i] = a === 0 ? INF : a === 1 ? 0 : Math.max(0, .5 - a) ** 2;
    inner[i] = a === 1 ? INF : a === 0 ? 0 : Math.max(0, a - .5) ** 2;
    if ((i + 1) % width === 0) advance('initialize');
  }
  const size = width * 3, f = new Float64Array(size), d = new Float64Array(size);
  const vertices = new Int32Array(size), breaks = new Float64Array(size + 1);
  // Lower envelope of parabolas: exact one-dimensional squared Euclidean transform.
  const line = (n: number) => {
    let k = 0;vertices[0] = 0;breaks[0] = -INF;breaks[1] = INF;
    for (let q = 1; q < n; q++) {
      let v = vertices[k]!, s = (f[q]! + q * q - f[v]! - v * v) / (2 * (q - v));
      while (s <= breaks[k]!) { k--;v = vertices[k]!;s = (f[q]! + q * q - f[v]! - v * v) / (2 * (q - v)); }
      k++;vertices[k] = q;breaks[k] = s;breaks[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < n; q++) { while (breaks[k + 1]! < q) k++;const delta = q - vertices[k]!;d[q] = delta * delta + f[vertices[k]!]!; }
  };
  const transform = (field: Float32Array, name: string) => {
    for (let x = 0; x < width; x++) {
      for (let y = 0; y < height; y++) f[y] = field[y * width + x]!;
      line(height);
      for (let y = 0; y < height; y++) field[y * width + x] = d[y]!;
      advance(name + ' columns');
    }
    // Three repeated rows, retaining the middle, make longitude periodic without a 3x full-size buffer.
    for (let y = 0; y < height; y++) {
      const row = y * width;
      for (let x = 0; x < size; x++) f[x] = field[row + x % width]!;
      line(size);
      for (let x = 0; x < width; x++) field[row + x] = d[x + width]!;
      advance(name + ' rows');
    }
  };
  transform(outer, 'outside');transform(inner, 'inside');const distanceDone = performance.now();
  for (let i = 0; i < outer.length; i++) {
    const sd = Math.sqrt(outer[i]!) - Math.sqrt(inner[i]!);
    const packed = Math.round((Math.max(-DISTANCE_RANGE, Math.min(DISTANCE_RANGE, sd)) / DISTANCE_RANGE + 1) * .5 * 65535);
    const a = image.data[i * 4 + 3]!;
    image.data[i * 4] = packed >> 8;image.data[i * 4 + 1] = packed & 255;
    image.data[i * 4 + 2] = a;image.data[i * 4 + 3] = 255;
    if ((i + 1) % width === 0) advance('pack');
  }
  ctx.putImageData(image, 0, 0);
  advance('done');
  return { canvas, pixels: image.data, info: { mode: 'sdf', maskMs: maskDone - started, distanceMs: distanceDone - maskDone,
    packMs: performance.now() - distanceDone, totalMs: performance.now() - started,
    textureBytes: width * height * 4, cpuPeakBytes: width * height * 16 + size * 28 + 8,
    width, height, mipmaps: false } };
}

/** Same opaque neon stack and map-space widths as the reference, reconstructed after sampling distance. */
export function distanceMapShader(webgl2: boolean): string {
  const aa = webgl2 ? 'max(0.03, 0.5 * fwidth(sd))' : 'max(0.03, 0.5 * uPx * uMapSize / (2.0 * PI))';
  const slope = webgl2 ? `vec2 gu = vec2(abs(dFdx(u)) < abs(dFdx(fract(u + 0.5))) ? dFdx(u) : dFdx(fract(u + 0.5)),
      abs(dFdy(u)) < abs(dFdy(fract(u + 0.5))) ? dFdy(u) : dFdy(fract(u + 0.5)));
    float ax = max(0.03, 0.5 * length(gu) * uMapSize);
    float ay = max(0.03, 0.25 * length(vec2(dFdx(v), dFdy(v))) * uMapSize);` :
    `float ax = max(0.03, 0.5 * uPx * uMapSize / (2.0 * PI));float ay = ax;`;
  return `vec3 tap = SAMPLE;
    float sd = ((tap.r * 255.0 * 256.0 + tap.g * 255.0) / 65535.0 * 2.0 - 1.0) * ${DISTANCE_RANGE}.0;
    float dc = abs(sd), aa = ${aa};
    float glowAA = max(0.8 * uMapSize / 2048.0, aa);
    ${slope}
    float gx = abs(fract(u * 24.0 + 0.5) - 0.5) * uMapSize / 24.0;
    float gy = abs(fract(v * 12.0 + 0.5) - 0.5) * uMapSize / 24.0;
    float gridWidth = 1.4 * uLine * uMapSize / (2.0 * PI);
    float gridX = 1.0 - smoothstep(gridWidth * 0.5 - ax, gridWidth * 0.5 + ax, gx);
    float gridY = (v > 1.0/24.0 && v < 23.0/24.0) ? 1.0 - smoothstep(gridWidth * 0.5 - ay, gridWidth * 0.5 + ay, gy) : 0.0;
    vec3 map = mix(uFloor, mix(uGrid, uGridLand, tap.b), max(gridX, gridY));
    float unit = uLine * uMapSize / (2.0 * PI);
    map = mix(map, uRim0, 1.0 - smoothstep(7.0 * unit - glowAA, 7.0 * unit + glowAA, dc));
    map = mix(map, uRim1, 1.0 - smoothstep(4.5 * unit - glowAA, 4.5 * unit + glowAA, dc));
    map = mix(map, uRim2, 1.0 - smoothstep(2.75 * unit - glowAA, 2.75 * unit + glowAA, dc));
    map = mix(map, uRim3, 1.0 - smoothstep(2.5 * unit - glowAA, 2.5 * unit + glowAA, dc));
    map = mix(map, uRim4, 1.0 - smoothstep(0.95 * unit - aa, 0.95 * unit + aa, dc));
    map = mix(map, uRim5, 1.0 - smoothstep(0.375 * unit - aa, 0.375 * unit + aa, dc));`;
}
