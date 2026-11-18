/**
 * The look of the world was sketched in parts that the address could turn off (`?look=`), for the owner to judge: the neon,
 * the rounded ground, the moving water, the local plants, the blend at the border, Berlin as a city, the busier square, the
 * tank's wreck, the Warsaw Pac's rifle, the fight's portraits, the heavier hats and the talking mouths. The owner kept every
 * one (2026-10-02 and 2026-10-03; docs/style_guide.md), and on 2026-11-18 they became simply the game's look, with the
 * switch, the drawing without them and their pictures' older versions taken out.
 */

/**
 * The plants: what grows in place of a palm on each map that has palms. `wet` is for a palm on a tile beside water
 * (diagonals too), `dry` the others, taken in turn. Willows by the water and Chinese pines near Beijing; birches and
 * spruces at the Iron Curtain, in central Europe.
 */
export const PLANTS: Record<string, { wet: string; dry: string[] }> = {
  border: { wet: 'birch', dry: ['spruce', 'birch'] },
};
