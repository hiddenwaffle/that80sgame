import { ColorMatrixFilter, Container, Graphics, Sprite } from 'pixi.js';
import { LOOK } from '../render/look.ts';
import type { Dir } from './geom.ts';
import { art, artFile } from './images.ts';
import { LOOK_FIT } from './lookFit.ts';
import { LOOK_INK } from './lookInk.ts';
import { LOOK_EYES } from './lookEyes.ts';
import { GHOST_TINTS, lookSlotPrefix } from './ghostTints.ts';
import { foilGhost, type FoilMesh } from './ghostFoil.ts';
import { jawShape, jawEdges } from './ball_face.ts';
export { jawEdges } from './ball_face.ts';
import { INK } from '../render/palette.ts';
import { LOOK_HATS, type LookId, type Pose } from './characters.ts';
import { clipBatteredArtifact, clipWreckArtifact } from './wreck_art.ts';

/**
 * A figure's art, where its look has some (see docs/art_spec.md): one image per view, `looks/<look>_side`
 * (facing right, mirrored for left), `looks/<look>_front` (facing down) and `looks/<look>_back` (facing up).
 *
 * A ball's image is drawn with its mouth shut; the mouth is a wedge cut out of it toward the way it faces,
 * opening as the code drawing's does. Its edges are inked at the picture's own outline weight where the mouth meets it
 * (`LOOK_INK`): at the code drawings' heavier weight they read as black lips (the owner, 2026-10-14: "The polished
 * characters do have a black outline, they just aren't a thick as the placeholder ones like the Beijin pacs. Can you
 * configure the lips to have the weight of the pacs' outlines?"). The ball is placed by where its
 * circle is in the image (`LOOK_FIT`, measured when the image was prepared), so art of any size lines up
 * with the body. A whole figure (the tank, the boss) stands on the feet at a set width or height.
 *
 * Knocked out, a ball shows its `looks/<look>_ko` image (crossed eyes) whichever way it faced, and a whole
 * figure is printed grey; hurt, the art flashes white.
 */

/**
 * `ball`: views fitted by the ball's circle, with the mouth cut in code. `whole`: a side view only, standing on
 * the feet at a set width or height; `head`, where the head of whoever speaks for it is, at the picture's top:
 * `across` its picture from the left (facing right), down to its `chin`, both as fractions of the picture.
 * `upright`: side, front and back views standing on the feet at a set height, with no mouth (the ghosts).
 */
export type LookArt =
  | { kind: 'ball' }
  | { kind: 'whole'; by: 'width' | 'height'; span: number; aspect?: number; head?: { across: number; chin: number } }
  | { kind: 'upright'; span: number };

/** How each look with art uses it. A look not listed keeps its code drawing. */
export const LOOK_ART: Partial<Record<LookId, LookArt>> = {
  olli: { kind: 'ball' },
  ronnie: { kind: 'ball' },
  gorbie: { kind: 'ball' },
  blue_thing: { kind: 'ball' },
  shopkeeper: { kind: 'ball' },
  // The student is drawn in code since 2026-10-06 (src/art/characters.ts): its art wears the straw hat.
  german: { kind: 'ball' },
  german_guide: { kind: 'ball' },
  german_tourist: { kind: 'ball' },
  german_nephew: { kind: 'ball' },
  german_shopper: { kind: 'ball' },
  german_student: { kind: 'ball' },
  german_pensioner: { kind: 'ball' },
  german_commuter: { kind: 'ball' },
  german_gardener: { kind: 'ball' },
  worker: { kind: 'ball' },
  grey_hat: { kind: 'ball' },
  guard_cap: { kind: 'ball' },
  guard_hat: { kind: 'ball' },
  soldier: { kind: 'ball' },
  ghost_green: { kind: 'upright', span: 2.05 },
  ghost_cream: { kind: 'upright', span: 2.05 },
  ghost_red: { kind: 'upright', span: 2.05 },
  ghost_orange: { kind: 'upright', span: 2.05 },
  ghost_blue: { kind: 'upright', span: 2.05 },
  ghost_pink: { kind: 'upright', span: 2.05 },
  ghost_cyan: { kind: 'upright', span: 2.05 },
  ghost_yellow: { kind: 'upright', span: 2.05 },
  ghost_lime: { kind: 'upright', span: 2.05 },
  ghost_purple: { kind: 'upright', span: 2.05 },
  ghost_white: { kind: 'upright', span: 2.05 },
  ghost_brown: { kind: 'upright', span: 2.05 },
  ghost_magenta: { kind: 'upright', span: 2.05 },
  ghost_teal: { kind: 'upright', span: 2.05 },
  ghost_grey: { kind: 'upright', span: 2.05 },
  ghost_giant: { kind: 'upright', span: 2.05 },
  // At the townspeople's scale since 2026-10-03: its driver's head (0.147 of its picture's width) as wide as a ball.
  // It was 4.2, and 6.2 with the look's `wreck` (2026-10-02).
  // `aspect`, its picture's height over its width (192 to 320), gives its reach while the picture is missing.
  // `head`: its driver's cap is the picture's top, 0.38 of the way across (its crown at 119 to 140 of 320 pixels), and
  // his chin meets the turret 0.26 of the way down (about 49 of 192 pixels).
  tank: { kind: 'whole', by: 'width', span: 11.5, aspect: 192 / 320, head: { across: 0.38, chin: 0.26 } },
  boss: { kind: 'whole', by: 'height', span: 2.5 },
};

/**
 * An upright figure's width over its height: every ghost as wide as the orange one's art is drawn, 270 pixels to
 * 320 (the owner, 2026-10-03), the other ghosts' art being narrower (210 to 234).
 */
const UPRIGHT_WIDE = 270 / 320;

/** A whole or upright figure's span, as it is drawn. */
export function wholeSpan(look: LookId): number {
  const how = LOOK_ART[look];
  return how && how.kind !== 'ball' ? how.span : 1;
}

/**
 * Where a whole figure is met by someone walking into it, from its feet: as wide as its picture, and as deep as the
 * picture is tall, so the tank fills Beijing's avenue from kerb to kerb (2026-10-03). While the picture is missing
 * (not loaded yet, failed, or `?art=off`) the look's `aspect` stands in for it, so the way past the tank never depends
 * on a picture. Null for any other figure, or with neither, when the body's circle is used.
 */
export function wholeBox(look: LookId, size: number): { halfW: number; depth: number } | null {
  const how = LOOK_ART[look];
  if (!how || how.kind !== 'whole') return null;
  const tex = art(`looks/${look}_side`);
  const [w, h] = tex ? [tex.width, tex.height] : how.aspect ? [1, how.aspect] : [0, 0];
  if (!w) return null;
  const k = (how.span * size) / (how.by === 'width' ? w : h);
  return { halfW: (w * k) / 2, depth: h * k };
}

/**
 * Where a whole figure with a `head` speaks from, for the balloon its lines point at: across from its feet, and up from
 * them to its picture's top (`up`) and to its head's chin (`chin`), as drawn for `facing` (mirrored but for right).
 * Null for any other figure, and while its picture is not in (`?art=off`, or not loaded): its code drawing then stands
 * in, with its own head (`LookInfo.head`, used by `Actor.speakingPoint`). Its height is the plain picture's; the battered tank's picture is 9% taller, so
 * a battered tank's balloon would point just inside the cap (it speaks its one line before any damage).
 */
export function headPoint(look: LookId, size: number, facing: Dir): { dx: number; up: number; chin: number } | null {
  const how = LOOK_ART[look];
  if (!how || how.kind !== 'whole' || how.head === undefined || !art(`looks/${look}_side`)) return null;
  const box = wholeBox(look, size);
  if (!box) return null;
  return { dx: (facing === 'right' ? 1 : -1) * (how.head.across - 0.5) * box.halfW * 2, up: box.depth, chin: box.depth * (1 - how.head.chin) };
}

function view(facing: Dir): 'side' | 'front' | 'back' {
  return facing === 'up' ? 'back' : facing === 'down' ? 'front' : 'side';
}

/**
 * Draws a look's art into `c` (emptied first) about the body's middle, for a pose; false when there is none for
 * this look and view (for a knocked-out ball, its `_ko` view), and the code drawing should be used. A knocked-out
 * whole or upright figure is its art printed grey.
 */
export function drawLookArt(c: Container, look: LookId, pose: Pose, size: number): boolean {
  const wears = LOOK_HATS[look];
  if (wears) {
    if (!drawLookArt(c, 'german', pose, size)) return false;
    const hat = new Graphics();
    hat.label = `${look}_hat`;
    wears(hat, pose, size);
    c.addChild(hat);
    return true;
  }
  const how = LOOK_ART[look];
  if (!how) return false;
  const koBall = pose.ko && how.kind === 'ball';
  // The look's `wreck`: the tank battered from half its HP down, and a burnt-out wreck once beaten.
  const stage = look === 'tank' && LOOK.has('wreck') ? (pose.ko ? art('looks/tank_wreck') && 'looks/tank_wreck' : (pose.damage ?? 0) >= 0.5 && art('looks/tank_battered') ? 'looks/tank_battered' : null) : null;
  // A ghost in its own colour: its painted shape's grey body, tinted, with that shape's eyes over it untinted.
  const tint = GHOST_TINTS[look];
  // A whole figure has a side view only: facing up or down it shows it facing left, as its code drawing does.
  const slot = stage || (koBall ? `looks/${look}_ko` : how.kind === 'whole' ? `looks/${look}_side` : `${lookSlotPrefix(look)}${view(pose.facing)}`);
  const tex = art(slot);
  if (!tex) return false;
  const eyesTex = tint ? art(`${slot}_eyes`) : null;
  if (tint && !eyesTex) return false;
  // The old picture's masks and lips each own a graphics context, which Pixi keeps for its garbage collector to free a minute later
  // unless it is destroyed with them: a walking figure's mouth changes 20 times a second.
  for (const k of c.removeChildren()) k.destroy({ children: true, context: true });
  const mirror = how.kind === 'whole' ? pose.facing !== 'right' : pose.facing === 'left' && !koBall;
  // The image, and over it while hurt the same image in flat white; the two cut as one where the mouth is.
  const inner = new Container();
  inner.label = 'look_art';
  // A foil ghost's picture is a mesh already standing on its feet, as a sprite anchored there.
  const place = (sp: Sprite | FoilMesh): Container => {
    if (how.kind !== 'ball') {
      // Standing on the feet (size below the body's middle), centred across.
      const span = how.span;
      const k = how.kind === 'whole' && how.by === 'width' ? (span * size) / tex.width : (span * size) / tex.height;
      // An upright figure at UPRIGHT_WIDE, at its own height.
      const kx = how.kind === 'upright' ? (UPRIGHT_WIDE * span * size) / tex.width : k;
      if (sp instanceof Sprite) sp.anchor.set(0.5, 1);
      sp.scale.set(mirror ? -kx : kx, k);
      sp.position.set(0, size);
    } else {
      // A part of the look's own art has its own measurements, under its file's name.
      const fit = LOOK_FIT[artFile(slot)]!;
      const k = size / fit.r;
      sp.scale.set(mirror ? -k : k, k);
      // The circle's middle on the body's middle.
      sp.position.set(mirror ? fit.cx * k : -fit.cx * k, -fit.cy * k);
    }
    return !(sp instanceof Sprite) ? sp : slot === 'looks/tank_wreck' ? clipWreckArtifact(sp)
      : slot === 'looks/tank_battered' ? clipBatteredArtifact(sp) : sp;
  };
  if (how.kind === 'ball' && !LOOK_FIT[artFile(slot)]) return false;
  const foil = tint?.foil === true;
  const picture = foil ? foilGhost(tex) : new Sprite(tex);
  if (tint && picture instanceof Sprite) picture.tint = tint.color;
  const base = place(picture);
  base.label = 'look_art_base';
  if (pose.ko && how.kind !== 'ball' && !stage) base.filters = [grey()];
  inner.addChild(base);
  if (eyesTex) {
    const eyes = place(new Sprite(eyesTex));
    eyes.label = 'ghost_eyes';
    if (pose.ko) eyes.filters = [grey()];
    inner.addChild(eyes);
  }
  // Knocked silly, a picture's eyes are crossed out the way a blink shuts them (the owner, 2026-10-20: "you might be
  // able to X X their eyes in code like you do with the blinks"), in the view it is drawn in.
  const crossed = Boolean(pose.dazed) && !pose.ko;
  if ((pose.blink || crossed) && !pose.ko && !pose.hurt) {
    // The owner, 2026-10-10: occasional natural blinks across the cast. Lids share the picture's placement, so
    // they mirror, roll and follow its mouth mask with it, including alternate art and the tank's driver.
    // A tinted ghost's eyes are where its painted shape's are, and its lids are its own colour.
    const file = tint ? `looks/ghost_${tint.shape}_${view(pose.facing)}` : artFile(slot);
    const lids = new Graphics();
    // A foil ghost's lids are its foil, shown through the skin's shapes over the eyes.
    const skin = foil ? new Graphics() : null;
    for (const eye of LOOK_EYES[file] ?? []) {
      const width = LOOK_INK[file]?.ink ?? eye.ink;
      // The skin over the eye, a little past its painted edge so no outline shows, then the shut lid's line, or an X.
      const over = [eye.cx, eye.cy, eye.rx * 1.12 + width, eye.ry * 1.12 + width] as const;
      if (skin) skin.ellipse(...over).fill(0xffffff);
      else lids.ellipse(...over).fill(tint ? tint.color : eye.lid);
      if (crossed) {
        const sx = eye.rx * .8, sy = eye.ry * .7;
        lids.moveTo(eye.cx - sx, eye.cy - sy).lineTo(eye.cx + sx, eye.cy + sy).moveTo(eye.cx + sx, eye.cy - sy).lineTo(eye.cx - sx, eye.cy + sy)
          .stroke({ width, color: INK, cap: 'round' });
      } else lids.moveTo(eye.cx - eye.rx * .85, eye.cy).quadraticCurveTo(eye.cx, eye.cy + eye.ry * .35, eye.cx + eye.rx * .85, eye.cy).stroke({ width, color: INK, cap: 'round' });
    }
    // Graphics have no sprite anchor. The same pixel origin and scale place the lids over the painted eyes.
    const layer = new Container();
    const anchor = picture instanceof Sprite ? picture.anchor : { x: 0.5, y: 1 };
    layer.scale.copyFrom(picture.scale);
    layer.position.set(picture.x - anchor.x * tex.width * picture.scale.x, picture.y - anchor.y * tex.height * picture.scale.y);
    if (skin) {
      const shown = place(foilGhost(tex, true));
      layer.addChild(skin);
      shown.mask = skin;
      picture.parent!.addChild(shown);
    }
    layer.addChild(lids);
    // On a ball, kept inside its circle: an eye at the edge of a side view would otherwise put a bump on the outline.
    const fit = how.kind === 'ball' ? LOOK_FIT[file] : undefined;
    if (fit) {
      const clip = new Graphics().circle(fit.cx, fit.cy, fit.r * 0.97).fill(0xffffff);
      layer.addChild(clip);
      lids.mask = clip;
    }
    // A cropped picture's wrapper owns its placement, including scale and mirroring.
    picture.parent!.addChild(layer);
  }
  if (pose.hurt) {
    const w = place(new Sprite(tex));
    w.filters = [white()];
    w.alpha = 0.9;
    inner.addChild(w);
  }
  c.addChild(inner);
  if (how.kind !== 'ball' || pose.ko) return true;
  // The mouth's edges, at the picture's outline weight (in its pixels) scaled as the picture is, ending with their
  // round tips at its outer edge where the mouth meets it, so they join the outline rather than poke past it (the
  // owner, 2026-10-14: Olli's "lip ends at the border of the circle and looks connected exactly, like pacman").
  const { ink, reach } = lipLine(artFile(slot), size);
  if (LOOK.has('mouths')) {
    jaw(c, inner, pose, size, ink, reach);
    return true;
  }
  const angle = pose.facing === 'right' ? 0 : pose.facing === 'down' ? Math.PI / 2 : pose.facing === 'left' ? Math.PI : -Math.PI / 2;
  // Narrower than the code drawing's, so the eyes high on the ball stay clear of it; from the side it opens more
  // below than above, like a jaw dropping, for the same reason.
  const m = pose.mouth * 0.6;
  if (m > 0.001) {
    const side = pose.facing === 'left' || pose.facing === 'right';
    const up = side ? m * 0.6 : m;
    const down = side ? m * 1.4 : m;
    const [a0, a1] = pose.facing === 'left' ? [angle - down, angle + up] : [angle - up, angle + down];
    // The mouth: a wedge cut from the ball, as a hole in a mask over everything the image draws.
    const reach = size * 1.05;
    const wedge = [0, 0];
    for (let i = 0; i <= 10; i++) {
      const a = a0 + ((a1 - a0) * i) / 10;
      wedge.push(Math.cos(a) * reach, Math.sin(a) * reach);
    }
    const mask = new Graphics().rect(-size * 4, -size * 4, size * 8, size * 8).fill(0xffffff).poly(wedge).cut();
    inner.mask = mask;
    c.addChild(mask);
    inkEdges(c, [a0, a1].map((a): Edge => [0, 0, Math.cos(a) * reach, Math.sin(a) * reach]), ink, Boolean(pose.hurt));
  }
  return true;
}

/** A mouth edge, from (x0, y0) to (x1, y1). */
export type Edge = [number, number, number, number];

/**
 * A ball picture's lips at a body `size`: their weight, its outline's where the mouth meets it, and how far out their
 * lines run, so their round tips (half the weight further) end on its outer edge there. From `LOOK_INK`, in its pixels,
 * scaled as the picture is.
 */
export function lipLine(file: string, size: number): { ink: number; reach: number } {
  const fit = LOOK_FIT[file]!;
  const mouth = LOOK_INK[file];
  const ink = ((mouth?.ink ?? 0) * size) / fit.r;
  return { ink, reach: ((mouth?.edge ?? fit.r) * size) / fit.r - ink / 2 };
}

/**
 * Inks a mouth's edges `ink` wide; while hurt, whitened as the picture's own outline is by its flash (white over it,
 * at 0.9).
 */
function inkEdges(c: Container, edges: Edge[], ink: number, hurt: boolean): void {
  if (ink <= 0) return;
  const g = new Graphics();
  g.label = 'mouth_ink';
  // The edges traced afresh for each stroke: a second stroke of the same path whitened only one of them.
  const trace = () => {
    for (const [x0, y0, x1, y1] of edges) g.moveTo(x0, y0).lineTo(x1, y1);
  };
  trace();
  g.stroke({ width: ink, color: INK, cap: 'round' });
  if (hurt) {
    trace();
    g.stroke({ width: ink, color: 0xffffff, alpha: 0.9, cap: 'round' });
  }
  c.addChild(g);
}

/**
 * The look's `mouths`: a mouth that keeps the closed-mouth face (the owner's video notes: mouths opened into the
 * eyes of the blue dots, the soldiers, and others). From the side it is a jaw: its upper edge runs level, just below
 * the eyes, out to the front of the ball, and the lower edge drops as it opens, so the wedge never reaches the eyes.
 * From the front it opens downward from below the middle. From behind there is none to see. Its edges are inked `ink`
 * wide, out to `reach` from the middle (`jawEdges`).
 */
function jaw(c: Container, inner: Container, pose: Pose, size: number, ink: number, reach: number): void {
  const shape = jawShape(pose.facing, pose.mouth, size);
  if (!shape) return;
  const mask = new Graphics().rect(-size * 4, -size * 4, size * 8, size * 8).fill(0xffffff).poly(shape.wedge).cut();
  inner.mask = mask;
  c.addChild(mask);
  inkEdges(c, jawEdges(pose.facing, pose.mouth, size, reach), ink, Boolean(pose.hurt));
}

let greyFilter: ColorMatrixFilter | null = null;

/** Grey and a little faded: a whole figure knocked out. */
function grey(): ColorMatrixFilter {
  if (!greyFilter) {
    // As the code drawings grey a figure: the brightness, pressed toward a light grey (0.6 of it, plus 60 of 255).
    // At the screen's density, as the sunlight's grade (src/render/sunlight.ts): a plain filter draws its figure at 1x.
    greyFilter = new ColorMatrixFilter({ resolution: 'inherit' });
    const [r, g, b, o] = [0.299 * 0.6, 0.587 * 0.6, 0.114 * 0.6, 60 / 255];
    greyFilter.matrix = [r, g, b, 0, o, r, g, b, 0, o, r, g, b, 0, o, 0, 0, 0, 1, 0];
  }
  return greyFilter;
}

let whiteFilter: ColorMatrixFilter | null = null;

/** A filter that paints every drawn pixel white, keeping its alpha: a hurt flash. */
function white(): ColorMatrixFilter {
  if (!whiteFilter) {
    whiteFilter = new ColorMatrixFilter({ resolution: 'inherit' });
    whiteFilter.matrix = [0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0];
  }
  return whiteFilter;
}
