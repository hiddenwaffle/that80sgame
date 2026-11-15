import { DIVE_S, diveNotches } from '../diveTiming.ts';
import { STING_BEAT, STING_HOLD, VANISH_S } from '../ronnienomicsTiming.ts';
import { CUT_FROM, CUT_LAST, CUT_STEP, CUTS, NINJA_BEAT } from '../ninjaTiming.ts';
import { TRACKS, lengthAt } from '../music.ts';
import { REVIVAL_VOICES } from '../revival.ts';
import { GIFT_NOTES } from '../gift.ts';
import { Mix, finish, fold, play, rng, type Voice, type Wave } from './dsp.ts';

/**
 * The draft's sound, as `audio.ts` plays it, rebuilt on the synthesizer: the baseline every sketch is compared with
 * and matched in loudness to. Levels are the game's at default settings (effects 0.8 × 0.5, music 0.6 × 0.35).
 */

export const DRAFT_SFX_GAIN = 0.8 * 0.5;
export const DRAFT_MUSIC_GAIN = 0.6 * 0.35;

// Web Audio scales its band-limited square and sawtooth so the wave's peak, with its ripple, is 1.
const OSC: Record<string, [Wave, number]> = { square: ['square', 0.85], sawtooth: ['saw', 0.85], triangle: ['tri', 1], sine: ['sine', 1] };

/** A Web Audio oscillator note: an exponential ramp from `vol` to 0.001 over `dur`, as `AudioSystem.tone` does. */
function tone(voices: Voice[], type: string, from: number, to: number, at: number, dur: number, vol: number, gain: number): void {
  const [wave, level] = OSC[type]!;
  voices.push({
    wave,
    at,
    freq: from,
    ...(to !== from ? { to: Math.max(1, to), slide: dur } : {}),
    a: 0.0001,
    d: (dur * 4.6) / Math.log(vol / 0.001),
    s: 0,
    hold: dur,
    r: 0.02,
    gain: vol * level * gain,
  });
}

/** Noise through a low-pass (Web Audio's Q of 1 is in decibels for a low-pass), as `AudioSystem.hiss` does. */
function hiss(voices: Voice[], at: number, dur: number, vol: number, cutoff: number, gain: number, seed: number): void {
  voices.push({ wave: 'noise', at, freq: 44100, lp: cutoff, q: 10 ** (1 / 20), a: 0.0001, d: (dur * 4.6) / Math.log(vol / 0.001), s: 0, hold: dur, r: 0.02, gain: vol * gain, seed });
}

/** Each effect's notes, as in `AudioSystem.play`. */
function sfxVoices(name: string, g: number): Voice[] {
  const v: Voice[] = [];
  const t = 0.005;
  const tn = (type: string, from: number, to: number, at: number, dur: number, vol = 0.3) => tone(v, type, from, to, at, dur, vol, g);
  const hs = (at: number, dur: number, vol = 0.3, cutoff = 4000) => hiss(v, at, dur, vol, cutoff, g, 31 + v.length);
  switch (name) {
    case 'blip':
      tn('square', 880, 880, t, 0.04, 0.12);
      break;
    case 'confirm':
      tn('square', 660, 990, t, 0.08, 0.15);
      break;
    case 'cancel':
      tn('square', 440, 300, t, 0.08, 0.15);
      break;
    case 'turn':
      tn('triangle', 784, 784, t, 0.07, 0.11);
      tn('triangle', 1175, 1175, t + 0.03, 0.09, 0.09);
      break;
    case 'waka':
      tn('triangle', 520, 260, t, 0.07, 0.25);
      tn('triangle', 260, 520, t + 0.075, 0.07, 0.25);
      break;
    case 'pickup':
      [523, 659, 784, 1047].forEach((f, i) => tn('square', f, f, t + i * 0.05, 0.08, 0.15));
      break;
    case 'fanfare':
      [523, 659, 784, 1047, 784, 1047].forEach((f, i) => tn('square', f, f, t + i * 0.08, 0.14, 0.16));
      break;
    case 'gift_reveal':
      for (const note of GIFT_NOTES) tn('square', note.freq, note.freq, t + note.at, note.hold, note.gain);
      break;
    case 'battle_start':
      tn('sawtooth', 1200, 120, t, 0.35, 0.18);
      hs(t, 0.25, 0.2, 2500);
      break;
    case 'hit':
      hs(t, 0.12, 0.35, 3000);
      tn('square', 180, 60, t, 0.12, 0.22);
      break;
    case 'miss':
      hs(t, 0.18, 0.18, 1200);
      break;
    case 'hurt':
      tn('square', 300, 90, t, 0.18, 0.2);
      hs(t, 0.1, 0.2, 2000);
      break;
    case 'defeat':
      [784, 659, 523, 392].forEach((f, i) => tn('square', f, f * 0.9, t + i * 0.06, 0.08, 0.14));
      break;
    case 'a_star':
      tn('triangle', 300, 1200, t, 0.14, 0.2);
      hs(t, 0.12, 0.08, 6000);
      break;
    case 'a_star_flare':
      tn('sine', 120, 50, t, 0.4, 0.3);
      hs(t, 0.45, 0.16, 7000);
      [784, 988, 1175, 1568].forEach((f, i) => tn('square', f, f, t + i * 0.03, 0.4, 0.06));
      break;
    case 'cherry':
      [1319, 1568, 2093, 1568, 2093, 2637].forEach((f, i) => tn('sine', f, f, t + i * 0.07, 0.2, 0.14));
      break;
    case 'heal':
      tn('sine', 440, 880, t, 0.25, 0.18);
      break;
    case 'revival':
      v.push(...REVIVAL_VOICES.map(voice => ({ ...voice, at: t + voice.at, gain: voice.gain * g })));
      break;
    case 'save':
      [659, 784, 1047].forEach((f, i) => tn('triangle', f, f, t + i * 0.09, 0.16, 0.14));
      break;
    case 'rest':
      [392, 523, 659, 784, 659, 784, 1047].forEach((f, i) => tn('triangle', f, f, t + i * 0.12, 0.22, 0.14));
      tn('sine', 523, 1047, t + 0.9, 0.5, 0.16);
      break;
    case 'appear':
      hs(t, 0.18, 0.12, 2500);
      [1047, 1319, 1568].forEach((f, i) => tn('triangle', f, f, t + 0.05 + i * 0.07, 0.16, 0.13));
      break;
    case 'level_up':
      [392, 523, 659, 784, 1047].forEach((f, i) => tn('square', f, f, t + i * 0.07, 0.12, 0.15));
      break;
    case 'win':
      [523, 523, 523, 659, 784].forEach((f, i) => tn('square', f, f, t + [0, 0.1, 0.2, 0.3, 0.45][i]!, 0.14, 0.15));
      break;
    case 'game_over':
      [392, 370, 349, 330, 311, 294, 262].forEach((f, i) => tn('triangle', f, f * 0.97, t + i * 0.18, 0.2, 0.2));
      break;
    case 'charge':
      tn('sawtooth', 80, 400, t, 0.6, 0.12);
      break;
    case 'burst':
      for (let i = 0; i < 5; i++) {
        hs(t + i * 0.07, 0.05, 0.16, 2500);
        tn('square', 140, 60, t + i * 0.07, 0.04, 0.08);
      }
      break;
    case 'ricochet':
      tn('sine', 2400, 900, t, 0.18, 0.05);
      break;
    case 'blast':
      hs(t, 0.9, 0.5, 900);
      tn('square', 90, 30, t, 0.8, 0.3);
      break;
    case 'buy':
      tn('square', 988, 988, t, 0.05, 0.14);
      tn('square', 1319, 1319, t + 0.06, 0.1, 0.14);
      break;
    case 'door':
      hs(t, 0.15, 0.15, 1500);
      break;
    case 'page':
      hs(t, 0.3, 0.12, 5000);
      break;
    case 'dive':
      // About 4 dB under a first try whose landing thump stood well above the falling song (measured, 2026-10-23).
      diveNotches(21).forEach((at, i) => { const f = [196, 262, 330, 392, 523, 659, 784, 1047, 1319, 1568, 2093][Math.min(i, 10)]!; tn('square', f, f, t + at, 0.05, 0.075); });
      hs(t + DIVE_S - 1, 1, 0.075, 6000);
      tn('triangle', 110, 40, t + DIVE_S, 0.2, 0.19);
      break;
    case 'neon_on':
      hs(t + 0.06, 0.02, 0.2, 9000);
      hs(t + 0.2, 0.02, 0.18, 9000);
      tn('square', 120, 120, t + 0.05, 0.4, 0.05);
      break;
    case 'key':
      tn('square', 1319, 1319, t, 0.02, 0.06);
      break;
    case 'dot':
      tn('square', 523, 523, t, 0.02, 0.05);
      tn('triangle', 1047, 1047, t, 0.08, 0.08);
      break;
    case 'code_ok':
      [523, 659, 784].forEach((f, i) => tn('square', f, f, t + i * 0.07, i === 2 ? 0.2 : 0.07, 0.15));
      break;
    case 'achievement':
      [1175, 1568].forEach((f, i) => tn('square', f, f, t + i * 0.085, 0.07, 0.105));
      [1047, 1319, 1568].forEach((f) => tn('square', f, f, t + 0.17, 0.7, 0.072));
      tn('triangle', 131, 131, t + 0.17, 0.5, 0.16);
      break;
    // Ronnienomics! (sfx.ts has the game's): the throw's whistle and fuse, the landing's puff and thump, the getaway's warp
    // out, and the failure's bar as square notes over drum hits. Each sets how loud the game's own plays.
    case 'smoke_throw':
      tn('square', 1300, 900, t, 0.3, 0.1);
      hs(t, 0.3, 0.05, 9000);
      break;
    case 'smoke_poof':
      hs(t, 0.5, 0.59, 2500);
      tn('triangle', 150, 40, t, 0.25, 0.47);
      break;
    case 'smoke_vanish':
      tn('square', 784, 98, t, VANISH_S, 0.07);
      hs(t, VANISH_S, 0.042, 4000);
      break;
    case 'escape_sting': {
      const beat = STING_BEAT;
      for (const [b, f] of [[0, 392], [2 / 3, 392], [1, 330], [5 / 3, 440], [2, 392], [8 / 3, 330]] as const) tn('square', f, f, t + b * beat, b === 8 / 3 ? (STING_HOLD - b) * beat : 0.3 * beat, 0.283);
      for (const b of [0, 2, 2.5]) tn('triangle', 150, 45, t + b * beat, 0.25, 0.567);
      for (const b of [1, 3]) hs(t + b * beat, 0.2, 0.424, 3000);
      break;
    }
    // The ninjas' lesson (sfx.ts has the game's): kicks and snares, the orchestra hits as square chords, a hiss for each cut.
    case 'ninja_beat': {
      const at = (b: number) => t + b * NINJA_BEAT;
      for (const b of [0, 0.75, 2, 2.5, 4, 4.75, 6, 6.5, CUT_LAST]) tn('triangle', 150, 45, at(b), 0.3, 0.65);
      for (const b of [1, 3, 5, 7]) hs(at(b), 0.15, 0.42, 2500);
      for (const [b, len] of [[0, 0.5], [2.5, 0.16], [3, 0.16], [6.5, 0.16], [CUT_LAST, 0.5]] as const) for (const f of [165, 247, 330, 392]) tn('square', f, f, at(b), len, 0.072);
      for (let i = 0; i < CUTS; i++) hs(at(CUT_FROM + i * CUT_STEP) - 0.05, 0.1, 0.24, 5000);
      break;
    }
    default:
      throw new Error(`No draft sound ${name}`);
  }
  return v;
}

/** The effects `AudioSystem.play` knows, in the order the comparison page lists them (kept as data in style_names.ts). */
export { SFX_NAMES } from './style_names.ts';

function render(voices: Voice[], pad = 0.05): Mix {
  const end = Math.max(...voices.map((v) => v.at + v.hold + (v.r ?? 0.01)));
  const mix = new Mix(end + pad);
  for (const v of voices) play(mix, v);
  return finish(mix);
}

export function draftSfx(name: string): Mix {
  return render(sfxVoices(name, DRAFT_SFX_GAIN));
}

/** The typing sound at a speaker's pitch (`AudioSystem.blip`), with its small random detune fixed by `seed`. */
export function draftVoice(pitch: number, seed = 1): Mix {
  const r = rng(seed)();
  const v: Voice[] = [];
  tone(v, 'square', pitch * (0.95 + r * 0.1), pitch, 0.002, 0.035, 0.07, DRAFT_SFX_GAIN);
  return render(v);
}

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);

/** The steps after which every channel of a track lines up again: one whole pass of the loop. */
export function loopSteps(lengths: number[]): number {
  return lengths.reduce((a, b) => (a * b) / gcd(a, b), 1);
}

/** One whole pass of a draft track, its tails folded onto its start so it loops with no seam. */
export function draftTrack(name: string): Mix {
  const track = TRACKS[name];
  if (!track) throw new Error(`No track ${name}`);
  const step = 60 / track.bpm / 4;
  const steps = loopSteps(track.channels.map((c) => c.notes.length));
  const voices: Voice[] = [];
  const g = DRAFT_MUSIC_GAIN;
  for (let s = 0; s < steps; s++) {
    for (const ch of track.channels) {
      const note = ch.notes[s % ch.notes.length];
      if (note === undefined || note === null) continue;
      const at = s * step;
      const dur = step * lengthAt(ch, s % ch.notes.length) * 0.95;
      if (ch.wave === 'noise') hiss(voices, at, Math.min(dur, 0.08), ch.volume, note > 0 ? note : 6000, g, 101 + s);
      else tone(voices, ch.wave, note, note, at, dur, ch.volume, g);
    }
  }
  const end = Math.max(steps * step, ...voices.map((v) => v.at + v.hold + (v.r ?? 0.01)));
  const mix = new Mix(end + 0.05);
  for (const v of voices) play(mix, v);
  return fold(finish(mix), steps * step, track.loopFrom !== undefined);
}
