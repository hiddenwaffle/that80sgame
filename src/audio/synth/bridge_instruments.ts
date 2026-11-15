// Instruments retained from the approved bridge reference; other tracks keep their existing voices.
import { SR, type Voice } from './dsp.ts';
import { bass, shaker } from './beijing.ts';
export type Art = 'x' | 'a' | 'g';
export interface Ctx { step: number; part: number; seed: number }
export type Play = (v: Voice[], at: number, hold: number, f: number, gain: number, art: Art, c: Ctx) => void;
const accent = (art: Art) => (art === 'a' ? 1.35 : art === 'g' ? 0.45 : 1);

// --- Console (the game's arcade band) ---------------------------------------------------------------------------------
/** The Console lead: a 25% pulse, delayed vibrato, a chip's 15 volume steps; notes of four steps or more decay to a quiet tail. */
const consoleLead: Play = (v, at, hold, f, gain, art, c) => {
  const steps = hold / c.step;
  const h = hold * 0.92;
  const taper = steps >= 4 - 1e-6;
  v.push({ wave: 'pulse', duty: 0.25, at, freq: f, hold: h, gain: 0.3 * gain * accent(art), tick: 60, vsteps: 15, a: 0.002,
    d: taper ? c.step * 6 : h * 2, s: taper ? 0.31 : 0.6, r: 0.03, vib: [6, 0.18, 0.2] });
};

/** The Console's broken-chord pulse: one short note a step, as the band's harmony layer plays them. */
const consoleArp: Play = (v, at, hold, f, gain, art, c) => {
  v.push({ wave: 'pulse', duty: 0.5, at, freq: f, hold: Math.min(hold, c.step) * 0.7, gain: 0.13 * gain * accent(art), tick: 60, vsteps: 15, a: 0.002, d: 0.08, s: 0.3, r: 0.01 });
};

const consoleKick: Play = (v, at, _h, _f, gain, art) => {
  const g = gain * accent(art);
  v.push({ wave: 'tri4', at, freq: 180, to: 50, hold: 0.07, gain: 0.3 * g, tick: 120 });
  v.push({ wave: 'lfsr', at, freq: 200000, hold: 0.012, gain: 0.12 * g, d: 0.012, s: 0 });
};

const consoleSnare: Play = (v, at, _h, _f, gain, art) => { v.push({ wave: 'lfsr', at, freq: 60000, hold: 0.1, gain: 0.15 * gain * accent(art), d: 0.1, s: 0, vsteps: 15 }); };

const consoleHat: Play = (v, at, _h, _f, gain, art) => { v.push({ wave: 'lfsr', at, freq: 400000, hold: 0.03, gain: 0.065 * gain * accent(art), d: 0.03, s: 0 }); };

const consoleCrash: Play = (v, at, _h, _f, gain, art) => { v.push({ wave: 'lfsr', at, freq: 300000, hold: 0.8, gain: 0.36 * gain * accent(art), d: 0.8, s: 0, vsteps: 15 }); };

// --- New, for the sketches ----------------------------------------------------------------------------------------------
/** An orchestral (military) snare: a tight crack with the wires' rattle; ghosts are soft. */
const orchSnare: Play = (v, t, _h, _f, gain, art) => {
  const g = 0.32 * gain * accent(art);
  v.push({ wave: 'noise', freq: SR, at: t, hold: 0.09, gain: g, a: 0.001, d: 0.09, s: 0, bp: 3800, q: 0.7, verb: 0.35 });
  v.push({ wave: 'noise', freq: SR, at: t, hold: 0.01, gain: g * 0.9, d: 0.025, s: 0, bp: 1500, q: 1.1 });
  v.push({ wave: 'sine', at: t, freq: 240, to: 200, slide: 0.03, hold: 0.02, gain: g * 0.5, d: 0.05, s: 0 });
};

/** A timpani: a low drum with a definite pitch, its head's partials ringing, the mallet's soft thud. */
const timpani: Play = (v, t, hold, f, gain, art) => {
  const p = f || 87.3;
  const g = 0.5 * gain * accent(art);
  const ring = Math.max(0.9, Math.min(2.2, hold + 0.6));
  v.push({ wave: 'sine', at: t, freq: p * 1.02, to: p, slide: 0.08, hold: 0.02, gain: g, a: 0.002, d: ring, s: 0, r: 0.2, verb: 0.4 });
  v.push({ wave: 'sine', at: t, freq: p * 1.5, hold: 0.02, gain: g * 0.35, a: 0.002, d: ring * 0.6, s: 0, r: 0.15, verb: 0.4 });
  v.push({ wave: 'sine', at: t, freq: p * 1.98, hold: 0.02, gain: g * 0.18, a: 0.002, d: ring * 0.4, s: 0, r: 0.1, verb: 0.4 });
  v.push({ wave: 'noise', freq: SR, at: t, hold: 0.02, gain: g * 0.25, d: 0.05, s: 0, lp: 700 });
};

/** A string section: several bowed saws a little apart through a body, slow to speak, with a slow vibrato. */
const strings: Play = (v, t, hold, f, gain, art) => {
  const short = hold < 0.25;
  v.push({ wave: 'saw', unison: [4, 14, 0.6], at: t, freq: f, hold, gain: 0.09 * gain * accent(art), a: short ? 0.02 : 0.12, d: 0.4, s: 0.85, r: short ? 0.06 : 0.25,
    formants: [400, 1100, 2600], fq: 1.4, lp: 4200, vib: [5.2, 0.12, 0.25, 0.4], verb: 0.45 });
};

/** A French horn: a dark, round brass tone, slow to speak. */
const horn: Play = (v, t, hold, f, gain, art) => {
  v.push({ wave: 'saw', at: t, freq: f, hold, gain: 0.14 * gain * accent(art), a: 0.05, d: 0.3, s: 0.8, r: 0.18, lp: 1300, lpTo: 900, lpTime: 0.4, formants: [380, 900], fq: 1.5, vib: [4.8, 0.06, 0.4, 0.4], verb: 0.5 });
};

/** The stepped triangle bass played as written, for parts that write their own octaves. */
const consoleBassPlain: Play = (v, at, hold, f, gain, _art, c) => { v.push({ wave: 'tri4', at, freq: f, hold: Math.min(hold, c.step * 6) * 0.9, gain: 0.3 * gain, a: 0.002, r: 0.015 }); };

/** Instruments by the keywords a composer's instrument name may contain, the more specific first. */
/**
 * A concert harp, played close and damped for an arpeggio (bridge, 2026-10-18): each note plucked bright and stopped
 * before the next, as the Console's pulse arpeggio is, so the sixteenths stay distinct instead of ringing into a wash
 * (left to ring, each note stood only 3 dB over the dip before the next; the pulse's stand 34 dB).
 */
const harp: Play = (v, t, hold, f, gain, art, c) => {
  v.push({ wave: 'pluck', at: t, freq: f, hold: Math.min(hold, 0.3) * 0.72, gain: 0.36 * gain * accent(art), decay: 0.993, bright: 0.6, a: 0.001, r: 0.03, lp: 7000, verb: 0.05, seed: c.seed });
};

/** A concert bass drum: a big, soft, low head and the felt mallet's thud (bridge v2). */
const concertBassDrum: Play = (v, t, _h, _f, gain, art) => {
  const g = 0.55 * gain * accent(art);
  v.push({ wave: 'sine', at: t, freq: 66, to: 52, slide: 0.18, hold: 0.02, gain: g, a: 0.004, d: 0.55, s: 0, r: 0.15, verb: 0.4 });
  v.push({ wave: 'sine', at: t, freq: 104, hold: 0.02, gain: g * 0.25, a: 0.003, d: 0.2, s: 0, r: 0.05, verb: 0.3 });
  v.push({ wave: 'noise', freq: SR, at: t, hold: 0.02, gain: g * 0.28, d: 0.05, s: 0, lp: 450 });
};
export const BRIDGE_VOICES: Record<string, Play> = {
 'Console lead': consoleLead, 'Console bass': consoleBassPlain, 'Console arpeggio': consoleArp,
 'Noise kick': consoleKick, 'Noise snare': consoleSnare, 'Noise hat': consoleHat, 'Noise crash': consoleCrash,
 Horn: horn, 'Strings upper': strings, 'Strings lower': strings, Timpani: timpani, Harp: harp,
 'Pizzicato bass': (v,t,h,f,g,a) => bass(v,t,h,f,0.55*g*accent(a)),
 'Bass drum': concertBassDrum, 'Snare drum': orchSnare,
 Shaker: (v,t,h,f,g,a) => shaker(v,t,0.12*g*accent(a),a==='g'),
};
