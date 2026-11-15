import { Mix, SR, finish, hz, play, rng, voiceEnd, type Fx, type Voice } from './dsp.ts';
import { REVIVAL_CUE, revivalLayers } from './revivalCue.ts';
import { GIFT_NOTES } from '../gift.ts';
import { DIVE_S, diveNotches } from '../diveTiming.ts';
import { GAME_OVER_ECHO, GAME_OVER_LAST, GAME_OVER_STEP } from '../gameOverTiming.ts';
import { STING_BEAT, STING_HOLD, STING_STOP, VANISH_S } from '../ronnienomicsTiming.ts';
import { CUT_FROM, CUT_LAST, CUT_STEP, CUTS, NINJA_BEAT } from '../ninjaTiming.ts';

/**
 * The effects in the Console style, the game's sound (2026-10-02; the other sketched styles were retired on 2026-10-13
 * and are kept in archive/sound_styles/): an 8-bit home console's pulse waves, the stepped triangle, the noise channel,
 * a second voice echoing. The musical effects (pickups, jingles, the rest, level up, the fight won, game over) play the
 * draft's own notes, some with a harmony or a bass under them.
 */

const n = (x: string | number): number => (typeof x === 'number' ? x : hz(x));

type Partial2 = Partial<Voice> & Pick<Voice, 'wave' | 'at' | 'freq' | 'hold' | 'gain'>;

/** The voices of one effect, with the style's defaults under each. */
class Kit {
  readonly voices: Voice[] = [];
  private readonly base: Partial<Voice>;
  constructor(base: Partial<Voice> = {}) {
    this.base = base;
  }
  add(v: Partial2): this {
    this.voices.push({ ...this.base, ...v } as Voice);
    return this;
  }
  /**
   * Paper: many tiny grains of filtered noise, each at its own pitch, thickest mid-way, over a soft swish of the
   * sheet sliding; the grains are what make it read as paper rather than a drum.
   */
  crinkle(at: number, dur: number, count: number, gain: number, seed: number, more: Partial<Voice> = {}): this {
    const r = rng(seed);
    for (let i = 0; i < count; i++) {
      const x = r();
      const hold = 0.002 + r() * 0.009;
      this.add({ wave: 'noise', at: at + dur * x, freq: SR, hold, gain: gain * (0.35 + r() * 0.65) * Math.sqrt(Math.sin(Math.PI * x)), a: 0.001, d: hold, s: 0, r: 0.004, bp: 1600 + r() * 5000, q: 1.2 + r() * 3, pan: (r() - 0.5) * 0.7, seed: seed * 100 + i, ...more });
    }
    this.add({ wave: 'noise', at, freq: SR, hold: dur, gain: gain * 0.22, a: dur * 0.35, d: dur * 0.65, s: 0, bp: 2600, bpTo: 1200, q: 0.7, seed: seed * 100 + count, ...more });
    return this;
  }
  /** Notes one after another, `step` apart, each made by `make`. */
  seq(notes: Array<string | number>, at: number, step: number, make: (note: number, at: number, i: number) => void): this {
    notes.forEach((x, i) => make(n(x), at + i * step, i));
    return this;
  }
}

/** How long an effect's tail runs on after its last voice. */
function tail(fx: Fx): number {
  let t = 0.03;
  if (fx.reverb) t = Math.max(t, 0.4 + fx.reverb.room * 2.2);
  if (fx.delay) t = Math.max(t, fx.delay.time * Math.ceil(Math.log(0.01) / Math.log(Math.max(0.05, fx.delay.feedback))));
  return t;
}

/** Renders a kit with its effects, trimming silence off the end. */
function render(k: Kit, fx: Fx): Mix {
  const end = Math.max(...k.voices.map(voiceEnd));
  const mix = new Mix(end + tail(fx));
  for (const v of k.voices) play(mix, v);
  finish(mix, fx);
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

/**
 * Cherries thrown: each of the draft's notes as a short arc in pitch, rising into the note and falling away, as a
 * thrown thing does, then a soft landing; `voice` makes one note in the style's own sound.
 */
function cherries(voice: (at: number, freq: number, hold: number, more: Partial<Voice>) => void, land: (at: number) => void): void {
  // Each starts a fourth below its note and arcs up exactly to it, then falls away.
  D.cherry.forEach((x, i) => voice(i * 0.07, n(x) * 2 ** (-5 / 12), 0.1, { arc: [5, 0.1], pan: i % 2 ? 0.35 : -0.35 }));
  land(0.45);
}

const D = { pickup: ['C5', 'E5', 'G5', 'C6'], fanfare: ['C5', 'E5', 'G5', 'C6', 'G5', 'C6'], defeat: ['G5', 'E5', 'C5', 'G4'], cherry: ['E6', 'G6', 'C7', 'G6', 'C7', 'E7'], rest: ['G4', 'C5', 'E5', 'G5', 'E5', 'G5', 'C6'], appear: ['C6', 'E6', 'G6'], levelUp: ['G4', 'C5', 'E5', 'G5', 'C6'], win: ['C5', 'C5', 'C5', 'E5', 'G5'], winAt: [0, 0.1, 0.2, 0.3, 0.45], gameOver: ['G4', 'F#4', 'F4', 'E4', 'D#4', 'D4', 'C4'] };

// ---------------------------------------------------------------- console

function console8(name: string): Mix {
  const k = new Kit({ tick: 60, vsteps: 15, a: 0.002, r: 0.02 });
  const fx: Fx = { mono: true, lp: 11000 };
  const p = (duty: number, at: number, freq: number, hold: number, gain: number, more: Partial<Voice> = {}) => k.add({ wave: 'pulse', duty, at, freq, hold, gain, ...more });
  const tri = (at: number, freq: number, hold: number, gain: number, more: Partial<Voice> = {}) => k.add({ wave: 'tri4', at, freq, hold, gain, vsteps: 0, r: 0.005, ...more });
  const nz = (at: number, clock: number, hold: number, gain: number, more: Partial<Voice> = {}) => k.add({ wave: 'lfsr', at, freq: clock, hold, gain, d: hold, s: 0, ...more });
  /** A note with a quieter copy echoing it, as a second channel would. */
  const echo = (duty: number, at: number, freq: number, hold: number, gain: number, more: Partial<Voice> = {}, delay = 0.083) => {
    p(duty, at, freq, hold, gain, more);
    p(duty, at + delay, freq, hold, gain * 0.35, more);
  };
  switch (name) {
    case 'blip':
      p(0.5, 0, n('A5'), 0.033, 0.45, { d: 0.03, s: 0.3 });
      break;
    case 'confirm':
      p(0.5, 0, n('E6'), 0.033, 0.45);
      p(0.5, 0.033, n('A6'), 0.1, 0.45, { d: 0.12, s: 0 });
      break;
    case 'cancel':
      p(0.25, 0, n('A5'), 0.033, 0.45);
      p(0.25, 0.033, n('E5'), 0.06, 0.45, { d: 0.07, s: 0 });
      break;
    case 'turn':
      // Someone's turn: two soft triangle notes a fifth apart, rolled, and gone; played a step higher for each member.
      tri(0, n('G5'), 0.03, 0.34, { d: 0.11, s: 0, r: 0.03 });
      tri(0.03, n('D6'), 0.03, 0.26, { d: 0.14, s: 0, r: 0.04 });
      break;
    case 'page':
      nz(0, 200000, 0.08, 0.35, { to: 40000, a: 0.02, trem: [28, 0.6] });
      nz(0.07, 100000, 0.14, 0.3, { to: 15000, trem: [33, 0.6] });
      break;
    case 'door':
      // Going through: a latch on the noise channel, then a whoosh rising past.
      k.add({ wave: 'lfsr93', at: 0, freq: 90000, hold: 0.025, gain: 0.35, d: 0.025, s: 0 });
      tri(0, 120, 0.03, 0.7, { to: 60 });
      nz(0.03, 15000, 0.2, 0.4, { to: 250000, a: 0.08, d: 0.2, s: 0 });
      break;
    case 'buy':
      p(0.125, 0, n('B5'), 0.05, 0.45);
      echo(0.125, 0.05, n('E6'), 0.2, 0.45, { d: 0.25, s: 0 });
      k.add({ wave: 'lfsr93', at: 0.05, freq: 60000, hold: 0.05, gain: 0.25, d: 0.05, s: 0 });
      break;
    case 'waka':
      p(0.5, 0, 600, 0.06, 0.45, { to: 280, a: 0.008, r: 0.015 });
      p(0.5, 0.075, 280, 0.06, 0.45, { to: 600, a: 0.008, r: 0.015 });
      break;
    case 'pickup':
      k.seq(D.pickup.map((x) => n(x) * 2), 0, 0.033, (f, at) => echo(0.25, at, f, 0.05, 0.45, { d: 0.1, s: 0.3 }, 0.05));
      break;
    case 'fanfare':
      k.seq(D.fanfare, 0, 0.083, (f, at, i) => {
        const hold = i === 5 ? 0.3 : 0.07;
        p(0.25, at, f, hold, 0.4, { d: 0.25, s: 0.6, vib: [7, 0.2, 0.12] });
        p(0.5, at, f * 2 ** (-4 / 12), hold, 0.22, { d: 0.25, s: 0.5 });
      });
      tri(0, n('C4'), 0.16, 0.6);
      tri(0.25, n('G3'), 0.16, 0.6);
      tri(0.41, n('C4'), 0.3, 0.6);
      nz(0, 300000, 0.03, 0.2);
      nz(0.41, 300000, 0.05, 0.25);
      break;
    case 'appear':
      nz(0, 120000, 0.1, 0.2, { to: 300000 });
      p(0.25, 0.03, 600, 0.2, 0.4, { arp: [[0, 7, 12], 30], to: 1200, d: 0.25, s: 0.3 });
      k.seq(D.appear, 0.2, 0.05, (f, at) => echo(0.5, at, f, 0.04, 0.3, { d: 0.06, s: 0 }, 0.05));
      break;
    case 'save':
      k.seq(D.rest.slice(-3), 0, 0.09, (f, at) => echo(0.25, at, f, 0.07, 0.4, { d: 0.12, s: 0.4 }, 0.045));
      tri(0, n('C4'), 0.28, 0.4);
      break;
    case 'rest':
      k.seq(D.rest, 0, 0.117, (f, at) => echo(0.25, at, f, 0.07, 0.4, { d: 0.15, s: 0.4, vib: [6, 0.15, 0.06] }, 0.117 / 2));
      k.seq(['C3', 'G3', 'C4', 'E3'], 0, 0.234, (f, at) => tri(at, f, 0.2, 0.55));
      p(0.125, 0.9, n('C6'), 0.5, 0.3, { arp: [[0, 4, 7, 12], 30], d: 0.6, s: 0.3 });
      tri(0.9, n('C4'), 0.4, 0.5);
      break;
    case 'heal':
      p(0.5, 0, n('C5'), 0.3, 0.35, { arp: [[0, 4, 7, 12, 16, 19, 24], 45], d: 0.35, s: 0.3 });
      p(0.5, 0.05, n('C5'), 0.3, 0.15, { arp: [[0, 4, 7, 12, 16, 19, 24], 45], d: 0.35, s: 0.3 });
      break;
    case 'battle_start':
      p(0.125, 0, 1600, 0.35, 0.4, { arp: [[0, -5, -12], 30], to: 200, d: 0.4, s: 0.4 });
      nz(0, 20000, 0.35, 0.2, { to: 200000 });
      tri(0.33, 180, 0.1, 0.7, { to: 60 });
      break;
    case 'hit':
      nz(0, 250000, 0.07, 0.5, { to: 50000 });
      tri(0, 220, 0.12, 1, { to: 45 });
      break;
    case 'miss':
      nz(0, 300000, 0.15, 0.35, { to: 8000, a: 0.03 });
      break;
    case 'hurt':
      p(0.125, 0, 420, 0.18, 0.45, { to: 100, d: 0.2, s: 0.3, a: 0.005 });
      k.add({ wave: 'lfsr93', at: 0, freq: 40000, hold: 0.1, gain: 0.35, d: 0.1, s: 0, a: 0.004 });
      break;
    case 'defeat':
      nz(0, 60000, 0.3, 0.45, { to: 5000 });
      k.seq(D.defeat, 0.02, 0.05, (f, at) => p(0.25, at, f, 0.05, 0.3, { to: f * 0.9, d: 0.08, s: 0 }));
      break;
    case 'a_star':
      p(0.5, 0, 260, 0.1, 0.45, { to: 1000, d: 0.1, s: 0 });
      break;
    case 'a_star_flare':
      nz(0, 150000, 0.5, 0.55, { to: 6000 });
      tri(0, 160, 0.25, 0.8, { to: 40 });
      p(0.25, 0, n('C6'), 0.45, 0.35, { arp: [[0, 4, 7], 60], d: 0.5, s: 0.4 });
      p(0.5, 0, n('C5'), 0.45, 0.25, { arp: [[0, 7, 12], 30], d: 0.5, s: 0.4 });
      break;
    case 'cherry':
      cherries(
        (at, f, hold, more) => p(0.25, at, f, hold, 0.35, { ...more, pan: 0, d: 0.14, s: 0.2 }),
        (at) => {
          tri(at, 260, 0.05, 0.6, { to: 130 });
          nz(at, 60000, 0.03, 0.2);
          // A small chime as the cherries heal.
          echo(0.5, at + 0.08, n('G6'), 0.05, 0.25, { d: 0.1, s: 0 }, 0.05);
          echo(0.5, at + 0.13, n('C7'), 0.12, 0.25, { d: 0.2, s: 0 }, 0.05);
        },
      );
      break;
    case 'charge':
      p(0.5, 0, 100, 0.6, 0.4, { to: 700, duty: 0.5, dutyTo: 0.125, vib: [10, 0.6, 0.2], a: 0.05 });
      nz(0, 5000, 0.6, 0.15, { to: 120000, a: 0.4, d: 0, s: 1 });
      break;
    case 'burst':
      for (let i = 0; i < 5; i++) {
        nz(i * 0.067, 200000, 0.05, 0.55, { to: 40000 });
        tri(i * 0.067, 140, 0.04, 0.55, { to: 55 });
      }
      break;
    case 'ricochet':
      p(0.125, 0, 2500, 0.2, 0.35, { to: 900, vib: [18, 0.5, 0], d: 0.22, s: 0.1 });
      break;
    case 'blast':
      nz(0, 60000, 0.65, 0.7, { to: 1500 });
      tri(0, 120, 0.4, 0.8, { to: 30 });
      k.add({ wave: 'lfsr93', at: 0, freq: 20000, hold: 0.25, gain: 0.3, d: 0.25, s: 0 });
      break;
    case 'level_up':
      k.seq(D.levelUp, 0, 0.067, (f, at, i) => {
        p(0.25, at, f, i === 4 ? 0.3 : 0.06, 0.4, { d: 0.3, s: 0.5, vib: [7, 0.2, 0.1] });
        p(0.125, at + 0.033, f * 2, 0.04, 0.15, { d: 0.06, s: 0 });
      });
      tri(0.27, n('C4'), 0.3, 0.6);
      break;
    case 'win':
      D.win.forEach((x, i) => {
        const at = D.winAt[i]!;
        const last = i === 4;
        p(0.25, at, n(x), last ? 0.35 : 0.08, 0.4, { d: 0.3, s: 0.6, vib: [7, 0.2, 0.12] });
        p(0.5, at, n(x) * 2 ** (-5 / 12), last ? 0.35 : 0.08, 0.2, { d: 0.3, s: 0.5 });
        nz(at, i === 4 ? 150000 : 300000, 0.04, 0.25);
      });
      tri(0, n('C3'), 0.28, 0.6);
      tri(0.3, n('G3'), 0.13, 0.6);
      tri(0.45, n('C4'), 0.35, 0.6);
      break;
    case 'game_over':
      k.seq(D.gameOver, 0, GAME_OVER_STEP, (f, at, i) => echo(0.25, at, f, i === 6 ? GAME_OVER_LAST : 0.16, 0.4, { to: f * 0.97, vib: [5, 0.25, 0.06], d: 0.4, s: 0.5 }, GAME_OVER_ECHO));
      k.seq(['C3', 'B2', 'Bb2', 'A2', 'Ab2', 'G2', 'C2'], 0, GAME_OVER_STEP, (f, at, i) => tri(at, f, i === 6 ? GAME_OVER_LAST : 0.16, 0.5));
      break;
    case 'dive': {
      // New Game's dive: one note each time the zoom passes a notch (diveTiming.ts), a rising arpeggio in the title's
      // C major, slow at first and very fast at the end (the top two notes trade once it runs out of room); a soft noise
      // rush through the last second; a low thump as the house lands. Nothing marks the lights and the trio going.
      const tones = ['G3', 'C4', 'E4', 'G4', 'C5', 'E5', 'G5', 'C6', 'E6', 'G6', 'C7'];
      const times = diveNotches(21);
      times.forEach((at, i) => {
        const f = n(i < tones.length ? tones[i]! : tones[tones.length - 1 - ((i - tones.length + 1) % 2)]!);
        p(0.25, at, f, 0.045, 0.3 + (0.12 * i) / times.length, { d: 0.05, s: 0.3 });
        p(0.25, at + 0.04, f, 0.03, 0.1, { d: 0.04, s: 0 });
      });
      nz(DIVE_S - 1, 20000, 1, 0.3, { to: 250000, a: 0.95, d: 0.05, s: 0 });
      tri(DIVE_S, 110, 0.2, 0.5, { to: 40 });
      nz(DIVE_S, 6000, 0.12, 0.19);
      break;
    }
    case 'neon_on':
      // The title's neon switching on: two ticks as the tubes catch, over the hum of the transformer.
      nz(0.06, 300000, 0.012, 0.35);
      nz(0.2, 260000, 0.012, 0.3);
      p(0.5, 0.05, 120, 0.4, 0.14, { a: 0.03, d: 0.35, s: 0, trem: [30, 0.5] });
      tri(0.05, 60, 0.4, 0.35, { a: 0.03, d: 0.35, s: 0 });
      break;
    case 'key':
      // A character typed into the save code: quieter and shorter than the menu's blip.
      p(0.5, 0, n('E6'), 0.02, 0.22, { d: 0.02, s: 0 });
      break;
    case 'dot':
      // A dot set down on the title's map (the easter egg): a short tick with a bell an octave above, played a step
      // higher up the title's C major pentatonic for each dot in a run (titleMap.ts).
      p(0.125, 0, n('C5'), 0.025, 0.14, { d: 0.025, s: 0 });
      tri(0, n('C6'), 0.2, 0.2, { d: 0.2, s: 0 });
      break;
    case 'code_ok':
      // A save code accepted: C, E and G rising in the title's key, before the title wipes away.
      k.seq(['C5', 'E5', 'G5'], 0, 0.07, (f, at, i) => echo(0.25, at, f, i === 2 ? 0.2 : 0.06, 0.4, { d: i === 2 ? 0.25 : 0.08, s: 0.4 }, 0.05));
      tri(0.14, n('C3'), 0.2, 0.5);
      break;
    case 'achievement':
      // An achievement earned: two quick notes rising a fourth, then the C major chord they lead to, ringing and dying away in
      // the chip's volume steps, with a thin run sparkling up over it and a low C under it. Longer and brighter than a pickup.
      p(0.125, 0, n('D6'), 0.07, 0.3, { d: 0.07, s: 0.5 });
      p(0.125, 0.085, n('G6'), 0.07, 0.34, { d: 0.07, s: 0.5 });
      tri(0, n('G3'), 0.13, 0.32);
      p(0.25, 0.17, n('C6'), 1.0, 0.3, { d: 0.5, s: 0.22, r: 0.2, vib: [6, 0.1, 0.25] });
      p(0.25, 0.17, n('E6'), 1.0, 0.24, { d: 0.5, s: 0.22, r: 0.2, vib: [6, 0.1, 0.25] });
      p(0.5, 0.17, n('G6'), 1.0, 0.18, { d: 0.5, s: 0.22, r: 0.2 });
      tri(0.17, n('C3'), 0.55, 0.38, { d: 0.55, s: 0 });
      k.seq(['G6', 'C7', 'E7', 'G7', 'C8'], 0.24, 0.06, (f, at, i) => echo(0.5, at, f, 0.05, 0.13 - i * 0.012, { d: 0.05, s: 0.2 }, 0.1));
      nz(0.17, 300000, 0.4, 0.06);
      break;
    default:
      throw new Error(`No console sound ${name}`);
  }
  return render(k, fx);
}

/** Revival: the choir and the sparkles as the owner set them in the sound lab (revivalCue.ts). */
function revival(): Mix {
  return revivalLayers(REVIVAL_CUE).mix;
}

/**
 * A deliberately dry console flourish for the alley-gift gag. The instrument is Codex's polish of 2026-10-15, a
 * shorter decay to a lower sustain and a softer top end; the melody stays the game's (the owner, 2026-10-16: "The gift
 * jingle instrument is good but can you make the melody the same as the current version?").
 */
function gift(): Mix {
  const k = new Kit({ tick: 60, a: 0.003, d: 0.065, s: 0.48, r: 0.024 });
  for (const v of GIFT_NOTES) k.add({ ...v, wave: 'pulse', duty: 0.5 });
  return render(k, { mono: true, lp: 7800 });
}

// ---------------------------------------------------------------- Ronnienomics!

/**
 * Ronnienomics!'s smoke bomb flung (BattleUi.smokeBomb, its first 0.32 s): a whistle rising and falling with the bomb's
 * arc, landing below where it set off, and its fuse sizzling on it. The console's voices; the smoke's sounds are in stereo.
 */
function smokeThrow(): Mix {
  const k = new Kit({ tick: 60, vsteps: 15, a: 0.004, r: 0.02 });
  k.add({ wave: 'pulse', duty: 0.25, at: 0, freq: n('E6'), hold: 0.3, gain: 0.32, bend: [[0, 0], [0.13, 5], [0.3, -9]], vib: [14, 0.25, 0] });
  const r = rng(71);
  for (let i = 0; i < 26; i++) {
    const hold = 0.002 + r() * 0.005;
    k.add({ wave: 'noise', at: 0.01 + r() * 0.29, freq: SR, hold, gain: 0.25 + r() * 0.3, a: 0.001, d: hold, s: 0, r: 0.003, bp: 4500 + r() * 4500, q: 2, vsteps: 0, seed: 7100 + i });
  }
  return render(k, { lp: 11000 });
}

/**
 * The smoke bomb landing, from the hit: a crack on the flash and a low thump; a breathy puff, not a boom, as the cloud
 * erupts; a roll of small puffs as its billows pop out, left and right; two swooshes whipping round it, one each way;
 * and a few sparks ticking on it.
 */
function smokePoof(): Mix {
  const k = new Kit({ tick: 60, a: 0.003, r: 0.02 });
  k.add({ wave: 'lfsr', at: 0, freq: 300000, hold: 0.025, gain: 0.55, d: 0.025, s: 0 });
  k.add({ wave: 'tri4', at: 0, freq: 150, to: 38, slide: 0.22, hold: 0.24, gain: 0.95, d: 0.24, s: 0, r: 0.01 });
  // Breath through a band sliding down, swelling in a moment and dying away.
  k.add({ wave: 'noise', at: 0.005, freq: SR, hold: 0.55, gain: 0.85, a: 0.012, d: 0.55, s: 0, bp: 2600, bpTo: 380, bpTime: 0.5, q: 0.8, verb: 0.3, seed: 7201 });
  const r = rng(72);
  for (let i = 0; i < 16; i++) {
    const at = 0.02 + (i / 15) ** 1.3 * 0.3 + r() * 0.015;
    k.add({ wave: 'noise', at, freq: SR, hold: 0.05, gain: 0.22 + r() * 0.2, a: 0.004, d: 0.06, s: 0, bp: 650 + r() * 1100, bpTo: 420, bpTime: 0.06, q: 1.4, pan: (r() - 0.5) * 1.4, verb: 0.2, seed: 7300 + i });
  }
  // Up through the band as each sweeps by, the first left to right, the second right to left.
  for (const [j, side] of [[0, -1], [1, 1]] as const) {
    k.add({ wave: 'noise', at: 0.06 + j * 0.1, freq: SR, hold: 0.45, gain: 0.4, a: 0.12, d: 0.4, s: 0, bp: 900, bpTo: 3800, bpTime: 0.22, q: 2.2, pan: side * 0.85, panTo: -side * 0.85, seed: 7400 + j });
  }
  // Soft: the stepped triangle an octave or two under the first sparks' thin pulse ("sqeaky and scratchy", 2026-11-07).
  ['C6', 'G6', 'E6', 'C7', 'G6'].forEach((x, i) => {
    k.add({ wave: 'tri4', at: 0.27 + i * 0.14, freq: n(x), hold: 0.02, gain: 0.16, d: 0.06, s: 0, r: 0.02, pan: (r() - 0.5) * 1.2 });
  });
  return render(k, { lp: 11000, reverb: { room: 0.25, damp: 0.5, wet: 0.5 } });
}

/**
 * The party gone in the smoke (Battle.escape): a quick warp out from the moment they vanish, over before the flashback's
 * blocks start, falling from high to low and faster as it goes, a second voice echoing it, a breath of noise thinning
 * away with it. Soft rather than bright: a hollow square from G5, with no octave flutter, filtered (the owner, 2026-11-07,
 * of the first, a thin pulse fluttering from C7: "a bit sqeaky and scratchy").
 */
function smokeVanish(): Mix {
  const k = new Kit({ tick: 60, vsteps: 15, a: 0.02, r: 0.05 });
  for (const [delay, gain] of [[0, 0.3], [0.083, 0.1]] as const) {
    k.add({ wave: 'pulse', duty: 0.5, at: delay, freq: n('G5'), to: n('G2'), slide: VANISH_S, curve: 1.8, hold: VANISH_S - delay, gain, vib: [6, 0.3, 0.1], lp: 2400, d: VANISH_S, s: 0.35 });
  }
  k.add({ wave: 'noise', at: 0, freq: SR, hold: VANISH_S, gain: 0.12, a: 0.1, d: VANISH_S - 0.1, s: 0, bp: 2500, bpTo: 500, bpTime: VANISH_S, q: 0.7, vsteps: 0, seed: 7501 });
  return render(k, { mono: true, lp: 6000 });
}

/**
 * Ronnienomics! failing (BattleUi.escapeFailed): a bar blasted over the battle music turned down (AudioSystem.playOver),
 * in the instrumentation of Don Henley's "All She Wants to Do Is Dance", as the owner asked: "in a mocking way. Like an
 * inside joke to anyone who gets it but still sounds like it's mocking Ronnienomics's failure" (2026-11-07). A drum
 * machine with a big gated snare and claps, a bouncy synth bass, brassy synth stabs with a bell over them, on a shuffle.
 * The notes are not the record's: the stabs play the children's taunt as "Ring Around the Rosie" opens it ("more like
 * that mocking 'ring around the rosy' musical notes"), its last note held past the bar ("hold that last note a little
 * longer") and then wound down like a tape stopping.
 */
function escapeFailed(): Mix {
  const k = new Kit();
  const at = (b: number) => b * STING_BEAT;
  const kick = (b: number) => {
    k.add({ wave: 'sine', at: at(b), freq: 165, to: 44, slide: 0.11, curve: 0.6, hold: 0.3, gain: 0.95, a: 0.001, d: 0.3, s: 0, r: 0.02, drive: 0.5 });
    k.add({ wave: 'noise', at: at(b), freq: SR, hold: 0.006, gain: 0.35, a: 0.0005, d: 0.006, s: 0, r: 0.002, bp: 3500, q: 0.7, seed: 7601 });
  };
  // Gated: the room's noise held full and then shut off, with the drum's own knock and a clap on it.
  const snare = (b: number, i: number) => {
    k.add({ wave: 'noise', at: at(b), freq: SR, hold: 0.21, gain: 0.55, a: 0.001, d: 0.04, s: 0.55, r: 0.012, bp: 1900, q: 0.55, verb: 0.12, seed: 7610 + i * 10 });
    k.add({ wave: 'tri', at: at(b), freq: 230, to: 170, slide: 0.05, hold: 0.07, gain: 0.55, a: 0.001, d: 0.08, s: 0, r: 0.01 });
    [0, 0.011, 0.023].forEach((off, j) => k.add({ wave: 'noise', at: at(b) + off, freq: SR, hold: 0.007, gain: 0.4, a: 0.0005, d: 0.009, s: 0, r: 0.003, bp: 1250, q: 1.6, pan: (j - 1) * 0.3, seed: 7611 + i * 10 + j }));
  };
  const hat = (b: number, i: number, open = false) =>
    k.add({ wave: 'noise', at: at(b), freq: SR, hold: open ? 0.12 : 0.025, gain: open ? 0.16 : 0.13, a: 0.0005, d: open ? 0.12 : 0.03, s: 0, r: 0.01, hp: 7500, pan: 0.25, seed: 7700 + i });
  const crash = (b: number) =>
    k.add({ wave: 'noise', at: at(b), freq: SR, hold: 0.9, gain: 0.13, a: 0.001, d: 0.9, s: 0, r: 0.05, hp: 4500, verb: 0.3, pan: -0.2, seed: 7750 });
  const bass = (b: number, note: string, beats: number) =>
    k.add({ wave: 'saw', at: at(b), freq: n(note), hold: at(beats) - 0.04, gain: 0.42, a: 0.003, d: 0.18, s: 0.55, r: 0.03, lp: 2200, lpTo: 350, lpTime: 0.15, q: 4, unison: [2, 10, 0], drive: 0.3 });
  // Brass: detuned saws whose filter opens with a bite as each stab lands, spread across.
  const brass = (b: number, note: string, beats: number, gain: number, pan: number) =>
    k.add({ wave: 'saw', at: at(b), freq: n(note), hold: at(beats) - 0.05, gain, a: 0.012, d: 0.12, s: 0.8, r: 0.08, lp: 900, lpTo: 4200, lpTime: 0.05, q: 1.2, unison: [3, 22, 0.6], drive: 0.25, verb: 0.2, pan });
  const bell = (b: number, note: string) =>
    k.add({ wave: 'square', at: at(b), freq: n(note), hold: 0.05, gain: 0.1, a: 0.002, d: 0.2, s: 0.15, r: 0.1, lp: 6000, verb: 0.3, pan: -0.3 });
  // A shuffle: each beat long then short (two thirds and one third), as the taunt goes.
  const third = 2 / 3;
  [0, 2, 2 + third].forEach(kick);
  [1, 3].forEach((b, i) => snare(b, i));
  for (let i = 0; i < 8; i++) hat(Math.floor(i / 2) + (i % 2) * third, i, i === 7);
  kick(4);
  crash(4);
  const bassline: Array<[number, string]> = [[0, 'C2'], [third, 'C3'], [1, 'C2'], [1 + third, 'C3'], [2, 'A1'], [2 + third, 'A2'], [3, 'A1'], [3 + third, 'A2']];
  bassline.forEach(([b, x]) => bass(b, x, b % 1 ? 1 / 3 : third));
  // What is held on sounds through the wind-down too, so it is what slows.
  const end = STING_HOLD + STING_STOP;
  bass(4, 'A1', end - 4);
  // "Ring a-round the ro-sie" in octaves, over C and then A minor: G G E A G E, the last E held on.
  const taunt: Array<[number, string]> = [[0, 'G4'], [third, 'G4'], [1, 'E4'], [1 + third, 'A4'], [2, 'G4'], [2 + third, 'E4']];
  taunt.forEach(([b, x], i) => {
    const beats = i === taunt.length - 1 ? end - b : b % 1 ? 1 / 3 : third;
    brass(b, x, beats, 0.22, 0.2);
    brass(b, x.replace('4', '5'), beats, 0.13, -0.2);
    bell(b, x.replace('4', '6'));
  });
  for (const [b, beats, chord] of [[0, 2, ['C4', 'E4']], [2, end - 2, ['A3', 'C4']]] as const) chord.forEach((x, i) => brass(b, x, beats, 0.1, i ? 0.6 : -0.6));
  return tapeStop(render(k, { reverb: { room: 0.35, damp: 0.4, wet: 0.35 } }), at(STING_HOLD), at(STING_STOP));
}

/**
 * The ninjas' lesson: a bar of a 1990 drum machine's boom-bap under a synth bass, an orchestra hit and a gong on the
 * downbeat and stabs on the off-beats, a koto-like pluck in the Japanese in scale (E F A B C), a record scratched into
 * the second bar, a blade's swish with each of the nine cuts on its eighths, and on the ninth the big hit and the gong
 * again, ringing on.
 */
function ninjaBeat(): Mix {
  const k = new Kit();
  const at = (b: number) => b * NINJA_BEAT;
  // A long, low, boomy kick with a click on it, as a drum machine's.
  const kick = (b: number, big = false) => {
    k.add({ wave: 'sine', at: at(b), freq: big ? 150 : 120, to: 42, slide: 0.16, curve: 0.5, hold: big ? 0.6 : 0.42, gain: big ? 1 : 0.85, a: 0.001, d: big ? 0.6 : 0.42, s: 0, r: 0.03, drive: 0.6 });
    k.add({ wave: 'noise', at: at(b), freq: SR, hold: 0.005, gain: 0.3, a: 0.0005, d: 0.006, s: 0, r: 0.002, bp: 4000, q: 0.8, seed: 8101 });
  };
  const snare = (b: number, i: number) => {
    k.add({ wave: 'noise', at: at(b), freq: SR, hold: 0.16, gain: 0.5, a: 0.001, d: 0.15, s: 0, r: 0.03, bp: 2100, q: 0.6, verb: 0.3, seed: 8110 + i });
    k.add({ wave: 'tri', at: at(b), freq: 210, to: 160, slide: 0.06, hold: 0.07, gain: 0.5, a: 0.001, d: 0.08, s: 0, r: 0.01 });
    [0, 0.012].forEach((off, j) => k.add({ wave: 'noise', at: at(b) + off, freq: SR, hold: 0.008, gain: 0.32, a: 0.0005, d: 0.01, s: 0, r: 0.003, bp: 1300, q: 1.5, pan: j ? 0.25 : -0.25, verb: 0.2, seed: 8140 + i * 2 + j }));
  };
  // Sixteenths, the off ones a touch late (swung) and softer.
  const hat = (b: number, i: number) => {
    const off = (b * 4) % 2 === 1;
    k.add({ wave: 'noise', at: at(b) + (off ? 0.022 : 0), freq: SR, hold: 0.02, gain: off ? 0.07 : 0.12, a: 0.0005, d: 0.025, s: 0, r: 0.008, hp: 8000, pan: 0.3, seed: 8200 + i });
  };
  const bass = (b: number, note: string, beats: number) =>
    k.add({ wave: 'saw', at: at(b), freq: n(note), hold: at(beats) - 0.03, gain: 0.4, a: 0.003, d: 0.15, s: 0.5, r: 0.04, lp: 1600, lpTo: 300, lpTime: 0.12, q: 3, unison: [2, 8, 0], drive: 0.35 });
  // The orchestra hit: strings as many detuned saws, brass as a square, a thump of timpani and a scrape of the bows'
  // attack, all stopping short into the room.
  const hit = (b: number, big: boolean) => {
    const len = big ? 0.5 : 0.16;
    for (const [note, g, pan] of [['E3', 0.16, -0.4], ['B3', 0.14, 0.4], ['E4', 0.15, -0.2], ['G4', 0.13, 0.2], ['B4', 0.1, 0]] as const) {
      k.add({ wave: 'saw', at: at(b), freq: n(note), hold: len, gain: g * (big ? 1.2 : 1), a: 0.004, d: len, s: 0.2, r: 0.06, lp: 5200, lpTo: 1400, lpTime: len, unison: [4, 26, 0.7], verb: 0.45, pan });
    }
    k.add({ wave: 'square', at: at(b), freq: n('E3'), hold: len * 0.8, gain: 0.12, a: 0.006, d: len, s: 0.3, r: 0.05, lp: 2400, drive: 0.3, verb: 0.3 });
    k.add({ wave: 'sine', at: at(b), freq: n('E2'), to: n('E2') * 0.8, slide: 0.3, hold: big ? 0.5 : 0.2, gain: big ? 0.6 : 0.4, a: 0.002, d: big ? 0.5 : 0.2, s: 0, r: 0.05, drive: 0.3 });
    k.add({ wave: 'noise', at: at(b), freq: SR, hold: 0.04, gain: 0.25, a: 0.001, d: 0.05, s: 0, r: 0.02, bp: 3000, q: 0.6, verb: 0.4, seed: 8301 + Math.round(b * 10) });
  };
  // A gong: its partials out of tune with each other, the low ones longest, sinking a little as it rings.
  const gong = (b: number, gain: number) => {
    [[1, 1, 3], [1.52, 0.7, 2.4], [2.03, 0.55, 2], [2.71, 0.45, 1.6], [3.32, 0.35, 1.3], [4.15, 0.25, 1], [5.4, 0.18, 0.8]].forEach(([ratio, g, ring], i) => {
      const f = 98 * ratio!;
      k.add({ wave: 'sine', at: at(b), freq: f, to: f * 0.985, slide: ring!, hold: ring!, gain: gain * g!, a: 0.01 + i * 0.004, d: ring!, s: 0, r: 0.2, vib: [4.5, 0.06, 0.1], verb: 0.5, pan: (i % 2 ? 1 : -1) * 0.2 });
    });
    k.add({ wave: 'noise', at: at(b), freq: SR, hold: 0.6, gain: gain * 0.12, a: 0.005, d: 0.6, s: 0, r: 0.1, bp: 1100, q: 2, verb: 0.5, seed: 8350 });
  };
  const crash = (b: number) => k.add({ wave: 'noise', at: at(b), freq: SR, hold: 1.4, gain: 0.12, a: 0.001, d: 1.4, s: 0, r: 0.1, hp: 5000, verb: 0.35, pan: -0.25, seed: 8360 });
  // A koto-like pluck, softly.
  const pluck = (b: number, note: string, i: number) =>
    k.add({ wave: 'pluck', at: at(b), freq: n(note), hold: 0.5, gain: 0.32, a: 0.001, s: 1, r: 0.3, decay: 0.993, bright: 0.7, verb: 0.35, pan: 0.35, seed: 8400 + i });
  // A record pulled back and pushed forward under the hand: the music's pitch swooping down and up, twice.
  const scratch = (b: number) => {
    const strokes: Array<[number, number, number]> = [[0, 900, 260], [0.09, 260, 1100], [0.2, 1000, 240], [0.28, 240, 1300]];
    strokes.forEach(([off, f0, f1], i) => {
      k.add({ wave: 'saw', at: at(b) + off, freq: f0, to: f1, slide: 0.08, curve: 0.8, hold: 0.075, gain: 0.2, a: 0.004, d: 0.08, s: 0.6, r: 0.01, bp: 1400, q: 1.2, pan: 0.1 });
      k.add({ wave: 'noise', at: at(b) + off, freq: SR, hold: 0.075, gain: 0.12, a: 0.004, d: 0.08, s: 0.5, r: 0.01, bp: f0 * 2, bpTo: f1 * 2, bpTime: 0.08, q: 2, seed: 8500 + i });
    });
  };
  // A blade drawn through the air and its ring, from alternate sides.
  const swish = (b: number, i: number) => {
    const pan = i % 2 ? 0.5 : -0.5;
    k.add({ wave: 'noise', at: at(b) - 0.05, freq: SR, hold: 0.09, gain: 0.32, a: 0.05, d: 0.06, s: 0, r: 0.02, bp: 1200, bpTo: 7000, bpTime: 0.07, q: 1.4, pan, panTo: -pan, seed: 8600 + i });
    k.add({ wave: 'sine', at: at(b), freq: 2350 + i * 70, hold: 0.02, gain: 0.07, a: 0.001, d: 0.25, s: 0, r: 0.05, verb: 0.3, pan: -pan });
  };
  // The groove: two bars, the second under the cuts.
  for (let bar = 0; bar < 2; bar++) {
    const o = bar * 4;
    [0, 0.75, 2, 2.5].forEach((b) => kick(o + b, bar === 0 && b === 0));
    [1, 3].forEach((b, i) => snare(o + b, bar * 2 + i));
    for (let i = 0; i < 16; i++) hat(o + i / 4, bar * 16 + i);
    const line: Array<[number, string, number]> = [[0, 'E1', 0.5], [0.75, 'E1', 0.25], [1.5, 'G1', 0.25], [2, 'A1', 0.5], [2.75, 'B1', 0.25], [3.25, 'D2', 0.25], [3.5, bar ? 'B1' : 'E2', 0.5]];
    line.forEach(([b, note, beats]) => bass(o + b, note, beats));
  }
  hit(0, true);
  gong(0, 0.5);
  hit(2.5, false);
  hit(3, false);
  hit(6.5, false);
  ['B4', 'C5', 'E5', 'F5', 'E5', 'C5', 'B4', 'A4'].forEach((note, i) => pluck(1 + i * 0.25, note, i));
  scratch(CUT_FROM - 0.5);
  for (let i = 0; i < CUTS; i++) swish(CUT_FROM + i * CUT_STEP, i);
  kick(CUT_LAST, true);
  hit(CUT_LAST, true);
  gong(CUT_LAST, 0.6);
  crash(CUT_LAST);
  bass(CUT_LAST, 'E1', 2);
  pluck(CUT_LAST + 0.5, 'E5', 9);
  pluck(CUT_LAST + 0.75, 'B4', 10);
  return render(k, { reverb: { room: 0.45, damp: 0.45, wet: 0.3 } });
}

/** The mix slowed to a stop from `at` over `dur` seconds, as a tape or a record wound down by hand, and ending there. */
function tapeStop(mix: Mix, at: number, dur: number): Mix {
  const start = Math.round(at * SR), len = Math.round(dur * SR);
  const out = new Mix((start + len) / SR);
  out.l.set(mix.l.subarray(0, start));
  out.r.set(mix.r.subarray(0, start));
  for (let i = 0; i < len && start + i < out.length; i++) {
    // Read on at a speed falling straight from 1 to 0: by the end, half `dur` of the mix has played.
    const x = start + i - (i * i) / (2 * len);
    const j = Math.floor(x), f = x - j;
    const fade = Math.min(1, (len - i) / (0.05 * SR));
    if (j + 1 >= mix.length) break;
    out.l[start + i] = (mix.l[j]! * (1 - f) + mix.l[j + 1]! * f) * fade;
    out.r[start + i] = (mix.r[j]! * (1 - f) + mix.r[j + 1]! * f) * fade;
  }
  return out;
}

/** Ronnienomics!'s sounds, each made in its own way rather than as one of the console's effects. */
const RONNIENOMICS: Record<string, () => Mix> = { smoke_throw: smokeThrow, smoke_poof: smokePoof, smoke_vanish: smokeVanish, escape_sting: escapeFailed, ninja_beat: ninjaBeat };

/** The effects, by style. */
export const SFX: Record<string, (name: string) => Mix> = {
  console: (name) => (name === 'revival' ? revival() : name === 'gift_reveal' ? gift() : RONNIENOMICS[name]?.() ?? console8(name)),
};

/** The typing sound for a speaker's pitch, by style; `seed` varies it from letter to letter as the draft does. */
export const VOICE: Record<string, (pitch: number, seed: number) => Mix> = {
  console: (pitch, seed) => {
    const k = new Kit({ tick: 60, vsteps: 15, a: 0.001, r: 0.008 });
    k.add({ wave: 'pulse', duty: 0.25, at: 0, freq: pitch * (0.95 + rng(seed)() * 0.1), hold: 0.033, gain: 0.45, d: 0.04, s: 0.4 });
    return render(k, { mono: true });
  },
};
