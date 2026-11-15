/**
 * A small software synthesizer for the sound sketches (2026-10-02): it renders effects and music into sample
 * buffers, in the browser and in Node alike, so the same sound plays everywhere and can be measured. The game itself
 * still plays `audio.ts`'s oscillators; nothing here is used by it until the owner picks a style.
 *
 * A sound is a set of voices written into a `Mix` (stereo, with delay and reverb sends), then `finish` runs the
 * effects. Every random choice is seeded, so a render is the same each time.
 */

export const SR = 44100;

/** A seeded random source (mulberry32), returning numbers in [0, 1). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The frequency of a note name ("A4", "C#5", "Bb3"), or of a MIDI number. */
export function hz(note: string | number): number {
  if (typeof note === 'number') return 440 * 2 ** ((note - 69) / 12);
  const m = /^([A-G])([#b]?)(-?\d)$/.exec(note);
  if (!m) throw new Error(`Bad note ${note}`);
  const base = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1] as 'C']!;
  const semis = base + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + (Number(m[3]) + 1) * 12;
  return 440 * 2 ** ((semis - 69) / 12);
}

type Sends = { delayL?: Float32Array; delayR?: Float32Array; verbL?: Float32Array; verbR?: Float32Array };

/** How many samples a mix of this many seconds holds. */
export const framesOf = (seconds: number): number => Math.max(1, Math.ceil(seconds * SR));

/**
 * A stereo buffer with two effect sends; voices write into it, `finish` mixes the effects in. A send is made the first
 * time something uses it: a long loop with no echo or reverb would otherwise hold four more buffers its length. Once
 * `finish` has mixed the effects in it lets the sends go, so a long loop does not hold them while it folds (Beijing's,
 * 2026-11-12); a sound sent to a finished mix would be lost, so sending one throws.
 */
export class Mix {
  readonly length: number;
  readonly l: Float32Array;
  readonly r: Float32Array;
  private sends: Sends | null = {};
  constructor(seconds: number) {
    this.length = framesOf(seconds);
    this.l = new Float32Array(this.length);
    this.r = new Float32Array(this.length);
  }
  get delayL(): Float32Array {
    return (this.open().delayL ??= new Float32Array(this.length));
  }
  get delayR(): Float32Array {
    return (this.open().delayR ??= new Float32Array(this.length));
  }
  get verbL(): Float32Array {
    return (this.open().verbL ??= new Float32Array(this.length));
  }
  get verbR(): Float32Array {
    return (this.open().verbR ??= new Float32Array(this.length));
  }
  get seconds(): number {
    return this.length / SR;
  }
  /** Lets the sends go: their effects are in the mix (`finish`). */
  closeSends(): void {
    this.sends = null;
  }
  private open(): Sends {
    if (!this.sends) throw new Error('This mix is finished: nothing more can be sent to its echo or reverb');
    return this.sends;
  }
}

/**
 * What a voice sounds like. Band-limited shapes (`saw`, `square`, `pulse`) for clean tones; `tri4` is the 4-bit
 * stepped triangle of 8-bit consoles; `noise` is white noise held at `freq` (a lower rate is grittier); `lfsr` and
 * `lfsr93` are an 8-bit console's noise channel, long and short (metallic); `pluck` is a
 * plucked string (Karplus-Strong: a burst of noise circling a delay line one period long, softened each time round);
 * an array is a wavetable, read without interpolation as the early arcade chips did.
 */
export type Wave = 'sine' | 'tri' | 'tri4' | 'saw' | 'square' | 'pulse' | 'noise' | 'lfsr' | 'lfsr93' | 'pluck' | readonly number[];

export interface Voice {
  wave: Wave;
  /** Start time in seconds. */
  at: number;
  /** Hz at the start; for noise, its clock. */
  freq: number;
  /** Slide to this Hz over `slide` seconds (exponential in pitch), bent by `curve` (above 1, late; below, early). */
  to?: number;
  slide?: number;
  curve?: number;
  /** An arc in pitch: up by this many semitones and back down over `time` seconds (a throw, a bounce). */
  arc?: [number, number];
  /**
   * A pitch bend through breakpoints, each [seconds into the note, semitones], joined in straight lines and held level
   * before the first and after the last: a slide into a note, out of it, or a string pressed partway through.
   */
  bend?: ReadonlyArray<readonly [number, number]>;
  /** Vibrato: rate in Hz, depth in semitones, a delay before it starts, and how long it takes to grow in (0.12 s). */
  vib?: [number, number, number, number?];
  /** Arpeggio: semitone offsets cycled at `rate` Hz. */
  arp?: [readonly number[], number];
  /** Pulse width (0 to 1), and where it sweeps to over the note. */
  duty?: number;
  dutyTo?: number;
  /** Envelope: attack, decay (time to fall to the sustain), sustain level, how long the note is held, release. */
  a?: number;
  /** Seconds the note stays at full level after its attack, before its decay starts. */
  stay?: number;
  d?: number;
  s?: number;
  hold: number;
  r?: number;
  gain: number;
  pan?: number;
  /** Low-pass cutoff in Hz, sweeping to `lpTo` over `lpTime`, with resonance `q`; and a fixed high-pass. */
  lp?: number;
  lpTo?: number;
  lpTime?: number;
  q?: number;
  hp?: number;
  /** A band-pass instead of the low-pass: centre in Hz, sweeping to `bpTo` over `bpTime`, width set by `q`. */
  bp?: number;
  bpTo?: number;
  bpTime?: number;
  /** Vowel-like resonances (Hz) the tone is sounded through, as a voice or a kazoo; `fq` is their sharpness. */
  formants?: readonly number[];
  fq?: number;
  /** Pitch, arpeggio and pulse width change only this many times a second, as a chip updated them each frame. */
  tick?: number;
  /** The volume moves in this many steps, as a chip's 4-bit volume did. */
  vsteps?: number;
  /** Tremolo: rate in Hz and depth (0 to 1). */
  trem?: [number, number];
  /** Pan sweeping to here over the note. */
  panTo?: number;
  /** Detuned copies: count, total spread in cents, stereo width. */
  unison?: [number, number, number];
  /** Bit depth and sample rate to crush this voice to. */
  crush?: [number, number];
  /** Saturation amount (tanh drive). */
  drive?: number;
  /** Effect sends. */
  delay?: number;
  verb?: number;
  /**
   * Where in its cycle the wave starts (0 to 1). By default a single triangle or saw starts at a rising zero, as Web
   * Audio's oscillators do, and every other wave at its own start; unison copies start at random phases.
   */
  phase?: number;
  /** Seed for noise and unison phases. */
  seed?: number;
  /**
   * The tone's source stops after this many seconds while its filters and formants ring on, as a struck block or a
   * small cymbal does after the stick has left it. A narrow band-pass is unity at its peak, so such a ring is quiet.
   */
  burst?: number;
  /** A pluck: how much of the string's sound is left after each trip round it (0.996), and how bright the pick is (0 to 1, 0.5). */
  decay?: number;
  bright?: number;
}

/** The length of a voice in seconds, with its release. */
export function voiceEnd(v: Voice): number {
  return v.at + v.hold + (v.r ?? 0.01);
}

const TAU = Math.PI * 2;

function polyblep(t: number, dt: number): number {
  if (t < dt) {
    const x = t / dt;
    return x + x - x * x - 1;
  }
  if (t > 1 - dt) {
    const x = (t - 1) / dt;
    return x * x + x + x + 1;
  }
  return 0;
}

/** A biquad filter (RBJ cookbook), updated as its cutoff moves. */
class Biquad {
  private b0 = 1;
  private b1 = 0;
  private b2 = 0;
  private a1 = 0;
  private a2 = 0;
  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;
  private readonly kind: 'lp' | 'hp' | 'bp';
  constructor(kind: 'lp' | 'hp' | 'bp') {
    this.kind = kind;
  }
  set(freq: number, q: number): void {
    const f = Math.min(freq, SR * 0.45);
    const w = (TAU * f) / SR;
    const cs = Math.cos(w);
    const alpha = Math.sin(w) / (2 * q);
    const a0 = 1 + alpha;
    if (this.kind === 'lp') {
      this.b0 = (1 - cs) / 2 / a0;
      this.b1 = (1 - cs) / a0;
      this.b2 = this.b0;
    } else if (this.kind === 'hp') {
      this.b0 = (1 + cs) / 2 / a0;
      this.b1 = -(1 + cs) / a0;
      this.b2 = this.b0;
    } else {
      this.b0 = alpha / a0;
      this.b1 = 0;
      this.b2 = -alpha / a0;
    }
    this.a1 = (-2 * cs) / a0;
    this.a2 = (1 - alpha) / a0;
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

/** The level before the release at time x into a note: the attack, then the decay to the sustain level. */
function attackDecay(x: number, a: number, d: number, s: number, stay: number): number {
  if (x < a) return x / a;
  // With no decay the note holds at full level; with one it falls to the sustain level.
  if (d <= 0) return 1;
  return s + (1 - s) * Math.exp((-4.6 * Math.max(0, x - a - stay)) / d);
}

/** Writes one voice into a mix. */
export function play(mix: Mix, v: Voice): void {
  const start = Math.round(v.at * SR);
  const end = Math.min(mix.length, Math.round(voiceEnd(v) * SR));
  if (end <= start || v.gain <= 0) return;
  const random = rng(v.seed ?? 7919 + start);
  const [count, cents, width] = v.unison ?? [1, 0, 0];
  const stereo = count > 1 && width > 0;
  const startPhase = v.phase ?? (v.wave === 'tri' ? 0.75 : v.wave === 'saw' ? 0.5 : 0);
  const phases = Array.from({ length: count }, () => (count > 1 ? random() : startPhase));
  const detune = Array.from({ length: count }, (_, i) => (count > 1 ? 2 ** (((i / (count - 1) - 0.5) * cents) / 1200) : 1));
  const pans = Array.from({ length: count }, (_, i) => (count > 1 ? (i / (count - 1) - 0.5) * 2 * width : 0));
  // Each copy's place, and a voice's fixed pan, worked out once rather than every sample (the same sums, so the same sound).
  const copyL = pans.map((p) => Math.cos(((p + 1) * Math.PI) / 4));
  const copyR = pans.map((p) => Math.sin(((p + 1) * Math.PI) / 4));
  // One swept filter (a band-pass if asked, else a low-pass), a fixed high-pass, and the formants, each per side.
  const sweepKind = v.bp ? 'bp' : v.lp ? 'lp' : null;
  const sweepFrom = (v.bp ?? v.lp) || 1;
  const sweepTo = v.bp ? v.bpTo : v.lpTo;
  // Every sweep's time is at least a sample long, so a zero (or a zero hold) cannot divide 0 by 0.
  const span = (x: number) => Math.max(x, 1 / SR);
  const sweepTime = span((v.bp ? v.bpTime : v.lpTime) ?? v.hold);
  const fl = sweepKind ? new Biquad(sweepKind) : null;
  const fr = sweepKind && stereo ? new Biquad(sweepKind) : null;
  const hp = v.hp ? new Biquad('hp') : null;
  const hpR = v.hp && stereo ? new Biquad('hp') : null;
  hp?.set(v.hp!, 0.707);
  hpR?.set(v.hp!, 0.707);
  const formant = () =>
    (v.formants ?? []).map((f) => {
      const b = new Biquad('bp');
      b.set(f, v.fq ?? 6);
      return b;
    });
  const formL = formant();
  const formR = stereo ? formant() : [];
  const formGain = formL.length ? 2.5 / Math.sqrt(formL.length) : 1;
  const q = v.q ?? 0.707;
  const slideSemis = v.to ? 12 * Math.log2(v.to / v.freq) : 0;
  const slideTime = span(v.slide ?? v.hold);
  const holdTime = span(v.hold);
  const curve = v.curve ?? 1;
  const pan0 = v.pan ?? 0;
  const panCos = Math.cos(((pan0 + 1) * Math.PI) / 4);
  const panSin = Math.sin(((pan0 + 1) * Math.PI) / 4);
  const table = Array.isArray(v.wave) ? (v.wave as readonly number[]) : null;
  const wave = table ? 'table' : (v.wave as string);
  // Noise state, one per unison copy, so each copy is clocked at its own rate.
  const noiseHold = new Float64Array(count);
  const noiseClock = new Float64Array(count).fill(1);
  const lfsr = new Int32Array(count).fill(1);
  // A pluck's string, one per copy: a delay line long enough for the lowest pitch the note can reach (the slide, bend,
  // arc, arpeggio and vibrato all add together, and the lowest unison copy sits below), filled with the pick's noise
  // (softened by `bright`, its average taken out so the string does not hold a constant offset).
  const bendLow = Math.min(0, slideSemis) + Math.min(0, ...(v.bend ?? []).map(([, b]) => b)) - Math.abs(v.vib?.[1] ?? 0)
    - (v.arc ? Math.max(0, -v.arc[0]) : 0) + Math.min(0, ...(v.arp?.[0] ?? [])) - cents / 200;
  const strings = wave === 'pluck'
    ? Array.from({ length: count }, () => {
        const line = new Float32Array(Math.ceil(SR / (v.freq * 2 ** ((bendLow - 1) / 12))) + 4);
        const soft = Math.min(1, Math.max(0.02, v.bright ?? 0.5));
        let y = 0;
        let sum = 0;
        for (let j = 0; j < line.length; j++) {
          y += soft * (random() * 2 - 1 - y);
          line[j] = y;
          sum += y;
        }
        const mean = sum / line.length;
        for (let j = 0; j < line.length; j++) line[j]! -= mean;
        return { line, w: 0, last: 0 };
      })
    : [];
  const loss = 0.5 * (v.decay ?? 0.996);
  const bend = v.bend ?? [];
  let bendAt = 0;
  const vibGrow = span(v.vib?.[3] ?? 0.12);
  let crushClock = 1;
  let crushL = 0;
  let crushR = 0;
  const crushStep = v.crush ? v.crush[1] / SR : 0;
  const crushLevels = v.crush ? 2 ** (v.crush[0] - 1) : 0;
  const drive = v.drive ?? 0;
  const driveNorm = drive > 0 ? Math.tanh(drive) : 1;
  const delayL = v.delay ? mix.delayL : null;
  const delayR = v.delay ? mix.delayR : null;
  const verbL = v.verb ? mix.verbL : null;
  const verbR = v.verb ? mix.verbR : null;
  // Everything the loop reads from the voice, read once: voices come in many shapes, and reading a field of one every
  // sample is slow once the renderer has met them all. The sums are the same, so the sound is.
  const { tick, arc, vib, arp, freq, dutyTo, burst, vsteps, trem, gain, panTo, hold } = v;
  const duty0 = v.duty ?? 0.5;
  const arcSpan = arc ? span(arc[1]) : 1;
  const envA = v.a ?? 0.002;
  const envStay = v.stay ?? 0;
  const envD = v.d ?? 0;
  const envS = v.s ?? 1;
  const envR = v.r ?? 0.01;
  const delaySend = v.delay ?? 0;
  const verbSend = v.verb ?? 0;
  for (let i = start; i < end; i++) {
    const t = (i - start) / SR;
    // Pitch, arpeggio and pulse width move on the chip's frame clock when `tick` is set.
    const tp = tick ? Math.floor(t * tick) / tick : t;
    if (fl && (i - start) % 16 === 0) {
      const f = sweepTo !== undefined ? sweepFrom * (sweepTo / sweepFrom) ** Math.min(1, t / sweepTime) : sweepFrom;
      fl.set(f, q);
      fr?.set(f, q);
    }
    let semis = 0;
    if (slideSemis) semis += slideSemis * Math.min(1, tp / slideTime) ** curve;
    if (arc) semis += arc[0] * Math.sin(Math.PI * Math.min(1, tp / arcSpan));
    if (bend.length) {
      while (bendAt + 1 < bend.length && tp >= bend[bendAt + 1]![0]) bendAt++;
      const [t0, b0] = bend[bendAt]!;
      const after = bend[bendAt + 1];
      semis += tp <= t0 || !after ? b0 : b0 + ((after[1] - b0) * (tp - t0)) / span(after[0] - t0);
    }
    if (vib && tp > vib[2]) semis += vib[1] * Math.sin(TAU * vib[0] * (tp - vib[2])) * Math.min(1, (tp - vib[2]) / vibGrow);
    if (arp) semis += arp[0][Math.floor(tp * arp[1] + 1e-9) % arp[0].length]!;
    const f0 = semis === 0 ? freq : freq * 2 ** (semis / 12);
    const duty = dutyTo !== undefined ? duty0 + ((dutyTo - duty0) * Math.min(1, tp / holdTime)) : duty0;
    let left = 0;
    let right = 0;
    for (let k = 0; k < count; k++) {
      const f = f0 * detune[k]!;
      const dt = f / SR;
      const ph = phases[k]!;
      let x: number;
      switch (wave) {
        case 'sine':
          x = Math.sin(TAU * ph);
          break;
        case 'tri':
          x = 4 * Math.abs(ph - 0.5) - 1;
          break;
        case 'tri4': {
          const step = Math.floor(ph * 32);
          const level = step < 16 ? 15 - step : step - 16;
          x = level / 7.5 - 1;
          break;
        }
        case 'saw':
          x = 2 * ph - 1 - polyblep(ph, dt);
          break;
        case 'square':
        case 'pulse': {
          const w = wave === 'square' ? 0.5 : duty;
          x = (ph < w ? 1 : -1) + polyblep(ph, dt) - polyblep((ph - w + 1) % 1, dt) - (2 * w - 1);
          break;
        }
        case 'noise': {
          let clock = noiseClock[k]! + f / SR;
          if (clock >= 1) {
            clock %= 1;
            noiseHold[k] = random() * 2 - 1;
          }
          noiseClock[k] = clock;
          x = noiseHold[k]!;
          break;
        }
        case 'lfsr':
        case 'lfsr93': {
          let clock = noiseClock[k]! + f / SR;
          let reg = lfsr[k]!;
          while (clock >= 1) {
            clock -= 1;
            const bit = (reg ^ (reg >> (wave === 'lfsr' ? 1 : 6))) & 1;
            reg = (reg >> 1) | (bit << 14);
          }
          noiseClock[k] = clock;
          lfsr[k] = reg;
          x = reg & 1 ? -0.8 : 0.8;
          break;
        }
        case 'pluck': {
          // Read one period back (less the half sample the averaging adds), between samples for a bent pitch, then
          // write back the average of this sample and the last, a little quieter.
          const st = strings[k]!;
          const n = st.line.length;
          const back = Math.min(n - 2, Math.max(1, SR / f - 0.5));
          const pos = st.w - back + n;
          const j = Math.floor(pos);
          const frac = pos - j;
          x = st.line[j % n]! * (1 - frac) + st.line[(j + 1) % n]! * frac;
          st.line[st.w] = loss * (x + st.last);
          st.last = x;
          st.w = (st.w + 1) % n;
          break;
        }
        default:
          x = table![Math.floor(ph * table!.length) % table!.length]!;
      }
      const next = ph + dt;
      phases[k] = next - Math.floor(next);
      if (burst !== undefined && t > burst) x = 0;
      if (count > 1) {
        left += x * copyL[k]!;
        right += x * copyR[k]!;
      } else {
        left = x;
        right = x;
      }
    }
    if (count > 1) {
      left /= Math.sqrt(count) * 0.7071;
      right /= Math.sqrt(count) * 0.7071;
      if (!stereo) right = left;
    }
    if (formL.length) {
      let sl = 0;
      for (const b of formL) sl += b.run(left);
      let sr = sl;
      if (stereo) {
        sr = 0;
        for (const b of formR) sr += b.run(right);
      }
      left = sl * formGain;
      right = sr * formGain;
    }
    if (fl) {
      left = fl.run(left);
      right = fr ? fr.run(right) : left;
    }
    if (hp) {
      left = hp.run(left);
      right = hpR ? hpR.run(right) : left;
    }
    if (crushStep) {
      crushClock += crushStep;
      if (crushClock >= 1) {
        crushClock %= 1;
        crushL = Math.round(left * crushLevels) / crushLevels;
        crushR = Math.round(right * crushLevels) / crushLevels;
      }
      left = crushL;
      right = crushR;
    }
    if (drive > 0) {
      left = Math.tanh(left * drive) / driveNorm;
      right = Math.tanh(right * drive) / driveNorm;
    }
    let e: number;
    if (t < hold) e = attackDecay(t, envA, envD, envS, envStay);
    else {
      const x = (t - hold) / envR;
      e = x >= 1 ? 0 : attackDecay(hold, envA, envD, envS, envStay) * Math.exp(-4.6 * x) * (1 - x);
    }
    if (vsteps) e = Math.round(e * vsteps) / vsteps;
    if (trem) e *= 1 - trem[1] * (0.5 + 0.5 * Math.sin(TAU * trem[0] * t));
    const g = e * gain;
    let outL: number;
    let outR: number;
    if (stereo) {
      // A wide voice keeps its spread and is balanced toward its pan.
      const p = panTo !== undefined ? pan0 + (panTo - pan0) * Math.min(1, t / holdTime) : pan0;
      outL = left * g * Math.min(1, 1 - p);
      outR = right * g * Math.min(1, 1 + p);
    } else if (panTo !== undefined) {
      const p = pan0 + (panTo - pan0) * Math.min(1, t / holdTime);
      outL = left * g * Math.cos(((p + 1) * Math.PI) / 4) * Math.SQRT2;
      outR = left * g * Math.sin(((p + 1) * Math.PI) / 4) * Math.SQRT2;
    } else {
      outL = left * g * panCos * Math.SQRT2;
      outR = left * g * panSin * Math.SQRT2;
    }
    mix.l[i]! += outL;
    mix.r[i]! += outR;
    if (delayL && delayR) {
      delayL[i]! += outL * delaySend;
      delayR[i]! += outR * delaySend;
    }
    if (verbL && verbR) {
      verbL[i]! += outL * verbSend;
      verbR[i]! += outR * verbSend;
    }
  }
}

export interface DelayFx {
  /** Seconds between echoes. */
  time: number;
  feedback: number;
  /** Low-pass in the feedback loop, Hz. */
  tone?: number;
  /** Echoes alternate sides. */
  pingpong?: boolean;
}

export interface ReverbFx {
  /** 0 to 1: how long the tail is. */
  room: number;
  /** 0 to 1: how dull the tail gets. */
  damp: number;
  /** Reverb return level. */
  wet?: number;
}

export interface Fx {
  delay?: DelayFx;
  reverb?: ReverbFx;
  /** Crush the whole mix: bits and sample rate. */
  crush?: [number, number];
  /** A gentle low-pass on the whole mix (Hz), as old hardware's output filter softened it. */
  lp?: number;
  /** Saturation of the whole mix. */
  drive?: number;
  /** Mono: both sides the same. */
  mono?: boolean;
}

function runDelay(mix: Mix, fx: DelayFx): void {
  const n = Math.max(1, Math.round(fx.time * SR));
  const bufL = new Float32Array(n);
  const bufR = new Float32Array(n);
  let p = 0;
  let lpL = 0;
  let lpR = 0;
  const k = fx.tone ? 1 - Math.exp((-TAU * fx.tone) / SR) : 1;
  const inL = mix.delayL;
  const inR = mix.delayR;
  for (let i = 0; i < mix.length; i++) {
    const outL = bufL[p]!;
    const outR = bufR[p]!;
    lpL += (outL - lpL) * k;
    lpR += (outR - lpR) * k;
    if (fx.pingpong) {
      bufL[p] = inL[i]! * 0.5 + inR[i]! * 0.5 + lpR * fx.feedback;
      bufR[p] = lpL * fx.feedback;
    } else {
      bufL[p] = inL[i]! + lpL * fx.feedback;
      bufR[p] = inR[i]! + lpR * fx.feedback;
    }
    mix.l[i]! += outL;
    mix.r[i]! += outR;
    p = (p + 1) % n;
  }
}

const COMBS = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
const ALLPASSES = [556, 441, 341, 225];

/** Freeverb (Jezar's public-domain design), on the reverb send. */
function runReverb(mix: Mix, fx: ReverbFx): void {
  const scale = SR / 44100;
  const room = fx.room * 0.28 + 0.7;
  const damp = fx.damp * 0.4;
  const wet = (fx.wet ?? 1) * 3;
  const side = (input: Float32Array, out: Float32Array, spread: number) => {
    const combs = COMBS.map((c) => ({ buf: new Float32Array(Math.round((c + spread) * scale)), p: 0, store: 0 }));
    const alls = ALLPASSES.map((c) => ({ buf: new Float32Array(Math.round((c + spread) * scale)), p: 0 }));
    for (let i = 0; i < input.length; i++) {
      const x = input[i]! * 0.015;
      let sum = 0;
      for (const c of combs) {
        const y = c.buf[c.p]!;
        c.store = y * (1 - damp) + c.store * damp;
        c.buf[c.p] = x + c.store * room;
        c.p = (c.p + 1) % c.buf.length;
        sum += y;
      }
      for (const a of alls) {
        const b = a.buf[a.p]!;
        a.buf[a.p] = sum + b * 0.5;
        a.p = (a.p + 1) % a.buf.length;
        sum = b - sum;
      }
      out[i]! += sum * wet;
    }
  };
  side(mix.verbL, mix.l, 0);
  side(mix.verbR, mix.r, 23);
}

/** Runs the effects into the mix, then the whole-mix crush and drive. */
export function finish(mix: Mix, fx: Fx = {}): Mix {
  if (fx.delay) runDelay(mix, fx.delay);
  if (fx.reverb) runReverb(mix, fx.reverb);
  mix.closeSends();
  if (fx.mono) {
    for (let i = 0; i < mix.length; i++) {
      const m = (mix.l[i]! + mix.r[i]!) * 0.5;
      mix.l[i] = m;
      mix.r[i] = m;
    }
  }
  if (fx.crush) {
    const levels = 2 ** (fx.crush[0] - 1);
    const step = fx.crush[1] / SR;
    let clock = 1;
    let hl = 0;
    let hr = 0;
    for (let i = 0; i < mix.length; i++) {
      clock += step;
      if (clock >= 1) {
        clock %= 1;
        hl = Math.round(mix.l[i]! * levels) / levels;
        hr = Math.round(mix.r[i]! * levels) / levels;
      }
      mix.l[i] = hl;
      mix.r[i] = hr;
    }
  }
  if (fx.lp) {
    for (const side of [mix.l, mix.r]) {
      const b = new Biquad('lp');
      b.set(fx.lp, 0.6);
      for (let i = 0; i < mix.length; i++) side[i] = b.run(side[i]!);
    }
  }
  if (fx.drive) {
    const n = Math.tanh(fx.drive);
    for (let i = 0; i < mix.length; i++) {
      mix.l[i] = Math.tanh(mix.l[i]! * fx.drive) / n;
      mix.r[i] = Math.tanh(mix.r[i]! * fx.drive) / n;
    }
  }
  return mix;
}

/** Adds `src` into `dst` from `at` seconds, scaled, with a gate that cuts it off after `gate` seconds if given. */
export function addInto(dst: Mix, src: Mix, at: number, gain = 1, gate?: number): void {
  const o = Math.round(at * SR);
  const cut = gate !== undefined ? Math.round(gate * SR) : Infinity;
  const fade = Math.round(0.012 * SR);
  for (let i = 0; i < src.length && o + i < dst.length; i++) {
    if (o + i < 0) continue;
    let g = gain;
    if (i > cut) {
      const x = (i - cut) / fade;
      if (x >= 1) break;
      g *= 1 - x;
    }
    dst.l[o + i]! += src.l[i]! * g;
    dst.r[o + i]! += src.r[i]! * g;
  }
}

/**
 * Folds everything past `seconds` back onto the start, so a loop played over and over carries its own tails
 * (echoes, reverb, notes held over the end) into its next pass with no seam. `opening`: a track that goes round to a
 * later step (`Track.loopFrom`) has none to carry, its last notes being those before that step, which ring on there
 * already; carrying them would double them on every pass, its first included.
 */
export function fold(mix: Mix, seconds: number, opening = false): Mix {
  // The loop in whole samples. Steps times the step can land a hair over a whole sample in floating point (384 steps of
  // 0.1 s is 38.400000000000006 s, the maze's loop since 2026-10-26), which must not add a sample to the loop.
  const out = new Mix((Math.ceil(seconds * SR - 1e-6) - 0.5) / SR);
  for (let i = 0; i < (opening ? Math.min(mix.length, out.length) : mix.length); i++) {
    const j = i % out.length;
    out.l[j]! += mix.l[i]!;
    out.r[j]! += mix.r[i]!;
  }
  return out;
}

/** The highest sample, either side. */
export function peak(mix: Mix): number {
  let p = 0;
  for (let i = 0; i < mix.length; i++) p = Math.max(p, Math.abs(mix.l[i]!), Math.abs(mix.r[i]!));
  return p;
}

/** Scales the whole mix. */
export function scale(mix: Mix, g: number): Mix {
  for (let i = 0; i < mix.length; i++) {
    mix.l[i]! *= g;
    mix.r[i]! *= g;
  }
  return mix;
}

/**
 * K-weighting (ITU-R BS.1770): a high shelf then a high pass, designed from their analog prototype for the render
 * rate, as libebur128 does; at 48 kHz this gives the standard's own coefficients exactly.
 */
function kWeight(x: Float32Array): Float32Array {
  const out = new Float32Array(x.length);
  const shelf = (() => {
    const K = Math.tan((Math.PI * 1681.974450955533) / SR);
    const Q = 0.7071752369554196;
    const Vh = 10 ** (3.999843853973347 / 20);
    const Vb = Vh ** 0.4996667741545416;
    const a0 = 1 + K / Q + K * K;
    return { b: [(Vh + (Vb * K) / Q + K * K) / a0, (2 * (K * K - Vh)) / a0, (Vh - (Vb * K) / Q + K * K) / a0], a: [(2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0] };
  })();
  const pass = (() => {
    const K = Math.tan((Math.PI * 38.13547087602444) / SR);
    const Q = 0.5003270373238773;
    const a0 = 1 + K / Q + K * K;
    return { b: [1, -2, 1], a: [(2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0] };
  })();
  for (const f of [shelf, pass]) {
    let x1 = 0;
    let x2 = 0;
    let y1 = 0;
    let y2 = 0;
    const src = f === shelf ? x : out;
    for (let i = 0; i < x.length; i++) {
      const xi = src[i]!;
      const y = f.b[0]! * xi + f.b[1]! * x1 + f.b[2]! * x2 - f.a[0]! * y1 - f.a[1]! * y2;
      x2 = x1;
      x1 = xi;
      y2 = y1;
      y1 = y;
      out[i] = y;
    }
  }
  return out;
}

/**
 * Loudness in LUFS (BS.1770): `integrated` over the whole, gated as the standard says, and `momentary`, the loudest
 * 400 ms (the measure for short effects). A sound shorter than 400 ms is measured as if padded with silence.
 */
export function loudness(mix: Mix): { integrated: number; momentary: number } {
  const block = Math.round(0.4 * SR);
  const hop = Math.round(0.1 * SR);
  // Padded with silence so the blocks, a hop apart, reach the very end (a sound shorter than one block is one block).
  const n = mix.length <= block ? block : block + Math.ceil((mix.length - block) / hop) * hop;
  const pad = (x: Float32Array) => {
    if (x.length >= n) return x;
    const y = new Float32Array(n);
    y.set(x);
    return y;
  };
  const kl = kWeight(pad(mix.l));
  const kr = kWeight(pad(mix.r));
  const powers: number[] = [];
  for (let s = 0; s + block <= n; s += hop) {
    let sum = 0;
    for (let i = s; i < s + block; i++) sum += kl[i]! * kl[i]! + kr[i]! * kr[i]!;
    powers.push(sum / block);
  }
  const lufs = (p: number) => -0.691 + 10 * Math.log10(Math.max(p, 1e-12));
  const momentary = Math.max(...powers.map(lufs));
  const abs = powers.filter((p) => lufs(p) > -70);
  if (!abs.length) return { integrated: -Infinity, momentary };
  const mean = abs.reduce((a, b) => a + b, 0) / abs.length;
  const rel = abs.filter((p) => lufs(p) > lufs(mean) - 10);
  return { integrated: lufs(rel.reduce((a, b) => a + b, 0) / rel.length), momentary };
}

/** Loudness targets for comparing sounds fairly: effects and voices by their loudest 400 ms, music as a whole. */
export const TARGET = { sfx: -18, voice: -22, music: -20 } as const;

/**
 * Scales a mix to a loudness (LUFS; momentary for effects and voices, integrated for music), its kind's target unless
 * another is given, never letting its peak pass -1 dBFS: a sound that would is left that much quieter, and `limited`
 * says by how many dB.
 */
export function normalize(mix: Mix, kind: keyof typeof TARGET, target: number = TARGET[kind]): { gain: number; limited: number } {
  const l = loudness(mix);
  const now = kind === 'music' ? l.integrated : l.momentary;
  if (!Number.isFinite(now)) return { gain: 1, limited: 0 };
  const g = gainTo(now, peak(mix), target);
  scale(mix, g.gain);
  return g;
}

/** The gain `normalize` gives a sound measured at `now` (LUFS) with the peak `top`: to `target`, kept under -1 dBFS. */
export function gainTo(now: number, top: number, target: number): { gain: number; limited: number } {
  let gain = 10 ** ((target - now) / 20);
  const ceiling = 10 ** (-1 / 20);
  const p = top * gain;
  let limited = 0;
  if (p > ceiling) {
    limited = 20 * Math.log10(p / ceiling);
    gain *= ceiling / p;
  }
  return { gain, limited };
}

/** A 16-bit stereo WAV file of the mix. */
export function wav(mix: Mix): Uint8Array {
  const n = mix.length;
  const buf = new ArrayBuffer(44 + n * 4);
  const d = new DataView(buf);
  const str = (o: number, s: string) => [...s].forEach((c, i) => d.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  d.setUint32(4, 36 + n * 4, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  d.setUint32(16, 16, true);
  d.setUint16(20, 1, true);
  d.setUint16(22, 2, true);
  d.setUint32(24, SR, true);
  d.setUint32(28, SR * 4, true);
  d.setUint16(32, 4, true);
  d.setUint16(34, 16, true);
  str(36, 'data');
  d.setUint32(40, n * 4, true);
  for (let i = 0; i < n; i++) {
    d.setInt16(44 + i * 4, Math.round(Math.max(-1, Math.min(1, mix.l[i]!)) * 32767), true);
    d.setInt16(46 + i * 4, Math.round(Math.max(-1, Math.min(1, mix.r[i]!)) * 32767), true);
  }
  return new Uint8Array(buf);
}
