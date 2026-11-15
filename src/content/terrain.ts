/**
 * Terrain types. The Tiled tileset (content/tilesets/world.tsj) has one tile per
 * terrain, in this order, and each tile carries a `terrain` property with its id.
 * The game draws terrain itself from these ids, so the tileset image is only
 * what Tiled shows while editing.
 */

export interface TerrainInfo {
  id: string;
  /** Colour of the tile in the tileset image, and the base colour in the game. */
  color: number;
  solid: boolean;
  /** Arcade terrain is drawn as a crisp neon screen, print terrain through the halftone. */
  world: 'arcade' | 'print';
  /** Character used by the map bootstrap tool. */
  char: string;
}

export const TERRAINS: TerrainInfo[] = [
  { id: 'void', color: 0x000000, solid: true, world: 'arcade', char: '%' },
  { id: 'arcade_floor', color: 0x07070d, solid: false, world: 'arcade', char: '.' },
  { id: 'arcade_wall', color: 0x2c55ff, solid: true, world: 'arcade', char: '#' },
  { id: 'house_floor', color: 0x140a1a, solid: false, world: 'arcade', char: 'h' },
  { id: 'house_wall', color: 0xff4fa3, solid: true, world: 'arcade', char: 'H' },
  { id: 'grass', color: 0x7fbf4d, solid: false, world: 'print', char: 'g' },
  { id: 'grass_dark', color: 0x5f9a38, solid: false, world: 'print', char: 'G' },
  { id: 'water', color: 0x4aa3df, solid: true, world: 'print', char: '~' },
  { id: 'sand', color: 0xd9b77a, solid: false, world: 'print', char: 's' },
  { id: 'path', color: 0xc79a5b, solid: false, world: 'print', char: 'p' },
  { id: 'bridge', color: 0x9a6a3a, solid: false, world: 'print', char: '=' },
  { id: 'pavement', color: 0xbdb8ad, solid: false, world: 'print', char: ',' },
  { id: 'concrete_wall', color: 0xa7a39a, solid: true, world: 'print', char: 'W' },
  { id: 'rock', color: 0x8c8a86, solid: true, world: 'print', char: 'r' },
  // Grey tiled roofs filling a city block, seen from above: Beijing's hutongs between their lanes.
  { id: 'roofs', color: 0x6a6d72, solid: true, world: 'print', char: 'R' },
  // Asphalt: Berlin's roads.
  { id: 'road', color: 0x7b7d7c, solid: false, world: 'print', char: 'a' },
  // The bare grey ground on the far side of the Wall.
  { id: 'strip', color: 0x9a9a7e, solid: false, world: 'print', char: 'x' },
  // Raked grey sand along the far side of the Wall.
  { id: 'raked_sand', color: 0xd3c29a, solid: false, world: 'print', char: 'k' },
  // The patrol road's concrete slabs, on the far side of the Wall.
  { id: 'slabs', color: 0xc4c5c1, solid: false, world: 'print', char: 'c' },
  // Pale gravel: Berlin's walk through the lawns up to the Wall.
  { id: 'gravel', color: 0xdcd3bb, solid: false, world: 'print', char: 'v' },
  // Granite setts laid in fans: the square by Berlin's break in the Wall.
  { id: 'setts', color: 0xb9b4a8, solid: false, world: 'print', char: 'q' },
];

export const TERRAIN_INDEX = new Map(TERRAINS.map((t, i) => [t.id, i]));
// Bootstrap/test lookup: allocating it has no effects when the export is unused.
export const TERRAIN_BY_CHAR = /* @__PURE__ */ (() => new Map(TERRAINS.map((t, i) => [t.char, i])))();

export const TILE = 32;
