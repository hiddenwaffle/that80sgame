/** Build-time content selection. Development keeps every map; shipping follows links before assets are imported. */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { loadContent, type Content, type LoadResult } from '../src/content/content.ts';
import { packContent, unpackContent, type PackedContent } from '../src/content/packed.ts';
import type { ContentError } from '../src/content/screenplay.ts';

/** Save codes contain a map name, not a fixed destination index. Preserve these released destinations even if a route moves. */
export const SAVE_COMPATIBLE_MAPS = ['house', 'town', 'maze', 'border', 'field', 'berlin'] as const;
export const INCLUDE_DEV_MAPS = 'THAT80SGAME_INCLUDE_DEV_MAPS';

export function readBuildFiles(root: string): Map<string, string> {
  const files = new Map<string, string>();
  const walk = (dir: string) => {
    for (const e of readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const file = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(file);
      else if (/\.(txt|yaml|tmj|tsj)$/.test(e.name)) files.set(file, readFileSync(path.join(root, file), 'utf8'));
    }
  };
  walk('content');
  return files;
}

/** All scripts remain available, so every warp is a root, including conditional and currently uncalled scenes. */
export function reachableMaps(c: Content): Set<string> {
  const keep = new Set<string>([c.party.start.map, ...SAVE_COMPATIBLE_MAPS.filter(id => c.maps.has(id)), ...c.frame.chapters.map(ch => ch.map)]);
  for (const scene of c.scenes.values()) for (const step of scene.steps)
    if (step.kind === 'command' && step.name === 'warp' && step.args[0]) keep.add(step.args[0]);
  const queue = [...keep];
  for (let i = 0; i < queue.length; i++) {
    const map = c.maps.get(queue[i]!);
    if (!map) throw new Error(`Production map reference has no map "${queue[i]}".`);
    for (const o of map.objects) {
      const to = o.props.to;
      if (o.type === 'exit' && typeof to === 'string' && !keep.has(to)) { keep.add(to); queue.push(to); }
    }
  }
  return keep;
}

export interface BuildContent { files: Map<string, string>; maps: Set<string> }
export function selectBuildContent(files: Map<string, string>, includeAll: boolean): BuildContent {
  if (includeAll) return { files, maps: new Set([...files.keys()].filter(f => /^content\/maps\/.*\.tmj$/.test(f)).map(f => path.basename(f, '.tmj'))) };
  const result = loadContent(files);
  if (!result.content || result.errors.length) throw new Error(result.errors.map(e => `${e.file}:${e.line}: ${e.message}`).join('\n'));
  const maps = reachableMaps(result.content);
  const selected = new Map([...files].filter(([file]) => !/^content\/maps\/.*\.tmj$/.test(file) || maps.has(path.basename(file, '.tmj'))));
  // A retained scene may reference an object in an otherwise unlinked map. Report that conflict, never ship broken content.
  const checked = loadContent(selected);
  if (checked.errors.length) throw new Error('Pruned production content is invalid:\n' + checked.errors.map(e => `${e.file}:${e.line}: ${e.message}`).join('\n'));
  return { files: selected, maps };
}

/**
 * What the game is given (src/content/bundle.ts): the content packed for it (src/content/packed.ts), and the problems found,
 * which the dev server's page shows. Anything the trip through JSON would change, such as an Infinity, a -0 or an object reached
 * from two places, is one more problem, so the game never runs on content other than what was checked.
 */
export function contentForGame(result: LoadResult): { content: PackedContent | null; errors: ContentError[] } {
  if (!result.content) return { content: null, errors: result.errors };
  const content = packContent(result.content);
  const back = unpackContent(JSON.parse(JSON.stringify(content)) as PackedContent);
  const lost = differences(result.content, back).map(message => ({ file: 'content', line: 0, message: `${message}, on its way to the game as JSON (src/content/packed.ts).` }));
  return { content, errors: [...result.errors, ...lost] };
}

/** Where `b` differs from `a`, by path: values by Object.is, own keys and their order, prototypes, and each object of `a` reached once. */
export function differences(a: unknown, b: unknown, at = '(top)', seen = new Map<object, string>(), out: string[] = []): string[] {
  if (out.length >= 10) return out;
  if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null) {
    const show = (v: unknown) => Object.is(v, -0) ? '-0' : String(v);
    if (!Object.is(a, b)) out.push(`${at}: ${show(a)} arrives as ${show(b)}`);
    return out;
  }
  const before = seen.get(a);
  if (before !== undefined) {
    out.push(`${at}: the same object as ${before}, which arrives as a copy`);
    return out;
  }
  seen.set(a, at);
  const child = (k: string) => at === '(top)' ? k : `${at}.${k}`;
  const keys = (ks: unknown[]) => ks.length > 12 ? `${ks.length} keys` : ks.map(String).join(', ');
  if (Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) {
    out.push(`${at}: ${a.constructor?.name ?? 'an object with no prototype'} arrives as ${b.constructor?.name ?? 'an object with no prototype'}`);
    return out;
  }
  if (a instanceof Map) {
    const ea = [...a], eb = [...(b as Map<unknown, unknown>)];
    if (ea.length !== eb.length || ea.some(([k], i) => !Object.is(k, eb[i]![0]))) out.push(`${at}: the keys ${keys(ea.map(e => e[0]))} arrive as ${keys(eb.map(e => e[0]))}`);
    else ea.forEach(([k, v], i) => differences(v, eb[i]![1], child(String(k)), seen, out));
    return out;
  }
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length || ka.some((k, i) => k !== kb[i])) out.push(`${at}: the keys ${keys(ka)} arrive as ${keys(kb)}`);
  else for (const k of ka) differences((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], child(k), seen, out);
  return out;
}

/** Shared looks/props/pictures stay shared; map-specific scenery follows its owning map. */
export function keepScenery(file: string, maps: ReadonlySet<string>): boolean {
  const map = /^scenery\/([^/]+)\//.exec(file)?.[1];
  return map === undefined || maps.has(map);
}
