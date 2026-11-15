/**
 * The fight music for Beijing's street patrols (2026-10-12; the tank has fought to the boss music since 2026-10-18). The owner named Paul Hertzog's "Fight to
 * Survive" for the feel, an 80s action-film score; every note here is original. Sixteen bars of E minor at 132 bpm,
 * the chords going round E minor, C, D and B a bar each: four bars of brass stabs on a dotted figure, eight of a gliding
 * lead, then four of a syncopated pulse tune in the manner of an 80s console action game, each of its bars opening
 * da-da-DAA (the rhythm of a crowd's chant, which the owner heard first and swapped for the tune).
 */

export const KUMITE_BPM = 132;
export const KUMITE_BARS = 16;

/** A note: its bar (from 1), first step, length in steps, and name. */
export type Placed = readonly [bar: number, step: number, len: number, note: string];

/** One chord a bar, round and round. */
export const KUMITE_CHORDS = ['E', 'C', 'D', 'B'] as const;
export type KumiteChord = (typeof KUMITE_CHORDS)[number];
export const chordOfBar = (bar: number): KumiteChord => KUMITE_CHORDS[(bar - 1) % KUMITE_CHORDS.length]!;

/** The bass's note for each chord; it pumps eighths, jumping up an octave on the fourth and seventh. */
export const KUMITE_ROOTS: Record<KumiteChord, string> = { E: 'E2', C: 'C2', D: 'D2', B: 'B1' };
export const KUMITE_BASS_UP: readonly boolean[] = [false, false, false, true, false, false, true, false];

/** The brass's chord for each, from E4 up. */
export const KUMITE_TRIADS: Record<KumiteChord, readonly string[]> = {
  E: ['E4', 'G4', 'B4'], C: ['E4', 'G4', 'C5'], D: ['D4', 'F#4', 'A4'], B: ['D#4', 'F#4', 'B4'],
};

/** The bars of brass stabs that open the loop, and the steps of their dotted figure. */
export const KUMITE_INTRO_BARS = 4;
export const KUMITE_STABS: readonly number[] = [0, 3, 6];

/** The kick's steps in every bar; the snare is on the backbeat. Bars ending in a fill: toms down, snare rolling up. */
export const KUMITE_KICKS: readonly number[] = [0, 6, 8];
export const KUMITE_FILLS: readonly number[] = [12, 16];

/** The gliding lead, bars 5 to 12. */
export const KUMITE_LEAD: readonly Placed[] = [
  [5, 0, 4, 'B4'], [5, 4, 4, 'E5'], [5, 8, 2, 'F#5'], [5, 10, 2, 'G5'], [5, 12, 2, 'F#5'], [5, 14, 2, 'E5'],
  [6, 0, 6, 'G5'], [6, 6, 2, 'E5'], [6, 8, 4, 'C5'], [6, 12, 2, 'E5'], [6, 14, 2, 'G5'],
  [7, 0, 6, 'A5'], [7, 6, 2, 'G5'], [7, 8, 4, 'F#5'], [7, 12, 2, 'D5'], [7, 14, 2, 'E5'],
  [8, 0, 8, 'F#5'], [8, 8, 4, 'D#5'], [8, 12, 4, 'B4'],
  [9, 0, 4, 'B4'], [9, 4, 4, 'E5'], [9, 8, 4, 'G5'], [9, 12, 4, 'B5'],
  [10, 0, 4, 'C6'], [10, 4, 4, 'B5'], [10, 8, 4, 'G5'], [10, 12, 4, 'E5'],
  [11, 0, 4, 'D5'], [11, 4, 4, 'F#5'], [11, 8, 4, 'A5'], [11, 12, 2, 'F#5'], [11, 14, 2, 'D5'],
  [12, 0, 8, 'B4'],
];

/** The pulse tune: a pickup at the end of the lead's last bar, then bars 13 to 16. */
export const KUMITE_BOP: readonly Placed[] = [
  [12, 8, 1, 'B4'], [12, 10, 1, 'B4'], [12, 12, 1, 'D#5'], [12, 13, 1, 'F#5'], [12, 14, 2, 'B5'],
  [13, 0, 1, 'E5'], [13, 2, 1, 'E5'], [13, 4, 3, 'G5'], [13, 7, 1, 'F#5'], [13, 8, 2, 'E5'], [13, 10, 2, 'B4'], [13, 12, 1, 'D5'], [13, 13, 1, 'E5'], [13, 14, 2, 'G5'],
  [14, 0, 1, 'G5'], [14, 2, 1, 'G5'], [14, 4, 3, 'E5'], [14, 7, 1, 'G5'], [14, 8, 2, 'C6'], [14, 10, 2, 'B5'], [14, 12, 2, 'G5'], [14, 14, 2, 'E5'],
  [15, 0, 1, 'F#5'], [15, 2, 1, 'F#5'], [15, 4, 3, 'A5'], [15, 7, 1, 'G5'], [15, 8, 2, 'F#5'], [15, 10, 2, 'D5'], [15, 12, 1, 'E5'], [15, 13, 1, 'F#5'], [15, 14, 2, 'A5'],
  [16, 0, 1, 'B5'], [16, 2, 1, 'B5'], [16, 4, 3, 'A5'], [16, 7, 1, 'G5'], [16, 8, 2, 'F#5'], [16, 10, 2, 'D#5'], [16, 12, 4, 'B4'],
];

const bars = (fill: (bar: number, row: string[]) => void) =>
  Array.from({ length: KUMITE_BARS }, (_, i) => {
    const row = Array<string>(16).fill('.');
    fill(i + 1, row);
    return row.join(' ');
  }).join(' ');

/**
 * The tune as the first draft plays it (and the other styles arrange it): the top of the brass stabs through the
 * intro, then the lead and the pulse tune, each note on its first step.
 */
export function kumiteLeadRow(): string {
  const notes = [...KUMITE_LEAD, ...KUMITE_BOP];
  return bars((bar, row) => {
    if (bar <= KUMITE_INTRO_BARS) for (const s of KUMITE_STABS) row[s] = KUMITE_TRIADS[chordOfBar(bar)].at(-1)!;
    for (const [b, s, , n] of notes) if (b === bar) row[s] = n;
  });
}

/** The bass as the first draft plays it: the same eighths. */
export function kumiteBassRow(): string {
  return bars((bar, row) => {
    const root = KUMITE_ROOTS[chordOfBar(bar)];
    const up = `${root.slice(0, -1)}${Number(root.slice(-1)) + 1}`;
    KUMITE_BASS_UP.forEach((u, i) => (row[i * 2] = u ? up : root));
  });
}

/** The drums as the first draft plays them: kicks ("x"), the backbeat and the fills' snare roll ("o"). */
export function kumiteDrumRow(): string {
  return bars((bar, row) => {
    for (const s of KUMITE_KICKS) row[s] = 'x';
    row[4] = 'o';
    if (KUMITE_FILLS.includes(bar)) for (const s of [10, 12, 13, 14, 15]) row[s] = 'o';
    else row[12] = 'o';
  });
}
