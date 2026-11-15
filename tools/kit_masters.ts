/**
 * The masters behind a kit tile. The kit's pictures are quarter-size (a 40 by 32 cell for a master's 160 by 128), made from
 * the art packs' masters by tools/tiled_kit; the game draws from the masters where it can, so a kit pixel is never stretched
 * to several screen pixels. This finds, for a tile of a composition, the part of which master it was made from, by how
 * the kit made it (the tools' own rules), and `agrees` checks that the master really shrinks to the tile.
 *
 * A tile with no master (the old entrance's art pass, which the kit took from a past commit; flat colour swatches; a master that has
 * changed since the kit was made) has none, and keeps its kit picture; `unmapped` lists what had none and why.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { KitTile } from './kit_art.ts';
import { imageSize } from './image_size.ts';
import { createHash } from 'node:crypto';

/** One checked-in Berlin source picture (art/tiled/berlin/master_sources.json): where it is and the size it is placed at. */
export interface BerlinSource { file: string; w: number; h: number; commit?: string; original?: string }
export interface BerlinSources {
  pieces: Record<string, BerlinSource>;
  ground: Record<string, Array<BerlinSource & { x: number; y: number }>>;
}

/** Part of a master picture (in its pixels) and where it goes in a tile (in the tile's own pixels). */
export interface MasterPart {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  dx: number;
  dy: number;
  dw: number;
  dh: number;
}

/**
 * A master's picture (a path under the project) and what of it a kit tile shows. Usually one part. A picture's tile is padded with clear rows
 * above it to its tileset's height, so its part sits at the bottom; a cell of repeating ground that crosses the edge of a repeat has a part each side.
 */
export interface MasterRef {
  file: string;
  parts: MasterPart[];
}

const COLS = 30, TW = 40, TH = 32, CELL_W = 160, CELL_H = 128, ROOF_COLS = 16;
/** tools/tiled_kit/beijing.ts: the field's own materials laid in the grid sheet's first rows, [name, column, row, tiles, repeat]. */
const MATERIALS: Array<[string, number, number, number, number]> = [['grass', 0, 0, 4, 1], ['paving', 4, 0, 5, 1], ['paving', 9, 0, 5, 2], ['roof', 14, 0, 5, 2], ['wall', 19, 0, 2, 1]];

interface PackGround { name: string; file: string; tiles: [number, number] }

/** A master part that is the whole tile (a cell of the sheets). */
const whole = (r: { file: string } & Pick<MasterPart, 'sx' | 'sy' | 'sw' | 'sh'>, tile: KitTile): MasterRef => ({ file: r.file, parts: [{ sx: r.sx, sy: r.sy, sw: r.sw, sh: r.sh, dx: 0, dy: 0, dw: tile.w, dh: tile.h }] });

export interface Finder {
  find(tile: KitTile): { ref: MasterRef | null; why: string };
}

/** The finder for a project, with a separate registration for each city's kit. */
export function masterFinder(root: string, city = 'beijing'): Finder {
  const kits = path.join(root, 'art/tiled');
  let idsRead: { ground: Array<{ name: string; row: number; rows: number }> } | null = null;
  const ids = (): NonNullable<typeof idsRead> => idsRead ??= JSON.parse(readFileSync(path.join(kits, city, 'kit_ids.json'), 'utf8'));
  const read = (f: string) => JSON.parse(readFileSync(path.join(root, f), 'utf8'));
  const sizes = new Map<string, { width: number; height: number }>();
  const size = (f: string) => {
    if (!sizes.has(f)) sizes.set(f, imageSize(new Uint8Array(readFileSync(path.join(root, f)))) ?? { width: 0, height: 0 });
    return sizes.get(f)!;
  };
  let berlinRead: BerlinSources | null = null;
  const berlin = (): BerlinSources => berlinRead ??= read('art/tiled/berlin/master_sources.json');
  const packs = path.join('art/tiled/packs', city);

  // A pack's ground blocks as the kit laid them in its part of the grid sheet (tools/tiled_kit/kit.ts packGround).
  const blocksOf = new Map<string, Array<{ x: number; y: number; w: number; h: number; file: string }>>();
  const blocks = (pack: string) => {
    let out = blocksOf.get(pack);
    if (out) return out;
    out = [];
    const dir = path.join(packs, pack);
    const list: PackGround[] = existsSync(path.join(root, dir, 'pack.json')) ? read(path.join(dir, 'pack.json')).ground ?? [] : [];
    let x = 0, y = 0, shelf = 0;
    for (const g of list) {
      const [tw, th] = g.tiles, file = path.join(dir, g.file), s = size(file);
      if (s.width !== tw * TW * 4 || s.height !== th * TH * 4) continue;
      if (x && x + tw > COLS) { x = 0; y += shelf + 1; shelf = 0; }
      out.push({ x, y, w: tw, h: th, file });
      x += tw + 1;
      shelf = Math.max(shelf, th);
    }
    blocksOf.set(pack, out);
    return out;
  };

  const roofMap = (() => {
    const f = path.join(packs, 'beijing_roofs/tile_map.json');
    const m = new Map<number, number>();
    if (existsSync(path.join(root, f))) for (const t of read(f).tiles as Array<{ id: number; master_id: number }>) m.set(t.id, t.master_id);
    return m;
  })();
  const roofMaster = path.join(packs, 'beijing_roofs/masters/roof_grid.png');

  // The game's own pictures first; then the Beijing kit's own sources (art/tiled/kit_sources/beijing: masters the kit uses that the game no longer loads).
  const field = (name: string) => [`src/art/images/scenery/field/props/${name}.png`, `src/art/images/props/${name}.png`, `src/art/images/look/square/props/${name}.png`, `art/tiled/kit_sources/beijing/props/${name}.png`].find((f) => existsSync(path.join(root, f)));

  return {
    find(tile: KitTile) {
      const none = (why: string) => ({ ref: null, why });
      if (tile.set === 'ground') {
        const col = tile.id % COLS, row = Math.floor(tile.id / COLS);
        const part = ids().ground.find((p) => p.row <= row && row < p.row + p.rows);
        if (!part) return none('ground cell in no part of the sheet');
        const cx = col, cy = row - part.row;
        if (city === 'berlin' && part.name === 'ground_master') {
          // The sheet holds four source materials plus thirteen code-drawn swatches (the script that placed them, tools/tiled_kit/berlin.ts, is in git history).
          const materials: Array<[string, number, number, number, number]> = [
            ['pavement', 0, 0, 2, 2], ['roof', 2, 0, 2, 2], ['wall', 0, 2, 6, 2], ['fence', 0, 4, 7, 1],
          ];
          for (const [name, x, y, w, h] of materials) if (cx >= x && cx < x + w && cy >= y && cy < y + h) {
            const file = `art/tiled/berlin/masters/old_game/terrain/${name}.png`, s = size(file);
            return { ref: whole({ file, sx: (cx - x) * s.width / w, sy: (cy - y) * s.height / h, sw: s.width / w, sh: s.height / h }, tile), why: '' };
          }
          return none('code-drawn swatch or unused transparent ground cell; no source picture');
        }
        if (city === 'berlin' && (part.name === 'ground_art_pass' || part.name === 'ground_passages')) {
          const x = cx * TW, y = cy * TH;
          // South was composited after north. Their join is exactly row 17, so no cell needs two sources.
          const b = [...berlin().ground[part.name]!].reverse().find(b => x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h);
          if (!b) return none('unused transparent cell outside the historical ground paintings');
          const s = size(b.file), w = Math.min(TW, b.x + b.w - x), h = Math.min(TH, b.y + b.h - y);
          return { ref: { file: b.file, parts: [{ sx: (x - b.x) * s.width / b.w, sy: (y - b.y) * s.height / b.h, sw: w * s.width / b.w, sh: h * s.height / b.h, dx: 0, dy: 0, dw: w, dh: h }] }, why: '' };
        }
        if (part.name.startsWith('pack:')) {
          const b = blocks(part.name.slice(5)).find((q) => q.x <= cx && cx < q.x + q.w && q.y <= cy && cy < q.y + q.h);
          if (!b) return none(`${part.name}: a cell no ground block covers`);
          return { ref: whole({ file: b.file, sx: (cx - b.x) * CELL_W, sy: (cy - b.y) * CELL_H, sw: CELL_W, sh: CELL_H }, tile), why: '' };
        }
        if (part.name === 'ground_current') {
          for (const [name, c, r, tiles, repeat] of MATERIALS) {
            if (cx < c || cx >= c + tiles || cy < r || cy >= r + tiles) continue;
            const file = [`src/art/images/scenery/field/terrain/${name}.png`, `art/tiled/kit_sources/beijing/terrain/${name}.png`].find((f) => existsSync(path.join(root, f)));
            if (!file) return none(`the field terrain picture ${name}.png is missing (looked in src/art/images/scenery/field/terrain and art/tiled/kit_sources/beijing/terrain)`);
            const m = size(file);
            // The picture was shrunk to side by high kit pixels, and laid `repeat` times each way from the material's corner. A cell across the edge
            // of a repeat takes a part from each side of it.
            const sideX = Math.round((tiles * TW) / repeat), sideY = Math.round((tiles * TH) / repeat);
            const x0 = (cx - c) * TW, y0 = (cy - r) * TH;
            const cuts = (from: number, len: number, side: number) => {
              const out: Array<{ at: number; len: number; src: number }> = [];
              for (let p = from; p < from + len; ) { const next = Math.min(from + len, (Math.floor(p / side) + 1) * side); out.push({ at: p - from, len: next - p, src: p % side }); p = next; }
              return out;
            };
            const parts: MasterPart[] = [];
            for (const xs of cuts(x0, TW, sideX)) for (const ys of cuts(y0, TH, sideY)) {
              parts.push({ sx: (xs.src / sideX) * m.width, sy: (ys.src / sideY) * m.height, sw: (xs.len / sideX) * m.width, sh: (ys.len / sideY) * m.height, dx: xs.at, dy: ys.at, dw: xs.len, dh: ys.len });
            }
            return { ref: { file, parts }, why: '' };
          }
          return none('a flat colour swatch (no picture)');
        }
        return none(`${part.name}: the old entrance's painting, taken from a past commit`);
      }
      if (tile.set === 'roofs') {
        const mid = roofMap.get(tile.id);
        if (mid === undefined) return none('a roof tile the pack lists no master for');
        return { ref: whole({ file: roofMaster, sx: (mid % ROOF_COLS) * CELL_W, sy: Math.floor(mid / ROOF_COLS) * CELL_H, sw: CELL_W, sh: CELL_H }, tile), why: '' };
      }
      // A picture: images/<source>/<name>.png, a pack's piece or the field's own.
      const m = /^([^/]+)\/images\/([^/]+)\/([^/]+)\.png$/.exec(tile.file);
      if (!m) return none(`a picture outside the kit's usual places: ${tile.file}`);
      const [, tileCity, source, name] = m as unknown as [string, string, string, string];
      if (tileCity !== city) return none(`a ${tileCity} tile in the ${city} kit`);
      let file: string | undefined;
      if (city === 'berlin') {
        const b = berlin().pieces[`${source}/${name}`];
        if (b) {
          if (!existsSync(path.join(root, b.file))) return none(`registered source is missing: ${b.file}`);
          if (b.w !== tile.w || b.h > tile.h) return none('registered source dimensions do not fit the padded tile');
          const s = size(b.file);
          return { ref: { file: b.file, parts: [{ sx: 0, sy: 0, sw: s.width, sh: s.height, dx: 0, dy: tile.h - b.h, dw: b.w, dh: b.h }] }, why: '' };
        }
      }
      if (source === 'current') file = field(name);
      else if (source === 'art_pass' || source === 'art_pass_tall') return none("the old entrance's art pass, taken from a past commit");
      else if (source === 'people') return none('a figure, which the game draws itself');
      else file = [path.join(packs, source, 'pieces', `${name}.png`)].find((f) => existsSync(path.join(root, f)));
      if (!file) return none(`no master named ${name} for ${source}`);
      const s = size(file);
      // Shrunk to the tile's width, whatever the height, and set at the bottom of the tile.
      const dh = Math.min(tile.h, Math.max(1, Math.round(city === 'berlin' ? s.height * 1.25 / 3 : (tile.w * s.height) / s.width)));
      return { ref: { file, parts: [{ sx: 0, sy: 0, sw: s.width, sh: s.height, dx: 0, dy: tile.h - dh, dw: tile.w, dh }] }, why: '' };
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// The record. Whether a master really is what a tile was made from is checked once, with ImageMagick, by
// `node tools/kit_masters_scan.ts` (a master shrunk to the tile must be within RMSE_LIMIT of it); the record of the answers, with a
// hash of every picture it looked at, is `art/tiled/<city>/kit_masters.json`. A build or the game reads the record, not the pictures.

/** The most the shrunk master may differ from the kit's tile: root mean square error, as a share of the full range. */
export const RMSE_LIMIT = 0.1;

export interface MastersRecord {
  hashes: Record<string, string>;
  tiles: Record<string, { ok: boolean; rmse?: number; why?: string; /** Set when the kit trimmed the master's clear margins: the part of the master that shows. */ part?: Pick<MasterPart, 'sx' | 'sy' | 'sw' | 'sh'> }>;
}

/** What names a tile in the record: a sheet's cell by its number, a picture by its file. */
export const tileKey = (t: KitTile): string => (t.set === 'ground' || t.set === 'roofs' ? `${t.set}:${t.id}` : t.file);

export const recordFile = (root: string, city = 'beijing') => path.join(root, 'art/tiled', city, 'kit_masters.json');
export const sha1 = (file: string) => createHash('sha1').update(readFileSync(file)).digest('hex');

export function readRecord(root: string, city = 'beijing'): MastersRecord {
  const f = recordFile(root, city);
  return existsSync(f) ? (JSON.parse(readFileSync(f, 'utf8')) as MastersRecord) : { hashes: {}, tiles: {} };
}

/** The pictures the record looked at that are missing, or are not as they were: the record is out of date until the scan is run again. */
export function staleRecord(root: string, city = 'beijing'): string[] {
  const rec = readRecord(root, city);
  return Object.entries(rec.hashes).filter(([f, h]) => !existsSync(path.join(root, f)) || sha1(path.join(root, f)) !== h).map(([f]) => f);
}

/** Every city that has a master record (art/tiled/<city>/kit_masters.json), whether or not any map is drawn from its kit. */
export function recordCities(root: string): string[] {
  const tiled = path.join(root, 'art/tiled');
  if (!existsSync(tiled)) return [];
  return readdirSync(tiled, { withFileTypes: true }).filter(d => d.isDirectory() && existsSync(path.join(tiled, d.name, 'kit_masters.json'))).map(d => d.name).sort();
}

/** The pictures any city's record has gone stale on, for the given cities (default: every city with a record). */
export function staleRecords(root: string, cities: Iterable<string> = recordCities(root)): Array<{ city: string; file: string }> {
  return [...new Set(cities)].flatMap(city => staleRecord(root, city).map(file => ({ city, file })));
}

/** The master a tile was made from, if the record says it was (and when it was looked at), else null with why not. */
export function recordedMaster(root: string, find: Finder, rec: MastersRecord, tile: KitTile): { ref: MasterRef | null; why: string } {
  const r = rec.tiles[tileKey(tile)];
  if (!r) return { ref: null, why: 'not checked yet: run node tools/kit_masters_scan.ts' };
  if (!r.ok) return { ref: null, why: r.why ?? 'its master is not what it was made from' };
  const f = find.find(tile);
  if (!f.ref) return { ref: null, why: f.why };
  // The kit trimmed this picture's clear margins: the part of the master that shows fills the whole tile.
  if (r.part) return { ref: { file: f.ref.file, parts: [{ ...r.part, dx: 0, dy: 0, dw: tile.w, dh: tile.h }] }, why: '' };
  return f;
}
