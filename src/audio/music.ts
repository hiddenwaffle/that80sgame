import { BEIJING_BPM, draftBassRow, draftDrumRow, draftLeadRow } from './beijingScore.ts';
import { KUMITE_BPM, kumiteBassRow, kumiteDrumRow, kumiteLeadRow } from './kumiteScore.ts';

/**
 * Original chip music, one track per place. Each channel is a
 * row of sixteenth notes written as note names ("C4", "F#3"), "." for a rest,
 * "-" to hold the note before for another step, and drum hits on the noise channel (`DRUM_HITS`).
 */

/** A lead note's own shape over its written length (synth/score.ts), written in a row as "B4@linger". */
export type NoteShape = 'linger' | 'fade' | 'answer';

export interface Channel {
  wave: OscillatorType | 'noise';
  volume: number;
  /** Note length in steps. */
  length?: number;
  notes: Array<number | null>;
  /** A held note's own length in steps, at its step (a note followed by "-" marks); the others play `length`. */
  lengths?: Array<number | undefined>;
  /** A note's own shape, at its step. */
  shapes?: Array<NoteShape | undefined>;
}

/** How many steps the note at step `i` of a channel's row plays. */
export const lengthAt = (ch: Channel, i: number): number => ch.lengths?.[i] ?? ch.length ?? 1;

/** Which of the four parts' arrangements a layer plays (see synth/score.ts), or null where it is left out. */
export type Part = 0 | 1 | 2 | 3 | null;

/** A section of a track with its own form: how many bars it lasts, and the part each layer plays in it. */
export interface Section {
  bars: number;
  lead: Part;
  bass: Part;
  harmony: Part;
  drums: Part;
  /** How loud a layer plays in this section, against its part's usual level. */
  level?: Partial<Record<'lead' | 'bass' | 'drums', number>>;
}

export interface Track {
  bpm: number;
  channels: Channel[];
  /**
   * The track as one whole song, its sections in order, every channel running the whole of it. Without a form the
   * arrangements build a track up over four passes of its tune.
   */
  form?: Section[];
  /**
   * The stretches of the whole loop to play, in this order, in sixteenth steps from its start (each from its first step
   * up to, not including, its last): the loop becomes those stretches back to back, every note and part as it was
   * there, so a track can skip ahead without changing what it plays where it does play.
   */
  order?: Array<[number, number]>;
  /**
   * For a track without a form, the parts its four passes play where they differ from the usual build-up (pass n plays
   * part n - 1 on every layer): null leaves a layer out of that pass.
   */
  passes?: Array<Partial<Record<'lead' | 'bass' | 'harmony' | 'drums', Part>>>;
  /**
   * Where the half bars of harmony begin, for a track whose bar lines are not on steps counted in eights from its top:
   * eight steps each from each of `from`, the last before the next cut short there. `tones` sets a half bar's chord (Hz,
   * by its first step) where the notes it would be worked out from are no longer there.
   */
  halfBars?: { from: number[]; tones?: Record<number, number[]> };
  /**
   * The step the track goes round to, for one that opens differently from how it returns: it plays from its top once,
   * then from here to its end over and over. Its loop must be whole samples long and its last notes those before this
   * step, so that the join is the same samples as its first time past here. Without it, it goes round to its top.
   */
  loopFrom?: number;
  /**
   * How the Console band plays a bass note of one or two steps in the full parts (`bassEchoes` in score.ts): 'echo', the
   * default, follows the note with its octave half a note later; 'step' gives a two-step note that echo but keeps a
   * one-step note on its own step, every other one an octave up (the maze fights' bass, the owner's pick, 2026-11-01).
   */
  quickBass?: 'echo' | 'step';
  /**
   * For a track whose lead leads its bars (town's, 2026-11-01): how many steps before the bar its tune begins. The tune's
   * first notes are a pickup, written at the end of the pass before, and each pickup note belongs to the pass it leads
   * into, for its part and for the harmony worked out under it. Bars are counted from this many steps in: the track
   * opens on the first pickup alone and goes round (`loopFrom`) from the first note of the first bar.
   */
  pickup?: number;
}

/** The step of its rows a track has reached `step` steps in, past its end going round from its `loopFrom`. */
export function stepInLoop(t: Track, step: number): number {
  if (t.loopFrom === undefined) return step;
  const total = t.channels[0]!.notes.length;
  return step < total ? step : t.loopFrom + ((step - t.loopFrom) % (total - t.loopFrom));
}

const NOTE: Record<string, number> = { C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5, 'F#': 6, G: 7, 'G#': 8, A: 9, 'A#': 10, B: 11 };

function freq(n: string): number {
  const m = /^([A-G]#?)(-?\d)$/.exec(n);
  if (!m) throw new Error(`Bad note ${n}`);
  const semis = NOTE[m[1]!]! + (Number(m[2]) + 1) * 12;
  return 440 * 2 ** ((semis - 69) / 12);
}

/**
 * The value each drum token puts in a noise channel's row. The first draft (synth/draft.ts), and the notes the game
 * plays while a loop renders, hiss each through a low-pass at that many Hz; the Console arrangement reads its drum from
 * it (synth/score.ts): "x" is a kick on a beat and a closed hat off one, "o" a snare, and (2026-10-13, the maze's new
 * percussion) "k" a kick on any step, "t" a tom, "c" a crash over a kick. The last three sit just above "x", so the
 * draft hisses them as it does "x".
 */
export const DRUM_HITS = { x: 7000, o: 1800, k: 7001, t: 7002, c: 7003 } as const;

function row(s: string): Pick<Channel, 'notes' | 'lengths' | 'shapes'> {
  const notes: Array<number | null> = [];
  const lengths: Array<number | undefined> = [];
  const shapes: Array<NoteShape | undefined> = [];
  let held = -1;
  for (const token of s.trim().split(/\s+/)) {
    const [t, shape] = token.split('@') as [string, NoteShape | undefined];
    if (shape) shapes[notes.length] = shape;
    if (t === '-') {
      if (held < 0) throw new Error(`A "-" with no note before it, at step ${notes.length}`);
      lengths[held] = (lengths[held] ?? 1) + 1;
      notes.push(null);
      continue;
    }
    const hit = Object.hasOwn(DRUM_HITS, t) ? DRUM_HITS[t as keyof typeof DRUM_HITS] : null;
    const n = t === '.' ? null : (hit ?? freq(t));
    held = n === null || hit !== null ? -1 : notes.length;
    notes.push(n);
  }
  return { notes, ...(lengths.length ? { lengths } : {}), ...(shapes.length ? { shapes } : {}) };
}

const ch = (wave: Channel['wave'], volume: number, notes: string, length = 1): Channel => ({ wave, volume, length, ...row(notes) });

/**
 * The maze extended on 2026-10-13 from 16 bars (25.6 s) to 60 (96 s), as a rondo: the tune as written in bars 1-8, 21-24
 * and 41-44, between a second theme in C, a call and answer, a counter-line, a breather and the tune in double time.
 * Not a track since 2026-10-14: after a fight the game plays a stretch of it, then the maze's loop (`TRACKS.maze`,
 * intros.ts), which since 2026-10-26 is built from its bars 1-8 and 33-40 with a new breakdown (`mazeLoop`).
 */
export const MAZE_RONDO: Track = {
  bpm: 150,
  channels: [
    ch('square', 0.08, [
      // theme, bare (current bars 1-4)
      'A4 . C5 . E5 . A4 . G#4 . B4 . E5 . G#4 . A4 . C5 . E5 . A5 . G5 . E5 . C5 . B4 . F4 . A4 . C5 . F4 . E4 . G#4 . B4 . E4 . A4 . . . E5 . . . A4 . . . . . . .',
      // theme, full (current bars 5-8)
      'A4 . C5 . E5 . A4 . G#4 . B4 . E5 . G#4 . A4 . C5 . E5 . A5 . G5 . E5 . C5 . B4 . F4 . A4 . C5 . F4 . E4 . G#4 . B4 . E4 . A4 . . . E5 . . . A4 . . . . . . .',
      // second theme in C major
      'G4 . C5 - - - E5 . G5 - - - E5 - D5 . D5 - - - B4 . G4 . A4 - - - B4 - D5 . C5 - - - E5 . A5 . G5 - - - E5 - C5 . F5 - - - C5 . A4 . B4 - - - D5 - G5 . G4 . C5 - - - E5 . C6 - - - A5 - G5 . B5 - - - G5 . D5 . E5 - - - G5 - B5 . A5 - - - - - F5 . C6 - - - A5 - F5 . G5 - - - - - - . D5 - - . B4 - - .',
      // second theme turns to A minor
      'E4 . A4 - - - C5 . E5 - - - C5 - A4 . F5 - - - D5 . A4 . B4 - - - G#4 - E4 . A4 . C5 - - - F5 . A5 - - - F5 - D5 . G#5 - - - E5 . B4 . D5 - - - B4 - G#4 .',
      // theme with echo (current bars 9-12)
      'A4 . C5 . E5 . A4 . G#4 . B4 . E5 . G#4 . A4 . C5 . E5 . A5 . G5 . E5 . C5 . B4 . F4 . A4 . C5 . F4 . E4 . G#4 . B4 . E4 . A4 . . . E5 . . . A4 . . . . . . .',
      // call and answer
      'D5 E5 F5 . A5 - - . . . . . . . . . C5 B4 A4 . E5 - - . . . . . . . . . F5 G5 A5 . C6 - - . . . . . . . . . B4 D5 E5 . G#5 - - . . . . . . . . . . . . . . . . . A5 G5 F5 . C5 - - . . . . . . . . . B5 A5 G5 . D5 - - . A5 G5 E5 . C5 - - . B4 A4 G#4 . E4 - - . G#4 A4 B4 . D5 - - . E5 F#5 G#5 . B5 - - .',
      // counter-line
      'E5 - - - - - C5 - B4 - - - - - G#4 - A4 - - - C5 - - - B4 - - - E5 - - - A5 - - - - - C6 - B5 - - - G#5 - E5 - A5 - - - F5 - - - E5 - - - D5 - B4 - C5 - - - - - E5 - D5 - - - B4 - E5 - F5 - - - A5 - - - G#5 - - - B5 - - - E5 - A5 - C6 - - - D6 - - - B5 - - - C6 - - - A5 - - - G#5 - - - E5 - B4 -',
      // theme return (as today's bars 5-8)
      'A4 . C5 . E5 . A4 . G#4 . B4 . E5 . G#4 . A4 . C5 . E5 . A5 . G5 . E5 . C5 . B4 . F4 . A4 . C5 . F4 . E4 . G#4 . B4 . E4 . A4 . . . E5 . . . A4 . . . . . . .',
      // breather
      'A4 - - - - - - - C5 - - - F5 - - - E5 - - - - - - - D5 - - - C5 - - - F5 - - - - - - - A5 - - - F5 - - - E5 - - - - - D5 - B4 - - - G#4 - - - A4 - - - - - C5 - D5 - - - - - B4 - E5 - - - - - G5 - C5 - - - - - A4 - A4 - - - - - F4 - G#4 - - - - - B4 - E5 - - - - - - - - - - - D5 - B4 -',
      // chase (theme in double time)
      'A4 C5 E5 A4 G#4 B4 E5 G#4 A4 C5 E5 A5 G5 E5 C5 B4 D5 F5 A5 D5 C#5 E5 A5 C#5 D5 - F5 - E5 . . . E4 G#4 B4 E5 F4 A4 C5 F5 G#4 B4 E5 G#5 A4 C5 E5 A5 G#5 B5 D6 - - - B5 - G#5 - - - E5 . B4 .',
      // lead-in
      'D5 - . . F5 - . . E5 - . . C5 - . . A4 - . . C5 - . . B4 - . . G#4 - . . A5 - . . F5 - . . E5 - . . C5 - . . F5 - . . C5 - . . B4 - . . G#4 - . .',
    ].join(' '), 1),
    ch('triangle', 0.22, [
      // theme, bare (current bars 1-4)
      'A2 A2 . A2 . A2 . . E2 E2 . E2 . E2 . . F2 F2 . F2 . F2 . . E2 E2 . E2 . G#2 . . A2 A2 . A2 . A2 . . E2 E2 . E2 . E2 . . F2 F2 . F2 . F2 . . E2 E2 . E2 . G#2 . .',
      // theme, full (current bars 5-8)
      'A2 A2 . A2 . A2 . . E2 E2 . E2 . E2 . . F2 F2 . F2 . F2 . . E2 E2 . E2 . G#2 . . A2 A2 . A2 . A2 . . E2 E2 . E2 . E2 . . F2 F2 . F2 . F2 . . E2 E2 . E2 . G#2 . .',
      // second theme in C major
      'C3 - C3 - C3 - C3 - C3 - C3 - C3 - C3 - G2 - G2 - G2 - G2 - G2 - G2 - G2 - G2 - A2 - A2 - A2 - A2 - A2 - A2 - A2 - A2 - F2 - F2 - F2 - F2 - G2 - G2 - G2 - G2 - C3 - C3 - C3 - C3 - C3 - C3 - C3 - C3 - G2 - G2 - G2 - G2 - E2 - E2 - E2 - E2 - F2 - F2 - F2 - F2 - F2 - F2 - F2 - F2 - G2 - G2 - G2 - G2 - G2 - G2 - G2 - G2 -',
      // second theme turns to A minor
      'A2 - A2 - A2 - A2 - A2 - A2 - A2 - A2 - D2 - D2 - D2 - D2 - E2 - E2 - E2 - E2 - F2 - F2 - F2 - F2 - D2 - D2 - D2 - D2 - E2 - E2 - E2 - E2 - E2 - E2 - G#2 - B2 -',
      // theme with echo (current bars 9-12)
      'A2 A2 . A2 . A2 . . E2 E2 . E2 . E2 . . F2 F2 . F2 . F2 . . E2 E2 . E2 . G#2 . . A2 A2 . A2 . A2 . . E2 E2 . E2 . E2 . . F2 F2 . F2 . F2 . . E2 E2 . E2 . G#2 . .',
      // call and answer
      'D2 - - - - - - . A2 G2 F2 . D2 - - . A1 - - - - - - . C2 D2 E2 . A1 - - . D2 - - - - - - . C3 A2 F2 . D2 - - . E2 - - - - - - . B2 A2 G#2 . E2 - - . F2 G2 A2 . C3 - - . F2 - - - - - - . G1 A1 B1 . D2 - - . G1 - - - - - - . A1 B1 C2 . E2 - - . E1 F#1 G#1 . B1 - - . E2 E2 . E2 . E2 . . E2 E2 . E2 . G#2 . .',
      // counter-line
      'A2 A2 . A2 . A2 . . E2 E2 . E2 . E2 . . F2 F2 . F2 . F2 . . E2 E2 . E2 . G#2 . . A2 A2 . A2 . A2 . . E2 E2 . E2 . E2 . . F2 F2 . F2 . F2 . . E2 E2 . E2 . G#2 . . A2 A2 . A2 . A2 . . E2 E2 . E2 . E2 . . F2 F2 . F2 . F2 . . E2 E2 . E2 . G#2 . . A2 A2 . A2 . A2 . . E2 E2 . E2 . E2 . . F2 F2 . F2 . F2 . . E2 E2 . E2 . G#2 . .',
      // theme return (as today's bars 5-8)
      'A2 A2 . A2 . A2 . . E2 E2 . E2 . E2 . . F2 F2 . F2 . F2 . . E2 E2 . E2 . G#2 . . A2 A2 . A2 . A2 . . E2 E2 . E2 . E2 . . F2 F2 . F2 . F2 . . E2 E2 . E2 . G#2 . .',
      // breather
      'F2 - - - - - . . F2 - - - - - . . A2 - - - - - . . A2 - - - - - . . D2 - - - - - . . D2 - - - - - . . E2 - - - - - . . E2 - - - - - . . F2 - - - - - . . G2 - - - - - . . C3 - - - - - . . A2 - - - - - . . D2 - - - - - . . E2 - - - - - . . E2 - - - - - . . E2 - - - - - G#2 -',
      // chase (theme in double time)
      'A2 . A2 . E2 . E2 . F2 . A2 . E2 . E2 . D2 . D2 . A1 . A1 . A#1 . A#1 . A1 . A1 . E2 . E2 . F2 . F2 . E2 . E2 . A2 . A2 . E2 E2 . E2 . E2 . . E2 E2 . E2 . E2 . .',
      // lead-in
      'D2 D2 . D2 . D2 . . A2 A2 . A2 . A2 . . F2 F2 . F2 . F2 . . E2 E2 . E2 . G#2 . . D2 D2 . D2 . D2 . . A2 A2 . A2 . A2 . . F2 F2 . F2 . F2 . . E2 E2 . E2 . G#2 . .',
    ].join(' '), 1),
    ch('noise', 0.05, [
      // theme, bare (current bars 1-4)
      'x . x o x . x o x . x o x . x o x . x o x . x o x . x o x . x o x . x o x . x o x . x o x . x o x . x o x . x o x . x o x . x o',
      // theme, full (current bars 5-8)
      'x . x o x . x o x . x o x . x o x . x o x . x o x . x o x . x o x . x o x . x o x . x o x . x o x . x o x . x o x . x o x . x o',
      // second theme in C major
      'x . . . o . . x x . x . o . . . x . . . o . . x x . x . o . . . x . . . o . . x x . x . o . . . x . . . o . . x x . x . o . . . x . . . o . . x x . x . o . . . x . . . o . . x x . x . o . . . x . . . o . . x x . x . o . . . x . . . o . . x x . x . o . o o',
      // second theme turns to A minor
      'x . . . o . . x x . x . o . . . x . . . o . . x x . x . o . . . x . . . o . . x x . x . o . . . x . . . o . . x x . o . o o o o',
      // theme with echo (current bars 9-12)
      'x . x o x . x o x . x o x . x o x . x o x . x o x . x o x . x o x . x o x . x o x . x o x . x o x . x o x . x o x . x o x . x o',
      // call and answer
      'c . . . o . . x x . k . o . . x x . . . o . . x x . k . o . t t x . . . o . . x x . k . o . . x x . . . o . . x x . k . o t t t x . k . o . . x x . . . o . . x x . k . o . . x x . . . o . t t x . k . o . . x x . k . o . . x x . k . o . . x x . o . t t t t',
      // counter-line
      'x . x . o . x o x . x . o . x o x . x . o . x o x . x . o . x o x . x . o . x o x . x . o . x o x . x . o . x o x . x . o . x o x . x . o . x o x . x . o . x o x . x . o . x o x . x . o . x o x . x . o . x o x . x . o . x o x . x . o . x o x . x . o o o o',
      // theme return (as today's bars 5-8)
      'c . x o x . x o x x x o x x x o x . x o x . x o x x x o x x t t x . x o x . x o x x x o x x x o x . x o x . x o x . x o t t t t',
      // breather
      'x . x . . . x . o . x . . . x . x . x . . . x . o . x . . . x . x . x . . . x . o . x . . . x . x . x . . . x . o . x . . . x . x . x . . . x . o . x . . . x . x . x . . . x . o . x . . . x . x . x . . . x . o . x . . . x . x . x . . . x . o . x . o . o o',
      // chase (theme in double time)
      'x . x o x . o x x . x o x . o x x . x o x . o x x . x o x . o x x . x o x . o x x . x o x . o x x . x o x . x o x . o o x o o o',
      // lead-in
      'x . x o x . x o x . x o x . x o x . x o x . x o x . x o x . x o x . x o x . x o x . x o x . x o x . x o x . x o x . x o x . x o',
    ].join(' ')),
  ],
  form: [
    { bars: 4, lead: 0, bass: 0, harmony: 0, drums: 0 }, // theme, bare (current bars 1-4)
    { bars: 4, lead: 1, bass: 1, harmony: 1, drums: 1 }, // theme, full (current bars 5-8)
    { bars: 8, lead: 1, bass: 1, harmony: 1, drums: 1 }, // second theme in C major
    { bars: 4, lead: 1, bass: 1, harmony: 1, drums: 1 }, // second theme turns to A minor
    { bars: 4, lead: 2, bass: 2, harmony: 2, drums: 2 }, // theme with echo (current bars 9-12)
    { bars: 8, lead: 1, bass: 0, harmony: null, drums: 1 }, // call and answer
    { bars: 8, lead: 1, bass: 1, harmony: 1, drums: 1 }, // counter-line
    { bars: 4, lead: 1, bass: 1, harmony: 1, drums: 1 }, // theme return (as today's bars 5-8)
    { bars: 8, lead: 3, bass: 0, harmony: 3, drums: 0 }, // breather
    { bars: 4, lead: 0, bass: 2, harmony: null, drums: 2 }, // chase (theme in double time)
    { bars: 4, lead: 0, bass: 0, harmony: 0, drums: 0 }, // lead-in
  ],
};

/**
 * The maze's breakdown (2026-10-26, the owner's ask: "something like Breather, but less melody and more percussion, with
 * emphasis on the bass line, almost like how Pass 4 ... feels today"): 8 bars over the breather's chords (F | Am | Dm |
 * E | F G | C Am | Dm E | E), a few soft notes on top, the bass carrying it in short octave-and-fifth figures that walk
 * up the E7 chord into the counter-line, hats and snares with the kicks left out, and a tom fill.
 */
const MAZE_BREAKDOWN = {
  lead: row([
    '. . . . . . . . A5 . . . F5 . . .', '. . . . . . . . . . . . . . . .',
    '. . . . . . . . D5 . . . A5 . . .', '. . . . . . . . . . . . . . . .',
    '. . . . . . . . B4 . . . D5 . . .', '. . . . . . . . . . . . . . . .',
    '. . . . . . . . G#4 . . . B4 . . .', '. . . . . . . . E5 . . . . . . .',
  ].join(' ')),
  bass: row([
    'F2 . F3 . C3 . F3 . F2 . F3 . C3 . A2 .', 'A2 . A3 . E3 . A3 . A2 . A3 . E3 . C3 .',
    'D2 . D3 . A2 . D3 . D2 . D3 . A2 . F2 .', 'E2 . E3 . B2 . E3 . E2 . E3 . B2 . G#2 .',
    'F2 . F3 . C3 . F3 . G2 . G3 . D3 . G3 .', 'C2 . C3 . G2 . C3 . A2 . A3 . E3 . A3 .',
    'D2 . D3 . A2 . D3 . E2 . E3 . B2 . E3 .', 'E2 . E3 . B2 . E3 . E2 . G#2 . B2 . D3 .',
  ].join(' ')),
  drums: row([...Array(7).fill('x . x x o . x x x . x x o . x x'), 'x . x x o . x x o . o . t t t t'].join(' ')),
};

/**
 * The maze's loop since 2026-10-26, the owner's arrangement from the listening page ("let's go with that as the maze
 * loop now"): the tune bare and full (the longer version's bars 1-8, as the loop began before), the breakdown, and the
 * counter-line (its bars 33-40), then round again from the bare tune. 24 bars, 38.4 s. After a fight a piece of the
 * longer version plays first and goes on into the full tune at bar 5, as it did before (intros.ts).
 */
function mazeLoop(): Track {
  const bars = (c: Channel, first: number, count: number): Pick<Channel, 'notes' | 'lengths'> => ({
    notes: c.notes.slice((first - 1) * 16, (first - 1 + count) * 16),
    lengths: c.lengths?.slice((first - 1) * 16, (first - 1 + count) * 16),
  });
  const join = (base: Channel, parts: Array<Pick<Channel, 'notes' | 'lengths'>>): Channel => {
    const notes: Array<number | null> = [];
    const lengths: Array<number | undefined> = [];
    for (const part of parts) {
      part.lengths?.forEach((l, i) => { if (l !== undefined) lengths[notes.length + i] = l; });
      notes.push(...part.notes);
    }
    const { lengths: _, ...rest } = base;
    return lengths.length ? { ...rest, notes, lengths } : { ...rest, notes };
  };
  const [lead, bass, drums] = MAZE_RONDO.channels as [Channel, Channel, Channel];
  const layer = (c: Channel, breakdown: Pick<Channel, 'notes' | 'lengths'>) => join(c, [bars(c, 1, 4), bars(c, 5, 4), breakdown, bars(c, 33, 8)]);
  return {
    bpm: MAZE_RONDO.bpm,
    channels: [layer(lead, MAZE_BREAKDOWN.lead), layer(bass, MAZE_BREAKDOWN.bass), layer(drums, MAZE_BREAKDOWN.drums)],
    form: [
      { bars: 4, lead: 0, bass: 0, harmony: 0, drums: 0 }, // the tune, bare
      { bars: 4, lead: 1, bass: 1, harmony: 1, drums: 1 }, // the tune, full: the pieces after a fight go on from here
      { bars: 8, lead: 3, bass: 1, harmony: 3, drums: 3 }, // breakdown
      { bars: 8, lead: 1, bass: 1, harmony: 1, drums: 1 }, // counter-line
    ],
  };
}

/**
 * The town's loop. The owner, 2026-10-20: "so that the parts with the arpeggios get played more", then one phrase of each
 * pass ("I just want one loop of all phrases"), pass 3 a break (the tune rests and pass 2's arpeggios carry it, over the
 * driving bass, the claps and the toms into pass 4), pass 4 with bells (score.ts `townColour`). The tune was then 62 steps
 * against the bars' 64, so its passes drifted across the bars (a list of stretches, `order`, kept the beat whole).
 *
 * Since 2026-11-01 the tune has four whole bars a pass and is set an eighth note early in every pass, as the owner wrote
 * it: its G is a pickup and A starts the measure, G | A B D B A G E | G A G E D C. The track opens on the first pass's G
 * alone, over the band's last snare hit, then goes round from the A (`loopFrom`), its last eighth that same G. The rows
 * hold the whole song, opening included, 258 steps; the bass, drums and harmony are those of four whole bars a pass.
 */
function townLoop(): Track {
  const tune = 'G4 . A4 . B4 . D5 . B4 . A4 . G4 . . . E4 . G4 . A4 . G4 . E4 . D4 . . . . . C4 . D4 . E4 . G4 . A4 . G4 . E4 . . . D4 . E4 . D4 . B3 . G3 . . . . . . .'.split(' ');
  const early = [...tune.slice(2), ...tune.slice(0, 2)].join(' ');
  const times = (s: string, n: number) => Array<string>(n).fill(s).join(' ');
  return {
    bpm: 118,
    loopFrom: 2,
    pickup: 2,
    halfBars: { from: [0, 2], tones: { 0: [] } }, // the first pass's G alone has no harmony
    form: [
      { bars: 2 / 16, lead: 3, bass: 3, harmony: 3, drums: 3 }, // the first pass's G alone, in the parts the loop's last two steps have
      { bars: 4, lead: 0, bass: 0, harmony: 0, drums: 0 },
      { bars: 4, lead: 1, bass: 1, harmony: 1, drums: 1 },
      { bars: 4, lead: null, bass: 2, harmony: 1, drums: 2 }, // the break
      { bars: 4, lead: 3, bass: 3, harmony: 3, drums: 3 },
    ],
    channels: [
      ch('square', 0.09, `${tune.slice(0, 2).join(' ')} ${times(early, 4)}`, 1),
      ch('triangle', 0.2, `. . ${times('G2 . . . D3 . . . C3 . . . D3 . . . E2 . . . B2 . . . C3 . . . D3 . . .', 8)}`, 2),
      ch('noise', 0.04, `o . ${times('x . o . x . o .', 32)}`),
    ],
  };
}

/** The maze fights' tune, bass and drums, each going round on its own length: the tune drifts against the other two. */
const BATTLE_TUNE = 'E5 . E5 . D5 . E5 . G5 . . . E5 . D5 . C5 . C5 . B4 . C5 . E5 . . . D5 . C5 . A4 . A4 . G4 . A4 . C5 . . . D5 . E5 . D5 . C5 . B4 . A4 . G#4 . B4 .';
const BATTLE_BASS = 'A2 . A2 A3 A2 . A2 A3 F2 . F2 F3 F2 . F2 F3 G2 . G2 G3 G2 . G2 G3 E2 . E2 E3 E2 . E2 E3';
const BATTLE_DRUMS = 'x . o . x x o . x . o . x x o o';
/** Steps `from` up to `to` of a row going round. */
const round = (notes: string, from: number, to: number): string => {
  const t = notes.split(' ');
  return Array.from({ length: to - from }, (_, i) => t[(from + i) % t.length]!).join(' ');
};
/**
 * The maze fights' track since 2026-10-31, the owner's, worked out bar by bar on its sheet. A fight opens on the old
 * one-verse loop from its step 60 ("exactly like 0:06 to 0:17"), the tune bare and then with the band, to a bar 8 whose B
 * lingers as the band stops. Then a breakdown, "a lot of bass and percussion with a little bit of subtle call and
 * answer"; bar 8 again; and a climb, where bass and drums take over from a melody kept at the quieter level it came back
 * in on, ending in one bar of drums. Bars 1 to 4 go round differently: the drums "keep breaking out into measure one" and
 * the band is "already joining", by stages, so its loop goes on from bar 5 (`loopFrom`), the bare tune heard only once.
 */
function fightSong(): Track {
  const tune = (a: number, b: number) => round(BATTLE_TUNE, a, b);
  const bass = (a: number, b: number) => round(BATTLE_BASS, a, b);
  const drums = (a: number, b: number) => round(BATTLE_DRUMS, a, b);
  const chord = (notes: string) => notes.split(' ').map(freq);
  const mf = 0.25 / 0.3;
  const climb = { lead: mf, bass: 1.25, drums: 1.15 };
  return {
    bpm: 160,
    loopFrom: 60,
    quickBass: 'step',
    form: [
      { bars: 52 / 16, lead: 0, bass: 0, harmony: 0, drums: 0 }, // The tune, bare.
      { bars: 68 / 16, lead: 1, bass: 1, harmony: 1, drums: 1 }, // The band joins four notes before bar 5.
      { bars: 4 / 16, lead: 0, bass: 0, harmony: 0, drums: 1 }, // The band stops under bar 8's B.
      { bars: 88 / 16, lead: 3, bass: 0, harmony: 0, drums: 1 }, // The breakdown.
      { bars: 1, lead: 3, bass: 0, harmony: 3, drums: 1 }, // Out of it by stages: soft arpeggios,
      { bars: 8 / 16, lead: 1, bass: 1, harmony: 1, drums: 1, level: { lead: mf } }, // the band, the melody at mf from here,
      { bars: 1, lead: 1, bass: 1, harmony: 1, drums: 1, level: { lead: mf } }, // and bar 8 again, the band playing through.
      { bars: 7, lead: 0, bass: 0, harmony: 1, drums: 1, level: climb }, // The climb.
      { bars: 12 / 16, lead: 0, bass: 0, harmony: 0, drums: 1, level: { ...climb, drums: 1.7 } }, // Its bar of drums.
      { bars: 1, lead: 0, bass: 0, harmony: 0, drums: 1, level: { drums: 1.4 } }, // Bar 1 coming round: the break goes on,
      { bars: 20 / 16, lead: 0, bass: 1, harmony: 0, drums: 1 }, // the driving bass,
      { bars: 1, lead: 0, bass: 1, harmony: 3, drums: 1 }, // soft arpeggios,
      { bars: 8 / 16, lead: 1, bass: 1, harmony: 1, drums: 1 }, // the band where it always joins.
    ],
    // Where the bars of the tune and of the band differ, and the chords the owner heard over the new bass.
    halfBars: {
      from: [4, 120, 124, 376, 380],
      tones: {
        116: chord('B3 D4 E4'), 244: chord('B3 D4 E4'), 252: chord('F4 A4 C5'), 260: chord('F4 G4 C5'), 268: chord('G3 B3 D4'),
        276: chord('G3 A3 D4'), 284: chord('A3 C4 E4'), 292: chord('A3 B3 E4'), 300: chord('A3 E4'), 308: chord('A3 E4 G4'),
        316: chord('F4 G4 A4'), 324: chord('F4 A4 C5'), 332: chord('G3 A3 B3'), 340: chord('G3 B3 D4'), 348: chord('E4 G#4 B4'),
        356: chord('E4 C5 D5'),
      },
    },
    channels: [
      ch('square', 0.08, [
        tune(60, 178), 'A4 .', 'B4@linger - - -',
        // The breakdown: the tune told slowly in two voices, its own register and an answer an octave down.
        'C5@answer . . . . . . . . . . . . . . .', '. . . . . . . . E5 . E5 . D5 . E5 .', 'G5 . . . . . . . . . . . E4@answer . D4@answer .',
        'C4@answer . . . . . . . C5 . C5 . B4 . C5 .', 'E5 . . . . . . . . . . . D4@answer . C4@answer .', 'A3@answer . . . . . . . A4 . A4 . G4 . A4 .',
        'C5 . . . . . . . . . . . D5 . E5 .',
        tune(168, 178), 'A4 . B4@linger - - -',
        // The climb: the tune falls a third a bar, this rises a step a bar; then the tune's own figure, up high.
        'C5 . . F5 . . A5 . G5 . F5 . C5 . . .', 'D5 . . G5 . . B5 . A5 . G5 . D5 . . .', 'E5 . . A5 . . C6 . B5 . A5 . E5@fade - - -',
        'A5 . . C6 . . B5 . A5 . G5 . E5 . . .', 'A5 . A5 . G5 . A5 . C6 . . . A5 . F5 .', 'B5 . B5 . A5 . B5 . D6 . . . B5 . G5 .',
        'B5 . B5 . G#5 . B5 . E6@fade - - - D6 . C6 .', 'B5@linger - - - . . . . . . . .',
        tune(60, 120),
      ].join(' ')),
      ch('triangle', 0.22, [
        bass(60, 180), 'G2 - G#2 -',
        // In 3-3-2, with the kicks.
        'A2 - - A2 - - A3 - E3 - A2 - C3 - G2 -', 'A2 - - A2 - - A3 - G3 - E3 - D3 - C3 -', 'A2 - - A2 - - A3 - E3 - A2 - C3 - G2 -',
        'F2 - - F2 - - F3 - C3 - F2 - A2 - G2 -', 'C3 - - C3 - - G2 - C3 - E3 - D3 - C3 -', 'F2 - - F2 - - F3 - C3 - A2 - F2 - E2 -',
        'A2 - - A2 - - A3 - A2 . A2 A3 G2 . G2 G3',
        bass(168, 184),
        // The breakdown's riff on the climb's chords and the melody's 3-3-2, then eighths where the melody goes to eighths.
        'F2 - - F2 - - F3 - C3 - F2 - A2 - G2 -', 'G2 - - G2 - - G3 - D3 - G2 - B2 - G#2 -', 'A2 - - A2 - - A3 - E3 - A2 - C3 - G2 -',
        'A2 - - A2 - - A3 - G3 - E3 - D3 - C3 -', 'F2 - F2 - F3 - F2 - C3 - F2 - A2 - C3 -', 'G2 - G2 - G3 - G2 - D3 - G2 - B2 - D3 -',
        'E2 - E2 - E3 - E2 - B2 - E2 - E3 - B2 -', 'E2 - - E2 - - E2 - B2 - G#2 -',
        bass(60, 120),
      ].join(' ')),
      ch('noise', 0.06, [
        drums(60, 180), 'x . t t',
        'k x x k o x k x x x k x t t t t', 'k x x k o x k x x x k x o x x x', 'k x x k o x k x t t t t o x x x', 'k x x k o x k x x x k x o x x x',
        'k x x k o x k x t t t t o x x x', 'k x x k o x k x x x k x o x t t', 'k x x k o x k x o . o . o o o o',
        drums(168, 184),
        // The breakdown's groove, then the tune's bar with its gaps filled, toms in the melody's gaps.
        'c x x k o x k x x x k x o x x x', 'k x x k o x k x x x k x o t t t', 'k x x k o x k x x x k x o x x x', 'k x x k o x k x x x k x o o o o',
        'c x o x x k o x x x o x x k o o', 'x x o x x k o x x t t t x k o o', 'x x o x x k o x x x o x x k o o',
        'c x x k o x k x o k t t', 'k x x k o x k x o k t t o k o o',
        drums(76, 120),
      ].join(' ')),
    ],
  };
}

export const TRACKS: Record<string, Track> = {
  title: {
    bpm: 132,
    channels: [
      ch('square', 0.11, 'C5 . E5 . G5 . E5 . C6 . G5 . E5 . G5 . A4 . C5 . E5 . C5 . A5 . E5 . C5 . E5 . F4 . A4 . C5 . A4 . F5 . C5 . A4 . C5 . G4 . B4 . D5 . B4 . G5 . D5 . B4 . D5 .', 1),
      ch('triangle', 0.2, 'C3 . . . C3 . . . A2 . . . A2 . . . F2 . . . F2 . . . G2 . . . G2 . . .', 2),
      ch('noise', 0.05, 'x . . . o . . . x . . . o . . .'),
    ],
  },
  house: {
    bpm: 96,
    channels: [
      ch('triangle', 0.16, 'E4 . . . G4 . . . A4 . . . G4 . . . E4 . . . D4 . . . C4 . . . . . . . D4 . . . E4 . . . G4 . . . E4 . . . D4 . . . C4 . . . D4 . . . . . . .', 3),
      ch('sine', 0.14, 'C3 . . . . . . . A2 . . . . . . . F2 . . . . . . . G2 . . . . . . .', 6),
    ],
  },
  // The owner's four-phrase loop (2026-10-20), with the tune a pickup before each bar (2026-11-01): see `townLoop`.
  town: townLoop(),
  // The owner's arrangement since 2026-10-26 (bare, full, breakdown, counter-line; 38.4 s): see `mazeLoop`.
  maze: mazeLoop(),
  // Extended on 2026-10-13 from 16 bars (38.4 s) to 32 (76.8 s): the tune's four passes, split by a meadow in F after
  // the first and a hushed bridge (the guards, on the soft lead) after the third, both kept near the tune's register
  // so the calm loop stays calm. The new bars give their held notes with "-" marks.
  // Extended on 2026-10-13 from 16 bars (38.4 s) to 32 (76.8 s): the tune's four passes, split by a meadow in F after
  // the first and a hushed bridge (the guards) after the third. The new bars give their held notes with "-" marks.
  border: {
    bpm: 100,
    channels: [
      ch('triangle', 0.16, [
        // pass 1 (kept)
        'D4 . . . F4 . . . A4 . . . G4 . . . F4 . . . E4 . . . D4 . . . . . . . C4 . . . E4 . . . G4 . . . F4 . . . E4 . . . C#4 . . . D4 . . . . . . .',
        // meadow (new, first half of the contrast)
        'C5 - - - - - A4 - F4 - - - G4 - - - A4 - - - - - - - A#4 - - - C5 - - - A#4 - - - G4 - - - E4 - - - - - - . F4 - - - - - A4 - C5 - - - - - A4 - D5 - - - - - A#4 - G4 - - - - - A4 - A#4 - - - - - - - A4 - - - F4 - - - D5 - - - - - F5 - E5 - - - - - C#5 - D5 - - - - - - - C#5 - - - E5 - A4 -',
        // pass 2 (kept)
        'D4 . . . F4 . . . A4 . . . G4 . . . F4 . . . E4 . . . D4 . . . . . . . C4 . . . E4 . . . G4 . . . F4 . . . E4 . . . C#4 . . . D4 . . . . . . .',
        // pass 3 (kept)
        'D4 . . . F4 . . . A4 . . . G4 . . . F4 . . . E4 . . . D4 . . . . . . . C4 . . . E4 . . . G4 . . . F4 . . . E4 . . . C#4 . . . D4 . . . . . . .',
        // bridge (new, second half of the contrast)
        'A3 - D4 - F4 - - - E4 - D4 - A3 - - - D4 - - - A#3 - G3 - A#3 - - - D4 - G4 - E4 - - - - - C4 - D4 - - - - - G3 - C4 - - - A3 - - - F4 - - - - - G4 - D4 - - - - - - - F4 - - - - - - . A4 - - - F4 - - - G4 - - - - - A#3 - F4 - - - - - D4 - E4 - - - - - C#4 - D4 - - - A4 - G4 - E4 - - - C#4 - - -',
        // pass 4 (kept)
        'D4 . . . F4 . . . A4 . . . G4 . . . F4 . . . E4 . . . D4 . . . . . . . C4 . . . E4 . . . G4 . . . F4 . . . E4 . . . C#4 . . . D4 . . . . . . .',
      ].join(' '), 3),
      ch('sine', 0.15, [
        // pass 1 (kept)
        'D2 . . . . . . . . . . . . . . . A1 . . . . . . . . . . . . . . . D2 . . . . . . . . . . . . . . . A1 . . . . . . . . . . . . . . .',
        // meadow (new, first half of the contrast)
        'F2 . . . . . . . . . . . . . . . F2 - - - - - - - C2 - - - - - - - C2 . . . . . . . . . . . . . . . F2 . . . . . . . . . . . . . . . G1 - - - - - - - D2 - - - - - - - G1 - - - - - - - D2 - - - - - - - A#1 - - - - - - - A1 - - - - - - - A1 . . . . . . . . . . . . . . .',
        // pass 2 (kept)
        'D2 . . . . . . . . . . . . . . . A1 . . . . . . . . . . . . . . . D2 . . . . . . . . . . . . . . . A1 . . . . . . . . . . . . . . .',
        // pass 3 (kept)
        'D2 . . . . . . . . . . . . . . . A1 . . . . . . . . . . . . . . . D2 . . . . . . . . . . . . . . . A1 . . . . . . . . . . . . . . .',
        // bridge (new, second half of the contrast)
        'D2 - - . A1 - - . D2 - - . A1 - - . G1 - - . D2 - - . G1 - - . D2 - - . C2 - - . G1 - - . C2 - - . G1 - - . F1 - - . C2 - - . F1 - - . C2 - - . A#1 - - . F1 - - . D2 - - . A1 - - . F1 - - . C2 - - . G1 - - . D2 - - . A#1 - - . F1 - - . A1 - - . E2 - - . A1 - - . E2 - - . A1 - - . E2 - - .',
        // pass 4 (kept)
        'D2 . . . . . . . . . . . . . . . A1 . . . . . . . . . . . . . . . D2 . . . . . . . . . . . . . . . A1 . . . . . . . . . . . . . . .',
      ].join(' '), 12),
      ch('noise', 0.03, [
        // pass 1 (kept)
        'x . . . . . . . o . . . . . . . x . . . . . . . o . . . . . . . x . . . . . . . o . . . . . . . x . . . . . . . o . . . . . . .',
        // meadow (new, first half of the contrast)
        'x . . . . . x . o . . . . . x . x . . . . . x . o . . . . . x . x . . . . . x . o . . . . . x . x . . . . . x . o . . . . . x . x . . . . . x . o . . . . . x . x . . . . . x . o . . . . . x . x . . . . . x . o . . . . . x . x . . . . . x . o . . . o . x .',
        // pass 2 (kept)
        'x . . . . . . . o . . . . . . . x . . . . . . . o . . . . . . . x . . . . . . . o . . . . . . . x . . . . . . . o . . . . . . .',
        // pass 3 (kept)
        'x . . . . . . . o . . . . . . . x . . . . . . . o . . . . . . . x . . . . . . . o . . . . . . . x . . . . . . . o . . . . . . .',
        // bridge (new, second half of the contrast)
        '. . x . . . x . o . x . . . x . . . x . . . x . o . x . . . x . . . x . . . x . o . x . . . x . . . x . . . x . o . x . . . x . . . x . . . x . o . x . . . x . . . x . . . x . o . x . . . x . . . x . . . x . o . x . . . x . . . x . . . x . o . x . o . o .',
        // pass 4 (kept)
        'x . . . . . . . o . . . . . . . x . . . . . . . o . . . . . . . x . . . . . . . o . . . . . . . x . . . . . . . o . . . . . . .',
      ].join(' ')),
    ],
    form: [
      { bars: 4, lead: 0, bass: 0, harmony: 0, drums: 0 }, // pass 1 (kept)
      { bars: 8, lead: 0, bass: 1, harmony: 1, drums: 1 }, // meadow (new, first half of the contrast)
      { bars: 4, lead: 1, bass: 1, harmony: 1, drums: 1 }, // pass 2 (kept)
      { bars: 4, lead: 2, bass: 2, harmony: 2, drums: 2 }, // pass 3 (kept)
      { bars: 8, lead: 3, bass: 0, harmony: 3, drums: 3 }, // bridge (new, second half of the contrast)
      { bars: 4, lead: 3, bass: 3, harmony: 3, drums: 3 }, // pass 4 (kept)
    ],
  },
  // Beijing (2026-10-12, second version): a busy street on natural instruments, built on the passages the owner liked in
  // the first. The score lives in beijingScore.ts; these rows are its skeleton, which the first draft plays and the
  // other styles arrange.
  field: {
    bpm: BEIJING_BPM,
    channels: [
      ch('square', 0.082, draftLeadRow(), 2),
      ch('triangle', 0.22, draftBassRow(), 2),
      ch('noise', 0.044, draftDrumRow()),
    ],
    // For the styles that arrange the skeleton themselves; the Console arrangement follows the sections in the score.
    form: [
      { bars: 8, lead: 0, bass: 1, harmony: 1, drums: 1 }, // street
      { bars: 8, lead: 2, bass: 1, harmony: 1, drums: 1 }, // A grows
      { bars: 8, lead: 0, bass: 2, harmony: 1, drums: 1 }, // stalls
      { bars: 8, lead: 3, bass: 0, harmony: 3, drums: 0 }, // crosscurrents
      { bars: 8, lead: 0, bass: 2, harmony: 1, drums: 2 }, // patrols
      { bars: 8, lead: 2, bass: 1, harmony: 1, drums: 1 }, // alley
      { bars: 8, lead: 0, bass: 0, harmony: 3, drums: 0 }, // evening
      { bars: 8, lead: 2, bass: 1, harmony: 1, drums: 1 }, // lanterns
      { bars: 8, lead: 2, bass: 2, harmony: 2, drums: 2 }, // crowd
      { bars: 4, lead: 3, bass: 0, harmony: 3, drums: 0 }, // market calls
      { bars: 8, lead: 0, bass: 1, harmony: 1, drums: 1 }, // homeward
    ],
  },
  // Extended on 2026-10-13 from 16 bars (42.7 s) to 32 (85.3 s): the tune's four passes, split by searchlights after the
  // first, then a glimpse of C major ("the other side") and a falling line ("looking back") before the last, those two
  // in the tune's low register. Searchlights and looking back play the soft lead.
  // Extended on 2026-10-13 from 16 bars (42.7 s) to 32 (85.3 s): the tune's four passes, split by searchlights after the
  // first, then a glimpse of C major ("the other side") and a falling line ("looking back") before the last.
  berlin: {
    bpm: 90,
    channels: [
      ch('triangle', 0.15, [
        // pass 1 (kept)
        'A3 . . . C4 . . . E4 . . . D4 . . . C4 . . . B3 . . . A3 . . . . . . . F3 . . . A3 . . . C4 . . . B3 . . . A3 . . . G#3 . . . A3 . . . . . . .',
        // searchlights (new)
        'D4 . . . F4 . . . A4 - - - - - G4 - C5 - - - - - - . B4 . . . A4 . . . A4 . . . C5 . . . F5 - - - A4 - C5 - G#4 . . . B4 . . . E5 - - - - - D5 - F4 . . . A4 . . . D5 - - - - - F5 - E5 - - - - - C5 - A4 - - - - - C5 - A4 - - - - - F4 - G4 - - - - - B4 - D5 - - - B4 - - - G#4 - - - E4 - - -',
        // pass 2 (kept)
        'A3 . . . C4 . . . E4 . . . D4 . . . C4 . . . B3 . . . A3 . . . . . . . F3 . . . A3 . . . C4 . . . B3 . . . A3 . . . G#3 . . . A3 . . . . . . .',
        // pass 3 (kept)
        'A3 . . . C4 . . . E4 . . . D4 . . . C4 . . . B3 . . . A3 . . . . . . . F3 . . . A3 . . . C4 . . . B3 . . . A3 . . . G#3 . . . A3 . . . . . . .',
        // the other side (new)
        'C4 - - - - - D4 - E4 - - - - - G4 - F4 - - - - - - - D4 - - - - - F4 - E4 - - - - - G4 - B3 - - - - - G3 - A3 - - - - - C4 - B3 - - - - - D4 -',
        // looking back (new)
        'C4 - - - E4 - A4 - G4 - - - E4 - - - G4 - - - - - - . F4 - - - D4 - - - E4 - - - - - - - D4 - - - B3 - - - C4 - - - - - A3 - B3 - - - G#3 - E3 -',
        // pass 4 (kept)
        'A3 . . . C4 . . . E4 . . . D4 . . . C4 . . . B3 . . . A3 . . . . . . . F3 . . . A3 . . . C4 . . . B3 . . . A3 . . . G#3 . . . A3 . . . . . . .',
      ].join(' '), 3),
      ch('sine', 0.15, [
        // pass 1 (kept)
        'A1 . . . . . . . . . . . . . . . F1 . . . . . . . E1 . . . . . . . A1 . . . . . . . . . . . . . . . F1 . . . . . . . E1 . . . . . . .',
        // searchlights (new)
        'D2 - D2 - D2 - D2 - D2 - D2 - D2 - D2 - A1 - A1 - A1 - A1 - A1 - A1 - A1 - A1 - F1 - F1 - F1 - F1 - F1 - F1 - F1 - F1 - E1 - E1 - E1 - E1 - E1 - E1 - E1 - E1 - D2 - A1 - D2 - A1 - D2 - A1 - D2 - A1 - A1 - E2 - A1 - E2 - A1 - E2 - A1 - E2 - F1 - C2 - F1 - C2 - G1 - D2 - G1 - D2 - E1 - B1 - E1 - B1 - E1 - B1 - E1 - B1 -',
        // pass 2 (kept)
        'A1 . . . . . . . . . . . . . . . F1 . . . . . . . E1 . . . . . . . A1 . . . . . . . . . . . . . . . F1 . . . . . . . E1 . . . . . . .',
        // pass 3 (kept)
        'A1 . . . . . . . . . . . . . . . F1 . . . . . . . E1 . . . . . . . A1 . . . . . . . . . . . . . . . F1 . . . . . . . E1 . . . . . . .',
        // the other side (new)
        'C2 . . . . . . . . . . . . . . . D2 . . . . . . . . . . . . . . . E2 . . . . . . . . . . . . . . . F2 . . . . . . . G2 . . . . . . .',
        // looking back (new)
        'A1 . . . . . . . C2 . . . . . . . E2 . . . . . . . D2 . . . . . . . C2 . . . . . . . G1 . . . . . . . A1 - - - C2 - - - E2 - - - D2 - B1 -',
        // pass 4 (kept)
        'A1 . . . . . . . . . . . . . . . F1 . . . . . . . E1 . . . . . . . A1 . . . . . . . . . . . . . . . F1 . . . . . . . E1 . . . . . . .',
      ].join(' '), 8),
      ch('noise', 0.03, [
        // pass 1 (kept)
        'x . . . . . . . . . . . o . . . x . . . . . . . . . . . o . . . x . . . . . . . . . . . o . . . x . . . . . . . . . . . o . . .',
        // searchlights (new)
        '. . x . . . x . . . x . o . x . . . x . . . x . . . x . o . x . . . x . . . x . . . x . o . x . . . x . . . x . . . x . o . x . . . x . . . x . . . x . o . x . . . x . . . x . . . x . o . x . . . x . . . x . . . x . o . x . . . x . . . x . . . x . o . o o',
        // pass 2 (kept)
        'x . . . . . . . . . . . o . . . x . . . . . . . . . . . o . . . x . . . . . . . . . . . o . . . x . . . . . . . . . . . o . . .',
        // pass 3 (kept)
        'x . . . . . . . . . . . o . . . x . . . . . . . . . . . o . . . x . . . . . . . . . . . o . . . x . . . . . . . . . . . o . . .',
        // the other side (new)
        'x . . . . . x . x . . . o . x . x . . . . . x . x . . . o . x . x . . . . . x . x . . . o . x . x . . . . . x . x . . . o . x .',
        // looking back (new)
        'x . . . . . x . x . . . o . x . x . . . . . x . x . . . o . x . x . . . . . x . x . . . o . x . x . . . . . x . x . . . o . o .',
        // pass 4 (kept)
        'x . . . . . . . . . . . o . . . x . . . . . . . . . . . o . . . x . . . . . . . . . . . o . . . x . . . . . . . . . . . o . . .',
      ].join(' ')),
    ],
    form: [
      { bars: 4, lead: 0, bass: 0, harmony: 0, drums: 0 }, // pass 1 (kept)
      { bars: 8, lead: 3, bass: 0, harmony: 3, drums: 3 }, // searchlights (new)
      { bars: 4, lead: 1, bass: 1, harmony: 1, drums: 1 }, // pass 2 (kept)
      { bars: 4, lead: 2, bass: 2, harmony: 2, drums: 2 }, // pass 3 (kept)
      { bars: 4, lead: 2, bass: 1, harmony: 1, drums: 1 }, // the other side (new)
      { bars: 4, lead: 3, bass: 1, harmony: 3, drums: 3 }, // looking back (new)
      { bars: 4, lead: 3, bass: 3, harmony: 3, drums: 3 }, // pass 4 (kept)
    ],
  },
  // The maze's fights: see `fightSong`.
  battle: fightSong(),
  // Beijing's street fights (2026-10-12): an 80s action-film loop. The score lives in kumiteScore.ts; these
  // rows are its skeleton, which the first draft plays and the other styles arrange.
  kumite: {
    bpm: KUMITE_BPM,
    channels: [
      ch('square', 0.074, kumiteLeadRow(), 2),
      ch('triangle', 0.2, kumiteBassRow(), 2),
      ch('noise', 0.055, kumiteDrumRow()),
    ],
    form: [
      { bars: 4, lead: 1, bass: 0, harmony: 1, drums: 0 }, // brass stabs
      { bars: 8, lead: 0, bass: 1, harmony: 1, drums: 1 }, // the gliding lead
      { bars: 4, lead: 2, bass: 2, harmony: 2, drums: 1 }, // the pulse tune
    ],
  },
  // The tank's fight music (2026-10-18): moved up a step from D minor to E minor, Beijing's key, and arranged on the street
  // fights' band (synth/boss.ts); these rows are its skeleton, which the first draft plays. The Console version it
  // replaced is kept in archive/boss_console/.
  boss: {
    bpm: 176,
    channels: [
      ch('square', 0.08, 'E5 . E5 . F5 . E5 . B4 . . . D5 . C5 . B4 . A4 . B4 . . . E4 . G4 . A4 . B4 . E5 . E5 . G5 . E5 . D5 . C5 . B4 . A4 . B4 . . . . . . .', 1),
      ch('sawtooth', 0.06, 'E2 E2 E3 E2 E2 E2 E3 E2 C2 C2 C3 C2 C2 C2 C3 C2 A1 A1 A2 A1 A1 A1 A2 A1 B1 B1 B2 B1 D#2 D#2 D#3 D#2'),
      ch('noise', 0.07, 'x o x o x o x x'),
    ],
  },
  // Reworked on 2026-10-05 for more energy while the title page played it, then given back to the ending the same day.
  // One whole song: the old tune at 112 bpm instead of 92, over driving bass and chords from the first bar; the drums as
  // it repeats; a climb; the tune an octave up, peaking on a high D; and a turnaround back to the start.
  ending: {
    bpm: 112,
    channels: [
      ch('square', 0.12, [
        // A: the tune as it was, over driving bass and chords; no drums yet.
        'C4 . . . E4 . . . G4 . . . C5 . . . B4 . . . G4 . . . A4 . . . . . . . F4 . . . A4 . . . C5 . . . F5 . . . E5 . . . D5 . . . C5 . . . . . . .',
        // A again: the drums and an echo come in, and E major turns it toward A minor.
        'C4 . . . E4 . . . G4 . . . C5 . E5 . B4 . . . G4 . . . A4 . . . A4 . G4 . F4 . . . A4 . . . C5 . . . F5 . . . E5 . . . D5 . . . B4 . . . G#4 . . .',
        // B: a galloping climb through A minor, F and G to a high B.
        'E4 . . A4 . . C5 . E5 . . C5 . . A4 . F4 . . A4 . . C5 . F5 . . C5 . . A4 . G4 . . B4 . . D5 . G5 . . D5 . . B4 . D5 . . G5 . . B5 . B5 . B5 . B5 . B5 .',
        // C: the tune an octave up, its second half changed to peak on a high D and land on C.
        'C5 . . . E5 . . . G5 . . . C6 . . . B5 . . . G5 . . . A5 . . . A5 . G5 . F5 . . . A5 . . . C6 . . . A5 . C6 . D6 . . . B5 . . . C6 . . . . . . .',
        // Turnaround: F and G, then A flat and B flat lifting back to C.
        'A5 . F5 . C5 . A4 . G5 . D5 . B4 . G4 . D#5 . C5 . G#4 . D#4 . D5 . A#4 . F4 . D4 .',
      ].join(' '), 2),
      ch('triangle', 0.2, [
        // A
        'C3 . C3 . C3 . C3 . C3 . C3 . C3 . C3 . G2 . G2 . G2 . G2 . A2 . A2 . A2 . A2 . F2 . F2 . F2 . F2 . F2 . F2 . F2 . F2 . G2 . G2 . G2 . G2 . C3 . C3 . C3 . C3 .',
        // A again
        'C3 . C3 . C3 . C3 . C3 . C3 . C3 . C3 . G2 . G2 . G2 . G2 . A2 . A2 . A2 . A2 . F2 . F2 . F2 . F2 . F2 . F2 . F2 . F2 . G2 . G2 . G2 . G2 . E2 . E2 . E2 . E2 .',
        // B
        'A2 . A2 . A2 . A2 . A2 . A2 . A2 . A2 . F2 . F2 . F2 . F2 . F2 . F2 . F2 . F2 . G2 . G2 . G2 . G2 . G2 . G2 . G2 . G2 . G2 . G2 . G2 . G2 . G2 . G2 . A2 . B2 .',
        // C
        'C3 . C3 . C3 . C3 . C3 . C3 . C3 . C3 . G2 . G2 . G2 . G2 . A2 . A2 . A2 . A2 . F2 . F2 . F2 . F2 . F2 . F2 . F2 . F2 . G2 . G2 . G2 . G2 . C3 . C3 . C3 . C3 .',
        // Turnaround
        'F2 . F2 . F2 . F2 . G2 . G2 . G2 . G2 . G#2 . G#2 . G#2 . G#2 . A#2 . A#2 . A#2 . A#2 .',
      ].join(' '), 2),
      ch('noise', 0.05, [
        // A
        '. . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . .',
        // A again
        'x . . . o . . . x . . . o . . . x . . . o . . . x . . . o . . . x . . . o . . . x . . . o . . . x . . . o . . . x . . . o . o o',
        // B
        'x . . x o . . . x . . x o . . . x . . x o . . . x . . x o . . . x . . x o . . . x . . x o . . . x . . . o . . . o . o . o o o o',
        // C
        'x . x x o . . . x . x x o . . . x . x x o . . . x . x x o . . . x . x x o . . . x . x x o . . . x . x x o . . . x . x x o . o o',
        // Turnaround
        'x . x . o . x . x . x . o . x . x . x . o . x . x . o . o . o o',
      ].join(' ')),
    ],
    form: [
      { bars: 4, lead: 0, bass: 1, harmony: 1, drums: null },
      { bars: 4, lead: 2, bass: 2, harmony: 1, drums: 1 },
      { bars: 4, lead: 0, bass: 1, harmony: 1, drums: 1 },
      { bars: 4, lead: 2, bass: 2, harmony: 1, drums: 1 },
      { bars: 2, lead: 0, bass: 1, harmony: 1, drums: 0 },
    ],
  },
};
