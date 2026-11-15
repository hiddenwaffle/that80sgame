import { MAZE_RONDO, type Channel, type Section, type Track } from './music.ts';

/**
 * A piece played after a fight: bars `first` to `last` of a track's longer version. It may start on the half bar
 * (`first` 50.5 is bar 50's third beat), so its harmony's half bars and its drums' beats fall as in the source.
 */
export interface Intro {
  /** What it plays, for pages and checks. */
  name: string;
  first: number;
  last: number;
}

/** A track's pieces played after fights, slowest first, and the loop's step each goes on into. */
export interface Intros {
  /** The longer version the pieces are cut from, at the loop's tempo. Not in `TRACKS`. */
  source: Track;
  pieces: readonly Intro[];
  entry: number;
}

/**
 * Tracks that play a piece of a longer version after a fight, then go on into their loop (2026-10-14; the owner: "for
 * the maze, instead of having a continuous single musical piece, we have multiple intro pieces that play after battles,
 * randomly, and once they complete they go back into the original short loop until the next battle. And the intro pieces
 * are based on sections of the extended maze music"; "you might could start after a battle on 0:12 and at 0:25 switch
 * back to the original loop's 2nd verse, which I believe is 0:06-0:12 in the extended. And then it loops back to 0:00
 * and so on until the next battle starts or the player exits the map. When entering the map we should just play the
 * regular loop as before").
 *
 * The pieces were first long stretches from the owner's times, then cut to six bars; then (the owner, the same day: "I
 * think we should have 4-6 seconds maximum, and preferably around 4 [...] You can reorganize the intros as necessary";
 * "we arrange the order in which they play by how many power pellets are left [...] the 'Chase and lead-in' that exists
 * right now would be what plays after you've gotten all 6") each is a short cadence from one of the longer version's
 * passages, as written: a two-bar unit ending on an E chord (G for the second theme), most with the half bar before it
 * as a pickup, 4.0 s. The lead-in is its unit alone, 3.2 s; the chase has the whole bar before it, 4.8 s, so it opens
 * on its own semiquavers (with only the half bar, its three notes and a rest before the run sounded like extra notes:
 * the owner, "The chase intro sounds like there are an extra 3 notes at the beginning"). The loop's A minor tune
 * resolves the last chord. Slowest first, by how many notes a second the tune plays: the breather's held notes (2.3),
 * the lead-in's detached crotchets (2.5), the second theme (2.8), the counter-line (3.0), the turn to A minor (3.8),
 * the call and answer's quick figures (5.0), the chase's semiquavers (7.1).
 *
 * On 2026-10-26, with the loop now the owner's longer arrangement (music.ts, `mazeLoop`), the owner chose the longer
 * pieces back ("Let's go with the four in 'Second round, 14 Oct: four cut to six bars' and then the 2 in 'First round
 * [...]' that were kept intact [...] Replaced in the same positions as where their 4 second versions are right now"):
 * the call and answer, counter-line, breather, and chase and lead-in as their six bars (9.6 s, each from a two-bar
 * unit's start to its cadence on E), the second theme in C (12.8 s) and the turn to A minor (6.4 s) whole. Each starts
 * on its bar, at full level (the owner, 14 Oct: "since we're starting a new musical phrase it should start a full
 * level"). The lead-in keeps its short form, after the first pellet. A piece with a pickup fades in as a return
 * mid-tune does (the owner: "if you lead into it with half a bar, maybe we should test it with the fade in [...] Fade
 * in might make more sense I think with some lead in notes"); one starting on its bar starts at full level. Each is
 * rendered alone at the loop's gain, and the loop starts on the frame its last bar ends, from step `entry` (its second
 * pass, the longer version's 0:06.4 to 0:12.8 note for note); the piece's last notes ring on into it. Data and
 * arithmetic only, as openings.ts, so the page can read it without loading the synthesizer.
 */
export const INTROS: Record<string, Intros> = {
  maze: {
    source: MAZE_RONDO,
    entry: 64,
    // In the order of power pellets taken, 0 to 6 (the owner, 2026-10-26: the 14 Oct longer pieces back in the places of
    // their short versions); the lead-in has no longer version and stays as it was.
    pieces: [
      { name: 'breather', first: 47, last: 52 },
      { name: 'lead-in', first: 57, last: 58 },
      { name: 'second theme in C', first: 9, last: 16 },
      { name: 'counter-line', first: 35, last: 40 },
      { name: 'turn to A minor', first: 17, last: 20 },
      { name: 'call and answer', first: 27, last: 32 },
      { name: 'chase and lead-in', first: 53, last: 58 },
    ],
  },
};

/** Whether a piece opens with half a bar before its first bar line, a pickup the music fades in over. */
export const introLeadsIn = (p: Intro): boolean => !Number.isInteger(p.first);

/** How many steps a piece lasts. */
export const introSteps = (p: Intro): number => (p.last - p.first + 1) * 16;

/**
 * A piece as a track of its own: its source's rows over its bars, and its source's sections there, the first and last
 * cut to the piece's bars. A section's parts hold for all its bars, so its bars play in the piece as in the source.
 */
export function introTrack(set: Intros, i: number): Track {
  const { source } = set;
  const p = set.pieces[i];
  if (!p) throw new Error(`No intro ${i}`);
  const form: Section[] = [];
  let bar = 1;
  for (const s of source.form ?? []) {
    // Where the piece and the section overlap, from the start of one bar to the end of another: half a bar where a
    // pickup sits in the last bar of the section before.
    const from = Math.max(bar, p.first);
    const to = Math.min(bar + s.bars, p.last + 1);
    if (to > from) form.push({ ...s, bars: to - from });
    bar += s.bars;
  }
  const steps = (bar - 1) * 16;
  const from = (p.first - 1) * 16;
  const to = p.last * 16;
  if (!Number.isInteger(p.first * 2) || !Number.isInteger(p.last)) throw new Error(`The intro "${p.name}" must start on a half bar and end on a bar line`);
  if (p.first < 1 || p.last < p.first || to > steps) throw new Error(`The intro "${p.name}" is not inside its source`);
  const slice = (c: Channel): Channel => {
    if (c.notes.length !== steps) throw new Error(`The intro "${p.name}" needs every channel of its source to run its whole form`);
    return { ...c, notes: c.notes.slice(from, to), ...(c.lengths ? { lengths: c.lengths.slice(from, to) } : {}) };
  };
  return { bpm: source.bpm, channels: source.channels.map(slice), form };
}

/** The piece a track played last after a fight, and whether the map was done by then. */
export interface LastIntro {
  i: number;
  done: boolean;
}

/**
 * Which piece plays after a fight, from how far through the map the player is: `done` of `total` (the maze's power
 * pellets taken). Until every one is, the piece for that much, slowest first, so each pellet moves the music on
 * (with seven pieces for six pellets, one each); with every one taken, the last piece, then (the owner: "If they've
 * already gotten all dots, and the 'Chase and lead-in' has already played, then we go back to the slowest and go in
 * sequential order after each battle") each in turn from the first.
 */
export function introFor(count: number, done: number, total: number, last?: LastIntro): number {
  if (count < 1) throw new Error('No pieces to choose from');
  if (total <= 0 || count === 1) return 0;
  if (done < total) return Math.min(count - 2, Math.floor((Math.max(0, done) * (count - 1)) / total));
  return last?.done ? (last.i + 1) % count : count - 1;
}

/**
 * When a piece and the loop after it start, on the audio context's clock: the piece on the first frame from `earliest`,
 * the loop `steps` later, both on whole frames that convert to seconds and back exactly, so neither is played from
 * between two samples. `offset` is where in the loop's buffer (at `bufferRate`) it starts: step `entry`. `exact` is false
 * where a step is not a whole number of frames, and the times are then only as close as the frames allow.
 */
export function introPlan(earliest: number, rate: number, stepDur: number, steps: number, entry: number, bufferRate: number): {
  at: number;
  loopAt: number;
  offset: number;
  exact: boolean;
} {
  const stepFrames = Math.round(rate * stepDur);
  const exact = Math.abs(rate * stepDur - stepFrames) < 1e-6;
  const span = exact ? steps * stepFrames : Math.round(steps * stepDur * rate);
  const whole = (n: number) => (n / rate) * rate === n;
  const first = Math.ceil(earliest * rate - 1e-6);
  let n = first;
  while (n < first + 1000 && !(whole(n) && whole(n + span))) n++;
  if (n === first + 1000) n = first;
  return { at: n / rate, loopAt: (n + span) / rate, offset: Math.round(entry * stepDur * bufferRate) / bufferRate, exact };
}
