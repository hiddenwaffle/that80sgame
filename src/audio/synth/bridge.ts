import { Mix, finish, fold, hz, play, type Fx, type Voice } from './dsp.ts';
import { BRIDGE_TEMPO } from '../bridge_mix.ts';
import { BRIDGE_PARTS, type BridgePart } from './bridge_score.ts';
import { BRIDGE_VOICES, type Art } from './bridge_instruments.ts';

export const BRIDGE_SECONDS = 40;
export const BRIDGE_BPM = BRIDGE_TEMPO;
/** Measured from the approved ends, each brought to -18 LUFS on the comparison page. */
export const BRIDGE_END_GAIN = { arcade: 0.6580575297796832, real: 0.9037502231243031 } as const;
/** The previous in-game border loop's loudness, before the player's volume setting. */
export const BRIDGE_GAME_LEVEL = -26.222854640798094;
const GAME_GAIN = 10 ** ((BRIDGE_GAME_LEVEL + 18) / 20);
const ARCADE_FX: Fx = { mono: true, lp: 11000 };
const PRINT_FX: Fx = { reverb: { room: 0.58, damp: 0.5, wet: 0.55 }, mono: true, lp: 12000 };
const HARP_FX: Fx = { reverb: { room: 0.4, damp: 0.5, wet: 0.12 }, mono: true, lp: 12000 };
export interface Note { s: number; len: number; f: number; art: Art }

export function notesOf(p: Pick<BridgePart, 'name' | 'patterns' | 'order'>, bars: number): Note[] {
  if (p.order.length !== bars) throw new Error(`${p.name}: order has ${p.order.length} bars, not ${bars}`);
  const out: Note[] = [];
  let last: Note | null = null;
  p.order.forEach((key, bar) => {
    if (key === '-' || key === '' || key === '.') { last = null; return; }
    const pat = p.patterns[key];
    if (pat === undefined) throw new Error(`${p.name}: no pattern "${key}"`);
    const toks = pat.trim().split(/\s+/);
    if (toks.length !== 16) throw new Error(`${p.name}: pattern "${key}" has ${toks.length} tokens`);
    toks.forEach((t, i) => {
      const s = bar * 16 + i;
      if (t === '-') { if (last && last.s + last.len === s) last.len++; else throw new Error(`${p.name}: a hold at bar ${bar + 1} step ${i} follows no note`); return; }
      if (t === '.') { last = null; return; }
      if (t === 'x' || t === 'a' || t === 'g') { last = { s, len: 1, f: 0, art: t }; out.push(last); return; }
      if (!/^[A-G]#?-?\d$/.test(t)) throw new Error(`${p.name}: bad token "${t}" at bar ${bar + 1} step ${i}`);
      last = { s, len: 1, f: hz(t), art: 'x' };
      out.push(last);
    });
  });
  return out;
}


/**
 * A synchronized pair packed as two channels: l is the mono arcade end, r the mono printed end, not stereo panning.
 * Each instrument keeps its own effect tail and float32 accumulation order from the approved reference. Only one
 * instrument's scratch mix is retained at a time. Opening pieces stop before folding; after the five-second seam
 * they match the loop, so the existing piece-to-loop handover can use the same sample frame on both channels.
 */
export function bridgeRaw(until?: number): Mix {
  if (until !== undefined && (!(until > 0) || until > BRIDGE_SECONDS)) throw new Error('Invalid bridge opening length');
  const seconds = until ?? BRIDGE_SECONDS, out = new Mix(seconds), step = 60 / BRIDGE_BPM / 4;
  BRIDGE_PARTS.forEach((p, part) => {
    const v: Voice[] = [], instrument = BRIDGE_VOICES[p.name];
    if (!instrument) throw new Error(`No bridge instrument ${p.name}`);
    let seed = 1;
    for (const n of notesOf(p, 16)) {
      if (n.s * step < seconds) instrument(v, n.s * step, n.len * step, n.f, p.level, n.art, { step, part, seed });
      seed++;
    }
    const end = until === undefined ? Math.max(seconds, ...v.map(x => x.at + x.hold + (x.r ?? 0.01))) + 4 : seconds;
    const mix = new Mix(end);
    for (const voice of v) play(mix, voice);
    finish(mix, p.side === 'arcade' ? ARCADE_FX : p.name === 'Harp' ? HARP_FX : PRINT_FX);
    const stem = until === undefined ? fold(mix, seconds) : mix;
    const target = p.side === 'arcade' ? out.l : out.r, gain = BRIDGE_END_GAIN[p.side];
    // The supplied raw references were exported after scaling each stem and undoing that scale. Keep their float32
    // round-trip too, rather than silently accepting a near-identical but differently rounded render.
    for (let i = 0; i < out.length; i++) target[i]! += Math.fround(stem.l[i]! * gain) / gain;
  });
  return out;
}

/** Each end at the old border's in-game level, with no extra level correction through the crossfade. */
export function bridgeForGame(until?: number): Mix {
  const m = bridgeRaw(until);
  for (let i = 0; i < m.length; i++) {
    m.l[i]! *= BRIDGE_END_GAIN.arcade * GAME_GAIN;
    m.r[i]! *= BRIDGE_END_GAIN.real * GAME_GAIN;
  }
  return m;
}
