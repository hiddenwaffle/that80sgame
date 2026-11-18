import { once } from '../game/achievements.ts';
import { musicShareAt } from '../audio/bridge_mix.ts';
import { Container, Graphics, Rectangle, Sprite, Text, Texture, type MeshPlane } from 'pixi.js';
import { art } from '../art/images.ts';
import { drawWallBreak, drawWallCast, drawWallMass, drawWallTop } from './berlin_wall_sketch.ts';
import { drawBuilding } from './berlin_buildings.ts';
import { drawItem } from './berlin_items.ts';
import { drawStreetPiece, drawTornGround } from './berlin_street_sketch.ts';
import { sceneryProp, sceneryPropBounds } from '../art/map_scenery.ts';
import { clipWreckArtifact } from '../art/wreck_art.ts';
import { clothMesh, waveCloth, type Cloth } from '../art/cloth_wave.ts';
import { EASE, motion, MS, onBeat } from '../render/motion.ts';
import { beijingCivilianLook, isLook, LOOKS } from '../art/characters.ts';
import { dirFromVector, dirVector, isSide, walkFacing, type Dir } from '../art/geom.ts';
import { PROPS } from '../art/props.ts';
import { TERRAINS, TILE } from '../content/terrain.ts';
import type { GameMap, MapObject } from '../content/tiled.ts';
import type { BattleOutcome, GameContext } from '../game/context.ts';
import { computeLayout, shortPhoneFight, thumbReach } from '../engine/layout.ts';
import { powerPellets, requirementsMet, tempFor, unlockMazeRest, type PropPlacement } from '../game/state.ts';
import * as C from '../render/palette.ts';
import { FONT } from '../render/fonts.ts';
import { drawScorchedPaving } from '../render/nukeStrike.ts';
import { HalftoneFilter, PRINT } from '../render/halftone.ts';
import { drawFire } from '../art/fire.ts';
import { Sunlight } from '../render/sunlight.ts';
import { wholeBox } from '../art/lookArt.ts';
import { PLANTS } from '../render/look.ts';
import { markRect, onMark } from '../ui/talkMark.ts';
import { burstPoints } from '../ui/print.ts';
import { hashSeed, mulberry32, type Rng } from '../battle/formula.ts';
import { Actor } from './actor.ts';
import { sparPose } from './spar.ts';
import { Collision, FEET_H, FEET_HW, propCollisionBox, type Box } from './collision.ts';
import { TerrainView } from './terrainView.ts';
import { TallCity } from './tall_city.ts';
import { beijingFrame, beijingReach } from './beijing_streets.ts';
import { frameBackdropBelow } from './framing.ts';
import { Patrol, PATROL_FIGHT_GRACE } from './patrol.ts';
import { patrolLayouts } from './patrol_walk.ts';
import { beijingPatrolNotice } from './patrol_notice.ts';
import { warningTiming, type WarningBounds } from './chase_timing.ts';
import { exitDirection } from './exit_direction.ts';
import { drawGroundMark, type GroundMark } from '../render/ground_mark.ts';
import { clearIfInked } from '../render/clear_if_inked.ts';
interface CameraView { w: number; h: number; zoom: number }

/** Tiles across the shorter side for desktop/tablet exploration and battle framing. */
const TILES_SHORT = 10.5;
/** Body diameter in CSS pixels on an upright phone, including battles. */
const PHONE_BODY_PX = 44;
/**
 * Distance between party members walking in single file: a ball's width (22) and one of its eyes between them (the
 * owner, 2026-10-14: "one eyeball's worth"), an eye in the party's art being about 0.45 of the ball's radius. It was
 * 22, the balls touching.
 */
const SPACING = 27;
/**
 * How far the printed world tips toward the viewer at full tilt: the ground is
 * drawn this much shorter from top to bottom, while people and props stay upright.
 * 0.2 draws the ground at 80 percent of its height. Each map can scale it with its
 * `tilt` property, and the border map eases it in with `tilt_ease_x`.
 */
const FULL_TILT = 0.2;

/** The shade a tree stands on, by kind: how wide and how deep the patch is, in world units. */
const TREE_SHADE: Readonly<Record<string, readonly [number, number]>> = { birch: [11, 4], spruce: [13, 4.5] };

/** A prop's outline at its base, in world units upright: its picture or drawing, not its printed labels, which need a canvas to measure. */
function propExtent(v: PropView): { x0: number; x1: number; y: number; h: number } {
  const labels = v.gfx.children.filter((c) => c instanceof Text);
  for (const t of labels) t.measurable = false;
  const b = v.gfx.getLocalBounds();
  for (const t of labels) t.measurable = true;
  // Either way round, as a prop may be drawn mirrored.
  const k = (v.base ?? 1) * (v.grow ?? 1);
  const half = Math.max(Math.abs(b.minX), Math.abs(b.maxX)) * k;
  return { x0: v.obj.x - half, x1: v.obj.x + half, y: v.obj.y, h: Math.max(0, -b.minY) * k };
}

interface PropView {
  obj: MapObject;
  /** The code drawing, or the prop's art as a sprite standing on its base. */
  gfx: Container;
  /** The code drawing itself, also when grouped with printed labels. */
  drawing?: Graphics;
  /** This drawing contains only the moving detail above its static picture. */
  imageOverlay?: boolean;
  kind: string;
  animated: boolean;
  /** Its scale to the prop's height (art, or a code drawing made at another size), and how art moves. */
  base?: number;
  motion?: 'sway' | 'pulse';
  /** A flag's picture as a mesh whose cloth ripples, and how far along its wave it starts, so no two flags wave together. */
  wave?: { mesh: MeshPlane; cloth: Cloth; phase: number };
  /** How grown it is drawn, 0 to 1, while it pops in on appearing. */
  grow?: number;
  /** A burning prop's flames and smoke, drawn each frame. */
  fire?: Graphics;
  mirror?: boolean;
  fireScale?: number;
  /** The exact footprint to remove if a scene hides this prop. */
  collisionBox?: Box;
}

interface PickupView {
  obj: MapObject;
  gfx: Container;
  key: string;
  /** Whether it lies where it is drawn: one being dropped cannot be taken in the air. */
  landed: boolean;
  /** A pickup drawn to stand out: its parts, posed on each frame. */
  show?: { rays: Graphics; glow: Graphics; body: Container; arrow: Graphics; sparks: Graphics[] };
  /** While it is tossed: its height stretched (over 1) or squashed (under 1), the width the other way. */
  squash?: number;
}

/** How fast the party walks, in world units a second, before a pickup that speeds it up. */
export const WALK = 112;

/** Seconds leaning into a side exit before leaving. Zero feels like walking straight off the edge. */
const EDGE_EXIT_PUSH_SECONDS = 0;
/** Contact tolerance in world units; separate from the authored exit strip's thickness. */
const EDGE_EXIT_CONTACT = 1;
// Stay just inside collision's inclusive feet samples at the map boundary.
const EDGE_INSET = .01;
/** How far in from a side exit's edge a tap still asks to leave by it: the outermost tile, so a fingertip can find it on
 * a phone, where the camera stops with the map's edge at the screen's. The walk then goes all the way to the edge. */
const EDGE_TAP_REACH = TILE;

interface EdgeExit {
  side: Dir;
  normal: [number, number];
  /** A feet position against this edge, at the middle of the exit's unchanged span. */
  contact: [number, number];
}

/** How near the leader comes to someone they walk up to before the talk begins, in world units. */
/** How near the leader must be to a townsperson for a tap on them to talk (the pilot holds itself to it too). */
export const TALK_REACH = 30;
/** How long someone walking about waits for a leader standing close by, in seconds. */
const LONGEST_WAIT = 3;

/**
 * A map in play: terrain, scenery, the party, townspeople, enemies, pickups,
 * triggers, and exits. The world keeps moving while the party talks, as in the
 * original, but enemies hold still while a menu or script is running.
 */
/** Seconds between a power pellet's own notice and the count of the map's power pellets found under it. */
const PELLET_COUNT_DELAY = 0.4;

export class World {
  readonly game: GameContext;
  readonly map: GameMap;
  /** This map's random numbers, for anything that changes play (screen shake and sound use their own). */
  private readonly rng: Rng;
  /** Random numbers for the townspeople's idle moves, apart from play's, so those stay as they were. */
  private readonly idleRng: Rng;
  /** Separate tackle stream; probes may replace this callback to force the next jump's outcome. */
  tackleRoll: Rng;
  readonly view = new Container();
  readonly scene = new Container();
  private readonly arcadeSorted = new Container({ sortableChildren: true });
  private readonly printRoot = new Container();
  private readonly printSorted = new Container({ sortableChildren: true });
  /** Effects drawn above everything in world space: dashes, cherries, bursts. */
  readonly fx = new Container();
  /** Dev overlay, drawn by the dev tools. */
  readonly debug = new Graphics();
  /** The finale's warm light and sun rays, once the Warsaw Pac has gone (`[sunlight]`). */
  private light: Sunlight | null = null;
  readonly halftone: HalftoneFilter;
  readonly terrain: TerrainView;
  readonly collision: Collision;
  party: Actor[] = [];
  /** Textures cut from part of a picture (the Wall's panels), made per build: destroyed with the world, not the picture. */
  private croppedTextures: Texture[] = [];
  npcs: Actor[] = [];
  enemies: Actor[] = [];
  /** Beijing's pursuing guards, by actor; the developer overlay draws their territories and reach. */
  readonly patrols = new Map<Actor, Patrol>();
  /** The ground of every patrol a fight is retried away from (not the bridge's relentless guards or a confined one). */
  private patrolGround: Box[] = [];
  /**
   * Where the leader last stood outside every patrol's ground: while the party is in an alley, the mouth they came in
   * by. A fight retried from inside one starts there instead (retryPoint).
   */
  private wayIn: { x: number; y: number } | null = null;
  /** Shared simulation clock: held with the guards through fights, menus and street slides. */
  patrolTime = 0;
  private props: PropView[] = [];
  /** Decorative props that slide when nudged; never added to collision or the map's saved geometry. */
  private yieldingProps: Array<{ view: PropView; offset: number; max: number; elapsed: number; seconds: number; delay: number }> = [];
  /** A held pointer keeps its through-the-prop destination after the prop finishes sliding. */
  private pushTap: { view: PropView; x: number; y: number } | null = null;
  private pickups: PickupView[] = [];
  /**
   * Props and townspeople with `appears` whose flags are not set yet: they are not on the map until the
   * story reaches them, then pop in (`checkAppearing`).
   */
  private waiting: Array<{ obj: MapObject; show: (quiet: boolean) => void }> = [];
  pellets = new Set<number>();
  private trail: Array<{ x: number; y: number }> = [];
  camX = 0;
  camY = 0;
  zoom = 1;
  /** The camera follows this actor, or holds on a fixed point when it is null. */
  cameraTarget: Actor | { x: number; y: number } | null = null;
  /**
   * The middle of the party, moving as they move, for a scene's camera to keep all of them in view as they spread out
   * ([camera everyone]; on the smallest phone Gorbie went out of view at the maze's flower, the owner, 14 Nov).
   */
  readonly everyone = (() => {
    const w = this;
    const middle = (k: 'x' | 'y') => {
      const at = w.party.filter((a) => !a.hidden).map((a) => a[k]);
      return (Math.min(...at) + Math.max(...at)) / 2;
    };
    // Their figures' middle, as the camera takes for one person, stands above their feet.
    return { get x() { return middle('x'); }, get y() { return middle('y') - w.leader.size / w.ground; } };
  })();
  private partyBackdrop = false;
  shakeTime = 0;
  /** Whether the player steers the leader. Scripts and battles turn it off. */
  control = true;
  /** Seconds during which touching an enemy does not start a fight. A new map starts with a moment of it. */
  grace = 1;
  /** After loading or retrying, protection lasts until the first actual step. Stopping cannot renew it. */
  stationaryGrace = false;
  private insideTriggers = new Set<string>();
  /** Stars already acknowledged nearby; cleared after moving two tiles beyond their trigger. */
  private saveFeedback = new Set<MapObject>();
  private tapPath: Array<[number, number]> = [];
  /** An edge tap's reachable end, before its final outward leg into collision. */
  private tapExitPoint: [number, number] | null = null;
  /** This frame's requested direction, retained even when collision stops a tapped walk. */
  private walkIntent: [number, number] = [0, 0];
  /** A tapped leg must aim through the boundary; finishing just inside contact tolerance is not a push. */
  private walkAim: [number, number] | null = null;
  private edgePush: { exit: MapObject; seconds: number } | null = null;
  private tapTalk: Actor | null = null;
  /** Where the tapped talker stood when the walk to them was laid; once they stroll on from there it is laid again. */
  private tapTalkAt: [number, number] | null = null;
  private tapTalkRelay = 0;
  /** The mouse over the map, in panel coordinates, for the balloon over whoever it is on (hoverPoint is for exits only). */
  private mouseAt: [number, number] | null = null;
  /** The talker the mouse is on, or on the balloon over. */
  private pointed: Actor | null = null;
  /** The talker the balloon was last shown over in place of the interact target, which a tap on that balloon means. */
  private marked: Actor | null = null;
  /** A use trigger the leader is walking to after a tap; it is used on arrival. */
  private tapUse: MapObject | null = null;
  private destroyed = false;
  /**
   * Seconds after a scene ends in which nothing can be talked to or used, so mashing Confirm
   * (or tapping) through the end of a talk does not start it again.
   */
  private talkRest = 0;
  private storyWas = false;
  /** The ground target drawn as a ring, following a held pointer, or null when there is none. */
  tapMarker: [number, number] | null = null;
  /** What is drawn, including mouse hover. tapMarker remains the actual walking destination, never the inset glyph. */
  groundMark: GroundMark | null = null;
  private tapExit: MapObject | null = null;
  private hoverPoint: [number, number] | null = null;
  private hoverExit: MapObject | null = null;
  private hoverAge = 0;
  private readonly ring = new Graphics();
  private ringAge = 0;
  private pelletSoundCooldown = 0;
  private propTick = 0;
  private readonly sorted: Container;
  /** Beijing's tall buildings. */
  tall: TallCity | null = null;
  /** Stationary bystanders leave a gunfight, for good only if it is won (`ranForGood`); never persisted into a save or retry. */
  /** Those going from building to building: how long they loiter yet, or where they are on their way to (`strollOn`). */
  private readonly strolls = new Map<Actor, { loiter: number; to: MapObject | null; stuck: number }>();
  /** Barrier tape across a way through, up until someone walks through it. */
  private readonly tapes: Array<{ o: MapObject; up: Graphics; down: Graphics }> = [];
  /** The guard building's door standing open, hidden until the Warsaw Pac runs out of it. */
  private openDoor: Graphics | null = null;
  /** How long each has waited for the leader standing close by, until the leader has been away. */
  private readonly waited = new Map<Actor, number>();
  private readonly fleeingBystanders = new Map<Actor, { x: number; y: number; facing: Dir; hidden: boolean; alert: boolean; lift: number }>();

  constructor(game: GameContext, map: GameMap, halftone: HalftoneFilter) {
    this.game = game;
    this.map = map;
    const seed = game.worldSeed(map.id);
    this.rng = mulberry32(seed);
    this.idleRng = mulberry32(hashSeed(seed, 'idle'));
    this.tackleRoll = mulberry32(hashSeed(seed, 'tackle'));
    if (map.id === 'field') {
      const flags = game.state.flags;
      // Keep this discovery stable through saves/revisits, without consuming patrol randomness.
      // Older saves that already heard an entrance hint retain access to every alley.
      if (flags.field_entry_open) {
        for (let i = 1; i <= 5; i++) flags[`field_entry_movable_${i}`] = true;
      } else if (!flags.warsaw_speed_hint) {
        const first = [3, 4, 5].find(i => flags[`field_entry_first_${i}`])
          ?? 3 + Math.floor(mulberry32(hashSeed(seed, 'entry'))() * 3);
        flags[`field_entry_first_${first}`] = true;
        flags[`field_entry_movable_${first}`] = true;
      }
    }
    this.halftone = halftone;
    this.terrain = new TerrainView(map);
    this.collision = new Collision(map);
    const world = String(map.props.world ?? 'print');
    this.sorted = world === 'arcade' ? this.arcadeSorted : this.printSorted;
    for (const layer of this.terrain.foreground) this.sorted.addChild(layer);
    if (map.props.streets === 'beijing') {
      // The plan is made before the view tips; buildings over a walkway allow for the ground then drawn shorter at full tilt.
      const squash = (1 - FULL_TILT * this.tiltAt(map.width * TILE / 2)) / this.ground;
      this.tall = new TallCity(this.sorted, map.width, map.height, (c, r) => this.terrain.idAt(c, r), this.ground, beijingFrame(map), { ...beijingReach(map), squash });
    }
    this.printRoot.addChild(this.terrain.print, this.printSorted);
    this.scene.addChild(this.terrain.arcade, this.arcadeSorted, this.printRoot, this.fx, this.debug);
    this.ring.label = 'walk_ring'; this.debug.label = 'dev_debug';
    this.fx.addChild(this.ring);
    this.view.addChild(this.scene);
    if (world !== 'arcade') this.printRoot.filters = [halftone];
    this.buildObjects();
    // Lines across Beijing's alleys keep clear of what stands under them.
    this.tall?.clearOf(this.props.map(propExtent));
    this.shadeTrees();
    this.buildPatrols();
    // A weathered trace where the blast landed on the party (the forecourt), beneath every figure and prop.
    const blastAt = map.id === 'berlin' && game.state.flags.warsaw_lost ? map.objects.find((o) => o.name === 'forecourt') : undefined;
    if (blastAt) {
      const scorch = new Graphics();
      scorch.label = 'warsaw_scorch';
      scorch.eventMode = 'none';
      scorch.alpha = 0.5;
      drawScorchedPaving(scorch, blastAt.x, blastAt.y, 42);
      this.underFigures(scorch);
    }
    this.buildParty();
  }

  get world(): string {
    return String(this.map.props.world ?? 'print');
  }

  /**
   * The border's birches and spruces stand on a patch of their own shade, at the trunk and falling to the lower right with the light
   * from the upper left, as the party's and the tall buildings' shadows do (the 3 Nov map review: nothing grounded them).
   */
  private shadeTrees(): void {
    const trees = this.props.filter((v) => TREE_SHADE[v.kind]);
    if (!trees.length) return;
    const shade = new Graphics();
    shade.label = 'tree_shade';
    shade.eventMode = 'none';
    for (const v of trees) {
      const [rx, ry] = TREE_SHADE[v.kind]!;
      shade.ellipse(v.obj.x + rx * 0.35, v.obj.y + ry * 0.4, rx, ry).fill({ color: C.INK, alpha: 0.2 });
    }
    this.underFigures(shade);
  }

  get leader(): Actor {
    return this.party[0]!;
  }

  // ---------------------------------------------------------------------------------------------
  // Building

  private objKey(o: MapObject): string {
    return `${this.map.id}:${o.name}`;
  }

  private buildObjects(): void {
    const s = this.game.state;
    const temp = tempFor(s, this.map.id);
    const speakers = new Set(Object.values(this.game.content.characters).map(c => c.actor));
    for (const o of this.map.objects) {
      const p = o.props;
      // Not there until the story reaches its flags.
      const waits = !requirementsMet(s, p.appears);
      switch (o.type) {
        case 'placeholder': {
          // A sketch's stand-in: a labelled box where a piece will go (the Berlin tile sketch, 29 Oct). Flat ones lie
          // on the ground under everyone; the rest sort at their foot like props.
          const fill = ({ building: 0xf3e6c4, tree: 0xa8d58a, wall: 0xd0d0cc, works: 0xf2b866, checkpoint: 0xf5e04a, east: 0x8c8f92, street: 0xe0dcd2 } as Record<string, number>)[String(p.group)] ?? 0xffffff;
          const box = new Container();
          box.zIndex = p.flat ? -1000 + o.y : typeof p.sort_y === 'number' ? p.sort_y : o.y + o.h;
          if (p.shape === 'wall_mass' || p.shape === 'wall_cast') {
            const gfx = p.shape === 'wall_mass' ? drawWallMass(o.x, o.y, o.w, o.h, p.grass === true) : drawWallCast(o.x, o.y, o.w, o.h, Number(p.dx));
            box.addChild(gfx);
            if (typeof p.clip === 'string') {
              const outline = new Graphics().poly(p.clip.split(',').map(Number)).fill(0xffffff);
              box.addChild(outline);
              gfx.mask = outline;
            }
            this.sorted.addChild(box);
            break;
          }
          if (p.shape === 'wall_top' || p.shape === 'wall_break') {
            const list = (v: unknown) => String(v ?? '').split(',').filter(Boolean).map(Number);
            box.addChild(p.shape === 'wall_top'
              ? drawWallTop(o.x, o.y, o.w, o.h, Number(p.face_h), Number(p.seam_from), Number(p.section), Number(p.seam_w ?? 1.6))
              : drawWallBreak(list(p.front), Number(p.thick), o.y, Number(p.pipe_bottom), o.y + o.h, list(p.seams), p.gap_on === 'left' ? 'left' : 'right'));
            this.sorted.addChild(box);
            break;
          }
          // Upright sketch pieces are stretched back by the full tilt, as props are, or the tilted ground squashes them.
          const lift = 1 / (1 - FULL_TILT);
          if (p.shape === 'torn_ground') {
            box.addChild(drawTornGround(o.x, o.y, o.w, o.h));
            this.sorted.addChild(box);
            break;
          }
          if (p.shape === 'building' || p.shape === 'item') {
            const stand = (piece: Graphics) => {
              piece.position.set(o.x, o.y + o.h);
              piece.scale.y = lift;
              box.addChild(piece);
              return piece;
            };
            const drawn = stand(p.shape === 'building' ? drawBuilding(String(p.piece), o.w) : drawItem(String(p.piece), o.w));
            if (typeof p.tone === 'number') drawn.tint = p.tone;
            if (p.piece === 'tape') {
              const fallen = stand(drawItem('tape_fallen', o.w));
              fallen.visible = false;
              this.tapes.push({ o, up: drawn, down: fallen });
            }
            if (p.piece === 'guard_building') {
              this.openDoor = stand(drawBuilding('guard_door_open', o.w));
              this.openDoor.visible = false;
            }
            this.sorted.addChild(box);
            break;
          }
          if (p.shape === 'street_piece') {
            const piece = drawStreetPiece(String(p.piece), o.x + o.w / 2, 0);
            piece.position.y = o.y + o.h;
            piece.scale.y = lift;
            box.addChild(piece);
            this.sorted.addChild(box);
            break;
          }
          // A picture from the game's art stands in its box instead of a label (the Wall's painted panels, off one strip).
          const picture = typeof p.picture === 'string' ? art(p.picture) : null;
          if (picture) {
            // `crop` takes a part of the picture (from and to, as fractions of its width and height).
            const [u0, u1] = String(p.crop ?? '0,1').split(',').map(Number);
            const [v0, v1] = String(p.crop_y ?? '0,1').split(',').map(Number);
            const f = picture.frame;
            const cropped = new Texture({ source: picture.source, frame: new Rectangle(f.x + f.width * u0!, f.y + f.height * v0!, f.width * (u1! - u0!), f.height * (v1! - v0!)) });
            this.croppedTextures.push(cropped);
            const sp = new Sprite(cropped);
            sp.position.set(o.x, o.y);
            sp.width = o.w;
            sp.height = o.h;
            box.addChild(sp);
            // Part of the panel can be torn away: only what lies inside this outline shows (the Wall's broken ends).
            if (typeof p.clip === 'string') {
              const outline = new Graphics().poly(p.clip.split(',').map(Number)).fill(0xffffff);
              box.addChild(outline);
              sp.mask = outline;
            }
            this.sorted.addChild(box);
            break;
          }
          // A roof is a trapezoid, its ridge shorter than its eaves, so it reads as a roof sloping toward the viewer.
          const inset = p.shape === 'roof' ? Math.min(o.w * 0.18, o.h * 0.9) : 0;
          box.addChild(new Graphics().poly([o.x + inset, o.y, o.x + o.w - inset, o.y, o.x + o.w, o.y + o.h, o.x, o.y + o.h]).fill({ color: fill, alpha: p.flat ? 0.75 : p.group === 'east' ? 1 : 0.92 }).stroke({ width: 1.5, color: C.INK }));
          const text = new Text({ text: String(p.label ?? o.name), resolution: 4, style: { fontFamily: FONT.headline, fontSize: 8, fill: C.INK, align: 'center', wordWrap: true, wordWrapWidth: Math.max(o.w - 3, 30), lineHeight: 9 } });
          text.anchor.set(0.5);
          text.position.set(o.x + o.w / 2, o.y + o.h / 2);
          box.addChild(text);
          this.sorted.addChild(box);
          break;
        }
        case 'prop': {
          const kind = this.localPlant(o, String(p.kind));
          const info = PROPS[kind];
          if (!info) break;
          const addLabels = (gfx: Container, labelFits?: Record<string, { x: number; y: number; size?: number }>) => {
            for (const label of info.labels ?? []) {
              const fit = labelFits?.[label.text];
              const text = new Text({
                text: label.property && typeof p[label.property] === 'string' ? String(p[label.property]) : label.text,
                resolution: 4,
                style: { fontFamily: label.font ?? FONT.headline, fontWeight: '400', fontSize: fit?.size ?? label.size, fill: label.color ?? C.INK, letterSpacing: 0.4 },
              });
              text.anchor.set(0.5);
              text.position.set(fit?.x ?? label.x, fit?.y ?? label.y);
              gfx.addChild(text);
            }
          };
          let view: PropView;
          // The prop's art where there is some, standing on its base and scaled to the prop's height; else its code drawing.
          const tex = sceneryProp(this.map.id, kind);
          if (tex) {
            const sprite = new Sprite(tex);
            const bounds = sceneryPropBounds(this.map.id, kind);
            let gfx: Container;
            let drawing: Graphics | undefined;
            let wave: PropView['wave'];
            if (bounds?.cloth) {
              // A flag: its picture as a mesh, so the cloth can wave while the pole stays put.
              const mesh = clothMesh(tex);
              mesh.position.set(bounds.x, bounds.y);
              mesh.scale.set(bounds.width / tex.width, bounds.height / tex.height);
              gfx = new Container(); gfx.addChild(mesh);
              wave = { mesh, cloth: bounds.cloth, phase: (o.x * 0.37 + o.y * 0.11) % (Math.PI * 2) };
            } else if (bounds) {
              sprite.position.set(bounds.x, bounds.y);
              sprite.width = bounds.width;
              sprite.height = bounds.height;
              gfx = new Container(); gfx.addChild(sprite);
              if (info.drawOverImage) {
                drawing = new Graphics();
                info.drawOverImage(drawing, 0);
                if (bounds.overlay) {
                  drawing.position.set(bounds.overlay.x, bounds.overlay.y);
                  drawing.scale.set(bounds.overlay.scaleX, bounds.overlay.scaleY);
                }
                gfx.addChild(drawing);
              }
              addLabels(gfx, bounds.labels);
            } else {
              sprite.anchor.set(0.5, 1);
              gfx = kind === 'tank_wreck' ? clipWreckArtifact(sprite) : sprite;
            }
            gfx.position.set(o.x, o.y);
            gfx.zIndex = o.y;
            this.sorted.addChild(gfx);
            view = { obj: o, gfx, drawing, imageOverlay: Boolean(drawing), kind, animated: Boolean(drawing), base: bounds ? (info.drawn ? info.height / info.drawn : 1) : info.height / tex.height, ...(info.motion ? { motion: info.motion } : {}), ...(wave ? { wave } : {}) };
          } else {
            const drawing = new Graphics();
            info.draw(drawing, 0);
            const gfx = info.labels?.length ? new Container() : drawing;
            if (gfx !== drawing) gfx.addChild(drawing);
            addLabels(gfx);
            gfx.position.set(o.x, o.y);
            gfx.zIndex = o.y;
            this.sorted.addChild(gfx);
            // A code drawing made at another size than the prop's height is scaled to it, as art is.
            view = { obj: o, gfx, drawing, kind, animated: Boolean(info.animate), ...(info.drawn ? { base: info.height / info.drawn } : {}) };
          }
          // Flames and smoke over a burning prop (the wreck), drawn each frame in front of it.
          if (info.burning) {
            view.fire = new Graphics();
            view.fire.eventMode = 'none';
            view.fire.position.set(o.x, o.y);
            view.fire.zIndex = o.y + 0.5;
            this.sorted.addChild(view.fire);
          }
          // Drawn smaller than the kind's own size, for small things in a lane (`draw_scale`); shrinks from the master, so it stays sharp.
          if (typeof o.props.draw_scale === 'number') view.grow = o.props.draw_scale;
          this.props.push(view);
          if (typeof p.yield_up === 'number' && !p.solid) this.yieldingProps.push({
            view, offset: 0, max: p.yield_up, elapsed: 0, seconds: Number(p.push_seconds ?? 0), delay: Number(p.push_delay ?? 1),
          });
          const placement = temp.props?.[o.name];
          if (placement) this.positionProp(view, placement);
          const solid = () => {
            if (!p.solid) return;
            // A plant standing in for a palm (the look's local plants) keeps the palm's foot, so walking is unchanged;
            // one with a foot of its own (the city's blocks) uses that.
            const foot = (info.ownFoot ? info : (PROPS[String(p.kind)] ?? info)).foot;
            view.collisionBox = propCollisionBox(o, foot);
            this.collision.boxes.push(view.collisionBox);
          };
          if (!waits) solid();
          else {
            view.gfx.visible = false;
            if (view.fire) view.fire.visible = false;
            this.waiting.push({
              obj: o,
              show: (quiet) => {
                view.gfx.visible = true;
                if (view.fire) view.fire.visible = true;
                solid();
                if (!quiet) this.popIn((k) => (view.grow = k));
              },
            });
          }
          break;
        }
        case 'npc': {
          const look = String(p.look);
          if (!isLook(look)) break;
          const a = new Actor(o.name, 'npc', look, o.x, o.y, o);
          // Beijing's townspeople wear varied local clothes; the merchant who keeps the shop after the tank stays the
          // green ball in a straw hat (the owner, 2026-10-12).
          if (this.map.props.streets === 'beijing' && look !== 'guide_merchant' && !look.startsWith('ninja')) a.setAppearance(beijingCivilianLook(look,
            hashSeed(`beijing_clothes:${o.name}`), Boolean(p.scene) || speakers.has(o.name)));
          // At rest a townsperson faces left or right (the content check holds maps to it); with no facing given,
          // the side picked from their name.
          a.facing = (p.facing as Dir) ?? a.side;
          a.homeFacing = isSide(a.facing) ? a.facing : a.side;
          a.idleTimer = 1 + this.idleRng() * 4;
          a.speed = typeof p.walk_speed === 'number' ? p.walk_speed : 40;
          // `gone_when`: gone for good once its flags are set (the ninjas, once they have taught Ronnie).
          const hidden = () => (Boolean(p.hidden) && !this.game.state.revealed.includes(this.objKey(o))) || this.ranForGood(o) ||
            (typeof p.gone_when === 'string' && requirementsMet(this.game.state, p.gone_when));
          a.hidden = waits || hidden();
          if (waits) {
            this.waiting.push({
              obj: o,
              show: (quiet) => {
                a.hidden = hidden();
                if (!quiet) this.popIn((k) => (a.grow = k));
              },
            });
          }
          this.npcs.push(a);
          this.sorted.addChild(a.view);
          break;
        }
        case 'enemy': {
          const kind = String(p.kind);
          const enemy = this.game.content.enemies[kind];
          if (!enemy || !isLook(enemy.look)) break;
          const enc = String(p.encounter);
          const beatenKey = `${this.map.id}:${enc}`;
          if (s.beaten.includes(beatenKey) || temp.defeated.includes(enc) || temp.left?.includes(o.name)) break;
          const a = new Actor(o.name, 'enemy', enemy.look, o.x, o.y, o);
          a.facing = (p.facing as Dir) ?? 'left';
          a.speed = 45;
          a.hidden = Boolean(p.hidden) && !s.revealed.includes(this.objKey(o));
          a.aiTimer = this.rng() * 6;
          this.enemies.push(a);
          this.sorted.addChild(a.view);
          break;
        }
        case 'pickup': {
          const key = this.objKey(o);
          if (s.taken.includes(key)) break;
          if (p.hidden && !s.revealed.includes(key)) break;
          this.addPickup(o);
          break;
        }
      }
    }
    if (this.map.props.pellets) this.buildPellets(new Set(temp.pellets));
  }

  /** All solid props must exist before deriving walking routes, regardless of Tiled object order. */
  private buildPatrols(): void {
    const layouts = patrolLayouts(this.map.objects, this.collision);
    for (const a of this.enemies) {
      const o = a.obj!, p = o.props, layout = layouts.get(o);
      if (!layout?.territory.length) continue;
      this.patrols.set(a, new Patrol(a, this.collision, layout.territory,
        String(p.patrol ?? '0,-2').split(',').map(v => Number(v) * TILE) as [number, number], layout.others, {
          walk: layout.walk, upperHalfEnd: layout.upperHalfEnd, nearbyTerritory: layout.nearbyTerritory,
          notice: beijingPatrolNotice(this.map, layout),
          ...(typeof p.chase === 'number' ? { chaseSpeed: () => this.partySpeed() * Number(p.chase), directTarget: true } : {}),
          ...((this.map.id === 'field' && layout.walk) || (this.map.id === 'border' && p.relentless === true)
            ? { warningTiming: (target, speed) => this.patrolWarningTiming(a, target, speed) } : {}),
          confined: p.confined === true,
          relentless: p.relentless === true,
          initialPause: Number(p.patrol_pause ?? 0),
          reacquire: p.confined === true || p.relentless === true,
          alertWhileReturning: this.map.id === 'field',
          ...(this.map.id === 'field' && p.relentless !== true && p.confined !== true ? { tackleRoll: () => this.tackleRoll() } : {}),
        }));
      if (p.relentless !== true && p.confined !== true) this.patrolGround.push(...layout.territory);
    }
  }

  private onPatrolGround(x: number, y: number): boolean {
    return this.patrolGround.some((b) => x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1);
  }

  /** The clock burning props' flames keep: it runs with the world's steps, so they stand still under a paused fight. */
  private burnT = 0;

  /** How many palms away from water the local plants have replaced on this map, so it takes its dry kinds in turn. */
  private plantTurns = 0;

  /**
   * The local plants (kept on 2026-10-02): in place of a palm, the plant that grows where this map is (`PLANTS`), one
   * that likes water by water. Anything else stays as it is.
   */
  private localPlant(o: MapObject, kind: string): string {
    const local = PLANTS[this.map.id];
    if (kind !== 'palm' || !local) return kind;
    const [tx, ty] = [Math.floor(o.x / TILE), Math.floor((o.y - 1) / TILE)];
    const water = TERRAINS.findIndex((t) => t.id === 'water');
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const [x, y] = [tx + dx, ty + dy];
        if (x >= 0 && y >= 0 && x < this.map.width && y < this.map.height && this.map.terrain[y * this.map.width + x] === water) return local.wet;
      }
    }
    return local.dry[this.plantTurns++ % local.dry.length]!;
  }

  private addPickup(o: MapObject, landed = true): PickupView {
    const data = this.game.content.pickups[String(o.props.kind)];
    let gfx: Container;
    let show: PickupView['show'];
    if (data?.celebrate) {
      gfx = new Container();
      show = standout(gfx);
    } else {
      const g = new Graphics();
      if (this.world === 'arcade') {
        g.circle(0, -8, 7).fill({ color: C.ARCADE_DOT, alpha: 0.25 });
        g.circle(0, -8, 5).fill(C.ARCADE_DOT);
      } else {
        g.circle(0, -8, 5).fill(0xfff1a8).stroke({ width: 1.5, color: C.INK });
      }
      gfx = g;
    }
    gfx.position.set(o.x, o.y);
    gfx.zIndex = o.y;
    this.sorted.addChild(gfx);
    const pk: PickupView = { obj: o, gfx, key: this.objKey(o), landed, ...(show ? { show } : {}) };
    this.pickups.push(pk);
    return pk;
  }

  /** How fast the party walks now: the base walk, faster for each pickup taken that speeds it up. */
  partySpeed(): number {
    const c = this.game.content;
    let k = 1;
    for (const key of this.game.state.taken) {
      const at = key.indexOf(':');
      const o = c.maps.get(key.slice(0, at))?.objects.find((q) => q.type === 'pickup' && q.name === key.slice(at + 1));
      k *= (o && c.pickups[String(o.props.kind)]?.walk) ?? 1;
    }
    return Math.round(WALK * k);
  }

  /** How many pickups are being dropped, for the checks. */
  dropping = 0;

  /**
   * Someone sets a hidden pickup down: it is revealed and tossed from them to where it lies. It pops up over their
   * head and shines a moment, held up as an adventurer holds up a find (the alley gifts' "Take this!", whose jingle
   * peaks on it), then flies over in an arc with a shadow under it and sparkles behind, stretched as it flies, and
   * bounces once, squashing, landing with a burst. It cannot be taken in the air. With Reduce motion it is simply
   * there, with the burst. Resolves when it has landed.
   */
  drop(name: string, who: string): Promise<void> {
    const key = `${this.map.id}:${name}`;
    const s = this.game.state;
    if (!s.revealed.includes(key)) s.revealed.push(key);
    const o = this.object(name);
    if (!o || o.type !== 'pickup' || s.taken.includes(key) || this.pickups.some((q) => q.obj === o)) return Promise.resolve();
    const pk = this.addPickup(o, false);
    const from = this.actor(who);
    // Keep the scene's facing through the toss, so the giver keeps addressing the party.
    const land = () => {
      pk.landed = true;
      delete pk.squash;
      pk.gfx.position.set(o.x, o.y);
      pk.gfx.zIndex = o.y;
      this.pickupBurst(o.x, o.y);
    };
    if (motion.reduced || !from) {
      land();
      return Promise.resolve();
    }
    const [sx, sy] = [from.x, from.y];
    /** When each part happens, in seconds: up over the head, held, thrown, the bounce, landed. */
    const AT = { held: 0.22, thrown: 0.42, down: 0.9, landed: 1.06 };
    // Heights above the ground: from the giver's middle to over their head, and the throw's arc over the line between.
    const [hands, overhead] = [from.size, from.size * 2.4 + 4];
    const arc = 22 + Math.hypot(o.x - sx, o.y - sy) * 0.15;
    const shadow = new Graphics();
    shadow.eventMode = 'none';
    // On the ground, under every figure.
    shadow.zIndex = -1e9 + 1;
    this.sorted.addChild(shadow);
    // The shine while it is held up, and the sparkles left along its way, over everything; drawn upright, stretched
    // back by the tilt as the bursts are, so they stay round on tilted ground.
    const shine = new Graphics();
    const trail = new Graphics();
    for (const g of [shine, trail]) {
      g.eventMode = 'none';
      g.scale.set(1, 1 / this.ground);
      this.fx.addChild(g);
    }
    shine.position.set(sx, this.upY(sy, overhead + 8));
    const sparks: Array<{ x: number; y: number; born: number }> = [];
    let last: { x: number; y: number; born: number } | null = null;
    let t = 0;
    this.dropping++;
    return new Promise((resolve) => {
      this.addTask({
        step: (dt) => {
          t += dt;
          if (pk.gfx.destroyed) return true;
          let [x, y, lift] = [sx, sy, 0];
          if (t < AT.thrown) {
            lift = hands + (overhead - hands) * EASE.out(Math.min(1, t / AT.held));
            pk.squash = t < AT.held ? 1.12 : 1;
          } else if (t < AT.down) {
            const k = (t - AT.thrown) / (AT.down - AT.thrown);
            [x, y] = [sx + (o.x - sx) * k, sy + (o.y - sy) * k];
            lift = overhead * (1 - k) + Math.sin(k * Math.PI) * arc;
            pk.squash = 1 + 0.15 * Math.sin(k * Math.PI);
            // A sparkle left behind every so far along its way, where it was, so none sits on it.
            const at = { x, y: this.upY(y, lift + 8) * this.ground, born: t };
            if (!last) last = at;
            else if (Math.hypot(at.x - last.x, at.y - last.y) > 9) {
              sparks.push(last);
              last = at;
            }
          } else {
            const k = Math.min(1, (t - AT.down) / (AT.landed - AT.down));
            [x, y] = [o.x, o.y];
            lift = Math.sin(k * Math.PI) * 7;
            // Squashed as it touches down, springing back as it rises; a smaller squash coming down again.
            pk.squash = 1 - 0.3 * Math.max(0, 1 - k / 0.3) - 0.12 * Math.max(0, (k - 0.85) / 0.15);
          }
          pk.gfx.position.set(x, y - lift / this.ground);
          pk.gfx.zIndex = Math.max(y, sy) + 1;
          // Its shadow on the ground, smaller and fainter the higher it is, once it leaves the giver's hands.
          shadow.clear();
          if (t >= AT.thrown) {
            const high = Math.min(1, lift / (overhead + arc));
            shadow.ellipse(x, y, 6 * (1 - 0.45 * high), 6 * (1 - 0.45 * high)).fill({ color: C.INK, alpha: 0.28 * (1 - 0.5 * high) });
          }
          // Held up: short rays and a four-pointed sparkle flashing out round it, as the jingle peaks.
          shine.clear();
          const held = (t - AT.held * 0.6) / (AT.thrown - AT.held * 0.6);
          if (held > 0 && held < 1) {
            const [cx, cy] = [0, 0];
            for (let i = 0; i < 8; i++) {
              const a = (i / 8) * Math.PI * 2 + 0.2;
              const [r0, r1] = [9 + 6 * held, 13 + 8 * EASE.out(held)];
              for (const [color, width] of [[C.INK, 2.4], [C.POP_YELLOW, 1.3]] as const) {
                shine.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0).lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1)
                  .stroke({ color, width, cap: 'round', alpha: 1 - held });
              }
            }
            shine.poly(burstPoints(cx + 9, cy - 9, 5 * Math.sin(held * Math.PI), 4, 0.3, 0)).fill({ color: 0xffffff, alpha: 1 - held * 0.5 });
          }
          // The sparkles left along its way, each shrinking away.
          trail.clear();
          for (const p of sparks) {
            const k = (t - p.born) / 0.35;
            if (k >= 1) continue;
            trail.poly(burstPoints(p.x, p.y, 3.2 * (1 - k), 4, 0.3, 0)).fill(C.POP_YELLOW).stroke({ color: C.INK, width: 0.8 });
          }
          if (t >= AT.landed) {
            land();
            return true;
          }
          return false;
        },
        resolve: () => {
          this.dropping--;
          for (const g of [shadow, shine, trail]) if (!g.destroyed) g.destroy();
          resolve();
        },
      });
    });
  }

  /** Whether a pickup's celebration is showing, for the checks. */
  celebrating = 0;

  /**
   * Taking a pickup that matters: a big starburst where it lay with two rings spreading from it, and each
   * member lit up for a moment, a yellow glow at their feet and bolts circling them, while its message is
   * announced large. With Reduce motion the burst and the glows stand still and fade.
   */
  private celebrate(x: number, y: number, message: string | undefined): void {
    if (message) this.game.announce(message);
    const total = 2;
    const burst = new Graphics();
    burst.eventMode = 'none';
    burst.position.set(x, this.upY(y, 18));
    burst.scale.set(1, 1 / this.ground);
    this.fx.addChild(burst);
    const auras = this.party.map(() => {
      const g = new Graphics();
      g.eventMode = 'none';
      this.fx.addChild(g);
      return g;
    });
    this.celebrating++;
    let t = 0;
    const draw = () => {
      const still = motion.reduced;
      const fade = Math.max(0, Math.min(1, (total - t) / 0.6));
      burst.clear();
      burst.alpha = Math.max(0, 1 - t / 0.9);
      const r = still ? 26 : 8 + EASE.pop(Math.min(1, t / 0.25)) * 20;
      burst.poly(burstPoints(0, 0, r * 1.5, 12, 0.45, still ? 0 : t)).fill({ color: C.POP_YELLOW, alpha: 0.45 });
      burst.poly(burstPoints(0, 0, r, 10, 0.5, 0.2)).fill(C.POP_YELLOW).stroke({ width: 1.5, color: C.INK, join: 'miter' });
      burst.poly(burstPoints(0, 0, r * 0.45, 10, 0.55, 0)).fill(C.POP_PINK);
      if (!still) for (const [d, w] of [[0, 2], [0.18, 1.2]] as const) {
        const k = Math.max(0, Math.min(1, (t - d) / 0.8));
        if (k > 0 && k < 1) burst.circle(0, 0, r + EASE.out(k) * 60).stroke({ width: w, color: C.INK, alpha: 1 - k });
      }
      this.party.forEach((a, i) => {
        const g = auras[i]!;
        g.clear();
        if (a.hidden) return;
        g.position.set(a.x, a.y);
        g.scale.set(1, 1 / this.ground);
        g.alpha = fade;
        const beat = still ? 0 : 0.5 + 0.5 * Math.sin(t * 9 + i);
        g.ellipse(0, 0, 15 + beat * 3, 5 + beat).fill({ color: C.POP_YELLOW, alpha: 0.7 });
        for (let b = 0; b < 3; b++) {
          const ang = (still ? 0 : t * 5) + i + (b * Math.PI * 2) / 3;
          g.poly(bolt(Math.cos(ang) * 15, -12 + Math.sin(ang) * 7, 6)).fill(C.POP_YELLOW).stroke({ width: 1, color: C.INK, join: 'miter' });
        }
      });
    };
    draw();
    this.addTask({
      step: (dt) => {
        t += dt;
        if (t >= total || burst.destroyed) return true;
        draw();
        return false;
      },
      resolve: () => {
        this.celebrating--;
        if (!burst.destroyed) burst.destroy();
        for (const g of auras) if (!g.destroyed) g.destroy();
      },
    });
  }

  /** Whether a rest is showing, for the checks. */
  resting = 0;

  /**
   * A rest at the save star, played big so it is plain the party healed: the lights go down round the
   * party, the star flares and sends rings out over them, and light rises through each member with green
   * pluses (the heal's colour and shape) as they bob up, refreshed; then the lights come back. About two
   * seconds; it resolves when it is over. With Reduce motion the dimming still fades in and out, while
   * the flare, the light, and the pluses stand still and fade, with no rings and no bob. It ends at once
   * when `stop` says so, as when its scene is abandoned.
   */
  restGlow(stop: () => boolean = () => false): Promise<void> {
    const total = 2;
    const lead = this.leader;
    // The nearest save star, or the party itself where there is none.
    const star = this.props.filter((p) => p.kind === 'save_star').sort((a, b) => lead.distanceTo(a.obj) - lead.distanceTo(b.obj))[0];
    const [sx, sy] = star && lead.distanceTo(star.obj) < TILE * 4 ? [star.obj.x, star.obj.y] : [lead.x, lead.y];
    // The dim sits under the figures and props, so they stay lit while the room around them goes dark.
    const dim = new Graphics();
    dim.eventMode = 'none';
    dim.rect(-TILE * 40, -TILE * 40, this.map.width * TILE + TILE * 80, this.map.height * TILE + TILE * 80).fill(0x0b0a1a);
    dim.zIndex = -1e9;
    dim.alpha = 0;
    this.sorted.addChild(dim);
    // The flare stands with the star, behind the party, even one gathered onto the star itself.
    const flare = new Graphics();
    flare.eventMode = 'none';
    flare.position.set(sx, this.upY(sy, 18));
    flare.scale.set(1, 1 / this.ground);
    this.sorted.addChild(flare);
    flare.zIndex = Math.min(sy + 0.25, ...this.party.map((a) => a.y - 0.5));
    const light = this.healLight(this.party, { start: 0.5, rise: 1.1, total });
    this.resting++;
    let t = 0;
    const clamp = (v: number) => Math.max(0, Math.min(1, v));
    const draw = () => {
      dim.alpha = 0.62 * Math.min(clamp(t / 0.35), clamp((total - 0.1 - t) / 0.5));
      this.drawStarFlare(flare, t, Math.max(60, ...this.party.map((a) => Math.hypot(a.x - sx, a.y - sy) + 30)));
      // Each member: a column of light, a glow at their feet, and green pluses rising through them.
      light.draw(t);
    };
    draw();
    return new Promise((resolve) => {
      this.addTask({
        step: (dt) => {
          t += dt;
          if (t >= total || flare.destroyed || stop()) return true;
          draw();
          return false;
        },
        resolve: () => {
          this.resting--;
          light.destroy();
          for (const g of [dim, flare]) if (!g.destroyed) g.destroy();
          resolve();
        },
      });
    });
  }

  /** The star's flare, shown with its nonblocking green-plus animation. */
  private drawStarFlare(flare: Graphics, t: number, reach: number): void {
    const total = 2;
    const still = motion.reduced;
    const clamp = (v: number) => Math.max(0, Math.min(1, v));
    // The star: a flare that pops up and turns, fading as the lights come back.
    flare.clear();
    const pop = still ? 1 : EASE.pop(clamp((t - 0.15) / 0.3));
    flare.alpha = clamp((total - 0.3 - t) / 0.5);
    if (pop > 0) {
      const r = 30 * pop;
      flare.poly(burstPoints(0, 0, r * 1.7, 14, 0.4, still ? 0 : t * 0.8)).fill({ color: C.POP_YELLOW, alpha: 0.4 });
      flare.poly(burstPoints(0, 0, r, 10, 0.5, 0.2)).fill(C.POP_YELLOW).stroke({ width: 1.5, color: C.INK, join: 'miter' });
      flare.poly(burstPoints(0, 0, r * 0.45, 10, 0.55, 0)).fill(C.POP_PINK);
    }
    if (!still) {
      for (const [d, w] of [[0.3, 2.4], [0.45, 1.6], [0.6, 1]] as const) {
        const k = clamp((t - d) / 0.7);
        if (k > 0 && k < 1) flare.circle(0, 0, 20 + EASE.out(k) * reach).stroke({ width: w, color: C.INK, alpha: 1 - k });
      }
    }
  }

  /** A star flare and healing light that leave the party's movement entirely free. */
  private saveGlow(o: MapObject): void {
    const cx = o.x + o.w / 2, cy = o.y + o.h / 2;
    const star = this.props.filter((p) => p.kind === 'save_star')
      .sort((a, b) => Math.hypot(a.obj.x - cx, a.obj.y - cy) - Math.hypot(b.obj.x - cx, b.obj.y - cy))[0];
    const sx = star?.obj.x ?? cx, sy = star?.obj.y ?? cy;
    const flare = new Graphics();
    flare.label = 'save_flare';
    flare.eventMode = 'none';
    flare.position.set(sx, this.upY(sy, 18));
    flare.scale.set(1, 1 / this.ground);
    flare.zIndex = sy + 0.25;
    this.sorted.addChild(flare);
    const duration = 2;
    const light = this.healLight(this.party, { start: 0.15, rise: 1.1, total: duration, lift: false });
    this.resting++;
    let t = 0;
    this.drawStarFlare(flare, 0, 60);
    this.addTask({
      step: (dt) => {
        t += dt;
        if (t >= duration || flare.destroyed || this.game.battleActive()) return true;
        this.drawStarFlare(flare, t / duration * 2, 60);
        light.draw(t);
        return false;
      },
      resolve: () => {
        light.destroy();
        this.resting--;
        if (!flare.destroyed) flare.destroy();
      },
    });
  }

  /**
   * The light of a heal, shared by the save star's rest and Cherry Chomp: for each of `actors`, one after
   * another, a column of light behind them (it adds to what is under it, so it reads as light), a pool of light
   * at their feet, green pluses (the heal's colour and shape) rising in front of them, and a bob up as it
   * reaches them. The caller poses it `t` seconds in with `draw`: it rises from `start` over `rise` seconds and
   * is gone by `total`. With Reduce motion it stands still and fades, with no bob. `destroy` takes it away and
   * sets everyone down.
   */
  healLight(actors: Actor[], o: { start: number; rise: number; total: number; lift?: boolean }): { draw: (t: number) => void; destroy: () => void; views: Graphics[] } {
    const beams = actors.map((a) => {
      const g = new Graphics();
      g.eventMode = 'none';
      g.blendMode = 'add';
      this.behind(g, a);
      return g;
    });
    const lights = actors.map(() => {
      const g = new Graphics();
      g.eventMode = 'none';
      this.fx.addChild(g);
      return g;
    });
    const clamp = (v: number) => Math.max(0, Math.min(1, v));
    return {
      views: [...beams, ...lights],
      draw: (t) => {
        const still = motion.reduced;
        actors.forEach((a, i) => {
          const g = lights[i]!;
          const b = beams[i]!;
          if (g.destroyed || b.destroyed) return;
          g.clear();
          b.clear();
          if (a.hidden) return;
          const k = (t - o.start - i * 0.08) / o.rise;
          const on = clamp(k * 4) * clamp((o.total - 0.2 - t) / 0.5);
          g.alpha = on;
          b.alpha = on;
          g.position.set(a.x, a.y);
          b.position.set(a.x, a.y);
          // Behind them still, wherever they have moved to.
          b.zIndex = a.view.zIndex - 0.5;
          g.scale.set(1, 1 / this.ground);
          b.scale.set(1, 1 / this.ground);
          const s = a.size;
          const lit = still ? 1 : EASE.out(clamp(k * 2.5));
          // The column, brighter at its middle and fading out toward its top, so it reads as light rising
          // rather than a box, on paper or on the arcade's black; and a pool of light at their feet.
          // Its sides soft, in nested widths, so no hard edge shows where a figure covers its middle.
          const bands = 7;
          for (let j = 0; j < bands; j++) {
            const h = (s * 4.2) / bands;
            const y = -h * (j + 1);
            const fade = 1 - j / bands;
            for (const [wd, color, alpha] of [[1.2, C.POP_YELLOW, 0.12], [0.9, C.POP_YELLOW, 0.18], [0.6, C.POP_YELLOW, 0.3], [0.3, 0xfff6c8, 0.85]] as const) {
              b.rect(-s * wd * lit, y, s * wd * 2 * lit, h).fill({ color, alpha: alpha * fade });
            }
          }
          b.ellipse(0, 0, s * 1.4, s * 0.45).fill({ color: C.POP_YELLOW, alpha: 0.85 });
          for (let p = 0; p < 4; p++) {
            const kp = still ? 0.45 : clamp(k * 1.4 - p * 0.18);
            if (kp <= 0 || kp >= 1) continue;
            const px = [-0.75, 0.6, -0.2, 0.85][p]! * s;
            const py = -s * (0.4 + kp * 2.6);
            const r = s * (0.32 + 0.1 * Math.sin(kp * Math.PI)) * (still ? 1 : Math.min(1, kp * 6));
            g.poly(plus(px, py, r)).fill(C.HEAL).stroke({ width: Math.max(0.8, s * 0.07), color: C.INK, join: 'miter' });
          }
          // A bob up as the light reaches them.
          if (o.lift !== false) a.lift = still ? 0 : Math.sin(clamp((t - o.start - o.rise * 0.23 - i * 0.08) / 0.3) * Math.PI) * s * 0.45;
        });
      },
      destroy: () => {
        if (o.lift !== false) for (const a of actors) a.lift = 0;
        for (const g of [...beams, ...lights]) if (!g.destroyed) g.destroy();
      },
    };
  }

  /** Puts an effect on the ground under every figure and prop, as a sign drawn on the ground is. */
  underFigures(g: Container): void {
    this.sorted.addChild(g);
    g.zIndex = -1e9 + 1;
  }

  /**
   * Pellets sit on the corners of the tile grid where all four touching tiles are
   * arcade floor: one line down the middle of a corridor two tiles wide, as in
   * Pac-Man, and a grid across anything wider. Each is keyed by its corner,
   * y * (width + 1) + x.
   */
  private buildPellets(eaten: Set<number>): void {
    const m = this.map;
    const floor = TERRAINS.findIndex((t) => t.id === 'arcade_floor');
    const isFloor = (x: number, y: number) => m.terrain[y * m.width + x] === floor;
    // Not where something stands, unless it says pellets may lie under it (the first ghost, at a junction of lines).
    const keepClear = this.map.objects.filter((o) => ['spawn', 'exit', 'npc', 'enemy', 'pickup'].includes(o.type) && o.props.pellets !== true);
    // Areas marked `pellets: false`, such as the ghost house, have none at all, edges included.
    const bare = this.map.objects.filter((o) => o.type === 'area' && o.props.pellets === false);
    for (let y = 1; y < m.height; y++) {
      for (let x = 1; x < m.width; x++) {
        const i = y * (m.width + 1) + x;
        if (eaten.has(i) || !isFloor(x - 1, y - 1) || !isFloor(x, y - 1) || !isFloor(x - 1, y) || !isFloor(x, y)) continue;
        const cx = x * TILE;
        const cy = y * TILE;
        if (bare.some((o) => cx >= o.x && cx <= o.x + o.w && cy >= o.y && cy <= o.y + o.h)) continue;
        const near = keepClear.some((o) => {
          const ox = o.x + o.w / 2;
          const oy = o.y + o.h / 2;
          return Math.abs(ox - cx) < TILE * 0.9 + o.w / 2 && Math.abs(oy - cy) < TILE * 0.9 + o.h / 2;
        });
        if (!near) this.pellets.add(i);
      }
    }
    this.terrain.drawPellets(this.pellets);
  }

  private buildParty(): void {
    const s = this.game.state;
    for (const id of s.order) {
      const m = s.members[id]!;
      const look = this.game.content.party.members[id]!.look;
      if (!isLook(look)) continue;
      const a = new Actor(id, 'party', look, s.x, s.y);
      a.speed = this.partySpeed();
      a.ko = m.hp <= 0;
      a.zBias = -0.01 * this.party.length;
      this.party.push(a);
      this.sorted.addChild(a.view);
    }
  }

  /** Puts the party at a spawn point, stacked on the leader. */
  placeParty(x: number, y: number, facing: Dir): void {
    this.streetSide = null;
    this.streetReturnY = null;
    this.streetCatchup = null;
    for (const a of this.party) {
      a.x = x;
      a.y = y;
      a.facing = facing;
    }
    this.trail = [{ x, y }];
    this.game.state.x = x;
    this.game.state.y = y;
    this.game.state.facing = facing;
    this.snapCamera();
  }

  /** Stands the followers in line behind the leader, as a walk would leave them (a spawn's `lined_up`). */
  lineUpParty(): void {
    const { x, y, facing } = this.leader;
    const [dx, dy] = facing === 'right' ? [-1, 0] : facing === 'left' ? [1, 0] : facing === 'up' ? [0, 1] : [0, -1];
    this.party.forEach((a, i) => {
      a.x = x + dx * i * SPACING;
      a.y = y + dy * i * SPACING;
    });
    this.trail = [];
    for (let d = SPACING * (this.party.length - 1); d > 0; d -= 2) this.trail.push({ x: x + dx * d, y: y + dy * d });
    this.trail.push({ x, y });
  }

  spawnPoint(name: string): MapObject | undefined {
    return this.map.objects.find((o) => o.type === 'spawn' && o.name === name);
  }

  object(name: string): MapObject | undefined {
    return this.props.find(p => p.obj.name === name)?.obj ?? this.map.objects.find((o) => o.name === name);
  }

  /** Finds a figure by party id, party member name, or map object name. */
  actor(name: string): Actor | undefined {
    const n = name.toLowerCase();
    if (n === 'leader') return this.leader;
    return this.party.find((a) => a.id === n) ?? this.npcs.find((a) => a.id === name) ?? this.enemies.find((a) => a.id === name);
  }

  reveal(name: string): void {
    const key = `${this.map.id}:${name}`;
    if (!this.game.state.revealed.includes(key)) this.game.state.revealed.push(key);
    const a = this.actor(name);
    if (a) a.hidden = false;
    const o = this.object(name);
    if (o?.type === 'pickup' && !this.pickups.some((p) => p.obj === o) && !this.game.state.taken.includes(key)) this.addPickup(o);
  }

  hide(name: string): void {
    const a = this.actor(name);
    if (a) {
      a.hidden = true;
      a.dying = false;
    }
    const prop = this.props.find(p => p.obj.name === name);
    if (prop) {
      prop.gfx.visible = false;
      if (prop.fire) prop.fire.visible = false;
      this.waiting = this.waiting.filter(w => w.obj !== prop.obj);
      if (prop.collisionBox) {
        const index = this.collision.boxes.indexOf(prop.collisionBox);
        if (index >= 0) this.collision.boxes.splice(index, 1);
        delete prop.collisionBox;
      }
    }
  }

  /** A scripted blast, optionally leaving non-solid scenery at the figure's final position. */
  async explode(name: string, stop: () => boolean = () => false, remains?: string): Promise<void> {
    const actor = this.actor(name);
    if (!actor || (actor.hidden && !remains) || this.destroyed) return;
    const prop = this.props.find(p => p.obj.name === remains && !p.obj.props.solid);
    const placement: PropPlacement = {
      x: actor.x, y: actor.y, mirror: actor.facing !== 'right',
      width: (wholeBox(actor.look, actor.size)?.halfW ?? actor.size) * 2,
    };
    let replaced = false;
    await this.blast(actor.x, actor.y, actor.size, name, () => {
      if (replaced || this.destroyed) return;
      replaced = true;
      this.hide(name);
      actor.view.visible = false;
      if (!prop) return;
      (tempFor(this.game.state, this.map.id).props ??= {})[prop.obj.name] = placement;
      this.positionProp(prop, placement);
      prop.gfx.visible = true;
      if (prop.fire) prop.fire.visible = true;
      this.waiting = this.waiting.filter(w => w.obj.name !== prop.obj.name);
    }, stop);
  }

  private positionProp(prop: PropView, placement: PropPlacement): void {
    const { x, y, mirror, width } = placement;
    // Keep content immutable: another game or a retry still starts from the authored map.
    prop.obj = { ...prop.obj, x, y };
    prop.gfx.position.set(x, y);
    prop.gfx.zIndex = y;
    const bounds = prop.gfx.getLocalBounds();
    prop.base = width / Math.max(1, bounds.width);
    prop.mirror = mirror;
    prop.fireScale = bounds.height * prop.base / PROPS[prop.kind]!.height;
    if (prop.fire) {
      prop.fire.position.set(x, y);
      prop.fire.zIndex = y + 0.5;
    }
  }

  /** A cannon's near miss before battle: muzzle flash, shell, then smoke beside the party. No damage. */
  async warningShot(name: string, stop: () => boolean = () => false): Promise<void> {
    const actor = this.actor(name);
    if (!actor || actor.hidden || this.destroyed || stop()) return;
    this.following = false;
    for (const a of this.party) a.moving = false;
    const leader = this.leader;
    const previousCamera = this.cameraTarget;
    try {
      // Let the camera include the gun and the party before firing, particularly on upright phones.
      this.cameraTarget = { x: (actor.x + leader.x) / 2, y: (actor.y + leader.y) / 2 };
      if (motion.reduced) this.snapCamera();
      let aim = 0;
      await new Promise<void>(resolve => this.addTask({
        step: dt => { aim += dt; return aim >= .4 || stop(); },
        resolve,
      }));
      if (this.destroyed || stop()) return;
      // Pick open ground beside the party, including approaches along either edge of the square.
      const side = leader.x < actor.x ? 1 : -1;
      const candidates = [side, -side].flatMap(dx => [-8, -40, 24].map(dy => [leader.x + dx * 52, leader.y + dy] as const));
      const [x, y] = candidates.find(([x, y]) => !this.collision.blocked(x, y)
        && this.party.every(a => Math.hypot(x - a.x, y - a.y) > 34)) ?? [leader.x, leader.y - 48];
      actor.facing = x < actor.x ? 'left' : 'right';
      const muzzleX = actor.x + (actor.facing === 'left' ? -1 : 1) * (wholeBox(actor.look, actor.size)?.halfW ?? actor.size * 2) * .92;
      const muzzleY = this.upY(actor.y, actor.size * 3.5);
      const impactY = this.upY(y, 12);
      const shot = new Graphics();
      shot.label = `warning_shot:${name}`;
      shot.eventMode = 'none';
      shot.scale.set(1, 1 / this.ground);
      this.fx.addChild(shot);
      let t = 0;
      const total = .3;
      const draw = () => {
        shot.clear();
        const k = Math.min(1, t / total);
        if (motion.reduced || t < .12) {
          shot.position.set(muzzleX, muzzleY);
          shot.poly(burstPoints(0, 0, 13, 8, .45, 0)).fill(C.POP_YELLOW).stroke({ color: C.INK, width: 1.2 });
          shot.alpha = motion.reduced ? 1 - k : 1;
        } else {
          shot.position.set(muzzleX + (x - muzzleX) * k, muzzleY + (impactY - muzzleY) * k - Math.sin(k * Math.PI) * 10);
          shot.circle(0, 0, 4).fill(C.INK).stroke({ color: C.POP_YELLOW, width: 1.5 });
        }
      };
      draw();
      await new Promise<void>(resolve => this.addTask({
        step: dt => {
          t += dt;
          if (t >= total || shot.destroyed || stop()) return true;
          draw();
          return false;
        },
        resolve: () => { if (!shot.destroyed) shot.destroy(); resolve(); },
      }));
      if (!this.destroyed && !stop()) await this.blast(x, y, 12, 'warning_shot', () => {}, stop);
    } finally {
      this.cameraTarget = previousCamera;
    }
  }

  /** Shared burst for a destructive exit or a harmless impact on the ground. */
  private async blast(x: number, y: number, s: number, label: string, covered: () => void, stop: () => boolean): Promise<void> {
    const g = new Graphics();
    g.label = `explosion:${label}`;
    g.eventMode = 'none';
    g.position.set(x, this.upY(y, s));
    g.scale.set(1, 1 / this.ground);
    this.fx.addChild(g);
    const total = 0.85;
    let t = 0;
    this.game.audio.play('blast');
    if (!motion.reduced) this.shakeTime = Math.max(this.shakeTime, 0.18);
    const draw = () => {
      const still = motion.reduced;
      g.clear();
      g.scale.set(1, 1 / this.ground);
      // Smoke spreads and lifts behind the burst. Reduced motion keeps the drawing still and fades it.
      const k = still ? 0.55 : Math.min(1, t / total);
      const fade = Math.max(0, 1 - Math.max(0, t - 0.3) / (total - 0.3));
      for (let i = 0; i < 6; i++) {
        const angle = (i / 6) * Math.PI * 2;
        const d = s * (0.6 + k * 2);
        g.circle(Math.cos(angle) * d, Math.sin(angle) * d - (still ? 0 : s * k), s * (0.55 + k * 0.5))
          .fill({ color: 0x7d7a73, alpha: fade })
          .stroke({ width: 1.2, color: C.INK, alpha: fade });
      }
      if (still || t < 0.34) {
        const r = s * (still ? 2.3 : 0.7 + 1.6 * EASE.out(Math.min(1, t / 0.1)));
        const alpha = still ? fade : Math.min(1, Math.max(0, (0.34 - t) / 0.18));
        g.poly(burstPoints(0, 0, r, 12, 0.5, 0.15)).fill({ color: 0xe07a1f, alpha }).stroke({ width: 1.8, color: C.INK, alpha });
        g.poly(burstPoints(0, 0, r * 0.78, 10, 0.6, -0.1)).fill({ color: C.POP_YELLOW, alpha });
        g.poly(burstPoints(0, 0, r * 0.42, 8, 0.6, 0.2)).fill({ color: 0xffffff, alpha });
      }
    };
    draw();
    await new Promise<void>((resolve) => {
      this.addTask({
        step: (dt) => {
          t += dt;
          // The first tenth of a second covers the figure before taking it away.
          if (t >= 0.1) covered();
          if (t >= total || g.destroyed || stop()) return true;
          draw();
          return false;
        },
        resolve: () => {
          covered();
          if (!g.destroyed) g.destroy();
          resolve();
        },
      });
    });
  }

  // ---------------------------------------------------------------------------------------------
  // Layout and camera

  /**
   * Desktop/tablet fights may shrink to fit the interface. Phones keep their chosen character size
   * and fit the formation instead, except the reinforced tank group. Null restores exploration.
   */
  private fightScale: number | null = null;
  /** In a fight, how far down the panel the ground shows, in its pixels. */
  fightFloor: number | null = null;
  /** A reinforced tank can exceed the fixed phone body band. Retain its fit through defeat framing. */
  private fittingReinforcedTank = false;
  private baseZoom = 1;
  /** Only opted-in maps hold their arrival street before revealing the alleys. */
  private streetSide: 'street' | 'alley' | null = null;
  private streetReturnY: number | null = null;
  private streetCatchup: number | null = null;
  private streetScroll: { from: number; to: number; elapsed: number } | null = null;

  private streetFrame(viewH = this.viewH, zoom = this.zoom): { hold: number; enter: number; leave: number; landing: number } | null {
    // The street the party arrives on runs along the spawn the map names (`arrival_street`), so it moves with it in Tiled.
    const spawn = this.map.objects.find((o) => o.name === this.map.props.arrival_street);
    if (this.map.props.street_reveal !== true || !spawn || viewH <= 1) return null;
    const street = spawn.y / TILE;
    const half = viewH / (2 * zoom * this.ground);
    // The street's top edge is where a desktop window's view of it ends, at the same place on the map for every window
    // (the owner, 2026-10-29): a taller window looks further down the map rather than into the alleys, and a shorter one
    // follows the party up to that edge. A landscape window's view is TILES_SHORT tiles high, whatever its size.
    const desk = TILES_SHORT * TILE / (2 * this.ground);
    const top = Math.max(desk, Math.min(this.map.height * TILE - desk, street * TILE - this.leader.size / this.ground)) - desk;
    const hold = top + half;
    // The upright body's top touches the street's top edge.
    const enter = top + this.leader.size * 2 / this.ground;
    return { hold, enter, leave: this.streetReturnY ?? enter + TILE * .375,
      landing: (this.streetReturnY === null ? enter : this.streetReturnY - TILE * .375) - half + TILE * 3 };
  }

  private updateStreetReveal(): void {
    const frame = this.streetFrame();
    if (!frame || this.streetScroll) return;
    const y = this.leader.y;
    const next = this.streetSide === 'street' && y < frame.enter ? 'alley'
      : this.streetSide === 'alley' && y > frame.leave ? 'street' : this.streetSide;
    if (next === this.streetSide || next === null) return;
    this.streetSide = next;
    this.streetReturnY = next === 'alley' ? y + TILE * .375 : null;
    // After the reveal, let the party walk into the view before centering on them again.
    this.streetCatchup = next === 'alley' ? this.streetFrame()!.landing : null;
    const [, to] = this.cameraGoal();
    if (motion.reduced) this.camY = to;
    else this.streetScroll = { from: this.camY, to, elapsed: 0 };
  }

  setFightScale(s: number | null, fitPhone = false): void {
    if (s === null) this.fittingReinforcedTank = false;
    else if (fitPhone) this.fittingReinforcedTank = true;
    // A fight may zoom out to fit its interface only while the full view still fits
    // on the map. Walking retains its usual zoom, including on very small maps.
    const [x0, x1] = this.horizontalBoundsAt(this.cameraTarget?.y ?? this.leader.y);
    const minZoom = Math.max(this.viewW / (x1 - x0), this.viewH / (this.map.height * TILE * this.ground));
    this.fightScale = s === null ? null : Math.max(s, minZoom / this.baseZoom);
    this.updateZoom();
  }

  /** Return to the party after a fight or its staged victory scene. */
  releaseFightCamera(frameParty = false, won?: string): void {
    this.restoreBystanders(won);
    this.cameraTarget = null;
    this.partyBackdrop = frameParty;
    this.fightFloor = null;
    this.setFightScale(null);
  }

  /** The door a boss comes out of opens as he steps out; a shut one gives players nothing to try walking into (the owner, 31 Oct). */
  openArrivalDoor(): void {
    if (this.openDoor) this.openDoor.visible = true;
  }

  /** The boss reaching his place starts a staggered reaction, nearest bystander first.
   * Each short alarm beat makes the shared patrol mark readable before the comic hurry. */
  fleeFromArrival(encounter: string, threat: Actor): void {
    if (this.destroyed) return;
    const distance = (a: Actor) => Math.hypot(a.x - threat.x, a.y - threat.y);
    const bystanders = this.npcs.filter(a => !a.hidden && !this.fleeingBystanders.has(a) && a.obj?.props.flee_on_arrival === encounter)
      .sort((a, b) => distance(a) - distance(b));
    for (const [order, a] of bystanders.entries()) {
      if (!a.obj) continue;
      const to = this.object(String(a.obj.props.flee_to));
      if (!to) continue;
      const state = { x: a.x, y: a.y, facing: a.facing, hidden: a.hidden, alert: a.alert, lift: a.lift };
      this.fleeingBystanders.set(a, state);
      a.path = [];
      a.moving = false;
      const current = () => !this.destroyed && this.fleeingBystanders.get(a) === state;
      const via = String(a.obj.props.flee_via ?? '').split(',').map(name => name.trim()).filter(Boolean);
      const route = [...via.map(name => this.object(name)), to];
      void (async () => {
        a.scripted++;
        const wait = (seconds: number) => new Promise<void>(resolve => {
          let elapsed = 0;
          this.addTask({ step: dt => !current() || (elapsed += dt) >= seconds, resolve });
        });
        try {
          if (order) await wait(order * .16);
          if (!current()) return;
          a.facing = to.x < a.x ? 'left' : 'right';
          a.alert = true;
          await wait(.18);
        } finally { a.scripted--; }
        for (const [i, point] of route.entries()) {
          if (!current() || !point) return;
          const x = a.x, y = a.y, distance = Math.hypot(point.x - x, point.y - y);
          const hop = i === 0 && a.obj?.props.flee_hop === true;
          await this.walkStraight(a, point.x, point.y, 180, () => {
            if (!current()) return false;
            if (hop) a.lift = state.lift + 28 * Math.sin(Math.PI * Math.min(1, Math.hypot(a.x - x, a.y - y) / Math.max(1, distance)));
            return true;
          });
          if (current()) a.lift = state.lift;
        }
        if (current()) {
          a.hidden = true;
          a.alert = false;
        }
      })();
    }
  }

  /** Those who ran from a fight since won stay away (the owner, 1 Nov: "Just have them run off and not come back"). */
  private ranForGood(o: Actor['obj'], won?: string): boolean {
    const from = o?.props.flee_on_arrival;
    return typeof from === 'string' && (from === won || this.game.state.beaten.includes(`${this.map.id}:${from}`));
  }

  private restoreBystanders(won?: string): void {
    // Any still running from a fight just won go on out of sight.
    const returning = [...this.fleeingBystanders].filter(([a]) => !this.ranForGood(a.obj, won));
    // Invalidate their walks before putting anyone back, so an old completion cannot hide them again.
    for (const [a] of returning) this.fleeingBystanders.delete(a);
    for (const [a, state] of returning) {
      Object.assign(a, state);
      a.path = [];
      a.moving = false;
    }
  }

  private updateZoom(): void {
    const fixedPhone = thumbReach(this.game.layout) && !shortPhoneFight(this.game.layout) && !this.fittingReinforcedTank;
    this.zoom = this.baseZoom * (fixedPhone ? Math.max(1, this.fightScale ?? 1) : this.fightScale ?? 1);
    // Dots stay the same size relative to the art, whatever the zoom.
    this.halftone.setDot(Math.max(1.6, Math.min(4.2, this.zoom * 1.5)), this.game.renderResolution ?? 1);
  }

  layout(panelW: number, panelH: number, panelX: number, panelY: number): void {
    this.baseZoom = thumbReach(this.game.layout) ? PHONE_BODY_PX / (LOOKS.olli.size * 2) : Math.min(panelW, panelH) / (TILES_SHORT * TILE);
    this.updateZoom();
    this.viewW = panelW;
    this.viewH = panelH;
    this.light?.layout(panelW, panelH);
    void panelX;
    void panelY;
    if (this.streetCatchup !== null) this.streetCatchup = this.streetFrame()?.landing ?? null;
    this.snapCamera();
  }

  // ---------------------------------------------------------------------------------------------
  // The three-quarter view. The game works in flat map units throughout; only the
  // drawing tips the ground. The tilt is 0 in the arcade and 1 on printed maps, and
  // on a map with `tilt_ease_x` it follows the party (or explicit camera target) across those columns.

  /** How far the view is tipped now, from 0 (straight down) to 1 (full tilt). */
  tilt = 0;

  /** How tall the ground is drawn: 1 straight down, less as the view tips. */
  get ground(): number {
    return 1 - FULL_TILT * this.tilt;
  }

  private tiltAt(x: number): number {
    const p = this.map.props;
    if (this.world === 'arcade') return 0;
    const t = p.tilt === undefined || String(p.tilt).trim() === '' ? NaN : Number(p.tilt);
    const full = Number.isFinite(t) ? Math.max(0, Math.min(1, t)) : 1;
    return full * this.easeAt(x);
  }

  /** Across a map's `tilt_ease_x` columns, how far along a point is, eased (0 before them, 1 after); 1 without them. */
  private easeAt(x: number): number {
    const p = this.map.props;
    const ease = typeof p.tilt_ease_x === 'string' ? p.tilt_ease_x.split(',').map(Number) : null;
    if (!ease || ease.length !== 2 || ease.some((v) => !Number.isFinite(v))) return 1;
    const [a, b] = ease as [number, number];
    const k = Math.max(0, Math.min(1, (x / TILE - a) / (b - a || 1)));
    return k * k * (3 - 2 * k);
  }

  /** The leader's share of the map's separate music transition, without perspective easing. */
  musicShare(): number {
    return musicShareAt(this.map.props.music_ease_x, this.leader.x / TILE);
  }

  /**
   * How far into the printed world the party is: 0 in the arcade, 1 on a printed map, and on a mixed map with
   * `tilt_ease_x` eased across those columns as the leader walks them (the view opens out of the arcade's by it). The leader, not
   * the camera, which on the border cannot go far enough left to reach the start of the columns.
   */
  printShare(): number {
    return this.world === 'arcade' ? 0 : this.world === 'print' ? 1 : this.easeAt(this.leader.x);
  }

  /** The world y that is drawn `up` units above a point on the ground, for effects at a figure's middle. */
  upY(y: number, up: number): number {
    return y - up / this.ground;
  }

  private viewW = 1;
  private viewH = 1;

  /** Horizontal edges of a district, when another part of the map extends farther out. */
  private horizontalBoundsAt(y: number): [number, number] {
    const bounds = this.map.objects.find((o) => o.type === 'area' && o.props.horizontal_bounds === true && y >= o.y && y < o.y + o.h);
    return bounds ? [bounds.x, bounds.x + bounds.w] : [0, this.map.width * TILE];
  }

  private cameraGoal(view?: CameraView): [number, number] {
    const { w, h, zoom } = view ?? { w: this.viewW, h: this.viewH, zoom: this.zoom };
    const t = this.cameraTarget ?? this.leader;
    // Centre on a figure's middle, which stands upright above its feet.
    const lift = 'size' in t ? (t as Actor).size / this.ground : 0;
    let x = t.x;
    let y = t.y - lift;
    const backdrop = this.partyBackdrop && !this.cameraTarget
      ? this.map.objects.find(o => o.type === 'area' && o.props.frame_party === true) : undefined;
    if (backdrop) {
      const party = this.party.filter(a => !a.hidden);
      const top = Math.min(...party.map(a => a.y - Math.max(a.size * 2.7, (wholeBox(a.look, a.size)?.depth ?? 0) + a.size * .7) / this.ground));
      const bottom = Math.max(...party.map(a => a.y + 8));
      y = frameBackdropBelow(y, top, bottom, backdrop.y + backdrop.h, h,
        { top: h * .2, bottom: h * .88 }, zoom * this.ground);
    }
    // From the near side a wall hides what is behind it, up to a little over its top (`reveal_over`): walking through a gap in it brings the far side into
    // view, faster than the walk (the owner, 30 Oct: a jarring hole, then a gray dystopia revealing itself as you walk through).
    const wall = !this.cameraTarget ? this.map.objects.find(o => o.type === 'area' && o.props.reveal_north === true) : undefined;
    if (wall) {
      const halfH = h / 2 / (zoom * this.ground);
      const hold = wall.y - Number(wall.props.reveal_over ?? 0) + halfH;
      // The far side is all in view by the time the leader has walked the wall's depth up from its foot (the owner, 30 Oct), not when
      // the camera has caught them up. Its goal gets there a tile sooner, as it eases about that far behind. A party being framed keeps
      // that framing, and a short view keeps the leader in it.
      const through = Math.max(0, Math.min(1, (wall.y + wall.h - this.leader.y) / Math.max(TILE, wall.h - TILE)));
      // Past it, the view's bottom edge stops at the wall's foot on any screen, so nothing of the near side shows (the owner, 30 Oct),
      // or `reveal_stop` above it, so what stands behind the far side comes into view on a wide screen (the owner, 4 Nov, of
      // Berlin's slab blocks: "lets go one row higher"). A short view rises above that as the leader walks on, keeping them in it.
      const lowest = wall.y + wall.h - Number(wall.props.reveal_stop ?? 0) - halfH;
      const goal = Math.max(halfH, Math.min(lowest, backdrop ? y : this.leader.y + halfH * 0.4));
      if (y < hold) y = hold + (goal - hold) * through;
    }
    const street = !this.cameraTarget ? this.streetFrame(h, zoom) : null;
    if (street) {
      const side = this.streetSide ?? (this.leader.y >= street.enter ? 'street' : 'alley');
      if (!view) this.streetSide = side;
      // Hold the entrance reveal to the north, but follow a stroll down to the south street.
      if (side === 'street') y = Math.max(street.hold, y - TILE * 2);
      else if (this.streetCatchup !== null) {
        const catchup = view ? street.landing : this.streetCatchup;
        if (y <= catchup) { if (!view) this.streetCatchup = null; }
        else y = catchup;
      }
      // On the way back, reach the original reveal view before sliding down to the street.
      // Otherwise a deep walk clears catchup and returns with the party still in mid-view.
      if (side === 'alley') y = Math.min(y, street.landing);
    }
    return this.clampCamera(x, y, { w, h, zoom });
  }

  /** The same map limits for a camera goal and a fight's current, easing camera. */
  private clampCamera(x: number, y: number, view: CameraView = { w: this.viewW, h: this.viewH, zoom: this.zoom }): [number, number] {
    // Free fight framing may show the map's backdrop. Keep this through a held loss;
    // releaseFightCamera restores walking limits and the usual ease back to the party.
    if (this.map.props.fight_camera === 'free' && this.cameraTarget && this.fightScale !== null) {
      // A fight past a wall keeps its near side out of view too: the wall's foot goes no higher than where the fight's status row begins.
      const wall = this.map.objects.find(o => o.type === 'area' && o.props.reveal_north === true);
      return [x, wall ? Math.min(y, wall.y + wall.h - ((this.fightFloor ?? view.h) - view.h / 2) / (view.zoom * this.ground)) : y];
    }
    const t = this.cameraTarget ?? this.leader;
    const halfW = view.w / 2 / view.zoom;
    const halfH = view.h / 2 / (view.zoom * this.ground);
    // Walking, the camera follows as it does everywhere else; a district's own edges frame only what the camera is aimed at, a fight or a
    // scene (the owner, 2026-11-02: walking up into the tank square, "Why can't it just be a normal camera there like the rest of the map?").
    const [x0, x1] = this.cameraTarget ? this.horizontalBoundsAt(t.y) : [0, this.map.width * TILE];
    // A cropped foreground row can extend below the walking area without enlarging its collision map.
    const southMargin = !this.cameraTarget && typeof this.map.props.camera_south_margin === 'number'
      ? Math.max(0, this.map.props.camera_south_margin) : 0;
    const mh = this.map.height * TILE + southMargin;
    const left = x0 + halfW;
    const right = x1 - halfW;
    x = left > right ? (left + right) / 2 : Math.max(left, Math.min(right, x));
    const lo = halfH;
    const hi = mh - halfH;
    y = lo > hi ? (lo + hi) / 2 : Math.max(lo, Math.min(hi, y));
    // On the street side of a street reveal, the street's top edge holds like the map's own, even when a tall window
    // then looks past the map's foot.
    const street = !this.cameraTarget && this.streetSide === 'street' ? this.streetFrame(view.h, view.zoom) : null;
    if (street) y = Math.max(y, street.hold);
    return [x, y];
  }

  /** Guard-foot positions whose body or alert can reach the panel. Shadow padding is excluded. */
  private guardWarningBounds(a: Actor, view: CameraView, camera: readonly [number, number]): WarningBounds {
    const halfW = view.w / (2 * view.zoom), halfH = view.h / (2 * view.zoom * this.ground);
    return { x0: camera[0] - halfW - a.size, x1: camera[0] + halfW + a.size,
      y0: camera[1] - halfH, y1: camera[1] + halfH + 42 / this.ground };
  }

  /** Compare the incoming direction with the desktop view, including map-edge and street framing. */
  private patrolWarningTiming(a: Actor, target: { x: number; y: number }, speed: number) {
    if (this.viewW <= 1 || this.viewH <= 1) return { scale: 1, hesitation: 0 };
    const current = { w: this.viewW, h: this.viewH, zoom: this.zoom };
    const panel = computeLayout(1440, 900).panel;
    const reference = { w: panel.w, h: panel.h, zoom: Math.min(panel.w, panel.h) / (TILES_SHORT * TILE) };
    // Virtual camera queries must not change street-reveal state. Preserve the current easing offset.
    const goal = this.cameraGoal(current), refGoal = this.cameraGoal(reference);
    const refCamera = this.clampCamera(refGoal[0] + this.camX - goal[0], refGoal[1] + this.camY - goal[1], reference);
    return warningTiming({ current: this.guardWarningBounds(a, current, [this.camX, this.camY]),
      reference: this.guardWarningBounds(a, reference, refCamera), target, guard: a, speed,
      contact: (this.leader.size + a.size) * .85, tackle: this.map.id === 'field' });
  }

  /** Offscreen pursuits needing an edge cue. HUD places these clear of its actual button/cap geometry. */
  patrolWarnings(): Array<{ id: string; x: number; y: number; hesitation: number }> {
    const warnings: Array<{ id: string; x: number; y: number; hesitation: number }> = [];
    for (const [a, p] of this.patrols) {
      if (a.hidden || !a.alert || !p.edgeWarning || !['chase', 'tackle'].includes(p.state)) continue;
      const [x, y] = this.worldToPanel(a.x, a.y, a.size);
      warnings.push({ id: String(a.obj?.props.encounter ?? a.id), x, y, hesitation: p.warningLeft });
    }
    return warnings;
  }

  /** Following everyone, how far across and down the camera may still stand from where it keeps them (keepPartyInView). */
  private viewSlack: [number, number] | null = null;

  /**
   * Following everyone, the camera, still easing to their middle, moves no less than it must to keep each of them whole in
   * view where they fit (on the smallest phone it cut off Olli's edge as he walked on at the maze's flower, 14 Nov), inside
   * the map's walking limits. Starting outside that, as after a fight framed past the maze's edge, it eases in as after any
   * fight and only never goes farther out than it has been (the owner, 17 Nov: after the giant ghost, "the camera suddenly
   * snaps back from where it was centered on the battle").
   */
  private keepPartyInView(): void {
    const shown = this.party.filter((a) => !a.hidden);
    const halfW = this.viewW / 2 / this.zoom, halfH = this.viewH / 2 / (this.zoom * this.ground);
    let x = this.camX, y = this.camY;
    const left = Math.min(...shown.map((a) => a.x - a.size)), right = Math.max(...shown.map((a) => a.x + a.size));
    if (right - left <= 2 * halfW) x = Math.min(left + halfW, Math.max(right - halfW, x));
    const top = Math.min(...shown.map((a) => a.y - 2 * a.size / this.ground)), bottom = Math.max(...shown.map((a) => a.y));
    if (bottom - top <= 2 * halfH) y = Math.min(top + halfH, Math.max(bottom - halfH, y));
    [x, y] = this.clampCamera(x, y);
    const [sx, sy] = this.viewSlack ?? [Infinity, Infinity];
    this.camX = x + Math.max(-sx, Math.min(sx, this.camX - x));
    this.camY = y + Math.max(-sy, Math.min(sy, this.camY - y));
    this.viewSlack = [Math.abs(this.camX - x), Math.abs(this.camY - y)];
  }

  /** A fight's change of zoom must not expose an edge while the camera eases to its new goal. */
  confineCamera(): void {
    [this.camX, this.camY] = this.clampCamera(this.camX, this.camY);
  }

  snapCamera(): void {
    this.streetScroll = null;
    this.tilt = this.tiltAt(this.cameraTarget?.x ?? this.leader.x);
    [this.camX, this.camY] = this.cameraGoal();
  }

  /** Where a map point is on the panel; `up` lifts it that many units, upright, as for a point on a figure. */
  worldToPanel(x: number, y: number, up = 0): [number, number] {
    return [(x - this.camX) * this.zoom + this.viewW / 2, (y - this.camY) * this.zoom * this.ground + this.viewH / 2 - up * this.zoom];
  }

  /** The point on the ground under a panel point. */
  panelToWorld(px: number, py: number): [number, number] {
    return [(px - this.viewW / 2) / this.zoom + this.camX, (py - this.viewH / 2) / (this.zoom * this.ground) + this.camY];
  }

  /** The point on the ground that will be under a panel point once the camera is where it is heading. */
  panelToWorldSettled(px: number, py: number): [number, number] {
    const [gx, gy] = this.cameraGoal();
    return [(px - this.viewW / 2) / this.zoom + gx, (py - this.viewH / 2) / (this.zoom * this.ground) + gy];
  }

  // ---------------------------------------------------------------------------------------------
  // Update

  /** Start fresh protection after restoring a save or retry checkpoint. */
  protectUntilMovement(grace = 0): void {
    this.grace = grace;
    this.stationaryGrace = true;
  }

  /** A member drawn over the leader on the party's stack, and its usual place in the stack, until the first step. */
  private onTop: { actor: Actor; zBias: number } | null = null;

  /**
   * Draws a member over the leader where the party stands stacked, until the leader's first step puts the leader on top
   * again (Ronnienomics!'s word back on the map). Its draw order rather than its place: the trail would pull a member
   * set a pixel lower straight back.
   */
  onTopUntilMovement(a: Actor): void {
    this.onTop ??= { actor: a, zBias: a.zBias };
    a.zBias = 0.01;
  }

  update(dt: number): void {
    const g = this.game;
    this.burnT += dt;
    this.light?.update(dt);
    const busy = g.storyBusy() || g.screensOpen();
    if (this.cameraTarget) this.streetScroll = null;
    const canWalk = this.control && !busy && !this.streetScroll;
    if (canWalk && this.grace > 0) this.grace -= dt;
    if (this.pelletSoundCooldown > 0) this.pelletSoundCooldown -= dt;
    const storyNow = g.storyBusy();
    if (this.storyWas && !storyNow) this.talkRest = 0.3;
    this.storyWas = storyNow;
    if (this.talkRest > 0) this.talkRest -= dt;

    const before = { x: this.leader.x, y: this.leader.y };
    this.walkIntent = [0, 0];
    this.walkAim = null;
    if (!canWalk) this.edgePush = null;
    this.dropTape();
    if (canWalk) {
      this.followTapTalk(dt);
      this.updateLeader(dt);
    } else if (!g.battleActive() && this.control && !this.leader.scripted) this.leader.moving = false;
    const moved = Math.hypot(this.leader.x - before.x, this.leader.y - before.y) > 0.01;
    if (canWalk && this.leader.y < before.y) {
      for (const prop of this.yieldingProps) {
        if (prop.seconds > 0) continue; // Timed entrances hold movement in updateLeader.
        const { view } = prop;
        const y = view.obj.y - prop.offset;
        if (!view.gfx.visible || Math.abs(this.leader.x - view.obj.x) > this.leader.size + 8 ||
          this.leader.y < y - 4 || this.leader.y > y + this.leader.size) continue;
        prop.offset = Math.min(prop.max, prop.offset + before.y - this.leader.y);
        view.gfx.y = view.obj.y - prop.offset;
        view.gfx.zIndex = view.gfx.y;
      }
    }
    // End stationary protection before guards notice or contact is checked on this same step.
    if (canWalk && moved) {
      this.stationaryGrace = false;
      if (this.onTop) this.onTop.actor.zBias = this.onTop.zBias;
      this.onTop = null;
    }
    if (!g.battleActive() && !this.onPatrolGround(this.leader.x, this.leader.y)) this.wayIn = { x: this.leader.x, y: this.leader.y };
    if (canWalk && !g.battleActive() && !this.cameraTarget) this.updateStreetReveal();
    const scrolling = this.streetScroll !== null;
    if (!g.battleActive() && !scrolling) this.updateFollowers(dt);
    if (scrolling) for (const a of this.party) a.moving = false;

    if (!scrolling) for (const a of this.npcs) this.updateNpc(a, dt, busy);
    else for (const a of this.npcs) if (!a.scripted && typeof a.obj?.props.scenery_patrol === 'number') a.moving = false;
    if (!busy && !scrolling && !g.battleActive()) {
      this.patrolTime += dt;
      for (const a of this.enemies) this.updateEnemy(a, dt);
    }
    // Held where they are through fights, menus, scenes and the street slide, as the townspeople are: one caught mid-step
    // would otherwise go on walking in place, mouth and all.
    else for (const a of this.enemies) if (!a.scripted) a.moving = false;
    // Once the fight or scene that set their flags is over, so the player sees them come.
    if (this.waiting.length && !busy && !g.battleActive() && !this.showing) this.checkAppearing();
    else if (this.waiting.length && (busy || g.battleActive())) this.noteGlimpses();
    for (const a of [...this.party, ...this.npcs, ...this.enemies]) a.update(dt);

    if (canWalk && !scrolling && this.checkTouches(moved, dt) === 'left') return;
    if (!busy && !scrolling && !g.battleActive() && this.control && !this.tapTalk && !this.tapUse) {
      this.ringAge += dt;
      this.hoverAge += dt;
    }
    g.state.x = this.leader.x;
    g.state.y = this.leader.y;
    g.state.facing = this.leader.facing;

    // Match snapCamera's focus: edge clamping can put the camera past the transition before anyone walks.
    this.tilt = this.tiltAt(this.cameraTarget?.x ?? this.leader.x);
    const [gx, gy] = this.cameraGoal();
    const k = 1 - Math.exp(-dt * 7);
    this.camX += (gx - this.camX) * k;
    if (this.streetScroll) {
      const s = this.streetScroll;
      if (!busy) s.elapsed += dt;
      const progress = motion.reduced ? 1 : Math.min(1, s.elapsed / (MS.mapSlide / 1000));
      this.camY = s.from + (s.to - s.from) * EASE.smooth(progress);
      if (progress === 1) this.streetScroll = null;
    } else this.camY += (gy - this.camY) * k;
    if (this.cameraTarget === this.everyone) this.keepPartyInView();
    else this.viewSlack = null;
    // The shake's offset is chosen here, with the world's own time, so a world held still (under the pause page
    // over a fight) holds one offset rather than jittering on each frame drawn.
    if (this.shakeTime > 0) {
      this.shakeTime -= dt;
      // About a sixth of a text unit either way, so it looks the same on any screen.
      const k = this.game.layout.unit * 0.3;
      this.shake = motion.reduced || this.shakeTime <= 0 ? [0, 0] : [(Math.random() - 0.5) * k, (Math.random() - 0.5) * k];
    } else this.shake = [0, 0];
  }

  /** Where the shake puts the view this step, in panel pixels. */
  private shake: [number, number] = [0, 0];

  /**
   * What the leader walked into this step. Stops at the first thing that starts a
   * scene, a fight, or a map change, so two can never start together.
   */
  private checkTouches(moved: boolean, dt: number): 'left' | 'busy' | 'free' {
    const g = this.game;
    if (this.checkPickups()) return 'busy';
    if (moved) this.checkPellets();
    if (this.checkTriggers(moved)) return 'busy';
    if (this.checkExits(moved, dt)) return 'left';
    if (this.checkEnemies()) return 'busy';
    if (g.input.pressed('confirm') && this.interact()) return 'busy';
    if (this.tapTalk && this.leader.distanceTo(this.tapTalk) < TALK_REACH) {
      const npc = this.tapTalk;
      this.tapTalk = null;
      this.tapPath = [];
      this.talkTo(npc);
      return 'busy';
    }
    if (this.tapUse && this.inRect(this.tapUse, this.leader.x, this.leader.y - 4, 14)) {
      this.tapUse = null;
      this.tapPath = [];
      if (this.interact()) return 'busy';
    }
    // The walk ended without reaching them (they wandered off, or the way was blocked).
    if (!this.tapPath.length) {
      this.tapTalk = null;
      this.tapUse = null;
    }
    return 'free';
  }

  /** Barrier tape comes down off its posts when the party walks through it (the owner, 29 Oct). */
  private dropTape(): void {
    for (const t of this.tapes) {
      const foot = t.o.y + t.o.h;
      if (t.up.visible && this.party.some(a => !a.hidden && a.x > t.o.x && a.x < t.o.x + t.o.w && Math.abs(a.y - foot) < 6)) {
        t.up.visible = false;
        t.down.visible = true;
      }
    }
  }

  private updateLeader(dt: number): void {
    const leader = this.leader;
    const input = this.game.input;
    let [mx, my] = input.moveVector();
    // How far a tapped walk's next point is. The step stops on it, so each leg is walked along the very line
    // `Collision.straighten` found clear; turning up to 3 units before each point, as walks once did, a long leg ran a
    // little off that line and could catch on a prop it cleared by less (Berlin's trees; the review of 2026-10-03).
    let reach = Infinity;
    if (mx !== 0 || my !== 0) {
      this.pushTap = null;
      this.tapPath = [];
      this.tapExitPoint = null;
      this.tapTalk = null;
      this.tapUse = null;
    } else if (this.tapPath.length) {
      const [tx, ty] = this.tapPath[0]!;
      const dx = tx - leader.x;
      const dy = ty - leader.y;
      const d = Math.hypot(dx, dy);
      if (d < 0.01) {
        this.tapPath.shift();
      } else {
        mx = dx / d;
        my = dy / d;
        reach = d;
        this.walkAim = [tx, ty];
      }
    }
    if (mx === 0 && my === 0) {
      leader.moving = false;
      return;
    }
    this.walkIntent = [mx, my];
    const step = Math.min(leader.speed * dt, reach);
    let dx = mx * step;
    let dy = my * step;
    // Land at contact instead of losing the last whole collision step (up to three units).
    // Collision still checks the entire approach, so a prop or wall in front of the exit cannot be skipped.
    let pushingEdge = false;
    if (!this.game.dev.noclip) for (const o of this.map.objects) {
      if (o.type !== 'exit' || !this.feetIn(o, leader.x + dx, leader.y + dy)) continue;
      const edge = this.edgeExit(o);
      if (!edge) continue;
      const [ex, ey] = edge.contact, [vx, vy] = edge.normal;
      if (vx * mx + vy * my <= 0) continue;
      if (vx && (leader.x - ex) * vx <= 0 && (leader.x + dx - ex) * vx > 0) dx = ex - leader.x;
      if (vy && (leader.y - ey) * vy <= 0 && (leader.y + dy - ey) * vy > 0) dy = ey - leader.y;
      // Keep the outward tap leg for a future nonzero lean time, until input replaces it or the exit fires.
      if (requirementsMet(this.game.state, o.props.requires) &&
        Math.abs((leader.x + dx - ex) * vx + (leader.y + dy - ey) * vy) <= EDGE_EXIT_CONTACT &&
        (!this.walkAim || (this.walkAim[0] - ex) * vx + (this.walkAim[1] - ey) * vy > 0) && !this.exitsLocked()) pushingEdge = true;
    }
    let [nx, ny] = this.game.dev.noclip ? [leader.x + dx, leader.y + dy] : this.collision.move(leader.x, leader.y, dx, dy);
    let pushing = false;
    if (!this.game.dev.noclip && dy < 0) for (const prop of this.yieldingProps) {
      if (prop.seconds <= 0 || prop.elapsed >= prop.seconds || !prop.view.gfx.visible) continue;
      const { view } = prop;
      const front = view.obj.y - prop.offset + 8;
      const halfWidth = Math.max(18, PROPS[view.kind]?.foot[0] ?? 0) + 8;
      if (Math.abs(nx - view.obj.x) > halfWidth || leader.y < front - 3 || ny > front) continue;
      pushing = true;
      prop.elapsed = Math.min(prop.seconds, prop.elapsed + dt);
      // Resist first, then barely shift at first and gather speed as the obstruction gives way.
      const progress = Math.max(0, (prop.elapsed - prop.delay) / Math.max(0.01, prop.seconds - prop.delay));
      prop.offset = prop.max * progress * progress * progress;
      view.gfx.y = view.obj.y - prop.offset;
      view.gfx.zIndex = view.gfx.y;
      if (prop.elapsed < prop.seconds) ny = Math.max(ny, view.gfx.y + 8);
    }
    const dist = Math.hypot(nx - leader.x, ny - leader.y);
    // Held by something: under 0.05 moved, or under half of a short last step onto a point.
    const stuck = dist < Math.min(0.05, step / 2);
    // As followers do: a stick held near a diagonal flipped the leader between two ways every step or two. Keys give an
    // exact diagonal, which faces the side.
    leader.facing = walkFacing(mx, my, leader.facing);
    leader.moving = !stuck;
    const [px, py] = [leader.x, leader.y];
    leader.x = nx;
    leader.y = ny;
    if (reach !== Infinity) {
      if (!pushing && !stuck && step === reach) this.tapPath.shift();
      // Held within 3 units of the point, the walk goes on to the next, as it did; held further off, it ends.
      else if (stuck && !pushing && !pushingEdge) {
        if (reach < 3) this.tapPath.shift();
        else this.tapPath = [];
      }
    }
    this.pushTrail(px, py);
  }

  /** Adds the leader's place to the trail every 2 units; (px, py) is where they were a step before. */
  private pushTrail(px: number, py: number): void {
    let last = this.trail[this.trail.length - 1];
    // A leader turning back over the trail's last stretch keeps the point where they turned. Without it the trail
    // behind them shortened, and each follower's place on it slid back a step, so they stepped back and turned round
    // again (seen when a tapped walk set off back the way the last one came, 2026-10-03).
    if (last && (px - last.x) * (this.leader.x - px) + (py - last.y) * (this.leader.y - py) < 0 && Math.hypot(px - last.x, py - last.y) > 0.01) {
      this.trail.push({ x: px, y: py });
      last = this.trail[this.trail.length - 1];
    }
    if (!last || Math.hypot(last.x - this.leader.x, last.y - this.leader.y) >= 2) this.trail.push({ x: this.leader.x, y: this.leader.y });
    if (this.trail.length > 300) this.trail.splice(0, this.trail.length - 300);
  }

  /** The point `dist` world units back along the leader's trail. */
  private trailPoint(dist: number): { x: number; y: number } {
    let remaining = dist;
    let prev = { x: this.leader.x, y: this.leader.y };
    for (let i = this.trail.length - 1; i >= 0; i--) {
      const p = this.trail[i]!;
      const d = Math.hypot(p.x - prev.x, p.y - prev.y);
      if (d >= remaining) {
        const t = remaining / d;
        return { x: prev.x + (p.x - prev.x) * t, y: prev.y + (p.y - prev.y) * t };
      }
      remaining -= d;
      prev = p;
    }
    return prev;
  }

  /**
   * Back along the route actually walked, never a nearest-tile jump across the enemy. Caught in an alley, back at the
   * mouth the party came in by instead: retried inside, its guards were on them again within a second of the first step
   * (the owner, 2026-11-07: "That seems like it would be hard to get out of").
   */
  retryPoint(): { x: number; y: number } {
    const point = this.trailPoint(TILE * 1.5);
    const back = this.collision.blocked(point.x, point.y) ? { x: this.game.state.x, y: this.game.state.y } : point;
    return this.wayIn && this.onPatrolGround(back.x, back.y) ? { ...this.wayIn } : back;
  }

  /**
   * The party has been put down at a saved place (Continue): if that is on a patrol's ground, the nearest ground off every
   * patrol's that can be walked to is remembered as the way in. A world starts with none, so a retry after Continue from
   * inside an alley put the party back inside, every time (Fable review P1, 2026-11-09).
   */
  enteredAtSavedPlace(): void {
    if (this.wayIn || !this.onPatrolGround(this.leader.x, this.leader.y)) return;
    this.wayIn = this.nearestOffPatrol(this.leader.x, this.leader.y);
  }

  /** The middle of the nearest open tile off all patrol ground that can be walked to from (x, y), by tile steps; null if none. */
  private nearestOffPatrol(x: number, y: number): { x: number; y: number } | null {
    const w = this.map.width, h = this.map.height;
    const open = (c: number, r: number) => !this.collision.blocked((c + 0.5) * TILE, (r + 0.5) * TILE);
    const start = Math.floor(y / TILE) * w + Math.floor(x / TILE);
    const seen = new Uint8Array(w * h);
    const queue = [start];
    seen[start] = 1;
    for (let i = 0; i < queue.length; i++) {
      const c = queue[i]! % w, r = Math.floor(queue[i]! / w);
      const cx = (c + 0.5) * TILE, cy = (r + 0.5) * TILE;
      if (open(c, r) && !this.onPatrolGround(cx, cy)) return { x: cx, y: cy };
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nc = c + dc, nr = r + dr, k = nr * w + nc;
        if (nc < 0 || nr < 0 || nc >= w || nr >= h || seen[k] || !open(nc, nr)) continue;
        seen[k] = 1;
        queue.push(k);
      }
    }
    return null;
  }

  /** Whether followers walk the trail. Scripts turn this off to place them freely. */
  following = true;

  private updateFollowers(dt: number): void {
    if (!this.following) return;
    for (let i = 1; i < this.party.length; i++) {
      const f = this.party[i]!;
      const p = this.trailPoint(i * SPACING);
      const dx = p.x - f.x;
      const dy = p.y - f.y;
      const d = Math.hypot(dx, dy);
      if (d < 0.3) {
        f.moving = false;
        continue;
      }
      // Close gaps smoothly rather than jumping.
      const step = Math.min(d, Math.max(f.speed * 1.6 * dt, d > 6 ? 0 : d));
      f.x += (dx / d) * step;
      f.y += (dy / d) * step;
      f.moving = true;
      f.facing = walkFacing(dx, dy, f.facing);
    }
  }

  private updateNpc(a: Actor, dt: number, busy: boolean): void {
    if (typeof a.obj?.props.spar === 'string') return this.spar(a, dt, busy);
    if (a.scripted || this.fleeingBystanders.has(a)) return;
    const sceneryPatrol = a.obj?.props.scenery_patrol;
    if (typeof sceneryPatrol === 'number') {
      // Background figures, with no combat or collision role. Unlike Beijing traffic,
      // they hold their place through dialogue as well as fights, menus and world holds.
      a.moving = !a.hidden && !a.talking && !busy && this.control && !this.game.battleActive();
      if (!a.moving) return;
      const span = Math.abs(sceneryPatrol) * TILE;
      a.aiTimer += dt;
      if (a.obj?.props.patrol_axis === 'y') {
        // Down the path and back in short walks, a long stop at each bed, turned toward it (the Berlin allotment's gardener).
        const stops = [0, 0.5, 1, 0.5];
        const rest = 4.5;
        const walk = (span / 2) / a.speed;
        const at = a.aiTimer % ((rest + walk) * stops.length);
        const i = Math.floor(at / (rest + walk));
        const local = at - i * (rest + walk);
        const [from, to] = [stops[i]!, stops[(i + 1) % stops.length]!];
        a.moving = local >= rest;
        a.y = a.homeY + (from + (to - from) * (a.moving ? (local - rest) / walk : 0)) * span;
        a.facing = a.moving ? (to > from ? 'down' : 'up') : i % 2 ? 'left' : 'right';
        return;
      }
      const leg = (a.aiTimer * a.speed) % (span * 2);
      const out = leg < span;
      a.x = a.homeX + Math.sign(sceneryPatrol) * (out ? leg : span * 2 - leg);
      a.facing = (out ? sceneryPatrol : -sceneryPatrol) > 0 ? 'right' : 'left';
      return;
    }
    if (a.obj?.props.traffic === true) {
      // Background street life continues through conversations; menus, battles and
      // the camera's street slide still pause it. Speaking/scripted actors are separate.
      a.moving = !a.hidden && !this.game.screensOpen() && !this.game.battleActive();
      if (!a.moving) return;
      // Ambient walkers and riders have authored, collision-checked routes. Their off-map legs are
      // deliberately outside the playable boundary; they cannot trigger exits or block the party.
      const half = this.viewW / (2 * this.zoom);
      const width = Number(a.obj.props.traffic_width ?? this.map.width * TILE);
      const left = Math.min(-TILE * 2, this.camX - half - TILE * 2);
      const right = Math.max(width + TILE * 2, this.camX + half + TILE * 2);
      const dir = a.homeFacing === 'left' ? -1 : 1;
      a.x += dir * a.speed * dt;
      a.facing = a.homeFacing;
      if (a.x < left) a.x = right;
      else if (a.x > right) a.x = left;
      // The lakeside promenade slopes slightly; the shopping streets use level rows. A sloping walk is set from where the walker
      // stands in Tiled, how far below it (or above, negative) at the west end and at the east, so it moves with it.
      if (typeof a.obj.props.traffic_dy_west === 'number' && typeof a.obj.props.traffic_dy_east === 'number') {
        const progress = Math.max(0, Math.min(1, (a.x - 48) / (width - 96)));
        const [west, east] = [a.obj.y + a.obj.props.traffic_dy_west, a.obj.y + a.obj.props.traffic_dy_east];
        a.y = west + (east - west) * progress;
      }
      return;
    }
    const wander = Number(a.obj?.props.wander ?? 0);
    if (a.talking || a.hidden || (busy && this.game.storyBusy())) {
      a.moving = false;
      return;
    }
    // Those who stand are held through fights and menus (below); those who wander are not, so they turn as ever.
    if (wander || (!busy && !this.game.battleActive())) this.turnAside(a, dt);
    // Someone with something to say waits while the leader is close, rather than wander off mid-approach. Only for a while, or a
    // leader standing about stops everyone who comes by (the owner, 30 Oct). They wait again once the leader has been away.
    const near = this.leader.distanceTo(a);
    if (near < TILE * 1.5 && this.canTalkTo(a)) {
      const waited = (this.waited.get(a) ?? 0) + dt;
      this.waited.set(a, waited);
      if (!wander || waited < LONGEST_WAIT) {
        a.path = [];
        a.moving = false;
        return;
      }
    } else if (near > TILE * 2.5) this.waited.delete(a);
    if (!wander) {
      // Standing still through fights and menus, as enemies do.
      if (busy || this.game.battleActive()) a.moving = false;
      else this.idle(a, dt);
      return;
    }
    if (a.obj?.props.stroll === true && this.strollOn(a, dt)) return;
    a.aiTimer -= dt;
    if (a.aiTimer <= 0 || !a.path.length) {
      if (a.aiTimer <= 0) {
        a.aiTimer = 1.5 + this.rng() * 2.5;
        const ang = this.rng() * Math.PI * 2;
        const r = this.rng() * wander * TILE;
        a.path = this.rng() < 0.35 ? [] : [[a.homeX + Math.cos(ang) * r, a.homeY + Math.sin(ang) * r]];
        // Stopping for a while, they often look about.
        if (!a.path.length && this.idleRng() < 0.6) a.facing = this.lookAway(a.facing);
      }
    }
    const target = a.path[0];
    if (!target) {
      a.moving = false;
      return;
    }
    const dx = target[0] - a.x;
    const dy = target[1] - a.y;
    const d = Math.hypot(dx, dy);
    if (d < 2) {
      a.path = [];
      a.moving = false;
      return;
    }
    const [nx, ny] = this.collision.move(a.x, a.y, (dx / d) * a.speed * dt, (dy / d) * a.speed * dt);
    a.moving = Math.hypot(nx - a.x, ny - a.y) > 0.02;
    if (!a.moving) a.path = [];
    // Setting off just after turning aside, they keep the side unless the walk leads well away from it.
    a.facing = walkFacing(dx, dy, a.facing);
    a.x = nx;
    a.y = ny;
  }

  /** The sparring pair's own clock, kept by the one who leads (`spar`), so the two keep time with each other. */
  private sparT = 0;
  /** Those sparring on their spots; the others are on their way back to them, or held. */
  private readonly sparring = new Set<Actor>();

  /**
   * Sparring (a townsperson whose `spar` names their partner: the ninjas of the martial arts street): on their map spots,
   * facing each other, they take turns lunging while the other gives way, then both leap in together, over and over, the
   * one with `spar_lead` first. Talking or in a scene they stand still (the scene parts them); afterwards each walks back
   * to their spot, and they start again once both are there. With Reduce motion they stand in their stances.
   */
  private spar(a: Actor, dt: number, busy: boolean): void {
    const o = a.obj!;
    const partner = this.actor(String(o.props.spar));
    const lead = o.props.spar_lead === true;
    const stand = () => {
      a.lift = 0;
      a.lean = 0;
      a.squash = 1;
    };
    if (a.scripted || a.hidden || a.talking || busy || this.game.battleActive() || !partner) {
      // Standing as the round stops; a scene moving them has their poses from then on.
      if (this.sparring.delete(a) || !a.scripted) stand();
      if (!a.scripted) a.moving = false;
      return;
    }
    const [hx, hy] = [o.x, o.y];
    if (!this.sparring.has(a)) {
      // Back to the spot, then turned to the partner.
      stand();
      const [dx, dy] = [hx - a.x, hy - a.y], d = Math.hypot(dx, dy), step = a.speed * dt;
      if (d > step) {
        a.x += (dx / d) * step;
        a.y += (dy / d) * step;
        a.moving = true;
        a.facing = walkFacing(dx, dy, a.facing);
        return;
      }
      [a.x, a.y] = [hx, hy];
      a.moving = false;
      this.sparring.add(a);
      if (lead) this.sparT = 0;
    }
    const toward = partner.obj!.x > hx ? 1 : -1;
    a.facing = toward > 0 ? 'right' : 'left';
    if (!this.sparring.has(partner) || motion.reduced) {
      stand();
      a.x = hx;
      a.moving = false;
      return;
    }
    if (lead) this.sparT += dt;
    const pose = sparPose(this.sparT, lead);
    a.x = hx + toward * pose.dx;
    a.y = hy;
    a.lift = pose.lift;
    a.lean = pose.lean;
    a.squash = pose.squash;
    // A shout with each blow.
    a.moving = pose.shout;
  }

  /**
   * Someone going from building to building: they loiter a few seconds round where they are (wandering, below), then walk the
   * way the map allows to another of the map's `stroll_stop` points, and loiter there. True while they are on their way.
   */
  private strollOn(a: Actor, dt: number): boolean {
    const r = this.idleRng;
    let s = this.strolls.get(a);
    if (!s) this.strolls.set(a, s = { loiter: 3 + r() * 8, to: null, stuck: 0 });
    if (!s.to) {
      s.loiter -= dt;
      if (s.loiter > 0) return false;
      // Someone with `stroll_within` keeps to the stops that near where they began.
      const within = a.obj?.props.stroll_within;
      const stops = this.map.objects.filter(o => o.type === 'point' && o.props.stroll_stop === true && Math.hypot(o.x - a.homeX, o.y - a.homeY) > TILE * 3 &&
        (typeof within !== 'number' || Math.hypot(o.x - (a.obj?.x ?? a.homeX), o.y - (a.obj?.y ?? a.homeY)) < TILE * within));
      // Somewhere nobody else is or is going to, when there is such a place, so they do not bunch up.
      const taken = (o: MapObject) => [...this.strolls].some(([b, t]) => b !== a && (t.to === o || (!t.to && Math.hypot(o.x - b.homeX, o.y - b.homeY) < TILE * 3)));
      const free = stops.filter(o => !taken(o));
      const choice = [...(free.length ? free : stops)];
      // The first they can get to from here: a map can have parts shut off from each other.
      s.to = null;
      while (choice.length && !s.to) {
        const pick = choice.splice(Math.floor(r() * choice.length), 1)[0]!;
        if (this.collision.findPath(a.x, a.y, pick.x, pick.y).length) s.to = pick;
      }
      a.path = [];
      s.stuck = 0;
      if (!s.to) { s.loiter = 4; return false; }
    }
    const settle = () => {
      a.homeX = a.x;
      a.homeY = a.y;
      s.to = null;
      s.loiter = 5 + r() * 6;
      a.path = [];
      a.aiTimer = 0;
      a.moving = false;
    };
    if (!a.path.length) {
      if (Math.hypot(s.to.x - a.x, s.to.y - a.y) < TILE) { settle(); return false; }
      a.path = this.collision.straighten(a.x, a.y, this.collision.findPath(a.x, a.y, s.to.x, s.to.y));
      if (!a.path.length) { settle(); return false; }
    }
    const [tx, ty] = a.path[0]!;
    const [dx, dy] = [tx - a.x, ty - a.y];
    const d = Math.hypot(dx, dy);
    if (d < 2) { a.path.shift(); return true; }
    const [nx, ny] = this.collision.move(a.x, a.y, (dx / d) * a.speed * dt, (dy / d) * a.speed * dt);
    a.moving = Math.hypot(nx - a.x, ny - a.y) > 0.02;
    // Held up by a corner the path cut too fine: think again, and after a while stop here instead.
    s.stuck = a.moving ? 0 : s.stuck + dt;
    if (s.stuck > 0.4) a.path = [];
    if (s.stuck > 1.5) { settle(); return false; }
    a.facing = walkFacing(dx, dy, a.facing);
    a.x = nx;
    a.y = ny;
    return true;
  }

  /**
   * A townsperson who stays put still lives a little: now and then they look another way for a moment,
   * or shift a few units aside and back, and after a talk they turn back the way they stood. The moves
   * draw on the idle numbers, so play's own numbers are as they were.
   */
  private idle(a: Actor, dt: number): void {
    a.moving = false;
    // Workers absorbed in a task keep their authored stance instead of glancing at passers-by.
    if (a.obj?.props.idle === false) { a.facing = a.homeFacing; return; }
    const r = this.idleRng;
    // A shift under way, at a slow shuffle and without walking, so the figure stays as it stood.
    const to = a.path[0];
    if (to) {
      const dx = to[0] - a.x;
      const dy = to[1] - a.y;
      const d = Math.hypot(dx, dy);
      const s = Math.min(d, 16 * dt);
      if (d < 0.2) a.path.shift();
      else {
        a.x += (dx / d) * s;
        a.y += (dy / d) * s;
      }
      return;
    }
    if (a.glance > 0) {
      a.glance -= dt;
      if (a.glance <= 0) a.facing = a.homeFacing;
      return;
    }
    a.idleTimer -= dt;
    if (a.idleTimer > 0) return;
    a.idleTimer = 2.5 + r() * 4;
    const away = Math.hypot(a.x - a.homeX, a.y - a.homeY) > 0.5;
    if (away || a.facing !== a.homeFacing) {
      a.facing = a.homeFacing;
      if (away) a.path = [[a.homeX, a.homeY]];
      return;
    }
    if (r() < 0.6) {
      a.facing = this.lookAway(a.homeFacing);
      a.glance = 0.7 + r() * 1.1;
      return;
    }
    // A step aside, mostly sideways; held a moment, then home on the next move.
    const side = r() < 0.5 ? -1 : 1;
    const [vx, vy] = r() < 0.7 ? [side, 0] : [0, side];
    const k = 3 + r() * 3;
    const [tx, ty] = [a.homeX + vx * k, a.homeY + vy * k];
    if (this.collision.blocked(tx, ty)) return;
    a.path = [[tx, ty]];
    a.idleTimer = 0.8 + r() * 1.4;
  }

  /** Another way to look than `from`: the other side, or either side for someone facing up or down. */
  private lookAway(from: Dir): Dir {
    if (isSide(from)) return from === 'left' ? 'right' : 'left';
    return this.idleRng() < 0.5 ? 'left' : 'right';
  }

  /**
   * A townsperson at rest faces up or down only for a moment after walking that way, half a second, then turns to
   * the side they last faced (the owner, 2026-10-03; at first 1 to 2 seconds, which the owner found "a little long").
   * Menus and fights hold those who stand as they are; those who wander go on wandering, and turning.
   */
  private turnAside(a: Actor, dt: number): void {
    if (a.moving || isSide(a.facing)) {
      a.turnIn = -1;
      return;
    }
    if (a.turnIn < 0) a.turnIn = 0.5;
    a.turnIn -= dt;
    if (a.turnIn <= 0) {
      a.facing = a.side;
      a.turnIn = -1;
    }
  }

  private updateEnemy(a: Actor, dt: number): void {
    if (a.hidden || a.scripted) return;
    const patrol = this.patrols.get(a);
    if (patrol) {
      patrol.update(dt, this.leader, this.control && !this.stationaryGrace && this.grace <= 0 && !this.game.dev.peace, this.patrolTime);
      return;
    }
    const p = a.obj?.props ?? {};
    const behavior = String(p.behavior ?? 'still');
    a.aiTimer += dt;
    if (behavior === 'shuffle') {
      const prevX = a.x;
      a.x = a.homeX + Math.sin(a.aiTimer * 1.6) * 10;
      a.moving = true;
      a.facing = a.x >= prevX ? 'right' : 'left';
    } else if (behavior === 'patrol') {
      const [ox, oy] = String(p.patrol ?? '4,0').split(',').map((v) => Number(v) * TILE) as [number, number];
      const len = Math.hypot(ox, oy) || 1;
      const period = (len / a.speed) * 2 + 1.2;
      const t = a.aiTimer % period;
      const leg = (period - 1.2) / 2;
      let f: number;
      if (t < leg) f = t / leg;
      else if (t < leg + 0.6) f = 1;
      else if (t < leg * 2 + 0.6) f = 1 - (t - leg - 0.6) / leg;
      else f = 0;
      const nx = a.homeX + ox * f;
      const ny = a.homeY + oy * f;
      a.moving = Math.hypot(nx - a.x, ny - a.y) > 0.01;
      if (a.moving) a.facing = dirFromVector(nx - a.x, ny - a.y, a.facing);
      a.x = nx;
      a.y = ny;
    } else {
      a.moving = false;
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Touching things

  /**
   * Takes the pickups the leader stands on. One `guarded_by` an encounter cannot be taken
   * while any of its enemies still stands: touching it sets them on the party instead, so a
   * prize can be seen with its guards but not taken without the fight. Returns true when
   * that starts a fight.
   */
  private checkPickups(): boolean {
    const leader = this.leader;
    const s = this.game.state;
    for (const pk of [...this.pickups]) {
      if (!pk.landed || Math.hypot(pk.obj.x - leader.x, pk.obj.y - 6 - (leader.y - 6)) > 16) continue;
      const guard = pk.obj.props.guarded_by;
      if (typeof guard === 'string' && this.enemies.some((e) => String(e.obj?.props.encounter) === guard)) {
        if (this.stationaryGrace || this.grace > 0 || this.game.dev.peace || !s.order.some((id) => (s.members[id]?.hp ?? 0) > 0)) continue;
        void this.startEncounter(guard, pk);
        return true;
      }
      this.takePickup(pk);
    }
    return false;
  }

  /** Collects a map pickup once, including the same effects for a prize won by touching it. */
  private takePickup(pk: PickupView): void {
    const index = this.pickups.indexOf(pk);
    if (index < 0 || this.game.state.taken.includes(pk.key)) return;
    const kind = String(pk.obj.props.kind);
    const data = this.game.content.pickups[kind];
    if (!data) return;
    this.applyPickup(kind);
    this.game.state.taken.push(pk.key);
    // The maze's stop opens with its last power pellet.
    if (this.map.id === 'maze') {
      unlockMazeRest(this.game.state, this.game.content);
      this.game.noteProgress?.((p) => once(p.pellets, pk.key));
    }
    pk.gfx.destroy({ children: true });
    this.pickups.splice(index, 1);
    if (data.celebrate) this.celebrate(pk.obj.x, pk.obj.y, data.message);
    else {
      this.pickupBurst(pk.obj.x, pk.obj.y);
      if (data.message) this.game.toast(data.message);
    }
    // A power pellet's notice is followed, under it, by how many of the map's power pellets are found (the owner,
    // 2026-10-22), a beat later, so the two land one after the other.
    const pellets = powerPellets(this.game.content, this.map.id);
    if (pellets.includes(pk.key)) {
      const found = pellets.filter((key) => this.game.state.taken.includes(key)).length;
      const text = this.game.msg('system', 'power_pellets', { found, total: pellets.length });
      let wait = PELLET_COUNT_DELAY;
      this.addTask({ step: (dt) => { wait -= dt; if (wait > 0) return false; this.game.toast(text); return true; }, resolve: () => {} });
    }
    if (data.walk) for (const a of this.party) a.speed = this.partySpeed();
    this.game.audio.play(data.sound);
  }

  /** Bursts showing where a pickup was taken, for the checks. */
  pickupBursts = 0;

  /**
   * Where a pickup is taken, a yellow starburst with an ink line and a pink heart pops up and a thin ring
   * spreads from it, gone in 0.4 s; drawn upright on tilted ground. With Reduce motion the burst stands
   * still at full size and fades, with no ring.
   */
  private pickupBurst(x: number, y: number): void {
    const g = new Graphics();
    g.eventMode = 'none';
    g.position.set(x, this.upY(y, 8));
    g.scale.set(1, 1 / this.ground);
    this.fx.addChild(g);
    this.pickupBursts++;
    let t = 0;
    const total = 0.4;
    const draw = () => {
      g.clear();
      const still = motion.reduced;
      g.alpha = t > total * 0.5 ? Math.max(0, 1 - (t - total * 0.5) / (total * 0.5)) : 1;
      const r = still ? 11 : 5 + EASE.pop(Math.min(1, t / 0.12)) * 6;
      g.poly(burstPoints(0, 0, r, 8, 0.5, 0.3)).fill(C.POP_YELLOW).stroke({ width: 1.2, color: C.INK, join: 'miter' });
      g.poly(burstPoints(0, 0, r * 0.45, 8, 0.55, 0.1)).fill(C.POP_PINK);
      if (!still) g.circle(0, 0, r + EASE.out(Math.min(1, t / total)) * 14).stroke({ width: 1.2, color: C.INK });
    };
    draw();
    this.addTask({
      step: (dt) => {
        t += dt;
        if (t >= total || g.destroyed) return true;
        draw();
        return false;
      },
      resolve: () => {
        this.pickupBursts--;
        if (!g.destroyed) g.destroy();
      },
    });
  }

  /** How many things have popped in on this map since it was built, for the checks. */
  appeared = 0;

  /** How many props and townspeople are still waiting for their flags, for the checks. */
  get waitingCount(): number {
    return this.waiting.length;
  }

  /** While the camera is away showing something that has appeared out of sight (`showAppearing`). */
  private showing = false;
  /**
   * What was waiting, its flags set, whose spot a fight or scene showed while it ran (the students' star, beside the
   * student the scene after the tank turns to): the player has seen where it is, so it needs no visit.
   */
  private glimpsed = new Set<(typeof this.waiting)[number]>();

  /**
   * Shows whatever was waiting for flags that are now set: each pops up with a burst, and one sound plays, once it
   * is on screen, so it is seen to come. One that appears out of sight (the maze's stop, opened by a fight at the
   * far end) is shown: the camera goes over to it (`showAppearing`), unless the fight or scene that set its flags
   * showed its spot; that one pops in as the party comes within sight of it. Out of sight means out of sight where
   * the camera is heading: the owner, 2026-10-15, took the last power pellet in the ghost house on a desktop, whose
   * fight was framed wide enough to take in the stop; it popped in there as the camera turned back to the party,
   * which left it just off the screen, and the camera never went over.
   */
  private checkAppearing(): void {
    let any = false;
    const away: typeof this.waiting = [];
    for (const w of [...this.waiting]) {
      if (!requirementsMet(this.game.state, w.obj.props.appears)) continue;
      // One with `pop: false` (the tank's wreck) is simply there from then on, with no burst or sound.
      if (w.obj.props.pop === false) {
        this.waiting.splice(this.waiting.indexOf(w), 1);
        w.show(true);
        continue;
      }
      if (!this.inView(w.obj.x, w.obj.y, true)) {
        if (!this.glimpsed.has(w)) away.push(w);
        continue;
      }
      // In sight where the camera is heading but not yet now: it pops in as the camera gets there.
      if (!this.inView(w.obj.x, w.obj.y)) continue;
      this.appear(w);
      any = true;
    }
    if (any) this.game.audio.play('appear');
    // (A world with no view laid out, as in the unit tests, has nothing to show it in.)
    else if (away.length && this.viewW > 1 && this.control && !this.cameraTarget && !this.streetScroll && !this.leader.scripted) {
      void this.showAppearing(away);
    }
  }

  /** Notes what a fight or scene shows of the spots of things whose flags are now set (`glimpsed`). */
  private noteGlimpses(): void {
    for (const w of this.waiting) {
      if (w.obj.props.pop !== false && !this.glimpsed.has(w) && requirementsMet(this.game.state, w.obj.props.appears) && this.inView(w.obj.x, w.obj.y)) this.glimpsed.add(w);
    }
  }

  private appear(w: (typeof this.waiting)[number]): void {
    this.waiting.splice(this.waiting.indexOf(w), 1);
    w.show(false);
    this.appearBurst(w.obj.x, w.obj.y);
    this.appeared++;
  }

  /**
   * Shows the player what has appeared out of sight, so they know it is there to go to (the owner, 2026-10-13: the
   * maze's stop opened at the exit while the party was at the far end, with no sign of it). The party waits while
   * the camera goes over, everything there pops in with one sound, and after a moment the camera comes back. With
   * Reduce motion the camera cuts there and back. Any too far from the first to share the view with it gets a visit
   * of its own after this one.
   */
  private async showAppearing(due: Array<(typeof this.waiting)[number]>): Promise<void> {
    this.showing = true;
    this.control = false;
    this.tapPath = [];
    this.tapTalk = null;
    this.tapUse = null;
    for (const a of this.party) a.moving = false;
    const pause = (limit: number, done: () => boolean = () => false) => new Promise<void>((resolve) => {
      let t = 0;
      this.addTask({ step: (dt) => (t += dt) >= limit || done(), resolve });
    });
    const settled = () => {
      const [gx, gy] = this.cameraGoal();
      return Math.hypot(gx - this.camX, gy - this.camY) < 2;
    };
    try {
      // Centred between them, those near enough to the first to share the view with it.
      const first = due[0]!.obj;
      const near = due.filter((w) => Math.abs(w.obj.x - first.x) < (this.viewW / this.zoom) * 0.6 && Math.abs(w.obj.y - first.y) < (this.viewH / (this.zoom * this.ground)) * 0.6);
      const xs = near.map((w) => w.obj.x);
      const ys = near.map((w) => w.obj.y);
      // At once, so a camera still on its way back from a scene's spot nearby goes straight on from there.
      this.cameraTarget = { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
      if (motion.reduced) this.snapCamera();
      await pause(1.8, settled);
      if (this.destroyed) return;
      // All of them, even one the camera cannot bring clear of the view's edge (by the map's edge), so no visit
      // comes back for it.
      for (const w of near) if (this.waiting.includes(w)) this.appear(w);
      this.game.audio.play('appear');
      await pause(1.2);
      if (this.destroyed) return;
      this.cameraTarget = null;
      if (motion.reduced) this.snapCamera();
      await pause(1.6, settled);
    } finally {
      this.cameraTarget = null;
      this.control = true;
      this.showing = false;
    }
  }

  /**
   * Whether a point on the ground, and its burst around it, is inside the panel now, or (`settled`) once the camera
   * is where it is heading.
   */
  inView(x: number, y: number, settled = false): boolean {
    const margin = 24 * this.zoom;
    let [px, py] = this.worldToPanel(x, y, 14);
    if (settled) {
      const [gx, gy] = this.cameraGoal();
      px -= (gx - this.camX) * this.zoom;
      py -= (gy - this.camY) * this.zoom * this.ground;
    }
    return px >= margin && py >= margin && px <= this.viewW - margin && py <= this.viewH - margin;
  }

  /** Grows something from nothing to its size, overshooting a little; at once with Reduce motion. */
  private popIn(set: (k: number) => void): void {
    if (motion.reduced) {
      set(1);
      return;
    }
    let t = 0;
    set(0);
    this.addTask({
      step: (dt) => {
        t += dt;
        const k = Math.min(1, t / 0.35);
        set(Math.max(0, EASE.pop(k)));
        return k >= 1;
      },
      resolve: () => set(1),
    });
  }

  /**
   * Where something appears: a puff of white over a yellow starburst, two ink rings spreading, and four
   * sparkles thrown out, gone in 0.6 s; drawn upright on tilted ground. With Reduce motion the burst stands
   * still at full size and fades.
   */
  private appearBurst(x: number, y: number): void {
    const g = new Graphics();
    g.eventMode = 'none';
    g.position.set(x, this.upY(y, 14));
    g.scale.set(1, 1 / this.ground);
    this.fx.addChild(g);
    let t = 0;
    const total = 0.6;
    const draw = () => {
      g.clear();
      const still = motion.reduced;
      g.alpha = t > total * 0.45 ? Math.max(0, 1 - (t - total * 0.45) / (total * 0.55)) : 1;
      const r = still ? 20 : 6 + EASE.pop(Math.min(1, t / 0.18)) * 14;
      g.poly(burstPoints(0, 0, r * 1.4, 10, 0.45, still ? 0 : t)).fill({ color: 0xffffff, alpha: 0.7 });
      g.poly(burstPoints(0, 0, r, 8, 0.5, 0.3)).fill(C.POP_YELLOW).stroke({ width: 1.4, color: C.INK, join: 'miter' });
      if (still) return;
      for (const [d, w] of [[0, 2], [0.12, 1.2]] as const) {
        const k = Math.max(0, Math.min(1, (t - d) / 0.5));
        if (k > 0 && k < 1) g.circle(0, 0, r + EASE.out(k) * 26).stroke({ width: w, color: C.INK, alpha: 1 - k });
      }
      const fly = EASE.out(Math.min(1, t / total));
      for (let i = 0; i < 4; i++) {
        const ang = Math.PI / 4 + (i * Math.PI) / 2;
        g.poly(burstPoints(Math.cos(ang) * (r + fly * 22), Math.sin(ang) * (r + fly * 22), 4, 4, 0.3, 0)).fill(0xffffff).stroke({ width: 1, color: C.INK });
      }
    };
    draw();
    this.addTask({
      step: (dt) => {
        t += dt;
        if (t >= total || g.destroyed) return true;
        draw();
        return false;
      },
      resolve: () => {
        if (!g.destroyed) g.destroy();
      },
    });
  }

  applyPickup(kind: string): void {
    const data = this.game.content.pickups[kind];
    if (!data) return;
    const s = this.game.state;
    for (const bonus of [data, ...(data.bonuses ?? [])]) {
      if (bonus.stat === 'dots') {
        s.dots += bonus.amount;
        continue;
      }
      for (const id of s.order) {
        const m = s.members[id]!;
        switch (bonus.stat) {
          case 'max_hp':
            m.maxHp += bonus.amount;
            break;
          case 'max_mp':
            m.maxMp += bonus.amount;
            break;
          case 'strength':
            m.strength += bonus.amount;
            break;
          case 'accuracy':
            m.accuracy = Math.min(100, m.accuracy + bonus.amount);
            break;
          case 'speed':
            m.speed += bonus.amount;
            break;
        }
      }
    }
  }

  private checkPellets(): void {
    if (!this.pellets.size) return;
    const leader = this.leader;
    // The middle of the feet, which can be anywhere across a corridor: a pellet on the
    // corridor's middle line is eaten even by a leader hugging one wall.
    const cx = leader.x;
    const cy = leader.y - 4;
    const reach = TILE * 0.9;
    const cols = this.map.width + 1;
    const eaten: number[] = [];
    for (const ky of [Math.floor(cy / TILE), Math.ceil(cy / TILE)]) {
      for (const kx of [Math.floor(cx / TILE), Math.ceil(cx / TILE)]) {
        const i = ky * cols + kx;
        if (this.pellets.has(i) && !eaten.includes(i) && Math.hypot(kx * TILE - cx, ky * TILE - cy) <= reach) eaten.push(i);
      }
    }
    if (!eaten.length) return;
    for (const i of eaten) {
      this.pellets.delete(i);
      tempFor(this.game.state, this.map.id).pellets.push(i);
      this.applyPickup('pellet');
    }
    this.terrain.drawPellets(this.pellets);
    if (this.pelletSoundCooldown <= 0) {
      this.game.audio.play('waka');
      this.pelletSoundCooldown = 0.16;
    }
  }

  private inRect(o: MapObject, x: number, y: number, pad = 0): boolean {
    return x >= o.x - pad && x <= o.x + o.w + pad && y >= o.y - pad && y <= o.y + o.h + pad;
  }

  /** Whether the leader's feet box touches a rectangle. */
  private feetIn(o: MapObject, x: number, y: number): boolean {
    return x + FEET_HW >= o.x && x - FEET_HW <= o.x + o.w && y >= o.y && y - FEET_H <= o.y + o.h;
  }

  /**
   * Starts an enter trigger when walked into, or a seen trigger when its centre comes into view. A seen trigger
   * also checks while standing still (after loading or resizing). Enter triggers with `needs_rest` need missing HP/MP.
   */
  private checkTriggers(moved: boolean): boolean {
    const s = this.game.state;
    for (const o of this.saveFeedback) {
      if (!this.inRect(o, this.leader.x, this.leader.y, TILE * 2)) this.saveFeedback.delete(o);
    }
    for (const o of this.map.objects) {
      const on = o.props.on ?? 'enter';
      if (o.type !== 'trigger' || (on !== 'enter' && on !== 'seen')) continue;
      const key = `${this.map.id}:${o.name || o.id}`;
      const inside = on === 'seen' ? this.inView(o.x + o.w / 2, o.y + o.h / 2) : this.inRect(o, this.leader.x, this.leader.y);
      if (!inside) {
        this.insideTriggers.delete(key);
        continue;
      }
      if (this.insideTriggers.has(key) || (on === 'enter' && !moved)) continue;
      // A visible landmark whose requirements are not met can become eligible without leaving the view.
      if (on === 'enter') this.insideTriggers.add(key);
      if (!requirementsMet(s, o.props.requires)) continue;
      if (o.props.needs_rest && !this.partyNeedsRest()) continue;
      const seen = `seen:${key}`;
      if (o.props.once && s.flags[seen]) continue;
      this.insideTriggers.add(key);
      // The legacy save_when_full property marks a walk-on star. Healing now uses
      // the same nonblocking path, so neither missing resources nor a KO starts a scene.
      if (o.props.save_when_full) {
        s.flags[seen] = true;
        const healed = this.partyNeedsRest();
        if (healed) void this.game.rest({ quiet: true });
        // Save at the point just reached without starting a scene or changing a tapped route.
        // Normal movement writes these coordinates later in update(), after checking triggers.
        s.x = this.leader.x;
        s.y = this.leader.y;
        s.facing = this.leader.facing;
        const feedback = !this.saveFeedback.has(o);
        const saved = this.game.saveNow();
        // Full parties see green pluses without a scene, caption or healing tune; keep the existing save sound.
        if ((saved && feedback) || healed) {
          this.saveFeedback.add(o);
          this.saveGlow(o);
          this.game.audio.play(healed ? 'rest' : 'save');
        }
        continue;
      }
      // runScene captures the pre-scene state before this once flag is set. A lost scripted
      // fight can therefore return before the trigger and be attempted again later.
      void this.game.runScene(String(o.props.scene));
      s.flags[seen] = true;
      return true;
    }
    return false;
  }

  /** Whether anyone in the party is short of HP or MP (a member who is down is short of HP). */
  private partyNeedsRest(): boolean {
    const s = this.game.state;
    return s.order.some((id) => {
      const m = s.members[id];
      return m !== undefined && (m.hp < m.maxHp || m.mp < m.maxMp);
    });
  }

  /**
   * Which way the next panel comes from: the edge of the map the exit is on, or, for a
   * door inside the map, the way the party is walking.
   */
  private exitSide(o: MapObject): Dir {
    // Not edgeExit's side: Berlin's way back runs along its bottom edge but slides left, back the way the party came in
    // from Beijing's right edge.
    const [x0, x1] = this.horizontalBoundsAt(o.y);
    const mh = this.map.height * TILE;
    if (o.x <= x0 + TILE) return 'left';
    if (o.x + o.w >= x1 - TILE) return 'right';
    if (o.y <= TILE) return 'up';
    if (o.y + o.h >= mh - TILE) return 'down';
    return this.leader.facing;
  }

  /** Side exits touch the district boundary on their thin axis. House doors remain walk-on exits. */
  private edgeExit(o: MapObject): EdgeExit | null {
    if (this.map.id === 'house' || o.props.to === 'house') return null;
    const [x0, x1] = this.horizontalBoundsAt(o.y);
    const mh = this.map.height * TILE;
    const x = o.x + o.w / 2, y = o.y + o.h / 2;
    if (o.w <= o.h) {
      if (Math.abs(o.x - x0) < EDGE_EXIT_CONTACT) return { side: 'left', normal: [-1, 0], contact: [x0 + FEET_HW + EDGE_INSET, y] };
      if (Math.abs(o.x + o.w - x1) < EDGE_EXIT_CONTACT) return { side: 'right', normal: [1, 0], contact: [x1 - FEET_HW - EDGE_INSET, y] };
    } else {
      if (Math.abs(o.y) < EDGE_EXIT_CONTACT) return { side: 'up', normal: [0, -1], contact: [x, FEET_H + EDGE_INSET] };
      if (Math.abs(o.y + o.h - mh) < EDGE_EXIT_CONTACT) return { side: 'down', normal: [0, 1], contact: [x, mh - EDGE_INSET] };
    }
    return null;
  }

  /**
   * The side exit a walk to this feet point asks to leave by: the point is within the exit's span and in its outermost
   * tile (EDGE_TAP_REACH) or past its edge.
   */
  private edgeTarget(gx: number, gy: number): { exit: MapObject; edge: EdgeExit } | undefined {
    for (const o of this.map.objects) {
      if (o.type !== 'exit') continue;
      const edge = this.edgeExit(o);
      if (!edge) continue;
      const [vx, vy] = edge.normal, [ex, ey] = edge.contact;
      const inset = vx ? FEET_HW : vy < 0 ? FEET_H : 0;
      // Inside the outermost tile only: a point a whole tile in is the next tile's edge.
      const past = (gx - ex) * vx + (gy - ey) * vy > inset + EDGE_INSET - EDGE_TAP_REACH;
      const inSpan = vx ? gy >= o.y && gy - FEET_H <= o.y + o.h
        : gx + FEET_HW >= o.x && gx - FEET_HW <= o.x + o.w;
      if (past && inSpan) return { exit: o, edge };
    }
    return undefined;
  }

  private targetExit(x: number, y: number): MapObject | null {
    return this.edgeTarget(x, y)?.exit ?? this.map.objects.find(o =>
      o.type === 'exit' && !this.edgeExit(o) && this.feetIn(o, x, y)) ?? null;
  }

  private availableExitDirection(exit: MapObject | null): Dir | null {
    return exit && !this.exitsLocked() && requirementsMet(this.game.state, exit.props.requires)
      ? exitDirection(exit, this.horizontalBoundsAt(exit.y), this.map.height * TILE) : null;
  }

  /** The same eligible exit intent for mouse hover and the held pointer, without submitting a walk. */
  exitAt(x: number, y: number): { exit: MapObject; direction: Dir } | null {
    const exit = this.targetExit(x, y), direction = this.availableExitDirection(exit);
    return exit && direction ? { exit, direction } : null;
  }

  /** Called only for a mouse by the panel router. A camera move still resolves the stationary pointer each render. */
  hover(x: number, y: number): void {
    this.mouseAt = [x, y];
    const [wx, wy] = this.panelToWorld(x, y), intent = this.exitAt(wx, wy + 6);
    if (!intent) { this.clearExitHover(); return; }
    if (intent.exit !== this.hoverExit) this.hoverAge = 0;
    this.hoverExit = intent.exit;
    this.hoverPoint = [x, y];
  }

  clearHover(): void {
    this.clearExitHover();
    this.mouseAt = null;
  }

  private clearExitHover(): void {
    this.hoverPoint = null;
    this.hoverExit = null;
  }

  /** The point against the edge level with this one. */
  private onEdge(edge: EdgeExit, x: number, y: number): [number, number] {
    return edge.normal[0] ? [edge.contact[0], y] : [x, edge.contact[1]];
  }

  /**
   * Ends a walk asked to leave by a side exit at the edge and on through it. From where the path ends: the point asked
   * for when the path reached it, or else straight out to the edge (at a span's end or beside a wall, the point asked
   * for can be one no one can stand on, and the path ends on a tile beside it); then a tile past the edge, so the walk
   * pushes out until the exit takes it.
   */
  /** Ends a tapped walk, with whatever it was going to do on arrival. Every fight does (Game.startBattle): a walk tapped
   * before a walk-on scene's fight walked on after it, alone, even out by an exit the win had just opened (Fable review P11). */
  endTappedWalk(): void {
    this.tapPath = [];
    this.tapExitPoint = null;
    this.tapExit = null;
    this.tapTalk = null;
    this.tapUse = null;
    this.pushTap = null;
  }

  private walkOutBy({ exit, edge }: { exit: MapObject; edge: EdgeExit }, gx: number, gy: number): void {
    // No leg out through an exit that is still shut: it would wait at the edge and walk out the moment the exit opened.
    if (!requirementsMet(this.game.state, exit.props.requires)) return;
    const end = this.tapPath.at(-1) ?? [this.leader.x, this.leader.y];
    let at: [number, number] | null = null;
    if (Math.hypot(end[0] - gx, end[1] - gy) < .1) at = [gx, gy];
    else {
      const out = this.onEdge(edge, end[0], end[1]);
      if (this.feetIn(exit, ...out) && !this.collision.blocked(...out) && this.collision.clearLine(end[0], end[1], ...out)) {
        this.tapPath.push(out);
        at = out;
      }
    }
    if (!at) return;
    this.tapExitPoint = at;
    this.tapPath.push([at[0] + edge.normal[0] * TILE, at[1] + edge.normal[1] * TILE]);
  }

  /** A detected party cannot skip the bridge encounter by slipping across a map boundary. */
  private exitsLocked(): boolean {
    return this.enemies.some(e => e.obj?.props.relentless === true && this.patrols.get(e)?.state === 'chase');
  }

  private checkExits(moved: boolean, dt: number): boolean {
    if (this.exitsLocked()) {
      this.edgePush = null;
      return false;
    }
    for (const o of this.map.objects) {
      if (o.type !== 'exit') continue;
      if (!this.feetIn(o, this.leader.x, this.leader.y)) continue;
      if (!requirementsMet(this.game.state, o.props.requires)) continue;
      const edge = this.edgeExit(o);
      if (edge) {
        const [vx, vy] = edge.normal, [ex, ey] = edge.contact;
        const gap = (ex - this.leader.x) * vx + (ey - this.leader.y) * vy;
        const pushing = this.walkIntent[0] * vx + this.walkIntent[1] * vy > 0;
        // Short of the edge is no push; past it (only with dev's noclip, which walks off the map) still leaves.
        if (!pushing || gap > EDGE_EXIT_CONTACT) continue;
        if (this.walkAim && (this.walkAim[0] - ex) * vx + (this.walkAim[1] - ey) * vy <= 0) continue;
        if (this.edgePush?.exit !== o) this.edgePush = { exit: o, seconds: 0 };
        this.edgePush.seconds += dt;
        if (this.edgePush.seconds < EDGE_EXIT_PUSH_SECONDS) return false;
      } else if (!moved) continue;
      void this.game.changeMap(String(o.props.to), String(o.props.spawn), { dir: this.exitSide(o) });
      return true;
    }
    this.edgePush = null;
    return false;
  }

  private checkEnemies(): boolean {
    if (this.stationaryGrace || this.grace > 0 || this.game.dev.peace) return false;
    const s = this.game.state;
    // A party with nobody standing cannot fight. It should never be on the map, but never start a lost fight.
    if (!s.order.some((id) => (s.members[id]?.hp ?? 0) > 0)) return false;
    const leader = this.leader;
    for (const e of this.enemies) {
      if (e.hidden) continue;
      const enc = String(e.obj?.props.encounter ?? '');
      if (this.patrols.get(e)?.canFight === false) continue;
      // A whole figure is met anywhere on its picture; anyone else within the two bodies' reach.
      const box = wholeBox(e.look, e.size);
      const met = box
        ? Math.abs(e.x - leader.x) < box.halfW + leader.size && leader.y > e.y - box.depth - leader.size && leader.y < e.y + leader.size
        : Math.hypot(e.x - leader.x, e.y - e.size - (leader.y - leader.size)) < (leader.size + e.size) * 0.85;
      if (met) {
        void this.startEncounter(enc);
        return true;
      }
    }
    return false;
  }

  /** Starts the fight with every enemy on this map that shares the encounter. */
  /** The power pellet a fight going on is for, by its key: won, it is taken once the fight is over. */
  prizeAtStake: string | null = null;

  async startEncounter(enc: string, prize?: PickupView): Promise<void> {
    const group = this.enemies.filter((e) => String(e.obj?.props.encounter) === enc);
    if (!group.length) return;
    const patrolFight = group.some(e => this.patrols.has(e) && e.obj?.props.relentless !== true && e.obj?.props.confined !== true);
    for (const e of group) {
      e.alert = false;
      this.patrols.get(e)?.prepareForFight();
    }
    this.tapPath = [];
    this.tapTalk = null;
    this.tapUse = null;
    // A fight with a power pellet's guards is for that pellet however it began, from the pellet or from bumping into one of
    // them: won, the pellet is taken, and the music after the fight counts it (the owner, 2026-11-12).
    prize ??= this.pickups.find((pk) => pk.obj.props.guarded_by === enc && !this.game.state.taken.includes(pk.key));
    this.prizeAtStake = prize?.key ?? null;
    let outcome: BattleOutcome;
    try {
      outcome = await this.game.startBattle(enc, group);
    } finally {
      this.prizeAtStake = null;
      if (patrolFight && !this.destroyed) this.protectUntilMovement(PATROL_FIGHT_GRACE);
    }
    if (outcome === 'won' && !this.destroyed) {
      this.defeatEncounter(enc);
      // Battle formation can leave the party away from the pellet that started this fight.
      if (prize) {
        this.takePickup(prize);
        this.game.autosave();
      }
    }
  }

  /** A battle-owned reinforcement: no map object or patrol is persisted. Encounter cleanup and
   * retry's fresh World dispose of it with the rest of that fight's enemies. */
  addBattleEnemy(kind: string, id: string, encounter: string, x: number, y: number): Actor {
    const enemy = this.game.content.enemies[kind];
    if (this.destroyed || !enemy || !isLook(enemy.look)) throw new Error(`Cannot add battle enemy ${kind}`);
    const obj: MapObject = { id: -1, name: id, type: 'enemy', x, y, w: 0, h: 0, point: true,
      props: { kind, encounter, behavior: 'still', facing: 'left' } };
    const actor = new Actor(id, 'enemy', enemy.look, x, y, obj);
    actor.facing = 'left';
    this.enemies.push(actor);
    this.sorted.addChild(actor.view);
    return actor;
  }

  /** Records a won fight in the saved state, so its enemies stay gone. Safe to call twice. */
  recordDefeat(enc: string): void {
    const s = this.game.state;
    const data = this.game.content.encounters[enc];
    const list = data?.respawn ? tempFor(s, this.map.id).defeated : s.beaten;
    const key = data?.respawn ? enc : `${this.map.id}:${enc}`;
    if (!list.includes(key)) list.push(key);
  }

  /** Records a won fight and takes its enemies off the map. */
  defeatEncounter(enc: string): void {
    this.recordDefeat(enc);
    for (const e of this.enemies.filter((x) => String(x.obj?.props.encounter) === enc)) this.removeEnemy(e);
    this.grace = 2;
  }

  /** Takes one enemy off the map. A lost fight's retry builds a fresh World, which brings back any that left for it. */
  removeEnemy(e: Actor): void {
    e.destroy();
    this.patrols.delete(e);
    this.enemies.splice(this.enemies.indexOf(e), 1);
  }

  /** An enemy who left its group for a fight and was beaten there stays off the map until the map resets. */
  noteLeft(name: string): void {
    (tempFor(this.game.state, this.map.id).left ??= []).push(name);
  }

  /** Whether a townsperson has something to say now. */
  canTalkTo(n: Actor): boolean {
    return !n.hidden && Boolean(n.obj?.props.scene) && requirementsMet(this.game.state, n.obj?.props.requires);
  }

  /**
   * What Confirm would start from where the leader stands: the townsperson they face, else the
   * nearest one within reach, else a trigger used by touch that they stand in. Only those with
   * something to say now count, so someone not ready cannot swallow the press. The mark over
   * people and taps on it use this same rule, so the mark shows exactly when Confirm would work.
   */
  interactTarget(): { actor: Actor } | { use: MapObject } | null {
    if (this.talkRest > 0) return null;
    const leader = this.leader;
    const [fx, fy] = dirVector(leader.facing);
    const px = leader.x + fx * 16;
    const py = leader.y - 6 + fy * 16;
    let best: Actor | null = null;
    let bestD = 30;
    for (const n of this.npcs) {
      if (!this.canTalkTo(n)) continue;
      const d = Math.hypot(n.x - px, n.y - 6 - py);
      if (d < bestD) {
        best = n;
        bestD = d;
      }
    }
    if (!best) {
      bestD = 32;
      for (const n of this.npcs) {
        if (!this.canTalkTo(n)) continue;
        const d = leader.distanceTo(n);
        if (d < bestD) {
          best = n;
          bestD = d;
        }
      }
    }
    if (best) return { actor: best };
    for (const o of this.map.objects) {
      if (o.type === 'trigger' && o.props.on === 'use' && this.inRect(o, leader.x, leader.y - 4, 14) && requirementsMet(this.game.state, o.props.requires)) return { use: o };
    }
    return null;
  }

  /** Where the mark over the interact target points, in panel coordinates, or null. */
  interactAnchor(): [number, number] | null {
    const t = this.interactTarget();
    if (!t) return null;
    if ('actor' in t) return this.speakingAnchor(t.actor);
    const o = t.use;
    return this.worldToPanel(o.x + (o.w ?? 0) / 2, o.y + (o.h ?? 0) / 2, TILE * 0.6);
  }

  /** Where the mark over a talker points, in panel coordinates. */
  private speakingAnchor(n: Actor): [number, number] {
    const at = n.speakingPoint();
    return this.worldToPanel(at.x, at.y, at.up);
  }

  /**
   * Where the mark goes: over someone with something to say whom the mouse is on, or a tapped walk is going to, else
   * over the interact target. The owner, 14 Nov: with the mouse on someone it shows as if the leader stood beside them,
   * so the player sees why a click there walks up to them and not to the point clicked, and why the walk follows them
   * if they move; after the click it stays over them while the ring shows where the walk ends.
   */
  markAnchor(): [number, number] | null {
    const n = this.marked = this.markedTalker();
    return n ? this.speakingAnchor(n) : this.interactAnchor();
  }

  private markedTalker(): Actor | null {
    if (this.talkRest > 0) return (this.pointed = null);
    const pointed = this.pointedTalker();
    if (pointed) return pointed;
    const t = this.tapTalk;
    return t && this.tapPath.length && this.canTalkTo(t) ? t : null;
  }

  /** The talker the mouse is on, or still on the mark over, so the mark stays as the mouse goes up onto it. */
  private pointedTalker(): Actor | null {
    const at = this.mouseAt;
    if (!at) return (this.pointed = null);
    const was = this.pointed, u = this.game.layout.unit;
    if (was && this.canTalkTo(was) && onMark(markRect(this.speakingAnchor(was), u, this.game.layout.panel), at[0], at[1], u)) return was;
    return (this.pointed = this.npcs.find(n => this.canTalkTo(n) && this.tappedOn(n, at[0], at[1])) ?? null);
  }

  /**
   * A walk to someone who strolls on is laid again to where they are now, a few times a second, so it, the ring and the
   * mark go with them. It ends as before when they cannot be reached.
   */
  private followTapTalk(dt: number): void {
    const n = this.tapTalk, at = this.tapTalkAt;
    if (!n || !at || !this.tapPath.length) return;
    this.tapTalkRelay -= dt;
    if (this.tapTalkRelay > 0 || Math.hypot(n.x - at[0], n.y - at[1]) < 2) return;
    this.tapTalkRelay = 0.25;
    this.tapTalkAt = [n.x, n.y];
    this.layWalk(n.x, n.y, true);
  }

  /** Talks to whoever the leader faces, or uses the trigger they stand in. Returns whether anything started. */
  private interact(): boolean {
    const t = this.interactTarget();
    if (!t) return false;
    if ('actor' in t) return this.talkTo(t.actor);
    void this.game.runScene(String(t.use.props.scene));
    return true;
  }

  /** Starts a townsperson's scene. Returns whether it started. */
  talkTo(npc: Actor): boolean {
    const props = npc.obj?.props ?? {};
    if (!props.scene || !requirementsMet(this.game.state, props.requires)) return false;
    this.tapPath = [];
    this.tapTalk = null;
    this.tapUse = null;
    // They turn to the leader sideways, as the party does in talks; from straight above or below, to the side they
    // last faced.
    const dx = this.leader.x - npc.x;
    npc.facing = Math.abs(dx) >= 2 ? (dx < 0 ? 'left' : 'right') : isSide(npc.facing) ? npc.facing : npc.side;
    npc.path = [];
    npc.moving = false;
    this.leader.facing = dirFromVector(npc.x - this.leader.x, npc.y - this.leader.y, this.leader.facing);
    void this.game.runScene(String(props.scene));
    return true;
  }

  /** Whether a panel point is on a figure, as drawn: upright, with its middle `size` above its feet. */
  private tappedOn(a: Actor, panelX: number, panelY: number): boolean {
    if (a.hidden) return false;
    const [sx, sy] = this.worldToPanel(a.x, a.y, a.size);
    return Math.hypot(sx - panelX, sy - panelY) < (a.size + 10) * this.zoom;
  }

  /**
   * A tap on the map: walk there, or walk up to whoever or whatever was tapped and
   * talk to them or use it on arrival. `repeat` is set while a finger is held down,
   * which only steers the walk. Returns whether the tap chose a walk rather than an interaction.
   */
  tap(panelX: number, panelY: number, opts: { repeat?: boolean } = {}): boolean {
    if (!this.control || this.streetScroll || this.game.storyBusy() || this.game.screensOpen() || this.talkRest > 0) return false;
    const [wx, wy] = this.panelToWorld(panelX, panelY);
    const hit = (a: Actor) => this.tappedOn(a, panelX, panelY);
    const u = this.game.layout.unit;
    // The mark over someone the mouse is on or a walk is going to: a tap on it, or on them, is a tap on them.
    const marked = !opts.repeat && this.marked && this.canTalkTo(this.marked) ? this.marked : null;
    const onMarked = marked && (hit(marked) || onMark(markRect(this.speakingAnchor(marked), u, this.game.layout.panel), panelX, panelY, u));
    const npc = onMarked ? marked : this.npcs.find((n) => hit(n) && n.obj?.props.scene);
    // A tap on the mark over someone is a tap on them, unless it is on another person who has something to say:
    // the mark can hang over a neighbour, and the person tapped is the one meant.
    const t = opts.repeat || marked ? null : this.interactTarget();
    const anchor = t ? this.interactAnchor() : null;
    const other = npc && this.canTalkTo(npc) && !(t && 'actor' in t && t.actor === npc);
    if (anchor && !other && onMark(markRect(anchor, u, this.game.layout.panel), panelX, panelY, u) && this.interact()) return false;
    // A trigger used with Confirm, used on arrival (a save star is walked onto instead).
    const useTrigger = this.map.objects.find((o) => o.type === 'trigger' && o.props.on === 'use' && this.inRect(o, wx, wy, 8)) ?? null;
    if (!opts.repeat) {
      if (npc && this.leader.distanceTo(npc) < 32 && this.talkTo(npc)) return false;
      if (useTrigger && this.inRect(useTrigger, this.leader.x, this.leader.y - 4, 14) && this.interact()) return false;
    }
    this.tapTalk = opts.repeat ? null : (npc ?? null);
    this.tapUse = opts.repeat || npc ? null : useTrigger;
    const goal = npc ?? this.enemies.find(hit);
    // A tapped obstruction means keep leaning until it clears. A destination at its
    // base would be reached after only the first tiny shift, cancelling the push.
    const heldPush = opts.repeat && this.pushTap && Math.hypot(panelX - this.pushTap.x, panelY - this.pushTap.y) < 8
      ? this.yieldingProps.find(p => p.view === this.pushTap?.view && p.view.gfx.visible) : undefined;
    const push = !goal ? heldPush ?? this.yieldingProps.find(p => p.seconds > 0 && p.elapsed < p.seconds && p.view.gfx.visible &&
      this.leader.y >= p.view.obj.y - p.offset + FEET_H - 3 &&
      Math.abs(wx - p.view.obj.x) <= Math.max(18, PROPS[p.view.kind]?.foot[0] ?? 0) + FEET_HW &&
      wy >= p.view.obj.y - p.offset - (PROPS[p.view.kind]?.height ?? 44) / this.ground &&
      wy <= p.view.obj.y + TILE / 2) : undefined;
    this.pushTap = push ? heldPush ? this.pushTap : { view: push.view, x: panelX, y: panelY } : null;
    let [gx, gy] = goal ? [goal.x, goal.y] : push
      ? [push.view.obj.x, push.view.obj.y - push.max - TILE / 2] : [wx, wy + 6];
    // A tap in the outermost tile of a side exit, or beyond the edge, asks to leave by it; one further in ends there.
    const tappedEdge = !goal && !push && !this.tapUse ? this.edgeTarget(gx, gy) : undefined;
    const intendedExit = !goal && !push && !this.tapUse ? this.targetExit(gx, gy) : null;
    this.tapExitPoint = null;
    if (tappedEdge) [gx, gy] = this.onEdge(tappedEdge.edge, gx, gy);
    this.layWalk(gx, gy, Boolean(goal));
    this.tapTalkAt = this.tapTalk ? [this.tapTalk.x, this.tapTalk.y] : null;
    this.tapTalkRelay = 0;
    if (tappedEdge) this.walkOutBy(tappedEdge, gx, gy);
    const end = this.walkEnd();
    this.tapExit = intendedExit && end && (tappedEdge ? this.tapExitPoint !== null : this.feetIn(intendedExit, ...end)) ? intendedExit : null;
    if (!opts.repeat) this.ringAge = 0;
    return !this.tapTalk && !this.tapUse;
  }

  /** Lays a tapped walk's path to a point, or up to someone standing on it (`goal`). */
  private layWalk(gx: number, gy: number, goal: boolean): void {
    if (this.collision.clearLine(this.leader.x, this.leader.y, gx, gy)) this.tapPath = [[gx, gy]];
    else {
      // Out of reach (across water, say), the walk goes as near as it can get.
      const { path, reached } = this.collision.findPathOut(this.leader.x, this.leader.y, gx, gy);
      this.tapPath = path;
      // End on the exact point tapped, not the centre of its tile, when a figure can stand there and get there
      // straight from the path's end. A point squeezed in beside a prop can be clear ground in a tile no one can stand
      // in the middle of, so the path ends on a tile beside it; a leg on from there caught on the prop and left the
      // walk short of where it said it would end (under Beijing's south signpost, the nightly checks of 2026-10-20).
      const [ex, ey] = this.tapPath.at(-1) ?? [this.leader.x, this.leader.y];
      if (reached && !goal && !this.collision.blocked(gx, gy) && this.collision.clearLine(ex, ey, gx, gy)) this.tapPath.push([gx, gy]);
      // Someone tapped is walked up to directly, from the leader's own tile or from where a way out from behind a building ends.
      if (reached && goal) {
        const [lx, ly] = this.tapPath.at(-1) ?? [this.leader.x, this.leader.y];
        if (!this.tapPath.length || Math.hypot(gx - lx, gy - ly) >= TALK_REACH) this.tapPath.push([gx, gy]);
      }
      this.tapPath = this.collision.straighten(this.leader.x, this.leader.y, this.tapPath);
    }
  }

  /**
   * Where a tapped walk will stop: its last point, or on a walk to someone or something, the first point on the way
   * where the talk or the use begins. The owner, 2026-10-16: the ring went, rather than showing where the leader would
   * stand to talk.
   */
  private walkEnd(): [number, number] | undefined {
    const last = this.tapPath.length ? this.tapExitPoint ?? this.tapPath[this.tapPath.length - 1] : undefined;
    const talk = this.tapTalk;
    const use = this.tapUse;
    const arrives = talk ? (x: number, y: number) => Math.hypot(x - talk.x, y - talk.y) < TALK_REACH
      : use ? (x: number, y: number) => this.inRect(use, x, y - 4, 14) : null;
    if (!last || !arrives) return last;
    // Along each leg a unit at a time, as checkTouches meets it a step at a time.
    let [px, py] = [this.leader.x, this.leader.y];
    for (const [x, y] of this.tapPath) {
      const at = (k: number): [number, number] => [px + (x - px) * k, py + (y - py) * k];
      const n = Math.ceil(Math.hypot(x - px, y - py));
      for (let i = 1; i <= n; i++) {
        if (!arrives(...at(i / n))) continue;
        // Narrowed to where it begins, so the ring holds still while the leader walks the leg.
        let [lo, hi] = [(i - 1) / n, i / n];
        for (let k = 0; k < 24; k++) {
          const mid = (lo + hi) / 2;
          if (arrives(...at(mid))) hi = mid;
          else lo = mid;
        }
        return at(hi);
      }
      [px, py] = [x, y];
    }
    return last;
  }

  /** The ring on the ground where a tapped walk will end. It goes when the walk ends or is taken over by keys. */
  private drawRing(held: [number, number] | null): void {
    const g = this.ring;
    const hidden = this.game.storyBusy() || this.game.screensOpen() || this.game.battleActive() || this.streetScroll || !this.control ||
      this.game.input.moveVector().some(v => v !== 0);
    clearIfInked(g);
    this.groundMark = null;
    if (hidden) {
      this.tapMarker = null;
      this.clearExitHover();
      return;
    }
    // The owner, 2026-10-15: follow the finger each frame while the real path is recalculated less often.
    const at = held ? this.panelToWorld(held[0], held[1]) : null;
    let end: [number, number] | undefined = at ? [at[0], at[1] + 6] : this.walkEnd();
    this.tapMarker = end ? [...end] : null;
    let direction = at && end ? this.exitAt(...end)?.direction ?? null : this.availableExitDirection(end ? this.tapExit : null);
    let hover = false;
    if (!end && this.hoverPoint) {
      const [x, y] = this.panelToWorld(...this.hoverPoint), intent = this.exitAt(x, y + 6);
      if (intent) {
        if (intent.exit !== this.hoverExit) this.hoverAge = 0;
        this.hoverExit = intent.exit;
        end = [x, y + 6]; direction = intent.direction; hover = true;
      } else this.clearExitHover();
    }
    if (!end) return;
    const age = hover ? this.hoverAge : this.ringAge;
    let [x, y] = [end[0], end[1] - 2];
    if (direction) {
      // Only the display is inset. The actual destination and path still reach the original exit.
      const panel = this.worldToPanel(x, y), pad = (12 * 1.7 + 2.2) * this.zoom;
      [x, y] = this.panelToWorld(Math.max(pad, Math.min(this.viewW - pad, panel[0])),
        Math.max(pad * this.ground, Math.min(this.viewH - pad * this.ground, panel[1])));
    }
    const frame = drawGroundMark(g, x, y, age, direction);
    this.groundMark = { at: [...end], direction, hover, age, frame, drawAt: [x, y] };
  }

  /**
   * Sends the leader along a path to a world point, as a tap would, through a side exit too when the point is in its
   * outermost tile (dev.goto and the route tools aim at an exit's middle, which for Berlin's bottom exit is short of the
   * edge). For dev tools and tests.
   */
  walkLeaderTo(x: number, y: number): boolean {
    this.tapExitPoint = null;
    const out = this.edgeTarget(x, y);
    if (out) [x, y] = this.onEdge(out.edge, x, y);
    if (this.collision.clearLine(this.leader.x, this.leader.y, x, y)) this.tapPath = [[x, y]];
    else {
      this.tapPath = this.collision.findPathOut(this.leader.x, this.leader.y, x, y, false).path;
      if (this.tapPath.length || !this.collision.blocked(x, y)) this.tapPath.push([x, y]);
      this.tapPath = this.collision.straighten(this.leader.x, this.leader.y, this.tapPath);
    }
    if (out) this.walkOutBy(out, x, y);
    const end = this.walkEnd(), intent = out?.exit ?? this.targetExit(x, y);
    this.tapExit = intent && end && (out ? this.tapExitPoint !== null : this.feetIn(intent, ...end)) ? intent : null;
    return this.tapPath.length > 0;
  }

  get walking(): boolean {
    return this.tapPath.length > 0;
  }

  /**
   * Walks an actor to a point along a path, for scripts. With `keep`, the walk stops where it is once `keep()` turns false,
   * or, standing on a prop just then (the maze's flowers), as soon as it is clear of it.
   */
  async walk(a: Actor, x: number, y: number, speed = a.speed, keep?: () => boolean): Promise<void> {
    const path = this.collision.findPath(a.x, a.y, x, y);
    const points = path.length ? path.slice(0, -1).concat([[x, y]]) : [[x, y]];
    const stop = () => keep !== undefined && !keep() && this.clearOfProps(a.x, a.y, a.size);
    a.scripted++;
    try {
      for (const [tx, ty] of points as Array<[number, number]>) {
        if (this.destroyed) return;
        if (stop()) break;
        await new Promise<void>((resolve) => {
          const step = (dt: number) => {
            if (stop()) return true;
            const dx = tx - a.x;
            const dy = ty - a.y;
            const d = Math.hypot(dx, dy);
            const s = speed * dt;
            if (d <= s) {
              a.x = tx;
              a.y = ty;
              return true;
            }
            a.x += (dx / d) * s;
            a.y += (dy / d) * s;
            a.facing = dirFromVector(dx, dy, a.facing);
            a.moving = true;
            return false;
          };
          this.addTask({ step, resolve });
        });
      }
    } finally {
      a.scripted--;
      a.moving = false;
    }
    if (a === this.leader) this.trail = [{ x: a.x, y: a.y }];
  }

  /** Per-step tasks for scripted movement and effects. Each returns true when finished. */
  private tasks: Array<{ step: (dt: number) => boolean; resolve: () => void }> = [];

  /**
   * Adds a per-step task. Its promise always settles: at once if this map is
   * already gone, or when the map is destroyed, so a scene or fight waiting on
   * it can never hang.
   */
  addTask(task: { step: (dt: number) => boolean; resolve: () => void }): void {
    if (this.destroyed) task.resolve();
    else this.tasks.push(task);
  }

  /** Puts an effect among the figures, just behind `actor`, so it shows round them and not over them. */
  behind(g: Container, actor: Actor): void {
    this.sorted.addChild(g);
    g.zIndex = actor.view.zIndex - 0.5;
  }

  /**
   * Lifts `actor`'s figure out of the figures into the effects, just under `layer` there, so an effect can show behind
   * it and over everything else (Revival in a fight, which darkens the rest of the field). On a print map it keeps the
   * print look the figures have. It stands in a holder of its own, since the figure sets its depth as it moves and a
   * depth set straight in the effects would make Pixi sort them for good, putting the figure over `layer`. Returns how
   * to put it back, which is safe once the map is gone.
   */
  raise(actor: Actor, layer: Container): () => void {
    const view = actor.view, home = view.parent, filters = view.filters ? [...view.filters] : null;
    const holder = new Container();
    holder.eventMode = 'none';
    this.fx.addChildAt(holder, this.fx.getChildIndex(layer));
    holder.addChild(view);
    if (this.sorted === this.printSorted) view.filters = [this.halftone];
    return () => {
      if (!view.destroyed) {
        view.filters = filters;
        if (home && !home.destroyed) home.addChild(view);
      }
      if (!holder.destroyed) holder.destroy();
    };
  }

  get taskCount(): number {
    return this.tasks.length;
  }

  runTasks(dt: number): void {
    for (const t of [...this.tasks]) {
      if (t.step(dt)) {
        this.tasks.splice(this.tasks.indexOf(t), 1);
        t.resolve();
      }
    }
  }

  /**
   * Brings the followers beside the leader for a talk, so everyone faces sideways: one on each side
   * where there is room, else both on whichever side has it (one a little above the other, or in a row),
   * else behind as they were, else they stay where they stand. Each spot must leave the whole figure
   * clear of walls, not only its feet, where any arrangement can. They turn to the leader; who turns to
   * whom as lines are spoken is the story's part.
   */
  /** Whoever in the party stands at or below the top of `o` walks up clear of it, while the scene goes on; all then face `facing`. */
  stepClearAbove(o: MapObject, facing: Dir): void {
    const top = o.y - TILE * 0.2;
    for (const a of this.party) {
      if (a.y > top) void this.walk(a, a.x, top).then(() => { a.facing = facing; });
      else a.facing = facing;
    }
  }

  async gather(): Promise<void> {
    this.following = false;
    const leader = this.leader;
    const lx = leader.x;
    const ly = leader.y;
    // The followers from left to right, and from top to bottom, so each takes the nearer spot.
    const followers = this.party.slice(1);
    const byX = [...followers].sort((a, b) => a.x - b.x);
    const byY = [...followers].sort((a, b) => a.y - b.y);
    const gap = 34;
    const [fx, fy] = dirVector(leader.facing);
    const arrangements: Array<Array<[Actor, number, number]>> = [
      byX.map((a, i) => [a, lx + (i === 0 ? -gap : gap), ly]),
      byY.map((a, i) => [a, lx + gap + i * 8, ly + (i === 0 ? -20 : 20)]),
      byY.map((a, i) => [a, lx - gap - i * 8, ly + (i === 0 ? -20 : 20)]),
      byX.map((a, i) => [a, lx + gap * (i + 1), ly]),
      byX.map((a, i) => [a, lx - gap * (2 - i), ly]),
      followers.map((a, i) => [a, lx - fx * 18 + (i === 0 ? -fy : fy) * 24, ly - fy * 18 + (i === 0 ? fx : -fx) * 24]),
    ];
    // Gathering near a guard must not put a follower on top of them. Keep the same clearance in the fallback
    // that allows a figure to stand in front of scenery.
    const peopleClear = (a: Actor, x: number, y: number, allowTraffic: boolean) => [...this.npcs, ...this.enemies].every((b) =>
      b.hidden || typeof b.obj?.props.scenery_patrol === 'number' || (allowTraffic && b.obj?.props.traffic === true) || Math.hypot(x - b.x, (y - b.y) * this.ground) >= a.size + b.size + 8,
    );
    // Where no spot leaves the whole figure clear (a party arriving under a row of rocks or water, which the
    // leader's own body overlaps too), the feet alone must be clear, as people stand in front of things.
    const choose = (allowTraffic: boolean) =>
      arrangements.find((arr) => arr.every(([a, x, y]) => this.standsClear(a, x, y) && peopleClear(a, x, y, allowTraffic))) ??
      arrangements.find((arr) => arr.every(([a, x, y]) => !this.collision.blocked(x, y) && peopleClear(a, x, y, allowTraffic)));
    // Prefer space clear of everyone. Dense, nonblocking street traffic must not
    // force the party to stay stacked; speaking NPCs and guards still keep their space.
    const spots = choose(false) ?? choose(true) ?? followers.map((a): [Actor, number, number] => [a, a.x, a.y]);
    await Promise.all(
      spots.map(([a, x, y]) =>
        this.walkStraight(a, x, y, 140).then(() => {
          if (Math.abs(lx - a.x) >= 8) a.facing = lx < a.x ? 'left' : 'right';
          else a.facing = dirFromVector(lx - a.x, ly - a.y, a.facing);
        }),
      ),
    );
  }

  /** Whether a figure standing at (x, y) is clear of walls: its feet, and the body drawn above them. */
  standsClear(a: Actor, x: number, y: number): boolean {
    if (this.collision.blocked(x, y)) return false;
    const r = a.size * 0.9;
    const h = (a.size * 2) / this.ground;
    for (let dy = 0; dy <= h; dy += 4) {
      for (const dx of [-r, -r / 2, 0, r / 2, r]) if (this.collision.cellSolid(Math.floor((x + dx) / TILE), Math.floor((y - dy) / TILE))) return false;
    }
    return true;
  }

  /**
   * Back to single file behind the leader. With `clear`, where a place in line would stand someone on a prop (the maze's
   * lower flower, as the party falls in behind Olli after the flower scene), the line is laid straight back from the leader
   * instead, at the nearest height where every place is clear.
   */
  lineUp(clear = false): void {
    const asTheyStand = () => {
      this.trail = [{ x: this.leader.x, y: this.leader.y }];
      for (const a of this.party.slice(1)) this.trail.unshift({ x: a.x, y: a.y });
    };
    asTheyStand();
    this.following = true;
    if (!clear || this.placesClear()) return;
    const { x, y, facing } = this.leader, back = (facing === 'left' ? 1 : -1) * SPACING * this.party.length;
    for (const dy of [0, -8, 8, -16, 16, -24, 24]) {
      this.trail = [{ x: x + back, y: y + dy }, { x, y }];
      if (this.placesClear()) return;
    }
    asTheyStand();
  }

  /** Whether each follower's place in line is open ground clear of the props. */
  private placesClear(): boolean {
    return this.party.slice(1).every((a, i) => {
      const p = this.trailPoint((i + 1) * SPACING);
      return !this.collision.blocked(p.x, p.y) && this.clearOfProps(p.x, p.y, a.size);
    });
  }

  /** Whether the followers stand at their places in line behind the leader. */
  get inLine(): boolean {
    return this.following && this.party.slice(1).every((a, i) => {
      const p = this.trailPoint((i + 1) * SPACING);
      return Math.hypot(p.x - a.x, p.y - a.y) < 0.5;
    });
  }

  /**
   * Whether no prop shown on the map would be drawn over or under a figure of radius `size` standing at (x, y): its base
   * beside their feet, and its picture, taken as a flower's height, reaching their body.
   */
  clearOfProps(x: number, y: number, size: number): boolean {
    return this.props.every(({ obj, gfx }) => {
      const px = obj.x + obj.w / 2, base = obj.y + obj.h;
      return !gfx.visible || Math.abs(px - x) >= size + 4 || base <= y - 2 * size || base - 14 >= y;
    });
  }

  /** Walks an actor straight to a point. With `keep`, the walk stops wherever it is once `keep()` turns false. */
  walkStraight(a: Actor, x: number, y: number, speed: number, keep?: () => boolean): Promise<void> {
    a.scripted++;
    return new Promise<void>((resolve) => {
      this.addTask({
        step: (dt) => {
          if (keep && !keep()) return true;
          const dx = x - a.x;
          const dy = y - a.y;
          const d = Math.hypot(dx, dy);
          const s = speed * dt;
          if (d <= s) {
            a.x = x;
            a.y = y;
            // Stop the walk cycle on this step, unless another scripted move is still going.
            if (a.scripted <= 1) a.moving = false;
            return true;
          }
          a.x += (dx / d) * s;
          a.y += (dy / d) * s;
          a.facing = dirFromVector(dx, dy, a.facing);
          a.moving = true;
          return false;
        },
        resolve,
      });
    }).finally(() => {
      a.scripted--;
      if (!a.scripted) a.moving = false;
    });
  }

  // ---------------------------------------------------------------------------------------------
  // Rendering

  render(t: number, held: [number, number] | null = null): void {
    this.drawRing(held);
    // The scene is drawn with the ground squashed; people, props, and pickups are
    // stretched back by the same amount, so they stand upright on it.
    const upright = 1 / this.ground;
    // What the panel shows, with a tile to spare, so the moving terrain draws only that.
    const [vx0, vy0] = this.panelToWorld(0, 0);
    const [vx1, vy1] = this.panelToWorld(this.viewW, this.viewH);
    this.terrain.update(t, [vx0 - TILE, vy0 - TILE, vx1 + TILE, vy1 + TILE]);
    this.tall?.update(this.camY, upright, vy0, vy1);
    for (const a of [...this.party, ...this.npcs, ...this.enemies]) {
      // Background figures leave the stage while a fight frames the view, which stops at the map's edge and may
      // take in their corner of it (the owner, 2026-10-18: "the Berlin patrols should not be in the fighting area").
      if (this.fightScale !== null && typeof a.obj?.props.scenery_patrol === 'number' && !this.fleeingBystanders.has(a)) {
        a.view.visible = false;
        continue;
      }
      // Townspeople and enemies (the soldiers on patrol across the Beijing street are 36) keep simulating off screen, but need no
      // drawing there: each open mouth is two stencil draws and a broken batch, and its picture is rebuilt 20 times a second. Leave
      // scripted/speaking figures and special transforms alone. The generous padding covers hats, bicycles, camera shake and the
      // tank's whole box; it scales with the figure as well as the panel, without asking Pixi to calculate bounds for every pose.
      if ((a.kind === 'npc' || a.kind === 'enemy') && !a.scripted && !a.talking && this.cameraTarget !== a && !a.lift && a.squash === 1) {
        const [x, y] = this.worldToPanel(a.x, a.y);
        const box = wholeBox(a.look, a.size);
        const pad = 128 + Math.max(a.size * 4, box?.halfW ?? 0, box?.depth ?? 0) * this.zoom * a.grow;
        if (x < -pad || x > this.viewW + pad || y < -pad || y > this.viewH + pad) {
          // render normally remembers the last side for the next vertical roll. Preserve that while culled,
          // and keep visibility separate from hidden, which belongs to story/gameplay.
          if (!a.hidden && isSide(a.facing)) a.side = a.facing;
          a.view.visible = false;
          continue;
        }
      }
      a.render(t);
      a.view.scale.set(a.grow, a.grow * upright);
    }
    if (++this.propTick % 3 === 0) {
      for (const p of this.props) {
        if (!p.animated || !p.drawing) continue;
        p.drawing.clear();
        const info = PROPS[p.kind]!;
        (p.imageOverlay ? info.drawOverImage! : info.draw)(p.drawing, t);
      }
    }
    const entryFrame = this.streetFrame();
    const cutawayReady = !entryFrame || this.leader.y <= entryFrame.enter + TILE;
    for (const p of this.props) {
      // Entry covers stay opaque until the leader is one tile from the reveal border.
      // Followers cannot expose an entrance early or keep it exposed after retreating.
      const cover = PROPS[p.kind]?.cutaway;
      const a = this.leader;
      if (p.obj.props.cutaway === true && cover) p.gfx.alpha = cutawayReady &&
        !a.hidden && Math.abs(a.x - p.obj.x) + a.size * .98 <= cover.halfWidth &&
        (entryFrame ? a.y <= p.obj.y : (a.y - p.obj.y) * this.ground <= -cover.front + a.size * .02) &&
        (a.y - p.obj.y) * this.ground > -cover.back ? .24 : 1;
      const burning = PROPS[p.kind]?.burning;
      if (p.fire && burning && p.fire.visible) {
        p.fire.clear();
        drawFire(p.fire, this.burnT, burning, PROPS[p.kind]?.fireSize ?? 11, 0.85, { still: motion.reduced });
        const scale = p.fireScale ?? 1;
        p.fire.scale.set(p.mirror ? -scale : scale, scale * upright);
      }
      const k = p.base ?? 1;
      // Art moves by its transform: a sway about its base, or a pulse; still with Reduce motion.
      const still = motion.reduced;
      const pulse = p.motion === 'pulse' && !still ? 1 + Math.sin(t * 3) * 0.08 : 1;
      if (p.motion === 'sway') p.gfx.skew.x = still ? 0 : Math.sin(t * 1.3 + p.obj.x * 0.05) * (PROPS[p.kind]?.swing ?? 0.04);
      if (p.wave && p.gfx.visible) waveCloth(p.wave.mesh, p.wave.cloth, still ? null : t + p.wave.phase);
      const grow = p.grow ?? 1;
      p.gfx.scale.set((p.mirror ? -1 : 1) * k * pulse * grow, k * pulse * upright * grow);
    }
    for (const pk of this.pickups) {
      // Stretched or squashed while tossed, keeping roughly its size.
      const [qx, qy] = pk.squash ? [1 + (1 - pk.squash) * 0.8, pk.squash] : [1, 1];
      if (pk.show) {
        poseStandout(pk.show, t);
        pk.gfx.scale.set(qx, upright * qy);
        continue;
      }
      // The throb rests at full size with Reduce motion, like the game's other pulses.
      const k = motion.reduced ? 1 : 1 + Math.sin(t * 5) * 0.12;
      pk.gfx.scale.set(k * qx, k * upright * qy);
    }
    const [sx, sy] = this.shake;
    this.scene.scale.set(this.zoom, this.zoom * this.ground);
    this.scene.position.set(this.viewW / 2 - this.camX * this.zoom + sx, this.viewH / 2 - this.camY * this.zoom * this.ground + sy);
    this.halftone.strength = this.game.settings.halftone ? PRINT.strength : 0;
  }

  /** Background colour behind the map, for maps smaller than the panel. */
  get backdrop(): number {
    return this.world === 'arcade' ? 0x000000 : C.PAPER;
  }

  /** The finale's hopeful light: Berlin warms and sun rays break in over the map (`[sunlight]`, the owner, 2026-10-19). */
  sunlight(): void {
    if (this.light || this.destroyed) return;
    // The warmth goes on the printed map beside its print dots, not on a container round them: a filter nested
    // round the dots' filter needed a texture past the graphics card's limit on large, dense screens, and drew black.
    this.light = new Sunlight(this.printRoot, this.viewW, this.viewH);
    this.view.addChild(this.light.rays);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.fleeingBystanders.clear();
    this.light?.destroy();
    this.light = null;
    // Let anything waiting on this map's tasks carry on rather than wait forever.
    const pending = this.tasks;
    this.tasks = [];
    for (const t of pending) t.resolve();
    // Each figure lets go of the walk poses it kept: Actor.destroy is the only place they go, and a destroyed view alone kept
    // every walker's outfit, so each Beijing retry grew the page (Fable review P2, 2026-11-09).
    for (const a of [...this.party, ...this.npcs, ...this.enemies]) a.destroy();
    this.view.destroy({ children: true });
    for (const t of this.croppedTextures) t.destroy(false);
    this.croppedTextures = [];
  }
}

/** A zigzag lightning bolt about `h` tall, centred on a point: the mark for speed. */
function bolt(x: number, y: number, h: number): number[] {
  const w = h * 0.55;
  return [x + w * 0.2, y - h / 2, x - w * 0.45, y + h * 0.08, x - w * 0.02, y + h * 0.08, x - w * 0.25, y + h / 2, x + w * 0.45, y - h * 0.1, x + w * 0.02, y - h * 0.1];
}

/** A plus sign reaching `r` from a point each way, its arms two-thirds of `r` thick: the mark for healing. */
function plus(x: number, y: number, r: number): number[] {
  const a = r / 3;
  return [x - a, y - r, x + a, y - r, x + a, y - a, x + r, y - a, x + r, y + a, x + a, y + a, x + a, y + r, x - a, y + r, x - a, y + a, x - r, y + a, x - r, y - a, x - a, y - a];
}

/**
 * A pickup that must not be missed, drawn upright about the ground point it lies on: a big yellow pellet
 * with a pink ring and an ink lightning bolt, floating over its shadow, a rotating field of yellow rays
 * and a pulsing glow behind it, sparkles round it, and a pink arrow over it pointing down.
 */
function standout(c: Container): NonNullable<PickupView['show']> {
  const shadow = new Graphics().ellipse(0, 0, 11, 4).fill({ color: C.INK, alpha: 0.35 });
  const rays = new Graphics().poly(burstPoints(0, 0, 30, 12, 0.3, 0)).fill({ color: C.POP_YELLOW, alpha: 0.5 });
  rays.y = -20;
  const glow = new Graphics().circle(0, 0, 17).fill({ color: C.POP_YELLOW, alpha: 0.35 });
  glow.y = -20;
  const body = new Container();
  body.addChild(
    new Graphics()
      .circle(0, 0, 11)
      .fill(C.POP_YELLOW)
      .stroke({ width: 2, color: C.INK })
      .circle(0, 0, 8)
      .stroke({ width: 1.6, color: C.POP_PINK })
      .poly(bolt(0, 0, 11))
      .fill(C.INK),
  );
  body.y = -20;
  const arrow = new Graphics().poly([-7, -6, 7, -6, 0, 4]).fill(C.POP_PINK).stroke({ width: 1.6, color: C.INK, join: 'miter' });
  arrow.y = -44;
  const sparks = [[-19, -30], [18, -12], [14, -36]].map(([x, y]) => {
    const g = new Graphics().poly(burstPoints(0, 0, 4, 4, 0.3, 0)).fill(0xffffff).stroke({ width: 1, color: C.INK });
    g.position.set(x!, y!);
    return g;
  });
  c.addChild(shadow, rays, glow, body, ...sparks, arrow);
  return { rays, glow, body, arrow, sparks };
}

/** Sets a standout pickup's motion at time `t`: the rays turning, the glow pulsing on the beat, the pellet floating, the sparkles twinkling, the arrow bouncing. All still with Reduce motion. */
function poseStandout(s: NonNullable<PickupView['show']>, t: number): void {
  const still = motion.reduced;
  s.rays.rotation = still ? 0 : t * 0.8;
  const beat = onBeat(t);
  s.glow.scale.set(1 + beat * 0.3);
  s.glow.alpha = 0.6 + beat * 0.4;
  s.body.y = -20 + (still ? 0 : Math.sin(t * 3) * 3);
  s.arrow.y = -46 - (still ? 0 : Math.abs(Math.sin(t * 4)) * 5);
  s.sparks.forEach((g, i) => g.scale.set(still ? 1 : 0.4 + 0.6 * Math.abs(Math.sin(t * 3 + i * 2))));
}
