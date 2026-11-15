/**
 * The ninjas' lesson on the martial arts street (src/world/kujiKiri.ts): its beat, in early-nineties hip-hop's drum
 * machine and orchestra hits (the owner, 2026-11-07: "instrumentation that reminds people of Vanilla Ice's Ninja Rap"),
 * and where in it the nine cuts fall, shared by the sound and the picture.
 */
export const NINJA_BPM = 104;
export const NINJA_BEAT = 60 / NINJA_BPM;
/** A bar of the groove, then the nine cuts on the eighths of the next, the ninth on the third bar's downbeat. */
export const CUT_FROM = 4;
export const CUT_STEP = 0.5;
export const CUTS = 9;
/** The last cut: the big hit, the grid flashing and the panel in. */
export const CUT_LAST = CUT_FROM + CUT_STEP * (CUTS - 1);
/** Beats from the start until the light is back up and the ninjas go; the gong rings on a little past it. */
export const NINJA_BEATS = CUT_LAST + 3;
