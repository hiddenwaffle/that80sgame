import { dirVector, type Dir } from '../art/geom.ts';
import { TILE } from '../content/terrain.ts';
import type { Actor } from '../world/actor.ts';
import { FEET_H } from '../world/collision.ts';
import type { World } from '../world/world.ts';

/**
 * Where everyone stands in a fight. Positions are worked out from the shape of
 * the screen: the two sides face each other left and right, and on an upright
 * screen up and down where the ground leaves the columns no room.
 */

/**
 * Whether a fight lays out side to side. The fight, its interface, and scripted
 * formations all use this one rule, so the menus never cover the enemies.
 */
export function wideBattle(panel: { w: number; h: number }): boolean {
  return panel.w > panel.h * 1.1;
}

/**
 * Where a fight may put people: spots a short walk from where it started, never much
 * further on foot than in a straight line. That keeps a fight on one side of the walls,
 * so in the maze no one is placed in the next corridor over.
 */
export interface Ground {
  ok(x: number, y: number): boolean;
  /** How many steps longer than a straight line the walk to a point is, or undefined if it is not a short walk. */
  detour(x: number, y: number): number | undefined;
  /** Spots already given out, kept apart so no two people stand on each other. */
  taken: Array<[number, number]>;
}

/** How far on foot, in tiles, each tile is from a point, out to `limit` tiles. */
export function groundFrom(world: World, x: number, y: number, limit = 16): Ground {
  const c = world.collision;
  const w = world.map.width;
  const tileOf = (px: number, py: number): [number, number] => [Math.floor(px / TILE), Math.floor((py - 1) / TILE)];
  const walkable = (tx: number, ty: number) => !c.cellSolid(tx, ty) && !c.blocked(tx * TILE + TILE / 2, ty * TILE + TILE / 2 + FEET_H / 2);
  const [sx, sy] = tileOf(x, y);
  const dist = new Map<number, number>([[sy * w + sx, 0]]);
  const queue: Array<[number, number]> = [[sx, sy]];
  for (let q = 0; q < queue.length; q++) {
    const [tx, ty] = queue[q]!;
    const d = dist.get(ty * w + tx)!;
    if (d >= limit) continue;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = tx + dx;
      const ny = ty + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= world.map.height || dist.has(ny * w + nx) || !walkable(nx, ny)) continue;
      dist.set(ny * w + nx, d + 1);
      queue.push([nx, ny]);
    }
  }
  const detour = (px: number, py: number) => {
    const [tx, ty] = tileOf(px, py);
    const d = dist.get(ty * w + tx);
    return d === undefined ? undefined : d - Math.abs(tx - sx) - Math.abs(ty - sy);
  };
  return {
    taken: [],
    detour,
    ok(px, py) {
      // Someone in a fight has to be seen.
      if (world.tall?.hides(px, py, 1 / world.ground)) return false;
      // Two steps of slack allow for stepping round a palm or a lamp, not round a wall. Two people
      // each allowed two can still be only four steps apart beyond a straight line.
      const d = detour(px, py);
      return d !== undefined && d <= 2;
    },
  };
}

/** Where the party would stand, in a triangle pointing `dir` around a point, before walls and others are taken into account. */
function triangle(x: number, y: number, dir: Dir, depth = 1, spread = 30): Array<[number, number]> {
  const [fx, fy] = dirVector(dir);
  const [sx, sy] = [-fy, fx];
  return [
    [x + fx * 14 * depth, y + fy * 14 * depth],
    [x - fx * 24 * depth + sx * spread, y - fy * 24 * depth + sy * spread],
    [x - fx * 24 * depth - sx * spread, y - fy * 24 * depth - sy * spread],
  ];
}

/** The party in a triangle pointing `dir`, around a point. */
export function formationSpots(world: World, x: number, y: number, dir: Dir, _wide: boolean, ground: Ground = groundFrom(world, x, y)): Array<[number, number]> {
  return triangle(x, y, dir).map(([px, py]) => freeSpot(world, px, py, ground));
}

export interface BattleLayout {
  centre: [number, number];
  party: Array<[number, number]>;
  enemies: Array<[number, number]>;
  partyFacing: Dir;
  enemyFacing: Dir;
}

/** A figure's drawn reach from its feet, before zoom and after ground projection. */
export interface FighterShape { halfW: number; above: number; below: number }

export function formationBounds(spots: Array<[number, number]>, shapes: FighterShape[], ground: number) {
  const boxes = spots.map(([x, y], i) => {
    const s = shapes[i]!;
    return { left: x - s.halfW, right: x + s.halfW, top: y * ground - s.above, bottom: y * ground + s.below };
  });
  return {
    left: Math.min(...boxes.map(b => b.left)), right: Math.max(...boxes.map(b => b.right)),
    top: Math.min(...boxes.map(b => b.top)), bottom: Math.max(...boxes.map(b => b.bottom)), boxes,
  };
}

/** How far, in world units, an upright fight's two columns may run past their room before rows are tried instead, where the fight may shrink to fit. */
const COLUMN_SLACK = 13;

/**
 * Where everyone stands in a fight. On a wide screen the two sides face each other left and
 * right, the enemies keeping the side they are on. On an upright screen, phone or tablet
 * (`room`), they do too, as two columns, unless the ground leaves no room for that. Where the
 * ground forces rows, and upright with no room given, they face each other up and down: the enemies above the party,
 * since the command menu and the status box fill the bottom of the panel and enemies below
 * the party would be under them; only when that would crowd someone against a wall, or put
 * them where the fight cannot reach on foot, do they stand below. A staged encounter can lock
 * the upright facing to preserve its approach direction.
 */
export function battleLayout(world: World, party: Actor[], enemies: Actor[], wide: boolean, room?: { w: number; h: number; shapes?: FighterShape[]; shrinks?: boolean }, uprightFacing?: 'up' | 'down'): BattleLayout {
  const leader = party[0]!;
  const ex = enemies.reduce((s, e) => s + e.x, 0) / enemies.length;
  if (room && !wide) {
    // In the room, shorten the gap and flatten the party's triangle before reducing readability.
    // Every candidate still uses the same walkable-ground and separation rules.
    const actors = [...party, ...enemies];
    const shapes = room.shapes ?? actors.map(a => ({ halfW: a.size * 1.5, above: a.size * 2.7, below: 8 * world.ground }));
    const toward: Dir = ex >= leader.x ? 'right' : 'left';
    type Fit = { lay: BattleLayout; score: number; contact: number; overflow: number };
    const fit = (facings: readonly Dir[], slack = 8): Fit => {
      let best: Fit | undefined;
      let separated: Fit | undefined;
      for (const facing of facings) for (const gap of [1, 0.8, 0.6, 0.5, 0.4, 0.35, 0.3, 0.25, 0.2]) for (const depth of [1, 0.5, 0]) {
        // Side by side, the enemies' line runs down the room, whose height is the ground's depth drawn shorter.
        const across = facing === 'left' || facing === 'right';
        const candidate = layoutFacing(world, party, enemies, facing, { gap, depth, width: across ? room.h / world.ground : room.w });
        const spots = [...candidate.lay.party, ...candidate.lay.enemies];
        const bounds = formationBounds(spots, shapes, world.ground);
        const overflow = Math.max(0, bounds.right - bounds.left - room.w)
          + Math.max(0, bounds.bottom - bounds.top - room.h);
        // Prefer keeping the two sides visibly apart in a formation that fits. The
        // conservative boxes include cursor room, so applying this hard priority
        // within the party would needlessly pull its triangle apart.
        const clearance = 4;
        let overlap = 0;
        let contact = 0;
        for (const [i, a] of bounds.boxes.entries()) for (let j = i + 1; j < bounds.boxes.length; j++) {
          const b = bounds.boxes[j]!;
          const dx = Math.min(a.right, b.right) - Math.max(a.left, b.left);
          const dy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
          overlap += Math.max(0, dx) * Math.max(0, dy);
          if (i < party.length && j >= party.length) {
            contact += Math.max(0, dx + clearance) * Math.max(0, dy + clearance);
          }
        }
        const score = overflow * 10000 + candidate.cost + (facing === 'down' || (across && facing !== toward) ? TILE * 2 : 0)
          + overlap * 100 + (1 - gap) * TILE * 2 + (1 - depth) * TILE * 0.4;
        const here = { lay: candidate.lay, score, contact, overflow };
        if (!best || score < best.score) best = here;
        // Eight world units may use the boxes' cursor/feet padding. Beyond that,
        // the tank or cramped terrain needs the existing best-fit fallback rather
        // than spreading the fight past the viewport to eliminate every contact.
        if (overflow <= slack && (!separated || contact < separated.contact || (contact === separated.contact && score < separated.score))) {
          separated = here;
        }
      }
      return (separated ?? best)!;
    };
    if (uprightFacing) return fit([uprightFacing]).lay;
    // Two columns, as on a wide screen (the owner, 2026-11-06: they read better on an upright phone than two rows, which
    // on a tall phone stood most of a screen apart; 2026-11-15, the same on an upright tablet). Rows only where the ground
    // leaves the columns no room: they would run off the room, or the two sides would touch more than in rows. Where both
    // run off it, whichever runs off less. Where the fight may shrink (a tablet, or a phone short enough), columns may run
    // further off it than rows before giving way: the fight then shrinks to fit, to about 85% on the smallest phones.
    const slack = room.shrinks ? COLUMN_SLACK : 8;
    const side = fit(['left', 'right'], slack);
    if (side.overflow <= slack && side.contact === 0) return side.lay;
    const rows = fit(['up', 'down']);
    if (side.overflow > slack) return rows.overflow < side.overflow ? rows.lay : side.lay;
    return rows.overflow <= 8 && rows.contact < side.contact ? rows.lay : side.lay;
  }
  if (wide) return layoutFacing(world, party, enemies, ex >= leader.x ? 'right' : 'left').lay;
  if (uprightFacing) return layoutFacing(world, party, enemies, uprightFacing).lay;
  const up = layoutFacing(world, party, enemies, 'up');
  if (up.cost === 0) return up.lay;
  const down = layoutFacing(world, party, enemies, 'down');
  return down.cost + 2 * TILE < up.cost ? down.lay : up.lay;
}

/**
 * A fight laid out side to side whatever the screen's shape: the party in one column facing right, the enemies in
 * another to their right, as for the Warsaw Pac (the owner, 2026-10-05: the fight stays sideways on phones because
 * his rifle points sideways, and the column leaves the ground clear for his ricochets). With `room` (a phone at its
 * fixed zoom), the column is closer and the gap between the sides narrows to fit the width.
 */
export function columnLayout(world: World, party: Actor[], enemies: Actor[], room?: { w: number; h: number; shapes?: FighterShape[] }): BattleLayout {
  const leader = party[0]!;
  const ex = enemies.reduce((s, e) => s + e.x, 0) / enemies.length;
  const ey = enemies.reduce((s, e) => s + e.y, 0) / enemies.length;
  const cx = (leader.x + ex) / 2;
  let cy = (leader.y + ey) / 2;
  const shapes = room?.shapes;
  const partyW = shapes ? Math.max(...shapes.slice(0, party.length).map((s) => s.halfW)) : leader.size * 1.5;
  const enemyW = shapes ? Math.max(...shapes.slice(party.length).map((s) => s.halfW)) : enemies[0]!.size * 1.5;
  const gap = room ? Math.min(TILE * 4.4, room.w - partyW - enemyW - 12) : TILE * 4.4;
  const spread = room ? 36 : 44;
  // Down the column from its middle: 0, then one above, one below, and on out.
  const offsets = (n: number) => Array.from({ length: n }, (_, i) => (i === 0 ? 0 : Math.ceil(i / 2) * (i % 2 ? -1 : 1)) * spread);
  const start = groundFrom(world, leader.x, leader.y);
  const fitsColumn = (y: number) => [
    ...offsets(party.length).map(dy => [cx - gap / 2, y + dy]),
    ...offsets(enemies.length).map(dy => [cx + gap / 2, y + dy]),
  ].every(([x, py]) => !world.collision.blocked(x!, py!) && start.ok(x!, py!));
  // Move the whole formation off an edge before freeSpot has to bend an individual member sideways.
  // Keep an already clear column exactly where it was; ordinary master formations use battleLayout.
  if (!fitsColumn(cy)) {
    for (let distance = 1; distance <= TILE * 6; distance++) {
      const y = [cy + distance, cy - distance].find(fitsColumn);
      if (y !== undefined) { cy = y; break; }
    }
  }
  const lead = freeSpot(world, cx - gap / 2, cy, start);
  const ground = groundFrom(world, lead[0], lead[1]);
  ground.taken.push(lead);
  // The others line up on where the leader could stand, which may be off the column's middle.
  const partySpots = offsets(party.length).map((dy, i) => (i === 0 ? lead : freeSpot(world, lead[0], lead[1] + dy, ground)));
  const enemySpots = offsets(enemies.length).map((dy) => freeSpot(world, cx + gap / 2, cy + dy, ground));
  return { centre: [cx, cy], party: partySpots, enemies: enemySpots, partyFacing: 'right', enemyFacing: 'left' };
}

/**
 * The fight laid out with the party facing `partyFacing`, and what it costs: how far, in all,
 * people had to move from where the layout wanted them, with a large extra for anyone who
 * could not be put a short walk from the fight.
 */
function layoutFacing(world: World, party: Actor[], enemies: Actor[], partyFacing: Dir, compact?: { gap: number; depth: number; width: number }): { lay: BattleLayout; cost: number } {
  const leader = party[0]!;
  const ex = enemies.reduce((s, e) => s + e.x, 0) / enemies.length;
  const ey = enemies.reduce((s, e) => s + e.y, 0) / enemies.length;
  const wide = partyFacing === 'left' || partyFacing === 'right';
  const enemyFacing: Dir = ({ right: 'left', left: 'right', up: 'down', down: 'up' } as const)[partyFacing];
  const [fx, fy] = dirVector(partyFacing);
  // Up and down, the tilted ground is drawn shorter, so the sides stand further apart to look the same.
  const gap = (wide ? 4.4 : 4.0 / world.ground) * TILE * (compact?.gap ?? 1);
  const cx = (leader.x + ex) / 2;
  const cy = (leader.y + ey) / 2;
  const partyCentre: [number, number] = [cx - (fx * gap) / 2, cy - (fy * gap) / 2];
  const enemyCentre: [number, number] = [cx + (fx * gap) / 2, cy + (fy * gap) / 2];
  const [sx, sy] = [-fy, fx];
  const n = enemies.length;
  const normalSpacing = Math.max(1.35 * TILE, ...enemies.map((e) => e.size * 2.6));
  const spacing = compact ? Math.min(normalSpacing, Math.max(TILE * 0.8, (compact.width - Math.max(...enemies.map(e => e.size)) * 3) / Math.max(1, n - 1))) : normalSpacing;
  const want: Array<[number, number]> = [
    ...triangle(partyCentre[0], partyCentre[1], partyFacing, compact?.depth, compact ? 36 : 30),
    ...enemies.map((_, i): [number, number] => {
      const off = (i - (n - 1) / 2) * spacing;
      // Stagger bigger groups so they do not form a flat wall.
      const stagger = n > 2 && i % 2 === 1 ? 0.5 * TILE * (compact?.depth ?? 1) : 0;
      return [enemyCentre[0] + sx * off + fx * stagger, enemyCentre[1] + sy * off + fy * stagger];
    }),
  ];
  // Everyone is placed on the leader's side of any wall. The leader's place must be a short walk from
  // where the leader stands now; everyone else's, a short walk from the leader's place. (Measured only from
  // the start, two people could each be near it but on either side of a wall from each other.)
  const start = groundFrom(world, leader.x, leader.y);
  const lead = freeSpot(world, want[0]![0], want[0]![1], start);
  const ground = groundFrom(world, lead[0], lead[1]);
  ground.taken.push(lead);
  const got = [lead, ...want.slice(1).map(([x, y]) => freeSpot(world, x, y, ground))];
  const fits = (i: number, [x, y]: [number, number]) => (i === 0 ? start : ground).ok(x, y);
  const cost = got.reduce((sum, p, i) => sum + Math.hypot(p[0] - want[i]![0], p[1] - want[i]![1]) + (fits(i, p) ? 0 : 50 * TILE), 0);
  return { lay: { centre: [cx, cy - TILE * 0.4], party: got.slice(0, 3), enemies: got.slice(3), partyFacing, enemyFacing }, cost };
}

/**
 * The nearest point to (x, y) where a figure can stand. Given the fight's ground, only
 * a spot a short walk from the fight, and clear of spots already given out; if there is
 * none, the nearest open point, so a fight always has somewhere to stand.
 */
/** How far apart freeSpot keeps fighters when it can. */
export const FIGHTER_APART = TILE * 0.8;

export function freeSpot(world: World, x: number, y: number, ground?: Ground, allowed?: (x: number, y: number) => boolean): [number, number] {
  const c = world.collision;
  const apart = FIGHTER_APART;
  // Level 2: a short walk away and clear of others; 1: a short walk away; 0: anywhere open.
  const fits = (px: number, py: number, level: number) =>
    !c.blocked(px, py) && (!allowed || allowed(px, py)) &&
    (level < 1 || !ground || ground.ok(px, py)) &&
    (level < 2 || !ground || ground.taken.every(([tx, ty]) => Math.hypot(tx - px, ty - py) >= apart));
  const search = (level: number, most: number): [number, number] | null => {
    if (fits(x, y, level)) return [x, y];
    for (let r = 6; r <= most; r += 6) {
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2;
        const px = x + Math.cos(a) * r;
        const py = y + Math.sin(a) * r;
        if (fits(px, py, level)) return [px, py];
      }
    }
    return null;
  };
  const spot = (ground ? (search(2, 192) ?? search(1, 192)) : null) ?? search(0, 96) ?? [x, y];
  ground?.taken.push(spot);
  return spot;
}
