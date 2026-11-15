import type { GameMap, MapObject } from './tiled.ts';

/** Authored building footprints shared by their roof/face drawing and precise collision. */
export function sceneryBlocks(map: GameMap): MapObject[] {
  return map.objects.filter(o => o.type === 'area' && o.props.scenery_block === true &&
    [o.x, o.y, o.w, o.h].every(Number.isFinite) && o.w > 0 && o.h > 0);
}
