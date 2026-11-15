import type { KitArt, KitObject, KitTile } from '../../tools/kit_art.ts';

/**
 * What a kit composition draws, worked out apart from any drawing: scale, flips and the order things sort in (src/world/kit_view.ts
 * draws it; tests/kit_math.test.ts holds it to what the notes there promise).
 */

/** A kit cell in pixels; one game tile of 32 world units is 40 across and 32 down. */
export const CELL_W = 40;
export const CELL_H = 32;
/** World units per kit pixel across (a tile is 32 world units; down, a kit pixel is one world unit). */
export const KX = 32 / CELL_W;

const FLIP_H = 0x80000000, FLIP_V = 0x40000000, FLIP_D = 0x20000000;
const FLAGS = (FLIP_H | FLIP_V | FLIP_D) >>> 0;

/** A tile or object's number without its flip bits. */
export const gidOf = (raw: number): number => (raw & ~FLAGS) >>> 0;

/** The matrix (canvas order: x' = a x + c y, y' = b x + d y) a tile's flip bits give: swap the axes, then flip across, then down. */
export interface Flip { a: number; b: number; c: number; d: number }
export function flipOf(raw: number): Flip {
  let m: Flip = { a: 1, b: 0, c: 0, d: 1 };
  // Applied in Tiled's order, each on the result of the one before: the diagonal swap, then horizontal, then vertical.
  if ((raw & FLIP_D) !== 0) m = { a: 0, b: 1, c: 1, d: 0 };
  if ((raw & FLIP_H) !== 0) m = { a: -m.a, b: m.b, c: -m.c, d: m.d };
  if ((raw & FLIP_V) !== 0) m = { a: m.a, b: -m.b, c: m.c, d: -m.d };
  return m;
}
export const isFlipped = (raw: number): boolean => (raw & FLAGS) !== 0;

/** How tall a kit pixel is drawn in the scene's squashed ground: stretched back by the tilt, so after the squash it is as tall as it is wide. */
export const uprightScaleY = (ground: number): number => KX / ground;

/** The base (the y a figure is compared with) of a row of a tile layer: the row's bottom edge. */
export const rowBase = (row: number): number => (row + 1) * CELL_H;

/** A sorting key: the base, then the kit's own order (its layers, then a layer's listing) breaking ties as Tiled's draw order does. */
export const sortKey = (base: number, layer: number, index = 0): number => base + layer * 0.001 + index * 1e-7;

/** Whether a piece with this sorting key is drawn over a figure standing at `y` (in front of it), or under it (behind it). */
export const drawnOver = (key: number, y: number): boolean => key > y;

export interface KitPlan {
  /** The tile layers that are ground: baked under everyone. */
  ground: number[];
  /** The other tile layers' rows that hold a tile, each a thing to sort. */
  strips: Array<{ layer: number; row: number; base: number; key: number }>;
  /** Every tile object, each a thing to sort. */
  objects: Array<{ layer: number; index: number; object: KitObject; base: number; key: number }>;
}

export function planKit(art: KitArt): KitPlan {
  const plan: KitPlan = { ground: [], strips: [], objects: [] };
  art.layers.forEach((layer, order) => {
    if (layer.kind === 'tiles') {
      if (layer.ground) {
        plan.ground.push(order);
        return;
      }
      const rows = new Set<number>();
      layer.cells.forEach((gid, i) => gid && rows.add(Math.floor(i / art.cols)));
      for (const row of [...rows].sort((a, b) => a - b)) plan.strips.push({ layer: order, row, base: rowBase(row), key: sortKey(rowBase(row), order) });
    } else {
      layer.objects.forEach((object, index) => plan.objects.push({ layer: order, index, object, base: object.y, key: sortKey(object.y, order, index) }));
    }
  });
  return plan;
}

/**
 * Where a tile object goes: its matrix (Pixi's order: x' = a x + c y + tx, y' = b x + d y + ty) for a sprite anchored at its
 * middle. The object stands on its base (its bottom edge at the object's y), stretched back by the tilt, and a flip turns the
 * picture inside its own box, which keeps its base.
 */
export function objectMatrix(o: { x: number; y: number; w: number; h: number; gid: number }, ground: number): { a: number; b: number; c: number; d: number; tx: number; ty: number } {
  const f = flipOf(o.gid);
  const k = uprightScaleY(ground);
  return { a: KX * f.a, b: k * f.b, c: KX * f.c, d: k * f.d, tx: (o.x + o.w / 2) * KX, ty: o.y - (o.h * k) / 2 };
}

/**
 * Draws a kit tile into a baking canvas with its cell's corner at (x, y), turned as its number says, at `f` canvas pixels to a kit pixel:
 * from its master when it has one (each part shrunk smoothly to where it goes), else from the kit's own picture, enlarged without smoothing so
 * its pixels stay square. Unscanned tiles are hot pink. `source` gives the picture of a slot.
 */
export function drawKitTile(g: CanvasRenderingContext2D, source: (slot: string) => CanvasImageSource, t: KitTile, x: number, y: number, raw: number, f = 1): void {
  const flipped = isFlipped(raw);
  g.save();
  if (flipped) {
    const m = flipOf(raw);
    g.setTransform(m.a, m.b, m.c, m.d, x + (t.w * f) / 2, y + (t.h * f) / 2);
    x = -(t.w * f) / 2;
    y = -(t.h * f) / 2;
  }
  if (t.unscanned) {
    g.fillStyle = '#ff69b4';
    g.fillRect(x, y, t.w * f, t.h * f);
  } else if (t.master) {
    const src = source(t.master.slot);
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    for (const p of t.master.parts) g.drawImage(src, p.sx, p.sy, p.sw, p.sh, x + p.dx * f, y + p.dy * f, p.dw * f, p.dh * f);
  } else {
    g.imageSmoothingEnabled = false;
    g.drawImage(source(t.slot), t.sx, t.sy, t.w, t.h, x, y, t.w * f, t.h * f);
  }
  g.restore();
}

/**
 * How many canvas pixels to a kit pixel to bake at, from how many device pixels a kit pixel covers on this screen: the smallest of 1, 2 and 4
 * that leaves a baked pixel no more than about one device pixel across (the masters have four to a kit pixel), so the picture is shrunk, never
 * stretched, and the baking is no larger than the screen can show.
 */
export function bakeScale(devicePixelsPerKitPixel: number, previous?: 1 | 2 | 4): 1 | 2 | 4 {
  // Upgrade at the quality boundary; downgrade only with 10% headroom. A viewport animation or browser zoom
  // hovering round 1.3 or 2.6 must not destroy and remake every visible chunk on alternating frames.
  if (previous === 4 && devicePixelsPerKitPixel > 2.6 * 0.9) return 4;
  if ((previous === 2 || previous === 4) && devicePixelsPerKitPixel > 1.3 * 0.9) return devicePixelsPerKitPixel <= 2.6 ? 2 : 4;
  return devicePixelsPerKitPixel <= 1.3 ? 1 : devicePixelsPerKitPixel / 2 <= 1.3 ? 2 : 4;
}

/** Cells to a chunk each way: the baking and the sorting strips are cut in pieces this size, so a texture stays small and only what is near the screen is held. */
export const CHUNK = 4;

/** Chunks reached by a view and its margin. Ordinary maps clamp to the composition; free fight views may bake exterior ground. */
export function chunksIn(view: { x0: number; y0: number; x1: number; y1: number }, cols: number, rows: number, margin = 64, exterior = false): { c0: number; c1: number; r0: number; r1: number } {
  const span = TILE_WORLD * CHUNK;
  const clamp = (v: number, hi: number) => exterior ? v : Math.max(0, Math.min(hi, v));
  const cmax = Math.ceil(cols / CHUNK) - 1, rmax = Math.ceil(rows / CHUNK) - 1;
  return {
    c0: clamp(Math.floor((view.x0 - margin) / span), cmax), c1: clamp(Math.floor((view.x1 + margin) / span), cmax),
    r0: clamp(Math.floor((view.y0 - margin) / span), rmax), r1: clamp(Math.floor((view.y1 + margin) / span), rmax),
  };
}
const TILE_WORLD = 32;
