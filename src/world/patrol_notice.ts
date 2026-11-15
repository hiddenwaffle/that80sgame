import { TILE } from '../content/terrain.ts';
import type { GameMap } from '../content/tiled.ts';
import type { Dir } from '../art/geom.ts';
import type { Box, Collision } from './collision.ts';
import type { PatrolLayout } from './patrol_walk.ts';
import { beijingStreetBands, beijingStreetCentres } from './beijing_streets.ts';

/** Fresh notice only. The original territory still controls walking and ongoing pursuit. */
export interface PatrolNotice {
  /** Unconditional alley notice, excluding both sidewalks and roads. */
  territory: readonly Box[];
  nearbyTerritory: readonly Box[];
  entrances: readonly PatrolEntrance[];
}

export interface PatrolEntrance {
  facing: 'up' | 'down';
  sidewalk: Box;
  /** The opening at the alley side of the sidewalk. */
  mouth: { x0: number; x1: number; y: number };
  /** Only the nearer road half; lateral limits start at the mouth's edges. */
  road: Box;
}

/** Street sight gains at most one tile on each side over the last four tiles to the mouth. */
const STREET_VIEW_APPROACH = 4 * TILE;
const STREET_VIEW_SPREAD = TILE;

/** Sidewalk awareness follows facing; road sight must also pass through the opening and clear scenery. */
export function entranceNotices(entrances: readonly PatrolEntrance[], body: { x: number; y: number; facing: Dir },
  collision: Collision, x: number, y: number): boolean {
  return entrances.some(e => {
    const direction = e.facing === 'down' ? 1 : -1;
    const forward = (y - body.y) * direction;
    if (body.facing !== e.facing || forward <= 0) return false;
    if (withinNotice([e.sidewalk], x, y)) return true;
    const depth = (e.mouth.y - body.y) * direction;
    // A returning guard already outside its alley does not project another fan out of its back.
    if (depth < 0 || (direction === 1 ? y < e.road.y0 || y >= e.road.y1 : y <= e.road.y0 || y > e.road.y1)) return false;
    const spread = STREET_VIEW_SPREAD * Math.max(0, 1 - depth / STREET_VIEW_APPROACH);
    if (x < e.road.x0 - spread || x >= e.road.x1 + spread) return false;
    const atMouth = body.x + (x - body.x) * depth / forward;
    if (atMouth < e.mouth.x0 || atMouth >= e.mouth.x1) return false;
    return collision.sightLine(body.x, body.y, x, y);
  });
}

/** Half-open edges give a shared entrance boundary to its eastern/southern neighbor. */
export function withinNotice(boxes: readonly Box[], x: number, y: number): boolean {
  return boxes.some(b => x >= b.x0 && x < b.x1 && y >= b.y0 && y < b.y1);
}

/** Separate the alley from its facing-dependent sidewalks and street views, using the painted bands. */
export function beijingPatrolNotice(map: GameMap, layout: PatrolLayout): PatrolNotice | undefined {
  if (map.props.streets !== 'beijing' || !layout.walk || !layout.nearbyTerritory) return undefined;
  const streets = beijingStreetCentres(map.objects).map(beijingStreetBands);
  const alley = layout.nearbyTerritory.filter(b => b.y1 - b.y0 > b.x1 - b.x0)
    .sort((a, b) => (b.y1 - b.y0) - (a.y1 - a.y0))[0]!;
  const entrances: PatrolEntrance[] = [];
  for (const street of streets) street.sidewalks.forEach(([top, bottom], side) => {
    for (const b of layout.territory) {
      const sidewalk = { ...b, y0: Math.max(b.y0, top * TILE), y1: Math.min(b.y1, bottom * TILE) };
      if (sidewalk.y1 <= sidewalk.y0) continue;
      const [roadTop, roadBottom] = street.road.map(v => v * TILE) as [number, number];
      const middle = (roadTop + roadBottom) / 2;
      const x0 = Math.max(b.x0, alley.x0), x1 = Math.min(b.x1, alley.x1);
      entrances.push({ facing: side === 0 ? 'down' : 'up', sidewalk,
        mouth: { x0, x1, y: (side === 0 ? top : bottom) * TILE },
        road: { x0, x1, y0: side === 0 ? roadTop : middle, y1: side === 0 ? middle : roadBottom } });
    }
  });
  const clip = (boxes: readonly Box[]) => {
    let result = boxes.map(b => ({ ...b }));
    for (const s of streets) {
      const top = s.sidewalks[0][0] * TILE, bottom = s.sidewalks[1][1] * TILE;
      result = result.flatMap(b => {
        if (b.y1 <= top || b.y0 >= bottom) return [b];
        return [{ ...b, y1: Math.min(b.y1, top) }, { ...b, y0: Math.max(b.y0, bottom) }]
          .filter(part => part.y1 > part.y0);
      });
    }
    return result;
  };
  return { territory: clip(layout.territory), nearbyTerritory: clip(layout.nearbyTerritory), entrances };
}
