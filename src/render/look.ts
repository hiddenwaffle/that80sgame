/**
 * The look of the world, in parts (the owner's video notes of 2026-10-01, "The look of the world, to discuss").
 *
 * The parts the owner kept on 2026-10-02 (after the journey film: "the graphics changes so far look good ... go
 * ahead with those") are on for everyone (`KEPT`):
 *
 * - neon: the arcade with a neon glow, Tron-like and still plainly Pac-Man: walls that bloom and breathe, a faint
 *   grid on the floor, pellets that glow.
 * - edges: the printed ground less blocky, its corners rounded where one kind of ground meets another, the shores
 *   following them; the pagoda's island as a stone island.
 * - water: the water moving, its ripples drifting and glinting.
 * - plants: plants that grow where each map is, in place of palms: willows and pines by Beijing, birches and spruces
 *   at the Iron Curtain.
 * - blend: a gentler change from the arcade at the border, the arcade's grid and a few neon specks running on into
 *   the grass and fading.
 *
 * Nine more were sketched for the owner to react to and kept on 2026-10-03 (after a page of them: "I examined and I
 * think we can move forward with these"):
 *
 * - city: Berlin as a city: East and West Berlin's own buildings, the Wall with depth and with graffiti as the real
 *   one had, and busier streets.
 * - square: Tiananmen Square busier: the students' tents, bicycles, banners, and more students.
 * - wreck: the tank bigger, breaking down in stages through its fight into a burning wreck, which then lies burning
 *   on the grass below its gap; the Warsaw Pac smoking as it weakens.
 * - rifle: the Warsaw Pac with a rifle stuck on it, firing bursts through its fight that never hit, until its
 *   countdown runs out.
 * - portraits: the fight's portraits as close-ups of each member facing right.
 * - heads: the tall hat (the bridge guards' and the grey-hatted man's) drawn with a heavier ink line. (It also showed
 *   figures in hats side-on as they faced down, until every ball rolled, a hat and all, on 2026-10-03.)
 * - mouths: talking mouths that keep the closed-mouth faces.
 *
 * (A tenth, every ghost as wide as a Pac, was dropped the same day, the ghosts having been widened for everyone.)
 * Parts sketched later, for the owner to react to, would go in `SKETCHES`, off unless the address asks for them;
 * since 2026-10-03 the owner would rather a change go straight into the game, shown on a before and after page
 * (the tank and the buildings at the townspeople's scale went in that way, in `src/art/props.ts` and `lookArt.ts`).
 *
 *   ?look=sketch            every sketch as well
 *   ?look=-neon,-city       without some kept parts
 *   ?look=old               none at all: the look before the kept parts (and with `old,city`, only that part)
 */
export type LookPart =
  | 'neon'
  | 'edges'
  | 'water'
  | 'plants'
  | 'blend'
  | 'city'
  | 'square'
  | 'wreck'
  | 'rifle'
  | 'portraits'
  | 'heads'
  | 'mouths';

/** The parts the owner kept, on unless the address turns them off. */
export const KEPT: readonly LookPart[] = ['neon', 'edges', 'water', 'plants', 'blend', 'city', 'square', 'wreck', 'rifle', 'portraits', 'heads', 'mouths'];
/** The parts still for the owner to judge, off unless the address asks. */
export const SKETCHES: readonly LookPart[] = [];
/** Every part, kept or sketched. */
export const LOOK_PARTS: readonly LookPart[] = [...KEPT, ...SKETCHES];

/** The parts on for an address's `look` value (null when there is none). */
export function lookParts(asked: string | null): Set<LookPart> {
  const on = new Set<LookPart>(KEPT);
  if (!asked) return on;
  const all = LOOK_PARTS as readonly string[];
  for (const p of asked.split(',').map((s) => s.trim())) {
    if (p === 'old') on.clear();
    else if (p === 'sketch') SKETCHES.forEach((q) => on.add(q));
    else if (p.startsWith('-') && all.includes(p.slice(1))) on.delete(p.slice(1) as LookPart);
    else if (all.includes(p)) on.add(p as LookPart);
  }
  return on;
}

/** Which parts are on, read once from the address. */
export const LOOK: ReadonlySet<LookPart> = lookParts(typeof location === 'undefined' ? null : new URLSearchParams(location.search).get('look'));

/**
 * The plants: what grows in place of a palm on each map that has palms. `wet` is for a palm on a tile beside water
 * (diagonals too), `dry` the others, taken in turn. Willows by the water and Chinese pines near Beijing; birches and
 * spruces at the Iron Curtain, in central Europe.
 */
export const PLANTS: Record<string, { wet: string; dry: string[] }> = {
  border: { wet: 'birch', dry: ['spruce', 'birch'] },
};

/**
 * Art slots used only with a part on (`plants`), or only with it off (`!plants`): they load only then, so nothing
 * unused is downloaded. A part's own art, for the parts first made as sketches, lives under `images/look/<part>/`,
 * as the slot it fills or adds (`look/city/props/block_east` is the slot `props/block_east`, with `city` on); see
 * `images.ts`.
 */
export const SLOT_LOOK: Record<string, LookPart | `!${LookPart}`> = {
  'props/palm': '!plants',
  'props/willow': 'plants',
  'scenery/border/props/birch': 'plants',
  'scenery/border/props/spruce': 'plants',
};

/**
 * Prop kinds that belong to a part of the look first made as a sketch: their art is only that part's, so a map object
 * of such a kind must name the part (`sketch`), or it would stand with the part off too, drawn only in code (the
 * content check holds to this).
 */
export const SKETCH_KINDS: Record<string, LookPart> = {
  banner: 'square',
  bicycle: 'square',
  statue: 'square',
  tank_wreck: 'wreck',
};

/**
 * Where a file under `images/` goes, given the parts on: its slot, or null when it is not to be loaded. A part's own
 * file (`look/<part>/<slot>`) fills its slot with that part on, and is skipped otherwise; a plain file is skipped
 * when a part on has its own file for the same slot (`sketchSlots`), or when `SLOT_LOOK` says so.
 */
export function slotFor(file: string, on: ReadonlySet<LookPart>, sketchSlots: ReadonlySet<string>): string | null {
  const m = /^look\/([a-z]+)\/(.+)$/.exec(file);
  if (m) return on.has(m[1] as LookPart) ? m[2]! : null;
  if (sketchSlots.has(file)) return null;
  if (file.startsWith('scenery/berlin/') && !on.has('city')) return null;
  const rule = SLOT_LOOK[file];
  if (rule && (rule.startsWith('!') ? on.has(rule.slice(1) as LookPart) : !on.has(rule as LookPart))) return null;
  return file;
}
