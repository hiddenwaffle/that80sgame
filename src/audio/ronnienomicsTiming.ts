// Ronnienomics!'s sounds (src/audio/synth/sfx.ts) and what they are timed to (src/battle/battleUi.ts smokeBomb and
// escapeFailed, src/battle/battle.ts escape) share this timing. No imports: the sound worker loads it too.

/**
 * The failure's sting: a bar of 4/4 at this tempo, its last note held on to `STING_HOLD` beats and then wound down over
 * `STING_STOP` beats, `STING_S` seconds in all.
 */
export const STING_BPM = 118;
export const STING_BEAT = 60 / STING_BPM;
export const STING_HOLD = 4.5, STING_STOP = 0.75;
export const STING_S = (STING_HOLD + STING_STOP) * STING_BEAT;

/**
 * The getaway: the party vanishes once the cloud is whole, and it thins for `VANISH_THIN` seconds before the flashback's
 * blocks start. The warp out from their vanishing is over in `VANISH_S`, before the blocks (the owner, 2026-11-07, of
 * one that ran on until they were at their biggest: "odd to hear while the pixlation has gotten really fuzzy").
 */
export const VANISH_THIN = 0.7;
export const VANISH_S = 0.55;
