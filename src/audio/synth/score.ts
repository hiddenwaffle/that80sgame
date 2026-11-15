import { DRUM_HITS, TRACKS, lengthAt, type Channel, type NoteShape, type Part, type Section, type Track } from '../music.ts';
import { Mix, SR, finish, fold, loudness, play, scale, voiceEnd, type Fx, type Voice } from './dsp.ts';
import { arrangeBeijing } from './beijing.ts';
import { arrangeKumite } from './kumite.ts';
import { arrangeBoss } from './boss.ts';
import { loopSteps } from './draft.ts';
import { INTROS, introTrack } from '../intros.ts';

/**
 * The draft's tunes arranged in the Console style, the game's soundtrack (2026-10-02; the other sketched styles were
 * retired on 2026-10-13 and are kept in archive/sound_styles/). An arrangement keeps the draft's melody, bass line and
 * drum pattern, its tempo, and its timing (a melody that drifts against its bass, as town's, battle's and the boss's
 * do, still drifts), and builds round them in four parts over one loop: the tune as it is; then harmony; then a
 * counter-voice; then a lighter part before the loop comes round. The harmony is made only of notes already sounding
 * in each half bar (the bass, and the melody's main notes with no semitone clashes), so it cannot fight the tune. A
 * track with its own form (the title's, 2026-10-05) is instead one whole song, played once a loop, and its sections
 * say which part each layer plays, or leave a layer out.
 *
 * Console: pulse lead with delayed vibrato and an echoing second voice, stepped triangle bass, noise-channel drums.
 */

export interface Note {
  /** Start, in steps (sixteenths). */
  s: number;
  /** Length, in steps. */
  len: number;
  /** Hz. */
  f: number;
  /** Its own shape (`Channel.shapes`). */
  shape?: NoteShape;
}

type Layer = 'lead' | 'bass' | 'harmony' | 'drums';

/** A drum the arrangements play; `DRUM_HITS` in music.ts gives the token each is written with. */
type DrumKind = 'kick' | 'snare' | 'hat' | 'tom' | 'crash';

interface HalfBar {
  at: number;
  steps: number;
}

export interface Song {
  name: string;
  bpm: number;
  step: number;
  total: number;
  /** Where each section begins, in steps, and the part each layer plays in it: the four parts, or the track's form. */
  sections: Array<{ start: number; level?: Section['level'] } & Record<Layer, Part>>;
  lead: Note[];
  bass: Note[];
  drums: Array<{ s: number; kind: DrumKind }>;
  /** Chord tones (Hz, around C4) for each half bar; empty where the harmony rests. */
  chords: number[][];
  /** Where each of `chords` begins and how many steps it lasts: every 8 from the top unless the track's `halfBars` says otherwise. */
  halfBars: HalfBar[];
  calm: boolean;
  /** The step its loop goes round to, if not its top (`Track.loopFrom`). */
  loopFrom?: number;
  /** How its quick bass notes play in the full parts (`Track.quickBass`); the echo where absent. */
  quickBass?: 'echo' | 'step';
  /** How many steps its tune is early (`Track.pickup`). */
  pickup?: number;
}

const midi = (f: number) => Math.round(69 + 12 * Math.log2(f / 440));
const fromMidi = (m: number) => 440 * 2 ** ((m - 69) / 12);

function events(ch: Channel, total: number): Note[] {
  const out: Note[] = [];
  for (let s = 0; s < total; s++) {
    const f = ch.notes[s % ch.notes.length];
    const shape = ch.shapes?.[s % ch.notes.length];
    if (f !== null && f !== undefined) out.push({ s, len: lengthAt(ch, s % ch.notes.length), f, ...(shape ? { shape } : {}) });
  }
  return out;
}

/**
 * The harmony of each half bar (`chords` of a song), from what the bass and melody play in it: see `song`.
 */
function harmonyOf(lead: Note[], bass: Note[], halfBars: HalfBar[], set: Record<number, number[]> = {}, bar0 = 0): number[][] {
  // The harmony of each half bar, from what the bass and melody play in it: the bass note, then the melody's notes by
  // weight, then the bass note's fifth if fewer than three are left. A note a semitone from any note the bass or the
  // melody plays in that half bar, however short, or from one already taken, is left out; so is the bass note itself
  // when it rubs against the melody (the bass still plays it). So a chord never holds a note rubbing against the tune;
  // where every note would (battle's F bass under B, C and E), the harmony rests for that half bar.
  const chords: number[][] = [];
  const pcOf = (e: Note) => midi(e.f) % 12;
  const rub = (a: number, b: number) => [1, 11].includes((a - b + 12) % 12);
  for (const { at: w, steps } of halfBars) {
    if (set[w]) {
      chords.push(set[w]!);
      continue;
    }
    const sounding = (notes: Note[]) => notes.filter((e) => e.s < w + steps && e.s + e.len > w);
    const inBass = sounding(bass);
    const inLead = sounding(lead);
    const root = pcOf(inBass[0] ?? bass.filter((e) => e.s <= w).at(-1) ?? bass[0]!);
    const played = [...inBass, ...inLead].map(pcOf);
    const weight = new Map<number, number>();
    for (const e of inLead) {
      const dur = Math.min(e.s + e.len, w + steps) - Math.max(e.s, w);
      weight.set(pcOf(e), (weight.get(pcOf(e)) ?? 0) + dur * ((e.s - bar0) % 4 === 0 ? 1.5 : 1));
    }
    const byWeight = [...weight.entries()].sort((a, b) => b[1] - a[1]).map(([pc]) => pc);
    const taken: number[] = [];
    const clash = (pc: number) => taken.some((x) => rub(pc, x)) || played.some((m) => m !== pc && rub(pc, m));
    if (!clash(root)) taken.push(root);
    for (const pc of byWeight) {
      if (taken.length >= 4) break;
      if (!taken.includes(pc) && !clash(pc)) taken.push(pc);
    }
    const fifth = (root + 7) % 12;
    if (taken.length < 3 && !taken.includes(fifth) && !clash(fifth)) taken.push(fifth);
    // Voiced upward from the root's place in the octave around C4 (G3 to F#4), whether or not the root is in it.
    const base = root < 7 ? 60 + root : 48 + root;
    taken.sort((a, b) => ((a - root + 12) % 12) - ((b - root + 12) % 12));
    chords.push(taken.map((pc) => fromMidi(base + ((pc - root + 12) % 12))));
  }
  return chords;
}

/** A track's half bars: eight steps each from each of `from`, the last before the next of `from` cut short there. */
function halfBarsOf(total: number, from: number[] = [0]): HalfBar[] {
  const out: HalfBar[] = [];
  from.forEach((a, i) => {
    const next = from[i + 1];
    for (let w = a; w < (next ?? total); w += 8) out.push({ at: w, steps: next === undefined ? 8 : Math.min(8, next - w) });
  });
  return out;
}

/** Reads a draft track into a song: its parts, its loop, and the harmony of each half bar. `t`: a track not in `TRACKS`. */
export function song(name: string, t: Track | undefined = TRACKS[name]): Song {
  if (!t) throw new Error(`No track ${name}`);
  const tones = t.channels.filter((c) => c.wave !== 'noise');
  const noise = t.channels.find((c) => c.wave === 'noise');
  const lcm = loopSteps(t.channels.map((c) => c.notes.length));
  const leadLen = tones[0]!.notes.length;
  const total = t.form ? lcm : lcm * Math.max(1, Math.ceil((4 * leadLen) / lcm));
  let sections: Song['sections'];
  if (t.form) {
    let start = 0;
    sections = t.form.map(({ bars, ...roles }) => {
      const at = start;
      start += bars * 16;
      return { start: at, ...roles };
    });
    if (start !== total) throw new Error(`${name}'s form is ${start} steps long, its channels ${total}`);
  } else {
    const bars = Math.floor(total / 16);
    const q = Math.max(1, Math.floor(bars / 4)) * 16;
    sections = ([0, 1, 2, 3] as const).map((i) => ({ start: i * q, lead: i, bass: i, harmony: i, drums: i, ...t.passes?.[i] }));
  }
  const lead = events(tones[0]!, total);
  const bass = events(tones[1]!, total);
  // "k" is a kick on any step, "t" a tom, "c" a crash; "x" is a kick on a beat and a closed hat off one, "o" a snare.
  const kindOf = (e: Note): DrumKind =>
    e.f === DRUM_HITS.k ? 'kick' : e.f === DRUM_HITS.t ? 'tom' : e.f === DRUM_HITS.c ? 'crash' : e.f < 4000 ? 'snare' : (e.s - (t.pickup ?? 0)) % 4 === 0 ? 'kick' : 'hat';
  const drums = noise ? events(noise, total).map((e) => ({ s: e.s, kind: kindOf(e) })) : [];
  const halfBars = halfBarsOf(total, t.halfBars?.from);
  // A pickup note is part of the harmony of the bar it leads into.
  const chords = harmonyOf(t.pickup ? lead.map((e) => ({ ...e, s: e.s + t.pickup! })) : lead, bass, halfBars, t.halfBars?.tones, t.pickup ?? 0);
  const whole: Song = { name, bpm: t.bpm, step: 60 / t.bpm / 4, total, sections, lead, bass, drums, chords, halfBars, calm: t.bpm < 105, ...(t.loopFrom === undefined ? {} : { loopFrom: t.loopFrom }), ...(t.quickBass === undefined ? {} : { quickBass: t.quickBass }), ...(t.pickup === undefined ? {} : { pickup: t.pickup }) };
  return t.order ? reorder(whole, t.order) : whole;
}

/**
 * A song played in another order of its stretches (`Track.order`, in steps): the stretches back to back, each note,
 * drum and part as there in the whole song. A note held over the end of a stretch ends there. The harmony is worked out
 * again for the new order's half bars, as `song` does for the whole, so it always fits what the bass and melody play.
 */
function reorder(g: Song, order: Array<[number, number]>): Song {
  const out: Song = { ...g, total: 0, sections: [], lead: [], bass: [], drums: [], chords: [], halfBars: [] };
  for (const [a, b] of order) {
    if (a < 0 || b > g.total || a >= b) throw new Error(`${g.name}'s order has steps ${a} to ${b}, outside its ${g.total}`);
    const at = (s: number) => out.total + s - a;
    for (const [src, to] of [[g.lead, out.lead], [g.bass, out.bass]] as const)
      for (const e of src) if (e.s >= a && e.s < b) to.push({ ...e, s: at(e.s), len: Math.min(e.len, b - e.s) });
    for (const d of g.drums) if (d.s >= a && d.s < b) out.drums.push({ ...d, s: at(d.s) });
    // The part at the range's start, then each section that begins inside it.
    let current = g.sections[0]!;
    for (const x of g.sections) if (x.start <= a) current = x;
    out.sections.push({ ...current, start: out.total });
    for (const x of g.sections) if (x.start > a && x.start < b) out.sections.push({ ...x, start: at(x.start) });
    out.total += b - a;
  }
  if (out.total % 4) throw new Error(`${g.name}'s order is ${out.total} steps, not whole beats`);
  out.halfBars = halfBarsOf(out.total);
  out.chords = harmonyOf(out.lead, out.bass, out.halfBars);
  return out;
}

/** The part a layer plays at a step (0 to 3), or null where the track's form leaves it out. */
export function roleOf(g: Song, layer: Layer, s: number): Part {
  // A tune's pickup note belongs to the pass it leads into (`Track.pickup`).
  if (layer === 'lead' && g.pickup) s = (s + g.pickup) % g.total;
  let at = g.sections[0]!;
  for (const x of g.sections) if (x.start <= s) at = x;
  return at[layer];
}

/** How loud a layer plays at a step, against its part's usual level (`Section.level`). */
function levelOf(g: Song, layer: 'lead' | 'bass' | 'drums', s: number): number {
  let at = g.sections[0]!;
  for (const x of g.sections) if (x.start <= s) at = x;
  return at.level?.[layer] ?? 1;
}

interface Band {
  fx: Fx;
  lead: (v: Voice[], g: Song, e: Note, part: number) => void;
  bass: (v: Voice[], g: Song, e: Note, part: number) => void;
  /** The harmony for one half bar (`w` is its first step, `steps` how many it lasts). */
  harmony: (v: Voice[], g: Song, chord: number[], w: number, part: number, steps: number) => void;
  drum: (v: Voice[], g: Song, kind: DrumKind, s: number, part: number, extra: boolean) => void;
  /** Steps where the style adds hats of its own, in the parts that are full. */
  hats?: (g: Song, s: number) => boolean;
}

const sec = (g: Song, s: number) => s * g.step;

/**
 * The Console lead. A note of up to three steps plays as it always has, falling to 0.64 of its peak by the end of its
 * hold whatever its length. A note of four steps or more (2026-10-13: the owner found the long notes grating, "Maybe
 * try ending or tapering the long notes sooner?") keeps its written length, its pulse width and its delayed vibrato,
 * but decays over a fixed six steps instead of over twice its hold: one step in, it is where a one-step note ends (10
 * of the chip's 15 volume steps), and from 3.3 steps in it holds 5 of 15 (9.5 dB under its peak) to its end. So a long
 * note is a one-step note's pluck with a quiet tail.
 */
function consoleMelody(g: Song, e: Note, part: number): Voice {
  const hold = sec(g, e.len) * 0.92;
  const taper = e.len >= 4;
  const v: Voice = { wave: 'pulse', duty: g.calm ? 0.5 : 0.25, at: sec(g, e.s), freq: e.f, hold,
    gain: part === 3 ? 0.22 : 0.3, tick: 60, vsteps: 15, a: 0.002,
    d: taper ? sec(g, 6) : hold * 2, s: taper ? 0.31 : 0.6, r: 0.03, vib: [6, 0.18, 0.2] };
  return e.shape ? shaped(v, e.shape, sec(g, 1)) : v;
}

/**
 * A lead note's own shape. `linger`: at its full level for half a step, then falling sooner and further than the usual
 * taper, to 3 or 4 of the chip's 15 volume steps by its end instead of 5, its vibrato coming in on the tail. `fade`: at
 * its full level for half a step, then a one-step note's first step, letting go over the rest of its written length
 * where a one-step note stops. `answer`: the usual pluck, softer and hollow, a second voice to the lead.
 */
function shaped(v: Voice, shape: NoteShape, step: number): Voice {
  if (shape === 'linger') return { ...v, stay: step / 2, d: 0.4, s: 0.22, r: 0.06 };
  if (shape === 'fade') return { ...v, stay: step / 2, hold: step * 0.92 + step / 2, d: step * 0.92 * 2, s: 0.6, r: 0.4 };
  const { vib: _, ...plain } = v;
  return { ...plain, duty: 0.5, gain: v.gain * 0.8 };
}

/**
 * The second channel echoing the lead three steps late, in the third part: only its notes on eighths, so the echo does
 * not fill every rest of a quick tune.
 */
function consoleEcho(g: Song, e: Note, base: Voice, part: number): Voice | null {
  return part === 2 && e.s % 2 === 0 ? { ...base, at: base.at + sec(g, 3), duty: 0.25, gain: 0.05 } : null;
}

/** Where a bass note's echo falls, as a share of the note's length: a one-step (sixteenth) note's echo is a thirty-second note later. */
const BASS_ECHO_AT = 0.5;

/**
 * Whether the Console band follows a bass note with its octave: the doubled bass the owner likes (2026-11-01). It is on
 * a quick note (one or two steps) in the full parts, 1 and 2, of a song that is not calm; the bare opening, the
 * breakdown's part 3 and calm songs play their bass notes single. The echo's timing is the same for every song.
 */
export function bassEchoes(g: Pick<Song, 'calm'>, part: number, e: Pick<Note, 'len'>): boolean {
  return !g.calm && part >= 1 && part <= 2 && e.len <= 2;
}

/** What a one-step bass note in a 'step' song is raised by: 2 on every other note, 1 where the notes around it already leap an octave. */
export function quickOctave(g: Pick<Song, 'bass'>, e: Note): number {
  const i = g.bass.indexOf(e);
  for (let k = Math.max(0, i - 3); k <= Math.min(g.bass.length - 1, i + 3); k++) {
    if (Math.abs(Math.abs(Math.log2(g.bass[k]!.f / e.f)) - 1) < 0.01) return 1;
  }
  return i % 2 ? 2 : 1;
}

const CONSOLE: Band = {
  fx: { mono: true, lp: 11000 },
  lead: (v, g, e, part) => {
    const base = consoleMelody(g, e, part);
    v.push(base);
    const echo = consoleEcho(g, e, base, part);
    if (echo) v.push(echo);
  },
  bass: (v, g, e, part) => {
    const at = sec(g, e.s);
    const len = sec(g, e.len);
    if (bassEchoes(g, part, e) && (g.quickBass !== 'step' || e.len === 2)) {
      v.push({ wave: 'tri4', at, freq: e.f, hold: len * 0.45, gain: 0.3, a: 0.002, r: 0.01 });
      v.push({ wave: 'tri4', at: at + len * BASS_ECHO_AT, freq: e.f * 2, hold: len * 0.45, gain: 0.3, a: 0.002, r: 0.01 });
    } else if (bassEchoes(g, part, e)) {
      // A one-step note in a 'step' song has no next step to give its octave: it stays on its own step.
      v.push({ wave: 'tri4', at, freq: e.f * quickOctave(g, e), hold: len * 0.9, gain: 0.3, a: 0.002, r: 0.015 });
    } else v.push({ wave: 'tri4', at, freq: e.f, hold: Math.min(len, sec(g, 6)) * 0.9, gain: 0.3, a: 0.002, r: 0.015 });
  },
  harmony: (v, g, chord, w, part, steps) => {
    if (part === 0 || part === 2) return;
    // Broken chords on the second pulse, a sixteenth each, up the chord.
    for (let i = 0; i < steps; i++) {
      const f = chord[i % chord.length]! * (i >= chord.length ? 2 : 1);
      v.push({ wave: 'pulse', duty: 0.5, at: sec(g, w + i), freq: f, hold: sec(g, 1) * 0.7, gain: part === 3 ? 0.1 : 0.13, tick: 60, vsteps: 15, a: 0.002, d: 0.08, s: 0.3, r: 0.01 });
    }
  },
  drum: (v, g, kind, s, part) => {
    if (part === 3 && kind === 'kick') return;
    const at = sec(g, s);
    if (kind === 'kick') {
      v.push({ wave: 'tri4', at, freq: 180, to: 50, hold: 0.07, gain: 0.3, tick: 120 });
      v.push({ wave: 'lfsr', at, freq: 200000, hold: 0.012, gain: 0.12, d: 0.012, s: 0 });
    } else if (kind === 'snare') v.push({ wave: 'lfsr', at, freq: 60000, hold: 0.1, gain: 0.15, d: 0.1, s: 0, vsteps: 15 });
    else if (kind === 'tom') {
      // A triangle tom swept down on the frame clock, with a click for the stick: E4, D4, B3 and A3 by the step's place
      // in its beat, so a run of toms walks down to A (2026-10-13, the maze's fills). Silent one step at 150 bpm after.
      const f = [330, 294, 247, 220][s % 4]!;
      v.push({ wave: 'tri4', at, freq: f, to: f / 2, hold: 0.09, gain: 0.24, tick: 60 });
      v.push({ wave: 'lfsr', at, freq: 100000, hold: 0.01, gain: 0.06, d: 0.01, s: 0 });
    } else if (kind === 'crash') {
      // Long noise fading in the chip's volume steps (silent 0.59 s in) over the kick, which part 3 drops as it drops
      // every kick. At 0.36 (2026-10-14; 0.09 before) its first quarter second sits about 8 dB under the mix, where at
      // 0.09 it sat 20 dB under and went unheard (the owner, of the maze's new drums: "I didn't hear any new drums").
      if (part !== 3) v.push({ wave: 'tri4', at, freq: 180, to: 50, hold: 0.07, gain: 0.3, tick: 120 });
      v.push({ wave: 'lfsr', at, freq: 300000, hold: 0.8, gain: 0.36, d: 0.8, s: 0, vsteps: 15 });
    } else v.push({ wave: 'lfsr', at, freq: 400000, hold: 0.03, gain: 0.065, d: 0.03, s: 0 });
  },
  hats: (g, s) => !g.calm && s % 2 === 0,
};

const BANDS: Record<string, Band> = { console: CONSOLE };

export const MEZZO_PIANO = 10 ** (-6 / 20);

/** How loud each of the title's leads plays in a half bar: 1 is full, 0 silent. */
export interface TitleShare {
  /** The Console lead on the tune. */
  console: number;
  /** The square lead on the tune. */
  square: number;
  /** The square lead a third above the tune. */
  third: number;
}

/**
 * How the title's two leads share a half bar (eight steps from `half * 8`). The first pass is the Console lead alone.
 * Approved sample D set the second and fourth passes: the square leads at full with the Console under it at
 * mezzo-piano. The third pass (2026-10-12; the owner asked for interplay, both at mezzo-piano) is a conversation: in
 * each bar the Console asks with the rising half and the square answers with the high falling half; in the pass's last
 * bar they play together, the square a third above, which turns its G into a G7 leaning back to the top.
 */
export function titleShare(g: Song, half: number): TitleShare {
  const s = half * 8;
  const part = roleOf(g, 'lead', s);
  if (part === 1 || part === 3) return { console: MEZZO_PIANO, square: 1, third: 0 };
  if (part !== 2) return { console: 1, square: 0, third: 0 };
  const end = g.sections.find((x) => x.start > s)?.start ?? g.total;
  if (s >= end - 16) return { console: MEZZO_PIANO, square: 0, third: MEZZO_PIANO };
  return s % 16 < 8 ? { console: MEZZO_PIANO, square: 0, third: 0 } : { console: 0, square: MEZZO_PIANO, third: 0 };
}

/** The note a diatonic third above `f` in C major, the title's key (a major third for a note outside it). */
function thirdAbove(f: number): number {
  const KEY = [0, 2, 4, 5, 7, 9, 11];
  const m = midi(f);
  const i = KEY.indexOf(m % 12);
  if (i < 0) return fromMidi(m + 4);
  return fromMidi(m - KEY[i]! + KEY[(i + 2) % 7]! + (i + 2 >= 7 ? 12 : 0));
}

/** The title's two leads, shared out by `titleShare`, over the Console arrangement's bass, drums and harmony. */
function titleDuet(mix: Mix, g: Song): Mix {
  const duration = sec(g, g.total);
  const mainRaw = new Mix(duration + 1);
  const echoRaw = new Mix(duration + 1);
  const squareRaw = new Mix(duration + 1);
  const thirdRaw = new Mix(duration + 1);
  const volume = TRACKS.title!.channels[0]!.volume;
  // The first-draft oscillator envelope, using the same worker-safe synthesis as draft.ts.
  const square = (e: Note, f: number, part: number): Voice => {
    const dur = sec(g, e.len) * 0.95;
    return { wave: 'square', at: sec(g, e.s), freq: f, hold: dur,
      a: 0.0001, d: dur * 4.6 / Math.log(volume / 0.001), s: 0, r: 0.02,
      gain: volume * 0.85 * (part === 3 ? 0.22 / 0.3 : 1) };
  };
  for (const e of g.lead) {
    const part = roleOf(g, 'lead', e.s);
    if (part === null) continue;
    const base = consoleMelody(g, e, part);
    play(mainRaw, base);
    const echo = consoleEcho(g, e, base, part);
    if (echo) play(echoRaw, echo);
    play(squareRaw, square(e, e.f, part));
    if (titleShare(g, Math.floor(e.s / 8)).third) play(thirdRaw, square(e, thirdAbove(e.f), part));
  }
  const main = fold(finish(mainRaw, CONSOLE.fx), duration);
  const echo = fold(finish(echoRaw, CONSOLE.fx), duration);
  const tune = fold(squareRaw, duration);
  const third = fold(thirdRaw, duration);
  // Match melody loudness before applying the accepted relative dynamics.
  const match = 10 ** ((loudness(main).integrated - loudness(tune).integrated) / 20);
  scale(tune, match);
  scale(third, match);
  // The arrangement already holds the Console lead at full, and its echo in the third pass, which the conversation
  // leaves out so the trade stays clear. Every note ends before the next half bar, so the shares can switch there.
  for (let half = 0; half * 8 < g.total; half++) {
    const share = titleShare(g, half);
    const start = Math.round(sec(g, half * 8) * SR);
    const end = half * 8 + 8 >= g.total ? mix.length : Math.round(sec(g, half * 8 + 8) * SR);
    for (let i = start; i < end; i++) {
      mix.l[i]! += tune.l[i]! * share.square + third.l[i]! * share.third - main.l[i]! * (1 - share.console) - echo.l[i]!;
      mix.r[i]! += tune.r[i]! * share.square + third.r[i]! * share.third - main.r[i]! * (1 - share.console) - echo.r[i]!;
    }
  }
  // Bass, drums and harmony retain their original arrangement.
  return mix;
}

/**
 * Renders one whole loop of a draft track in a style, its tails folded onto its start so it loops with no seam. With
 * `until`, only the loop's opening (forGame.ts `OPENINGS`), for the tracks whose arrangement can stop early.
 */
export function arrange(style: string, name: string, only?: Layer[], dry = false, until?: number): Mix {
  const band = BANDS[style];
  if (!band) throw new Error(`No band ${style}`);
  const g = song(name);
  // `only` renders some layers alone and `dry` leaves the effects off, for measuring a mix (tools and tests).
  const has = (layer: Layer) => !only || only.includes(layer);
  // Beijing has its own instruments and score in the Console style (beijing.ts); the other styles arrange its skeleton.
  if (style === 'console' && name === 'field') return arrangeBeijing(g.step, has, dry, until);
  if (until !== undefined) throw new Error(`${style} cannot render ${name}'s opening alone`);
  // So has the street fights' music (kumite.ts).
  if (style === 'console' && name === 'kumite') return arrangeKumite(g.step, has, dry);
  // And the boss music, on the street fights' band for the tank (boss.ts).
  if (style === 'console' && name === 'boss') return arrangeBoss(g, has, dry);
  const loop = fold(mixSong(band, g, has, dry, style === 'console' && name === 'town' ? townColour : undefined), sec(g, g.total), g.loopFrom !== undefined);
  return style === 'console' && name === 'title' && has('lead') ? titleDuet(loop, g) : loop;
}

/**
 * A piece a track plays after a fight before its loop goes on (intros.ts), from its source's rows over its bars, in the
 * style's arrangement, unfolded: its last notes ring on into the loop.
 */
export function arrangeIntro(style: string, name: string, i: number): Mix {
  const band = BANDS[style];
  const set = INTROS[name];
  if (!band || !set) throw new Error(`${style} has no intros for ${name}`);
  return mixSong(band, song(`${name} intro ${i + 1}`, introTrack(set, i)), () => true, false);
}

/**
 * The town's own colour in its third and fourth passes, the tune's notes unchanged (the owner, 2026-10-20: "let's use
 * pass 3 and 4 to add instruments instead of changing the notes"). In pass 3, the break (music.ts), handclaps on the second
 * and fourth beats of each bar (the tune's snare is on the offbeats), and a beat of toms walking down into pass 4; a
 * second voice singing the tune a third below was tried there first and dropped ("I don't think that the instrument is
 * one that can pull a duet like that off"). In pass 4, beside the soft arpeggios, bells ring the tune an octave up on a
 * smooth triangle that dies away quickly, about as far under the whole as the arpeggios (some 12 dB).
 */
function townColour(v: Voice[], g: Song, at: (layer: Layer, s: number) => Part): void {
  const last = g.total;
  let fourth = last;
  const first = g.pickup ?? 0;  // the first bar
  for (let s = first; s < last; s++) if (at('drums', s) === 3) { fourth = s; break; }
  for (let s = 0; s < last; s++) {
    if (at('drums', s) !== 2) continue;
    const t = sec(g, s);
    if ((s - first) % 16 === 4 || (s - first) % 16 === 12) {
      // A clap: three quick bursts of noise and a short tail.
      for (const k of [0, 0.011, 0.022]) v.push({ wave: 'lfsr', at: t + k, freq: 120000, hold: 0.006, gain: 0.12, d: 0.006, s: 0 });
      v.push({ wave: 'lfsr', at: t + 0.033, freq: 120000, hold: 0.09, gain: 0.11, d: 0.09, s: 0, vsteps: 15 });
    }
    // The beat before pass 4's last two steps: four toms walking down, E4 D4 B3 A3.
    if (s >= fourth - 6 && s < fourth - 2) CONSOLE.drum(v, g, 'tom', s, 2, true);
  }
  for (const e of g.lead) {
    if (at('lead', e.s) !== 3) continue;
    v.push({ wave: 'tri', at: sec(g, e.s), freq: e.f * 2, hold: 0.02, gain: 0.25, a: 0.002, d: 0.22, s: 0, r: 0.25 });
  }
}

/** A song's notes in a band, with its effects, unfolded: its last notes ring on past its end. `extra`: a track's own voices. */
function mixSong(band: Band, g: Song, has: (layer: Layer) => boolean, dry: boolean, extra?: (v: Voice[], g: Song, at: (layer: Layer, s: number) => Part) => void): Mix {
  const v: Voice[] = [];
  // The part a layer plays at a step, or null where it is not rendered or the form leaves it out.
  const at = (layer: Layer, s: number) => (has(layer) ? roleOf(g, layer, s) : null);
  // The voices a layer's note just added, at its section's level.
  const levelled = (layer: 'lead' | 'bass' | 'drums', s: number, from: number) => {
    const l = levelOf(g, layer, s);
    if (l !== 1) for (let i = from; i < v.length; i++) v[i] = { ...v[i]!, gain: v[i]!.gain * l };
  };
  for (const e of g.lead) {
    const part = at('lead', e.s), from = v.length;
    if (part !== null) band.lead(v, g, e, part);
    levelled('lead', e.s, from);
  }
  for (const e of g.bass) {
    const part = at('bass', e.s), from = v.length;
    if (part !== null) band.bass(v, g, e, part);
    levelled('bass', e.s, from);
  }
  g.chords.forEach((c, i) => {
    const { at: w, steps } = g.halfBars[i]!;
    const part = at('harmony', w);
    if (c.length && part !== null) band.harmony(v, g, c, w, part, steps);
  });
  const drumSteps = new Set(g.drums.map((d) => d.s));
  for (const d of g.drums) {
    const part = at('drums', d.s), from = v.length;
    if (part !== null) band.drum(v, g, d.kind, d.s, part, false);
    levelled('drums', d.s, from);
  }
  if (band.hats && g.drums.length) {
    for (let s = 0; s < g.total; s++) {
      const part = at('drums', s);
      if ((part === 1 || part === 2) && !drumSteps.has(s) && band.hats(g, s)) band.drum(v, g, 'hat', s, part, true);
    }
  }
  extra?.(v, g, at);
  const end = Math.max(sec(g, g.total), ...v.map(voiceEnd));
  const mix = new Mix(end + (band.fx.reverb ? 2.5 : 0) + (band.fx.delay ? 1.5 : 0));
  for (const x of v) play(mix, x);
  return finish(mix, dry ? { ...band.fx, reverb: undefined, delay: undefined } : band.fx);
}

/** The music, by style. */
export const MUSIC: Record<string, (name: string) => Mix> = Object.fromEntries(Object.keys(BANDS).map((s) => [s, (name: string) => arrange(s, name)]));
