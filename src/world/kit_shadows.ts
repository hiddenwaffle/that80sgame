import type { KitArt, KitObject } from '../../tools/kit_art.ts';
import { CELL_H, CELL_W, drawKitTile, flipOf, gidOf } from './kit_math.ts';

const BLUR = 1.6, OPACITY = 0.34;
export const KIT_SHADOW_LIGHTS = {
  up_right: { x: 0.45, y: -0.45 },
  down_right: { x: 0.45, y: 0.22 },
  right_short: { x: 0.28, y: 0 },
} as const;
export type KitShadowLight = keyof typeof KIT_SHADOW_LIGHTS;
type Caster = Pick<KitObject, 'gid' | 'x' | 'y' | 'w' | 'h' | 'shadowLift' | 'groundFootHeight'>;

let filterWorks: boolean | undefined;
/** Some engines accept the filter property without drawing it. Test pixels once, rather than property presence. */
function supportsBlur(): boolean {
  if (filterWorks !== undefined) return filterWorks;
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 16;
  const g = canvas.getContext('2d')!;
  g.filter = 'blur(2px)'; g.fillRect(6, 6, 4, 4);
  filterWorks = g.getImageData(4, 8, 1, 1).data[3]! > 0;
  canvas.width = canvas.height = 0;
  return filterWorks;
}

/** Three separable box passes approximate the same soft edge without Canvas2D filter support. */
function blurAlpha(image: ImageData, scratch: Uint8ClampedArray, radius: number): void {
  const { width, height, data } = image, span = radius * 2 + 1;
  for (let pass = 0; pass < 3; pass++) {
    for (let y = 0; y < height; y++) {
      let sum = 0;
      for (let x = 0; x <= radius; x++) sum += data[(y * width + x) * 4 + 3]!;
      for (let x = 0; x < width; x++) {
        scratch[y * width + x] = sum / span;
        if (x >= radius) sum -= data[(y * width + x - radius) * 4 + 3]!;
        if (x + radius + 1 < width) sum += data[(y * width + x + radius + 1) * 4 + 3]!;
      }
    }
    for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let y = 0; y <= radius; y++) sum += scratch[y * width + x]!;
      for (let y = 0; y < height; y++) {
        data[(y * width + x) * 4 + 3] = sum / span;
        if (y >= radius) sum -= scratch[(y - radius) * width + x]!;
        if (y + radius + 1 < height) sum += scratch[(y + radius + 1) * width + x]!;
      }
    }
  }
}

/** Ground-only cast shadows, painted when a chunk is baked, never during ordinary frame drawing. */
export class KitShadows {
  private readonly art: KitArt;
  private readonly casters: Caster[] = [];
  /** One reusable CPU canvas; no separate shadow textures survive the bake. */
  private mask: HTMLCanvasElement | null = null;
  private blurScratch: Uint8ClampedArray | null = null;
  private readonly horizontal = new Map<number, HTMLCanvasElement>();
  private readonly light: typeof KIT_SHADOW_LIGHTS[KitShadowLight];
  totalMs = 0;
  maxMs = 0;
  peakScratchBytes = 0;

  constructor(art: KitArt, light: KitShadowLight = 'up_right') {
    this.art = art;
    this.light = KIT_SHADOW_LIGHTS[light];
    for (const layer of art.layers) {
      if (layer.kind === 'objects') this.casters.push(...layer.objects);
      else if (!layer.ground) layer.cells.forEach((gid, i) => {
        if (gid) this.casters.push({ gid, x: i % art.cols * CELL_W, y: (Math.floor(i / art.cols) + 1) * CELL_H, w: CELL_W, h: CELL_H });
      });
    }
  }

  get scratchBytes(): number {
    let bytes = (this.mask ? this.mask.width * this.mask.height * 4 : 0) + (this.blurScratch?.byteLength ?? 0);
    for (const strip of this.horizontal.values()) bytes += strip.width * strip.height * 4;
    return bytes;
  }

  /** A horizontal light makes the upright projection edge-on. Union its alpha rows into a ground strip
   * instead of drawing a singular canvas transform, which silently drops the caster. Cached once per flipped tile. */
  private horizontalStrip(raw: number, source: (slot: string) => CanvasImageSource): HTMLCanvasElement {
    const cached = this.horizontal.get(raw);
    if (cached) return cached;
    const t = this.art.tiles[gidOf(raw)]!;
    const raster = document.createElement('canvas'); raster.width = t.w; raster.height = t.h;
    // This canvas is read once for every new strip. Keep it on the CPU to avoid a GPU readback stall per tile.
    const ctx = raster.getContext('2d', { willReadFrequently: true })!;
    drawKitTile(ctx, source, t, 0, 0, raw);
    const pixels = ctx.getImageData(0, 0, t.w, t.h).data;
    const strip = document.createElement('canvas'); strip.width = Math.ceil(t.w + this.light.x * t.h); strip.height = 1;
    const g = strip.getContext('2d')!, row = g.createImageData(strip.width, 1);
    for (let y = 0; y < t.h; y++) for (let x = 0; x < t.w; x++) {
      const at = Math.floor(x + this.light.x * (t.h - y)) * 4 + 3;
      row.data[at] = Math.max(row.data[at]!, pixels[(y * t.w + x) * 4 + 3]!);
    }
    g.putImageData(row, 0, 0);
    this.horizontal.set(raw, strip);
    this.peakScratchBytes = Math.max(this.peakScratchBytes, this.scratchBytes + t.w * t.h * 8 + row.data.byteLength);
    raster.width = raster.height = 0;
    return strip;
  }

  draw(ground: CanvasRenderingContext2D, source: (slot: string) => CanvasImageSource, x0: number, y0: number, scale: number, gutter: number): void {
    const started = performance.now();
    const nativeBlur = supportsBlur();
    // Soft shadows need less detail than the ground art. Cap the CPU fallback mask only;
    // the ground texture keeps its normal device-resolution bake.
    const ratio = nativeBlur ? 1 : Math.min(1, 2 / scale), shadowScale = scale * ratio;
    // Neighbouring casters and blur extend beyond a chunk. The extra mask border keeps its filtered edge continuous.
    const pad = Math.ceil(BLUR * shadowScale * 3), width = Math.ceil(ground.canvas.width * ratio) + pad * 2, height = Math.ceil(ground.canvas.height * ratio) + pad * 2;
    const mask = this.mask ??= document.createElement('canvas');
    if (mask.width !== width || mask.height !== height) { mask.width = width; mask.height = height; }
    const g = mask.getContext('2d')!;
    g.resetTransform(); g.clearRect(0, 0, width, height);
    const margin = (pad + gutter * ratio) / shadowScale;
    const right = x0 + ground.canvas.width / scale + margin, bottom = y0 + ground.canvas.height / scale + margin;
    for (const o of this.casters) {
      const tile = this.art.tiles[gidOf(o.gid)]!;
      // Ground shade already in the cutout must not receive a second, potentially conflicting cast.
      if (tile.shadow === 'painted') continue;
      const lift = o.shadowLift ?? 0, light = this.light;
      const left = o.x + light.x * lift;
      const base = o.y + (1 + light.y) * lift, end = base + light.y * o.h;
      const contact = tile.shadow === 'tight' && lift === 0 ? 2 : 0;
      const top = Math.min(base, end) - (light.y === 0 ? 1.5 : contact);
      const last = Math.max(base, end) + (light.y === 0 ? 1.5 : contact);
      if (left > right || top > bottom || o.x + o.w + light.x * (o.h + lift) + contact < x0 - margin || last < y0 - margin) continue;
      if (light.y === 0) {
        const strip = this.horizontalStrip(o.gid, source);
        g.setTransform(shadowScale, 0, 0, shadowScale,
          pad + gutter * ratio + (left - x0) * shadowScale,
          pad + gutter * ratio + (base - 1.5 - y0) * shadowScale);
        // A three-kit-pixel ground thickness keeps the horizontal silhouette visible under the same soft blur.
        g.drawImage(strip, 0, 0, strip.width, 3);
        continue;
      }
      const length = Math.hypot(light.x, light.y);
      for (let step = 0; step <= contact; step++) {
        g.save();
        g.setTransform(shadowScale, 0, -light.x * shadowScale, -light.y * shadowScale,
          pad + gutter * ratio + (o.x + light.x * (o.h + lift) + step * light.x / length - x0) * shadowScale,
          pad + gutter * ratio + (end + step * light.y / length - y0) * shadowScale);
        // Extend only the bottom four pixels of a reviewed thin foot, in the cast's direction.
        // The foot is never reflected below the base. It shares the cast mask, blur and opacity.
        if (step) { g.beginPath(); g.rect(0, Math.max(0, o.h - 4), o.w, Math.min(4, o.h)); g.clip(); }
        const flip = flipOf(o.gid);
        g.translate(o.w / 2, o.h / 2);
        g.transform(flip.a, flip.b, flip.c, flip.d, 0, 0);
        g.translate(-o.w / 2, -o.h / 2);
        if (o.groundFootHeight) { g.beginPath(); g.rect(0, 0, o.w, o.h - o.groundFootHeight); g.clip(); }
        drawKitTile(g, source, tile, 0, 0, gidOf(o.gid));
        g.restore();
      }
    }
    g.resetTransform();
    g.globalCompositeOperation = 'source-in';
    g.fillStyle = '#000'; g.fillRect(0, 0, width, height);
    g.globalCompositeOperation = 'source-over';
    if (!nativeBlur) {
      if (this.blurScratch?.length !== width * height) this.blurScratch = new Uint8ClampedArray(width * height);
      const pixels = g.getImageData(0, 0, width, height);
      blurAlpha(pixels, this.blurScratch, Math.max(1, Math.round(BLUR * shadowScale)));
      g.putImageData(pixels, 0, 0);
      this.peakScratchBytes = Math.max(this.peakScratchBytes, this.scratchBytes + pixels.data.byteLength);
    }
    ground.save();
    // Apply opacity once to the combined silhouette, so overlapping pieces do not stack dark shadows.
    ground.globalAlpha = OPACITY;
    ground.globalCompositeOperation = 'source-atop';
    ground.filter = nativeBlur ? `blur(${BLUR * scale}px)` : 'none';
    ground.imageSmoothingEnabled = true;
    ground.drawImage(mask, -pad / ratio, -pad / ratio, width / ratio, height / ratio);
    ground.restore();
    const ms = performance.now() - started;
    this.totalMs += ms; this.maxMs = Math.max(this.maxMs, ms);
    this.peakScratchBytes = Math.max(this.peakScratchBytes, this.scratchBytes);
  }

  release(): void {
    this.blurScratch = null;
    for (const strip of this.horizontal.values()) strip.width = strip.height = 0;
    this.horizontal.clear();
    if (this.mask) { this.mask.width = 0; this.mask.height = 0; this.mask = null; }
  }
}
