import { sceneryBlocks } from '../content/scenery_blocks.ts';
import { TERRAINS, TILE } from '../content/terrain.ts';
import type { GameMap, MapObject } from '../content/tiled.ts';
import { beijingFrame } from './beijing_streets.ts';
import { solidPart } from './tall_plan.ts';

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Optional map-local trims leave a prop's art and the shared prop-kind footprint unchanged. */
export function propCollisionBox(o: Pick<MapObject, 'x' | 'y' | 'props'>, foot: readonly [number, number]): Box {
  const [hw, h] = foot;
  const inset = (key: string, maximum: number) => {
    const value = o.props[key];
    return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(maximum, value)) : 0;
  };
  return {
    x0: o.x - hw, y0: o.y - h + inset('collision_inset_top', h),
    x1: o.x + hw - inset('collision_inset_right', hw * 2), y1: o.y + 1,
  };
}

/** Half-width and height of the collision box at a figure's feet, in world units. */
export const FEET_HW = 8;
export const FEET_H = 8;

/**
 * Collision against solid terrain and solid scenery. Figures collide with a
 * small box at their feet, so they can pass in front of and behind things.
 */
export class Collision {
  private readonly map: GameMap;
  private readonly solidCells: Uint8Array;
  boxes: Box[] = [];
  /** Box indices per map tile. Geometry is checked once at the start of each bulk query. */
  private readonly boxCells: Array<number[] | undefined>;
  private readonly boxBounds: number[] = [];
  /** The part that stops a figure, for cells only part of which does. The cell still counts as solid for finding a way round. */
  private readonly solidParts = new Map<number, Box>();

  constructor(map: GameMap) {
    this.map = map;
    this.boxCells = new Array(map.width * map.height);
    this.solidCells = new Uint8Array(map.width * map.height);
    for (let i = 0; i < map.terrain.length; i++) this.solidCells[i] = TERRAINS[map.terrain[i]!]!.solid ? 1 : 0;
    if (map.props.streets === 'beijing') {
      const frame = beijingFrame(map);
      const open = (c: number, r: number) => c >= 0 && r >= 0 && c < map.width && r < map.height && this.solidCells[r * map.width + c] === 0;
      for (let r = 0; r < map.height; r++) for (let c = 0; c < map.width; c++) {
        const i = r * map.width + c;
        if (TERRAINS[map.terrain[i]!]!.id !== 'roofs') continue;
        const part = solidPart(c, r, map.width, open, frame);
        if (part) this.solidParts.set(i, part);
      }
    }
    for (const o of sceneryBlocks(map)) if (o.props.solid === true)
      this.boxes.push({ x0:o.x, y0:o.y, x1:o.x+o.w, y1:o.y+o.h });
    // A painted upright wall can overhang its ground footprint. Only the authored northern band is inset;
    // the concrete fence elsewhere on the same map and every other terrain cell retain their collision.
    const top = map.props.wall_collision_top, inset = map.props.wall_collision_inset_top;
    if (typeof top === 'number' && Number.isFinite(top) && top >= 0 && top % TILE === 0 &&
        typeof inset === 'number' && Number.isFinite(inset) && inset > 0 && inset < TILE) {
      const row = top / TILE;
      for (let x = 0; x < map.width && row < map.height; x++) {
        const i = row * map.width + x;
        if (TERRAINS[map.terrain[i]!]!.id !== 'concrete_wall') continue;
        this.solidCells[i] = 0;
        this.boxes.push({ x0: x * TILE, y0: top + inset, x1: (x + 1) * TILE, y1: top + TILE });
      }
    }
  }

  cellSolid(tx: number, ty: number): boolean {
    if (tx < 0 || ty < 0 || tx >= this.map.width || ty >= this.map.height) return true;
    return this.solidCells[ty * this.map.width + tx] === 1;
  }

  /**
   * Where someone stands, for whatever goes by whole cells. Behind a building they can be a little way into its cell, which counts as the open
   * lane beside it: a wall is no hiding place from a patrol.
   */
  standingOn(x: number, y: number): { x: number; y: number } {
    const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
    if (tx < 0 || tx >= this.map.width) return { x, y };
    const part = this.solidParts.get(ty * this.map.width + tx);
    if (!part || (x >= part.x0 && x < part.x1 && y >= part.y0 && y < part.y1)) return { x, y };
    const fromLeft = x - tx * TILE, fromRight = (tx + 1) * TILE - x, fromTop = y - ty * TILE;
    const open = (c: number, r: number) => !this.cellSolid(c, r);
    const sides = [
      open(tx - 1, ty) ? { d: fromLeft, x: tx * TILE - 1, y } : null,
      open(tx + 1, ty) ? { d: fromRight, x: (tx + 1) * TILE, y } : null,
      open(tx, ty - 1) ? { d: fromTop, x, y: ty * TILE - 1 } : null,
    ].filter((s) => s !== null).sort((a, b) => a.d - b.d);
    return sides[0] ? { x: sides[0].x, y: sides[0].y } : { x, y };
  }

  /** Whether a point is in what is solid of its cell. */
  private inSolidCell(x: number, y: number, tx: number, ty: number): boolean {
    if (!this.cellSolid(tx, ty)) return false;
    if (tx < 0 || ty < 0 || tx >= this.map.width || ty >= this.map.height) return true;
    const part = this.solidParts.get(ty * this.map.width + tx);
    return !part || (x >= part.x0 && x < part.x1 && y >= part.y0 && y < part.y1);
  }

  pointSolid(x: number, y: number): boolean {
    if (this.inSolidCell(x, y, Math.floor(x / TILE), Math.floor(y / TILE))) return true;
    for (const b of this.boxes) if (x >= b.x0 && x < b.x1 && y >= b.y0 && y < b.y1) return true;
    return false;
  }

  /** A thin sight segment, independent of the feet-width corridor used for walking and tackles. */
  sightLine(x0: number, y0: number, x1: number, y1: number): boolean {
    const intersects = (b: Box) => {
      let enter = 0, leave = 1;
      for (const [start, delta, low, high] of [[x0, x1 - x0, b.x0, b.x1], [y0, y1 - y0, b.y0, b.y1]] as const) {
        if (delta === 0) { if (start < low || start >= high) return false; }
        else {
          const a = (low - start) / delta, z = (high - start) / delta;
          enter = Math.max(enter, Math.min(a, z)); leave = Math.min(leave, Math.max(a, z));
          if (enter > leave) return false;
        }
      }
      return true;
    };
    for (const b of this.boxes) if (intersects(b)) return false;
    for (let ty = Math.floor(Math.min(y0, y1) / TILE); ty <= Math.floor(Math.max(y0, y1) / TILE); ty++)
      for (let tx = Math.floor(Math.min(x0, x1) / TILE); tx <= Math.floor(Math.max(x0, x1) / TILE); tx++)
        if (this.cellSolid(tx, ty) && intersects({ x0: tx * TILE, x1: (tx + 1) * TILE, y0: ty * TILE, y1: (ty + 1) * TILE })) return false;
    return true;
  }

  /**
   * Keep the public mutable array compatible with push/pop, replacement and edits through held box
   * references. No proxy or explicit invalidation is needed. A synchronous movement/path query sees
   * one geometry snapshot, instead of validating it again for every point along every candidate edge.
   */
  private syncBoxes(): void {
    const boxes = this.boxes, bounds = this.boxBounds;
    let same = bounds.length === boxes.length * 4;
    for (let i = 0; same && i < boxes.length; i++) {
      const b = boxes[i]!, j = i * 4;
      same = bounds[j] === b.x0 && bounds[j + 1] === b.y0 && bounds[j + 2] === b.x1 && bounds[j + 3] === b.y1;
    }
    if (same) return;
    bounds.length = boxes.length * 4;
    this.boxCells.fill(undefined);
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i]!, j = i * 4;
      bounds[j] = b.x0; bounds[j + 1] = b.y0; bounds[j + 2] = b.x1; bounds[j + 3] = b.y1;
      if (b.x0 >= b.x1 || b.y0 >= b.y1) continue;
      // Outside-map points are already solid terrain; keep even very large scenery bounds finite.
      const x0 = Math.max(0, Math.floor(b.x0 / TILE)), x1 = Math.min(this.map.width - 1, Math.ceil(b.x1 / TILE) - 1);
      const y0 = Math.max(0, Math.floor(b.y0 / TILE)), y1 = Math.min(this.map.height - 1, Math.ceil(b.y1 / TILE) - 1);
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++)
        (this.boxCells[y * this.map.width + x] ??= []).push(i);
    }
  }

  private indexedPointSolid(x: number, y: number): boolean {
    const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
    if (this.inSolidCell(x, y, tx, ty)) return true;
    const cell = this.boxCells[ty * this.map.width + tx];
    if (cell) for (let i = 0; i < cell.length; i++) {
      const b = this.boxes[cell[i]!]!;
      if (x >= b.x0 && x < b.x1 && y >= b.y0 && y < b.y1) return true;
    }
    return false;
  }

  /** Whether a feet box at (x, y) overlaps anything solid. */
  blocked(x: number, y: number): boolean {
    this.syncBoxes();
    return this.indexedBlocked(x, y);
  }

  private indexedBlocked(x: number, y: number): boolean {
    const x0 = x - FEET_HW;
    const x1 = x + FEET_HW;
    const y0 = y - FEET_H;
    const y1 = y;
    for (let sy = y0; sy <= y1; sy += 4) {
      for (let sx = x0; sx <= x1; sx += 4) if (this.indexedPointSolid(sx, sy)) return true;
    }
    return this.indexedPointSolid(x1, y1) || this.indexedPointSolid(x0, y1) || this.indexedPointSolid(x1, y0);
  }

  /**
   * Moves a feet box by (dx, dy), stopping at solids. Slides along walls, and
   * nudges around corners that are nearly lined up, so corridors are easy to enter.
   */
  move(x: number, y: number, dx: number, dy: number): [number, number] {
    this.syncBoxes();
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / 3));
    const sx = dx / steps;
    const sy = dy / steps;
    for (let i = 0; i < steps; i++) {
      if (sx !== 0) {
        if (!this.indexedBlocked(x + sx, y)) x += sx;
        else if (sy === 0) {
          for (const n of [3, -3, 6, -6, 9, -9]) {
            if (!this.indexedBlocked(x, y + n) && !this.indexedBlocked(x + sx, y + n)) {
              y += Math.sign(n) * Math.min(Math.abs(n), Math.abs(sx) + 0.5);
              break;
            }
          }
        }
      }
      if (sy !== 0) {
        if (!this.indexedBlocked(x, y + sy)) y += sy;
        else if (sx === 0) {
          for (const n of [3, -3, 6, -6, 9, -9]) {
            if (!this.indexedBlocked(x + n, y) && !this.indexedBlocked(x + n, y + sy)) {
              x += Math.sign(n) * Math.min(Math.abs(n), Math.abs(sy) + 0.5);
              break;
            }
          }
        }
      }
    }
    return [x, y];
  }

  /**
   * Whether a feet box can go straight from one point to the other without touching anything solid, tried every 2
   * units as `move` takes a step: across, then down.
   */
  clearLine(x0: number, y0: number, x1: number, y1: number): boolean {
    this.syncBoxes();
    return this.indexedClearLine(x0, y0, x1, y1);
  }

  private indexedClearLine(x0: number, y0: number, x1: number, y1: number): boolean {
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 2));
    let py = y0;
    for (let i = 1; i <= n; i++) {
      const x = x0 + ((x1 - x0) * i) / n;
      const y = y0 + ((y1 - y0) * i) / n;
      if (this.indexedBlocked(x, py) || this.indexedBlocked(x, y)) return false;
      py = y;
    }
    return true;
  }

  /**
   * A path walked from (fromX, fromY) with its turns taken out where it can go straight: from each point, on to the
   * furthest point ahead in a clear line. Tiles go four ways, so a path to somewhere diagonally away goes across and
   * then down, or in steps; walked as it was, a tapped walk turned at those corners instead of going straight (the
   * owner, 2026-10-03: "diagonal movement would make sense").
   */
  straighten(fromX: number, fromY: number, path: Array<[number, number]>): Array<[number, number]> {
    this.syncBoxes();
    const out: Array<[number, number]> = [];
    let [x, y] = [fromX, fromY];
    let i = 0;
    while (i < path.length) {
      // Most often the rest of the way is clear; otherwise the furthest point before the first that is not.
      let j = path.length - 1;
      if (j > i && !this.indexedClearLine(x, y, path[j]![0], path[j]![1])) {
        j = i;
        while (j + 1 < path.length - 1 && this.indexedClearLine(x, y, path[j + 1]![0], path[j + 1]![1])) j++;
      }
      out.push(path[j]!);
      [x, y] = path[j]!;
      i = j + 1;
    }
    return out;
  }

  /** A* over tiles, four directions. Returns tile centres from start to goal, or [] if unreachable. */
  findPath(fromX: number, fromY: number, toX: number, toY: number): Array<[number, number]> {
    return this.findPathNear(fromX, fromY, toX, toY, false).path;
  }

  /**
   * Like findPath, but when the goal cannot be reached and `nearest` is set, the path goes to
   * the reachable tile nearest the goal instead (none if that is where it starts). `reached`
   * says whether the path ends at the goal's own tile.
   */
  /** Where the feet stood and the goal's tile for the last way not found even with steps out, for findPathOut. */
  private noWayOut = '';

  /**
   * findPathNear for the leader's tapped walks. Where its way can't start (feet a little way into a tall building's cell, which the grid
   * counts solid, or squeezed beside a prop, where no straight step reaches a neighbouring tile's centre), it starts with a few short steps
   * out to open ground, the nearest first (the owner, 2026-11-02: behind a building with touch, "I get somewhat stuck", and only the arrow
   * keys got out). Patrols keep plain findPathNear: this searches more, and only when a way isn't found.
   */
  findPathOut(fromX: number, fromY: number, toX: number, toY: number, nearest = true): { path: Array<[number, number]>; reached: boolean } {
    const direct = this.findPathNear(fromX, fromY, toX, toY, nearest);
    if (direct.path.length || direct.reached) return direct;
    // A held tap asks again every fifth of a second: a way that failed even with steps out isn't searched again from where the feet stand.
    const key = `${Math.round(fromX)},${Math.round(fromY)}>${Math.floor(toX / TILE)},${Math.floor(toY / TILE)}:${nearest}`;
    if (key === this.noWayOut) return direct;
    // One try for each tile the steps out reach, the nearest first: steps ending in a tile already tried would mostly meet the same.
    const tried = new Set<number>();
    for (const lead of this.waysOut(fromX, fromY, 400)) {
      const [x, y] = lead[lead.length - 1]!;
      const tile = Math.floor((y - 1) / TILE) * this.map.width + Math.floor(x / TILE);
      if (tried.has(tile)) continue;
      tried.add(tile);
      const rest = this.findPathNear(x, y, toX, toY, nearest);
      if (rest.path.length || rest.reached) return { path: [...lead, ...rest.path], reached: rest.reached };
      if (tried.size >= 12) break;
    }
    this.noWayOut = key;
    return direct;
  }

  /** Short walks from the feet to points in open cells, nearest first: steps of 8 units, up to four tiles away. */
  private waysOut(fromX: number, fromY: number, most = 24): Array<Array<[number, number]>> {
    const STEP = 8, R = 16, N = 2 * R + 1;
    const came = new Int32Array(N * N).fill(-2);
    const point = (i: number): [number, number] => [fromX + ((i % N) - R) * STEP, fromY + (Math.floor(i / N) - R) * STEP];
    const start = R * N + R;
    came[start] = -1;
    const queue = [start];
    const out: Array<Array<[number, number]>> = [];
    for (let k = 0; k < queue.length && out.length < most; k++) {
      const i = queue[k]!;
      const [x, y] = point(i);
      if (i !== start && !this.cellSolid(Math.floor(x / TILE), Math.floor((y - 1) / TILE))) {
        const steps: Array<[number, number]> = [];
        for (let c = i; c !== start; c = came[c]!) steps.push(point(c));
        out.push(steps.reverse());
      }
      const [gx, gy] = [i % N, Math.floor(i / N)];
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const [nx, ny] = [gx + dx, gy + dy];
        if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
        const ni = ny * N + nx;
        if (came[ni] !== -2) continue;
        const [px, py] = point(ni);
        if (this.blocked(px, py) || !this.indexedClearLine(x, y, px, py)) continue;
        came[ni] = i;
        queue.push(ni);
      }
    }
    return out;
  }

  /**
   * Like findPath, but when the goal cannot be reached and `nearest` is set, the path goes to
   * the reachable tile nearest the goal instead (none if that is where it starts). `reached`
   * says whether the path ends at the goal's own tile.
   */
  findPathNear(fromX: number, fromY: number, toX: number, toY: number, nearest = true): { path: Array<[number, number]>; reached: boolean } {
    this.syncBoxes();
    const w = this.map.width;
    const h = this.map.height;
    const sx = Math.floor(fromX / TILE);
    const sy = Math.floor((fromY - 1) / TILE);
    let gx = Math.floor(toX / TILE);
    let gy = Math.floor(toY / TILE);
    const walkable = (x: number, y: number) => !this.cellSolid(x, y) && !this.indexedBlocked(x * TILE + TILE / 2, y * TILE + TILE / 2 + FEET_H / 2);
    if (!walkable(gx, gy)) {
      // Aim for the nearest walkable cell instead.
      let best: [number, number] | null = null;
      let bestD = Infinity;
      for (let r = 1; r < 4 && !best; r++) {
        for (let yy = gy - r; yy <= gy + r; yy++) {
          for (let xx = gx - r; xx <= gx + r; xx++) {
            if (!walkable(xx, yy)) continue;
            const d = Math.hypot(xx - gx, yy - gy);
            if (d < bestD) {
              bestD = d;
              best = [xx, yy];
            }
          }
        }
      }
      // Nowhere to stand near it (the middle of a lake): only a walk to the nearest reachable tile can help.
      if (best) [gx, gy] = best;
      else if (!nearest) return { path: [], reached: false };
    }
    const idx = (x: number, y: number) => y * w + x;
    const gScore = new Float64Array(w * h).fill(Infinity);
    const came = new Int32Array(w * h).fill(-1);
    const open: Array<[number, number]> = [];
    gScore[idx(sx, sy)] = 0;
    open.push([idx(sx, sy), Math.abs(gx - sx) + Math.abs(gy - sy)]);
    const closed = new Uint8Array(w * h);
    let found = false;
    let guard = 0;
    // The reached tile nearest the goal, in case the goal is out of reach.
    let near = idx(sx, sy);
    let nearH = Math.abs(gx - sx) + Math.abs(gy - sy);
    while (open.length && guard++ < 20000) {
      let bi = 0;
      for (let i = 1; i < open.length; i++) if (open[i]![1] < open[bi]![1]) bi = i;
      const [cur] = open.splice(bi, 1)[0]!;
      if (closed[cur]) continue;
      closed[cur] = 1;
      const cx = cur % w;
      const cy = Math.floor(cur / w);
      if (cx === gx && cy === gy) {
        found = true;
        break;
      }
      const hh = Math.abs(gx - cx) + Math.abs(gy - cy);
      if (hh < nearH || (hh === nearH && gScore[cur]! < gScore[near]!)) {
        near = cur;
        nearH = hh;
      }
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h || !walkable(nx, ny)) continue;
        // A thin post can sit between two clear tile centres. Check the edge too, including the actual
        // starting feet position, or a valid-looking path can stop at a sign before its first turn.
        const [px, py] = cur === idx(sx, sy) ? [fromX, fromY] : [cx * TILE + TILE / 2, cy * TILE + TILE / 2 + FEET_H / 2];
        if (!this.indexedClearLine(px, py, nx * TILE + TILE / 2, ny * TILE + TILE / 2 + FEET_H / 2)) continue;
        const ni = idx(nx, ny);
        const g = gScore[cur]! + 1;
        if (g < gScore[ni]!) {
          gScore[ni] = g;
          came[ni] = cur;
          open.push([ni, g + Math.abs(gx - nx) + Math.abs(gy - ny)]);
        }
      }
    }
    if (!found && (!nearest || near === idx(sx, sy))) return { path: [], reached: false };
    const cells: number[] = [];
    for (let c = found ? idx(gx, gy) : near; c !== -1; c = came[c]!) cells.push(c);
    cells.reverse();
    return { path: cells.slice(1).map((c) => [(c % w) * TILE + TILE / 2, Math.floor(c / w) * TILE + TILE / 2 + FEET_H / 2]), reached: found };
  }
}
