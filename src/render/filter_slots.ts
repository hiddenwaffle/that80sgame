import { Texture, type FilterSystem } from 'pixi.js';

/**
 * Makes Pixi's filter system forget a pooled texture it last drew into, before the texture is destroyed; false when a filter is
 * drawing into it now, and then it must not be destroyed. Pixi 8.20.1 keeps a slot for each depth of filters inside filters
 * (FilterSystem's `_filterStack`), and a slot keeps its last input texture after the filter is done: `pop` gives the texture back
 * to TexturePool but leaves it in the slot. When a filter starts inside another, `push` takes the slot and then reads the slot's
 * own leftover texture for a resolution (`_findFilterResolution` looks at `_filterStackIndex - 1`, which is by then the new slot).
 * A destroyed leftover threw "Cannot read properties of null (reading '_resolution')", which stops that frame's drawing part way
 * and leaves the stack off afterwards, so the next page's picture of the map failed too (novice phone study, 11 Nov 2026: once in
 * 800 runs, on the Pixel's screen after the Warsaw Pac was beaten; a newspaper page lets go of the textures it drew into when it
 * closes). An empty slot reads the screen's resolution, as a slot used for the first time does.
 *
 * The filter system also keeps one bind group for every filter it draws (`_globalFilterBindGroup`), with the last input's source at 1
 * and its style at 2, and leaves them there after the frame. Destroying that texture prints "a 'textureSource' was destroyed while
 * still bound to a shader", and the same for its 'textureSampler' (the style): once for the source and once for the sampler, on a
 * phone's screen, when the last filter drawn had drawn from a texture a newspaper page then destroyed. Pixi empties the entry itself
 * and every filter sets both again before it draws, so only the console was affected, but Pixi stops printing after 500 warnings and
 * a repeating one can hide real ones. Whatever of this texture the group holds is bound to the empty texture's, which is never
 * destroyed, so destroying it afterwards is quiet. See docs/pixi_dependencies.md, section 5.
 */
export function forgetFilterInput(filters: FilterSystem, texture: Texture): boolean {
  const f = filters as unknown as { _filterStack: Array<{ inputTexture: Texture | null }>; _filterStackIndex: number };
  for (let i = 0; i < f._filterStackIndex; i++) if (f._filterStack[i]!.inputTexture === texture) return false;
  for (let i = f._filterStackIndex; i < f._filterStack.length; i++) if (f._filterStack[i]!.inputTexture === texture) f._filterStack[i]!.inputTexture = null;
  const shared = (filters as unknown as { _globalFilterBindGroup?: { resources: Record<string, unknown>; setResource(resource: unknown, index: number): void } })._globalFilterBindGroup;
  if (shared) for (const [i, r] of Object.entries(shared.resources)) {
    if (r === texture.source) shared.setResource(Texture.EMPTY.source, Number(i));
    else if (r === texture.source.style) shared.setResource(Texture.EMPTY.source.style, Number(i));
  }
  return true;
}
