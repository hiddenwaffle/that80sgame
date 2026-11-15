import { TILE } from '../content/terrain.ts';
import type { MapObject } from '../content/tiled.ts';
import type { Box, Collision } from './collision.ts';
import { otherTerritories, territoryBoxes } from './patrol.ts';

/** The default NPC walking pace in World.buildObjects, in world units per second. */
export const PATROL_WALK_SPEED = 40;
/** A one-tile file keeps the pair together through the alleys' narrow prop passages. */
export const PATROL_PAIR_SPACING = TILE;
/** Pair centre turns a tile in: the nearest soldier's feet reach half a tile from the end. */
export const PATROL_END_INSET = TILE;
/** Clearance beyond the feet box keeps interpolated positions off prop and wall corners. */
export const PATROL_ROUTE_CLEARANCE = 1;

type Point = readonly [number, number];
export interface PatrolWalk {
  readonly period: number;
  /** Position on the shared, reversible schedule at world simulation time. */
  at(seconds: number): Point;
}
export interface PatrolLayout {
  territory: Box[];
  others: Box[];
  walk?: PatrolWalk;
  upperHalfEnd?: number;
  nearbyTerritory?: Box[];
}

const routeCache = new WeakMap<readonly MapObject[], { key: string; layouts: Map<MapObject, PatrolLayout> }>();

/**
 * A monotone path for a pair, sampled across the alley. Both feet tracks must be clear on every leg.
 * Shortest paths through these rows can turn around a bend but cannot double back along the alley.
 * No map names, enemy names, random draws or authored walking offsets determine the route.
 */
function pairPath(c: Collision, b: Box, steps: number): Point[] {
  const rows: Array<Array<{ x: number; cost: number; prev: number }>> = [];
  const yAt = (i: number) => b.y0 + PATROL_END_INSET + (b.y1 - b.y0 - PATROL_END_INSET * 2) * i / steps;
  const sides = [-PATROL_PAIR_SPACING / 2, PATROL_PAIR_SPACING / 2];
  const margin = [-PATROL_ROUTE_CLEARANCE, PATROL_ROUTE_CLEARANCE];
  const tracks = sides.flatMap(dy => margin.flatMap(x => margin.map(y => [x, dy + y] as const)));
  for (let i = 0; i <= steps; i++) {
    const row: typeof rows[number] = [], y = yAt(i);
    for (let x = b.x0 + TILE / 2; x <= b.x1 - TILE / 2; x += TILE / 4) {
      if (tracks.some(([dx, dy]) => c.blocked(x + dx, y + dy))) continue;
      let cost = i === 0 ? 0 : Infinity, prev = -1;
      if (i) rows[i - 1]!.forEach((p, index) => {
        const next = p.cost + Math.hypot(x - p.x, y - yAt(i - 1));
        if (next >= cost || tracks.some(([dx, dy]) => !c.clearLine(p.x + dx, yAt(i - 1) + dy, x + dx, y + dy))) return;
        cost = next; prev = index;
      });
      if (Number.isFinite(cost)) row.push({ x, cost, prev });
    }
    if (!row.length) throw new Error(`No walking route for a patrol pair in ${JSON.stringify(b)} at y=${y}`);
    rows.push(row);
  }
  const last = rows.at(-1)!;
  let index = last.reduce((best, p, i) => p.cost < last[best]!.cost ? i : best, 0);
  const points: Point[] = [];
  for (let i = steps; i >= 0; i--) {
    const p = rows[i]![index]!;
    points.push([p.x, yAt(i)]);
    index = p.prev;
  }
  return points.reverse();
}

/**
 * Two encounters of two ordinary pursuing guards sharing one vertical alley area adopt its halves.
 * Authored pair centres choose top/bottom; authored objects, including defeated encounters, keep the
 * assignment and district phase stable on revisits. Caps are clipped with the territory, not lost.
 * Special bridge guards and single-pair territories keep their original movement and boundaries.
 */
export function patrolLayouts(objects: readonly MapObject[], c: Collision): Map<MapObject, PatrolLayout> {
  const guards = objects.filter(o => o.type === 'enemy' && o.props.behavior === 'pursue');
  const names = new Set(guards.map(o => o.props.territory));
  const zones = objects.filter(o => o.type === 'area' && names.has(o.name));
  // Only geometry a walking route uses affects its cache. Entrance gates elsewhere in Beijing
  // can change independently. Read solid cells too: edits to the terrain cannot reuse an old path.
  const solids = zones.flatMap(z => {
    const cells: boolean[] = [];
    for (let y = Math.floor(z.y / TILE); y < Math.ceil((z.y + z.h) / TILE); y++)
      for (let x = Math.floor(z.x / TILE); x < Math.ceil((z.x + z.w) / TILE); x++) cells.push(c.cellSolid(x, y));
    return cells;
  });
  const key = JSON.stringify([guards, zones, solids, c.boxes.filter(b => zones.some(z =>
    b.x1 >= z.x && b.x0 <= z.x + z.w && b.y1 >= z.y && b.y0 <= z.y + z.h))]);
  const cached = routeCache.get(objects);
  if (cached?.key === key) return cached.layouts;
  const result = new Map(guards.map(o => [o, {
    territory: territoryBoxes(objects, o.props.territory), others: otherTerritories(objects, o.props.territory),
  } as PatrolLayout]));
  const lanes: Array<{ box: Box; pairs: MapObject[][]; halves: Box[] }> = [];
  for (const name of new Set(guards.map(o => o.props.territory))) {
    const members = guards.filter(o => o.props.territory === name);
    if (members.some(o => o.props.relentless === true || o.props.confined === true)) continue;
    const pairs = [...new Set(members.map(o => o.props.encounter))].map(enc => members.filter(o => o.props.encounter === enc));
    if (pairs.length !== 2 || pairs.some(pair => pair.length !== 2)) continue;
    const boxes = territoryBoxes(objects, name);
    const box = boxes.filter(b => b.y1 - b.y0 > b.x1 - b.x0).sort((a, b) => (b.y1 - b.y0) - (a.y1 - a.y0))[0];
    if (!box) continue;
    if (box.y1 - box.y0 <= PATROL_END_INSET * 4) throw new Error(`Alley ${String(name)} is too short for two walking pairs`);
    pairs.sort((a, b) => (a[0]!.y + a[1]!.y) - (b[0]!.y + b[1]!.y) || a[0]!.id - b[0]!.id);
    const mid = (box.y0 + box.y1) / 2;
    const halves = [{ ...box, y1: mid }, { ...box, y0: mid }];
    pairs.forEach((pair, half) => {
      const territory = boxes.map(b => ({ ...b, y0: half ? Math.max(mid, b.y0) : b.y0, y1: half ? b.y1 : Math.min(mid, b.y1) }))
        .filter(b => b.y1 > b.y0);
      for (const o of pair) {
        result.get(o)!.territory = territory;
        result.get(o)!.nearbyTerritory = boxes;
        if (!half) result.get(o)!.upperHalfEnd = mid;
      }
    });
    // Walking endpoints are separate from notice territory, which intentionally reaches the street edge.
    const area = objects.find(o => o.type === 'area' && o.name === name && o.x === box.x0 && o.y === box.y0 && o.w === box.x1 - box.x0 && o.h === box.y1 - box.y0)!;
    const inset = (key: string) => {
      const value = area.props[key] ?? 0;
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error(`Invalid patrol walking inset ${key}`);
      return value;
    };
    const walking = halves.map((b, half) => ({ ...b,
      y0: b.y0 + (half === 0 ? inset('walk_inset_top') : 0),
      y1: b.y1 - (half === 1 ? inset('walk_inset_bottom') : 0),
    }));
    if (walking.some(b => b.y1 - b.y0 <= PATROL_END_INSET * 2)) throw new Error(`Patrol walking insets leave no route in ${String(name)}`);
    lanes.push({ box, pairs, halves: walking });
  }
  // Each other encounter's half excludes it from pursuit too. Single-pair territories retain their old rule.
  for (const lane of lanes) for (const pair of lane.pairs) for (const o of pair) {
    result.get(o)!.others = guards.filter(g => g.props.encounter !== o.props.encounter)
      .flatMap(g => result.get(g)!.territory);
  }
  const remaining = new Set(lanes);
  while (remaining.size) {
    const district = [remaining.values().next().value!];
    remaining.delete(district[0]!);
    for (const lane of district) for (const other of remaining) {
      if (Math.min(lane.box.y1, other.box.y1) <= Math.max(lane.box.y0, other.box.y0)) continue;
      district.push(other); remaining.delete(other);
    }
    district.sort((a, b) => a.box.x0 - b.box.x0);
    const steps = Math.ceil(Math.max(...district.flatMap(l => l.halves.map(b => b.y1 - b.y0 - PATROL_END_INSET * 2))) / (TILE / 2));
    const paths = district.map(l => l.halves.map(b => pairPath(c, b, steps)));
    // The longest move in each band sets the clock for all pairs, keeping vertical progress identical.
    const times = [0];
    for (let i = 1; i <= steps; i++) times.push(times[i - 1]! + Math.max(...paths.flat().map(p =>
      Math.hypot(p[i]![0] - p[i - 1]![0], p[i]![1] - p[i - 1]![1]))) / PATROL_WALK_SPEED);
    const leg = times.at(-1)!, period = leg * 2;
    district.forEach((lane, rank) => lane.pairs.forEach((pair, half) => {
      pair.sort((a, b) => a.x - b.x || a.id - b.id);
      pair.forEach((o, member) => {
        const path = paths[rank]![half]!, dy = (member - 0.5) * PATROL_PAIR_SPACING;
        result.get(o)!.walk = { period, at(seconds) {
          // Begin partway down the first half; neighbours are one district slot apart around the cycle.
          const cycle = ((seconds / period + 0.25 + rank / district.length) % 1 + 1) % 1;
          const t = (cycle <= 0.5 ? cycle : 1 - cycle) * period;
          let end = 1;
          while (end < steps && times[end]! < t) end++;
          const f = (t - times[end - 1]!) / (times[end]! - times[end - 1]!);
          const a = path[end - 1]!, b = path[end]!;
          return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f + dy];
        } };
      });
    }));
  }
  routeCache.set(objects, { key, layouts: result });
  return result;
}
