import { Mix, SR, finish, hz, play, rng, type Wave } from './dsp.ts';
import { REVIVAL_FORMANTS, REVIVAL_VOICES } from '../revival.ts';

/**
 * Revival's sound (2026-10-16): the choir and the sparkles, as the owner set them in the Revival sound lab
 * (tmp/revival_lab/, which renders with this file). The owner: "iterate a little on the resurrection sound ... a page
 * with sliders to be able to audio engineer it", then "add an option for sparkles too" and "i might try to overlap them".
 * - The choir: the first placeholder's voices (`REVIVAL_VOICES`, still the draft's and the level the game plays this
 *   effect at), each rendered at full level through its vowel and then shaped by its envelope, with a room.
 * - The sparkles: soft twinkles, quick at first and thinning out, their rate and level easing out to silence.
 * Mixed, then levelled by forGame.ts like any effect. Original synthesis; no samples.
 */

/** An easing: 0 at 0, 1 at 1. A rise follows it; a fall follows 1 minus it. */
export type Ease = (x: number) => number;
const expoIn = (x: number) => (2 ** (10 * x) - 1) / 1023;
export const EASES: Record<string, Ease> = {
  linear: (x) => x,
  sine_in: (x) => 1 - Math.cos((x * Math.PI) / 2),
  sine_out: (x) => Math.sin((x * Math.PI) / 2),
  sine_in_out: (x) => 0.5 - 0.5 * Math.cos(Math.PI * x),
  quad_in: (x) => x * x,
  quad_out: (x) => 1 - (1 - x) ** 2,
  quad_in_out: (x) => (x < 0.5 ? 2 * x * x : 1 - (2 - 2 * x) ** 2 / 2),
  cubic_in: (x) => x ** 3,
  cubic_out: (x) => 1 - (1 - x) ** 3,
  cubic_in_out: (x) => (x < 0.5 ? 4 * x ** 3 : 1 - (2 - 2 * x) ** 3 / 2),
  expo_in: expoIn,
  expo_out: (x) => 1 - expoIn(1 - x),
  expo_in_out: (x) => (x < 0.5 ? expoIn(2 * x) / 2 : 1 - expoIn(2 - 2 * x) / 2),
};

/** Chords, all major, as notes from the transposition's C. 'game' is the first choir's exact frequencies. */
export const CHORDS: Record<string, { label: string; notes: readonly number[] }> = {
  game: { label: 'C E G C, as in the game', notes: [] },
  high: { label: 'C E G C, an octave higher', notes: ['C5', 'E5', 'G5', 'C6'].map((n) => hz(n)) },
  open: { label: 'Open and wide: C G E C G', notes: ['C3', 'G3', 'E4', 'C5', 'G5'].map((n) => hz(n)) },
  airy: { label: 'With a ninth: C E G D', notes: ['C4', 'E4', 'G4', 'D5'].map((n) => hz(n)) },
  octaves: { label: 'Octaves only: C C C', notes: ['C3', 'C4', 'C5'].map((n) => hz(n)) },
};

/** Vowels the voices sing through (formant centres, Hz). The game's is "aah". */
export const VOWELS: Record<string, { label: string; formants: readonly number[] }> = {
  aah: { label: 'Aah, as in the game', formants: REVIVAL_FORMANTS },
  oh: { label: 'Oh', formants: [500, 850, 2400] },
  ooh: { label: 'Ooh', formants: [320, 870, 2250] },
  eh: { label: 'Eh', formants: [550, 1800, 2500] },
  ee: { label: 'Ee', formants: [290, 2250, 3000] },
  none: { label: 'No vowel (the bare wave)', formants: [] },
};

export const WAVES: Record<string, { label: string; wave: Wave }> = {
  saw: { label: 'Sawtooth, as in the game', wave: 'saw' },
  tri: { label: 'Triangle (softer)', wave: 'tri' },
  sine: { label: 'Sine (softest)', wave: 'sine' },
};

export interface ChoirParams {
  on: boolean;
  /** Every time below, stagger included, multiplied by this. */
  stretch: number;
  attack: number;
  attackEase: string;
  /** Time to fall to the sustain level, and how. 'game' is dsp.ts's exponential approach. */
  decay: number;
  decayEase: string;
  sustain: number;
  /** From each voice's start to its release. */
  hold: number;
  release: number;
  /** 'game' is dsp.ts's release: fast, then a short tail. */
  releaseEase: string;
  /** Seconds between one chord note's entry and the next. */
  stagger: number;
  transpose: number;
  chord: string;
  voices: number;
  detune: number;
  wave: string;
  vowel: string;
  /** Formant centres multiplied by this: below 1 darker, above brighter. */
  vowelShift: number;
  /** Formant sharpness (dsp.ts's fq). */
  sharpness: number;
  vibrato: number;
  vibratoRate: number;
  width: number;
  /** Reverb send, and the room's size and darkness. */
  echo: number;
  room: number;
  damp: number;
  /** This layer's level in the mix, dB. */
  level: number;
}

export interface SparkleParams {
  on: boolean;
  /** Seconds from the cue's start (the picture's start) to the first twinkle. */
  start: number;
  /** Seconds to silence. */
  length: number;
  /** Twinkles a second at first. */
  rate: number;
  /** 'exp' is an exponential ease (sudden, long tail), steep by `steepness`; or one of EASES, falling. */
  ease: string;
  steepness: number;
  /** Twinkle pitches up or down by octaves. */
  octave: number;
  /** How long each twinkle rings, as a multiple of the original. */
  ring: number;
  echo: number;
  room: number;
  level: number;
}

export interface RevivalParams {
  choir: ChoirParams;
  sparkles: SparkleParams;
}

const first = REVIVAL_VOICES[0]!;
// Rounded to a millionth, so they come out as the written values and the voices' frequencies exactly.
const micro = (x: number) => Math.round(x * 1e6) / 1e6;
/** The first choir's notes, from its voices (two per note, `side * 4` cents either way). */
const FIRST_NOTES = REVIVAL_VOICES.filter((_, i) => i % 2 === 0).map((v, i) => micro(Math.sqrt(v.freq * REVIVAL_VOICES[i * 2 + 1]!.freq)));

/**
 * Where the lab started: the first choir exactly (its room was asked for but sent nothing), and the sparkles as the
 * owner first heard them on the listening page (tmp/cues/revival_long/claude_candidates/sparkles.ts).
 */
export const REVIVAL_FIRST: RevivalParams = {
  choir: {
    on: true, stretch: 1,
    attack: first.a, attackEase: 'linear', decay: first.d, decayEase: 'game', sustain: first.s,
    hold: first.hold, release: first.r, releaseEase: 'game', stagger: REVIVAL_VOICES[2]!.at,
    transpose: 0, chord: 'game', voices: 2, detune: micro((1200 * Math.log2(REVIVAL_VOICES[1]!.freq / first.freq)) / 2),
    wave: 'saw', vowel: 'aah', vowelShift: 1, sharpness: first.fq, vibrato: 0, vibratoRate: 5, width: 0,
    echo: 0, room: 0.3, damp: 0.45, level: 0,
  },
  sparkles: { on: false, start: 0, length: 2, rate: 70, ease: 'exp', steepness: 0.7, octave: 0, ring: 1, echo: 0, room: 0.72, level: 0 },
};

/**
 * The game's (the owner's lab settings, 2026-10-16): the choir slower, starting at once, falling lower and releasing
 * long, four voices a note spread across the stereo field in a big dark room; the sparkles over it, twice as long and
 * busier at first, in a big room too.
 */
export const REVIVAL_CUE: RevivalParams = {
  choir: { ...REVIVAL_FIRST.choir, stretch: 2.2, attack: 0, sustain: 0.35, hold: 0.63, release: 1, stagger: 0.025, voices: 4, width: 1, echo: 1, room: 1, damp: 1 },
  sparkles: { ...REVIVAL_FIRST.sparkles, on: true, length: 4, rate: 150, steepness: 1.5, echo: 1, room: 1 },
};

/** One voice's level at `t` seconds into it; with the first choir's settings, dsp.ts's envelope. */
export function envelopeAt(c: ChoirParams, t: number): number {
  const k = c.stretch;
  const a = c.attack * k, d = c.decay * k, h = c.hold * k, r = Math.max(c.release * k, 1 / SR);
  const rise = EASES[c.attackEase] ?? EASES.linear!;
  const fall = c.decayEase === 'game' ? null : EASES[c.decayEase] ?? EASES.linear!;
  const before = (x: number) => {
    if (x < a) return rise(x / a);
    // No decay: straight to the sustain level at the peak (dsp.ts would hold at full level).
    if (d <= 0) return c.sustain;
    if (!fall) return c.sustain + (1 - c.sustain) * Math.exp((-4.6 * (x - a)) / d);
    const y = (x - a) / d;
    return y >= 1 ? c.sustain : 1 - (1 - c.sustain) * fall(y);
  };
  if (t < h) return before(t);
  const x = (t - h) / r;
  if (x >= 1) return 0;
  const out = c.releaseEase === 'game' ? Math.exp(-4.6 * x) * (1 - x) : 1 - (EASES[c.releaseEase] ?? EASES.linear!)(x);
  return before(h) * out;
}

/** The choir's voices: where each starts, its pitch, pan and level. */
export function choirVoices(c: ChoirParams): Array<{ at: number; freq: number; pan: number; gain: number }> {
  const notes = c.chord === 'game' || !CHORDS[c.chord] ? FIRST_NOTES : CHORDS[c.chord]!.notes;
  // With no detune a note's voices would be one wave stacked in phase (louder, and panned back to the middle), so it
  // gets a single voice as loud as two unrelated ones, and the width spreads the chord's notes instead.
  const n = c.detune > 0 ? Math.max(1, Math.round(c.voices)) : 1;
  const alone = n === 1 && Math.round(c.voices) > 1 ? Math.sqrt(2) : Math.sqrt(2 / n);
  // Two voices sit at either side, as the first choir's do; more spread evenly between.
  const offsets = n === 1 ? [0] : Array.from({ length: n }, (_, j) => -1 + (2 * j) / (n - 1));
  const shift = 2 ** (c.transpose / 12);
  const out: Array<{ at: number; freq: number; pan: number; gain: number }> = [];
  notes.forEach((f, i) => {
    const spread = notes.length > 1 ? (i / (notes.length - 1)) * 2 - 1 : 0;
    for (const side of offsets) {
      out.push({
        at: i * c.stagger * c.stretch,
        freq: f * shift * 2 ** ((side * c.detune) / 1200),
        pan: c.width * (n > 1 ? side : spread),
        gain: first.gain * alone,
      });
    }
  });
  return out;
}

/** The choir alone, rendered and trimmed as sfx.ts's render() does. */
export function renderChoir(c: ChoirParams): Mix {
  const voices = choirVoices(c);
  const k = c.stretch;
  const span = c.hold * k + c.release * k;
  // Summed in the order sfx.ts sums a voice's end (at + hold + release), so the lengths agree to the sample.
  const voiceEnd = (at: number) => at + c.hold * k + c.release * k;
  const end = Math.max(...voices.map((v) => voiceEnd(v.at)));
  const fx = { reverb: { room: c.room, damp: c.damp, wet: 0.18 } };
  // sfx.ts's tail; with something sent to the room, long enough for Freeverb's longest comb to fall 60 dB, up to 12 s
  // (at room 1 it would take 12.7 s; the cue is trimmed where it falls under 3e-4 long before that).
  const feedback = c.room * 0.28 + 0.7;
  const ring = (1617 / SR) * (-3 / Math.log10(feedback)) + 0.2;
  const mix = new Mix(end + Math.max(0.03, 0.4 + fx.reverb.room * 2.2, c.echo > 0 ? Math.min(12, ring) : 0));
  const vowel = (VOWELS[c.vowel] ?? VOWELS.aah!).formants.map((f) => f * c.vowelShift);
  const wave = (WAVES[c.wave] ?? WAVES.saw!).wave;
  const flat = new Mix(mix.seconds);
  for (const v of voices) {
    flat.l.fill(0);
    flat.r.fill(0);
    // Full level from its first sample to the end of its release; its envelope is applied below.
    play(flat, {
      wave, at: v.at, freq: v.freq, gain: v.gain, pan: v.pan, a: 1e-9, d: 0, s: 1, hold: span, r: 1e-9,
      ...(vowel.length ? { formants: vowel, fq: c.sharpness } : {}),
      ...(c.vibrato > 0 ? { vib: [c.vibratoRate, c.vibrato, 0.1, 0.25] as [number, number, number, number] } : {}),
    });
    const start = Math.round(v.at * SR);
    const stop = Math.min(mix.length, Math.round((voiceEnd(v.at) + 1e-9) * SR));
    for (let i = start; i < stop; i++) {
      const e = envelopeAt(c, (i - start) / SR);
      const l = flat.l[i]! * e, r = flat.r[i]! * e;
      mix.l[i]! += l;
      mix.r[i]! += r;
      if (c.echo > 0) {
        mix.verbL[i]! += l * c.echo;
        mix.verbR[i]! += r * c.echo;
      }
    }
  }
  finish(mix, fx);
  return trimmed(mix, end);
}

/** sfx.ts's render() ending: silence trimmed off the end, then a 5 ms fade. */
export function trimmed(mix: Mix, end: number): Mix {
  let last = mix.length - 1;
  while (last > 0 && Math.abs(mix.l[last]!) < 3e-4 && Math.abs(mix.r[last]!) < 3e-4) last--;
  const out = new Mix(Math.max(last + 1, Math.round(end * SR)) / SR + 0.005);
  out.l.set(mix.l.subarray(0, out.length));
  out.r.set(mix.r.subarray(0, out.length));
  const fade = Math.min(out.length, Math.round(0.005 * SR));
  for (let i = 0; i < fade; i++) {
    const g = i / fade;
    out.l[out.length - 1 - i]! *= g;
    out.r[out.length - 1 - i]! *= g;
  }
  return out;
}

/** The sparkles' taper from 1 at their start to 0 at their end, `t` seconds in. */
export function taperAt(s: SparkleParams, t: number, tau = s.steepness): number {
  if (t >= s.length) return 0;
  if (t <= 0) return 1;
  if (s.ease === 'exp') {
    const end = Math.exp(-s.length / tau);
    return (Math.exp(-t / tau) - end) / (1 - end);
  }
  return 1 - (EASES[s.ease] ?? EASES.linear!)(t / s.length);
}

const SPARKLE_SEED = 0x73706b6c;
const SPARKLE_NOTES = ['C6', 'D6', 'E6', 'G6', 'A6', 'C7', 'D7', 'E7', 'G7', 'A7'];

/** When the twinkles come, from the sparkles' start: the rate falls with the taper, so they space out. */
export function sparkleTimes(s: SparkleParams): number[] {
  const random = rng(SPARKLE_SEED);
  const out: number[] = [];
  if (s.ease === 'exp') {
    // A rate of rate * e^(-t/tau), inverted in closed form.
    const tau = s.steepness;
    const expected = s.rate * tau * (1 - Math.exp(-s.length / tau));
    const total = Math.floor(expected);
    for (let k = 0; k < total; k++) {
      const u = (k + 0.5 + (random() - 0.5) * 0.7) / (s.rate * tau);
      out.push(0.005 - tau * Math.log(1 - Math.min(u, 0.999)));
    }
    // Fewer than one expected: one twinkle where half of that much has come, rather than silence.
    if (total === 0 && expected > 0) out.push(0.005 - tau * Math.log(1 - expected / 2 / (s.rate * tau)));
  } else {
    // The expected count so far, summed in 1 ms steps, inverted by walking it.
    const step = 0.001, counts = [0];
    for (let t = step; t <= s.length + step / 2; t += step) counts.push(counts.at(-1)! + s.rate * taperAt(s, t - step / 2) * step);
    const expected = counts.at(-1)!;
    const total = Math.floor(expected);
    let j = 0;
    for (let k = 0; k < total; k++) {
      const want = k + 0.5 + (random() - 0.5) * 0.7;
      while (j + 1 < counts.length && counts[j + 1]! < want) j++;
      const within = (want - counts[j]!) / Math.max(1e-9, counts[j + 1]! - counts[j]!);
      out.push(0.005 + (j + Math.max(0, Math.min(1, within))) * step);
    }
    if (total === 0 && expected > 0) {
      let half = 0;
      while (half + 1 < counts.length && counts[half + 1]! < expected / 2) half++;
      out.push(0.005 + half * step);
    }
  }
  return out.filter((t) => t < s.length);
}

/** One soft twinkle: a sine with a faint inharmonic partial, a quick rise and an exponential ring. */
function twinkle(m: Mix, at: number, f: number, attack: number, ring: number, gain: number, pan: number): void {
  const s0 = Math.round(at * SR), n = Math.round((attack + ring * 4) * SR);
  const L = Math.cos(((pan + 1) * Math.PI) / 4), R = Math.sin(((pan + 1) * Math.PI) / 4);
  for (let i = 0; i < n && s0 + i < m.length; i++) {
    const t = i / SR;
    const rise = t < attack ? Math.sin((Math.PI / 2) * (t / attack)) ** 2 : 1;
    const env = rise * Math.exp(-Math.max(0, t - attack) / ring) * Math.min(1, (n - i) / (n * 0.1));
    const v = gain * env * (Math.sin(2 * Math.PI * f * t) + (f * 2.76 < 7000 ? 0.12 * Math.sin(2 * Math.PI * 2.76 * f * t) : 0));
    m.l[s0 + i]! += v * L;
    m.r[s0 + i]! += v * R;
  }
}

/** The sparkles alone, from their own start. */
export function renderSparkles(s: SparkleParams): Mix {
  const random = rng(SPARKLE_SEED + 1);
  const m = new Mix(Math.max(2.8, s.length + 0.8));
  const lift = 2 ** s.octave;
  for (const at of sparkleTimes(s)) {
    const f = hz(SPARKLE_NOTES[Math.floor(random() * SPARKLE_NOTES.length)]!) * lift;
    const attack = 0.01 + random() * 0.012, ring = (0.07 + random() * 0.09) * s.ring;
    const gain = 0.095 * taperAt(s, at) * (0.6 + random() * 0.4), pan = (random() * 2 - 1) * 0.9;
    twinkle(m, at, f, attack, ring, gain, pan);
  }
  if (s.echo > 0) for (let i = 0; i < m.length; i++) { m.verbL[i] = m.l[i]! * s.echo; m.verbR[i] = m.r[i]! * s.echo; }
  finish(m, { lp: 7000, reverb: { room: s.room, damp: 0.5, wet: 0.34 } });
  // The whole, echo included, follows a gentler form of the taper, so nothing rings on past the end.
  const tau = (s.steepness / 0.7) * 1.2;
  for (let i = 0; i < m.length; i++) {
    const g = Math.sqrt(s.ease === 'exp' ? taperAt(s, i / SR, tau) : taperAt(s, i / SR));
    m.l[i]! *= g;
    m.r[i]! *= g;
  }
  return m;
}

/**
 * The layers that are on, balanced by their levels and mixed, before levelling. Only the difference between the
 * layer levels counts (the louder layer is added at its own level), so a layer alone always sounds the same.
 */
export function revivalLayers(p: RevivalParams): { mix: Mix; choir: Mix | null; sparkles: Mix | null } {
  const choir = p.choir.on ? renderChoir(p.choir) : null;
  const sparkles = p.sparkles.on ? renderSparkles(p.sparkles) : null;
  if (choir && !sparkles) return { mix: choir, choir, sparkles };
  const at = Math.round(Math.max(0, p.sparkles.start) * SR);
  const len = Math.max(choir?.length ?? 0, sparkles ? at + sparkles.length : 0, 1);
  const sum = new Mix(len / SR);
  const add = (m: Mix, from: number, db: number) => {
    const g = 10 ** (db / 20);
    for (let i = 0; i < m.length && from + i < sum.length; i++) { sum.l[from + i]! += m.l[i]! * g; sum.r[from + i]! += m.r[i]! * g; }
  };
  const top = Math.max(choir ? p.choir.level : -Infinity, sparkles ? p.sparkles.level : -Infinity);
  if (choir) add(choir, 0, p.choir.level - top);
  if (sparkles) add(sparkles, at, p.sparkles.level - top);
  return { mix: sparkles ? trimmed(sum, choir ? choir.length / SR - 0.005 : 0) : sum, choir, sparkles };
}
