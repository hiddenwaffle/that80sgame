import { Graphics, type Container } from 'pixi.js';
import { sceneryMaterial } from '../art/map_scenery.ts';
import { TILE } from '../content/terrain.ts';
import type { GameMap } from '../content/tiled.ts';

/** Tiled rectangles paint scenery outside the playable grid, without changing collision or camera bounds.
 * The original map covers the middle; clipping here also keeps an edited rectangle from repainting it.
 * Upright scenery uses ordinary non-solid prop points, outside the same grid. */
export function drawCameraScenery(parent: Container, map: GameMap): void {
  const areas = map.objects.filter(o => o.type === 'area' && typeof o.props.scenery_ground === 'string');
  if (!areas.length) return;
  const g = new Graphics();
  g.label = 'camera_scenery_ground';
  const width = map.width * TILE, height = map.height * TILE;
  for (const o of areas) {
    const material = String(o.props.scenery_ground);
    const fallback = Number(o.props.scenery_color ?? 0xbdb8ad);
    const fill = material === 'color' ? fallback
      : sceneryMaterial(map.id, material, Number(o.props.repeat_width ?? 64), Number(o.props.repeat_height ?? 64),
        Number(o.props.repeat_x ?? 0), Number(o.props.repeat_y ?? 0)) ?? fallback;
    // Match the map's tinted repeating materials, such as the bridge approach's pale soil.
    const style = typeof fill === 'object' && typeof o.props.scenery_tint === 'number'
      ? { ...fill, color: o.props.scenery_tint } : fill;
    const rect = (x0: number, y0: number, x1: number, y1: number) => {
      if (x1 > x0 && y1 > y0) g.rect(x0, y0, x1 - x0, y1 - y0).fill(style);
    };
    // Four non-overlapping exterior strips. No mask and no new playable cells.
    rect(o.x, o.y, o.x + o.w, Math.min(0, o.y + o.h));
    rect(o.x, Math.max(height, o.y), o.x + o.w, o.y + o.h);
    rect(o.x, Math.max(0, o.y), Math.min(0, o.x + o.w), Math.min(height, o.y + o.h));
    rect(Math.max(width, o.x), Math.max(0, o.y), o.x + o.w, Math.min(height, o.y + o.h));
  }
  parent.addChild(g);
}
