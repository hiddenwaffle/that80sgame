import type { Content } from './content.ts';
import type { Scene } from './screenplay.ts';
import type { GameMap } from './tiled.ts';

/**
 * The content as the build hands it to the game: read and checked at build time (tools/production_content.ts contentForGame),
 * then carried as JSON, so the YAML reader, the content schemas and the check's messages stay out of the game. JSON carries all
 * of it as it is but the scenes and maps, which are Maps, and each map's terrain, a Uint8Array, written as base64 here.
 */
export interface PackedMap extends Omit<GameMap, 'terrain'> {
  terrain: string;
}

export interface PackedContent extends Omit<Content, 'scenes' | 'maps'> {
  scenes: Array<[string, Scene]>;
  maps: Array<[string, PackedMap]>;
}

export function packContent(c: Content): PackedContent {
  const terrain = (bytes: Uint8Array) => {
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin);
  };
  return { ...c, scenes: [...c.scenes], maps: [...c.maps].map(([id, m]) => [id, { ...m, terrain: terrain(m.terrain) }]) };
}

export function unpackContent(p: PackedContent): Content {
  return {
    ...p,
    scenes: new Map(p.scenes),
    maps: new Map(p.maps.map(([id, m]) => [id, { ...m, terrain: Uint8Array.from(atob(m.terrain), (ch) => ch.charCodeAt(0)) }])),
  };
}
