import { Mix, SR, finish, fold, play, scale, type Fx, type Voice } from './dsp.ts';
import { notesOf } from './bridge.ts';
import { BERLIN_PARTS } from './berlin_score.ts';
import { BERLIN_VOICES } from './berlin_instruments.ts';
import { rockGuitar, rockHits, rockHits2 } from './berlin_rock.ts';
import { CONSOLE_TEMPOS } from '../music_tempos.ts';

export const BERLIN_SECONDS = 48;
export const BERLIN_BPM = CONSOLE_TEMPOS.berlin!;
export const BERLIN_LEVEL = -27.32125034145651;
const FX: Fx = { reverb: { room: 0.5, damp: 0.45, wet: 0.45 }, mono: true, lp: 12000 };
/**
 * Measured from the complete approved arrangement. Openings use these same gains without re-normalizing. `whole` was
 * 0.29119329692974966 until the owner's heavier power chords (2026-10-18) made the loop 0.06 LU louder; it is set so the
 * loop stays at BERLIN_LEVEL, every part 0.06 dB down and the chords' balance as the owner heard it on the slider page.
 */
const GAINS = { rock: 0.0439734730386836, rock2: 0.0460833572731117, guitarSequencer: 0.39898823479366446, whole: 0.28911824661486957 };
const OWNER_DB: Record<string, number> = { Kick: 3, Hat: 2, Bass: -4, 'Far guitar': 4, Sequencer: 6, 'Rock guitar': 6, 'Rock guitar 2': 6 };
export const BERLIN_STEMS = [...BERLIN_PARTS.map(p => p.name), 'Rock guitar', 'Rock guitar 2'];

/** One approved part, useful for checking a synth change without hiding a difference in the complete band. */
export function berlinStem(name: string, until?: number): Mix {
  if (until !== undefined && (!(until > 0) || until > BERLIN_SECONDS)) throw new Error('Invalid Berlin opening length');
  const seconds = until ?? BERLIN_SECONDS, step = 60 / BERLIN_BPM / 4;
  let stem: Mix;
  if (name === 'Rock guitar' || name === 'Rock guitar 2') {
    const second = name === 'Rock guitar 2';
    const m = rockGuitar(step, seconds, second ? 1900 : 900, second ? rockHits2() : rockHits(), until !== undefined);
    finish(m, FX);
    stem = until === undefined ? fold(m, seconds) : m;
    scale(stem, second ? GAINS.rock2 : GAINS.rock);
    if (second) for (let i = 0; i < stem.length; i++) {
      const t = i / SR, db = t < 28 ? 0 : t < 32 ? 7 * (t - 28) / 4 : 7, g = 10 ** (db / 20);
      stem.l[i]! *= g; stem.r[i]! *= g;
    }
  } else {
    const part = BERLIN_PARTS.findIndex(p => p.name === name), p = BERLIN_PARTS[part], instrument = BERLIN_VOICES[name];
    if (!p || !instrument) throw new Error(`No Berlin instrument ${name}`);
    const voices: Voice[] = [];
    let seed = 1;
    for (const n of notesOf(p, 24)) {
      if (n.s * step < seconds) instrument(voices, n.s * step, n.len * step, n.f, p.level, n.art, { step, part, seed });
      seed++;
    }
    const end = until === undefined ? Math.max(seconds, ...voices.map(v => v.at + v.hold + (v.r ?? 0.01))) + 4 : seconds;
    const m = new Mix(end);
    for (const v of voices) play(m, v);
    finish(m, FX);
    stem = until === undefined ? fold(m, seconds) : m;
    if (name === 'Guitar, sequencer part') scale(stem, GAINS.guitarSequencer);
  }
  // Keep the approved per-stage float32 rounding and summation order, as well as its notes and instruments.
  scale(stem, 10 ** ((OWNER_DB[name] ?? 0) / 20));
  if (name === 'Sequencer' || name === 'Guitar, sequencer part') {
    const down = 10 ** (-3 / 20), ramp = 0.1;
    for (let i = 0; i < stem.length; i++) {
      const t = i / SR;
      const k = t < 16 - ramp || t > 32 + ramp ? 0 : t < 16 ? (t - (16 - ramp)) / ramp : t <= 32 ? 1 : 1 - (t - 32) / ramp;
      const g = 1 + (down - 1) * Math.max(0, Math.min(1, k));
      stem.l[i]! *= g; stem.r[i]! *= g;
    }
  }
  return scale(stem, GAINS.whole);
}

/** The approved mono loop at Beijing's level, or a causal opening piece with the same gain and sample positions. */
export function berlinForGame(until?: number): Mix {
  const out = new Mix(until ?? BERLIN_SECONDS);
  for (const name of BERLIN_STEMS) {
    const stem = berlinStem(name, until);
    for (let i = 0; i < out.length; i++) {
      out.l[i]! += stem.l[i]!;
      out.r[i]! += stem.r[i]!;
    }
  }
  return out;
}
