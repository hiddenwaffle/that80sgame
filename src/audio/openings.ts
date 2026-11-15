/** A long track's opening pieces (see `OPENINGS`). */
export interface Opening {
  /** Each piece's length, in seconds from the loop's start, shortest first. */
  pieces: readonly number[];
  /** The loop's first seconds, which carry its end's folded tail. */
  seam: number;
  /** The whole loop's loudness (LUFS) and peak before its gain, and the game's level for the track (LUFS). */
  integrated: number;
  peak: number;
  level: number;
}

/**
 * Tracks whose Console loop takes long enough to render that the game first plays pieces of its opening (2026-10-13;
 * the owner: "What if you split the songs up? So that the first ~20 seconds is one piece that renders fast(er) and can
 * play while rendering the rest?"). Each piece is the loop's first `pieces` seconds, rendered by the same code stopped
 * there, so it matches the loop sample for sample, except in the loop's first `seam` seconds, which carry its end's
 * folded tail: a piece hands over to the loop only past them. The loop's loudness and peak, and the game's level for the
 * track (synth/forGame.ts `gameLevel`), are kept here so that a piece and the loop get the same gain, which `normalize`
 * would otherwise work out from the whole loop, and so that the first piece need not first measure the track's whole
 * first draft (a test renders both to keep them true). Beijing's loop takes about 4 s on a fast desktop core, its 5 s
 * piece under a tenth of that. Data only, so the page can read it without loading the synthesizer.
 */
export const OPENINGS: Record<string, Opening> = {
  field: { pieces: [5, 30], seam: 5, integrated: -12.8415, peak: 1.670569, level: -27.3213 },
};

/** The bridge's two channels have their own measured gains in synth/bridge.ts. Both opening channels render together. */
const BRIDGE_OPENING = { pieces: [5, 15], seam: 5 };
/** Berlin's approved fixed gains live in synth/berlin.ts. Its end's folded tail is gone by this seam. */
const BERLIN_OPENING = { pieces: [5, 15], seam: 5 };
export const openingFor = (name: string): Pick<Opening, 'pieces' | 'seam'> | undefined =>
  name === 'border' ? BRIDGE_OPENING : name === 'berlin' ? BERLIN_OPENING : OPENINGS[name];
