// The game-over sound (src/audio/synth/sfx.ts, 'game_over') and the defeat page that waits for it (src/game/game.ts) share
// this timing, so the page comes in once the sound has played out. No imports: the sound worker loads it too.

/** The game-over sound: seven notes this far apart, the last held this long and echoed this much later. */
export const GAME_OVER_STEP = 0.183, GAME_OVER_LAST = 0.6, GAME_OVER_ECHO = 0.09;

/** How long the game-over sound lasts, to the end of its last note's echo. */
export const GAME_OVER_S = 6 * GAME_OVER_STEP + GAME_OVER_ECHO + GAME_OVER_LAST;
