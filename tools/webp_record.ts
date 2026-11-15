/**
 * The record of which original each art image's WebP copy was made from. The PNGs and JPEGs under
 * src/art/images are the masters, which the art tools write and people look at; the game loads the WebP
 * beside each one, about a fifth of the size. `src/art/images/webp.json` keeps, for each slot, a hash of
 * the master its WebP was made from and of the WebP made, so a master changed since, or a WebP replaced by
 * another, is caught (`npm run check`) and remade (`node tools/art_webp.ts`). Folders are read at any depth,
 * as the game's loader reads them. Plain file reading only: no browser, no network.
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, type Dirent } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { kitMaps, readKitArt } from './kit_art.ts';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const imagesDir = path.join(root, 'src', 'art', 'images');
export const recordFile = path.join(imagesDir, 'webp.json');

export interface Master {
  /** The slot, such as `looks/olli_side`. */
  slot: string;
  /** The master's path. */
  file: string;
  /** Its hash, to tell whether its WebP was made from it. */
  hash: string;
}

const sha1 = (file: string) => createHash('sha1').update(readFileSync(file)).digest('hex');

/** Every file under src/art/images at any depth, as slot-style paths (`looks/olli_side.png`). */
function filesUnder(dir = imagesDir, prefix = ''): string[] {
  const out: string[] = [];
  for (const d of readdirSync(dir, { withFileTypes: true }) as Dirent[]) {
    if (d.isDirectory()) out.push(...filesUnder(path.join(dir, d.name), `${prefix}${d.name}/`));
    else out.push(`${prefix}${d.name}`);
  }
  return out.sort();
}

/** Every master image: each PNG or JPEG under src/art/images. */
export function masters(): Master[] {
  return filesUnder()
    .filter((f) => /\.(png|jpg)$/.test(f))
    .map((f) => {
      const file = path.join(imagesDir, f);
      return { slot: f.replace(/\.(png|jpg)$/, ''), file, hash: sha1(file) };
    });
}

/** For each slot, the master its WebP was made from and the WebP made, by hash. */
export type WebpRecord = Record<string, { from: string; webp: string }>;

export function readRecord(): WebpRecord {
  return existsSync(recordFile) ? (JSON.parse(readFileSync(recordFile, 'utf8')) as WebpRecord) : {};
}

export const webpOf = (m: Master) => path.join(imagesDir, `${m.slot}.webp`);

/** Whether a copy is current: there, made from the master as it is now, and the copy that was made. */
const current = (r: WebpRecord[string] | undefined, hash: string, copy: string) => !!r && r.from === hash && existsSync(copy) && sha1(copy) === r.webp;

/** The masters whose WebP is missing, was made from an older version of them, or is not the WebP made. */
export function stale(): Master[] {
  const rec = readRecord();
  return masters().filter((m) => !current(rec[m.slot], m.hash, webpOf(m)));
}

/** WebP files left with no master beside them (a master renamed or removed). */
export function orphans(): string[] {
  const have = new Set(masters().map((m) => m.slot));
  return filesUnder()
    .filter((f) => f.endsWith('.webp'))
    .map((f) => f.replace(/\.webp$/, ''))
    .filter((slot) => !have.has(slot));
}

export { sha1 };

// ---------------------------------------------------------------------------------------------------------------
// The images the maps' kit compositions draw from (`kit_art`, tools/kit_art.ts) ship the same way. The masters stay where the
// kit keeps them under art/tiled; their WebP copies, which a build imports, go in art/tiled/webp at the same paths, so the kit's own
// folders hold nothing the Tiled tools would take for a tile. Only the images a map's composition uses have a copy.

export const kitDir = path.join(root, 'art', 'tiled');
export const kitWebpDir = path.join(kitDir, 'webp');
export const kitRecordFile = path.join(kitWebpDir, 'webp.json');

/** A kit image: its slot-style path under art/tiled without the extension (`beijing/images/ground/ground`), its master, and its hash. */
export interface KitMaster {
  slot: string;
  file: string;
  hash: string;
}

/** The images the compositions named by maps use, each once. */
export function kitMasters(maps?: ReadonlySet<string>): KitMaster[] {
  const files = new Map<string, KitMaster>();
  for (const [mapId, composition] of kitMaps(root)) {
    if (maps && !maps.has(mapId)) continue;
    for (const img of readKitArt(root, mapId, composition).images) {
      // The game's own art (src/art/images) has its WebP copies beside it, kept by the art's record.
      if (files.has(img.file) || !img.file.startsWith(kitDir + path.sep)) continue;
      const rel = path.relative(kitDir, img.file).split(path.sep).join('/');
      files.set(img.file, { slot: rel.replace(/\.(png|jpg)$/, ''), file: img.file, hash: sha1(img.file) });
    }
  }
  return [...files.values()].sort((a, b) => a.slot.localeCompare(b.slot));
}

export function readKitRecord(): WebpRecord {
  return existsSync(kitRecordFile) ? (JSON.parse(readFileSync(kitRecordFile, 'utf8')) as WebpRecord) : {};
}

export const kitWebpOf = (m: KitMaster) => path.join(kitWebpDir, `${m.slot}.webp`);

/** The kit masters whose WebP is missing, was made from an older version of them, or is not the WebP made. */
export function kitStale(maps?: ReadonlySet<string>): KitMaster[] {
  const rec = readKitRecord();
  return kitMasters(maps).filter((m) => !current(rec[m.slot], m.hash, kitWebpOf(m)));
}

/**
 * For the dev server: the current WebP copy of a master, art or kit, or null while the master has to stand in (a copy
 * missing, or made from an older master). Development then shows what a build ships, and new art at once.
 */
export function currentCopyOf(art = readRecord(), kit = readKitRecord()): (master: string) => string | null {
  const slotUnder = (dir: string, master: string) => path.relative(dir, master).split(path.sep).join('/').replace(/\.(png|jpg)$/, '');
  return (master) => {
    if (!/\.(png|jpg)$/.test(master)) return null;
    // The kit's copies sit in art/tiled/webp; the game's own art keeps each beside its master.
    const kitSlot = master.startsWith(kitDir + path.sep) ? slotUnder(kitDir, master) : null;
    const artSlot = master.startsWith(imagesDir + path.sep) ? slotUnder(imagesDir, master) : null;
    const copy = kitSlot !== null ? path.join(kitWebpDir, `${kitSlot}.webp`) : artSlot !== null ? path.join(imagesDir, `${artSlot}.webp`) : null;
    const r = kitSlot !== null ? kit[kitSlot] : artSlot !== null ? art[artSlot] : undefined;
    return copy && current(r, sha1(master), copy) ? copy : null;
  };
}

/** Kit WebP files no composition's image needs any more (the slot paths, without the extension). */
export function kitOrphans(): string[] {
  if (!existsSync(kitWebpDir)) return [];
  const want = new Set(kitMasters().map((m) => m.slot));
  const out: string[] = [];
  const walk = (dir: string, prefix: string) => {
    for (const d of readdirSync(dir, { withFileTypes: true }) as Dirent[]) {
      if (d.isDirectory()) walk(path.join(dir, d.name), `${prefix}${d.name}/`);
      else if (d.name.endsWith('.webp') && !want.has(`${prefix}${d.name.replace(/\.webp$/, '')}`)) out.push(`${prefix}${d.name.replace(/\.webp$/, '')}`);
    }
  };
  walk(kitWebpDir, '');
  return out.sort();
}
