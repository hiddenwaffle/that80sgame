/**
 * Checks every file in content/ and reports mistakes with file and line.
 *
 *   npm run check
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROPS } from '../src/art/props.ts';
import { loadContent, type Content } from '../src/content/content.ts';
import type { GameMap } from '../src/content/tiled.ts';
import { BUILDING_KINDS } from '../src/world/berlin_buildings.ts';
import { ITEM_KINDS } from '../src/world/berlin_items.ts';
import { STREET_PIECES } from '../src/world/berlin_street_sketch.ts';
import { Collision, propCollisionBox } from '../src/world/collision.ts';
import { patrolLayouts } from '../src/world/patrol_walk.ts';
import { kitCity, kitMaps, readKitArt } from './kit_art.ts';
import { recordCities, staleRecords } from './kit_masters.ts';
import { kitOrphans, kitStale, orphans, stale } from './webp_record.ts';
import { isMain } from './is_main.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The game's own source, where it sets flags in code. */
export function gameSources(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name.endsWith('.ts') && !full.includes(`${path.sep}dev${path.sep}`)) out.push(readFileSync(full, 'utf8'));
    }
  };
  walk(path.join(root, 'src'));
  return out;
}

export function readContentFiles(): Map<string, string> {
  const files = new Map<string, string>();
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(txt|yaml|tmj|tsj)$/.test(name)) files.set(path.relative(root, full).split(path.sep).join('/'), readFileSync(full, 'utf8'));
    }
  };
  walk(path.join(root, 'content'));
  return files;
}

/**
 * Each map's patrol walks, built as the world builds them: a Tiled edit that blocks a row of a patrolled alley made
 * patrolLayouts throw inside the world's constructor, so the map could not be entered (Fable review C2, 2026-11-09).
 */
export function patrolErrors(maps: ReadonlyMap<string, GameMap>): Array<{ file: string; line: number; message: string }> {
  const errors: Array<{ file: string; line: number; message: string }> = [];
  for (const [mapId, map] of maps) {
    if (!map.objects.some((o) => o.type === 'enemy' && o.props.behavior === 'pursue')) continue;
    const collision = new Collision(map);
    for (const o of map.objects) if (o.type === 'prop' && o.props.solid && !o.props.appears && PROPS[String(o.props.kind)])
      collision.boxes.push(propCollisionBox(o, PROPS[String(o.props.kind)]!.foot));
    try { patrolLayouts(map.objects, collision); }
    catch (e) { errors.push({ file: `content/maps/${mapId}.tmj`, line: 0, message: `its patrols cannot walk their alleys: ${(e as Error).message}` }); }
  }
  return errors;
}

/**
 * Every flag a `requires`, `appears`, `gone_when`, a headline, a chapter or a `[run scene requires]` names must be one the
 * game can set: by a [flag x] in the script, an encounter's, item's or special's `flag`, a getaway quip, the game's own
 * code (`flags.x =`), or one of its made-up names (entered:<map>, seen:<trigger>, field_entry_*). A misspelt one is false
 * for ever, so whatever waits for it never appears (Fable review C1, 2026-11-09).
 */
export function flagErrors(content: Content, sources: readonly string[]): Array<{ file: string; line: number; message: string }> {
  const errors: Array<{ file: string; line: number; message: string }> = [];
  const set = new Set<string>();
  for (const scene of content.scenes.values()) for (const step of scene.steps)
    if (step.kind === 'command' && step.name === 'flag' && step.args[1] !== 'off') set.add(step.args[0]!);
  for (const record of [content.encounters, content.items, content.specials] as Array<Record<string, { flag?: string }>>)
    for (const r of Object.values(record)) if (r.flag) set.add(r.flag);
  for (const sp of Object.values(content.specials)) for (const quip of Object.values(sp.escape?.quips ?? {})) set.add(quip);
  for (const text of sources) for (const m of text.matchAll(/flags(?:\.([A-Za-z_]\w*)|\[['"]([^'"$]+)['"]\])\s*=(?!=)/g)) set.add(m[1] ?? m[2]!);
  const known = (flag: string) => set.has(flag) || /^seen:/.test(flag) || /^field_entry_(movable|first)_\d+$/.test(flag) ||
    (flag.startsWith('entered:') && content.maps.has(flag.slice(8))) || flag.startsWith('taken:');
  const check = (requires: unknown, file: string, line: number, what: string) => {
    for (const part of String(requires ?? '').split(',')) {
      const flag = part.trim().replace(/^!/, '');
      if (flag && !known(flag)) errors.push({ file, line, message: `${what}: nothing ever sets the flag "${flag}" (misspelt?), so it is false for ever.` });
    }
  };
  for (const ch of content.frame.chapters) check(ch.requires, 'content/data/frame.yaml', 0, `chapter ${ch.id}`);
  for (const scene of content.scenes.values()) for (const step of scene.steps)
    if (step.kind === 'command' && step.name === 'run' && step.args[1]) check(step.args[1], step.file, step.line, `[run ${step.args[0]}]`);
  for (const [mapId, map] of content.maps) for (const o of map.objects) for (const key of ['requires', 'appears', 'gone_when'] as const)
    if (o.props[key] !== undefined) check(o.props[key], `content/maps/${mapId}.tmj`, 0, `object "${o.name || '(unnamed)'}" (id ${o.id}) ${key}`);
  return errors;
}

/**
 * Berlin's placeholder pieces must name something their drawing knows: a mistyped building or item drew nothing, a street
 * piece threw, and a Wall top with no section width looped for ever (Fable review C4, 2026-11-09).
 */
export function pieceErrors(maps: ReadonlyMap<string, GameMap>): Array<{ file: string; line: number; message: string }> {
  const errors: Array<{ file: string; line: number; message: string }> = [];
  const shapes = ['wall_mass', 'wall_cast', 'wall_top', 'wall_break', 'torn_ground', 'building', 'item', 'street_piece'];
  for (const [mapId, map] of maps) for (const o of map.objects) {
    if (o.type !== 'placeholder') continue;
    const p = o.props, where = `content/maps/${mapId}.tmj`, what = `placeholder "${o.name || '(unnamed)'}" (id ${o.id})`;
    const kinds = p.shape === 'building' ? BUILDING_KINDS : p.shape === 'item' ? ITEM_KINDS : p.shape === 'street_piece' ? STREET_PIECES : null;
    if (p.shape !== undefined && !shapes.includes(String(p.shape)) && typeof p.picture !== 'string')
      errors.push({ file: where, line: 0, message: `${what}: no shape "${p.shape}". Shapes: ${shapes.join(', ')}.` });
    if (kinds && !kinds.includes(String(p.piece))) errors.push({ file: where, line: 0, message: `${what}: no ${p.shape} piece "${p.piece}". Pieces: ${kinds.join(', ')}.` });
    if (p.shape === 'wall_top' && !(Number(p.section) > 0)) errors.push({ file: where, line: 0, message: `${what}: a wall_top needs a section width above 0, not "${p.section}".` });
  }
  return errors;
}

if (isMain(import.meta.url)) {
  const files = readContentFiles();
  const { content, errors } = loadContent(files);
  // The art's WebP copies, which the game loads, must match their masters (tools/webp_record.ts).
  for (const m of stale()) errors.push({ file: path.relative(root, m.file), line: 0, message: 'its WebP copy is missing, older than it, or not the one made from it; run node tools/art_webp.ts' });
  for (const slot of orphans()) errors.push({ file: `src/art/images/${slot}.webp`, line: 0, message: 'has no master beside it; run node tools/art_webp.ts' });
  // A map drawn from a kit composition (`kit_art`, tools/kit_art.ts): the composition must read, with its tilesets and images, be as many cells as the map
  // has tiles, and have a WebP copy of each image (made by tools/art_webp.ts) that is current.
  for (const [mapId, composition] of kitMaps(root)) {
    const map = content?.maps.get(mapId);
    try {
      const { art } = readKitArt(root, mapId, composition, { requireScanned: true });
      if (map && (art.cols !== map.width || art.rows !== map.height)) errors.push({ file: `content/maps/${mapId}.tmj`, line: 0, message: `is ${map.width} by ${map.height} tiles, but its kit art ${composition} is ${art.cols} by ${art.rows} cells` });
    } catch (e) {
      errors.push({ file: `content/maps/${mapId}.tmj`, line: 0, message: (e as Error).message });
    }
  }
  // The record of which masters the kit's tiles were made from (tools/kit_masters_scan.ts) must be of the pictures as they are. Every city that
  // has a record is audited, not only those a map is drawn from: Berlin's library is kept (and tested) with no map drawn from its kit.
  for (const { city, file } of staleRecords(root, [...kitMaps(root).map(([, composition]) => kitCity(composition)), ...recordCities(root)]))
    errors.push({ file, line: 0, message: `has changed since art/tiled/${city}/kit_masters.json was made; run node tools/kit_masters_scan.ts --city=${city}` });
  for (const m of kitStale()) errors.push({ file: path.relative(root, m.file), line: 0, message: 'its WebP copy (art/tiled/webp) is missing, older than it, or not the one made from it; run node tools/art_webp.ts' });
  for (const slot of kitOrphans()) errors.push({ file: `art/tiled/webp/${slot}.webp`, line: 0, message: 'is no composition image any more; run node tools/art_webp.ts' });
  if (content) errors.push(...patrolErrors(content.maps), ...flagErrors(content, gameSources()), ...pieceErrors(content.maps));
  for (const e of errors) console.log(`${e.file}${e.line ? `:${e.line}` : ''}  ${e.message}`);
  if (content) {
    console.log(`${content.scenes.size} scenes, ${content.maps.size} maps, ${Object.keys(content.characters).length} speakers, ${Object.keys(content.enemies).length} enemy kinds.`);
  }
  if (errors.length) {
    console.log(`${errors.length} problem${errors.length === 1 ? '' : 's'} found.`);
    process.exit(1);
  }
  console.log('Content OK, and every WebP copy of the art is up to date.');
}
