/** Build-time content selection. Development keeps every map; shipping follows links before assets are imported. */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { loadContent, type Content } from '../src/content/content.ts';

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

/** Shared looks/props/pictures stay shared; map-specific scenery follows its owning map. */
export function keepScenery(file: string, maps: ReadonlySet<string>): boolean {
  const map = /^scenery\/([^/]+)\//.exec(file)?.[1];
  return map === undefined || maps.has(map);
}
