import { Container, Graphics, Sprite } from 'pixi.js';
import type { LookId } from '../art/characters.ts';
import { drawFire } from '../art/fire.ts';
import type { Dir } from '../art/geom.ts';
import { sceneryMaterial, sceneryProp, sceneryPropBounds } from '../art/map_scenery.ts';
import { PROPS } from '../art/props.ts';
import { clipWreckArtifact } from '../art/wreck_art.ts';
import { TERRAIN_BY_CHAR, TILE } from '../content/terrain.ts';
import type { GameMap } from '../content/tiled.ts';
import { Actor } from './actor.ts';
import { buildIsoScene, isIsoScene } from './iso_scenes.ts';
import { TerrainView } from './terrainView.ts';

/**
 * Newspaper pictures put together from the maps' own pieces (the owner, 2026-11-09: "what if we reused map assets? And
 * constructed some scenes ... I was expecting that you'd create a new scene using the graphics"): a small map of its own,
 * ground by the tile, the map's paving laid over it, its props and figures stood where the scene wants them, drawn by the
 * same code and art as on the map, in the print world's tipped view. Shown on the page as it is, not photographed.
 */
interface Scene {
  /** The map whose art and materials it uses. */
  map: string;
  /** The ground, a terrain letter per tile (src/content/terrain.ts), top row first. */
  ground: string[];
  /** What is laid over the ground, in map units: paving, a square. */
  paint?: (g: Graphics) => void;
  /** Props by kind, standing on their foot at (x, y), mirrored when `flip`. */
  props: Array<[kind: string, x: number, y: number, flip?: boolean]>;
  /** Figures by look, standing at (x, y), facing `dir`. */
  figures: Array<[look: LookId, x: number, y: number, dir: Dir]>;
  /** The part the photo shows: its middle and how wide it is, in map units. */
  view: [x: number, y: number, width: number];
}

/** How tall the ground is drawn in the print world's tipped view (world.ts, at full tilt); upright things keep their height. */
const GROUND = 0.8;

const SCENES: Record<string, Scene> = {
  // After the tank: the square by the lake in Beijing, the tank burning on it, the students who stood up to it gathered
  // behind, the trio beside it; the lake, a willow and the statue just beyond. Much closer together than on the map, for a
  // close shot (the owner, 2026-11-09: "a 1.5x zoom? So the characters are easier to see").
  beijing_aftermath: {
    map: 'field',
    ground: [
      '~~~~~~~~~~~~~~',
      '~~~~~~~~~~~~~~',
      '~~~~~~~~~~~~~~',
      '~~~~~~~~~~~~~~',
      '~~~~~~~~~~~~~~',
      ',,,,,,,,,,,,,,',
      ',,,,,,,,,,,,,,',
      ',,,,,,,,,,,,,,',
      ',,,,,,,,,,,,,,',
      ',,,,,,,,,,,,,,',
      ',,,,,,,,,,,,,,',
    ],
    paint: (g) => {
      const paving = sceneryMaterial('field', 'paving', 160);
      // The promenade along the water, then the square: a darker frame round pale slabs, a stone inlay in the middle.
      g.rect(0, 5 * TILE, 14 * TILE, 1.15 * TILE).fill(paving ?? 0xc8bca1);
      g.moveTo(0, 6.15 * TILE).lineTo(14 * TILE, 6.15 * TILE).stroke({ width: 2, color: 0xe4d9bd });
      g.moveTo(0, 6.15 * TILE + 3).lineTo(14 * TILE, 6.15 * TILE + 3).stroke({ width: 1, color: 0x696f6c });
      const x = 0.5 * TILE, y = 6.35 * TILE, w = 13 * TILE, h = 4.65 * TILE;
      g.rect(x, y, w, h).fill(0x979b94);
      g.rect(x + 8, y + 8, w - 16, h - 8).fill(paving ?? 0xd2cbbb);
      g.rect(5.5 * TILE, 9 * TILE, 3 * TILE, 2 * TILE).fill(0xb8b8aa).stroke({ width: 3, color: 0xe4ddcb });
      for (const c of [6.5, 7.5]) g.moveTo(c * TILE, 9 * TILE).lineTo(c * TILE, 11 * TILE);
      g.moveTo(5.5 * TILE, 10 * TILE).lineTo(8.5 * TILE, 10 * TILE);
      g.stroke({ width: 0.65, color: 0xa3a797 });
    },
    props: [
      // The flag flies away from the statue, so its cloth leaves the plinth's writing clear.
      ['statue', 170, 186], ['post_row', 300, 160], ['willow', 372, 166], ['square_flag', 146, 252, true], ['tank_wreck', 222, 286],
    ],
    figures: [
      ['student', 152, 228, 'right'], ['student', 182, 220, 'right'], ['student', 282, 220, 'left'], ['guide_student', 310, 230, 'left'],
      ['olli', 304, 298, 'left'], ['ronnie', 330, 306, 'left'], ['gorbie', 356, 296, 'left'],
    ],
    view: [246, 214, 240],
  },
};

/** Whether a picture is a scene put together from a map's pieces. */
export const isScene = (name: string): boolean => name in SCENES || isIsoScene(name);

export interface PictureScene {
  readonly view: Container;
  /** Lets go of the scene: its figures' kept poses as figures leaving a map do, and every drawing of it. */
  destroy(): void;
}

/** The scene called `name`, filling a `w` by `h` photo, or null if there is none by that name. */
export function buildScene(name: string, w: number, h: number): PictureScene | null {
  if (isIsoScene(name)) return buildIsoScene(name, w, h);
  const s = SCENES[name];
  if (!s) return null;
  const cols = s.ground[0]!.length, rows = s.ground.length;
  const terrain = new Uint8Array(cols * rows);
  s.ground.forEach((row, r) => [...row].forEach((ch, c) => (terrain[r * cols + c] = TERRAIN_BY_CHAR.get(ch) ?? 0)));
  const map: GameMap = { id: s.map, file: `scene:${name}`, width: cols, height: rows, props: { world: 'print' }, terrain, objects: [] };
  const ground = new TerrainView(map);
  ground.update(0, [0, 0, cols * TILE, rows * TILE]);
  const view = new Container();
  const scene = new Container();
  const paint = new Graphics();
  s.paint?.(paint);
  const sorted = new Container({ sortableChildren: true });
  scene.addChild(ground.print, paint, sorted);
  view.addChild(scene);
  const [cx, cy, width] = s.view;
  const k = w / width;
  scene.scale.set(k, k * GROUND);
  scene.position.set(w / 2 - cx * k, h / 2 - cy * k * GROUND);
  const upright = 1 / GROUND;
  for (const [kind, x, y, flip] of s.props) {
    const info = PROPS[kind];
    if (!info) continue;
    // As the map stands a prop (world.ts, buildObjects): its art on its base, scaled to the prop's height, else its code drawing.
    const tex = sceneryProp(s.map, kind);
    let gfx: Container, base = 1;
    if (tex) {
      const sprite = new Sprite(tex);
      const bounds = sceneryPropBounds(s.map, kind);
      if (bounds) {
        sprite.position.set(bounds.x, bounds.y);
        sprite.width = bounds.width;
        sprite.height = bounds.height;
        gfx = new Container();
        gfx.addChild(sprite);
        if (info.drawOverImage) {
          const over = new Graphics();
          info.drawOverImage(over, 0);
          if (bounds.overlay) {
            over.position.set(bounds.overlay.x, bounds.overlay.y);
            over.scale.set(bounds.overlay.scaleX, bounds.overlay.scaleY);
          }
          gfx.addChild(over);
        }
        base = info.drawn ? info.height / info.drawn : 1;
      } else {
        sprite.anchor.set(0.5, 1);
        gfx = kind === 'tank_wreck' ? clipWreckArtifact(sprite) : sprite;
        base = info.height / tex.height;
      }
    } else {
      const drawing = new Graphics();
      info.draw(drawing, 0);
      gfx = drawing;
      if (info.drawn) base = info.height / info.drawn;
    }
    gfx.position.set(x, y);
    gfx.scale.set(flip ? -base : base, base * upright);
    gfx.zIndex = y;
    sorted.addChild(gfx);
    if (info.burning) {
      const fire = new Graphics();
      drawFire(fire, 0, info.burning, info.fireSize ?? 11, 0.85, { still: true });
      fire.position.set(x, y);
      fire.scale.set(1, upright);
      fire.zIndex = y + 0.5;
      sorted.addChild(fire);
    }
  }
  const figures = s.figures.map(([look, x, y, dir], i) => {
    const a = new Actor(`scene_${name}_${i}`, 'npc', look, x, y);
    a.facing = dir;
    a.render(0);
    a.view.scale.set(1, upright);
    sorted.addChild(a.view);
    return a;
  });
  return {
    view,
    destroy: () => {
      for (const a of figures) a.destroy();
      view.destroy({ children: true, context: true });
    },
  };
}
