// An 80s hard-rock guitar for the Berlin sketch (the owner, 2026-10-18: "80s electric guitar Van Halen style ... I
// wouldn't want to do it if a MIDI guitar sounds too synthetic"). There are no guitar samples here, so it is modelled:
// plucked strings (the synth's Karplus-Strong pluck) summed, then an amp built here (a mid push, two clipping stages,
// the second lopsided as a valve's is) and a 4x12 cabinet's filtering. Tapped runs; nothing is quoted. Berlin is F# minor at 120 bpm; bars 9 to 16 are the Wall.
import { Mix, SR, hz, play, type Voice } from './dsp.ts';

const TAU = Math.PI * 2;

/** An RBJ biquad: low-pass, high-pass or peaking, one channel. */
class Filter {
  private b = [1, 0, 0];
  private a = [0, 0];
  private x1 = 0; private x2 = 0; private y1 = 0; private y2 = 0;
  constructor(kind: 'lp' | 'hp' | 'peak', f: number, q: number, db = 0, rate = SR) {
    const w = (TAU * f) / rate, cs = Math.cos(w), al = Math.sin(w) / (2 * q);
    let b0: number, b1: number, b2: number, a0: number, a1: number, a2: number;
    if (kind === 'peak') {
      const A = 10 ** (db / 40);
      b0 = 1 + al * A; b1 = -2 * cs; b2 = 1 - al * A; a0 = 1 + al / A; a1 = -2 * cs; a2 = 1 - al / A;
    } else if (kind === 'lp') {
      b0 = (1 - cs) / 2; b1 = 1 - cs; b2 = b0; a0 = 1 + al; a1 = -2 * cs; a2 = 1 - al;
    } else {
      b0 = (1 + cs) / 2; b1 = -(1 + cs); b2 = b0; a0 = 1 + al; a1 = -2 * cs; a2 = 1 - al;
    }
    this.b = [b0 / a0, b1 / a0, b2 / a0];
    this.a = [a1 / a0, a2 / a0];
  }
  run(x: number): number {
    const y = this.b[0]! * x + this.b[1]! * this.x1 + this.b[2]! * this.x2 - this.a[0]! * this.y1 - this.a[1]! * this.y2;
    this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y;
    return y;
  }
}

/**
 * The amp and cabinet, in place, on a mono mix (both sides are the same). The two clipping stages run four times over
 * (176.4 kHz) so their harmonics above the audible band do not fold back down as off-key tones, the fizz that gives a
 * modelled guitar away; the cabinet runs at the normal rate. `os` 1 runs it without, for the comparison in check_rock.ts.
 * `tone` sets the second stage, the valve's lopsidedness, the mid push and the cabinet's low-mid dip (TONE by default).
 */
export function amp(m: Mix, drive = 16, os = 4, from = 0, until = m.length, tone: Tone = TONE): void {
  const R = SR * os;
  const pre = [new Filter('hp', 110, 0.7), new Filter('peak', 820, 0.8, tone.midDb)];
  const up = os > 1 ? [new Filter('lp', 18000, 0.54, 0, R), new Filter('lp', 18000, 1.31, 0, R)] : [];
  const mid = [new Filter('lp', 7000, 0.7, 0, R), new Filter('hp', 140, 0.7, 0, R)];
  const down = os > 1 ? [new Filter('lp', 17000, 0.52, 0, R), new Filter('lp', 17000, 0.71, 0, R), new Filter('lp', 17000, 1.93, 0, R)] : [];
  const cab = [new Filter('hp', 85, 0.8), new Filter('peak', 420, 1.2, tone.scoopDb), new Filter('peak', 2100, 1.4, 3.5), new Filter('lp', 4600, 0.8), new Filter('lp', 4900, 1.0)];
  const bias = tone.bias, off = Math.tanh(bias), stage2 = tone.stage2;
  let last = 0;
  for (let i = from; i < until; i++) {
    let x = m.l[i]!;
    for (const f of pre) x = f.run(x);
    let y = 0;
    for (let k = 1; k <= os; k++) {
      let u = last + (x - last) * (k / os);
      for (const f of up) u = f.run(u);
      u = Math.tanh(u * drive);
      for (const f of mid) u = f.run(u);
      u = Math.tanh(u * stage2 + bias) - off;
      for (const f of down) u = f.run(u);
      y = u;
    }
    last = x;
    for (const f of cab) y = f.run(y);
    m.l[i] = y;
    m.r[i] = y;
  }
}

/** The amp's voicing past its drive: the second stage's gain, the valve's lopsidedness, the mid push and the cabinet at 420 Hz (dB). */
export interface Tone { stage2: number; bias: number; midDb: number; scoopDb: number }
/** The amp as both guitarists play through it. */
const TONE: Tone = { stage2: 3, bias: 0.18, midDb: 7, scoopDb: -5 };

type Hit = {
  s: number; len: number; notes: string[]; kind: 'open' | 'mute' | 'tap' | 'lead' | 'power' | 'scream'; bend?: [number, number][]; vib?: boolean;
  /** Played on its own and faded after the amp, from and to these seconds after it starts (a fade before the amp is squashed by it). */
  fade?: [number, number];
};

/**
 * The part, in steps of a sixteenth. Second version (the owner, 2026-10-18: "The tapped run is the most convincing part.
 * Would you be able to refactor the electric guitar solo so that it has less over the held notes and more of the taps?"):
 * the held chords, bends and palm mutes are gone; it is tapped runs, six notes a beat, each a tap and two pull-offs over
 * the chord. A pickup into the Wall, a run on each of the Wall's chords with a beat or two of rest after, the climb up
 * C# at the Wall's end, a fall down F# as the street returns, and a pickup back to the top of the loop.
 */
const CELLS: Record<string, string[][]> = {
  'F#': [['C#5', 'A4', 'F#4'], ['F#5', 'C#5', 'A4'], ['A5', 'C#5', 'A4'], ['F#5', 'C#5', 'A4'], ['C#5', 'A4', 'F#4'], ['A4', 'F#4', 'C#4']],
  D: [['A4', 'F#4', 'D4'], ['D5', 'A4', 'F#4'], ['F#5', 'A4', 'F#4'], ['D5', 'A4', 'F#4'], ['A4', 'F#4', 'D4'], ['F#4', 'D4', 'A3']],
  B: [['F#4', 'D4', 'B3'], ['B4', 'F#4', 'D4'], ['D5', 'B4', 'F#4'], ['B4', 'F#4', 'D4'], ['F#4', 'D4', 'B3'], ['D4', 'B3', 'F#3']],
  'C#': [['G#4', 'F4', 'C#4'], ['C#5', 'G#4', 'F4'], ['F5', 'C#5', 'G#4'], ['C#5', 'G#4', 'F4'], ['G#4', 'F4', 'C#4'], ['F4', 'C#4', 'G#3']],
};
const CLIMB = [['C#5', 'G#4', 'F4'], ['D#5', 'G#4', 'F4'], ['F5', 'C#5', 'G#4'], ['G#5', 'C#5', 'G#4']];

/** One beat of taps: a cell of three, twice, at `beat` (in beats from the loop's start). */
function tapBeat(out: Hit[], beat: number, cell: string[]): void {
  for (let k = 0; k < 6; k++) out.push({ s: beat * 4 + (k * 4) / 6, len: 4 / 6, notes: [cell[k % 3]!], kind: 'tap' });
}

export function rockHits(): Hit[] {
  const out: Hit[] = [];
  const beatOf = (barN: number, b: number) => (barN - 1) * 4 + b;
  // Bar 8's last beat: a pickup down F# into the Wall.
  tapBeat(out, beatOf(8, 3), CELLS['F#']![5]!);
  // The Wall, two bars a chord: up the chord for a bar, down for two beats, two beats' rest.
  for (const [b, c] of [[9, 'F#'], [11, 'D'], [13, 'B']] as const) {
    const cells = CELLS[c]!;
    for (let k = 0; k < 4; k++) tapBeat(out, beatOf(b, k), cells[k]!);
    tapBeat(out, beatOf(b + 1, 0), cells[4]!);
    tapBeat(out, beatOf(b + 1, 1), cells[5]!);
  }
  // C#, bars 15 and 16: up the chord, then the climb to the top.
  for (let k = 0; k < 4; k++) tapBeat(out, beatOf(15, k), CELLS['C#']![k]!);
  CLIMB.forEach((cell, k) => tapBeat(out, beatOf(16, k), cell));
  // The street returns: two beats falling down F#, then out of the way.
  tapBeat(out, beatOf(17, 0), CELLS['F#']![2]!);
  tapBeat(out, beatOf(17, 1), CELLS['F#']![4]!);
  // Bar 24's last beat: a pickup down C# back to the top.
  tapBeat(out, beatOf(24, 3), CELLS['C#']![5]!);
  return out;
}

/**
 * The second guitarist (the owner, 2026-10-18: "adding a power chord at the end of the runs in the middle, with a split
 * second held before hitting the wammy bar real fast a couple times, fading out as the next run begins (so kinda like
 * there are two battling guitarists) ... and then maybe that last run just has the two guitarists harmonizing their run
 * as they go out on top?"). After each of the Wall's three runs, in its two beats' rest, a power chord on that run's
 * chord rings while it fades into the next run (the whammy came out in the sixth round, below). On the C# climb at the
 * Wall's end the second guitarist taps the same run a third above.
 */
const POWER: Record<string, string[]> = { 'F#': ['F#2', 'C#3', 'F#3'], D: ['D3', 'A3', 'D4'], B: ['B2', 'F#3', 'B3'] };
/**
 * Rounds two to five held the chords longer and moved and varied the whammy's dips. Sixth round (the owner, 2026-10-18,
 * on the slider page .scratch/berlin_growl/: "add more growling distortion to the power chords", then "I actually think
 * this sounds better without a whammy"): no whammy; the chord is struck and held still while it fades, through the
 * same amp driven far harder (96, from 16) with the owner's voicing. Then the fade, which the owner set on the same page
 * after trying it 2 s longer ("Chord level -1.0 dB, Fade begins 0.00 s, Fade lasts 3.0 s, Fade shape S-curve", then
 * "set it to 2.0s and it transitions cleaner"): from the moment it is struck to silence 2 s later, along an S-curve
 * (slow to start, quicker through the middle, easing into silence), 1 dB down.
 */
const CHORD_FADE: [number, number] = [0, 2], CHORD_END = CHORD_FADE[1];
const CHORD_DRIVE = 96, CHORD_TONE: Tone = { stage2: 12, bias: 0.8, midDb: 15, scoopDb: 8 }, CHORD_LEVEL = 10 ** (-1 / 20);
/** The chords' fade, from 1 at its start (x 0) to 0 at its end (x 1). */
const sCurve = (x: number) => 1 - x * x * (3 - 2 * x);
/** The scream: B5 bent up to C#6, then a wide vibrato that grows, held while it fades. */
const SCREAM: [number, number][] = [[0, 0], [0.12, 2], [0.3, 2], ...Array.from({ length: 68 }, (_, k) => { const t = 0.3 + k * 0.085, w = Math.min(0.45, 0.15 + k * 0.03); return [t + 0.0425, 2 + w] as [number, number]; }).flatMap((pt, k) => [pt, [0.3 + (k + 1) * 0.085, 2 - Math.min(0.45, 0.15 + k * 0.03) * 0.6] as [number, number]])];
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const midiOf = (n: string) => { const m = /^([A-G]#?)(-?\d)$/.exec(n)!; return NAMES.indexOf(m[1]!) + 12 * (Number(m[2]) + 1); };
const nameOf = (m: number) => `${NAMES[m % 12]}${Math.floor(m / 12) - 1}`;
/** A third above, in the key over C# (C# to E#, D# to F#, E# to G#, G# to B). */
const thirdAbove = (n: string) => { const m = midiOf(n); const up: Record<number, number> = { 1: 4, 3: 3, 5: 3, 8: 3 }; return nameOf(m + up[m % 12]!); };

export function rockHits2(): Hit[] {
  const out: Hit[] = [];
  const beatOf = (barN: number, b: number) => (barN - 1) * 4 + b;
  for (const [b, c] of [[10, 'F#'], [12, 'D'], [14, 'B']] as const) out.push({ s: beatOf(b, 2) * 4, len: 8, notes: POWER[c]!, kind: 'power', fade: CHORD_FADE });
  // The C# run and climb, a third above. The B chord is still dying away as this starts: the cheat a record would make
  // with an overdub, carried on this one track.
  const lead = rockHits().filter((h) => h.s >= beatOf(15, 0) * 4 && h.s < beatOf(17, 0) * 4);
  for (const h of lead) out.push({ ...h, notes: h.notes.map(thirdAbove) });
  // The street returns: while the first guitarist keeps running higher, this one ends on a screaming high C#.
  // Held 2.0 s, then a long fade (the owner: "instead of ending right there let's have it fade out even longer -- just that
  // it does start to taper off more at where it ends right now"): 16 dB down at 3.6 s, where it used to end, and gone by 6 s.
  out.push({ s: beatOf(17, 0) * 4, len: 16, notes: ['B5'], kind: 'scream', bend: SCREAM, fade: [2.0, 6.0] });
  return out;
}

/** The dry guitar through its amp, `seconds` long plus a tail (fold it to the loop). */
export function rockGuitar(step: number, seconds: number, seed = 900, hits: Hit[] = rockHits(), opening = false): Mix {
  let n = seed;
  const voicesOf = (h: Hit): Voice[] => {
    const at = h.s * step;
    return h.notes.map((note, i) => {
      const strum = h.kind === 'open' || h.kind === 'mute' || h.kind === 'power' ? i * 0.006 : 0;
      const common = { wave: 'pluck' as const, at: at + strum, freq: hz(note), a: 0.001, seed: n++ };
      if (h.kind === 'mute') return { ...common, hold: 0.07, r: 0.03, gain: 0.22, decay: 0.965, bright: 0.28 };
      if (h.kind === 'tap') return { ...common, hold: h.len * step * 0.95, r: 0.02, gain: 0.2, decay: 0.997, bright: 0.22 };
      // Struck hard and let ring; its fade comes after the amp.
      if (h.kind === 'power') return { ...common, hold: CHORD_END, r: 0.05, gain: 0.22, decay: 0.9985, bright: 0.66 };
      // The scream's pick attack; its sustain is the steady tone added below.
      if (h.kind === 'scream') return { ...common, hold: h.fade![1], r: 0.05, gain: 0.26, decay: 0.9985, bright: 0.75, bend: h.bend! };
      const hold = h.len * step * 0.96;
      return { ...common, hold, r: 0.06, gain: h.kind === 'lead' ? 0.26 : 0.2, decay: 0.9985, bright: 0.62,
        ...(h.bend ? { bend: h.bend } : {}), ...(h.vib && hold > 0.3 ? { vib: [5.6, 0.22, 0.22, 0.15] as [number, number, number, number] } : {}) };
    });
  };
  const m = new Mix(opening ? seconds : seconds + 3);
  if (opening && hits.every(h => Math.round(h.s * step * SR) >= m.length)) return m;
  let first = m.length;
  for (const h of hits) if (!h.fade) for (const v of voicesOf(h)) {
    first = Math.min(first, Math.round(v.at * SR));
    play(m, v);
  }
  // The amp's exact zero state is unchanged by a silent prefix. Keep absolute voice times and sample indices.
  amp(m, 16, 4, Math.min(first, m.length));
  // Each faded hit through its own amp, then down 40 dB evenly from the fade's start to its end (the power chords along
  // their S-curve instead), then silent.
  for (const h of hits) {
    if (!h.fade) continue;
    const one = new Mix(m.seconds);
    for (const v of voicesOf(h)) play(one, v);
    // A screaming note sustains as feedback holds it. Making up the plucked string's loss let it grow without bound under
    // the amp until it overflowed and cut out (about 2.4 s in), so a steady tone at the same bent pitch swells in under
    // the pick instead and keeps the amp singing, as a guitar synthesizer sustains a note.
    if (h.kind === 'scream') play(one, { wave: 'saw', at: h.s * step, freq: hz(h.notes[0]!), hold: h.fade![1], a: 0.35, d: 0.1, s: 1, r: 0.05, gain: 0.07, lp: 2600, bend: h.bend! });
    const t0 = h.s * step, [a, b] = h.fade;
    // The amp starts from silence; after the post-amp fade reaches zero none of its tail can be heard.
    // Processing only this absolute sample span preserves every retained sample and skips whole-loop silence.
    // The power chords through the amp driven harder and voiced for growl, faded along their S-curve (the sixth round).
    const power = h.kind === 'power', level = power ? CHORD_LEVEL : 1;
    amp(one, power ? CHORD_DRIVE : 16, 4, Math.min(one.length, Math.round(t0 * SR)), Math.min(one.length, Math.ceil((t0 + b) * SR)), power ? CHORD_TONE : TONE);
    for (let i = 0; i < one.length; i++) {
      const t = i / SR - t0;
      const g = t < a ? 1 : t >= b ? 0 : power ? sCurve((t - a) / (b - a)) : 10 ** ((-40 * (t - a)) / (b - a) / 20);
      m.l[i]! += one.l[i]! * g * level;
      m.r[i]! += one.r[i]! * g * level;
    }
  }
  return m;
}
