import { TERRAIN_INDEX, TILE } from './terrain.ts';

/** Reads Tiled JSON maps (.tmj) with external JSON tilesets (.tsj) into the game's map model. */

export type PropValue = string | number | boolean;

export interface MapObject {
  id: number;
  name: string;
  type: string;
  /** World units. Points have w = h = 0 and x, y at the point. Rectangles have x, y at the top left. */
  x: number;
  y: number;
  w: number;
  h: number;
  point: boolean;
  props: Record<string, PropValue>;
}

export interface GameMap {
  id: string;
  file: string;
  width: number;
  height: number;
  props: Record<string, PropValue>;
  /** Terrain index per cell, row by row. */
  terrain: Uint8Array;
  objects: MapObject[];
}

export interface MapError {
  file: string;
  line: number;
  message: string;
}

interface TiledProperty {
  name: string;
  type?: string;
  value: PropValue;
}

function readProps(list: unknown): Record<string, PropValue> {
  const out: Record<string, PropValue> = {};
  if (Array.isArray(list)) {
    for (const p of list as TiledProperty[]) {
      if (p && typeof p.name === 'string') out[p.name] = p.value;
    }
  }
  return out;
}

/** Resolves "../tilesets/world.tsj" relative to "content/maps/x.tmj". */
export function resolvePath(from: string, rel: string): string {
  const parts = from.split('/').slice(0, -1);
  for (const seg of rel.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg !== '.') parts.push(seg);
  }
  return parts.join('/');
}

export function parseTiledMap(file: string, source: string, readFile: (path: string) => string | undefined): { map: GameMap | null; errors: MapError[] } {
  const errors: MapError[] = [];
  const err = (message: string) => errors.push({ file, line: 0, message });
  const id = file.split('/').pop()!.replace(/\.tmj$/, '');
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(source);
  } catch (e) {
    err(`Not valid JSON: ${(e as Error).message}`);
    return { map: null, errors };
  }
  const width = Number(json.width);
  const height = Number(json.height);
  if (json.tilewidth !== TILE || json.tileheight !== TILE) err(`Tiles must be ${TILE} x ${TILE} pixels.`);
  if (json.infinite) err('Infinite maps are not supported. Turn off "Infinite" in the map properties.');

  // Map each tile gid to a terrain index through the tilesets' `terrain` properties.
  const gidTerrain = new Map<number, number>();
  for (const ts of (json.tilesets as Array<Record<string, unknown>>) ?? []) {
    const firstgid = Number(ts.firstgid);
    let tsJson: Record<string, unknown> | null = null;
    if (typeof ts.source === 'string') {
      const tsPath = resolvePath(file, ts.source);
      const text = readFile(tsPath);
      if (text === undefined) {
        err(`Tileset ${ts.source} not found (looked for ${tsPath}).`);
        continue;
      }
      try {
        tsJson = JSON.parse(text);
      } catch {
        err(`Tileset ${tsPath} is not valid JSON. Save tilesets as JSON (.tsj) in Tiled.`);
        continue;
      }
    } else {
      tsJson = ts;
    }
    for (const tile of (tsJson!.tiles as Array<Record<string, unknown>>) ?? []) {
      const terrain = readProps(tile.properties).terrain;
      const idx = typeof terrain === 'string' ? TERRAIN_INDEX.get(terrain) : undefined;
      if (idx === undefined) {
        err(`Tileset tile ${tile.id} has an unknown terrain "${String(terrain)}".`);
        continue;
      }
      gidTerrain.set(firstgid + Number(tile.id), idx);
    }
  }

  const terrain = new Uint8Array(width * height);
  const objects: MapObject[] = [];
  let sawGround = false;
  for (const layer of (json.layers as Array<Record<string, unknown>>) ?? []) {
    if (layer.type === 'tilelayer') {
      const data = layer.data as number[];
      if (!Array.isArray(data)) {
        err(`Layer "${layer.name}" is not stored as a plain array. Set the tile layer format to CSV in the map properties.`);
        continue;
      }
      sawGround = true;
      data.forEach((gid, i) => {
        if (gid === 0) return;
        const t = gidTerrain.get(gid & 0x1fffffff);
        if (t === undefined) {
          err(`Layer "${layer.name}" uses tile ${gid}, which has no terrain.`);
          return;
        }
        terrain[i] = t;
      });
    } else if (layer.type === 'objectgroup') {
      for (const o of (layer.objects as Array<Record<string, unknown>>) ?? []) {
        objects.push({
          id: Number(o.id),
          name: String(o.name ?? ''),
          type: String(o.type ?? o.class ?? ''),
          x: Number(o.x),
          y: Number(o.y),
          w: Number(o.width ?? 0),
          h: Number(o.height ?? 0),
          point: Boolean(o.point) || (!o.width && !o.height),
          props: readProps(o.properties),
        });
      }
    }
  }
  if (!sawGround) err('The map has no tile layer.');
  return {
    map: { id, file, width, height, props: readProps(json.properties), terrain, objects },
    errors,
  };
}
