/**
 * Where on the audio clock a typing chirp starts (Audio.blip). Each used to start at the clock's "now", and a browser's audio
 * clock moves in steps: on a slow phone, whose frames each type several letters at once and whose clock jumps by tens of
 * milliseconds, the chirps came broken up, now bunched and now apart. A Galaxy A10 in Chrome and Brave sounded "broken up and
 * weird", where the same chirps evenly spaced sounded as on an iPhone (the owner, 15 Nov, with a page that played both).
 *
 * Now each follows the last by the game time between their letters, on a grid the clock cannot overtake: a chirp the clock
 * has already passed starts at once and moves the grid later by as much, so the next keep their spacing. A grid far from the
 * clock (a paused game, a hidden tab, a new audio context) starts again at now.
 */
export interface BlipGrid {
  /** The game time of a letter on the grid, and where its chirp is on the audio clock. */
  game: number;
  audio: number;
}

/** How soon after the clock's now a chirp can start, as before. */
export const BLIP_SOONEST = 0.002;
/** How far ahead of the clock, or behind it, the grid may be before it starts again at now. */
export const BLIP_AHEAD = 0.1;
export const BLIP_BEHIND = 0.25;

/** Where the chirp of a letter typed at game time `at` starts, with the audio clock at `now`, and the grid for the next. */
export function placeBlip(grid: BlipGrid | null, now: number, at: number): { start: number; grid: BlipGrid } {
  const soonest = now + BLIP_SOONEST;
  if (grid && Number.isFinite(at)) {
    const spaced = grid.audio + (at - grid.game);
    if (spaced < now + BLIP_AHEAD && spaced > now - BLIP_BEHIND) {
      if (spaced >= soonest) return { start: spaced, grid };
      return { start: soonest, grid: { game: grid.game, audio: grid.audio + (soonest - spaced) } };
    }
  }
  return { start: soonest, grid: { game: Number.isFinite(at) ? at : 0, audio: soonest } };
}
