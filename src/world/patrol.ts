import { isSide, walkFacing, type Dir } from '../art/geom.ts';
import { TILE } from '../content/terrain.ts';
import type { MapObject } from '../content/tiled.ts';
import { EASE } from '../render/motion.ts';
import type { Box, Collision } from './collision.ts';
import type { PatrolWalk } from './patrol_walk.ts';
import { entranceNotices, withinNotice, type PatrolNotice } from './patrol_notice.ts';

/** Playable seconds before another patrol can notice or fight after a patrol battle. */
export const PATROL_FIGHT_GRACE = 2;

/** Distance from the leader at which a clear chase becomes a tackle. */
export const TACKLE_REACH = 2.5 * TILE;
/** Tackle speed as a multiple of the unchanged chase speed. */
export const TACKLE_SPEED = 1.8;
/** Longest a jump lasts: a hit homes on the leader this long at most; a miss lasts as long as its way to the leader at jump speed, if less. */
export const TACKLE_SECONDS = 0.35;
/**
 * Chance that a jump misses: the guard skids and falls, and cannot fight until it is back up. Each guard rolls for
 * itself, so either one's hit starts the fight and both must miss for the party to get away: one time in four when
 * both jump, as the owner set it (2026-10-23: "Could you set it so that the get away chance is 1 in 4?"), after a
 * third (2026-10-20) had the pair catching the party eight times in nine.
 */
export const TACKLE_MISS_CHANCE = 1 / 2;
/** Gap left by a miss, outside the two figures' contact reach. */
export const TACKLE_MISS_GAP = TILE;
/** Seconds spent decelerating after a missed jump. */
export const TACKLE_SKID_SECONDS = 0.35;
/** Seconds lying flat before getting back up. */
export const TACKLE_DOWN_SECONDS = 0.5;
/** Seconds spent springing upright before walking home. */
export const TACKLE_RECOVER_SECONDS = 0.2;
/** Height of the tackle arc in world units. */
export const TACKLE_LIFT = 12;
/** Fraction of the jump used by the airborne arc before its landing squash. */
export const TACKLE_AIR_FRACTION = 0.75;
/** Vertical stretch while airborne: as much as a fighter's waiting hop (`hopPose`), no more (the owner, 2026-10-20). */
export const TACKLE_AIR_SQUASH = 1.05;
/** Vertical squash at landing, where a skid starts: the waiting hop's deepest. */
export const TACKLE_LAND_SQUASH = 0.87;
/** Forward lean in radians during the jump. */
export const TACKLE_LEAN = 0.22;
/** Backward lean in radians while skidding. */
export const TACKLE_SKID_LEAN = -0.28;
/** The squash a skid eases off to from its landing, before it tips over (the owner, 2026-10-20: it looked static). */
export const TACKLE_SKID_SQUASH = 0.94;
/** How far through its skid a missed guard starts to tip forward onto its face. */
export const TACKLE_TIP_AT = 0.6;
/** Vertical squash while down. */
export const TACKLE_DOWN_SQUASH = 0.87;
/** Forward tip in radians while down: fallen on its face, then rocked back upright as it gets up. */
export const TACKLE_DOWN_LEAN = 1.45;

/**
 * How far past its own territory a pursuit follows the party: three tiles' walk over open ground,
 * never through another patrol's territory. Out of the martial-arts alleys that is the street's
 * width, stopping at the lanes beyond; into a neighbouring alley, no further than its mouth.
 */
export const CHASE_REACH = 3 * TILE;

function within(b: Box, x: number, y: number): boolean {
  return x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1;
}

const tileKey = (tx: number, ty: number) => ty * 4096 + tx;
const STEPS: ReadonlyArray<readonly [number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

/** The tiles a pursuit may follow into: the territory's own, then CHASE_REACH's worth of steps to open neighbours, diagonals not cutting a corner. */
function reachTiles(collision: Collision, territory: readonly Box[], others: readonly Box[]): Set<number> {
  const closed = (tx: number, ty: number) =>
    collision.cellSolid(tx, ty) || others.some((b) => within(b, (tx + 0.5) * TILE, (ty + 0.5) * TILE));
  const reach = new Set<number>();
  let frontier: Array<[number, number]> = [];
  for (const b of territory) {
    for (let ty = Math.floor(b.y0 / TILE); ty < Math.ceil(b.y1 / TILE); ty++) {
      for (let tx = Math.floor(b.x0 / TILE); tx < Math.ceil(b.x1 / TILE); tx++) {
        if (collision.cellSolid(tx, ty) || reach.has(tileKey(tx, ty))) continue;
        reach.add(tileKey(tx, ty));
        frontier.push([tx, ty]);
      }
    }
  }
  for (let step = 0; step < CHASE_REACH / TILE; step++) {
    const next: Array<[number, number]> = [];
    for (const [tx, ty] of frontier) {
      for (const [dx, dy] of STEPS) {
        const nx = tx + dx, ny = ty + dy;
        if (reach.has(tileKey(nx, ny)) || closed(nx, ny) || (dx && dy && (closed(nx, ty) || closed(tx, ny)))) continue;
        reach.add(tileKey(nx, ny));
        next.push([nx, ny]);
      }
    }
    frontier = next;
  }
  return reach;
}

/** A territory on the map: every area with its name, taken together as one shape. */
export function territoryBoxes(objects: readonly MapObject[], name: unknown): Box[] {
  return objects.filter((z) => z.type === 'area' && z.name === name).map((z) => ({ x0: z.x, y0: z.y, x1: z.x + z.w, y1: z.y + z.h }));
}

/** The territories of every other pursuing patrol on the map, which a pursuit never enters. */
export function otherTerritories(objects: readonly MapObject[], name: unknown): Box[] {
  const names = new Set(objects.filter((o) => o.type === 'enemy' && o.props.behavior === 'pursue' && o.props.territory !== name).map((o) => o.props.territory));
  return [...names].flatMap((n) => territoryBoxes(objects, n));
}

/** The movement part of an actor, kept independent of its drawing for simulation checks. */
export interface PatrolBody {
  x: number;
  y: number;
  homeX: number;
  homeY: number;
  facing: Dir;
  moving: boolean;
  alert: boolean;
  lift?: number;
  squash?: number;
  lean?: number;
  /** The side a ball last faced, for one that has rolled to face up or down. */
  side?: 'left' | 'right';
  /** Knocked silly: drawn with crossed eyes. */
  dazed?: boolean;
}

export interface PatrolOptions {
  /** Alley notice plus facing-dependent sidewalk/street sight. Close same-alley notice needs no walking corridor. */
  notice?: PatrolNotice;
  /** Shared alley schedule, absent for single pairs and special bridge guards. */
  walk?: PatrolWalk;
  /** The top half hands its exact midpoint to the bottom half. */
  upperHalfEnd?: number;
  /** Full shared alley: nearby clear targets also get noticed across the pair's half boundary. */
  nearbyTerritory?: readonly Box[];
  /** Bridge sentries keep pursuing across their map once alerted. */
  relentless?: boolean;
  /** Stagger an authored patrol without consuming the combat/random movement stream. */
  initialPause?: number;
  /** Omitted patrols keep Beijing's fixed chase speed. Evaluated each update for speed pickups. */
  chaseSpeed?: () => number;
  /** Screen exposure adjustment, chosen once on fresh acquisition and held through tackles/recovery. */
  warningTiming?: (target: { x: number; y: number }, speed: number) => { scale: number; hesitation: number; offscreen?: boolean };
  /** Refresh a clear final chase leg between path searches, so a small speed advantage can close the gap. */
  directTarget?: boolean;
  /** Re-acquire on territory re-entry during return or cooldown, while still respecting notice/grace protection. */
  reacquire?: boolean;
  /** Notice re-entry and fight on contact during the return walk or home pause; grace still protects the party. */
  alertWhileReturning?: boolean;
  /** Stay strictly inside the territory, including when chasing or returning home. */
  confined?: boolean;
  /** Enables tackles; World supplies Beijing's separate seeded stream, or a probe supplies a forced roll. */
  tackleRoll?: () => number;
}

/** A short patrol, immediate pursuit on entering its territory, then a walk home with optional continued vigilance. */
export class Patrol {
  state: 'patrol' | 'chase' | 'tackle' | 'skid' | 'down' | 'recover' | 'return' = 'patrol';
  chaseScale = 1;
  warningLeft = 0;
  edgeWarning = false;
  private missed = false;
  private tackleTime = 0;
  private tackleDuration = TACKLE_SECONDS;
  /** A miss's speed through the air, which the skid slows from to a stop (see the chase). */
  private missSpeed = 0;
  private jumpSpeed = 0;
  private jumpDir: [number, number] = [1, 0];
  private tackleReady = true;
  private rest = 0;
  private cooldown = 0;
  private noticeAllowed = true;
  private repath = 0;
  private destination: [number, number] | null = null;
  private end = true;
  private path: Array<[number, number]> = [];
  readonly body: PatrolBody;
  private readonly collision: Collision;
  /** Original movement territory, retained independently of fresh notice boundaries. */
  readonly territory: readonly Box[];
  private readonly others: readonly Box[];
  private readonly reach: Set<number>;
  private readonly offset: [number, number];
  private readonly options: PatrolOptions;
  private walkTime = 0;
  /** A close cross-half encounter keeps pursuit in this same alley until disengagement. */
  private sharedAlleyChase = false;

  get walk(): PatrolWalk | undefined { return this.options.walk; }

  constructor(
    body: PatrolBody,
    collision: Collision,
    territory: readonly Box[],
    offset: [number, number],
    others: readonly Box[] = [],
    options: PatrolOptions = {},
  ) {
    this.body = body;
    this.collision = collision;
    this.territory = territory;
    this.others = others;
    this.reach = reachTiles(collision, territory, others);
    this.offset = offset;
    this.options = options;
    this.rest = options.initialPause ?? 0;
    if (options.walk) {
      [body.x, body.y] = options.walk.at(0);
      const next = options.walk.at(1 / 60);
      body.facing = walkFacing(next[0] - body.x, next[1] - body.y, body.facing);
    }
  }

  /** The tiles, as [tx, ty], a pursuit may follow the party into: for the developer overlay. */
  reachTiles(): Array<[number, number]> {
    return [...this.reach].map((k): [number, number] => [k % 4096, Math.floor(k / 4096)])
      .filter(([x, y]) => !this.options.confined || this.inside((x + .5) * TILE, (y + .5) * TILE));
  }

  get canFight(): boolean { return !this.missed && this.noticeAllowed && (Boolean(this.options.alertWhileReturning) || (this.state !== 'return' && this.cooldown <= 0)); }

  /** World actors are reused in battle; hand their pose back before formation movement starts. */
  prepareForFight(): void {
    this.warningLeft = 0;
    this.edgeWarning = false;
    if (this.options.tackleRoll) this.pose();
  }

  /** Whether the point is in the original half-alley movement territory. */
  inside(x: number, y: number): boolean {
    return y < (this.options.upperHalfEnd ?? Infinity) && this.territory.some((b) => within(b, x, y));
  }

  /** Entering the alley alerts in either facing; sidewalk and near-road acquisition depend on facing. */
  notices(x: number, y: number): boolean {
    const notice = this.options.notice;
    return notice ? withinNotice(notice.territory, x, y) ||
      (this.inReach(x, y) && entranceNotices(notice.entrances, this.body, this.collision, x, y)) : this.inside(x, y);
  }

  /**
   * Whether this guard, walking its post undisturbed at this patrol clock, would start a chase at (x, y). It reads the
   * schedule and the notice rules and changes nothing, so a caller can look ahead at who will be watching when.
   * The facing is the way the guard last moved, as in a real update. A guard thrown off its walk (chasing, returning) is not modelled.
   */
  noticesWalking(clock: number, x: number, y: number): boolean {
    const walk = this.options.walk, notice = this.options.notice;
    if (!walk || !notice) return false;
    ({ x, y } = this.collision.standingOn(x, y));
    const [bx, by] = walk.at(clock);
    let facing: Dir = this.body.facing;
    for (let back = 1 / 60; back <= 4; back += back < 0.5 ? 1 / 60 : 0.25) {
      const [px, py] = walk.at(clock - back);
      if (Math.hypot(bx - px, by - py) > 0.01) { facing = walkFacing(bx - px, by - py, facing); break; }
    }
    const body = { x: bx, y: by, facing };
    return withinNotice(notice.territory, x, y) ||
      (this.inReach(x, y) && entranceNotices(notice.entrances, body, this.collision, x, y)) ||
      (withinNotice(notice.nearbyTerritory, x, y) && Math.hypot(x - bx, y - by) <= TACKLE_REACH);
  }

  get noticeTerritory(): readonly Box[] { return this.options.notice?.territory ?? this.territory; }

  /** Whether a pursuit goes on here: its own territory, or within CHASE_REACH's walk of it outside every other patrol's. */
  inReach(x: number, y: number): boolean {
    if (this.options.relentless && this.state === 'chase') return true;
    return this.inside(x, y) || (this.sharedAlleyChase && Boolean(this.options.nearbyTerritory?.some(b => within(b, x, y)))) || (!this.options.confined && this.reach.has(tileKey(Math.floor(x / TILE), Math.floor(y / TILE))) && !this.others.some((b) => within(b, x, y)));
  }

  private change(state: Patrol['state']): void {
    if (state === 'return' || state === 'patrol') {
      this.sharedAlleyChase = false;
      this.chaseScale = 1;
      this.warningLeft = 0;
      this.edgeWarning = false;
    }
    this.state = state;
    this.repath = 0;
    this.destination = null;
    this.path = [];
    this.body.alert = state === 'chase' || (state === 'tackle' && !this.missed);
    this.tackleTime = 0;
    // A miss lands side-on, so its skid and fall read on a ball that had rolled to face up or down an alley.
    if (state === 'skid' && !isSide(this.body.facing)) {
      this.body.facing = Math.abs(this.jumpDir[0]) > 0.01 ? (this.jumpDir[0] < 0 ? 'left' : 'right') : this.body.side ?? 'right';
    }
  }

  update(dt: number, target: { x: number; y: number }, mayNotice = true, clock = this.walkTime + dt): void {
    target = this.collision.standingOn(target.x, target.y);
    this.walkTime = clock;
    this.noticeAllowed = mayNotice;
    const a = this.body;
    const nearby = mayNotice && Boolean(this.options.nearbyTerritory?.some(b => within(b, target.x, target.y))) &&
      Math.hypot(target.x - a.x, target.y - a.y) <= TACKLE_REACH &&
      this.collision.clearLine(a.x, a.y, target.x, target.y);
    const nearbyNotice = this.options.notice
      ? mayNotice && withinNotice(this.options.notice.nearbyTerritory, target.x, target.y) &&
        Math.hypot(target.x - a.x, target.y - a.y) <= TACKLE_REACH
      : nearby;
    // A chase/tackle crossing the midpoint at close range must not immediately turn away.
    if (nearby && !this.inside(target.x, target.y) && a.alert) this.sharedAlleyChase = true;
    a.moving = false;
    this.repath -= dt;
    this.rest = Math.max(0, this.rest - dt);
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (this.options.tackleRoll) {
      this.pose();
      if (this.state === 'tackle' && (!mayNotice || (!this.missed && !this.inReach(target.x, target.y)))) {
        this.change(this.missed ? 'skid' : 'return');
      }
      if (['tackle', 'skid', 'down', 'recover'].includes(this.state)) {
        this.updateTackle(dt, target);
        return;
      }
    }
    if (this.state === 'chase') {
      // Running around the bend or away from the post does not end pursuit, and it follows a few tiles into
      // the adjoining streets. Another patrol's alley ends it, so no group chases through a street into the next lane.
      if (!mayNotice || !this.inReach(target.x, target.y)) this.change('return');
    }
    // Alley entry alerts regardless of facing. Only fresh sidewalk/street notice depends on facing;
    // close cross-half notice stays inside the alley so it cannot bypass sidewalk stealth.
    const ready = this.options.reacquire || this.options.alertWhileReturning ? this.state !== 'chase' : this.state === 'patrol' && this.cooldown === 0;
    if (ready && !this.missed && mayNotice && (this.notices(target.x, target.y) || nearbyNotice)) {
      if (nearbyNotice && !this.inside(target.x, target.y)) this.sharedAlleyChase = true;
      this.cooldown = 0;
      this.change('chase');
      const timing = this.options.warningTiming?.(target, this.options.chaseSpeed?.() ?? 179.4);
      this.chaseScale = Math.max(.05, Math.min(1, timing?.scale ?? 1));
      this.warningLeft = Math.max(0, timing?.hesitation ?? 0);
      this.edgeWarning = timing?.offscreen ?? this.warningLeft > 0;
    }
    if (this.state === 'chase') {
      // Remain in chase while hesitating: the bridge's mandatory-encounter exit lock still applies.
      if (this.warningLeft > 0) {
        this.warningLeft = Math.max(0, this.warningLeft - dt);
        a.facing = walkFacing(target.x - a.x, target.y - a.y, a.facing);
        return;
      }
      const speed = (this.options.chaseSpeed?.() ?? 179.4) * this.chaseScale;
      const distance = Math.hypot(target.x - a.x, target.y - a.y);
      if (distance > TACKLE_REACH) this.tackleReady = true;
      if (this.options.tackleRoll && !this.options.relentless && !this.options.confined && this.tackleReady &&
          mayNotice && distance > 0 && distance <= TACKLE_REACH && this.collision.clearLine(a.x, a.y, target.x, target.y)) {
        this.missed = this.options.tackleRoll() < TACKLE_MISS_CHANCE;
        this.jumpSpeed = speed * TACKLE_SPEED;
        this.jumpDir = [(target.x - a.x) / distance, (target.y - a.y) / distance];
        this.tackleDuration = this.missed ? Math.min(TACKLE_SECONDS, distance / this.jumpSpeed) : TACKLE_SECONDS;
        // A miss moves all the way, evenly through the air and then slowing from that speed in the skid, to a halt
        // TACKLE_MISS_GAP from where the leader stood.
        this.missSpeed = Math.max(0, distance - TACKLE_MISS_GAP) / (this.tackleDuration + TACKLE_SKID_SECONDS / 2);
        this.tackleReady = false;
        this.change('tackle');
        this.updateTackle(dt, target);
      } else this.go(target.x, target.y, speed, dt, true);
      return;
    }
    if (this.state === 'return') {
      const [x, y] = this.options.walk?.at(clock) ?? [a.homeX, a.homeY];
      if (this.go(x, y, 80, dt, Boolean(this.options.confined))) {
        this.change('patrol');
        this.missed = false;
        this.tackleReady = true;
        this.rest = 1.2;
        this.cooldown = 1.2;
        this.end = true;
      }
      return;
    }
    if (this.options.walk) {
      const [x, y] = this.options.walk.at(clock);
      a.moving = Math.hypot(x - a.x, y - a.y) > 0.01;
      if (a.moving) a.facing = walkFacing(x - a.x, y - a.y, a.facing);
      a.x = x; a.y = y;
      return;
    }
    if (this.rest > 0) return;
    const x = a.homeX + (this.end ? this.offset[0] : 0);
    const y = a.homeY + (this.end ? this.offset[1] : 0);
    if (this.go(x, y, 40, dt, true)) {
      this.end = !this.end;
      this.rest = 0.6;
      this.path = [];
      this.repath = 0;
      this.destination = null;
    }
  }

  private pose(lift = 0, squash = 1, lean = 0, dazed = false): void {
    this.body.lift = lift;
    this.body.squash = squash;
    this.body.lean = lean;
    this.body.dazed = dazed;
  }

  /** All jump and skid motion uses the same solid feet collision as walking. */
  private tackleMove(dx: number, dy: number, turn: boolean): boolean {
    const a = this.body;
    const [x, y] = this.collision.move(a.x, a.y, dx, dy);
    if (!this.inReach(x, y)) return false;
    const moved = Math.hypot(x - a.x, y - a.y);
    a.moving = moved > 0.01;
    if (a.moving && turn) a.facing = walkFacing(x - a.x, y - a.y, a.facing);
    a.x = x; a.y = y;
    return moved >= Math.hypot(dx, dy) - 0.01;
  }

  private updateTackle(dt: number, target: { x: number; y: number }): void {
    const a = this.body;
    const duration = this.state === 'tackle' ? this.tackleDuration : this.state === 'skid' ? TACKLE_SKID_SECONDS
      : this.state === 'down' ? TACKLE_DOWN_SECONDS : TACKLE_RECOVER_SECONDS;
    const stepTime = Math.min(dt, Math.max(0, duration - this.tackleTime));
    this.tackleTime = Math.min(duration, this.tackleTime + dt);
    const progress = this.tackleTime / duration;
    if (this.state === 'tackle' || this.state === 'skid') {
      const jumping = this.state === 'tackle';
      const dx = target.x - a.x, dy = target.y - a.y, distance = Math.hypot(dx, dy);
      const direction = this.missed ? this.jumpDir : distance > 0 ? [dx / distance, dy / distance] : this.jumpDir;
      let stride = this.missed ? this.missSpeed * stepTime * (jumping ? 1 : 1 - progress) : Math.min(this.jumpSpeed * stepTime, distance);
      if (this.missed) {
        // Never within TACKLE_MISS_GAP of the leader: a party walking in only brings the halt sooner, and the guard
        // is never pushed back.
        const along = dx * direction[0]! + dy * direction[1]!;
        const across2 = distance * distance - along * along;
        if (along > 0 && across2 < TACKLE_MISS_GAP ** 2) stride = Math.min(stride, Math.max(0, along - Math.sqrt(TACKLE_MISS_GAP ** 2 - across2)));
      }
      const clear = this.tackleMove(direction[0]! * stride, direction[1]! * stride, jumping);
      if (jumping) {
        const air = progress / TACKLE_AIR_FRACTION, land = (progress - TACKLE_AIR_FRACTION) / (1 - TACKLE_AIR_FRACTION);
        if (air < 1) this.pose(TACKLE_LIFT * Math.sin(Math.PI * air), TACKLE_AIR_SQUASH, TACKLE_LEAN);
        // A hit lands and springs back into the chase; a miss lands flat on its feet and squashes into its skid.
        else if (!this.missed) this.pose(0, 1 - (1 - TACKLE_LAND_SQUASH) * Math.sin(Math.PI * land), TACKLE_LEAN);
        else this.pose(0, 1 - (1 - TACKLE_LAND_SQUASH) * EASE.out(land), TACKLE_LEAN * (1 - land));
        if (!clear && !this.missed) { this.change('chase'); this.pose(); return; }
      } else this.skidPose(progress);
    // Down on its face and getting up, it is knocked silly (crossed eyes, the owner, 2026-10-20), until it is back on
    // its feet.
    } else if (this.state === 'down') this.pose(0, TACKLE_DOWN_SQUASH, TACKLE_DOWN_LEAN, true);
    else this.pose(TACKLE_LIFT * 0.5 * Math.sin(Math.PI * progress), TACKLE_DOWN_SQUASH + (1 - TACKLE_DOWN_SQUASH) * progress, TACKLE_DOWN_LEAN * (1 - progress), true);
    if (this.tackleTime >= duration) {
      if (this.state === 'tackle') this.change(this.missed ? 'skid' : 'chase');
      else if (this.state === 'skid') { this.change('down'); a.moving = false; this.pose(0, TACKLE_DOWN_SQUASH, TACKLE_DOWN_LEAN, true); }
      else if (this.state === 'down') this.change('recover');
      // Back up, it chases on while the party is in its reach as usual (the owner, 2026-10-20: "they probably should not
      // give up if the player is just standing there"), and walks home otherwise.
      else { this.missed = false; this.change(this.noticeAllowed && this.inReach(target.x, target.y) ? 'chase' : 'return'); this.pose(); }
    }
  }

  /**
   * The skid, `k` of the way through: the landing's squash eases off as it rocks back against the slide; then,
   * slowing, it tips forward faster and faster until it lands flat on its face, where it lies down.
   */
  private skidPose(k: number): void {
    if (k < TACKLE_TIP_AT) {
      const e = EASE.smooth(k / TACKLE_TIP_AT);
      this.pose(0, TACKLE_LAND_SQUASH + (TACKLE_SKID_SQUASH - TACKLE_LAND_SQUASH) * e, TACKLE_SKID_LEAN * e);
      return;
    }
    const fall = ((k - TACKLE_TIP_AT) / (1 - TACKLE_TIP_AT)) ** 2;
    this.pose(0, TACKLE_SKID_SQUASH + (TACKLE_DOWN_SQUASH - TACKLE_SKID_SQUASH) * fall, TACKLE_SKID_LEAN + (TACKLE_DOWN_LEAN - TACKLE_SKID_LEAN) * fall);
  }

  /** Keep a route until the destination changes or movement is blocked; sample moving targets every 0.25 s. */
  private go(x: number, y: number, speed: number, dt: number, confined: boolean): boolean {
    const a = this.body;
    if (Math.hypot(x - a.x, y - a.y) < 0.5) return true;
    if (this.repath <= 0 && (!this.destination || x !== this.destination[0] || y !== this.destination[1])) {
      this.repath = 0.25;
      this.destination = [x, y];
      if (this.collision.clearLine(a.x, a.y, x, y)) this.path = [[x, y]];
      else {
        const found = this.collision.findPathNear(a.x, a.y, x, y, false);
        // Use the actual target before checking the boundary: its tile centre can already be
        // in the street while the target's feet are still inside the alley mouth.
        this.path = found.reached ? this.collision.straighten(a.x, a.y, [...found.path, [x, y]]) : [];
      }
      // A pursuit must never go beyond its reach, or find a shortcut through a street into another lane.
      if (confined && this.path.some(([px, py]) => !this.inReach(px, py))) {
        this.path = [];
        if (this.state === 'chase') this.change('return');
        return false;
      }
    }
    if (((this.state === 'chase' && this.options.directTarget) || (this.state === 'return' && this.options.walk)) &&
        this.path.length <= 1 && this.collision.clearLine(a.x, a.y, x, y)) {
      this.path = [[x, y]];
      this.destination = [x, y];
    }
    const to = this.path[0];
    if (!to) return false;
    const dx = to[0] - a.x, dy = to[1] - a.y;
    const d = Math.hypot(dx, dy);
    if (d < 0.5) { this.path.shift(); return false; }
    const step = Math.min(d, speed * dt);
    const [nx, ny] = this.collision.move(a.x, a.y, dx / d * step, dy / d * step);
    if (confined && !this.inReach(nx, ny)) { this.change('return'); return false; }
    a.moving = Math.hypot(nx - a.x, ny - a.y) > 0.01;
    if (a.moving) a.facing = walkFacing(nx - a.x, ny - a.y, a.facing);
    else this.destination = null;
    a.x = nx;
    a.y = ny;
    if (Math.hypot(to[0] - a.x, to[1] - a.y) < 0.5) this.path.shift();
    return Math.hypot(x - a.x, y - a.y) < 0.5;
  }
}
