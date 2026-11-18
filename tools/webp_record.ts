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

/**
 * For the dev server: the current WebP copy of a master, or null while the master has to stand in (a copy missing, or made
 * from an older master). Development then shows what a build ships, and new art at once.
 */
export function currentCopyOf(art = readRecord()): (master: string) => string | null {
  return (master) => {
    if (!/\.(png|jpg)$/.test(master) || !master.startsWith(imagesDir + path.sep)) return null;
    const slot = path.relative(imagesDir, master).split(path.sep).join('/').replace(/\.(png|jpg)$/, '');
    const copy = path.join(imagesDir, `${slot}.webp`);
    return current(art[slot], sha1(master), copy) ? copy : null;
  };
}
