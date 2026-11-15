import { Mix, SR, finish, fold, hz, play, type Voice } from './dsp.ts';
import { kumiteFx } from './kumite.ts';
import type { Song } from './score.ts';

/**
 * The boss music's arrangement for the tank (2026-10-18): its own tune, bass line and chords in E minor at 176 bpm,
 * on the street fights' band (kumite.ts), heavier, as the owner picked it from three ideas ("A: The street fights' band,
 * heavier"). The tune is 3.5 bars long over a 2-bar bass line, so it lands differently on the chords each time round;
 * each of its four passes over the 14-bar loop changes something: the tune on the gliding lead with brass hits on each
 * chord; the sequencer joins; the tune an octave up with a crash and a heavier kick; half time with the tune on the
 * brass, then a tom fill back to the top. The Console version it replaced is kept in archive/boss_console/.
 */

type Layer = 'lead' | 'bass' | 'harmony' | 'drums';

/** Steps in one pass of the tune. */
const PASS = 56;
/** Each half bar's chord root, from the bass line: E minor, C, A minor, B. */
const ROOTS = ['E', 'C', 'A', 'B'];
/** A half bar's power chord (root, fifth, octave) from the octave `oct`. */
function power(s: number, oct: number): number[] {
  const f = hz(`${ROOTS[Math.floor((s % 32) / 8)]!}${oct}`);
  return [f, f * 1.5, f * 2];
}
const passOf = (s: number) => Math.floor(s / PASS);
/** The breakdown: the tune's fourth pass up to the last bar's fill. */
const breakdown = (s: number) => s >= 168 && s < 208;

function kick(v: Voice[], t: number, g: number): void {
  v.push({ wave: 'sine', at: t, freq: 150, to: 48, slide: 0.09, hold: 0.02, gain: g, d: 0.32, s: 0, r: 0.05 });
  v.push({ wave: 'noise', freq: SR, at: t, hold: 0.005, gain: g * 0.25, d: 0.008, s: 0, lp: 3000 });
}

/** The big gated snare: a crack and a body, a lot of room, cut off hard. */
function snare(v: Voice[], t: number, g: number): void {
  v.push({ wave: 'noise', freq: SR, at: t, hold: 0.16, gain: g, a: 0.001, d: 0.05, s: 0.55, r: 0.012, bp: 2200, q: 0.6, verb: 0.9 });
  v.push({ wave: 'sine', at: t, freq: 200, to: 170, slide: 0.05, hold: 0.04, gain: g * 0.7, d: 0.08, s: 0, verb: 0.5 });
}

function hat(v: Voice[], t: number, open: boolean, g: number): void {
  v.push({ wave: 'noise', freq: SR, at: t, hold: open ? 0.12 : 0.01, gain: (open ? 0.07 : 0.05) * g, d: open ? 0.12 : 0.03, s: 0, hp: 7000 });
}

function tom(v: Voice[], t: number, f: number, g: number): void {
  v.push({ wave: 'sine', at: t, freq: f * 1.5, to: f, slide: 0.08, hold: 0.05, gain: g, d: 0.3, s: 0, verb: 0.6 });
}

function crash(v: Voice[], t: number, g: number): void {
  v.push({ wave: 'noise', freq: SR, at: t, hold: 0.02, gain: g, a: 0.001, d: 1.4, s: 0, r: 0.2, hp: 4200, verb: 0.5 });
  v.push({ wave: 'noise', freq: SR, at: t, hold: 0.01, gain: g * 0.6, d: 0.35, s: 0, bp: 3000, q: 0.7, verb: 0.5 });
}

/** The pumping bass: a saw through a closing filter. */
function bass(v: Voice[], t: number, hold: number, f: number, g: number): void {
  v.push({ wave: 'saw', unison: [2, 8, 0], at: t, freq: f, hold, gain: g, a: 0.002, r: 0.03, lp: 2200, lpTo: 300, lpTime: 0.1, q: 2.5, drive: 0.6 });
}

/** Brass: a wide saw section that blares open and closes. */
function brass(v: Voice[], t: number, len: number, fs: readonly number[], g: number): void {
  for (const f of fs) v.push({ wave: 'saw', unison: [3, 16, 0], at: t, freq: f, hold: len, gain: g, a: 0.01, d: 0.18, s: 0.65, r: 0.08, lp: 700, lpTo: 4200, lpTime: 0.05, q: 1.5, verb: 0.35 });
}

/** The sequencer: a saw through a closing filter, one chord tone a sixteenth, into the echo. */
function sequencer(v: Voice[], t: number, step: number, f: number): void {
  v.push({ wave: 'saw', at: t, freq: f, hold: step * 0.6, gain: 0.25, d: 0.1, s: 0.45, r: 0.03, lp: 4500, lpTo: 1600, lpTime: 0.1, delay: 0.35 });
}
const SEQUENCE = [0, 1, 2, 4, 5, 4, 2, 1];

/** The lead: two saws a little apart with a square an octave under, gliding into a leap, vibrato after a moment. */
function lead(v: Voice[], t: number, len: number, f: number, from: number | undefined): void {
  const bend = from ? ([[0, 12 * Math.log2(from / f)], [0.05, 0]] as Array<[number, number]>) : undefined;
  v.push({ wave: 'saw', unison: [2, 10, 0], at: t, freq: f, hold: len, gain: 0.19, a: 0.008, d: 0.25, s: 0.8, r: 0.1, lp: 5200, vib: [5.8, 0.2, 0.25, 0.3], bend, verb: 0.4, delay: 0.25 });
  v.push({ wave: 'square', at: t, freq: f / 2, hold: len, gain: 0.19 * 0.3, a: 0.008, r: 0.08, lp: 2500, bend });
}

/**
 * Renders the boss loop from its song (the draft's rows, score.ts): `has` says which layers to render (tools and tests
 * measure them alone), and `dry` leaves the room and the echo out. Its tails fold onto its start so it loops with no seam.
 */
export function arrangeBoss(g: Song, has: (layer: Layer) => boolean, dry = false): Mix {
  const step = g.step;
  const total = g.total;
  if (total !== PASS * 4) throw new Error(`The boss arrangement expects four passes of its tune, not ${total} steps`);
  const at = (s: number) => s * step;
  // One pass of the tune, each note with the steps to the next (the last runs on to the next pass); the bass's two bars.
  const pass = g.lead.filter((n) => n.s < PASS);
  const tune = pass.map((n, i) => ({ s: n.s, f: n.f, gap: (pass[i + 1]?.s ?? PASS) - n.s }));
  const line = g.bass.filter((n) => n.s < 32).map((n) => n.f);
  const v: Voice[] = [];
  if (has('drums')) {
    const gain = 0.75;
    for (let bar = 0; bar < total / 16; bar++) {
      // Fills into the third pass and back to the top.
      const fill = bar === 6 || bar === 13;
      for (let i = 0; i < 16; i++) {
        const s = bar * 16 + i;
        const t = at(s);
        if (fill && i >= 8) {
          if (i % 2 === 0) tom(v, t, hz(['A2', 'F2', 'D2', 'A1'][(i - 8) / 2]!), 0.55 * gain);
          if (i >= 12) snare(v, t, (0.22 + (i - 12) * 0.08) * gain);
          continue;
        }
        if (breakdown(s)) {
          if (i === 0 || i === 10) kick(v, t, 0.8 * gain);
          if (i === 8) snare(v, t, 0.5 * gain);
          if (i % 2 === 0) hat(v, t, false, 0.8 * gain);
          continue;
        }
        const drive = passOf(s) === 2;
        if (i === 0 || i === 6 || i === 8 || (drive && (i === 10 || i === 14))) kick(v, t, 0.9 * gain);
        if (i === 4 || i === 12) snare(v, t, 0.5 * gain);
        if (i % 2 === 0) hat(v, t, i === 14, gain);
      }
    }
    for (const s of [0, 112, 208]) crash(v, at(s), 0.16 * gain);
  }
  if (has('bass')) {
    // The boss's bass line in sixteenths, the octave notes a little louder; eighths in the breakdown.
    for (let s = 0; s < total; s++) {
      const bd = breakdown(s);
      if (bd && s % 2) continue;
      bass(v, at(s), step * (bd ? 1.6 : 0.8), line[s % 32]!, s % 4 === 2 ? 0.27 : 0.24);
    }
  }
  if (has('harmony')) {
    for (let s = 0; s < total; s += 8) {
      const p = passOf(s);
      if (breakdown(s)) {
        brass(v, at(s), step * 7, power(s, 3), 0.05);
        continue;
      }
      // Brass hits on each chord, a second one from pass 2, with the sequencer.
      brass(v, at(s), step * 1.5, power(s, 3), 0.13);
      if (p !== 0) brass(v, at(s + 3), step * 1.2, power(s, 3), 0.09);
      if (p >= 1) {
        const tones = [...power(s, 4), ...power(s, 5)];
        SEQUENCE.forEach((k, i) => sequencer(v, at(s + i), step, tones[k]!));
      }
    }
  }
  if (has('lead')) {
    let prev: number | undefined;
    for (let p = 0; p < 4; p++) {
      for (const n of tune) {
        const s = p * PASS + n.s;
        const len = step * (n.gap >= 4 ? n.gap - 0.5 : n.gap * 0.9);
        // The breakdown's tune is on the brass; the third pass an octave up.
        if (p === 3) {
          brass(v, at(s), len, [n.f], 0.22);
          prev = undefined;
          continue;
        }
        const f = p === 2 ? n.f * 2 : n.f;
        lead(v, at(s), len, f, prev && Math.abs(f / prev - 1) > 0.3 ? prev : undefined);
        prev = f;
      }
    }
  }
  const seconds = total * step;
  const mix = new Mix(seconds + 4);
  for (const x of v) play(mix, x);
  const fx = kumiteFx(step);
  finish(mix, dry ? { ...fx, reverb: undefined, delay: undefined } : fx);
  return fold(mix, seconds);
}
