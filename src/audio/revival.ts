/**
 * The first choir: played live (audio.ts) until the rendered effect is ready, the draft's, and so the level the game
 * plays Revival at (forGame.ts gameLevel). The game's own Revival builds on it (synth/revivalCue.ts).
 */
export const REVIVAL_FORMANTS = [800, 1150, 2800] as const;
export const REVIVAL_VOICES = [261.63, 329.63, 392, 523.25].flatMap((freq, i) =>
  [-1, 1].map(side => ({
    wave: 'saw' as const, freq: freq * 2 ** (side * 4 / 1200), at: i * 0.045,
    hold: 0.72, gain: 0.075, a: 0.12, d: 0.2, s: 0.8, r: 0.38,
    formants: REVIVAL_FORMANTS, fq: 5,
  })),
);
