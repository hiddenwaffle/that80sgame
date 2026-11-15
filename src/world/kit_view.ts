import { Container, Matrix, Rectangle, Sprite, Texture } from 'pixi.js';
import kitArts from 'virtual:kit-art';
import { artOrPink } from '../art/images.ts';
import type { GameMap } from '../content/tiled.ts';
import type { KitArt, KitObject } from '../../tools/kit_art.ts';
import { CELL_H, CELL_W, CHUNK, KX, bakeScale, chunksIn, drawKitTile, gidOf, objectMatrix, planKit, type KitPlan } from './kit_math.ts';
import { KitShadows } from './kit_shadows.ts';

/**
 * A map drawn from a Tiled kit composition (the map's `kit_art` property; tools/kit_art.ts reads it at build time).
 *
 * The kit's cells are 40 by 32 pixels for a game tile's 32 by 32 world units, which is the printed world's tilt: the scene
 * draws the ground 0.8 as tall as it is wide, so a kit cell lands on screen undistorted at one scale for both directions. Ground
 * layers (named `ground...`) are baked into one image that sits in the scene as it is, squashed with the ground. The other tile
 * layers (roofs, walls) are baked the same way and cut into rows that stay on the grid; every tile object (fronts, props) is
 * stretched back by the tilt the way the game's people and props are. All of them take their place among the party,
 * townspeople and patrols by their base.
 *
 * Depth: a tile object's base is its bottom edge; a tile layer is cut into rows, each a strip whose base is the row's bottom
 * edge. Each is one thing to sort, with the figures. So the party walks behind a building north of its front, in front of
 * it to the south, a roof row hides what is behind it, and a figure beside a gable is drawn behind the roof rows that lie to its
 * south and in front of the ones to its north. Strips rather than whole buildings because a roof is a few cells deep and a doorway
 * or a gable is a change of base from one cell to the next: whole-building depth would put a figure at the foot of a gable
 * wing in front of its far end. Strips rather than single cells because a row is one texture (one draw call) and one sort
 * entry, where a cell is hundreds. A kit's own layer order breaks ties, as Tiled's would.
 *
 * Sharp: the kit's own pictures are a quarter the size of the masters they were made from (tools/kit_masters.ts), and a kit pixel covers
 * two to five device pixels, so the game draws the masters where there are any. The ground and the tile layers are baked, chunk by chunk
 * (4 by 4 cells), only for what is near the screen, from the masters shrunk smoothly to 1, 2 or 4 baked pixels to a kit pixel, whichever leaves a baked pixel
 * about one device pixel across (`bakeScale`): so art pixels are at or below device pixels on every screen, a texture is small enough for a phone, and
 * the memory held is what the screen shows, not the map. A tile recorded as having no master keeps its kit picture, enlarged without smoothing;
 * an unscanned tile is hot pink and fails the content/build checks. Each chunk is baked
 * a little wide of itself, so there is no seam between chunks or cells. An image that failed to load is a hot pink box (`artOrPink`), never a gap.
 */


/** A piece that sorts with the figures. */
interface Item {
  node: Container;
  /** The tile object this is, restretched by the tilt when it changes (the rows of a tile layer stay on the grid). */
  upright: KitObject | null;
}

/** Baked pixels of gutter round a chunk, from the cells next to it, so the filtering at its edge reads their pixels and no seam shows. */
const GUTTER = 2;

interface Chunk {
  textures: Texture[];
  bytes: number;
  ground: Sprite | null;
  strips: Item[];
}

export class KitView {
  /** The ground's chunks: under everything. */
  readonly ground = new Container();
  /** Flat bases cut from upright pictures. Kept above baked ground and below all actors. */
  private readonly groundFeet = new Container();
  /** What sorts with the figures now (zIndex is its sorting key): the tile objects, and the strips of the chunks held. */
  readonly items: Item[] = [];
  private lastGround = 0;
  private readonly art: KitArt;
  private readonly extendGround: boolean;
  private readonly plan: KitPlan;
  private readonly shadows: KitShadows | null;
  private shadowsEnabled: boolean;
  private parent: Container | null = null;
  private readonly chunks = new Map<string, Chunk>();
  private scale: 1 | 2 | 4 = 1;
  /** Cropped object textures own their frames, never the shared art source. */
  private readonly objectTextures: Texture[] = [];
  private readonly stripPlan = new Map<string, { key: number; base: number }>();
  /** Baking counts, for the checks and the measures. */
  baked = 0;
  freed = 0;
  bakeMs = 0;
  maxBakeMs = 0;

  private constructor(art: KitArt, extendGround: boolean) {
    this.art = art;
    this.extendGround = extendGround;
    this.plan = planKit(art);
    this.shadows = art.castShadows ? new KitShadows(art) : null;
    this.shadowsEnabled = Boolean(this.shadows);
    for (const s of this.plan.strips) this.stripPlan.set(`${s.layer},${s.row}`, { key: s.key, base: s.base });
    for (const o of this.plan.objects) {
      const t = art.tiles[gidOf(o.object.gid)]!;
      const holder = new Container();
      const m = t.master;
      // The holder's middle is the tile's middle (its matrix puts that where the object goes), so the picture sits relative to it.
      if (t.unscanned) {
        const sprite = new Sprite(Texture.WHITE);
        sprite.tint = 0xff69b4;
        sprite.anchor.set(0.5, 0.5);
        sprite.width = o.object.w;
        sprite.height = o.object.h;
        holder.addChild(sprite);
      } else if (m) {
        // A picture's master, shrunk to the tile's width and set at its foot (a tile is padded with clear rows above its picture).
        const tex = this.texture(m.slot);
        for (const p of m.parts) {
          const part = new Texture({ source: tex.source, frame: new Rectangle(tex.frame.x + p.sx, tex.frame.y + p.sy, p.sw, p.sh) });
          this.objectTextures.push(part);
          const sprite = new Sprite(part);
          sprite.position.set(p.dx - o.object.w / 2, p.dy - o.object.h / 2);
          sprite.scale.set(p.dw / p.sw, p.dh / p.sh);
          holder.addChild(sprite);
        }
      } else {
        const sprite = new Sprite(this.texture(t.slot));
        sprite.anchor.set(0.5, 0.5);
        holder.addChild(sprite);
      }
      holder.zIndex = o.key;
      holder.label = o.object.name;
      holder.eventMode = 'none';
      const foot = o.object.groundFootHeight;
      if (foot) {
        const base = new Container();
        base.label = `${o.object.name} ground foot`;
        // Split the existing texture frames rather than resampling the source art. At the ordinary 0.8 tilt
        // these two parts have exactly the former pixels, with only their depth order changed.
        const cut = o.object.h / 2 - foot;
        for (const child of [...holder.children] as Sprite[]) {
          const tex = child.texture;
          const top = child.y - child.anchor.y * tex.height * child.scale.y;
          const left = child.x - child.anchor.x * tex.width * child.scale.x;
          const bottom = top + tex.height * child.scale.y;
          if (bottom <= cut) continue;
          const above = Math.max(0, (cut - top) / child.scale.y);
          const frame = tex.frame;
          const lower = new Texture({ source: tex.source, frame: new Rectangle(frame.x, frame.y + above, frame.width, frame.height - above) });
          this.objectTextures.push(lower);
          const flat = new Sprite(lower);
          flat.position.set(left, top + above * child.scale.y);
          flat.scale.copyFrom(child.scale);
          base.addChild(flat);
          if (above === 0) child.destroy();
          else {
            const upper = new Texture({ source: tex.source, frame: new Rectangle(frame.x, frame.y, frame.width, above) });
            this.objectTextures.push(upper); child.anchor.set(0); child.position.set(left, top); child.texture = upper;
          }
        }
        const matrix = objectMatrix(o.object, 0.8);
        base.setFromMatrix(new Matrix(matrix.a, matrix.b, matrix.c, matrix.d, matrix.tx, matrix.ty));
        this.groundFeet.addChild(base);
      }
      this.items.push({ node: holder, upright: o.object });
    }
    this.ground.addChild(this.groundFeet);
    this.render(1);
  }

  /** The picture of a slot, filtered smoothly for a master and left crisp for a kit picture (a master's slot is told by a tile naming it). */
  private texture(slot: string): Texture {
    const tex = artOrPink(slot)!;
    tex.source.scaleMode = this.isMasterSlot(slot) ? 'linear' : 'nearest';
    return tex;
  }

  private masterSlots: Set<string> | null = null;
  private isMasterSlot(slot: string): boolean {
    if (!this.masterSlots) {
      this.masterSlots = new Set();
      for (const t of Object.values(this.art.tiles)) if (t.master) this.masterSlots.add(t.master.slot);
    }
    return this.masterSlots.has(slot);
  }

  /** The kit view a map names, or null for a map without one (or with art off, which keeps the code drawing). */
  static for(map: GameMap): KitView | null {
    if (typeof map.props.kit_art !== 'string') return null;
    const art = kitArts[map.id];
    if (!art) throw new Error(`Map ${map.id} names the kit art ${map.props.kit_art}, but the build holds none for it.`);
    if (art.cols !== map.width || art.rows !== map.height) {
      throw new Error(`Map ${map.id} is ${map.width} by ${map.height} tiles; its kit art ${map.props.kit_art} is ${art.cols} by ${art.rows} cells.`);
    }
    // With art off no image is made; the code terrain is drawn, which is what turning art off asks for.
    const first = Object.values(art.tiles)[0];
    if (!first || artOrPink(first.master?.slot ?? first.slot) === null) return null;
    return new KitView(art, map.props.fight_camera === 'free');
  }

  /** Puts the tile objects into the layer that sorts with the figures, and holds it for the strips of the chunks that come and go. */
  attach(sorted: Container): void {
    this.parent = sorted;
    for (const it of this.items) sorted.addChild(it.node);
  }

  /**
   * Holds the chunks a view reaches (world units, a margin beyond it), baking those missing (`budget` a step, the nearest first; all at once when
   * `all`) and letting the rest go. `zoom` includes the scene and play-time viewport scales; `dpr` is the live renderer resolution.
   */
  update(view: { x0: number; y0: number; x1: number; y1: number }, zoom: number, dpr: number, all = false): void {
    const scale = bakeScale(zoom * KX * dpr, this.scale);
    if (scale !== this.scale) {
      this.scale = scale;
      this.dropAll();
      all = true;
    }
    const want = chunksIn(view, this.art.cols, this.art.rows, 64, this.extendGround);
    const keep = chunksIn(view, this.art.cols, this.art.rows, 192, this.extendGround);
    for (const [key, chunk] of this.chunks) {
      const [c, r] = key.split(',').map(Number) as [number, number];
      if (c < keep.c0 || c > keep.c1 || r < keep.r0 || r > keep.r1) { this.free(chunk); this.chunks.delete(key); }
    }
    const missing: Array<[number, number, number]> = [];
    const mid = [(view.x0 + view.x1) / 2, (view.y0 + view.y1) / 2];
    const span = 32 * CHUNK;
    for (let r = want.r0; r <= want.r1; r++) for (let c = want.c0; c <= want.c1; c++) {
      if (!this.chunks.has(`${c},${r}`)) missing.push([c, r, Math.hypot((c + 0.5) * span - mid[0]!, (r + 0.5) * span - mid[1]!)]);
    }
    missing.sort((a, b) => a[2] - b[2]);
    // A step takes at most a few, unless much of what is shown is missing (a jump, a new scale): then all, so nothing shows bare.
    const n = all || missing.length > 6 ? missing.length : 2;
    for (const [c, r] of missing.slice(0, n)) this.chunks.set(`${c},${r}`, this.bake(c, r));
  }

  /** The bytes of texture the chunks hold now (four to a pixel), for the measures. */
  get textureBytes(): number { let n = 0; for (const c of this.chunks.values()) n += c.bytes; return n; }

  /** How many chunks are held now, for the checks. */
  get held(): number { return this.chunks.size; }
  /** Baked pixels to a kit pixel now. */
  get bakedAt(): number { return this.scale; }
  get shadowsOn(): boolean { return this.shadowsEnabled; }
  get shadowBakeMs(): number { return this.shadows?.totalMs ?? 0; }
  get maxShadowBakeMs(): number { return this.shadows?.maxMs ?? 0; }
  get shadowScratchBytes(): number { return this.shadows?.scratchBytes ?? 0; }
  get peakShadowScratchBytes(): number { return this.shadows?.peakScratchBytes ?? 0; }

  /** A comparison switch for the checks; it cannot opt an unconfigured composition into shadows. */
  setShadows(enabled: boolean): void {
    const next = Boolean(this.shadows) && enabled;
    if (next === this.shadowsEnabled) return;
    this.shadowsEnabled = next;
    this.shadows?.release();
    this.dropAll();
  }

  private bake(cc: number, cr: number): Chunk {
    const started = performance.now();
    const { cols, rows, layers, tiles } = this.art, f = this.scale;
    const c0 = cc * CHUNK, r0 = cr * CHUNK;
    const c1 = this.extendGround ? c0 + CHUNK : Math.min(cols, c0 + CHUNK);
    const r1 = this.extendGround ? r0 + CHUNK : Math.min(rows, r0 + CHUNK);
    const cw = (c1 - c0) * CELL_W * f, ch = (r1 - r0) * CELL_H * f;
    const chunk: Chunk = { textures: [], bytes: 0, ground: null, strips: [] };
    const source = (slot: string) => this.texture(slot).source.resource as CanvasImageSource;
    /** The layers' tiles, the chunk's and one cell round it, into one canvas the chunk's size with a gutter; null if there is none. */
    const draw = (indices: number[], shadowed = false): Texture | null => {
      const canvas = document.createElement('canvas');
      canvas.width = cw + GUTTER * 2;
      canvas.height = ch + GUTTER * 2;
      const g = canvas.getContext('2d')!;
      let any = false;
      for (const index of indices) {
        const l = layers[index]!;
        if (l.kind !== 'tiles') continue;
        const extend = this.extendGround && index === this.plan.ground[0];
        for (let r = extend ? r0 - 1 : Math.max(0, r0 - 1); r < (extend ? r1 + 1 : Math.min(rows, r1 + 1)); r++) for (let c = extend ? c0 - 1 : Math.max(0, c0 - 1); c < (extend ? c1 + 1 : Math.min(cols, c1 + 1)); c++) {
          const row = Math.max(0, Math.min(rows - 1, r)), col = Math.max(0, Math.min(cols - 1, c));
          const raw = l.cells[row * cols + col]!;
          if (!raw) continue;
          drawKitTile(g, source, tiles[gidOf(raw)]!, GUTTER + (c - c0) * CELL_W * f, GUTTER + (r - r0) * CELL_H * f, raw, f);
          if (c >= c0 && c < c1 && r >= r0 && r < r1) any = true;
        }
      }
      if (!any) return null;
      if (shadowed && this.shadowsEnabled) this.shadows!.draw(g, source, c0 * CELL_W, r0 * CELL_H, f, GUTTER);
      const tex = Texture.from(canvas);
      tex.source.scaleMode = 'linear';
      chunk.textures.push(tex);
      chunk.bytes += canvas.width * canvas.height * 4;
      return tex;
    };
    const frame = (tex: Texture, x: number, y: number, w: number, h: number) => new Texture({ source: tex.source, frame: new Rectangle(x, y, w, h) });
    const ground = draw(this.plan.ground, true);
    if (ground) {
      const s = new Sprite(frame(ground, GUTTER, GUTTER, cw, ch));
      s.position.set(c0 * 32, r0 * 32);
      s.scale.set(KX / f, 1 / f);
      s.eventMode = 'none';
      this.ground.addChildAt(s, 0);
      chunk.ground = s;
    }
    const layerOf = [...new Set(this.plan.strips.map((s) => s.layer))];
    for (const index of layerOf) {
      const tex = draw([index]);
      if (!tex) continue;
      const l = layers[index]!;
      for (let r = Math.max(0, r0); r < Math.min(rows, r1); r++) {
        let any = false;
        if (l.kind === 'tiles') for (let c = Math.max(0, c0); c < Math.min(cols, c1); c++) if (l.cells[r * cols + c]) { any = true; break; }
        if (!any) continue;
        const node = new Sprite(frame(tex, GUTTER, GUTTER + (r - r0) * CELL_H * f, cw, CELL_H * f));
        node.anchor.set(0, 1);
        const plan = this.stripPlan.get(`${index},${r}`)!;
        node.position.set(c0 * 32, plan.base);
        node.scale.set(KX / f, 1 / f);
        node.zIndex = plan.key;
        node.label = `${l.name} row ${r}`;
        node.eventMode = 'none';
        const item: Item = { node, upright: null };
        this.items.push(item);
        chunk.strips.push(item);
        this.parent?.addChild(node);
      }
    }
    this.baked++;
    const ms = performance.now() - started;
    this.bakeMs += ms;
    this.maxBakeMs = Math.max(this.maxBakeMs, ms);
    return chunk;
  }

  private free(chunk: Chunk): void {
    chunk.ground?.destroy();
    for (const it of chunk.strips) {
      it.node.destroy();
      this.items.splice(this.items.indexOf(it), 1);
    }
    for (const t of chunk.textures) t.destroy(true);
    this.freed++;
  }

  private dropAll(): void {
    for (const chunk of this.chunks.values()) this.free(chunk);
    this.chunks.clear();
  }

  /** Stretches the tile objects back by the tilt (`ground` is how tall the ground is drawn, 1 straight down). */
  render(ground: number): void {
    if (ground === this.lastGround) return;
    this.lastGround = ground;
    for (const it of this.items) {
      const o = it.upright;
      if (!o) continue;
      const m = objectMatrix(o, ground);
      it.node.setFromMatrix(new Matrix(m.a, m.b, m.c, m.d, m.tx, m.ty));
    }
  }

  destroy(): void {
    this.dropAll();
    this.shadows?.release();
    for (const texture of this.objectTextures) texture.destroy(false);
    this.objectTextures.length = 0;
  }
}
