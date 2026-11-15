/**
 * Reads a Tiled kit composition (art/tiled/<set>/compositions/*.tmj: cells of 40 by 32 pixels, external tilesets, tile layers
 * and tile objects) into what the game draws from, for a game map that names it with the property `kit_art`. The build's
 * `virtual:kit-art` module (vite.config.ts) holds the result; src/world/kit_view.ts draws it. Plain file reading only.
 *
 * One kit cell is one game tile, so a composition is as many cells as the game map has tiles. Every image the composition
 * uses is a slot of its map, `scenery/<map>/kit/<path under art/tiled>`, so the art loader's groups, progress and hot pink
 * for a failed image apply to it as to any other scenery.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { imageSize } from './image_size.ts';
import { masterFinder, readRecord, recordedMaster, tileKey, type MasterPart } from './kit_masters.ts';

/** A kit cell: 40 pixels across for a game tile's 32 world units across, 32 pixels down for its 32. */
export const KIT_CELL_W = 40;
export const KIT_CELL_H = 32;

export interface KitTile {
  /** The tileset it is in (`ground`, `roofs`, a pack's name...), its number there, and its picture's path under art/tiled: for finding the master it was made from. */
  set: string;
  id: number;
  file: string;
  slot: string;
  sx: number;
  sy: number;
  w: number;
  h: number;
  /** The master this tile was made from, when there is one that checks out (tools/kit_masters.ts): the game draws that, shrunk to the tile's place, instead of this quarter-size picture. */
  master?: { slot: string; parts: MasterPart[] };
  /** No scan decision exists for this tile yet: development draws hot pink, and strict checks fail. */
  unscanned?: true;
  /** Reviewed source art: keep its painted ground shadow, or tighten a thin foot along the generated cast. */
  shadow?: 'painted' | 'tight';
}
export interface KitObject {
  id: number;
  name: string;
  gid: number;
  /** Pixels; y is the bottom (a tile object's default alignment on an orthogonal map), so the object's base. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Height of this piece's base above the ground, for a roof standing on its ground floor. */
  shadowLift?: number;
  /** Bottom band painted as flat ground in an otherwise upright cutout, in kit pixels. */
  groundFootHeight?: number;
}
export type KitLayer =
  | { name: string; kind: 'tiles'; ground: boolean; cells: number[] }
  | { name: string; kind: 'objects'; ground: false; objects: KitObject[] };
export interface KitArt {
  cols: number;
  rows: number;
  /** Cast upright silhouettes onto the baked ground only when the composition requests them. */
  castShadows?: true;
  layers: KitLayer[];
  /** Every gid the layers use (without its flip bits), to the part of a slot's image it draws. A cell or object keeps its flips in its own number. */
  tiles: Record<number, KitTile>;
}
export interface KitImage {
  slot: string;
  file: string;
  bytes: number;
  width: number;
  height: number;
}

/** Tiled keeps a tile's flips in the top bits of its number: horizontal, vertical, diagonal (a swap of the two axes, done first). */
const FLIP_H = 0x80000000, FLIP_V = 0x40000000, FLIP_D = 0x20000000;
const FLAGS = (FLIP_H | FLIP_V | FLIP_D) >>> 0;

interface TiledTileset { image?: string; imagewidth?: number; imageheight?: number; columns?: number; tilewidth: number; tileheight: number; tilecount: number; margin?: number; spacing?: number; objectalignment?: string; tileoffset?: { x: number; y: number }; tiles?: Array<{ id: number; image: string; imagewidth: number; imageheight: number; animation?: unknown[] }> }

/** The maps under content/maps that name a composition, as [map id, composition path relative to the project]. */
export function kitMaps(root: string): Array<[string, string]> {
  const dir = path.join(root, 'content/maps');
  const out: Array<[string, string]> = [];
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.tmj')).sort()) {
    const json = JSON.parse(readFileSync(path.join(dir, f), 'utf8')) as { properties?: Array<{ name: string; value: unknown }> };
    const prop = json.properties?.find((p) => p.name === 'kit_art');
    if (prop) out.push([f.replace(/\.tmj$/, ''), String(prop.value)]);
  }
  return out;
}

/** What a read leaves out and what it keeps in kit pictures: the tiles that have no master (and why), and the figures dropped. */
export interface KitReadNotes { unmapped: Array<{ tile: string; why: string }>; dropped: string[] }

/**
 * The slot a kit picture has under its map's scenery (`scenery/<map>/kit/<path under art/tiled>`, or `.../kit/src/<path under src/art/images>`
 * for the game's own art), or null when it lies outside those two roots, which is all the rest of the pipeline supports: the WebP copies
 * (tools/webp_record.ts kitMasters) and the production import (vite.config.ts) look for kit pictures under art/tiled, and the game's own
 * art keeps its copies beside it. A kit-only source folder therefore goes under art/tiled (art/tiled/kit_sources).
 */
export function kitImageSlot(root: string, mapId: string, abs: string): string | null {
  const kitRoot = path.join(root, 'art/tiled') + path.sep, srcRoot = path.join(root, 'src/art/images') + path.sep;
  const resolved = path.resolve(abs);
  const rel = resolved.startsWith(kitRoot) ? path.relative(kitRoot, resolved).split(path.sep).join('/')
    : resolved.startsWith(srcRoot) ? `src/${path.relative(srcRoot, resolved).split(path.sep).join('/')}` : null;
  return rel === null ? null : `scenery/${mapId}/kit/${rel}`;
}

/** The city owning a composition and its master record. */
export const kitCity = (composition: string): string => composition.split(/[\\/]/)[2]!;

export function readKitArt(root: string, mapId: string, composition: string, opts: { masters?: boolean; requireScanned?: boolean; scanAll?: boolean } = {}): { art: KitArt; images: KitImage[]; notes: KitReadNotes } {
  const withMasters = opts.masters ?? true;
  const finder = withMasters ? masterFinder(root, kitCity(composition)) : null;
  const record = withMasters ? readRecord(root, kitCity(composition)) : null;
  const notes: KitReadNotes = { unmapped: [], dropped: [] };
  const file = path.join(root, composition);
  const fail = (m: string): never => { throw new Error(`Kit art ${composition} (map ${mapId}): ${m}`); };
  // Kept beside the master manifest so a kit rebuild cannot erase a reviewed source's shadow treatment.
  const shadowFile = path.join(root, 'art/tiled', kitCity(composition), 'shadow_sources.json');
  const shadowModes: Record<string, 'painted' | 'tight'> = existsSync(shadowFile) ? JSON.parse(readFileSync(shadowFile, 'utf8')) : {};
  for (const [file, mode] of Object.entries(shadowModes)) {
    if (mode !== 'painted' && mode !== 'tight') fail(`shadow_sources.json: ${file} must be painted or tight.`);
  }
  const kitRoot = path.join(root, 'art/tiled') + path.sep;
  if (!path.resolve(file).startsWith(kitRoot)) fail('it must be a file under art/tiled/.');
  let text: string;
  try { text = readFileSync(file, 'utf8'); } catch { return fail('the file is missing.'); }
  const m = JSON.parse(text) as { width: number; height: number; tilewidth: number; tileheight: number; infinite?: boolean; properties?: Array<{ name: string; value: unknown }>; tilesets: Array<{ firstgid: number; source: string }>; layers: Array<Record<string, any>> };
  if (m.tilewidth !== KIT_CELL_W || m.tileheight !== KIT_CELL_H) fail(`cells must be ${KIT_CELL_W} by ${KIT_CELL_H} pixels, not ${m.tilewidth} by ${m.tileheight}.`);
  if (m.infinite) fail('infinite maps are not supported.');
  const shadows = m.properties?.find(p => p.name === 'cast_shadows');
  if (shadows && typeof shadows.value !== 'boolean') fail('cast_shadows must be a boolean.');
  // The pictures the read keeps (a slot each): the masters of the tiles that have one that checks out, and the kit's own picture of the rest.
  const images = new Map<string, KitImage>();
  const cache = new Map<string, KitImage>();
  /** A picture's facts, under the slot its map's scenery gives it: art/tiled's by path under it, the game's own art by its path under src/art/images. */
  const image = (abs: string): KitImage => {
    const slot = kitImageSlot(root, mapId, abs);
    if (slot === null) return fail(`the image ${abs} is outside art/tiled/ and src/art/images/.`);
    const rel = slot.slice(`scenery/${mapId}/kit/`.length);
    let img = cache.get(slot);
    if (!img) {
      let bytes: Buffer;
      try { bytes = readFileSync(abs); } catch { return fail(`the image ${rel} is missing.`); }
      const size = imageSize(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
      if (!size) fail(`${rel} is not a PNG, JPEG or WebP.`);
      img = { slot, file: abs, bytes: statSync(abs).size, ...size! };
      cache.set(slot, img);
    }
    return img;
  };
  // Each tileset's firstgid and what it holds, read lazily: a sheet's cells by position, a collection's by tile id.
  const sets = m.tilesets.map((ref) => {
    const tsFile = path.join(path.dirname(file), ref.source);
    let ts: TiledTileset;
    try { ts = JSON.parse(readFileSync(tsFile, 'utf8')) as TiledTileset; } catch (e) { return fail(`the tileset ${ref.source} cannot be read (${(e as Error).message.split('\n')[0]}).`); }
    if ((ts.margin ?? 0) || (ts.spacing ?? 0)) fail(`${ref.source}: margin and spacing are not supported.`);
    if (ts.tileoffset?.x || ts.tileoffset?.y) fail(`${ref.source}: tile offsets are not supported.`);
    if (ts.objectalignment && !['unspecified', 'bottomleft'].includes(ts.objectalignment)) fail(`${ref.source}: only bottom-left object alignment is supported.`);
    return { first: ref.firstgid, ts, dir: path.dirname(tsFile), source: ref.source };
  }).sort((a, b) => b.first - a.first);
  /** A tileset's name: the file's, `ground` for ground.tsj. */
  const setName = (set: { source: string }) => path.basename(set.source).replace(/\.tsj$/, '');
  const tiles: Record<number, KitTile> = {};
  const tile = (raw: number): KitTile => {
    const gid = (raw & ~FLAGS) >>> 0;
    if (tiles[gid]) return check(raw, tiles[gid]!);
    const set = sets.find((s) => s.first <= gid);
    if (!set) return fail(`gid ${gid} is in no tileset.`);
    const i = gid - set.first;
    const { ts } = set;
    if (ts.tiles?.find(t => t.id === i)?.animation?.length) fail(`${set.source}:${i}: animated tiles are not supported.`);
    let t: KitTile;
    if (ts.image) {
      const img = image(path.join(set.dir, ts.image));
      if (img.width !== ts.imagewidth || img.height !== ts.imageheight) fail(`${set.source}: ${ts.image} is ${img.width}x${img.height}, the tileset says ${ts.imagewidth}x${ts.imageheight}.`);
      if (i >= ts.tilecount) fail(`gid ${gid} is past the end of ${set.source}.`);
      const cols = ts.columns!;
      t = { set: setName(set), id: i, file: path.relative(kitRoot, path.join(set.dir, ts.image)).split(path.sep).join('/'), slot: img.slot, sx: (i % cols) * ts.tilewidth, sy: Math.floor(i / cols) * ts.tileheight, w: ts.tilewidth, h: ts.tileheight };
    } else {
      const e = ts.tiles?.find((x) => x.id === i);
      if (!e) return fail(`gid ${gid} is not a tile of ${set.source}.`);
      const img = image(path.join(set.dir, e.image));
      if (img.width !== e.imagewidth || img.height !== e.imageheight) fail(`${set.source}: ${e.image} is ${img.width}x${img.height}, the tileset says ${e.imagewidth}x${e.imageheight}.`);
      t = { set: setName(set), id: i, file: path.relative(kitRoot, path.join(set.dir, e.image)).split(path.sep).join('/'), slot: img.slot, sx: 0, sy: 0, w: img.width, h: img.height };
    }
    if (shadowModes[t.file]) t.shadow = shadowModes[t.file];
    tiles[gid] = t;
    return check(raw, t);
  };
  /** A diagonal flip swaps width and height, which only fits a tile as wide as it is tall. */
  const check = (raw: number, t: KitTile): KitTile => {
    if ((raw & FLIP_D) !== 0 && t.w !== t.h) fail(`gid ${raw & ~FLAGS} is flipped diagonally, but its tile is ${t.w} by ${t.h}; only a square tile can be.`);
    return t;
  };
  /** A tile the composition uses: it keeps its master if the record says it checks out, and the kit's picture if not. */
  const used = new Set<KitTile>();
  const use = (t: KitTile): void => {
    if (used.has(t)) return;
    used.add(t);
    if (record && !record.tiles[tileKey(t)]) {
      t.unscanned = true;
      if (opts.requireScanned) fail(`tile ${t.set}:${t.id} (art/tiled/${t.file}) has no master scan record; run node tools/kit_masters_scan.ts`);
    }
    const m = finder && record ? recordedMaster(root, finder, record, t) : { ref: null, why: 'masters not read' };
    if (m.ref) {
      const mi = image(path.join(root, m.ref.file));
      images.set(mi.slot, mi);
      t.master = { slot: mi.slot, parts: m.ref.parts };
    } else {
      images.set(t.slot, cache.get(t.slot)!);
      if (withMasters) notes.unmapped.push({ tile: `${t.set}:${t.id} ${t.file}`, why: m.why });
    }
  };
  const layers: KitLayer[] = [];
  for (const l of m.layers) {
    // A hidden layer is left out, as Tiled leaves it out.
    if (l.visible === false) continue;
    // Round three's scale figures and the like: the game draws its own people.
    if (/^preview_people$/.test(l.name)) { notes.dropped.push(`layer ${l.name}`); continue; }
    if (l.type === 'group') fail(`layer ${l.name}: groups are not supported; flatten the visible layers.`);
    if (l.opacity !== undefined && l.opacity !== 1) fail(`layer ${l.name}: opacity is not supported.`);
    if (l.offsetx || l.offsety || l.x || l.y) fail(`layer ${l.name}: offsets are not supported.`);
    if (l.type === 'tilelayer') {
      if (!Array.isArray(l.data) || l.data.length !== m.width * m.height) fail(`layer ${l.name} is not ${m.width * m.height} cells in a plain array.`);
      const cells = (l.data as number[]).map(g => {
        if (!g) return 0;
        const t = tile(g);
        if (t.set === 'people') { notes.dropped.push(`${l.name}/people:${t.id}`); return 0; }
        if (t.w !== KIT_CELL_W || t.h !== KIT_CELL_H) fail(`${l.name}: ${t.set}:${t.id} is ${t.w}x${t.h}; place non-cell pictures as tile objects.`);
        use(t);
        return g;
      });
      layers.push({ name: l.name, kind: 'tiles', ground: /^ground/.test(l.name), cells });
    } else if (l.type === 'objectgroup') {
      const objects: KitObject[] = [];
      for (const o of l.objects as Array<Record<string, any>>) {
        // Notes and placeholders (rectangles and text, no tile) are not art.
        if (typeof o.gid !== 'number' || o.visible === false) continue;
        const t = tile(o.gid);
        if (t.set === 'people') { notes.dropped.push(`${l.name}/${String(o.name ?? '')}`); continue; }
        if (o.rotation) fail(`${l.name} object ${o.name}: rotation is not supported; use tile flip flags.`);
        // A turned object keeps the width and height it was placed with; they match its image's.
        if (o.width !== t.w || o.height !== t.h) fail(`${l.name} object ${o.name} is drawn ${o.width}x${o.height}; its image is ${t.w}x${t.h}.`);
        use(t);
        const lift = o.properties?.find((p: { name: string }) => p.name === 'shadow_lift')?.value;
        if (lift !== undefined && (typeof lift !== 'number' || !Number.isFinite(lift) || lift < 0)) fail(`${l.name} object ${o.name}: shadow_lift must be a finite nonnegative height.`);
        const foot = o.properties?.find((p: { name: string }) => p.name === 'ground_foot_height')?.value;
        if (foot !== undefined && (typeof foot !== 'number' || !Number.isFinite(foot) || foot <= 0 || foot >= o.height || (o.gid & (FLIP_V | FLIP_D))))
          fail(`${l.name} object ${o.name}: ground_foot_height must be between zero and the object height, without vertical or diagonal flips.`);
        objects.push({ id: o.id, name: String(o.name ?? ''), gid: o.gid, x: o.x, y: o.y, w: o.width, h: o.height, ...(lift ? { shadowLift: lift } : {}), ...(foot ? { groundFootHeight: foot } : {}) });
      }
      layers.push({ name: l.name, kind: 'objects', ground: false, objects });
    }
  }
  // Library scans include unused cells and pieces, excluding the scale figures.
  if (opts.scanAll) for (const set of sets) {
    if (setName(set) === 'people') continue;
    const ids = set.ts.image ? Array.from({ length: set.ts.tilecount }, (_, i) => i) : (set.ts.tiles ?? []).map(t => t.id);
    for (const id of ids) use(tile(set.first + id));
  }
  // The tiles the layers use, and no others (a figure's, dropped above, is not).
  const kept: Record<number, KitTile> = {};
  for (const [g, t] of Object.entries(tiles)) if (used.has(t)) kept[Number(g)] = t;
  return { art: { cols: m.width, rows: m.height, ...(shadows?.value ? { castShadows: true } : {}), layers, tiles: kept }, images: [...images.values()], notes };
}
