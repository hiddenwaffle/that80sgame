import { Container, Graphics, type StrokeStyle } from 'pixi.js';
import { SceneryMaterials } from '../art/map_scenery.ts';
import { TERRAINS, TILE } from '../content/terrain.ts';
import type { GameMap } from '../content/tiled.ts';
import { motion } from '../render/motion.ts';
import * as C from '../render/palette.ts';
import { burstPoints } from '../ui/print.ts';
import { drawStreets, streetTile } from './streets.ts';
import { beijingFrame, type BeijingFrame } from './beijing_streets.ts';
import { drawCameraScenery } from './camera_scenery.ts';

/** Ground whose corners the less blocky ground (the look's `edges`) rounds, where one kind meets another. */
const ROUNDED = ['grass', 'grass_dark', 'water', 'sand', 'path', 'gravel', 'rock'];
/** How round those corners are, in world units (a tile is 32). */
const ROUND = 11;
/** How round a road's corners are, in world units: half a tile, so a stepped edge, as round a turning circle, runs as one curve. */
const ROAD_ROUND = 16;
/** How tall a quay's wall shows, in world units: three courses of stone between the bank and the water, about a pac's height. */
const QUAY_H = 30;
/** How far a bridge's deck rests on the land past the bank at an end that would otherwise stop level with it, in world units. */
const DECK_REST = 10;
/** A deck's timber edge facing the viewer, and how far its shadow reaches onto the water, in world units. */
const DECK_EDGE = 4;
const DECK_SHADOW = 8;
/** The earth of a natural bank, where the land drops to the water, and how wide its band shows, in world units. */
const BANK_EARTH = 0x6f5a35;
const BANK_BAND = 6;
/** A stretch of two-lane road shorter than this many tiles gets no lane dashes: the end of a turning circle is not a lane. */
const LANE_RUN = 3;
/** The ground of a rocky island, under its boulders, with the less blocky ground. */
const STONE = 0xb7b1a3;

/**
 * Draws a map's terrain as vector shapes. Arcade terrain goes into `arcade`,
 * which stays crisp; printed terrain goes into `print`, which sits under the
 * halftone filter. Pellets are drawn separately so eating one only redraws them.
 * Over that go the arcade's neon, rounded ground, moving water, and the arcade's grid fading into the grass.
 */
export class TerrainView {
  readonly arcade = new Container();
  readonly print = new Container();
  /** Street structures that share the figures' depth order. Initially owned by print until World attaches them. */
  readonly foreground: Graphics[] = [];
  readonly pellets = new Graphics();
  /** Neon: the walls' bloom, which breathes, and the pellets' glow; both add light to what is under them. */
  private readonly bloom = new Graphics();
  private readonly pelletGlow = new Graphics();
  /**
   * Water: the water's ripples, drifting and glinting, redrawn as they move; and the tiles they are on,
   * on the map and past its edge (drawn only while the ground past the edge shows, for a fight framed past it).
   */
  private readonly ripples = new Graphics();
  /** A stone quay along the north side of water, over the ripples so they never cross the stone (`drawQuay`). */
  private readonly quay = new Graphics();
  private readonly water: Array<[number, number]> = [];
  private tick = 0;
  /**
   * Legacy ground past the map's edge, under the map's own print. Kept hidden:
   * fights now move their formation inward instead of framing past the edge.
   */
  private readonly map: GameMap;
  private readonly materials: SceneryMaterials;
  /** While the ground past the edge is drawn, a tile off the map is the nearest edge tile's (see `tid`). */
  private past = false;
  /** The look's `city`: the map's own street plan, when it names one (`streets`), painted over its tiles (src/world/streets.ts). */
  private readonly streets: string | null;
  /** Beijing's layout as its street plan finds it on the map (src/world/beijing_streets.ts); null for any other map. */
  private readonly city: BeijingFrame | null;

  constructor(map: GameMap) {
    this.map = map;
    this.materials = new SceneryMaterials(map.id);
    this.streets = typeof map.props.streets === 'string' ? map.props.streets : null;
    this.city = this.streets === 'beijing' ? beijingFrame(map) : null;
    const a = new Graphics();
    const p = new Graphics();
    this.bloom.blendMode = 'add';
    this.pelletGlow.blendMode = 'add';
    this.arcade.addChild(a, this.bloom, this.pelletGlow, this.pellets);
    drawCameraScenery(this.print, map);
    this.print.addChild(p, this.ripples, ...(this.materials.quay ? [this.quay] : []));
    this.drawArcade(a);
    this.drawPrint(p);
    if (this.materials.quay) this.drawQuay(this.quay);
    // Street paint follows the map's named destinations when the alley tiers are resized, and the whole city when it moves.
    if (this.city) drawStreets(this.print, map, this.city);
    this.update(0);
  }

  /**
   * Moves what the look's parts move: the neon's bloom breathing, the water's ripples drifting. Every third step,
   * which is smooth enough for slow motion; still with Reduce motion, and then the ripples are drawn again only when the view changes.
   */
  update(t: number, view?: readonly [number, number, number, number]): void {
    if (this.tick++ % 3 && t > 0) return;
    const at = motion.reduced ? 0 : t;
    this.bloom.alpha = 0.8 + 0.2 * Math.sin(at * 1.6);
    this.drawRipples(at, view);
  }

  /**
   * The water's ripples: on about half the tiles one or two little waves drift to and fro and fade in and out,
   * each tile on its own phase, and now and then a glint winks. Drawn in four strengths, one stroke each.
   */
  /** The moment the ripples were last drawn for (still at 0 with Reduce motion), and how many tiles of water they covered, for the checks. */
  ripplesAt = 0;
  rippleTiles = 0;

  /** What the ripples on the layer were drawn for: the moment, the view, whether the ground past the edge showed, and the water tiles. */
  private ripplesFor = '';

  private drawRipples(t: number, view?: readonly [number, number, number, number]): void {
    const g = this.ripples;
    this.ripplesAt = t;
    // With Reduce motion the ripples are fixed at time zero, so with the view as it was and the same water the layer already holds
    // exactly what a redraw would make: leave it be, so neither this loop nor Pixi's batching runs again for nothing.
    const key = `${t}|${view ? view.join() : ''}|${this.water.length}`;
    if (key === this.ripplesFor) return;
    this.ripplesFor = key;
    g.clear();
    const levels: Array<Array<[number, number]>> = [[], [], [], []];
    const glints: number[] = [];
    // Only what is in view (`view`, in map units).
    const tiles = this.water;
    let drawn = 0;
    for (const [x, y] of tiles) {
      const X = x * TILE;
      const Y = y * TILE;
      if (view && (X + TILE < view[0] || Y + TILE < view[1] || X > view[2] || Y > view[3])) continue;
      drawn++;
      for (let k = 0; k < 2; k++) {
        if (this.rnd(x, y, 1 + k * 7) > 0.5) continue;
        const ph = this.rnd(x, y, 2 + k * 7) * Math.PI * 2;
        const strength = 0.5 + 0.5 * Math.sin(t * 1.1 + ph);
        const level = Math.min(3, Math.floor(strength * 4));
        if (strength < 0.12) continue;
        const wx = X + 6 + Math.sin(t * 0.8 + ph) * 4;
        const wy = Y + 7 + this.rnd(x, y, 3 + k * 7) * 18 + Math.sin(t * 1.3 + ph) * 1.2;
        levels[level]!.push([wx, wy]);
      }
      const gp = (t * 0.7 + this.rnd(x, y, 5) * 12) % 12;
      if (gp < 0.6) glints.push(X + 6 + this.rnd(x, y, 6) * 20, Y + 6 + this.rnd(x, y, 8) * 20, Math.sin((gp / 0.6) * Math.PI));
    }
    levels.forEach((list, i) => {
      if (!list.length) return;
      for (const [wx, wy] of list) g.moveTo(wx, wy).quadraticCurveTo(wx + 5, wy - 3, wx + 10, wy).quadraticCurveTo(wx + 15, wy + 3, wx + 20, wy);
      g.stroke({ width: 1.3, color: 0xdff3ff, alpha: (i + 1) / 4 });
    });
    for (let i = 0; i < glints.length; i += 3) g.poly(burstPoints(glints[i]!, glints[i + 1]!, 1 + glints[i + 2]! * 3, 4, 0.3, 0)).fill(0xffffff);
    this.rippleTiles = drawn;
  }

  /**
   * The terrain at a tile; 'void' off the map, except while the ground past the edge is drawn, when it is
   * the printed terrain at the nearest edge tile ('void' by arcade terrain).
   */
  /** What terrain a cell is, for what stands on the map. */
  idAt(x: number, y: number): string {
    return this.tid(x, y);
  }

  private tid(x: number, y: number): string {
    const m = this.map;
    const cx = Math.max(0, Math.min(m.width - 1, x));
    const cy = Math.max(0, Math.min(m.height - 1, y));
    if (cx === x && cy === y) return TERRAINS[m.terrain[y * m.width + x]!]!.id;
    if (!this.past) return 'void';
    const t = TERRAINS[m.terrain[cy * m.width + cx]!]!;
    return t.world === 'arcade' ? 'void' : t.id;
  }

  private onMap(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.map.width && y < this.map.height;
  }

  private isArcade(x: number, y: number): boolean {
    const id = this.tid(x, y);
    return TERRAINS.find((t) => t.id === id)!.world === 'arcade';
  }

  private drawArcade(g: Graphics): void {
    const m = this.map;
    // Floors first.
    for (let y = 0; y < m.height; y++) {
      for (let x = 0; x < m.width; x++) {
        const id = this.tid(x, y);
        if (!this.isArcade(x, y)) continue;
        const color = id === 'house_floor' ? 0x140a1a : id === 'void' ? 0x000000 : id === 'arcade_wall' || id === 'house_wall' ? 0x05050c : C.ARCADE_FLOOR;
        g.rect(x * TILE, y * TILE, TILE, TILE).fill(color);
      }
    }
    // Neon: a faint grid on the floor, as on a Tron board: each tile's top and left edges, and the far
    // edges where the floor ends.
    for (const [floor, color] of [['arcade_floor', 0x1c2d78], ['house_floor', 0x4a1d47]] as const) {
      let any = false;
      for (let y = 0; y < m.height; y++) {
        for (let x = 0; x < m.width; x++) {
          if (this.tid(x, y) !== floor) continue;
          const X = x * TILE;
          const Y = y * TILE;
          g.moveTo(X, Y).lineTo(X + TILE, Y).moveTo(X, Y).lineTo(X, Y + TILE);
          if (this.tid(x + 1, y) !== floor) g.moveTo(X + TILE, Y).lineTo(X + TILE, Y + TILE);
          if (this.tid(x, y + 1) !== floor) g.moveTo(X, Y + TILE).lineTo(X + TILE, Y + TILE);
          any = true;
        }
      }
      if (any) g.stroke({ width: 1, color, alpha: 0.55 });
    }
    // Neon outlines where walls meet floor, with a soft glow under them, a bloom of light round them and a pale core along them.
    for (const [wall, color, glow] of [
      ['arcade_wall', C.ARCADE_WALL, C.ARCADE_WALL_GLOW],
      ['house_wall', 0xff4fa3, 0x7a1f52],
    ] as const) {
      const segs = this.edges((x, y) => this.tid(x, y) === wall, (x, y) => {
        // The house's walls run to the map's edge, and their neon outlines the whole house round the room, out from its
        // door, against the edge and the empty ground beside the doorstep too (the owner, 2026-10-20). Other walls draw no
        // line against the edge or the void.
        const id = this.tid(x, y);
        if (wall === 'house_wall') return id !== wall;
        return id !== wall && id !== 'void';
      });
      if (!segs.length) continue;
      const inset = 5;
      const draw = (to: Graphics, width: number, c: number, alpha: number) => {
        for (const [x0, y0, x1, y1, nx, ny] of segs) {
          to.moveTo(x0 - nx * inset, y0 - ny * inset).lineTo(x1 - nx * inset, y1 - ny * inset);
        }
        to.stroke({ width, color: c, alpha, cap: 'round', join: 'round' });
      };
      draw(this.bloom, 26, color, 0.07);
      draw(this.bloom, 16, color, 0.12);
      draw(this.bloom, 9, color, 0.22);
      draw(g, 9, glow, 0.55);
      draw(g, 3, color, 1);
      draw(g, 1.2, 0xdfe6ff, 0.85);
    }
  }

  /**
   * Boundary segments between cells where `inside` holds and neighbours where
   * `outside` holds. Each segment carries the outward normal (nx, ny).
   */
  private edges(inside: (x: number, y: number) => boolean, outside: (x: number, y: number) => boolean, beyond = 0) {
    const m = this.map;
    const segs: Array<[number, number, number, number, number, number]> = [];
    for (let y = -beyond; y < m.height + beyond; y++) {
      for (let x = -beyond; x < m.width + beyond; x++) {
        if (!inside(x, y)) continue;
        const X = x * TILE;
        const Y = y * TILE;
        if (outside(x, y - 1)) segs.push([X, Y, X + TILE, Y, 0, -1]);
        if (outside(x, y + 1)) segs.push([X, Y + TILE, X + TILE, Y + TILE, 0, 1]);
        if (outside(x - 1, y)) segs.push([X, Y, X, Y + TILE, -1, 0]);
        if (outside(x + 1, y)) segs.push([X + TILE, Y, X + TILE, Y + TILE, 1, 0]);
      }
    }
    // Merge collinear neighbours so strokes join cleanly.
    return mergeSegments(segs);
  }

  /** A printed terrain's plain colour, the one its tiles are filled with under their marks. */
  private plainColor(id: string): number {
    switch (id) {
      case 'grass':
      case 'rock':
        return C.GRASS;
      case 'grass_dark':
        return C.GRASS_DARK;
      case 'water':
        return C.WATER;
      case 'sand':
        return C.SAND;
      case 'path':
        return C.PATH;
      case 'bridge':
        return C.WOOD;
      case 'pavement':
        return C.PAVEMENT;
      case 'concrete_wall':
        return C.WALL_FACE;
      default:
        return TERRAINS.find((t) => t.id === id)!.color;
    }
  }


  private rnd(x: number, y: number, k: number): number {
    const s = Math.sin(x * 127.1 + y * 311.7 + k * 74.7) * 43758.5453;
    return s - Math.floor(s);
  }

  /** One printed tile, with its marks: tufts, ripples, specks, planks, wall tops and graffiti, a rock. */
  private drawTile(g: Graphics, x: number, y: number): void {
    const id = this.tid(x, y);
    const X = x * TILE;
    const Y = y * TILE;
    const rnd = (a: number, b: number, k: number) => this.rnd(a, b, k);
    // A street plan drawn tile by tile draws the tiles it has its own way of drawing (src/world/streets.ts).
    // Its random marks go by the cell as numbered on 12 Nov, so they move with the city.
    const city = this.city;
    if (city && streetTile(city, g, id, x, y, (c) => this.fillTile(g, x, y, c), (k) => rnd(x - city.moved.c, y - city.moved.r, k), (dx, dy) => this.tid(x + dx, y + dy))) return;
    switch (id) {
      case 'grass':
      case 'grass_dark': {
        this.fillTile(g, x, y, id === 'grass' ? C.GRASS : C.GRASS_DARK);
        if (this.materials.has(id)) break;
        let tufts = 0;
        for (let k = 0; k < 3; k++) {
          const tx = X + 4 + rnd(x, y, k) * 24;
          const ty = Y + 6 + rnd(x, y, k + 9) * 22;
          if (rnd(x, y, k + 3) < 0.55) {
            g.moveTo(tx - 2, ty).lineTo(tx - 3, ty - 4).moveTo(tx, ty).lineTo(tx, ty - 5).moveTo(tx + 2, ty).lineTo(tx + 3, ty - 4);
            tufts++;
          }
        }
        if (tufts) g.stroke({ width: 1, color: id === 'grass' ? C.GRASS_DARK : 0x3f7a26 });
        break;
      }
      case 'water':
        this.fillTile(g, x, y, C.WATER);
        // The moving water draws its own ripples, which move, on the map (past its edge, under ground_past, it has none).
        if (this.onMap(x, y)) this.water.push([x, y]);
        break;
      case 'sand':
        this.fillTile(g, x, y, C.SAND);
        break;
      case 'path':
        this.fillTile(g, x, y, C.PATH);
        if (this.materials.has(id)) break;
        for (let k = 0; k < 2; k++) g.circle(X + 5 + rnd(x, y, k) * 22, Y + 5 + rnd(x, y, k + 4) * 22, 1.2).fill(0x8a6a3a);
        break;
      case 'bridge': {
        // A deck two tiles wide going up the map, water to its sides: the bridge's planks turned to lie across it.
        const upright = this.tid(x, y - 1) !== 'water' && this.tid(x, y + 1) !== 'water' && (this.tid(x - 1, y) === 'water' || this.tid(x + 1, y) === 'water');
        const deck = upright ? this.materials.uprightDeck((this.tid(x - 1, y) === 'water' ? x : x - 1) * TILE) : null;
        g.rect(X, Y, TILE, TILE).fill(deck ?? this.materials.fill(id, C.WOOD));
        if (deck || this.materials.has(id)) break;
        for (let k = 0; k < 4; k++) g.moveTo(X + k * 8, Y).lineTo(X + k * 8, Y + TILE).stroke({ width: 1, color: C.INK });
        break;
      }
      case 'pavement':
        g.rect(X, Y, TILE, TILE).fill(C.PAVEMENT).stroke({ width: 0.8, color: 0x9d988c });
        this.drawMosaic(g, x, y, 'pavement');
        break;
      case 'setts': {
        // Small granite setts in rows, each row half a sett along from the last, light on darker joints. A sett's tone goes by
        // where it lies in the world, so one cut by a tile's edge is the same stone on both sides.
        g.rect(X, Y, TILE, TILE).fill(0xa8a396);
        const high = TILE / 6;
        for (let row = 0; row < 6; row++) {
          const along = row % 2 ? 4 : 0;
          for (let k = 0; k <= 4; k++) {
            const left = Math.max(X + k * 8 - along + 0.5, X);
            const right = Math.min(X + k * 8 - along + 7.5, X + TILE);
            if (right <= left) continue;
            const tone = this.rnd(x * 4 + k, y * 6 + row, 40);
            g.rect(left, Y + row * high + 0.5, right - left, high - 1).fill(tone < 0.4 ? 0xbcb7ab : tone < 0.75 ? 0xb6b1a5 : 0xc1bcb0);
          }
        }
        this.drawMosaic(g, x, y, 'setts');
        break;
      }
      case 'concrete_wall':
        this.drawWall(g, x, y);
        break;
      case 'rock':
        this.fillTile(g, x, y, this.rockGround(x, y));
        g.roundRect(X + 2, Y + 3, TILE - 4, TILE - 5, 9).fill(0x9b988f).stroke({ width: 1.4, color: C.INK });
        g.moveTo(X + 8, Y + 12).lineTo(X + 14, Y + 9).stroke({ width: 1, color: 0x6e6b64 });
        break;
      case 'roofs':
        // Courses of grey roof tiles, their joints staggered from one course to the next.
        g.rect(X, Y, TILE, TILE).fill(this.plainColor(id));
        for (let k = 0; k < 4; k++) {
          const ry = Y + 8 + k * 8;
          g.moveTo(X, ry).lineTo(X + TILE, ry);
          for (let j = 0; j < 4; j++) g.moveTo(X + j * 8 + (k % 2) * 4 + 2, ry - 7).lineTo(X + j * 8 + (k % 2) * 4 + 2, ry);
        }
        g.stroke({ width: 1, color: 0x4c4f54 });
        break;
      case 'gravel':
        this.fillTile(g, x, y, this.plainColor(id));
        for (let k = 0; k < 3; k++) if (rnd(x, y, k + 6) < 0.6) g.circle(X + 5 + rnd(x, y, k) * 22, Y + 5 + rnd(x, y, k + 3) * 22, 1).fill(0xb0a68c);
        break;
      case 'road':
        g.rect(X, Y, TILE, TILE).fill(this.plainColor(id));
        break;
      case 'strip':
        // Bare ground: a broad worn patch here and there, and now and then a crack.
        g.rect(X, Y, TILE, TILE).fill(this.plainColor(id));
        if (rnd(x, y, 6) < 0.4) g.ellipse(X + 8 + rnd(x, y, 7) * 16, Y + 8 + rnd(x, y, 8) * 16, 5 + rnd(x, y, 9) * 3, 2.5 + rnd(x, y, 10) * 1.5).fill(0x8d8d72);
        if (rnd(x, y, 12) < 0.18) this.drawCrack(g, x, y, 0x7f7f65);
        break;
      case 'raked_sand': {
        // Pebbled sand (the owner, 31 Oct: rake lines are accurate but confuse people, and its grey ran into the Wall's): soft patches and a few
        // pebbles lit on top with a dark side, scattered tile by tile.
        g.rect(X, Y, TILE, TILE).fill(this.plainColor(id));
        for (let k = 0; k < 2; k++) {
          g.ellipse(X + 8 + rnd(x, y, k + 20) * 16, Y + 8 + rnd(x, y, k + 22) * 16, 5 + rnd(x, y, k + 24) * 3, 3 + rnd(x, y, k + 26) * 2).fill(k ? 0xddcea9 : 0xc9b78d);
        }
        for (let k = 0; k < 3; k++) {
          if (rnd(x, y, k + 60) < 0.55) continue;
          const [px, py] = [X + 5 + rnd(x, y, k + 63) * 22, Y + 5 + rnd(x, y, k + 66) * 22];
          const [rx, ry] = [2 + rnd(x, y, k + 69) * 1.6, 1.4 + rnd(x, y, k + 72) * 0.9];
          g.ellipse(px + 0.9, py + 1.1, rx, ry).fill(0x7f6f50);
          g.ellipse(px, py, rx, ry).fill(k === 1 ? 0xc9bea8 : 0xd2b98c);
        }
        break;
      }
      case 'slabs': {
        // Long concrete slabs, two tiles each, their joints staggered from row to row, with a dark line along the road's edges.
        g.rect(X, Y, TILE, TILE).fill(this.plainColor(id));
        // Each slab its own tone, a little, and its lower edge darker.
        g.rect(X, Y, TILE, TILE).fill({ color: C.INK, alpha: rnd((x + y) % 2 === 0 ? x : x - 1, y, 31) * 0.06 });
        g.rect(X, Y + TILE - 2.4, TILE, 2.4).fill({ color: C.INK, alpha: 0.07 });
        if (rnd(x, y, 12) < 0.3) this.drawCrack(g, x, y, 0x9a9b97);
        if ((x + y) % 2 === 0) g.moveTo(X, Y).lineTo(X, Y + TILE).stroke({ width: 1.6, color: 0x77797a });
        const seam = this.tid(x, y - 1) === 'slabs';
        g.moveTo(X, Y).lineTo(X + TILE, Y).stroke({ width: seam ? 1.6 : 2, color: seam ? 0x77797a : 0x55575a });
        if (this.tid(x, y + 1) !== 'slabs') g.moveTo(X, Y + TILE).lineTo(X + TILE, Y + TILE).stroke({ width: 2, color: 0x55575a });
        break;
      }
      default:
        g.rect(X, Y, TILE, TILE).fill(TERRAINS.find((t) => t.id === id)!.color);
    }
    // The ground at the Wall's foot lies in its shadow.
    if (id !== 'concrete_wall' && id !== 'water' && this.tid(x, y - 1) === 'concrete_wall') g.rect(X, Y, TILE, 8).fill({ color: C.INK, alpha: 0.2 });
  }

  /** Where Berlin has it, two rows of small stones along each edge of a paved tile that meets other ground. */
  private drawMosaic(g: Graphics, x: number, y: number, id: string): void {
    if (!this.materials.mosaic) return;
    const [X, Y] = [x * TILE, y * TILE];
    for (const [sx, sy] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
      const next = this.tid(x + sx, y + sy);
      if (next === id || next === 'void') continue;
      // A plain band under the border, so the setts stop short of it and do not show through its gaps.
      if (id === 'setts') {
        if (sx === 0) g.rect(X, sy < 0 ? Y : Y + TILE - 11, TILE, 11).fill(C.PAVEMENT);
        else g.rect(sx < 0 ? X : X + TILE - 11, Y, 11, TILE).fill(C.PAVEMENT);
      }
      for (let row = 0; row < 2; row++) {
        const depth = 3 + row * 4;
        for (let k = 0; k < 8; k++) {
          const tone = this.rnd(x, y, 30 + k + row * 8 + (sx + 2) * 16 + (sy + 2) * 64) < 0.5 ? 0xa59f92 : 0xb1ac9f;
          const along = k * 4 + (row ? 2 : 0.5);
          const span = Math.min(3, TILE - along);
          if (sx === 0) g.rect(X + along, sy < 0 ? Y + depth : Y + TILE - depth - 3, span, 3).fill(tone);
          else g.rect(sx < 0 ? X + depth : X + TILE - depth - 3, Y + along, 3, span).fill(tone);
        }
      }
    }
  }

  /**
   * The Wall, seen from the West: the rows of a wall band are its face, standing toward the viewer, in pale
   * panels with a seam between each, under the rounded pipe along its top. The face is covered in graffiti
   * as the real Wall's West face was: tags in bubbles, squiggles, zigzags, and round heads, placed by a fixed
   * pattern so the same wall always carries the same paint.
   */
  private drawWall(g: Graphics, x: number, y: number): void {
    const X = x * TILE;
    const Y = y * TILE;
    const rnd = (k: number) => this.rnd(x, y, k);
    const top = this.tid(x, y - 1) !== 'concrete_wall';
    g.rect(X, Y, TILE, TILE).fill(C.WALL_FACE);
    // A seam between panels, on every tile.
    g.moveTo(X + 0.5, Y + (top ? 7 : 0)).lineTo(X + 0.5, Y + TILE).stroke({ width: 1.2, color: C.CONCRETE_DARK });
    const colors = [0xe53935, 0x1e88e5, 0xfdd835, 0x43a047, 0x8e24aa, 0xff7043, 0xf2267f, 0x22b8e8];
    const ink = (k: number) => colors[Math.floor(rnd(k) * colors.length)]!;
    const y0 = Y + (top ? 9 : 2);
    const room = TILE - (top ? 11 : 4);
    for (let n = 0; n < 2; n++) {
      if (rnd(20 + n) > (n ? 0.45 : 0.9)) continue;
      const kind = Math.floor(rnd(30 + n) * 4);
      // Kept inside the tile, so no mark spills past the map's edge or under the next tile.
      const cx = X + 10 + rnd(40 + n) * 12;
      const cy = y0 + 4 + rnd(50 + n) * (room - 8);
      const c = ink(60 + n);
      if (kind === 0) {
        // A tag in a bubble: a fat rounded blob outlined in ink, with a highlight.
        const w = 10 + rnd(70 + n) * 8;
        g.roundRect(cx - w / 2, cy - 4, w, 8, 4).fill(c).stroke({ width: 1.2, color: C.INK });
        g.circle(cx - w / 4, cy - 1.5, 1.2).fill(0xffffff);
      } else if (kind === 1) {
        // A squiggle.
        g.moveTo(cx - 9, cy).bezierCurveTo(cx - 3, cy - 8, cx + 1, cy + 8, cx + 9, cy - 2).stroke({ width: 3, color: c, cap: 'round' });
      } else if (kind === 2) {
        // A zigzag.
        g.moveTo(cx - 9, cy + 3).lineTo(cx - 4, cy - 3).lineTo(cx + 1, cy + 3).lineTo(cx + 6, cy - 3).lineTo(cx + 10, cy + 2).stroke({ width: 2.4, color: c, cap: 'round', join: 'round' });
      } else {
        // A round head with a big eye and a grin.
        g.circle(cx, cy, 5.5).fill(c).stroke({ width: 1.2, color: C.INK });
        g.circle(cx + 1.5, cy - 1.5, 1.8).fill(0xffffff);
        g.circle(cx + 2, cy - 1.4, 0.8).fill(C.INK);
        g.moveTo(cx - 3, cy + 2).quadraticCurveTo(cx, cy + 4.5, cx + 3.5, cy + 2).stroke({ width: 1, color: C.INK });
      }
    }
    // The rounded pipe along the top, lit from above, with its shadow line on the face.
    if (top) this.drawWallCap(g, X, Y);
  }

  /** A hairline crack across part of a tile, wandering a different way on each tile. */
  private drawCrack(g: Graphics, x: number, y: number, color: number): void {
    let [cx, cy] = [x * TILE + 3 + this.rnd(x, y, 13) * 10, y * TILE + 6 + this.rnd(x, y, 14) * 20];
    g.moveTo(cx, cy);
    for (let k = 0; k < 4; k++) {
      cx += 2 + this.rnd(x, y, 15 + k) * 4;
      cy += (this.rnd(x, y, 20 + k) - 0.5) * 7;
      g.lineTo(cx, Math.max(y * TILE + 1, Math.min((y + 1) * TILE - 1, cy)));
    }
    g.stroke({ width: 0.9, color });
  }

  private drawWallCap(g: Graphics, X: number, Y: number): void {
    g.rect(X, Y, TILE, 7).fill(C.WALL_CAP);
    g.moveTo(X, Y + 7).lineTo(X + TILE, Y + 7).stroke({ width: 1.4, color: C.CONCRETE_DARK });
    g.moveTo(X, Y + 2).lineTo(X + TILE, Y + 2).stroke({ width: 1, color: 0xffffff });
  }


  /** The four corners of a tile, clockwise from the top left, as the directions they lie in from its middle. */
  private static readonly CORNERS = [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const;
  /** Where each corner's quarter circle starts, clockwise (y runs down): from the left side for the top left, and on round. */
  private static readonly ARC_FROM = [Math.PI, Math.PI * 1.5, 0, Math.PI * 0.5];

  /**
   * Edges: whether a tile's corner is rounded, and if so the colour of the ground showing round it. A
   * corner rounds where the three tiles that meet it are all other ground, all of kinds that round (grass,
   * water, sand, path, rock), so a lone corner of one ground sticking into another is smoothed; an inside
   * corner is smoothed by the tile across it. Never against walls, pavement, bridges, or the arcade.
   */
  private roundedCorner(x: number, y: number, dx: number, dy: number): number | null {
    const c = this.cornerGround(x, y, dx, dy);
    return c ? this.groundColor(c.id, c.x, c.y) : null;
  }

  /** For a rounded corner (`roundedCorner`), the ground showing round it: its kind, and the tile it is taken from. */
  private cornerGround(x: number, y: number, dx: number, dy: number): { id: string; x: number; y: number } | null {
    const a = this.tid(x, y);
    const around = [this.tid(x + dx, y), this.tid(x, y + dy), this.tid(x + dx, y + dy)] as const;
    if (!ROUNDED.includes(a) || around.some((t) => t === a || !ROUNDED.includes(t))) return null;
    // The kind two of them share, else the one across the corner.
    const [n1, n2, d] = around;
    if (n1 === n2 || n1 === d) return { id: n1, x: x + dx, y };
    if (n2 === d) return { id: n2, x, y: y + dy };
    return { id: d, x: x + dx, y: y + dy };
  }

  private groundColor(id: string, x: number, y: number): number {
    return id === 'rock' ? this.rockGround(x, y) : this.plainColor(id);
  }

  /** The ground under a rock's boulder: stone where it stands in water, else what is beside it. */
  private rockGround(x: number, y: number): number {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (this.tid(x + dx, y + dy) === 'water') return STONE;
    return this.neighbourGround(x, y);
  }

  /** A tile's ground: a square, or with the less blocky ground, with its rounded corners showing the ground round them. */
  private fillTile(g: Graphics, x: number, y: number, color: number): void {
    const X = x * TILE;
    const Y = y * TILE;
    const under = TerrainView.CORNERS.map(([dx, dy]) => this.roundedCorner(x, y, dx, dy));
    const fill = this.materials.fill(this.tid(x, y), color);
    if (under.every((u) => u === null)) {
      g.rect(X, Y, TILE, TILE).fill(fill);
      return;
    }
    const pts: number[] = [];
    TerrainView.CORNERS.forEach(([dx, dy], i) => {
      const [cx, cy] = [dx < 0 ? X : X + TILE, dy < 0 ? Y : Y + TILE];
      const u = under[i];
      if (u === null || u === undefined) {
        pts.push(cx, cy);
        return;
      }
      const neighbour = this.cornerGround(x, y, dx, dy)!;
      g.rect(dx < 0 ? X : X + TILE - ROUND, dy < 0 ? Y : Y + TILE - ROUND, ROUND, ROUND).fill(this.materials.fill(neighbour.id, u));
      const [ox, oy] = [cx - dx * ROUND, cy - dy * ROUND];
      for (let s = 0; s <= 6; s++) {
        const a = TerrainView.ARC_FROM[i]! + (s / 6) * (Math.PI / 2);
        pts.push(ox + Math.cos(a) * ROUND, oy + Math.sin(a) * ROUND);
      }
    });
    g.poly(pts).fill(fill);
  }

  /**
   * Ink along the edge of `id` ground where it meets other printed ground, such as the shores: along each of
   * its tiles' sides that face other ground, and with the less blocky ground round each rounded corner
   * on either side of the edge, the sides stopping short where the curve takes over. `where` picks the tiles.
   */
  private outline(g: Graphics, id: string, where: (x: number, y: number) => boolean, beyond = 0, stroke: StrokeStyle = { width: 2, color: C.INK, cap: 'round' }, except?: string): void {
    const m = this.map;
    const arcs = new Set<string>();
    let any = false;
    for (let y = -beyond; y < m.height + beyond; y++) {
      for (let x = -beyond; x < m.width + beyond; x++) {
        if (!where(x, y) || this.tid(x, y) !== id) continue;
        for (const [sx, sy] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
          const nid = this.tid(x + sx, y + sy);
          if (nid === id || nid === 'void' || nid === except) continue;
          // The side's two ends, as this tile's corners; at each, whether this tile rounds it, or the one across
          // does with this ground showing round its corner (one rounding against other ground has no ink here).
          const ends = (sx === 0 ? [[-1, sy], [1, sy]] : [[sx, -1], [sx, 1]]).map(([dx, dy]) => {
            const [ndx, ndy] = [sx === 0 ? dx! : -dx!, sy === 0 ? dy! : -dy!];
            const mine = this.cornerGround(x, y, dx!, dy!) !== null;
            const theirs = this.cornerGround(x + sx, y + sy, ndx, ndy)?.id === id;
            if (mine) arcs.add(`${x},${y},${dx},${dy}`);
            if (theirs) arcs.add(`${x + sx},${y + sy},${ndx},${ndy}`);
            return { vx: (x + (dx! > 0 ? 1 : 0)) * TILE, vy: (y + (dy! > 0 ? 1 : 0)) * TILE, cut: mine || theirs ? ROUND : 0 };
          });
          const [a, b] = ends as [(typeof ends)[0], (typeof ends)[0]];
          const ux = Math.sign(b.vx - a.vx);
          const uy = Math.sign(b.vy - a.vy);
          g.moveTo(a.vx + ux * a.cut, a.vy + uy * a.cut).lineTo(b.vx - ux * b.cut, b.vy - uy * b.cut);
          any = true;
        }
      }
    }
    for (const key of arcs) {
      const [x, y, dx, dy] = key.split(',').map(Number) as [number, number, number, number];
      const i = TerrainView.CORNERS.findIndex(([cx, cy]) => cx === dx && cy === dy);
      const [ox, oy] = [(x + (dx > 0 ? 1 : 0)) * TILE - dx * ROUND, (y + (dy > 0 ? 1 : 0)) * TILE - dy * ROUND];
      // The quarter circle as one cubic Bezier from the point moved to (within 0.003 units of the circle). Pixi's arc()
      // would add that point again, and its line builder turns the zero-length step into vertices that are not numbers,
      // which some phone GPUs (a Galaxy in Chrome, 2026-10-16) draw as spikes to the middle of the screen.
      const a0 = TerrainView.ARC_FROM[i]!, a1 = a0 + Math.PI / 2, k = 0.5522847498 * ROUND;
      const [x0, y0, x3, y3] = [ox + Math.cos(a0) * ROUND, oy + Math.sin(a0) * ROUND, ox + Math.cos(a1) * ROUND, oy + Math.sin(a1) * ROUND];
      g.moveTo(x0, y0).bezierCurveTo(x0 - Math.sin(a0) * k, y0 + Math.cos(a0) * k, x3 + Math.sin(a1) * k, y3 - Math.cos(a1) * k, x3, y3);
      any = true;
    }
    if (any) g.stroke(stroke);
  }

  /**
   * Blend: where the printed world meets the arcade's floor, the arcade's grid runs on into the grass for
   * four tiles, in cyan, fading as it goes, with neon specks among the tufts thinning out, so the change from the
   * board to the world is gentler.
   */
  private drawBlend(g: Graphics): void {
    const m = this.map;
    const near = new Map<number, number>();
    let ring: Array<[number, number]> = [];
    for (let y = 0; y < m.height; y++) {
      for (let x = 0; x < m.width; x++) {
        if (this.isArcade(x, y)) continue;
        if ([[0, 1], [0, -1], [1, 0], [-1, 0]].some(([dx, dy]) => this.tid(x + dx!, y + dy!) === 'arcade_floor')) {
          near.set(y * m.width + x, 1);
          ring.push([x, y]);
        }
      }
    }
    for (let d = 2; d <= 4; d++) {
      const next: Array<[number, number]> = [];
      for (const [x, y] of ring) {
        for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]] as const) {
          const [nx, ny] = [x + dx, y + dy];
          if (!this.onMap(nx, ny) || this.isArcade(nx, ny) || near.has(ny * m.width + nx)) continue;
          near.set(ny * m.width + nx, d);
          next.push([nx, ny]);
        }
      }
      ring = next;
    }
    const inks = [C.POP_CYAN, C.POP_PINK, C.POP_YELLOW];
    for (let d = 1; d <= 4; d++) {
      let any = false;
      for (const [k, dd] of near) {
        if (dd !== d) continue;
        const [x, y] = [k % m.width, Math.floor(k / m.width)];
        if (this.tid(x, y) === 'water') continue;
        const [X, Y] = [x * TILE, y * TILE];
        g.moveTo(X, Y).lineTo(X + TILE, Y).moveTo(X, Y).lineTo(X, Y + TILE);
        any = true;
      }
      if (any) g.stroke({ width: 1, color: C.POP_CYAN, alpha: 0.55 * (1 - (d - 1) / 4) });
    }
    for (const [k, d] of near) {
      const [x, y] = [k % m.width, Math.floor(k / m.width)];
      if (this.tid(x, y) === 'water' || this.rnd(x, y, 90) > 0.55 - d * 0.12) continue;
      const [sx, sy] = [x * TILE + 4 + this.rnd(x, y, 91) * 24, y * TILE + 4 + this.rnd(x, y, 92) * 24];
      g.rect(sx - 1.5, sy - 1.5, 3, 3).fill(inks[Math.floor(this.rnd(x, y, 93) * 3)]!);
    }
  }

  private drawPrint(g: Graphics): void {
    const m = this.map;
    for (let y = 0; y < m.height; y++) {
      for (let x = 0; x < m.width; x++) {
        if (!this.isArcade(x, y)) this.drawTile(g, x, y);
      }
    }
    this.drawGroundPast(g);
    this.drawBlend(g);
    this.drawRoads(g);
    // Ink lines along shores, wall bases, and where the printed world meets the arcade.
    if (this.materials.bank) this.outline(g, 'water', () => true, 0, this.materials.bank, this.materials.bankExcept);
    if (!this.materials.quay && !this.streets) this.drawBankFaces(g);
    this.outline(g, 'water', () => true);
    this.drawDeckEnds(g);
    if (!this.materials.quay) this.drawDeckDepth(g);
    const wallBase = this.edges(
      (x, y) => this.tid(x, y) === 'concrete_wall',
      (x, y) => this.tid(x, y) !== 'concrete_wall',
    );
    if (wallBase.length) {
      for (const [x0, y0, x1, y1] of wallBase) g.moveTo(x0, y0).lineTo(x1, y1);
      g.stroke({ width: 2, color: C.INK, cap: 'round' });
    }
    const tear = this.edges(
      (x, y) => !this.isArcade(x, y),
      (x, y) => this.isArcade(x, y) && this.tid(x, y) !== 'void',
    );
    if (tear.length) {
      for (const [x0, y0, x1, y1] of tear) g.moveTo(x0, y0).lineTo(x1, y1);
      g.stroke({ width: 3, color: C.PAPER, cap: 'square' });
      for (const [x0, y0, x1, y1, nx, ny] of tear) g.moveTo(x0 + nx * -2, y0 + ny * -2).lineTo(x1 + nx * -2, y1 + ny * -2);
      g.stroke({ width: 1.5, color: C.INK, cap: 'square' });
    }
  }

  /**
   * The ground a map carries on past its edge (an area with `ground_past`), each row as its edge tile: never walked on, but a
   * fight framed off to one side can look there.
   */
  private drawGroundPast(g: Graphics): void {
    this.past = true;
    for (const o of this.map.objects) {
      if (o.type !== 'area' || o.props.ground_past !== true) continue;
      for (let y = Math.floor(o.y / TILE); y * TILE < o.y + o.h; y++) {
        for (let x = Math.floor(o.x / TILE); x * TILE < o.x + o.w; x++) {
          if (!this.onMap(x, y)) this.drawTile(g, x, y);
        }
      }
    }
    this.past = false;
  }

  /**
   * A bridge's deck rests on the land: where its last tile still has water to its sides, so it would stop level with the
   * bank, the planks run on a little past it. Whatever of the deck lies on land has an ink edge round it.
   */
  private drawDeckEnds(g: Graphics): void {
    const m = this.map;
    const R = DECK_REST;
    const edges: Array<[number, number, number, number]> = [];
    for (let y = 0; y < m.height; y++) {
      for (let x = 0; x < m.width; x++) {
        if (this.tid(x, y) !== 'bridge') continue;
        const X = x * TILE;
        const Y = y * TILE;
        const sideL = this.tid(x - 1, y) === 'water', sideR = this.tid(x + 1, y) === 'water';
        const sideU = this.tid(x, y - 1) === 'water', sideD = this.tid(x, y + 1) === 'water';
        if (sideL || sideR) {
          // Going up the map: an end above or below.
          const deck = this.materials.uprightDeck((sideL ? x : x - 1) * TILE) ?? this.materials.fill('bridge', C.WOOD);
          for (const [dy, at] of [[-1, Y - R], [1, Y + TILE]] as const) {
            if (this.tid(x, y + dy) === 'bridge' || this.tid(x, y + dy) === 'void' || this.tid(x, y + dy) === 'water') continue;
            g.rect(X, at, TILE, R).fill(deck);
            if (this.materials.quay && sideR) g.rect(X + TILE, at, 3, R).fill({ color: C.INK, alpha: 0.2 });
            const far = dy < 0 ? at : at + R;
            edges.push([X, far, X + TILE, far]);
            if (sideL) edges.push([X, at, X, at + R]);
            if (sideR) edges.push([X + TILE, at, X + TILE, at + R]);
          }
        } else if (sideU || sideD) {
          // Going across the map: an end to the left or right.
          const deck = this.materials.fill('bridge', C.WOOD);
          for (const [dx, at] of [[-1, X - R], [1, X + TILE]] as const) {
            if (this.tid(x + dx, y) === 'bridge' || this.tid(x + dx, y) === 'void' || this.tid(x + dx, y) === 'water') continue;
            g.rect(at, Y, R, TILE).fill(deck);
            const far = dx < 0 ? at : at + R;
            edges.push([far, Y, far, Y + TILE]);
            if (sideU) edges.push([at, Y, at + R, Y]);
            if (sideD) edges.push([at, Y + TILE, at + R, Y + TILE]);
          }
        } else {
          // A tile of the deck already on the land, with no water to draw its edge: its own ink edge.
          if (this.tid(x, y - 1) !== 'bridge') edges.push([X, Y, X + TILE, Y]);
          if (this.tid(x, y + 1) !== 'bridge') edges.push([X, Y + TILE, X + TILE, Y + TILE]);
          if (this.tid(x - 1, y) !== 'bridge') edges.push([X, Y, X, Y + TILE]);
          if (this.tid(x + 1, y) !== 'bridge') edges.push([X + TILE, Y, X + TILE, Y + TILE]);
        }
      }
    }
    if (!edges.length) return;
    for (const [x0, y0, x1, y1] of edges) g.moveTo(x0, y0).lineTo(x1, y1);
    g.stroke({ width: 2, color: C.INK, cap: 'round' });
  }

  /**
   * A natural bank (no quay, no street plan's stone): where the land drops to the water on its sides turned from the light, its lower
   * and right edges, a band of darker earth shows just inside the water, round the rounded corners too (the 3 Nov map review: the
   * river read as a blue cutout). At a corner where the bank turns to a side in the light, the band stops half way round.
   */
  private drawBankFaces(g: Graphics): void {
    const m = this.map;
    const land = (x: number, y: number) => { const id = this.tid(x, y); return id !== 'water' && id !== 'void' && id !== 'bridge'; };
    const band = { width: BANK_BAND, color: BANK_EARTH, alpha: 0.5 };
    // Each arc starts a path of its own: after a stroke Pixi carries on from where it ended, which drew a line across the map
    // to the arc, and a moveTo to the arc's start doubles its first point, which builds vertices that are not numbers.
    const arc = (cx: number, cy: number, r: number, from: number, to: number) => g.beginPath().arc(cx, cy, r, from, to).stroke(band);
    const inner = ROUND - BANK_BAND / 2, outer = ROUND + BANK_BAND / 2;
    for (let y = 0; y < m.height; y++) {
      for (let x = 0; x < m.width; x++) {
        const X = x * TILE;
        const Y = y * TILE;
        if (land(x, y)) {
          // The land's own rounded corners into the water: the band goes round them outside the curve. Its lower right corner
          // is all in shade, its lower left and upper right half way, to where the bank turns to the light.
          const into = (dx: number, dy: number) => this.cornerGround(x, y, dx, dy)?.id === 'water';
          if (into(1, 1)) arc(X + TILE - ROUND, Y + TILE - ROUND, outer, 0, Math.PI / 2);
          if (into(-1, 1)) arc(X + ROUND, Y + TILE - ROUND, outer, Math.PI / 2, Math.PI * 0.75);
          if (into(1, -1)) arc(X + TILE - ROUND, Y + ROUND, outer, Math.PI * 1.75, Math.PI * 2);
          continue;
        }
        if (this.tid(x, y) !== 'water') continue;
        // Where a corner is rounded, by this water or by the land beside it, the straight band stops short and an arc goes round.
        const mine = (dx: number, dy: number) => this.cornerGround(x, y, dx, dy) !== null;
        const theirs = (lx: number, ly: number, dx: number, dy: number) => this.cornerGround(lx, ly, dx, dy)?.id === 'water';
        if (land(x, y - 1)) {
          const a = X + (mine(-1, -1) || theirs(x, y - 1, -1, 1) ? ROUND : 0), b = X + TILE - (mine(1, -1) || theirs(x, y - 1, 1, 1) ? ROUND : 0);
          g.rect(a, Y, b - a, BANK_BAND).fill(band);
          if (mine(1, -1)) arc(X + TILE - ROUND, Y + ROUND, inner, Math.PI * 1.5, Math.PI * 1.75);
        }
        if (land(x - 1, y)) {
          const a = Y + (mine(-1, -1) || theirs(x - 1, y, 1, -1) ? ROUND : 0), b = Y + TILE - (mine(-1, 1) || theirs(x - 1, y, 1, 1) ? ROUND : 0);
          g.rect(X, a, BANK_BAND, b - a).fill(band);
          if (mine(-1, 1)) arc(X + ROUND, Y + TILE - ROUND, inner, Math.PI * 0.75, Math.PI);
        }
        if (mine(-1, -1) && (land(x, y - 1) || land(x - 1, y))) arc(X + ROUND, Y + ROUND, inner, Math.PI, Math.PI * 1.5);
      }
    }
  }

  /**
   * A bridge's deck over water, where no quay draws it: its edge facing the viewer shows as a dark strip of timber, and its shadow falls
   * on the water below it and to its right, with the light from the upper left (the 3 Nov map review: a flat outlined sheet).
   */
  private drawDeckDepth(g: Graphics): void {
    const m = this.map;
    for (let y = 0; y < m.height; y++) {
      for (let x = 0; x < m.width; x++) {
        if (this.tid(x, y) !== 'bridge') continue;
        const X = x * TILE;
        const Y = y * TILE;
        if (this.tid(x, y + 1) === 'water') {
          g.rect(X, Y + TILE - DECK_EDGE, TILE, DECK_EDGE).fill({ color: C.INK, alpha: 0.32 });
          g.rect(X + 3, Y + TILE + 1, this.tid(x + 1, y + 1) === 'water' ? TILE : TILE - 3, DECK_SHADOW).fill({ color: C.INK, alpha: 0.2 });
        }
        if (this.tid(x + 1, y) === 'water') g.rect(X + TILE + 1, Y + 3, DECK_SHADOW - 2, TILE).fill({ color: C.INK, alpha: 0.2 });
      }
    }
  }

  /**
   * A quay: seen from the south, the bank along the north side of water stands as a wall down to it, in courses of stone with a
   * dark waterline, its shadow on the water. The south side's wall faces away, so that bank shows only its top edge. A bridge's
   * deck stands over the water at the ground's height, its shadow falling to its right, with the light from the left.
   */
  private drawQuay(g: Graphics): void {
    const m = this.map;
    const tones = [0xc4bba6, 0xb7ae99, 0xaca38e];
    for (let y = 0; y < m.height; y++) {
      for (let x = 0; x < m.width; x++) {
        if (this.tid(x, y) !== 'water') continue;
        const X = x * TILE;
        const Y = y * TILE;
        if (this.tid(x - 1, y) === 'bridge') g.rect(X, Y, 6, TILE).fill({ color: C.INK, alpha: 0.2 });
        const above = this.tid(x, y - 1);
        if (above === 'water' || above === 'void' || above === 'bridge') continue;
        // Courses of blocks, their joints staggered and running on from tile to tile.
        for (let c = 0; c < 3; c++) {
          const courseY = Y + c * 10;
          const offset = (c + y) % 2 === 0 ? 0 : 8;
          const stops = offset ? [0, 8, 24, 32] : [0, 16, 32];
          for (let s = 0; s + 1 < stops.length; s++) {
            const block = Math.floor((X + stops[s]! - offset) / 16);
            g.rect(X + stops[s]!, courseY, stops[s + 1]! - stops[s]!, 10).fill(tones[Math.floor(this.rnd(block, y * 7 + c, 5) * 3)]!);
            if (X + stops[s]! - offset === block * 16) g.moveTo(X + stops[s]!, courseY).lineTo(X + stops[s]!, courseY + 10).stroke({ width: 1, color: 0x7f7766 });
          }
        }
        g.moveTo(X, Y + 10).lineTo(X + TILE, Y + 10).moveTo(X, Y + 20).lineTo(X + TILE, Y + 20).stroke({ width: 1, color: 0x7f7766 });
        g.rect(X, Y + QUAY_H - 7, TILE, 7).fill({ color: 0x2f3a2e, alpha: 0.35 });
        if (this.rnd(x, y, 40) < 0.22) g.circle(X + 7 + this.rnd(x, y, 41) * 18, Y + 15, 2.4).fill(0x3a352c).stroke({ width: 0.8, color: C.INK });
        g.rect(X, Y + QUAY_H, TILE, 6).fill({ color: C.INK, alpha: 0.16 });
        g.moveTo(X, Y).lineTo(X + TILE, Y).moveTo(X, Y + QUAY_H).lineTo(X + TILE, Y + QUAY_H).stroke({ width: 2, color: C.INK });
        for (const side of [-1, 1]) if (this.tid(x + side, y) === 'bridge') g.moveTo(side < 0 ? X : X + TILE, Y).lineTo(side < 0 ? X : X + TILE, Y + QUAY_H).stroke({ width: 2, color: C.INK });
      }
    }
  }

  /**
   * What roads have over their tiles: corners rounded on both sides of the edge, inside and outside, a kerb along every
   * edge, and lane dashes down the middle of each two-lane stretch. The map's edge has neither corner nor kerb.
   */
  private drawRoads(g: Graphics): void {
    const m = this.map;
    const road = (x: number, y: number) => this.tid(x, y) === 'road';
    const other = (x: number, y: number) => !road(x, y) && this.tid(x, y) !== 'void';
    const asphalt = this.plainColor('road');
    // A road tile's corner sticking out into other ground, and another tile's corner with road round it.
    const outer = (x: number, y: number, dx: number, dy: number) => road(x, y) && other(x + dx, y) && other(x, y + dy) && other(x + dx, y + dy);
    const inner = (x: number, y: number, dx: number, dy: number) => other(x, y) && road(x + dx, y) && road(x, y + dy) && road(x + dx, y + dy);
    const arcs: Array<[number, number, number]> = [];
    for (let y = 0; y < m.height; y++) {
      for (let x = 0; x < m.width; x++) {
        TerrainView.CORNERS.forEach(([dx, dy], i) => {
          const out = outer(x, y, dx, dy);
          if (!out && !inner(x, y, dx, dy)) return;
          const [cx, cy] = [(x + (dx > 0 ? 1 : 0)) * TILE, (y + (dy > 0 ? 1 : 0)) * TILE];
          const [ox, oy] = [cx - dx * ROAD_ROUND, cy - dy * ROAD_ROUND];
          // The corner's square in what shows round the curve, then the quarter circle in the tile's own ground. The square
          // with road round it reaches a little past the tile, over the pavement joint drawn along the tile's edge.
          const round = out ? this.tid(x + dx, y + dy) : 'road';
          const own = out ? 'road' : this.tid(x, y);
          const over = out ? 0 : 1;
          g.rect(dx < 0 ? cx - over : cx - ROAD_ROUND, dy < 0 ? cy - over : cy - ROAD_ROUND, ROAD_ROUND + over, ROAD_ROUND + over).fill(round === 'road' ? asphalt : this.materials.fill(round, this.plainColor(round)));
          const pts = [ox, oy];
          for (let s = 0; s <= 8; s++) {
            const a = TerrainView.ARC_FROM[i]! + (s / 8) * (Math.PI / 2);
            pts.push(ox + Math.cos(a) * ROAD_ROUND, oy + Math.sin(a) * ROAD_ROUND);
          }
          g.poly(pts).fill(own === 'road' ? asphalt : this.materials.fill(own, this.plainColor(own)));
          arcs.push([ox, oy, TerrainView.ARC_FROM[i]!]);
        });
      }
    }
    // The kerb: each side of a road tile that faces other ground, stopping short where a curve takes over.
    const sides: Array<[number, number, number, number]> = [];
    for (let y = 0; y < m.height; y++) {
      for (let x = 0; x < m.width; x++) {
        if (!road(x, y)) continue;
        for (const [sx, sy] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
          if (!other(x + sx, y + sy)) continue;
          const ends = (sx === 0 ? [[-1, sy], [1, sy]] : [[sx, -1], [sx, 1]]).map(([dx, dy]) => {
            const across: [number, number] = sx === 0 ? [dx!, -sy] : [-sx, dy!];
            const cut = outer(x, y, dx!, dy!) || inner(x + sx, y + sy, across[0], across[1]);
            return { vx: (x + (dx! > 0 ? 1 : 0)) * TILE, vy: (y + (dy! > 0 ? 1 : 0)) * TILE, cut: cut ? ROAD_ROUND : 0 };
          });
          const [a, b] = ends as [(typeof ends)[0], (typeof ends)[0]];
          const [ux, uy] = [Math.sign(b.vx - a.vx), Math.sign(b.vy - a.vy)];
          // Two curves can meet with nothing left between them: a line of no length draws as spikes on some phones (see `outline`).
          if (TILE - a.cut - b.cut > 0.5) sides.push([a.vx + ux * a.cut, a.vy + uy * a.cut, b.vx - ux * b.cut, b.vy - uy * b.cut]);
        }
      }
    }
    if (!sides.length && !arcs.length) return;
    const kerb = () => {
      for (const [x0, y0, x1, y1] of sides) g.moveTo(x0, y0).lineTo(x1, y1);
      for (const [ox, oy, a0] of arcs) {
        const a1 = a0 + Math.PI / 2, k = 0.5522847498 * ROAD_ROUND;
        const [x0, y0, x3, y3] = [ox + Math.cos(a0) * ROAD_ROUND, oy + Math.sin(a0) * ROAD_ROUND, ox + Math.cos(a1) * ROAD_ROUND, oy + Math.sin(a1) * ROAD_ROUND];
        g.moveTo(x0, y0).bezierCurveTo(x0 - Math.sin(a0) * k, y0 + Math.cos(a0) * k, x3 + Math.sin(a1) * k, y3 - Math.cos(a1) * k, x3, y3);
      }
    };
    kerb();
    g.stroke({ width: 5.5, color: 0x4f514f, cap: 'round' });
    kerb();
    g.stroke({ width: 3, color: 0xdedacd, cap: 'round' });
    // The lane dashes: one a tile, down the middle of a width of two or three tiles of road with no more road beside it, stopping
    // a tile short of a dead end.
    const dash = 0xe6e3d6;
    const lanes = (span: number, along: number, at: (i: number, j: number) => [number, number], rect: (i: number, middle: number) => void) => {
      for (const wide of [2, 3]) {
        for (let j = 0; j + wide <= span; j++) {
          let run = 0;
          for (let i = 0; i <= along; i++) {
            const cell = (k: number) => road(...at(i, j + k));
            let clear = i < along && !cell(-1) && !cell(wide);
            for (let k = 0; clear && k < wide; k++) clear = cell(k);
            if (clear) { run++; continue; }
            if (run >= LANE_RUN) for (let k = i - run; k < (i < along ? i - 1 : i); k++) rect(k, j + wide / 2);
            run = 0;
          }
        }
      }
    };
    lanes(m.height, m.width, (i, j) => [i, j], (i, middle) => g.rect(i * TILE + 9, middle * TILE - 1.1, 14, 2.2).fill(dash));
    lanes(m.width, m.height, (i, j) => [j, i], (i, middle) => g.rect(middle * TILE - 1.1, i * TILE + 9, 2.2, 14).fill(dash));
  }


  private neighbourGround(x: number, y: number): number {
    for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]] as const) {
      const id = this.tid(x + dx, y + dy);
      if (id === 'water') return C.WATER;
      if (id === 'grass') return C.GRASS;
    }
    return C.GRASS;
  }

  /** Redraws the pellets that have not been eaten. Each is keyed by the grid corner it sits on. */
  drawPellets(corners: Iterable<number>): void {
    const g = this.pellets;
    g.clear();
    const cols = this.map.width + 1;
    const at = [...corners].map((i) => [(i % cols) * TILE, Math.floor(i / cols) * TILE] as const);
    for (const [x, y] of at) g.rect(x - 2, y - 2, 4, 4);
    if (at.length) g.fill(C.ARCADE_DOT);
    // Neon: each pellet glows.
    const h = this.pelletGlow;
    h.clear();
    for (const [x, y] of at) h.circle(x, y, 7);
    if (at.length) h.fill({ color: C.ARCADE_DOT, alpha: 0.2 });
  }
}

type Seg = [number, number, number, number, number, number];

function mergeSegments(segs: Seg[]): Seg[] {
  const byKey = new Map<string, Seg[]>();
  for (const s of segs) {
    const horiz = s[1] === s[3];
    const k = horiz ? `h${s[1]},${s[5]}` : `v${s[0]},${s[4]}`;
    (byKey.get(k) ?? byKey.set(k, []).get(k)!).push(s);
  }
  const out: Seg[] = [];
  for (const [k, list] of byKey) {
    const horiz = k.startsWith('h');
    list.sort((a, b) => (horiz ? a[0] - b[0] : a[1] - b[1]));
    let cur = [...list[0]!] as Seg;
    for (let i = 1; i < list.length; i++) {
      const s = list[i]!;
      const touches = horiz ? s[0] === cur[2] : s[1] === cur[3];
      if (touches) {
        cur[2] = s[2];
        cur[3] = s[3];
      } else {
        out.push(cur);
        cur = [...s] as Seg;
      }
    }
    out.push(cur);
  }
  return out;
}
