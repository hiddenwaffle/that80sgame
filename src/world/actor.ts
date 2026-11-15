import { Container, Graphics, GraphicsContext, Matrix } from 'pixi.js';
import { LOOKS, type LookId, type LookInfo, type Pose } from '../art/characters.ts';
import { drawFire } from '../art/fire.ts';
import { drawLookArt, headPoint, LOOK_ART, wholeSpan } from '../art/lookArt.ts';
import { foilClock } from '../art/ghostFoil.ts';
import { LOOK } from '../render/look.ts';
import type { Dir } from '../art/geom.ts';
import type { MapObject } from '../content/tiled.ts';
import { motion } from '../render/motion.ts';
import { blinking } from '../art/blink.ts';
import { clearIfInked } from '../render/clear_if_inked.ts';
/** How long a figure shows hurt after a blow, in seconds. */
export const HURT_TIME = 0.4;
/** Seconds each turn of a head shake lasts, one way or the other. */
export const SHAKE_TURN = 0.22;
/** Seconds a fighter's waiting hop takes: up, down and the landing. */
export const HOP_SECONDS = 0.6;
/** Reused for each figure's body transform as it is drawn (Actor.render). */
const UPRIGHT = new Matrix();

/**
 * Code-drawn poses, each drawn once and kept: a figure switches to its pose's kept drawing instead of drawing it again,
 * which made Pixi rebuild the shapes' triangles on every mouth step and blink (about 575 a second on the Beijing street,
 * 1 ms of its 1.8 ms frame; the owner picked this over pictures of each pose on 5 Nov 2026). Keeping every pose there took
 * 57 MB more JS heap, so only the walk's poses are kept (about 200 to 240 there, 12 to 15 MB): blinks and the rare states
 * are drawn each time, as before. Kept per drawing (a look, or a walker's own outfit, at a size), and let go with it when
 * the last figure drawn with it goes: leaving a map lets go of its walkers' outfits, which are made again on the next visit.
 */
const KEPT = new Map<string, { figures: number; poses: Map<string, GraphicsContext> }>();
const DRAWING_IDS = new WeakMap<LookInfo, number>();
let drawings = 0;

function drawingId(info: LookInfo): number {
  let id = DRAWING_IDS.get(info);
  if (id === undefined) DRAWING_IDS.set(info, (id = ++drawings));
  return id;
}

function keptPose(drawing: string, pose: string, draw: (g: Graphics) => void): GraphicsContext {
  const poses = KEPT.get(drawing)!.poses;
  let context = poses.get(pose);
  if (!context) {
    context = new GraphicsContext();
    const g = new Graphics(context);
    draw(g);
    // A Graphics given its context leaves it alone when destroyed.
    g.destroy();
    poses.set(pose, context);
  }
  return context;
}

/** How many drawings have poses kept, and how many poses in all, for the checks. */
export function keptPoseCount(): { drawings: number; poses: number } {
  let poses = 0;
  for (const k of KEPT.values()) poses += k.poses.size;
  return { drawings: KEPT.size, poses };
}

/**
 * A fighter's hop on the spot while it waits its turn (the owner, picking from the idle ideas on 2026-10-16: "D Little
 * hops looks pretty good"): up for a little over half the time, stretched a touch in the air, a squash on landing,
 * leaning a little toward the enemy throughout. `x` counts hops; the lift is in radii, a squash below 1 is flatter,
 * the lean is in radians toward the way they face. Drawn by moving and scaling the figure: no frames of its own.
 */
export function hopPose(x: number): { lift: number; squash: number; lean: number } {
  const k = x - Math.floor(x);
  if (k < 0.55) return { lift: 0.3 * Math.sin((Math.PI * k) / 0.55), squash: 1.05, lean: 0.04 };
  if (k < 0.75) return { lift: 0, squash: 1 - 0.13 * Math.sin((Math.PI * (k - 0.55)) / 0.2), lean: 0.04 };
  return { lift: 0, squash: 1, lean: 0.04 };
}

export type ActorKind = 'party' | 'npc' | 'enemy';

/**
 * Anything that stands on a map and can move: party members, townspeople, and
 * enemies. Positions are the feet, in world units. The figure is redrawn only
 * when its pose changes.
 */
export class Actor {
  readonly id: string;
  readonly kind: ActorKind;
  look: LookId;
  x: number;
  y: number;
  facing: Dir = 'down';
  /**
   * The side a rolling ball last faced. Facing up or down it is drawn facing this side, turned a quarter, so
   * its eyes show on the side it rolled from; it starts on a side picked from its name, so each keeps its own.
   * A townsperson at rest turns to it after facing up or down for a moment.
   */
  side: 'left' | 'right';
  /** World units a second. */
  speed = 96;
  moving = false;
  talking = false;
  /** The closing narration's synchronized hop and chomp, scoped by the story. */
  celebrating = false;
  hidden = false;
  ko = false;
  hurt = 0;
  /** Beaten but still standing for last words: it shudders and flickers, again and again, until hidden. */
  dying = false;
  /** Extra height, for hops and dives. */
  lift = 0;
  /** Squash and stretch: 1 is normal. */
  squash = 1;
  /** Forward lean in radians for scripted world poses, signed by facing when drawn. */
  lean = 0;
  /** Knocked silly by a scripted world pose (a patrol guard down after a missed tackle): drawn with crossed eyes. */
  dazed = false;
  /** In a fight, set by the battle each step: a ball waiting its turn hops on the spot (see `hopPose`). */
  hopping = false;
  /** Where in its hops this figure is when the others are at 0, so a line of fighters is not in step. */
  hopPhase = 0;
  /** Seconds hopped: it runs only while hopping, and not while a page holds the fight. */
  private hopT = 0;
  /** Tie-breaker for draw order when figures stand at the same height (the leader wins). */
  zBias = 0;
  /** Scripted moves under way. While any run, the world leaves `moving` to them. */
  scripted = 0;
  readonly obj: MapObject | null;
  readonly view = new Container();
  private readonly shadow = new Graphics();
  /** The figure: its art where its look has some for the pose, else its code drawing. The checks read where it is drawn. */
  readonly body = new Container();
  private readonly vec = new Graphics();
  /** The figure's own drawing, for poses that are not kept; `vec` shows a kept pose's drawing otherwise. */
  private readonly ownDrawing = this.vec.context;
  /** The drawing (a look or outfit, at a size) whose kept poses this figure shows. */
  private drawing: string | null = null;
  private readonly artView = new Container();
  private poseKey = '';
  private appearance: { look: LookId; info: LookInfo } | null = null;
  private phase = 0;
  homeX: number;
  homeY: number;
  /** The way a townsperson faces at rest, left or right, from the map; they turn back to it after looking about. */
  homeFacing: Dir = 'down';
  /**
   * A townsperson at rest facing up or down: seconds left before they turn to their side. Below 0 while they walk or
   * face a side.
   */
  turnIn = -1;
  /** Behaviour state for wandering and patrols. */
  aiTimer = 0;
  aiDir = 1;
  /** The patrol has noticed the party; drawn upright above its head. */
  alert = false;
  private readonly alertMark = new Graphics();
  path: Array<[number, number]> = [];
  /** A townsperson's idle moves: seconds to the next one, and seconds left looking another way. */
  idleTimer = 0;
  glance = 0;
  /**
   * Shaking their head, as at a bad pun: the facing to turn back to after, and how long it has gone on.
   * Null when not shaking.
   */
  shaking: { from: Dir; t: number } | null = null;
  /** How grown the figure is drawn, 0 to 1: someone appearing on the map pops up from nothing. */
  grow = 1;
  /** Eyes shut for a scripted [blink], on top of the occasional natural ones. */
  blinkNow = false;
  /**
   * How much of its HP is lost, 0 to 1, set by its fight: with the look's `wreck` the tank is battered from half
   * down and smokes and burns as it goes, and the Warsaw Pac smokes.
   */
  damage = 0;
  /** The flames and smoke of `damage`, over the figure, and their own clock, which stands still with the game's steps. */
  private readonly fire = new Graphics();
  private fireT = 0;
  private rifleAge = Infinity;
  private rifleRounds = 0;

  /** Visual kick for each round; feet and gameplay position never move. */
  startRifleBurst(rounds: number): void {
    this.rifleAge = 0;
    this.rifleRounds = rounds;
  }

  get riflePose(): { x: number; y: number; turn: number } {
    if (motion.reduced || this.hidden || this.ko || this.dying || this.hurt > 0 || !this.rifleRounds)
      return { x: 0, y: 0, turn: 0 };
    const since = this.rifleAge - Math.min(this.rifleRounds - 1, Math.floor(this.rifleAge / .07)) * .07;
    const kick = since < .2 ? Math.sin(Math.min(1, since / .018) * Math.PI / 2) * Math.exp(-since * 22) : 0;
    const dir = this.facing === 'right' ? 1 : -1;
    return { x: -dir * this.size * .18 * kick, y: this.size * .045 * kick, turn: -dir * .065 * kick };
  }

  constructor(id: string, kind: ActorKind, look: LookId, x: number, y: number, obj: MapObject | null = null) {
    this.id = id;
    this.kind = kind;
    this.look = look;
    this.x = x;
    this.y = y;
    this.homeX = x;
    this.homeY = y;
    this.obj = obj;
    let h = 0;
    for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) | 0;
    this.side = h & 1 ? 'left' : 'right';
    this.fire.label = 'actor_fire';
    // Hidden until a render has drawn a picture into it: a figure culled from its first frame has none, and reads as not drawn.
    this.artView.visible = false;
    this.body.addChild(this.vec, this.artView, this.fire);
    this.view.addChild(this.shadow, this.body);
    this.alertMark.roundRect(-4, -42, 8, 20, 3).fill(0xffd23f).stroke({ width: 1.2, color: 0x201b24 });
    this.alertMark.rect(-1, -39, 2, 9).circle(0, -26, 1.2).fill(0x201b24);
    this.alertMark.visible = false;
    this.view.addChild(this.alertMark);
    const size = this.size;
    this.shadow.ellipse(0, 0, size * 0.85, size * 0.28).fill({ color: 0x000000, alpha: 0.22 });
  }

  get size(): number {
    return LOOKS[this.look].size;
  }

  /** A generated civilian outfit, built once; switching to another look restores that look's own art. */
  setAppearance(info: LookInfo): void {
    this.appearance = { look: this.look, info };
    this.poseKey = '';
  }

  /** Mouth opening: while walking or talking it cycles shut, half, wide, half. */
  private mouthStep(): number {
    if (this.celebrating && motion.reduced) return 1;
    if (!this.moving && !this.talking && !this.celebrating) return 0;
    return [0, 1, 2, 1][Math.floor(this.phase / 0.05) % 4]!;
  }

  update(dt: number): void {
    this.fireT += dt;
    if (this.hopping) this.hopT += dt;
    this.rifleAge += dt;
    if (this.moving || this.talking || this.celebrating) this.phase += dt;
    else this.phase = 0;
    if (this.hurt > 0) this.hurt = Math.max(0, this.hurt - dt);
    if (this.dying && this.hurt <= 0) this.hurt = HURT_TIME;
    // A head shake turns from side to side, starting away from where they faced; with reduced motion they
    // look away and hold it.
    const sh = this.shaking;
    if (sh) {
      sh.t += dt;
      const away = sh.from === 'left' ? 'right' : 'left';
      const back = away === 'left' ? 'right' : 'left';
      this.facing = motion.reduced || Math.floor(sh.t / SHAKE_TURN) % 2 === 0 ? away : back;
    }
  }

  /** Starts a head shake; `stopShaking` turns them back the way they faced. */
  startShaking(): void {
    if (!this.shaking) this.shaking = { from: this.facing, t: 0 };
  }

  stopShaking(): void {
    if (!this.shaking) return;
    this.facing = this.shaking.from;
    this.shaking = null;
  }

  startCelebrating(): void {
    this.celebrating = true;
    this.phase = 0;
  }

  stopCelebrating(): void {
    this.celebrating = false;
    if (!this.moving && !this.talking) this.phase = 0;
  }

  render(t: number): void {
    // The giant's foil moves on the world's clock, read as it is drawn.
    foilClock.t = t;
    this.view.visible = !this.hidden;
    this.alertMark.visible = this.alert && !this.ko;
    this.alertMark.y = -this.lift;
    if (this.hidden) return;
    const step = this.mouthStep();
    // A hurt figure flickers, or with reduced motion shows hurt steadily for the same time.
    const hurt = this.hurt > 0 && (motion.reduced || Math.floor(this.hurt * 20) % 2 === 0);
    this.drawnHurt = hurt;
    if (this.facing === 'left' || this.facing === 'right') this.side = this.facing;
    // A rolling ball facing up or down is its side view turned a quarter, a hat and all: mouth up or down, eyes to
    // one side.
    const custom = this.appearance?.look === this.look ? this.appearance.info : null;
    const info = custom ?? LOOKS[this.look];
    const roll = Boolean(info.rolls) && !this.ko && (this.facing === 'up' || this.facing === 'down');
    const drawFacing = roll ? this.side : this.facing;
    const turn = !roll ? 0 : (this.facing === 'up') === (this.side === 'right') ? -Math.PI / 2 : Math.PI / 2;
    const wrecks = LOOK.has('wreck') && (this.look === 'tank' || this.look === 'boss');
    const blink = (blinking(this.id, t, this.ko, this.hurt > 0, motion.reduced) || (this.blinkNow && !motion.reduced)) && !this.dazed;
    // An upright figure drawn from its picture (the ghosts) looks the same at every walk step, so neither step nor walking is in
    // its key: its picture was rebuilt 20 times a second with the same result (Fable review P15). The hop still reads `step`.
    const still = LOOK_ART[this.look as LookId]?.kind === 'upright' && this.artView.visible;
    const key = `${this.look}|${drawFacing}|${turn}|${still ? 0 : step}|${still ? false : this.moving}|${this.ko}|${hurt}|${blink}|${this.dazed}|${wrecks && this.damage >= 0.5}|${!this.artView.visible && this.look.startsWith('ghost') ? Math.floor(t * 8) : 0}`;
    if (key !== this.poseKey) {
      this.poseKey = key;
      const pose = { facing: drawFacing, mouth: step / 2, moving: this.moving, t, ko: this.ko, hurt, blink, dazed: this.dazed, damage: this.damage };
      this.drawnPose = pose;
      const drawn = !custom && drawLookArt(this.artView, this.look, pose, this.size);
      this.artView.visible = drawn;
      // A ghost's skirt wobbles with the clock (the key's last part), so its poses are all drawn each time. Of the rest only
      // the walk is kept: a blink and the hurt, knocked-out and dazed states are brief. A rolling ball's quarter turn turns
      // the figure rather than its drawing, so it shares the side view's.
      const drawing = this.look.startsWith('ghost') ? null : `${drawingId(info)}|${this.size}`;
      this.vec.context = this.ownDrawing;
      this.useDrawing(drawing);
      if (drawing !== null && !drawn && !blink && !hurt && !this.ko && !this.dazed) {
        const id = `${drawFacing}|${step}|${this.moving}|${wrecks && this.damage >= 0.5}`;
        this.vec.context = keptPose(drawing, id, (g) => info.draw(g, pose, this.size));
      } else {
        this.vec.clear();
        if (!drawn) info.draw(this.vec, pose, this.size);
      }
    }
    const size = this.size;
    // A blow lands: the figure jolts side to side, three quick cycles at the start of its hurt (held still with reduced motion).
    const since = HURT_TIME - this.hurt;
    this.jolt = this.hurt > 0 && !motion.reduced && since < 0.15 ? Math.sin((since / 0.15) * Math.PI * 6) * size * 0.15 : 0;
    clearIfInked(this.fire);
    this.drawnFire = 0;
    if (wrecks) this.drawDamage(this.fireT);
    // Closing gag: half-up, top, half-down, ground at five hops a second,
    // with the mouth matching the height. Feet, shadows and collision stay put.
    const hop = this.celebrating && !motion.reduced ? 11 * step / 2 : 0;
    // Waiting in a fight, a ball hops; standing on its feet as it squashes, and leaning from them.
    const wait = this.hopping && info.rolls && !motion.reduced && !this.ko && this.hurt <= 0 && !this.moving && !this.celebrating
      ? hopPose(this.hopT / HOP_SECONDS + this.hopPhase) : null;
    // A scripted pose (a patrol's tackle) rests with reduced motion, as the hops do, and leans only a ball seen
    // side-on: one rolled to face up or down would tip sideways or over.
    const squash = (motion.reduced ? 1 : this.squash) * (wait?.squash ?? 1);
    const lean = (motion.reduced || turn ? 0 : this.lean + (wait ? wait.lean : 0)) * (drawFacing === 'left' ? -1 : 1);
    const lift = motion.reduced ? 0 : this.lift;
    const rifle = this.riflePose;
    // Squash and stretch stay upright on screen however the ball is turned or leans, so a guard down on its face or
    // getting up is never drawn taller than standing (the owner, 2026-10-20: "only as tall as they normally are");
    // and it rests on the ground, tipping forward from its feet rather than sinking through them.
    const angle = turn + rifle.turn + lean, cos = Math.cos(angle), sin = Math.sin(angle);
    UPRIGHT.set(cos / squash, sin * squash, -sin / squash, cos * squash,
      this.jolt + rifle.x + size * squash * Math.sin(lean), -size * squash - lift - hop - (wait?.lift ?? 0) * size + rifle.y);
    this.body.setFromMatrix(UPRIGHT);
    this.view.position.set(this.x, this.y);
    this.view.zIndex = this.y + this.zBias;
  }

  /**
   * The look's `wreck`: smoke from a third of the HP lost, flames from a half (the tank's), all of it once beaten
   * or dying; drawn about the body's middle, so its feet are `size` below.
   */
  private drawDamage(t: number): void {
    const s = this.size;
    const level = this.ko || this.dying ? 1 : this.damage < 0.33 ? 0 : 0.35 + (this.damage - 0.33) * 1.2;
    if (level <= 0) return;
    const dir = this.facing === 'right' ? 1 : -1;
    if (this.look === 'tank') {
      // Across the hull and out of the turret's hatch, on the tank as it is drawn: the spots are set for its art 6.2
      // sizes wide, and grow with it about its feet (`size` below the middle) when it is drawn wider (the sketch `scale`).
      const span = wholeSpan('tank');
      const w = s * span;
      const f = span / 6.2;
      const up = (h: number) => s - h * s * f;
      // The high flame sits beside the hatch, clear of the driver's face in either facing.
      drawFire(this.fire, t, [[-w * 0.3 * dir, up(1.7)], [w * 0.18 * dir, up(3.0)], [w * 0.25 * dir, up(1.75)]], s * 0.9 * f, level, { still: motion.reduced });
    } else {
      drawFire(this.fire, t, [[-s * 0.3 * dir, -s * 1.2], [s * 0.35 * dir, -s * 1.0]], s * 0.6, Math.min(level, 0.5), { smokeOnly: true, still: motion.reduced });
    }
    this.drawnFire = level;
  }

  /** How strong the flames and smoke were when last drawn (0 for none), for the browser checks. */
  drawnFire = 0;

  /** The pose the figure shows, drawn for it or kept from an earlier drawing, for the checks. */
  drawnPose: Pose | null = null;

  /** Whether the figure was last drawn hurt, and how far it was last jolted aside, for the browser checks. */
  drawnHurt = false;
  jolt = 0;

  /**
   * Where its balloon, and the mark over it, point: just above its head, `up` above its feet. A figure taller than a
   * ball with a head drawn on it (the tank's driver, in its turret) speaks from there, not from a ball's height, which
   * left the tank's balloon on its hull under the driver (the owner, 2026-10-14: "the tank dialogue is under the driver
   * instead of above it, even though the speech bubble points downward"); `chin`, how high its head ends, is where a
   * balloon with no room above points up to it from below.
   */
  speakingPoint(): { x: number; y: number; up: number; chin?: number } {
    // Its picture's head, or while the code drawing stands in (`?art=off`, the picture not loaded), that drawing's.
    const code = LOOKS[this.look].head;
    const s = this.size;
    const head = headPoint(this.look, s, this.facing)
      ?? (code ? { dx: (this.facing === 'right' ? 1 : -1) * code.across * s, up: code.up * s, chin: code.chin * s } : null);
    return head ? { x: this.x + head.dx, y: this.y, up: head.up + 3, chin: head.chin } : { x: this.x, y: this.y, up: s * 2 + 3 };
  }

  distanceTo(o: { x: number; y: number }): number {
    return Math.hypot(this.x - o.x, this.y - o.y);
  }

  /** Moves the figure to `next`'s kept poses; the last figure to leave a drawing lets go of its poses. */
  private useDrawing(next: string | null): void {
    if (next === this.drawing) return;
    const last = this.drawing === null ? null : KEPT.get(this.drawing)!;
    if (last && --last.figures === 0) {
      for (const context of last.poses.values()) context.destroy();
      KEPT.delete(this.drawing!);
    }
    this.drawing = next;
    if (next === null) return;
    let kept = KEPT.get(next);
    if (!kept) KEPT.set(next, (kept = { figures: 0, poses: new Map() }));
    kept.figures++;
  }

  destroy(): void {
    this.vec.context = this.ownDrawing;
    this.useDrawing(null);
    this.view.destroy({ children: true });
  }
}
