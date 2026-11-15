import {
  BEIJING_BARS, BEIJING_BPM, BEIJING_ORNAMENTS, BEIJING_SECTIONS, beatTokens, carriesTune, lineTokens, type Beat, type BeijingSection,
  type Player, type Role,
} from '../beijingScore.ts';
import { bowPart } from './bowedString.ts';
import { Mix, SR, finish, fold, framesOf, hz, play, rng, type Fx, type Voice } from './dsp.ts';

/**
 * Beijing's arrangement (2026-10-12, second version): the score in `beijingScore.ts` on synthesized voices modelled on
 * real instruments, and nothing else (the owner found the console's sounds and a synthetic bass jarring among them). The
 * fiddle that carries the tune is a modelled bowed string (`bowedString.ts`, 2026-10-13: the owner found the first one,
 * a pulse wave, the most synthetic voice in the loop); a crisp plucked lute, a ringing hammered dulcimer and a zither
 * carry the inner parts; a bamboo flute breathes and flicks a few grace notes; a plucked string bass, a barrel drum, a
 * hand drum and a shaker keep the street moving. Ornaments come only from the score's list.
 */

/** A note of a written line: its start and length in steps (sixteenths), and its pitch in Hz. */
export interface Written {
  s: number;
  len: number;
  f: number;
}

/** Reads sixteen tokens a bar into notes: a note ("F#4"), "-" holding the note before (across bar lines), or "." a rest. */
export function line(tokens: readonly string[]): Written[] {
  const out: Written[] = [];
  tokens.forEach((t, s) => {
    if (t === '-') {
      const last = out.at(-1);
      if (!last || last.s + last.len !== s) throw new Error(`A hold at step ${s} follows no note`);
      last.len++;
    } else if (t !== '.') out.push({ s, len: 1, f: hz(t) });
  });
  return out;
}

/** Optional shaping for a melodic note. */
export interface Touch {
  /** Slide into the note from this many semitones away (negative is from below), over `slideTime` seconds. */
  slideFrom?: number;
  slideTime?: number;
  /** Bend away at the end of the note by this many semitones (a falling sigh), over the note's last 0.15 s. */
  fall?: number;
  /** A grace note this many semitones away, flicked before the note settles. */
  grace?: number;
  /** A pressed string: the pluck starts this many semitones low (negative) and is pressed up to the note at once. */
  press?: number;
  /** The note follows the one before without a break, so the bow or the breath does not stop. */
  slur?: boolean;
  /** The same player goes straight on to another note, so this one lets go at once instead of fading over it. */
  tie?: boolean;
}

/** Breakpoints for a note's pitch from its touch, or undefined for a plain note. */
function bendOf(hold: number, t: Touch): Voice['bend'] {
  const points: Array<[number, number]> = [];
  if (t.slideFrom) points.push([0, t.slideFrom], [t.slideTime ?? 0.08, 0]);
  else if (t.press) points.push([0, t.press], [0.07, 0]);
  else if (t.grace) points.push([0, t.grace], [0.035, t.grace], [0.06, 0]);
  if (t.fall) points.push([Math.max(points.at(-1)?.[0] ?? 0, hold - 0.15), 0], [hold + 0.05, t.fall]);
  return points.length ? points : undefined;
}

/** A low bowed string (a cello's range): a bowed string's sawtooth through a wooden body that keeps its fundamental. */
export function lowBowed(v: Voice[], at: number, hold: number, f: number, gain: number, t: Touch = {}): void {
  v.push({ wave: 'saw', at, freq: f, hold, gain, a: t.slur ? 0.04 : 0.1, d: 0.6, s: 0.85, r: t.tie ? 0.04 : 0.16,
    formants: [140, 480, 1300], fq: 1.6, lp: 1800, lpTo: 1300, vib: [5, 0.14, 0.3, 0.5], bend: bendOf(hold, t), verb: 0.2 });
}

/** The bamboo flute (dizi): a soft tone with its breath about 20 dB under it and a little chiff where it starts. */
export function flute(v: Voice[], at: number, hold: number, f: number, gain: number, t: Touch = {}): void {
  v.push({ wave: 'tri', at, freq: f, hold, gain, a: t.slur ? 0.015 : 0.04, d: 0.3, s: 0.85, r: t.tie ? 0.03 : 0.09, lp: 4200, vib: [5, 0.1, 0.3, 0.35], bend: bendOf(hold, t), verb: 0.3 });
  v.push({ wave: 'noise', freq: SR, at, hold, gain: gain * 0.45, a: 0.02, d: 0.15, s: 0.6, r: t.tie ? 0.03 : 0.08, bp: Math.min(f * 2, 6000), q: 1.2, verb: 0.3 });
  if (!t.slur) v.push({ wave: 'noise', freq: SR, at, hold: 0.015, gain: gain * 0.2, d: 0.015, s: 0, bp: Math.min(f * 3, 8000), q: 2 });
}

/** The zither (guzheng): one pluck, ringing on, pressed when asked. */
export function zither(v: Voice[], at: number, hold: number, f: number, gain: number, t: Touch = {}): void {
  v.push({ wave: 'pluck', at, freq: f, hold, gain, decay: 0.996, bright: 0.55, a: 0.001, r: 0.2, lp: 6000, lpTo: 2500, lpTime: 0.4,
    bend: bendOf(hold, t), verb: 0.3 });
}

/** The lute (pipa): a bright, crisp pick that dies quickly, through a nasal body. */
export function lute(v: Voice[], at: number, hold: number, f: number, gain: number): void {
  v.push({ wave: 'pluck', at, freq: f, hold, gain, decay: 0.991, bright: 0.85, a: 0.001, r: 0.08, lp: 7000, lpTo: 2600, lpTime: 0.25,
    formants: [950, 2600], fq: 2, verb: 0.25 });
}

/** The hammered dulcimer (yangqin): paired strings a few cents apart, struck brightly, ringing on. */
export function dulcimer(v: Voice[], at: number, hold: number, f: number, gain: number, seed = 1): void {
  v.push({ wave: 'pluck', at, freq: f, hold, gain, decay: 0.9994, bright: 0.7, unison: [2, 4, 0], a: 0.001, r: 0.3, lp: 9000, lpTo: 3200, lpTime: 0.5,
    verb: 0.3, seed });
}

/** The dulcimer's two-hammer roll on a long note: struck about fourteen times a second, swelling then easing. */
export function roll(v: Voice[], at: number, hold: number, f: number, gain: number, seed: number): void {
  const random = rng(seed);
  const n = Math.max(2, Math.floor(hold * 14));
  for (let i = 0; i < n; i++) {
    const x = i / (n - 1);
    const shape = 0.6 + 0.4 * Math.sin(Math.PI * Math.min(1, 0.3 + x * 0.8));
    dulcimer(v, at + i / 14 + (random() - 0.5) * 0.008, i === n - 1 ? 0.6 : 0.09, f, gain * shape * (0.85 + random() * 0.3) * (i % 2 ? 0.85 : 1), seed * 31 + i);
  }
}

/** The plucked string bass: the string itself, with a short knock under it for the thump. */
export function bass(v: Voice[], at: number, hold: number, f: number, gain: number): void {
  v.push({ wave: 'pluck', at, freq: f, hold, gain, decay: 0.99, bright: 0.3, a: 0.002, r: 0.12, lp: 1600, lpTo: 500, lpTime: 0.25 });
  v.push({ wave: 'sine', at, freq: f, hold: 0.04, gain: gain * 0.25, a: 0.003, d: 0.08, s: 0, r: 0.08 });
}

/**
 * The barrel drum, struck softly in its middle: its pitch drops only a little, with the head's second mode over it and
 * the stick's soft knock. A lighter stroke nearer the rim sounds higher and shorter.
 */
export function drum(v: Voice[], at: number, gain: number, light = false): void {
  if (light) {
    v.push({ wave: 'sine', at, freq: 150, to: 138, slide: 0.12, curve: 0.6, hold: 0.16, gain, d: 0.15, s: 0, verb: 0.12 });
    v.push({ wave: 'noise', freq: SR, at, hold: 0.02, gain: gain * 0.3, d: 0.02, s: 0, bp: 900, q: 1 });
    return;
  }
  v.push({ wave: 'sine', at, freq: 86, to: 76, slide: 0.15, curve: 1, hold: 0.4, gain, d: 0.36, s: 0, verb: 0.12 });
  v.push({ wave: 'sine', at, freq: 137, to: 124, slide: 0.1, hold: 0.12, gain: gain * 0.3, d: 0.12, s: 0, verb: 0.12 });
  v.push({ wave: 'noise', freq: SR, at, hold: 0.03, gain: gain * 0.25, d: 0.03, s: 0, bp: 600, q: 0.8 });
}

/** A hand drum: a tight skin that drops a little in pitch, with the slap of the palm; a ghost note is softer. */
export function hand(v: Voice[], at: number, gain: number, ghost = false): void {
  const g = ghost ? gain * 0.4 : gain;
  v.push({ wave: 'sine', at, freq: 210, to: 160, slide: 0.06, hold: 0.02, gain: g, a: 0.001, d: ghost ? 0.09 : 0.16, s: 0, r: 0.05, verb: 0.15 });
  v.push({ wave: 'noise', freq: SR, at, hold: 0.02, gain: g * 0.5, a: 0.001, d: ghost ? 0.02 : 0.035, s: 0, bp: 1300, q: 1.2, verb: 0.15 });
}

/** A soft shaker: a short hiss, its attack a little slow as the beads swing. */
export function shaker(v: Voice[], at: number, gain: number, soft = false): void {
  v.push({ wave: 'noise', freq: SR, at, hold: 0.01, gain: soft ? gain * 0.5 : gain, a: 0.012, d: 0.05, s: 0, r: 0.02, bp: 6500, q: 0.9 });
}

/**
 * Two small cup bells touched together: each rings with three partials, the higher ones dying sooner, the second bell a
 * little sharp of the first so the two beat slowly; a faint click where they touch.
 */
export function bells(v: Voice[], at: number, gain: number): void {
  for (const [bell, detune] of [[1, 1], [0.8, 1.007]] as const) {
    for (const [f, w, d] of [[3150, 1, 1.2], [4610, 0.5, 0.8], [6080, 0.3, 0.5]] as const) {
      v.push({ wave: 'sine', at, freq: f * detune, hold: d, gain: gain * bell * w, a: 0.001, d, s: 0, r: 0.05, verb: 0.45 });
    }
  }
  v.push({ wave: 'noise', freq: SR, at, hold: 0.004, gain: gain * 0.5, d: 0.004, s: 0, bp: 5000, q: 1 });
}

/** The city's room: a modest reverb the instruments send to, then one channel as the rest of the Console music. */
export const BEIJING_FX: Fx = { reverb: { room: 0.55, damp: 0.5, wet: 0.9 }, mono: true, lp: 11000 };

type Layer = 'lead' | 'bass' | 'harmony' | 'drums';

/** Which layer a role renders in, so tools and tests can hear the tune, the inner parts, the bass and the drums alone. */
const LAYER: Record<Role, Layer> = { lead: 'lead', second: 'lead', inner: 'harmony', low: 'harmony', bass: 'bass' };

/** A sound in Beijing's arrangement, before it is voiced: what plays, where, and how loud. */
export interface BeijingEvent {
  layer: Layer;
  /** The written line a note comes from. */
  role?: Role;
  kind: Player | 'roll' | Beat;
  /** Start and sounding length in steps (a plucked note rings past its written length), and pitch in Hz (0 for a drum). */
  s: number;
  len: number;
  /** The written length in steps. */
  written: number;
  f: number;
  gain: number;
  touch?: Touch;
  /** A lighter stroke ("o" in a percussion row). */
  light?: boolean;
}

const BAR = 16;
/** Notes this many steps long or more count as held when checking what rubs; shorter ones pass by. */
export const HELD = 3;
const midi = (f: number) => Math.round(69 + 12 * Math.log2(f / 440));
/** Semitone rubs, by pitch class. */
const rub = (a: number, b: number) => [1, 11].includes((((midi(a) - midi(b)) % 12) + 12) % 12);

/** The section a step falls in. */
function sectionAt(s: number): BeijingSection {
  let bar = Math.floor(s / BAR);
  for (const sec of BEIJING_SECTIONS) {
    if (bar < sec.bars) return sec;
    bar -= sec.bars;
  }
  throw new Error(`Step ${s} is past the loop`);
}

/** Who plays a role's line in a section. */
const playerOf = (sec: BeijingSection, role: Role): Player | undefined => sec.lines.find((l) => l.role === role)?.player;

/** How loud each instrument plays a tune (gain at a section level of 0 dB); seconds, inner parts and the bass are set from it. */
const VOICE_GAIN: Record<Player, number> = { bowed: 0.24, lowbow: 0.24, flute: 0.27, lute: 0.7, dulcimer: 0.55, zither: 0.8, bass: 0.73 };
const ROLE_GAIN: Record<Role, number> = { lead: 1, second: 0.6, inner: 0.42, low: 0.45, bass: 1 };

/**
 * How much each section is turned up or down (dB) so that its loudness follows the level written for it: sections
 * differ in how many instruments play and how high, so the written levels alone would spread them 6 dB apart.
 */
const TRIM: Record<string, number> = {
  street: 0.5, 'A grows': -0.5, stalls: 2.0, crosscurrents: -0.2, patrols: -0.2, alley: 0.2, evening: -0.5, lanterns: -1.9, crowd: -2.6, 'market calls': 2.0, homeward: 0.8,
};

/** How long a plucked note may ring, in steps, before the player stops it or it dies away. */
const RING: Partial<Record<Player, number>> = { lute: 6, dulcimer: 6, zither: 12 };

/** Every sound of Beijing's arrangement, in steps, over one loop. */
export function beijingEvents(): BeijingEvent[] {
  const out: BeijingEvent[] = [];
  const total = BEIJING_BARS * BAR;
  const roles: Role[] = ['lead', 'second', 'inner', 'low', 'bass'];
  const lines = Object.fromEntries(roles.map((r) => [r, line(lineTokens(r))])) as Record<Role, Written[]>;
  const level = (s: number) => {
    const sec = sectionAt(s);
    return 10 ** ((sec.level + TRIM[sec.name]!) / 20);
  };

  // Every written note, by start: a ringing string is stopped where any note a semitone from it sounds.
  const written = roles.flatMap((r) => lines[r]).sort((a, b) => a.s - b.s);

  for (const role of roles) {
    const notes = lines[role];
    notes.forEach((n, i) => {
      const sec = sectionAt(n.s);
      const player = playerOf(sec, role);
      if (!player) throw new Error(`Bar ${Math.floor(n.s / BAR) + 1} has a ${role} note but its section names no player`);
      const prev = notes[i - 1];
      const next = notes[i + 1];
      let len = n.len;
      const ring = RING[player];
      if (ring !== undefined) {
        // A plucked or struck string rings on: the lute until its next note, the dulcimer and zither until the same
        // string is struck again, each until it dies away.
        const until = player === 'lute' ? next?.s : notes.slice(i + 1).find((m) => m.f === n.f)?.s;
        len = Math.max(n.len, Math.min(ring, (until ?? total) - n.s));
        // The player stops the string where a note a semitone away sounds in any part (the first such, by start).
        const end = n.s + n.len;
        const stop = written.find((m) => m !== n && m.s < n.s + len && m.s + m.len > end && rub(m.f, n.f));
        if (stop) len = Math.max(n.len, stop.s - n.s);
      }
      const touch: Touch = {};
      if (prev && prev.s + prev.len === n.s) touch.slur = true;
      if (next && n.s + n.len === next.s && playerOf(sectionAt(next.s), role) === player) touch.tie = true;
      // A second voice taking the tune while the lead rests plays it as a lead would.
      const weight = carriesTune(role, n.s) ? ROLE_GAIN.lead : ROLE_GAIN[role];
      out.push({ layer: LAYER[role], role, kind: player, s: n.s, len, written: n.len, f: n.f, gain: VOICE_GAIN[player] * weight * level(n.s), touch });
    });
  }

  // The ornaments, each on the note its player sounds at its bar and step.
  for (const [bar, step, player, kind, semitones] of BEIJING_ORNAMENTS) {
    const s = (bar - 1) * BAR + step;
    const e = out.find((x) => x.kind === player && x.s <= s && x.s + x.written > s);
    if (!e) throw new Error(`No ${player} note for the ${kind} at bar ${bar} step ${step}`);
    const t = (e.touch ??= {});
    if (kind === 'slide') {
      t.slideFrom = semitones;
      t.slideTime = 60 / BEIJING_BPM / 4; // one sixteenth
    } else if (kind === 'grace') t.grace = semitones;
    else if (kind === 'fall') t.fall = semitones;
    else if (kind === 'press') t.press = semitones;
    else {
      e.kind = 'roll';
      e.len = e.written;
    }
  }

  // The percussion.
  const BEAT_GAIN: Record<Beat, [full: number, light: number]> = { drum: [0.45, 0.28], hand: [0.3, 0.3], shaker: [0.24, 0.24], bells: [0.057, 0.057] };
  for (const beat of ['drum', 'hand', 'shaker', 'bells'] as const) {
    beatTokens(beat).forEach((t, s) => {
      if (t === '.') return;
      const light = t === 'o';
      out.push({ layer: 'drums', kind: beat, s, len: 1, written: 1, f: 0, gain: BEAT_GAIN[beat][light ? 1 : 0] * level(s), light });
    });
  }
  if (out.some((e) => e.s >= total)) throw new Error('A sound starts past the loop');
  return out;
}

/**
 * Renders Beijing's loop: `step` is the length of a sixteenth in seconds; `has` says which layers to render (tools and
 * tests measure them alone), and `dry` leaves the room out. Its tails fold onto its start so it loops with no seam.
 * With `until`, only the loop's first `until` seconds, unfolded: the same render stopped there (every voice, the fiddle
 * and the room run sample by sample from the start), which the game plays while the whole loop renders.
 */
export function arrangeBeijing(step: number, has: (layer: Layer) => boolean, dry = false, until?: number): Mix {
  if (Math.abs(step - 60 / BEIJING_BPM / 4) > 1e-9) throw new Error('Beijing\'s fiddle is bowed at the score\'s own tempo');
  const seconds = BEIJING_BARS * BAR * step;
  const length = until === undefined ? seconds + (dry ? 2.5 : 5) : Math.min(until, seconds);
  // The fiddle is bowed before the mix is made, so the bowing's own buffers are gone before the mix's four exist (the
  // whole loop's render peaked at 188 MB with them together, 2026-11-12); it is still added after the other voices.
  const bowed = has('lead') ? fiddle(framesOf(length) / SR) : null;
  const mix = new Mix(length);
  for (const x of beijingVoices(step, (e) => has(e.layer))) play(mix, x);
  if (bowed) addFiddle(mix, bowed);
  finish(mix, dry ? { ...BEIJING_FX, reverb: undefined } : BEIJING_FX);
  return until === undefined ? fold(mix, seconds) : mix;
}

/**
 * How much louder (dB) the modelled fiddle plays than the score's gain for the old one, by section: matched section by
 * section to the old fiddle's loudness, so the tune sits against the rest as the owner approved it (the fiddle sits out
 * the stalls and the market calls; only ring tails reach them).
 */
const FIDDLE_LEVEL: Record<string, number> = {
  street: 4.2, 'A grows': 6.7, stalls: 11.4, crosscurrents: 6.3, patrols: 8.6, alley: 5.8, evening: 5.7, lanterns: 8.2, crowd: 7.7, 'market calls': 11.6, homeward: 4.5,
};

/** The fiddle's part on the modelled bowed string, `seconds` long. */
function fiddle(seconds: number): Float32Array {
  const notes = beijingEvents().filter((e) => e.kind === 'bowed');
  return bowPart(notes, (e) => e.gain * 10 ** (FIDDLE_LEVEL[sectionAt(e.s).name]! / 20), seconds);
}

/** Adds the fiddle's part in the middle, sent to the room as the other instruments are. */
function addFiddle(mix: Mix, y: Float32Array): void {
  const verbL = mix.verbL;
  const verbR = mix.verbR;
  for (let i = 0; i < mix.length; i++) {
    const v = y[i]!;
    mix.l[i]! += v;
    mix.r[i]! += v;
    verbL[i]! += v * 0.25;
    verbR[i]! += v * 0.25;
  }
}

/** The synthesizer voices of the sounds `keep` picks out (all of them, by default), at `step` seconds a sixteenth. */
export function beijingVoices(step: number, keep: (e: BeijingEvent) => boolean = () => true): Voice[] {
  const v: Voice[] = [];
  let seed = 1;
  for (const e of beijingEvents()) {
    if (!keep(e)) continue;
    // A second voice playing the same line its own way comes in a hair late.
    const at = e.s * step + (e.role === 'second' ? 0.012 : 0);
    const hold = e.len * step;
    const t = e.touch ?? {};
    switch (e.kind) {
      // The fiddle is a modelled string bowed through its whole part (arrangeBeijing), not a voice a note.
      case 'bowed': break;
      case 'lowbow': lowBowed(v, at, hold, e.f, e.gain, t); break;
      case 'flute': flute(v, at, hold, e.f, e.gain, t); break;
      case 'zither': zither(v, at, hold, e.f, e.gain, t); break;
      case 'lute': lute(v, at, hold, e.f, e.gain); break;
      case 'dulcimer': dulcimer(v, at, hold, e.f, e.gain, seed++); break;
      case 'roll': roll(v, at, hold, e.f, e.gain * 0.6, seed++); break;
      case 'bass': bass(v, at, hold, e.f, e.gain); break;
      case 'drum': drum(v, at, e.gain, e.light); break;
      case 'hand': hand(v, at, e.gain, e.light); break;
      case 'shaker': shaker(v, at, e.gain, e.light); break;
      case 'bells': bells(v, at, e.gain); break;
      default: {
        const missing: never = e.kind;
        throw new Error(`No voice for ${String(missing)}`);
      }
    }
  }
  return v;
}
