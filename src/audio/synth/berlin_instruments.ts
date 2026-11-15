// Berlin voices from the approved music savepoint (2026-10-18).
import { SR, type Voice } from './dsp.ts';


export type Art = 'x' | 'a' | 'g';

export interface Ctx { step: number; part: number; seed: number }

export type Play = (v: Voice[], at: number, hold: number, f: number, gain: number, art: Art, c: Ctx) => void;


const accent = (art: Art) => (art === 'a' ? 1.35 : art === 'g' ? 0.45 : 1);

const sequencer80: Play = (v, t, hold, f, gain, art, c) => {
  v.push({ wave: 'pulse', duty: 0.3, at: t, freq: f, hold: Math.min(hold, c.step) * 0.7, gain: 0.11 * gain * accent(art), d: 0.1, s: 0.3, r: 0.03, lp: 3500, delay: 0.35 });
};

/** A clean electric guitar: a plucked string, a little bright, ringing. */
const guitar: Play = (v, t, hold, f, gain, art, c) => {
  v.push({ wave: 'pluck', at: t, freq: f, hold: Math.max(hold, 0.15), gain: 0.5 * gain * accent(art), decay: 0.997, bright: 0.55, a: 0.001, r: 0.15, lp: 5000, lpTo: 2600, lpTime: 0.5, verb: 0.3, delay: 0.15, seed: c.seed });
};

/** A drum machine's kick, snare (clap-like) and closed hat. */
const machineKick: Play = (v, t, _h, _f, gain, art) => { v.push({ wave: 'sine', at: t, freq: 110, to: 45, slide: 0.12, hold: 0.02, gain: 0.32 * gain * accent(art), d: 0.42, s: 0, r: 0.05 }); };

const machineSnare: Play = (v, t, _h, _f, gain, art) => {
  const g = 1.1 * gain * accent(art);
  for (const dt of [0, 0.011, 0.022]) v.push({ wave: 'noise', freq: SR, at: t + dt, hold: 0.008, gain: g, d: 0.012, s: 0, bp: 1300, q: 1.1 });
  v.push({ wave: 'noise', freq: SR, at: t + 0.03, hold: 0.02, gain: g * 0.8, d: 0.14, s: 0, bp: 1500, q: 0.9, verb: 0.4 });
};

const machineHat: Play = (v, t, hold, _f, gain, art, c) => {
  const open = hold > c.step * 1.5;
  v.push({ wave: 'square', at: t, freq: 6400, unison: [4, 600, 0], hold: open ? 0.15 : 0.012, gain: (open ? 0.4 : 0.35) * gain * accent(art), d: open ? 0.15 : 0.035, s: 0, hp: 7500 });
};

/** A picked electric bass from the clean guitar's string: a short, round pluck with the pick's edge. */
const eBass: Play = (v, t, hold, f, gain, art, c) => {
  v.push({ wave: 'pluck', at: t, freq: f, hold: Math.max(hold, 0.12), gain: 0.55 * gain * accent(art), decay: 0.993, bright: 0.45, a: 0.001, r: 0.06, lp: 2400, lpTo: 900, lpTime: 0.3, seed: c.seed });
  v.push({ wave: 'sine', at: t, freq: f, hold: 0.05, gain: 0.12 * gain, a: 0.002, d: 0.12, s: 0, r: 0.05 });
};

/** The clean guitar heard over the Wall: let ring, low-passed, a long reverb. */
const farGuitar: Play = (v, t, hold, f, gain, art, c) => {
  v.push({ wave: 'pluck', at: t, freq: f, hold: Math.max(hold, 0.6), gain: 0.4 * gain * accent(art), decay: 0.9985, bright: 0.4, a: 0.001, r: 0.6, lp: 1500, verb: 0.9, delay: 0.25, seed: c.seed });
};
export const BERLIN_VOICES: Record<string, Play> = {
  Kick: machineKick, Snare: machineSnare, Hat: machineHat, Bass: eBass,
  'Guitar tune': guitar, 'Guitar, sequencer part': guitar, 'Far guitar': farGuitar, Sequencer: sequencer80,
};
