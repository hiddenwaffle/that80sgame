import { Container, Graphics, type Sprite } from 'pixi.js';

/** The battered tank's lower-right margin contains a fragment of the next sprite. Keep its barrel above the notch. */
export function clipBatteredArtifact(sprite: Sprite): Container {
  const { width: w, height: h } = sprite.texture;
  const x = -w * sprite.anchor.x, y = -h * sprite.anchor.y;
  return clipSprite(sprite, [
    x, y, x + w, y, x + w, y + h * .5,
    x + w * .94, y + h * .5, x + w * .94, y + h, x, y + h,
  ]);
}

/**
 * The placeholder wreck PNG has a detached muzzle fragment in its empty upper-left corner.
 * Clip that corner for both the KO actor and its scenery replacement until the art is polished.
 * The tank itself begins farther right here and fills the whole width only below the cutout.
 */
export function clipWreckArtifact(sprite: Sprite): Container {
  const { width: w, height: h } = sprite.texture;
  const x = -w * sprite.anchor.x, y = -h * sprite.anchor.y;
  return clipSprite(sprite, [
    x + w * .065, y, x + w, y, x + w, y + h,
    x, y + h, x, y + h * .4, x + w * .065, y + h * .4,
  ]);
}

function clipSprite(sprite: Sprite, points: number[]): Container {
  const mask = new Graphics().poly(points).fill(0xffffff);
  const view = new Container();
  view.position.copyFrom(sprite.position);
  view.scale.copyFrom(sprite.scale);
  sprite.position.set(0, 0);
  sprite.scale.set(1, 1);
  view.addChild(sprite, mask);
  sprite.mask = mask;
  return view;
}
