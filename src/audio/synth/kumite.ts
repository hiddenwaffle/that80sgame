import {
  KUMITE_BARS, KUMITE_BASS_UP, KUMITE_BOP, KUMITE_FILLS, KUMITE_INTRO_BARS, KUMITE_KICKS, KUMITE_LEAD, KUMITE_ROOTS, KUMITE_STABS,
  KUMITE_TRIADS, chordOfBar,
} from '../kumiteScore.ts';
import { Mix, SR, finish, fold, hz, play, type Fx, type Voice } from './dsp.ts';

/**
 * The street-fight music's arrangement (2026-10-12): the score in `kumiteScore.ts` on an 80s action-film band, as the
 * owner heard and approved it as a sketch. A pumping saw bass, a big gated snare, brass, a sequencer, a gliding
 * two-saw lead, and a bright pulse tune with its echo a dotted eighth behind, in one channel like the rest of the
 * Console music.
 */

type Layer = 'lead' | 'bass' | 'harmony' | 'drums';

/** The band's room and echo; the echo's time is three sixteenths (a dotted eighth), so it is set per tempo. */
export const kumiteFx = (step: number): Fx => ({ reverb: { room: 0.45, damp: 0.4, wet: 0.5 }, delay: { time: step * 3, feedback: 0.3, tone: 3000 }, mono: true });

function kick(v: Voice[], t: number, g = 0.9): void {
  v.push({ wave: 'sine', at: t, freq: 150, to: 48, slide: 0.09, hold: 0.02, gain: g, d: 0.32, s: 0, r: 0.05 });
  v.push({ wave: 'noise', freq: SR, at: t, hold: 0.005, gain: g * 0.25, d: 0.008, s: 0, lp: 3000 });
}

/** The big gated snare: a crack and a body, a lot of room, cut off hard. */
function snare(v: Voice[], t: number, g = 0.5): void {
  v.push({ wave: 'noise', freq: SR, at: t, hold: 0.16, gain: g, a: 0.001, d: 0.05, s: 0.55, r: 0.012, bp: 2200, q: 0.6, verb: 0.9 });
  v.push({ wave: 'sine', at: t, freq: 200, to: 170, slide: 0.05, hold: 0.04, gain: g * 0.7, d: 0.08, s: 0, verb: 0.5 });
}

function hat(v: Voice[], t: number, open = false): void {
  v.push({ wave: 'noise', freq: SR, at: t, hold: open ? 0.12 : 0.01, gain: open ? 0.07 : 0.05, d: open ? 0.12 : 0.03, s: 0, hp: 7000 });
}

function tom(v: Voice[], t: number, f: number): void {
  v.push({ wave: 'sine', at: t, freq: f * 1.5, to: f, slide: 0.08, hold: 0.05, gain: 0.55, d: 0.3, s: 0, verb: 0.6 });
}

/** The pumping bass: a saw through a closing filter, every eighth. */
function bass(v: Voice[], t: number, hold: number, n: string): void {
  v.push({ wave: 'saw', unison: [2, 8, 0], at: t, freq: hz(n), hold, gain: 0.32, a: 0.002, r: 0.03, lp: 2200, lpTo: 300, lpTime: 0.12, q: 2.5, drive: 0.6 });
}

/** Brass: a wide saw section that blares open and closes. */
function brass(v: Voice[], t: number, len: number, notes: readonly string[], g = 0.09): void {
  for (const n of notes) v.push({ wave: 'saw', unison: [3, 16, 0], at: t, freq: hz(n), hold: len, gain: g, a: 0.012, d: 0.2, s: 0.7, r: 0.08, lp: 700, lpTo: 4200, lpTime: 0.05, q: 1.5, verb: 0.35 });
}

/** The sequencer: one chord tone a sixteenth, up and down two octaves, quiet and bright, into the echo. */
function sequencer(v: Voice[], t: number, step: number, f: number): void {
  v.push({ wave: 'pulse', duty: 0.3, at: t, freq: f, hold: step * 0.7, gain: 0.04, d: 0.1, s: 0.3, r: 0.03, lp: 3500, delay: 0.35 });
}
const SEQUENCE = [0, 1, 2, 3, 4, 5, 4, 3, 2, 1, 2, 3, 4, 5, 4, 3];

/** The lead: two saws a little apart with a square an octave under, gliding into a leap, vibrato after a moment. */
function lead(v: Voice[], t: number, len: number, n: string, from?: string): void {
  const f = hz(n);
  const bend = from ? ([[0, 12 * Math.log2(hz(from) / f)], [0.06, 0]] as Array<[number, number]>) : undefined;
  v.push({ wave: 'saw', unison: [2, 10, 0], at: t, freq: f, hold: len, gain: 0.13, a: 0.01, d: 0.3, s: 0.8, r: 0.12, lp: 5200, vib: [5.8, 0.22, 0.25, 0.3], bend, verb: 0.4, delay: 0.3 });
  v.push({ wave: 'square', at: t, freq: f / 2, hold: len, gain: 0.04, a: 0.01, r: 0.1, lp: 2500, bend });
}

/** The pulse tune: a bright quarter pulse into the echo, a quick vibrato on its held notes. */
function bop(v: Voice[], t: number, len: number, n: string, step: number): void {
  const long = len > step * 2.5;
  v.push({ wave: 'pulse', duty: 0.25, at: t, freq: hz(n), hold: len, gain: 0.1, a: 0.002, d: 0.12, s: 0.75, r: 0.04, lp: 6000,
    vib: long ? [7, 0.2, 0.08, 0.08] : undefined, delay: 0.55, verb: 0.2 });
}

/**
 * Renders the street-fight loop: `step` is a sixteenth in seconds; `has` says which layers to render (tools and tests
 * measure them alone), and `dry` leaves the room and the echo out. Its tails fold onto its start so it loops with no
 * seam.
 */
export function arrangeKumite(step: number, has: (layer: Layer) => boolean, dry = false): Mix {
  const v: Voice[] = [];
  const at = (bar: number, s: number) => ((bar - 1) * 16 + s) * step;
  for (let bar = 1; bar <= KUMITE_BARS; bar++) {
    const chord = chordOfBar(bar);
    const triad = KUMITE_TRIADS[chord];
    if (has('bass')) {
      const root = KUMITE_ROOTS[chord];
      const up = `${root.slice(0, -1)}${Number(root.slice(-1)) + 1}`;
      KUMITE_BASS_UP.forEach((u, i) => bass(v, at(bar, i * 2), step * 1.6, u ? up : root));
    }
    if (has('drums')) {
      const fill = KUMITE_FILLS.includes(bar);
      for (const s of KUMITE_KICKS) kick(v, at(bar, s));
      snare(v, at(bar, 4));
      if (fill) {
        [hz('A2'), hz('F2'), hz('D2'), hz('A1')].forEach((f, i) => tom(v, at(bar, 8 + i * 2), f));
        for (const s of [12, 13, 14, 15]) snare(v, at(bar, s), 0.22 + (s - 12) * 0.08);
      } else snare(v, at(bar, 12));
      for (let s = 0; s < 16; s += 2) if (!(fill && s >= 8)) hat(v, at(bar, s), s === 14);
    }
    if (has('harmony')) {
      // Stabs on the dotted figure through the intro; then one long chord a bar under the tunes, softer under the pulse.
      if (bar <= KUMITE_INTRO_BARS) for (const s of KUMITE_STABS) brass(v, at(bar, s), step * 1.8, triad);
      else brass(v, at(bar, 0), step * 7, triad, bar <= 12 ? 0.05 : 0.04);
      const tones = [...triad.map((n) => hz(n)), ...triad.map((n) => hz(n) * 2)];
      SEQUENCE.forEach((k, s) => sequencer(v, at(bar, s), step, tones[k]!));
    }
  }
  if (has('lead')) {
    for (const [bar, s, len, n] of KUMITE_BOP) bop(v, at(bar, s), len * step * 0.9, n, step);
    let prev: string | undefined;
    for (const [bar, s, len, n] of KUMITE_LEAD) {
      lead(v, at(bar, s), len * step * 0.95, n, prev && Math.abs(hz(n) / hz(prev) - 1) > 0.3 ? prev : undefined);
      prev = n;
    }
  }
  const seconds = KUMITE_BARS * 16 * step;
  const mix = new Mix(seconds + 4);
  for (const x of v) play(mix, x);
  const fx = kumiteFx(step);
  finish(mix, dry ? { ...fx, reverb: undefined, delay: undefined } : fx);
  return fold(mix, seconds);
}
