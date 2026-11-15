/**
 * Beijing's solid cells as separate tall buildings, seen front on as the street's shops are (the owner, 2026-11-01: "multi-story
 * buildings ... high enough that the roofs that you see will actually be above things", and "What we don't want to see is 99% rooftop").
 * A building's wall and thin roof together cover its own cells on the screen and rise over the next building back, never over ground
 * someone can walk on. Pure, so it can be read and tested without drawing anything.
 */
export const GROUND_FLOOR = 40;
export const FLOOR = 36;
/** No building is less than a ground floor and its roof, even where that means standing in front of a little of the paving behind it (the owner, 2026-11-01: the small ones before the tank "should be at least 50% taller"). */
const LEAST_TOTAL = 53;
/** How far a wall stands in from a cell beside open ground, in world units: a figure at the cell's edge doesn't cut into it. */
export const WALL_INSET = 6;

/** Where the plan meets Beijing's map, found on it (beijingFrame in src/world/beijing_streets.ts) so a move in Tiled moves the buildings too. */
export interface PlanFrame {
  /** The rows along each street where a few solid cells sit under the shops; no building stands on those. */
  edges: ReadonlySet<number>;
  /** North of this row are the tank square's own edges, where the checkpoint's barrier stands just behind them and has to show. */
  pastSquare: number;
  /**
   * How far the city has moved in Tiled since its buildings were laid out (12 Nov), in cells: a building's looks, and those set by hand,
   * go by its cell as it was numbered then.
   */
  moved: { c: number; r: number };
}

/** How far a figure can go in behind a building, in world units, about half of them hidden (the owner, 2026-11-01: "the player can go at least a little behind all of the buildings"). */
export const BEHIND = 14;
const CELL = 32;

/**
 * How much of a building's solid cell really stops a figure, in world units; null for all of it. A building's real foot is its front, so a
 * figure stops at the wall where that foot shows. Further back on the screen it stands among the upper storeys, and goes in behind them.
 */
export function solidPart(c: number, r: number, width: number, isOpen: (c: number, r: number) => boolean, frame: PlanFrame): { x0: number; y0: number; x1: number; y1: number } | null {
  // On the map's own edge a cell stays whole, or a figure could reach an edge with no way out there; so do the tank square's, whose bounds run along them.
  if (frame.edges.has(r) || c === 0 || c === width - 1 || r < frame.pastSquare) return null;
  const side = isOpen(c, r + 1) ? WALL_INSET : BEHIND;
  // Where this cell meets another solid one only at a corner, that corner stays closed, or a figure could squeeze between them into the next alley.
  const touches = (dir: -1 | 1) => isOpen(c + dir, r) && isOpen(c, r - 1) && !isOpen(c + dir, r - 1);
  const [left, right] = [touches(-1), touches(1)];
  return {
    x0: c * CELL + (isOpen(c - 1, r) ? (left ? WALL_INSET : side) : 0),
    y0: r * CELL + (isOpen(c, r - 1) && !left && !right ? BEHIND : 0),
    x1: (c + 1) * CELL - (isOpen(c + 1, r) ? (right ? WALL_INSET : side) : 0),
    y1: (r + 1) * CELL,
  };
}

/**
 * Three set by hand, by their first cell as numbered on 12 Nov (PlanFrame.moved) (the owner, 2026-11-01): at the top of the second alley from the right they stood up to the base of the
 * building behind, so the way on to the tank square looked like a dead end. The first two are drawn lower, the last has less wall over its door and window.
 */
const SET_LOWER: Readonly<Record<string, { drop: number; wall?: number; total?: number }>> = {
  '19,20': { drop: 30 },
  '18,21': { drop: 30 },
  '18,22': { drop: 0, wall: 35, total: 49 },
};

/**
 * Floors set by hand, by their first cell as numbered on 12 Nov (the owner, 2026-11-09): the three houses on the lake's edge, free to rise over the water
 * behind them, came out much alike, so one stands tall, one stays low and one is between.
 */
const SET_FLOORS: Readonly<Record<string, number>> = { '20,8': 3, '23,8': 1, '26,8': 2 };

export type TallStyle = 'gallery' | 'balconies' | 'loggias' | 'timber' | 'plain';
export type TallRoof = 'pitched' | 'flat';

export interface TallBlock {
  id: number;
  /** Its cells, inclusive. */
  c0: number; c1: number; r0: number; r1: number;
  insetL: number; insetR: number;
  floors: number;
  /** Heights in upright units: of each floor over the ground floor, of the wall, and of the wall and roof together. */
  floorH: number; wall: number; total: number;
  /** How much further it could rise before it reached open ground. */
  room: number;
  /** How far below its cells it is drawn, in world units. */
  drop: number;
  style: TallStyle;
  roof: TallRoof;
  look: number;
  /** How many buildings stand in front of it. */
  seed: number;
  /** It stands over a walkway behind it: nothing kept on a flat roof, which would show over the people on it. */
  bare?: boolean;
}

/**
 * Where the plan may go past the map's cells. `over`: walkway cells the buildings in front of them rise over, so whoever walks there
 * goes in behind them (the owner, 2026-11-04: the lakeside street, where "the buildings somewhat obscure the road", and Beijing's foot,
 * where "the player should disappear behind the buildings by several lengths"). `below`: rows of buildings past the map's last row,
 * in two ranks, one in front of the other as the alleys' buildings stand, for the look of a bigger city.
 */
export interface PlanReach {
  over?: (c: number, r: number) => boolean;
  /**
   * For a walkway cell buildings stand over, a share of the walkway set by hand for the buildings in front of it, from column `from`
   * on: under 1 leaves its far side showing, over 1 rises over what is past it. A building never straddles two such stretches.
   */
  cover?: (c: number, r: number) => { from: number; share: number } | undefined;
  below?: number;
  /** How much shorter the ground is drawn, once the view tips, than `rowHeight` has it; heights are drawn upright regardless. */
  squash?: number;
}
/** The most a building stretches low in the view (TallCity.update), which one standing over a walkway allows for. */
const LOW_STRETCH = 1.07;
/** How much of a walkway the buildings standing over it cover where no share is set by hand: varied, so they aren't all one height
 * (the owner, 2026-11-04), from a little short of its far side to a little over the ground past it, as figures go a little behind
 * buildings everywhere in the city. */
const COVERS = [0.78, 0.92, 1.05, 1.15, 1.22];
/** How deep the rank of buildings past the map's foot that stands over the walkway is, in rows; the rest stand in front of it. */
const REAR_RANK = 2;
/** How tall each of the rank in front is, as a share of the walkway's far side: most lower than the rank behind, so that one shows
 * over them, and a few taller, rising a little past it as the tallest behind do (the owner, 2026-11-04: not "shoulder to shoulder"
 * but "some are visually in front of behind others"). */
const NEAR_RANK = [0.6, 0.7, 0.8, 0.95, 1.1];

export const hash = (a: number, b: number, k: number): number => {
  const s = Math.sin(a * 127.1 + b * 311.7 + k * 74.7) * 43758.5453;
  return s - Math.floor(s);
};

export function planBlocks(width: number, height: number, isSolid: (c: number, r: number) => boolean, isWater: (c: number, r: number) => boolean, rowHeight: number, frame: PlanFrame, reachOpts: PlanReach = {}): TallBlock[] {
  const at = (c: number, r: number, k: number) => hash(c - frame.moved.c, r - frame.moved.r, k);
  const then = (c: number, r: number) => `${c - frame.moved.c},${r - frame.moved.r}`;
  const over = reachOpts.over ?? (() => false);
  // The rows past the map's foot are all buildings.
  const rows = height + (reachOpts.below ?? 0);
  // The first row of the rank in front, past the foot.
  const near = height + REAR_RANK;
  const owner = new Int32Array(width * rows).fill(-1);
  const solid = (c: number, r: number) => c >= 0 && c < width && r >= 0 && (r >= height ? r < rows : isSolid(c, r) && !frame.edges.has(r));
  const free = (c: number, r: number) => solid(c, r) && owner[r * width + c]! < 0;
  const boxes: Array<{ c0: number; c1: number; r0: number; r1: number }> = [];
  // Which walkway the first open ground north of a cell is, if buildings stand over it, and which stretch of it: '' if none.
  const overKey = (k: number, r: number) => {
    let o = r;
    while (o >= 0 && solid(k, o)) o--;
    if (o < 0 || !over(k, o)) return '';
    const set = reachOpts.cover?.(k, o);
    return set ? `${o}:${set.from}` : `${o}`;
  };
  // From the south: a building's front is its southern edge, and the next one back starts where it ends.
  for (let r = rows - 1; r >= 0; r--) {
    for (let c = 0; c < width; c++) {
      if (!free(c, r)) continue;
      let e = c;
      while (free(e + 1, r)) e++;
      for (let a = c; a <= e;) {
        let w = 3 + Math.floor(at(a, r, 1) * 3);
        if (e - a + 1 - w < 2) w = e - a + 1;
        // One that would reach past the end of a walkway buildings stand over stops there, so it can rise over all of it or none.
        for (let k = a + 1; k < a + w; k++) if (overKey(k, r) !== overKey(a, r)) { w = k - a; break; }
        // Past the foot, one doesn't end where the one in front of it does, so it reads as standing behind it rather than beside it.
        const ends = (k: number) => owner[near * width + k] !== owner[near * width + k + 1];
        // Never down to no width: a building one column wide here would become empty and the row would never finish
        // (a walkway stopping two columns short of the right edge froze the tab entering Beijing; Fable review C3).
        if (r === near - 1 && near < rows && a + w - 1 < e && ends(a + w - 1)) w += e - a - w >= 2 ? 1 : w > 1 ? -1 : 0;
        const b = a + w - 1;
        const want = 4 + Math.floor(at(a, r, 2) * 3);
        let top = r;
        while (top - 1 >= 0 && r - top + 1 < want) {
          let clear = true;
          for (let k = a; k <= b; k++) clear &&= free(k, top - 1);
          if (!clear || r >= near && top - 1 < near) break;
          // Stop where what is behind runs wider than this, so it can run on behind as one building.
          if (r - top + 1 >= 2 && (free(c - 1, top - 1) || free(e + 1, top - 1))) break;
          top--;
        }
        for (let y = top; y <= r; y++) for (let k = a; k <= b; k++) owner[y * width + k] = boxes.length;
        boxes.push({ c0: a, c1: b, r0: top, r1: r });
        a = b + 1;
      }
      c = e;
    }
  }
  const looks: number[] = [];
  // A walkway is open ground running on up or down the map. A short stretch beside one is only a corner, which a tall building may stand in front of.
  const open = (c: number, r: number) => c >= 0 && c < width && r >= 0 && r < height && !isSolid(c, r) && !isWater(c, r);
  const corner = (c: number, r: number) => {
    if (!open(c, r)) return false;
    let run = 1;
    for (let y = r - 1; open(c, y) && run < 5; y--) run++;
    for (let y = r + 1; open(c, y) && run < 5; y++) run++;
    return run < 5;
  };
  return boxes.map((box, id) => {
    const { c0, c1, r0, r1 } = box;
    // The nearest walkway north of it, column by column, is as far as it may rise; over a walkway it may stand over, as far as
    // whatever is past that. Water is no walkway: a house on the lake's edge may rise over it (the owner, 2026-11-09).
    let reach = Infinity;
    // How many rows of walkway it stands in front of; and, further back from one, how tall it may be drawn short of it.
    let walk = Infinity;
    let cap = Infinity;
    for (let k = c0; k <= c1; k++) {
      let o = r0 - 1;
      let across = 0;
      while (o >= 0) {
        if (over(k, o)) { across++; o--; continue; }
        if (across || !(solid(k, o) || corner(k, o) || isWater(k, o) || frame.edges.has(o) && isSolid(k, o))) break;
        o--;
      }
      if (o >= 0) reach = Math.min(reach, r1 - o);
      if (across) walk = Math.min(walk, across);
      // Further back from the walkway it may rise over it too, short of its far side as drawn; where those in front have a share set
      // by hand, only to its near side, so that share holds.
      if (across && !over(k, r0 - 1)) {
        const near = o + across;
        cap = Math.min(cap, (r1 - (reachOpts.cover?.(k, near) ? near : o)) * rowHeight * (reachOpts.squash ?? 1) / LOW_STRETCH);
      }
    }
    const most = reach * rowHeight;
    const depth = (r1 - r0 + 1) * rowHeight;
    const rise = FLOOR * [0.2, 0.7, 1.2, 1.7, 2.2][Math.floor(at(c0, r1, 3) * 5)]!;
    // Right in front of a walkway it stands over, it rises over a share of it: set by hand for the stretch, or varied.
    const standsOver = Number.isFinite(walk) && over(c0, r0 - 1);
    const share = standsOver ? reachOpts.cover?.(c0, r0 - 1)?.share ?? COVERS[Math.floor(at(c0, r1, 12) * COVERS.length)]! : 0;
    // In the rank in front past the foot, it is varied within the most it may be, so the rank behind shows over some.
    const nearRank = r0 >= near && r0 < rows && Number.isFinite(cap);
    // A thin roof always; what is left is floors, a little taller or shorter to fit, which also sets one building off from the next.
    const band = 13 + at(c1, r1, 9) * 8;
    const setFloors = SET_FLOORS[then(c0, r0)];
    const total = setFloors ? GROUND_FLOOR + band + (setFloors - 1) * (FLOOR + 2)
      : standsOver ? (most - walk * rowHeight * (1 - share)) * (reachOpts.squash ?? 1) / LOW_STRETCH
      : nearRank ? cap * NEAR_RANK[Math.floor(at(c0, r1, 19) * NEAR_RANK.length)]! : Math.max(r1 >= frame.pastSquare ? LEAST_TOTAL : 0, Math.min(depth + rise, most, cap));
    const cols = c1 - c0 + 1;
    const above = total - band - GROUND_FLOOR;
    const uppers = above < FLOOR * 0.8 ? 0 : Math.max(1, Math.round(above / (FLOOR + 2)));
    const floors = uppers + 1;
    const floorH = uppers ? above / uppers : FLOOR;
    const wall = uppers ? total - band : Math.max(16, total - band);
    const side = (dir: number, c: number) => {
      for (let y = r0; y <= r1; y++) if (c + dir >= 0 && c + dir < width && !(y >= height ? solid(c + dir, y) : isSolid(c + dir, y))) return true;
      return false;
    };
    const pick = at(c1, r0, 4);
    const style: TallStyle = cols < 2 ? 'plain' : floors <= 2 || floors === 3 && pick < 0.2 ? 'timber' : pick < 0.45 ? 'gallery' : pick < 0.78 ? 'balconies' : 'loggias';
    const roof: TallRoof = style === 'timber' || at(c0, r0, 5) < 0.45 ? 'pitched' : 'flat';
    // No two neighbours in the same materials.
    let look = Math.floor(at(c0, r1, 6) * 5);
    if (id > 0 && looks[id - 1] === look) look = (look + 1 + Math.floor(at(c1, r1, 7) * 3)) % 5;
    looks.push(look);
    const set = SET_LOWER[then(c0, r0)];
    return { id, ...box, insetL: side(-1, c0) ? WALL_INSET : 0, insetR: side(1, c1) ? WALL_INSET : 0, floors, floorH, wall: set?.wall ?? wall, total: set?.total ?? total, room: most - total, drop: set?.drop ?? 0, style, roof, look, seed: at(c0, r1, 8) * 1000, ...(standsOver ? { bare: true } : {}) };
  });
}

export type SpanKind = 'washing' | 'wires' | 'lanterns';
/** The lowest a line across an alley hangs, over the heads of people walking under it. */
export const MIN_HIGH = 56;
/** What crosses an alley high up, from wall to wall: its cells, its row and height. */
/** `top` is as high as its line may go, under the lower of the two walls it hangs between. */
export interface TallSpan { c0: number; c1: number; row: number; high: number; top: number; kind: SpanKind; seed: number }

export function planSpans(width: number, height: number, isSolid: (c: number, r: number) => boolean, isLane: (c: number, r: number) => boolean, blocks: readonly TallBlock[], moved: PlanFrame['moved']): TallSpan[] {
  const hashAt = (c: number, r: number, k: number) => hash(c - moved.c, r - moved.r, k);
  const at = (c: number, r: number) => blocks.find((b) => c >= b.c0 && c <= b.c1 && r >= b.r0 && r <= b.r1);
  const spans: TallSpan[] = [];
  const lastAt = new Map<number, number>();
  for (let r = height - 2; r >= 0; r--) {
    for (let c = 1; c < width - 1; c++) {
      if (!isLane(c, r) || isSolid(c - 1, r) === false) continue;
      let e = c;
      while (e + 1 < width && isLane(e + 1, r)) e++;
      const [left, right] = [at(c - 1, r), at(e + 1, r)];
      const mid = (c + e) >> 1;
      if (left && right && e - c < 3 && r < left.r1 && r < right.r1 && (lastAt.get(mid) ?? 1e9) - r > 7 + hashAt(c, r, 20) * 5) {
        const most = Math.min(left.wall, right.wall);
        if (most >= 74) {
          const pick = hashAt(c, r, 21);
          const kind: SpanKind = pick < 0.42 ? 'washing' : pick < 0.92 ? 'wires' : 'lanterns';
          const high = MIN_HIGH + hashAt(c, r, 22) * (most - 10 - MIN_HIGH);
          spans.push({ c0: c, c1: e, row: r, high, top: most - 10, kind, seed: hashAt(e, r, 23) * 1000 });
          lastAt.set(mid, r);
        }
      }
      c = e;
    }
  }
  return spans;
}
