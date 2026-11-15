import { TERRAINS, TILE } from '../content/terrain.ts';
import type { GameMap, MapObject } from '../content/tiled.ts';
import type { PlanFrame, PlanReach } from './tall_plan.ts';

/** Named street centres in tile units, shared by street painting and patrol notice. */
export function beijingStreetCentres(objects: readonly MapObject[]): number[] {
  return ['from_border', 'martial_street', 'theatre_street', 'books_street'].map((name, i) =>
    (objects.find(o => o.name === name)?.y ?? [73.25, 61.25, 45.25, 29.25][i]! * TILE) / TILE);
}

/** The original painted bands, in tile units. Keep the fractional curbs in one place. */
export function beijingStreetBands(centre: number) {
  const shift = centre - 57.25;
  return {
    road: [55.9 + shift, 58 + shift] as const,
    sidewalks: [[54.4 + shift, 55.9 + shift], [58 + shift, 60.2 + shift]] as const,
  };
}

/**
 * The tank square's corner cell when Beijing's paint and buildings were laid out (12 Nov). How far its trigger is from there is how far
 * the city has moved in Tiled since: what is painted by hand moves that far, and the buildings keep their looks.
 */
const SQUARE_CORNER_THEN = [3, 12] as const;

/** Beijing's layout as its paint and buildings find it on the map, so a move in Tiled moves them with it. */
export interface BeijingFrame extends PlanFrame {
  /** The tank square, its trigger's rectangle, in world units. */
  square: { x: number; y: number; w: number; h: number };
  /** The top of the walkway at the foot that the buildings there stand over (the south_street_over area), in world units. */
  southStreet: number | undefined;
}

export function beijingFrame(map: GameMap): BeijingFrame {
  const square = map.objects.find((o) => o.name === 'tank_square');
  if (!square) throw new Error(`${map.file}: Beijing's street plan needs its tank_square trigger`);
  const hasBuilding = (r: number) => {
    for (let c = 0; c < map.width; c++) if (TERRAINS[map.terrain[r * map.width + c]!]!.id === 'roofs') return true;
    return false;
  };
  // Up from each street's north pavement to the first row with a building's cell in it, the cells under its shops.
  const edges = new Set(beijingStreetCentres(map.objects).map((centre) => {
    let r = Math.floor(beijingStreetBands(centre).sidewalks[0][0]);
    while (r > 0 && !hasBuilding(r)) r--;
    return r;
  }));
  return {
    square: { x: square.x, y: square.y, w: square.w, h: square.h },
    moved: { c: Math.round(square.x / TILE) - SQUARE_CORNER_THEN[0], r: Math.round(square.y / TILE) - SQUARE_CORNER_THEN[1] },
    edges,
    // The row along the square's south side is its edge too.
    pastSquare: Math.ceil((square.y + square.h) / TILE) + 1,
    southStreet: map.objects.find((o) => o.name === 'south_street_over')?.y,
  };
}

/** Walkways the buildings in front of them stand over (areas marked buildings_over), and rows of buildings past the foot. */
export function beijingReach(map: GameMap): PlanReach {
  const overs = map.objects.filter((o) => o.type === 'area' && o.props.buildings_over === true);
  const over = (c: number, r: number) => overs.some((o) => (c + 0.5) * TILE > o.x && (c + 0.5) * TILE < o.x + o.w && (r + 0.5) * TILE > o.y && (r + 0.5) * TILE < o.y + o.h);
  // An area's cover_by_column, "column:share,...", sets how much of it the buildings in front cover, stretch by stretch, its columns
  // counted from the area's west edge so they move with it in Tiled.
  const shares = overs.map((o) => String(o.props.cover_by_column ?? '').split(',').filter(Boolean)
    .map((part) => part.split(':').map(Number) as [number, number]).map(([from, share]) => [Math.round(o.x / TILE) + from, share] as [number, number])
    .sort((a, b) => a[0] - b[0]));
  const cover = (c: number, r: number) => {
    const i = overs.findIndex((o) => (c + 0.5) * TILE > o.x && (c + 0.5) * TILE < o.x + o.w && (r + 0.5) * TILE > o.y && (r + 0.5) * TILE < o.y + o.h);
    const set = i < 0 ? undefined : shares[i]!.filter(([from]) => from <= c).at(-1);
    return set ? { from: set[0], share: set[1] } : undefined;
  };
  const below = typeof map.props.buildings_below === 'number' ? map.props.buildings_below : 0;
  return { over, cover, below };
}
