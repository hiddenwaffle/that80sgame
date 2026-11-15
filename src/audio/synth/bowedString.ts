/**
 * Beijing's fiddle as a modelled bowed string (2026-10-12 and 13). The owner found the first fiddle, a pulse wave
 * through three broad resonances, the most synthetic voice in the loop, and it is the one that carries the tune and holds
 * its notes. Here a string is simulated as two delay lines either side of the bow, driven by the bow's stick and slip
 * (the friction curve of the Synthesis ToolKit's bowed string, after McIntyre, Schumacher and Woodhouse), so a stroke's
 * start, its settling into a tone and the small unevenness come from the model rather than being laid on top.
 *
 * The bowing comes from the score: strokes and bow changes (a quick reversal inside a phrase), short notes slurred,
 * phrases shaped, and a player who hears the string slip twice a cycle and presses harder. A long note swells as a
 * player shapes it, the bow faster, nearer the bridge and heavier, so its tone brightens, then tapers off softer and
 * darker. The left hand carries one vibrato through a phrase, changes notes in a few milliseconds and plays the score's
 * slides and falls. Rosin noise rides on the tone, most where a phrase starts; the erhu's other string rings in sympathy;
 * and the string sounds through a body of many narrow resonances shaped around an erhu's formants, so the vibrato moves
 * each overtone through them and the tone shimmers.
 *
 * The owner chose "more colour, more taper" (2026-10-13); the defaults below are that version. Every figure in the
 * comments was measured on this model with a control (the scripts were in tmp/polish_audio/design2/; the tests in
 * tests/bowed_string.test.ts keep the main ones).
 */
import { BEIJING_BPM } from '../beijingScore.ts';
import type { BeijingEvent } from './beijing.ts';
import { SR, rng } from './dsp.ts';

const STEP = 60 / BEIJING_BPM / 4;
const TAU = Math.PI * 2;

export interface BowOptions {
  /** Vibrato on (off for pitch checks). Most options exist so checks can take the model apart; the game uses the defaults. */
  vibrato?: boolean;
  /** Rosin noise level (0 for checks of the string alone). */
  rosin?: number;
  /** Small random unevenness in the bow's grip. */
  jitter?: number;
  /** The body's resonances (off: the bare string). */
  body?: boolean;
  /** A player's intonation: each note a cent or two off (off for pitch checks). */
  intonation?: boolean;
  /** The bow's speed and the friction curve's slope (lower presses harder), for probing. */
  speed?: number;
  slope?: number;
  /** Seconds the bow takes to reach its speed at a stroke's start, and how much harder it presses there (slope). */
  attack?: number;
  bite?: number;
  /** Where the bow sits, as a fraction of the string from the bridge. */
  beta?: number;
  /** How strongly a stroke starts the string in a bowed string's motion (0: from whatever the string is doing). */
  prime?: number;
  /** The player hears the string slipping twice a cycle and presses harder until it settles (0: does not). */
  ear?: number;
  /** How much the bow's speed and pressure waver as a hand's do (0: perfectly steady). */
  waver?: number;
  /** How much the player shapes phrases: louder toward a phrase's middle and its high notes, short notes lighter. */
  phrasing?: number;
  /** The erhu's other string, ringing in sympathy (its level; 0: none). */
  sympathy?: number;
  /** Colour through a long held note: how big its swell is (1: 1.5 to 2.5 dB; the owner chose 1.5), and how much brighter it gets per dB of swell. */
  colour?: number;
  bright?: number;
  /** How much further a long note tapers off after its swell (0: none; 1, the owner's choice: its end a whole swell lower, its peak a little earlier). */
  taper?: number;
  /** Record the pitch (semitones from A4) every sample, for the checks. */
  trace?: Float32Array;
  /** A bow change's turn: seconds the old stroke takes to slow, and the new one to get up to speed. */
  turnOut?: number;
  turnIn?: number;
  /** At a phrase's end, the share of the easing over which the bow leaves the string (1: all of it). */
  lift?: number;
  /** How much shorter the loop is once the bow has left (a free string sounds a little sharper than a bowed one), as a fraction of the period. */
  free?: number;
  /** The body: how many resonances, their sharpness (Q, lowest to highest), and how much sound passes straight through. */
  bodyN?: number;
  bodyQ?: [number, number];
  direct?: number;
  /** Resonances of either sign, as a body's modes are (neighbours partly cancel, carving dips between them). */
  signs?: boolean;
  /** How far the player evens out notes the body makes louder or softer (0: not at all, 1: fully). */
  even?: number;
  seed?: number;
}

/** Rosin noise level (about 31 dB under a held tone, 13 at a phrase's start) and the grip's unevenness. */
export const ROSIN = 0.038;
export const JITTER = 0.006;

/** The erhu's two strings, inner D4 and outer A4. */
const OPEN = [293.66, 440];
/** How loud the strings ring in sympathy (after a D they ring about 30 dB under the note, after a C about 38). */
export const SYMPATHY = 0.2;

/** The string's loss filter: one pole, as the ToolKit's (pole 0.65 at 44.1 kHz, gain 0.95). */
const POLE = 0.75 - (0.2 * 22050) / SR;
const LOSS = 0.95;
/** Where the bow sits, as a fraction of the string from the bridge. */
const BETA = 0.127236;

/** The loss filter's delay in samples at a frequency (its phase delay), so the loop can be shortened to keep pitch. */
function lossDelay(f: number): number {
  const w = (TAU * f) / SR;
  return Math.atan2(POLE * Math.sin(w), 1 - POLE * Math.cos(w)) / w;
}

/**
 * Extra samples the loop takes beyond its two delays and the loss filter (the bow's junction flattens it a little), by
 * frequency, measured from steady bare strokes with no trim and the pitch found by autocorrelation; between the points it
 * is interpolated in log frequency. Re-measure if the bow's speed, pressure or position changes.
 */
const TRIMS: ReadonlyArray<readonly [number, number]> = [
  [261.63, 1.7711], [293.66, 1.7668], [369.99, 1.7162], [440, 1.7011], [554.37, 1.6443], [659.26, 1.7634], [830.61, 1.749], [987.77, 1.6784], [1174.66, 1.7816],
];
function trimAt(f: number): number {
  const trims = TRIMS;
  if (f <= trims[0]![0]) return trims[0]![1];
  for (let i = 1; i < trims.length; i++) {
    const [fb, b] = trims[i]!;
    if (f <= fb) {
      const [fa, a] = trims[i - 1]!;
      return a + ((b - a) * Math.log(f / fa)) / Math.log(fb / fa);
    }
  }
  return trims.at(-1)![1];
}

/** The friction between bow and string at a difference in their speeds: sticking near zero, slipping beyond. */
function friction(dv: number, slope: number): number {
  const x = Math.abs((dv + 0.001) * slope) + 0.75;
  const y = 1 / (x * x * x * x);
  return y < 0.01 ? 0.01 : y > 0.98 ? 0.98 : y;
}

/**
 * How often (in samples) the string's delay correction is recomputed: it barely moves with pitch, and holding it halves
 * the strings' render time (a stale correction held 4096 samples was 6 cents off after a note change; 32, 0.4).
 */
const CORR_EVERY = 32;

export class BowedString {
  /** Where the bow sits; bowLine may move it through a note (the contact point). */
  beta: number;
  constructor(beta = BETA) {
    this.beta = beta;
  }
  /** The loss filter's and the trims' correction to the loop, held for CORR_EVERY samples (it barely moves with pitch). */
  private corr = 0;
  private corrAge = 0;
  private readonly neck = new Float64Array(2048);
  private readonly bridge = new Float64Array(2048);
  private w = 0;
  private loss = 0;
  /** Whether the bow is slipping on the string now, and how many slips have begun (each stick turning to slip). */
  private slipping = false;
  slips = 0;

  private read(buf: Float64Array, d: number): number {
    const i = Math.floor(d);
    const frac = d - i;
    const a = buf[(this.w - i) & 2047]!;
    const b = buf[(this.w - i - 1) & 2047]!;
    return a + (b - a) * frac;
  }

  /**
   * One sample: the bridge's motion, for a string sounding `f` Hz with the bow moving at `vb` (or lifted); `hold` (0 to
   * 1) is how firmly the bow grips the string where a stroke starts, damping what still rings from the stroke before.
   */
  tick(f: number, vb: number, slope: number, down: boolean, jit: number, hold = 0, contact = 1, free = 0): number {
    if (--this.corrAge < 0) {
      this.corr = lossDelay(f) + trimAt(f);
      this.corrAge = CORR_EVERY - 1;
    }
    // The trims were measured with the bow on the string, which flattens it a little; as the bow leaves, the loop
    // shortens by `free` of a period so the string rings at its note.
    const total = (SR / f) * (1 - free * (1 - (down ? contact : 0))) - this.corr;
    const bridgeOut = this.read(this.bridge, this.beta * total);
    const neckOut = this.read(this.neck, (1 - this.beta) * total);
    this.loss = LOSS * (1 - 0.5 * hold) * (1 - POLE) * bridgeOut + POLE * this.loss;
    const bridgeRefl = -this.loss;
    const nutRefl = -neckOut;
    const dv = vb - (bridgeRefl + nutRefl);
    const mu = friction(dv + jit, slope);
    // The bow's contact (1: full; lightening toward 0 as it leaves the string at a phrase's end).
    const nv = down ? contact * dv * mu : 0;
    // A slip begins where the grip lets go, and ends where it holds again (with a margin, so noise is not counted).
    if (!down) this.slipping = false;
    else if (!this.slipping && mu < 0.6) {
      this.slipping = true;
      this.slips++;
    } else if (this.slipping && mu > 0.95) this.slipping = false;
    this.w = (this.w + 1) & 2047;
    this.neck[this.w] = bridgeRefl + nv;
    this.bridge[this.w] = nutRefl + nv;
    return bridgeOut;
  }

  /**
   * A sample with the string left still (the bow off it and its sound died away): only its correction's count goes on,
   * so it is recomputed at the same samples as if the string had been worked, and what follows is the same.
   */
  idle(f: number): void {
    if (--this.corrAge < 0) {
      this.corr = lossDelay(f) + trimAt(f);
      this.corrAge = CORR_EVERY - 1;
    }
    this.slipping = false;
  }

  /** The string's motion now, by age along each line as a fraction of its length (for `prime`). */
  snapshot(f: number): Motion {
    const total = SR / f - lossDelay(f) - trimAt(f);
    const take = (buf: Float64Array, d: number) => Array.from({ length: Math.ceil(d) + 3 }, (_, i) => buf[(this.w - i) & 2047]!);
    return { neck: take(this.neck, (1 - this.beta) * total), bridge: take(this.bridge, this.beta * total), dN: (1 - this.beta) * total, dB: this.beta * total, loss: this.loss };
  }

  /** Sets the string moving as `m` does, stretched to `f`, at `scale` of its size (negative: bowed the other way). */
  prime(m: Motion, f: number, scale: number): void {
    const total = SR / f - lossDelay(f) - trimAt(f);
    const put = (buf: Float64Array, src: number[], dRef: number, d: number) => {
      for (let i = 0; i <= Math.ceil(d) + 2; i++) {
        const u = (i / d) * dRef;
        const j = Math.min(src.length - 2, Math.floor(u));
        const v = src[j]! + (src[j + 1]! - src[j]!) * (u - j);
        buf[(this.w - i) & 2047] = v * scale;
      }
    };
    put(this.neck, m.neck, m.dN, (1 - this.beta) * total);
    put(this.bridge, m.bridge, m.dB, this.beta * total);
    this.loss = m.loss * scale;
  }
}

/** A bowed string's motion, recorded once (see `helmholtz`). */
interface Motion {
  neck: number[];
  bridge: number[];
  dN: number;
  dB: number;
  loss: number;
}

/** The motion of a string bowed steadily (one slip a cycle) at the model's speed, pressure and bow position, upward. */
const motions = new Map<string, Motion>();
function helmholtz(beta: number, slope: number, speed: number): Motion {
  const key = `${beta} ${slope} ${speed}`;
  let m = motions.get(key);
  if (!m) {
    const s = new BowedString(beta);
    for (let i = 0; i < SR; i++) s.tick(440, speed * ss(i / (0.05 * SR)), slope, true, 0);
    m = s.snapshot(440);
    motions.set(key, m);
  }
  return m;
}

/** A biquad, for the body and the noise. */
class Biquad {
  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;
  private readonly b0: number;
  private readonly b1: number;
  private readonly b2: number;
  private readonly a1: number;
  private readonly a2: number;
  constructor(b0: number, b1: number, b2: number, a1: number, a2: number) {
    this.b0 = b0;
    this.b1 = b1;
    this.b2 = b2;
    this.a1 = a1;
    this.a2 = a2;
  }
  static bandpass(f: number, q: number): Biquad {
    const w = (TAU * f) / SR;
    const alpha = Math.sin(w) / (2 * q);
    const a0 = 1 + alpha;
    return new Biquad(alpha / a0, 0, -alpha / a0, (-2 * Math.cos(w)) / a0, (1 - alpha) / a0);
  }
  static lowpass(f: number, q: number): Biquad {
    const w = (TAU * f) / SR;
    const alpha = Math.sin(w) / (2 * q);
    const a0 = 1 + alpha;
    const c = Math.cos(w);
    return new Biquad((1 - c) / 2 / a0, (1 - c) / a0, (1 - c) / 2 / a0, (-2 * c) / a0, (1 - alpha) / a0);
  }
  run(x: number): number {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
}

/** A note of the fiddle's line, ready to bow. */
export interface Bowed {
  t0: number;
  t1: number;
  f: number;
  gain: number;
  /** Starts a new stroke (after a rest, on a repeated pitch, or on a note long enough for its own bow). */
  newBow: boolean;
  /** Follows a rest (or opens the line). */
  phraseStart: boolean;
  /** A rest (or the line's end) follows. */
  phraseEnd: boolean;
  dir: number;
  /** The note before, if it runs straight into this one: its pitch, in semitones from this one. */
  from?: number;
  slideFrom?: number;
  slideTime?: number;
  fall?: number;
  /** The note's own vibrato: depth (semitones), speed (Hz), when it starts and how long it takes to grow (seconds). */
  vibDepth: number;
  vibRate: number;
  vibDelay: number;
  vibGrow: number;
  cents: number;
  /** The vibrato carries on from the note before (inside a phrase, not after a slide): the left hand does not stop. */
  carried: boolean;
  /** The pitch the note starts from, in semitones from it: the note before's, with its intonation (for a finger change). */
  fromC?: number;
  /** A phrase's first stroke: how firmly it starts the string moving and how hard it bites (each phrase a little different). */
  primeAt: number;
  biteAt: number;
  /** A long note's swell: its size (dB), where it peaks (0 to 1 of the note), and where it ends (relative to its peak). */
  swell: number;
  swellUp: number;
  swellEnd: number;
}

/**
 * The bow's speed in a stroke, and how hard it presses (as the ToolKit's slope: lower is harder). At the ToolKit's own
 * slope of 3 this speed made the string slip twice a cycle (its octave 8 dB over its note, buzzy and unsteady); from 2
 * down a held note keeps a bowed string's one slip a cycle. Pressing harder also lets a stroke settle sooner, and with
 * each stroke started in a bowed string's motion (PRIME) at slope 1, 1 note of the part's 222 still starts slipping
 * twice (the boundary is chaotic: other settings leave 0 to 6).
 */
const SPEED = 0.19;
const SLOPE = 1.0;
const PRIME = 0.25;
/** Cents the string is aimed below its note to cancel what the bowing leaves it sharp by (see the tuning in bowLine). */
const TUNE = 1.0;

/** Plans the bowing of one line's notes (one role's, in order). */
export function plan(notes: readonly BeijingEvent[], gainOf: (e: BeijingEvent) => number, random: () => number, intonation: boolean, evenOut: (f: number) => number = () => 1, phrasing = 0, colour = 0, colourRandom: () => number = Math.random, taper = 0): Bowed[] {
  const out: Bowed[] = [];
  const shape = phraseShape(notes, phrasing);
  let dir = 1;
  let bowTime = 0;
  let phraseRate = 5.7;
  notes.forEach((e, i) => {
    const prev = notes[i - 1];
    const next = notes[i + 1];
    const t0 = e.s * STEP + (e.role === 'second' ? 0.012 : 0);
    const t1 = t0 + e.written * STEP;
    const joined = prev !== undefined && prev.s + prev.written === e.s;
    const phraseStart = !joined;
    const phraseEnd = !(next && e.s + e.written === next.s);
    // A short note runs on in the stroke before it; a repeated pitch, a longer note, or a stroke over two seconds old
    // takes a new bow.
    const newBow = phraseStart || prev!.f === e.f || e.written >= 4 || bowTime > 2;
    if (newBow) {
      if (!phraseStart) dir = -dir;
      bowTime = 0;
    }
    bowTime += t1 - t0;
    // The left hand's vibrato: one speed through a phrase (each note within 3% of it), narrower on quick notes, carried
    // from note to note inside a phrase; after a rest or a slide it starts again, a little later and growing in.
    if (phraseStart) phraseRate = 5.2 + random();
    const depthClass = e.written <= 1 ? 0.35 : e.written === 2 ? 0.6 : e.written <= 5 ? 0.85 : 1;
    const vibDepth = 0.17 * depthClass * (0.9 + 0.2 * random());
    const vibRate = phraseRate * (1 + 0.03 * (2 * random() - 1));
    const slideTime = e.touch?.slideFrom ? (e.touch.slideTime ?? 0.125) : 0;
    const vibDelay = Math.max(slideTime, Math.min(0.3, 0.35 * (t1 - t0), 0.12 + 0.15 * random()));
    const vibGrow = 0.15 + 0.25 * random();
    const cents = intonation ? (random() - 0.5) * 4 : (random(), 0);
    const from = joined ? 12 * Math.log2(prev!.f / e.f) : undefined;
    out.push({
      t0, t1, f: e.f, gain: gainOf(e) * evenOut(e.f) * shape[i]!, newBow, phraseStart, phraseEnd, dir, from,
      slideFrom: e.touch?.slideFrom, slideTime: e.touch?.slideTime, fall: e.touch?.fall,
      vibDepth, vibRate, vibDelay, vibGrow, cents,
      carried: !phraseStart && !e.touch?.slideFrom,
      ...(() => { const a = colourRandom(), b = colourRandom(); return { primeAt: 0.15 + 0.2 * a, biteAt: 0.25 + 0.3 * b }; })(),
      fromC: from === undefined ? undefined : from + (out[i - 1]!.cents - cents) / 100,
      // A long note swells and eases as a player shapes it (drawn from its own stream, so the rest is unchanged).
      ...(() => {
        const dur = t1 - t0;
        const r1 = colourRandom(), r2 = colourRandom();
        if (dur < 0.75 || !colour) return { swell: 0, swellUp: 0.5, swellEnd: 0 };
        return {
          swell: colour * Math.min(2.5, Math.max(1.5, 1.5 + 1.33 * (dur - 0.75))) * (0.85 + 0.3 * r1),
          // A taper peaks a little earlier and lets the note go further at its end: the bow slower, further from the
          // bridge and lighter, so it is softer, darker and its vibrato narrower.
          swellUp: 0.45 + 0.2 * r2 - 0.1 * taper,
          swellEnd: (phraseEnd ? -0.4 : next && next.f > e.f ? 0.35 : 0.1) - taper,
        };
      })(),
    });
  });
  return out;
}

const ss = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
/** A bow's turn: fastest away from the reversal, easing into it (0 at the turn, 1 after). */
const turn = (u: number) => (u <= 0 ? 0 : u >= 1 ? 1 : u * (2 - u));

/** A long note's swell (0 to 1) at a point `u` through it: up to its peak, then easing to where it ends. */
const swellAt = (n: Bowed, u: number) => (u < n.swellUp ? ss(u / n.swellUp) : 1 + (n.swellEnd - 1) * ss((u - n.swellUp) / (1 - n.swellUp)));

/**
 * How a player shapes each note of a line (a gain): a phrase (notes joined without a rest) rises toward its middle and
 * falls away at its end; a note higher than the phrase's average is a little louder, a lower one softer; a quick
 * passing note is lighter and a long one fuller. All within about 2 dB either way, at `amount` 1.
 */
export function phraseShape(notes: readonly BeijingEvent[], amount: number): number[] {
  const db = new Array<number>(notes.length).fill(0);
  if (!amount) return db.map(() => 1);
  let start = 0;
  notes.forEach((e, i) => {
    const next = notes[i + 1];
    if (next && e.s + e.written === next.s) return;
    const phrase = notes.slice(start, i + 1);
    const from = phrase[0]!.s;
    const len = e.s + e.written - from;
    const mean = phrase.reduce((a, m) => a + Math.log2(m.f), 0) / phrase.length;
    phrase.forEach((m, j) => {
      const mid = (m.s + m.written / 2 - from) / len;
      let d = 1.6 * (Math.sin(Math.PI * mid) - 0.6);
      d += Math.max(-1.2, Math.min(1.2, 12 * (Math.log2(m.f) - mean) * 0.15));
      if (m.written <= 1) d -= 1;
      else if (m.written >= 6) d += 0.5;
      if (j === phrase.length - 1 && phrase.length > 1) d -= 0.8;
      db[start + j] = d * amount;
    });
    start = i + 1;
  });
  return db.map((d) => 10 ** (d / 20));
}

/**
 * Bows one line into `out` (the bare string's motion plus rosin noise, before the body), from its first note to a
 * little past its last. Returns the samples it wrote between.
 */
function bowLine(line: Bowed[], out: Float32Array, o: Required<BowOptions>, seed: number): void {
  const random = rng(seed);
  const string = new BowedString(o.beta);
  const hiss = Biquad.bandpass(3200, 0.7);
  const gripLp = Biquad.lowpass(1500, 0.7);
  const i0 = Math.max(0, Math.floor((line[0]!.t0 - 0.03) * SR));
  const i1 = Math.min(out.length, Math.ceil((line.at(-1)!.t1 + 0.8) * SR));
  let k = -1;
  let primed = -1;
  const ref = o.prime ? helmholtz(o.beta, o.slope, o.speed) : null;
  let f = line[0]!.f;
  let gain = line[0]!.gain;
  let vibPhase = random() * TAU;
  // The vibrato's hand: its own random stream (so turning the vibrato off leaves the bow's noise the same), its slow
  // drift in speed, its amplitude following its target, and each half cycle's own width and each cycle's own speed.
  const hand = rng(seed * 7 + 3);
  const gauss = () => (hand() + hand() + hand() + hand() - 2) * Math.sqrt(3);
  let drift = 0;
  let vibAmp = 0;
  let aDepth = 0;
  let halfDepth = 1;
  let aRate = 0;
  let lastHalf = Math.floor(vibPhase / Math.PI);
  const vibStep = 1 - Math.exp(-1 / (0.02 * SR));
  // A long note's colour: the swell (dB), the contact point following it (and drifting a little), and the brightening.
  let d = 0;
  let beta = o.beta;
  let betaWander = 0;
  let betaTarget = 0;
  const betaStep = 1 - Math.exp(-1 / (0.02 * SR));
  let gB = 0;
  let lpB = 0;
  let shelf = 0;
  let quiet = 0;
  let dSpeed = 1;
  let dPress = 1;
  let dBeta = 1;
  let dAim = 2 ** (-TUNE / 1200);
  const lpBk = 1 - Math.exp((-TAU * 1200) / SR);
  // The ear: slips a cycle, counted over each cycle and smoothed over a few; the extra pressure it calls for.
  let cycleAt = 0;
  let cycleSlips = string.slips;
  let slipRate = 1;
  let press = 0;
  // A hand's unsteadiness: the bow's speed and pressure wander slowly.
  let speedWander = 0;
  let pressWander = 0;
  const wanderLp = 1 - Math.exp(-1 / (0.25 * SR));
  let speedTarget = 0;
  let pressTarget = 0;
  const gainStep = 1 - Math.exp(-1 / (0.015 * SR));
  for (let i = i0; i < i1; i++) {
    const t = i / SR;
    while (k + 1 < line.length && line[k + 1]!.t0 <= t) k++;
    const n = k >= 0 ? line[k]! : undefined;
    const next = line[k + 1];
    let vb = 0;
    let down = false;
    let slope = o.slope;
    let scratch = 0;
    // Where a stroke starts (after a rest or at a bow change) the bow stops and grips the string for about 15 ms,
    // damping the last stroke's motion; without it a stroke reversing into the old motion could set the string
    // slipping twice a cycle (10 of 91 bow changes, 5 of 24 phrase starts did).
    // The swell's shape through a long note: up to its peak, then easing to where it ends; held for 32 samples.
    const long = !!n && t < n.t1 && n.swell > 0;
    if ((i & 31) === 0) {
      d = long ? n!.swell * swellAt(n!, (t - n!.t0) / (n!.t1 - n!.t0)) : 0;
      // What follows from the swell, worked out when it changes rather than every sample (the same numbers).
      dSpeed = 10 ** ((0.6 * d) / 20);
      dPress = 10 ** ((-0.5 * d) / 20);
      dBeta = 10 ** ((-0.4 * d) / 20);
      dAim = 2 ** (-(TUNE + 0.6 * d) / 1200);
    }
    let hold = 0;
    let fallU = 0;
    // Only where a phrase starts: inside a phrase the bow reverses with the string still moving (gripping and restarting
    // it there dipped each long note's start; the ear and the bow's quick turn keep it bowing cleanly).
    const starts = next && next.phraseStart && next.t0 - t < 0.015 && next.t0 - t > 0;
    if (starts) hold = 1 - (next!.t0 - t) / 0.015;
    if (n && n.phraseStart && t - n.t0 >= 0 && t - n.t0 < 0.004) hold = 1;
    let contact = 1;
    if (n && t < n.t1) {
      const x = t - n.t0;
      const dur = n.t1 - n.t0;
      let env = 1;
      // A phrase's first stroke speeds up smoothly; a bow change inside a phrase is a quick turn: the old stroke slows
      // in 15 ms and the new one is up to speed in 20 ms, decelerating into and accelerating out of the turn.
      if (n.phraseStart) env *= ss(x / o.attack);
      else if (n.newBow) env *= turn(x / o.turnIn);
      if (next && !next.phraseStart && next.newBow) env *= turn((n.t1 - t) / o.turnOut);
      // At a phrase's end the bow lightens and leaves the string while still moving (half speed), so the string rings
      // on instead of being clamped by a stopped bow; through a fall it lightens over the whole slide.
      if (n.phraseEnd) {
        const le = Math.min(n.fall ? 0.18 : 0.08, 0.4 * dur);
        contact = ss((n.t1 - t) / (le * o.lift));
        env *= 0.5 + 0.5 * ss((n.t1 - t) / le);
      }
      // A score slide: fastest in its middle and settling on arrival (a quintic S), the bow easing through it. A fall:
      // the finger slides off over the note's last 0.2 s (or half of it), reaching its written depth at the note's end,
      // the bow lightening and the tone darkening as it goes.
      const slideS = n.slideFrom ? (() => { const su = Math.min(1, x / (n.slideTime ?? 0.125)); return su * su * su * (10 - 15 * su + 6 * su * su); })() : 1;
      env *= 0.85 + 0.15 * slideS;
      if (n.fall) {
        const tf = Math.min(0.2, 0.5 * dur);
        fallU = Math.min(1, Math.max(0, (x - (dur - tf)) / tf));
        env *= 1 - 0.6 * fallU;
      }
      // A long note's swell: the bow faster (0.6 of its dB) and nearer the bridge (the rest); a short one keeps the
      // old gentle swell if it is long enough to have one.
      const kv = dSpeed;
      if (n.swell > 0) env *= kv;
      else if (dur >= 0.75) env *= 1 + 0.15 * Math.sin((Math.PI * x) / dur);
      // Down-bows start with a little weight that eases; up-bows start lighter and grow.
      if (n.newBow && o.phrasing) env *= n.dir > 0 ? 1 + 0.1 * o.phrasing * Math.exp(-x / 0.15) : 1 - 0.08 * o.phrasing * Math.exp(-x / 0.25);
      vb = n.dir * o.speed * env * (1 + speedWander);
      down = true;
      // The bow bites a little harder as a stroke starts, and the rosin is loudest there.
      if (n.phraseStart) {
        slope = o.slope - (o.bite === 0.4 ? n.biteAt : o.bite) * Math.exp(-x / 0.06);
        scratch = Math.exp(-x / 0.04);
      } else if (n.newBow) {
        slope = o.slope - o.bite * Math.exp(-x / 0.06);
        scratch = 0.4 * Math.exp(-x / 0.015);
      }
      // Pressure follows the contact point and speed so the bow stays in its playable window (more force nearer the
      // bridge, less for a faster bow), and leans a little more into the swell.
      slope = Math.max(0.3, (slope * (beta / o.beta) ** 1.5) / kv * dPress + pressWander - press + 0.3 * fallU);
      // Pitch: the note; a finger change from the note before inside a bow, made in about 6 ms (a slight catch of the
      // bow as the string's length changes, a little more going up, where the finger lands, than going down, where it
      // lifts); or the score's slide; the fall; and the vibrato. A bow change lands on the new note (gliding after a bow
      // change left 4 of 42 falling ones slipping twice a cycle).
      let semis = n.cents / 100;
      if (n.slideFrom) semis += n.slideFrom * (1 - slideS);
      else if (n.fromC !== undefined && !n.newBow) {
        semis += n.fromC * (1 - ss(x / 0.006));
        if (n.fromC < 0 && x < 0.003) hold = Math.max(hold, 0.3);
        else if (n.fromC > 0 && x < 0.002) hold = Math.max(hold, 0.15);
      }
      if (n.fall) semis += n.fall * fallU * fallU;
      if (o.vibrato) {
        // A player's vibrato: each note its own speed, start and growth; the speed wanders over seconds and quickens a
        // little through a note; into a long note's swell it widens and quickens; and each half cycle has its own width
        // and each cycle its own speed (changed only where the pitch crosses its centre, so it never jumps).
        drift += (hand() - 0.5) * 6e-4;
        drift *= 0.99999;
        const u = x / dur;
        const intensity = n.swell > 0 ? Math.max(0.7, 0.75 + 0.6 * swellAt(n, Math.max(0, u - 0.1 / dur))) : 1;
        // Carried from the note before, it dips a little as the finger changes and recovers; started afresh, it grows in.
        const grow = Math.min(1, Math.max(0, (x - n.vibDelay) / n.vibGrow));
        let target = n.vibDepth * intensity * (n.carried ? 1 - 0.35 * Math.exp(-x / 0.12) : grow * grow * (3 - 2 * grow));
        // It narrows a little into a finger change within the bow, and stops as a fall's finger slides off.
        if (next && !next.phraseStart && !next.newBow) target *= 0.6 + 0.4 * ss((n.t1 - t) / 0.06);
        if (n.fall) target *= 1 - ss(fallU / 0.15);
        vibAmp += (target - vibAmp) * vibStep;
        const rate = n.vibRate * (1 + Math.max(-0.08, Math.min(0.08, drift)) + aRate + (n.swell > 0 ? 0.05 * swellAt(n, u) : 0) + 0.04 * Math.min(1, x / 2));
        vibPhase += (TAU * rate) / SR;
        const half = Math.floor(vibPhase / Math.PI);
        if (half !== lastHalf) {
          lastHalf = half;
          // About 10% half to half (0.104 here measured about 20%, over the 10 to 18% wanted).
          aDepth = 0.6 * aDepth + 0.075 * gauss();
          halfDepth = Math.min(1.4, Math.max(0.7, Math.exp(aDepth)));
          if (half % 2 === 0) aRate = 0.5 * aRate + 0.0303 * gauss();
        }
        semis += vibAmp * halfDepth * Math.sin(vibPhase);
      }
      f = n.f * 2 ** (semis / 12);
    }
    // The hand's wandering: a new aim every so often, approached smoothly (at waver 2.5, about 10% in speed and 0.2 in
    // pressure; 4% and 0.08 moved a held note's level under 0.1 dB more than a steady bow).
    if (random() < 3 / SR) {
      speedTarget = (random() - 0.5) * 0.08 * o.waver;
      pressTarget = (random() - 0.5) * 0.16 * o.waver;
    }
    speedWander += (speedTarget - speedWander) * wanderLp;
    pressWander += (pressTarget - pressWander) * wanderLp;
    // The contact point: nearer the bridge into a swell (beta down by 0.4 of its dB), drifting about 5% as a hand does.
    if (random() < 3 / SR) betaTarget = (random() - 0.5) * 0.04 * o.waver;
    betaWander += (betaTarget - betaWander) * wanderLp;
    const betaT = Math.min(0.16, Math.max(0.095, o.beta * dBeta * (1 + betaWander)));
    beta += (betaT - beta) * betaStep;
    string.beta = beta;
    gB += (o.bright * (d - 2 * fallU) - gB) * betaStep;
    const target = n ? n.gain : gain;
    gain += (target - gain) * gainStep;
    const jit = gripLp.run((random() * 2 - 1) * o.jitter * 40);
    // A phrase's first stroke starts the string in a bowed string's motion, small, the way the bow goes.
    if (ref && n && n.phraseStart && k !== primed && t < n.t1) {
      string.prime(ref, f, (o.prime === PRIME ? n.primeAt : o.prime) * n.dir);
      primed = k;
    }
    // Tuning: the bow turning and lifting as it does leaves the string about a cent sharp overall, and a swell's faster
    // bow nearer the bridge sharpens it about 0.6 cent per dB more; aim that much lower.
    const aim = f * dAim;
    // Between phrases, once the bow is off and the string has died away (nothing over a millionth for 50 ms), the
    // string is left still rather than worked sample by sample: the lead line sounds for 91 s of its 168, and this
    // was a third of its render. The random draws below go on, so what follows is the same.
    let y = 0;
    if (!down && quiet >= 2205) string.idle(aim);
    else {
      y = string.tick(aim, vb, slope, down, jit, hold, contact, o.free);
      quiet = !down && Math.abs(y) < 1e-6 ? quiet + 1 : 0;
      // The swell's brightening: the string's highs (above about 1.2 kHz) lifted by gB dB (its gain worked out every 32 samples).
      if ((i & 31) === 0) shelf = 10 ** (gB / 20) - 1;
      lpB += (y - lpB) * lpBk;
      y += shelf * (y - lpB);
    }
    if (o.trace.length > i) o.trace[i] = 12 * Math.log2(f / 440);
    // The ear: every cycle, how many slips began; two a cycle (smoothed) calls for more pressure, quickly, and once the
    // string settles the extra pressure eases off.
    if (++cycleAt >= SR / f) {
      cycleAt = 0;
      const now = string.slips - cycleSlips;
      cycleSlips = string.slips;
      slipRate += (now - slipRate) * 0.6;
    }
    if (o.ear && down && contact > 0.5 && slipRate > 1.4) press = Math.min(o.ear, press + o.ear / (0.01 * SR));
    else press = Math.max(0, press - o.ear / (0.15 * SR));
    if (!down) slipRate = 1;
    // (Drawn every sample, so the string is the same with the rosin off and the noise can be measured alone.)
    const r = random() * 2 - 1;
    y += hiss.run(down ? r * o.rosin * (Math.abs(vb) / o.speed) * (1 + 16 * scratch) : 0);
    out[i]! += y * gain;
  }
}

/** The body: about thirty narrow resonances, shaped around the old fiddle's erhu formants, with a little direct sound. */
export function bodyOf(seed: number, n = 30, qs: [number, number] = [12, 34], signs = false): Array<{ f: number; q: number; g: number }> {
  const random = rng(seed);
  const bump = (f: number, c: number, oct: number) => Math.exp(-0.5 * (Math.log2(f / c) / oct) ** 2);
  const lo = Math.log(200);
  const hi = Math.log(6500);
  return Array.from({ length: n }, (_, i) => {
    const f = Math.exp(lo + ((hi - lo) * (i + 0.5 + (random() - 0.5) * 0.8)) / n);
    const shape = 0.3 + 0.4 * bump(f, 420, 0.5) + bump(f, 760, 0.6) + 0.8 * bump(f, 1650, 0.5) + 0.6 * bump(f, 2900, 0.5);
    const q = qs[0] + random() * (qs[1] - qs[0]);
    const g = shape * (0.5 + random());
    return { f, q, g: signs && random() < 0.5 ? -g : g };
  });
}

/** How loud a bowed note at `f` comes out of the body, against the bare string: its overtones (falling as 1/k) weighed by the body's response. */
function bodyGain(o: Required<BowOptions>): (f: number) => number {
  const norm = Math.sqrt(30 / o.bodyN);
  const peaks = bodyOf(o.seed, o.bodyN, o.bodyQ, o.signs);
  const response = (fr: number) => {
    const w = (TAU * fr) / SR;
    let re = o.direct, im = 0;
    for (const p of peaks) {
      const pw = (TAU * p.f) / SR;
      const alpha = Math.sin(pw) / (2 * p.q);
      const a0 = 1 + alpha;
      // A band-pass biquad at e^{jw}: (alpha - alpha e^{-2jw}) / (a0 - 2 cos(pw) e^{-jw} + (1 - alpha) e^{-2jw}).
      const nr = alpha - alpha * Math.cos(2 * w), ni = alpha * Math.sin(2 * w);
      const dr = a0 - 2 * Math.cos(pw) * Math.cos(w) + (1 - alpha) * Math.cos(2 * w);
      const di = 2 * Math.cos(pw) * Math.sin(w) - (1 - alpha) * Math.sin(2 * w);
      const d = dr * dr + di * di;
      re += norm * p.g * (nr * dr + ni * di) / d;
      im += norm * p.g * (ni * dr - nr * di) / d;
    }
    return Math.hypot(re, im);
  };
  return (f) => {
    let s = 0;
    for (let k = 1; k <= 12 && k * f < 9000; k++) s += (response(k * f) / k) ** 2;
    return Math.sqrt(s);
  };
}

/**
 * The body as a bank of resonators run sample by sample (the reference: `body` gives the same through its impulse
 * response, about twice as fast).
 */
export function bodyBank(x: Float32Array, o: Required<BowOptions>): Float32Array {
  const peaks = bodyOf(o.seed, o.bodyN, o.bodyQ, o.signs).map((p) => ({ b: Biquad.bandpass(p.f, p.q), g: p.g }));
  // Many narrow resonances pass less in all than a few broad ones; keep the body's overall gain about the same.
  const norm = Math.sqrt(30 / o.bodyN);
  const lp = Biquad.lowpass(7000, 0.707);
  const out = new Float32Array(x.length);
  let dcIn = 0;
  let dcOut = 0;
  for (let i = 0; i < x.length; i++) {
    const v = x[i]!;
    let y = o.direct * v;
    for (const p of peaks) y += norm * p.g * p.b.run(v);
    // Take out any slow drift (the bow pushes the string a little one way).
    dcOut = y - dcIn + 0.995 * dcOut;
    dcIn = y;
    out[i] = lp.run(dcOut);
  }
  return out;
}

/** Seconds of the body's impulse response kept: its slowest resonance is 60 dB down by about 0.9 s. */
const BODY_IR = 1.2;
const irs = new Map<string, Float64Array>();

/** The body: its impulse response (from the resonator bank, once per body), convolved with the strings. */
function body(x: Float32Array, o: Required<BowOptions>): Float32Array {
  const key = `${o.seed} ${o.bodyN} ${o.bodyQ.join(' ')} ${o.direct} ${o.signs}`;
  let h = irs.get(key);
  if (!h) {
    const imp = new Float32Array(Math.ceil(BODY_IR * SR));
    imp[0] = 1;
    h = Float64Array.from(bodyBank(imp, o));
    irs.set(key, h);
  }
  return convolve(x, h);
}

/** An in-place radix-2 FFT of a complex signal of power-of-two length; the inverse also divides by the length. */
function fft(re: Float64Array, im: Float64Array, inverse: boolean): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i]!;
      re[i] = re[j]!;
      re[j] = t;
      t = im[i]!;
      im[i] = im[j]!;
      im[j] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1;
    const ang = ((inverse ? 2 : -2) * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < half; k++) {
        const a = i + k;
        const b = a + half;
        const tr = re[b]! * cr - im[b]! * ci;
        const ti = re[b]! * ci + im[b]! * cr;
        re[b] = re[a]! - tr;
        im[b] = im[a]! - ti;
        re[a] = re[a]! + tr;
        im[a] = im[a]! + ti;
        const next = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = next;
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) {
    re[i] = re[i]! / n;
    im[i] = im[i]! / n;
  }
}

/**
 * `x` convolved with `h` (as long as `x`), by overlap-add: two blocks at a time, one as the real part and one as the
 * imaginary (the response is real, so each comes back in its own part); silent blocks are skipped.
 */
export function convolve(x: Float32Array, h: Float64Array): Float32Array {
  const m = h.length;
  let n = 1;
  while (n < 2 * m) n <<= 1;
  const l = n - m + 1;
  const hr = new Float64Array(n);
  const hi = new Float64Array(n);
  hr.set(h);
  fft(hr, hi, false);
  const out = new Float32Array(x.length);
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let start = 0; start < x.length; start += 2 * l) {
    re.fill(0);
    im.fill(0);
    let sounding = false;
    for (let i = 0; i < l; i++) {
      const a = x[start + i] ?? 0;
      const b = x[start + l + i] ?? 0;
      re[i] = a;
      im[i] = b;
      if (a !== 0 || b !== 0) sounding = true;
    }
    if (!sounding) continue;
    fft(re, im, false);
    for (let k = 0; k < n; k++) {
      const r = re[k]! * hr[k]! - im[k]! * hi[k]!;
      im[k] = re[k]! * hi[k]! + im[k]! * hr[k]!;
      re[k] = r;
    }
    fft(re, im, true);
    for (let i = 0; i < n; i++) {
      const p = start + i;
      const q = start + l + i;
      if (p < out.length) out[p] = out[p]! + re[i]!;
      if (q < out.length) out[q] = out[q]! + im[i]!;
    }
  }
  return out;
}

/** The game's fiddle: the owner's "more colour, more taper". */
export const BOW_DEFAULTS: Readonly<Required<BowOptions>> = {
  vibrato: true, rosin: ROSIN, jitter: JITTER, body: true, intonation: true, speed: SPEED, slope: SLOPE, attack: 0.05, bite: 0.4, beta: BETA,
  prime: PRIME, ear: 0.7, waver: 2.5, phrasing: 1, sympathy: SYMPATHY, colour: 1.5, bright: 0.45, taper: 1, trace: new Float32Array(0),
  turnOut: 0.008, turnIn: 0.012, lift: 0.35, free: 0.0042, bodyN: 80, bodyQ: [20, 80], direct: 0.1, signs: true, even: 0.6, seed: 7,
};

/**
 * The fiddle's part, modelled: every note of `notes` (the bowed events, any roles), each at `gainOf` its event, as one
 * channel `seconds` long. Each role's line is its own string; the body is shared.
 */
export function bowPart(notes: readonly BeijingEvent[], gainOf: (e: BeijingEvent) => number, seconds: number, opts: BowOptions = {}): Float32Array {
  const o: Required<BowOptions> = { ...BOW_DEFAULTS, ...opts };
  const strings = new Float32Array(Math.ceil(seconds * SR));
  const random = rng(o.seed);
  // The player evens out what the body makes louder or softer, part of the way (against the part's middle note).
  let evenOut = (_f: number) => 1;
  if (o.body && o.even) {
    const g = bodyGain(o);
    const fs = [...notes].map((e) => e.f).sort((a, b) => a - b);
    const mid = g(fs[Math.floor(fs.length / 2)] ?? 440);
    const memo = new Map<number, number>();
    evenOut = (f) => memo.get(f) ?? (memo.set(f, (mid / g(f)) ** o.even), memo.get(f)!);
  }
  const roles = [...new Set(notes.map((e) => e.role))];
  roles.forEach((role, r) => {
    const line = notes.filter((e) => e.role === role).sort((a, b) => a.s - b.s);
    if (line.length) bowLine(plan(line, gainOf, random, o.intonation, evenOut, o.phrasing, o.colour, rng(o.seed * 13 + 5 + r), o.taper), strings, o, o.seed * 100 + r);
  });
  if (o.sympathy) sympathize(strings, o.sympathy);
  return o.body ? body(strings, o) : strings;
}


/**
 * The strings not bowed ring a little in sympathy where a note shares their pitches (a D or an A, or a note whose
 * overtones meet theirs): each is a loop one period long, losing about 25 dB a second and its highs sooner, fed a little
 * of the bowed sound and added back.
 */
export function sympathize(x: Float32Array, level: number): void {
  // Each loop one period long: its delay, the sample its write comes after the read, and its low-pass's delay at the
  // string's pitch (set at half a sample at first, the loops sounded 13 and 21 cents flat and missed the overtones).
  const lpDelay = (f: number) => { const w = (TAU * f) / SR; return Math.atan2(0.4 * Math.sin(w), 1 - 0.4 * Math.cos(w)) / w; };
  const loops = OPEN.map((f) => ({ d: SR / f - 1 - lpDelay(f), buf: new Float64Array(4096), w: 0, lp: 0, g: Math.exp(Math.log(10 ** (-25 / 20)) / f) }));
  for (let i = 0; i < x.length; i++) {
    const v = x[i]!;
    let add = 0;
    for (const L of loops) {
      const j = Math.floor(L.d), frac = L.d - j;
      const a = L.buf[(L.w - j) & 4095]!, b = L.buf[(L.w - j - 1) & 4095]!;
      const back = a + (b - a) * frac;
      L.lp = 0.6 * back + 0.4 * L.lp;
      L.w = (L.w + 1) & 4095;
      L.buf[L.w] = L.g * L.lp + 0.01 * v;
      add += L.lp;
    }
    x[i] = v + level * add;
  }
}
