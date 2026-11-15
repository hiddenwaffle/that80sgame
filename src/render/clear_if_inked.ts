import type { Graphics } from 'pixi.js';

/**
 * `g.clear()` unless `g` already holds nothing. Pixi 8 treats every clear() as a change to the Graphics, even of an empty one,
 * and a change to a Graphics rebuilds the whole stage's draw list for that frame. An empty Graphics draws nothing, so leaving
 * it alone changes no pixel. Used for the layers a screen clears every frame whether or not it drew anything.
 */
export function clearIfInked(g: Graphics): Graphics {
  // The path being built (moveTo, lineTo and no stroke yet) counts as held, so an unfinished drawing is still cleared.
  const c = g.context as unknown as { instructions: unknown[]; _activePath?: { instructions: unknown[] } };
  if (c.instructions.length || c._activePath?.instructions.length) g.clear();
  return g;
}
