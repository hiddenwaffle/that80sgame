import { DRAFT_MUSIC_GAIN, DRAFT_SFX_GAIN, draftSfx, draftTrack, draftVoice } from './draft.ts';
import { Mix, SR, gainTo, loudness, normalize, scale } from './dsp.ts';
import { arrange, arrangeIntro } from './score.ts';
import { STYLES } from './sketches.ts';
import { OPENINGS } from '../openings.ts';
import { INTROS } from '../intros.ts';
import { bridgeForGame } from './bridge.ts';
import { berlinForGame } from './berlin.ts';
import { musicLevelGain } from '../music_levels.ts';

/**
 * The sketches as the game plays them when one is tried in it (`?sound=`, see choice.ts): each sound as loud as the
 * game's own sound plays that sound now, so trying a style changes how the game sounds and not how loud it is. The
 * levels are before the settings' volumes, which the game applies as it plays. Music then receives its fixed
 * track-level adjustment (music_levels.ts); effects and voices keep their original levels.
 */

/** Blip times of a typed line at the default 60 letters a second, a blip every other letter, as the game types. */
export const LINE_BLIPS: readonly number[] = (() => {
  const out: number[] = [];
  let letters = 0;
  [...'xxxx xxxxx xx xxxxxx xxxx xxx'].forEach((ch, i) => {
    if (ch !== ' ' && letters++ % 2 === 0) out.push(i / 60);
  });
  return out;
})();

/** Takes of each voice's blip, played in turn, so letters differ a little as a speaker types. */
export const VOICE_TAKES = 4;

/** A typed line made of a voice's takes in turn. */
export function typedLine(takes: Mix[]): Mix {
  const line = new Mix(LINE_BLIPS.at(-1)! + 0.3);
  LINE_BLIPS.forEach((t, i) => {
    const b = takes[i % takes.length]!;
    const o = Math.round(t * SR);
    for (let k = 0; k < b.length && o + k < line.length; k++) {
      line.l[o + k]! += b.l[k]!;
      line.r[o + k]! += b.r[k]!;
    }
  });
  return line;
}

const db = (x: number) => 20 * Math.log10(x);
const takes = (voice: (pitch: number, seed: number) => Mix, pitch: number) => Array.from({ length: VOICE_TAKES }, (_, i) => voice(pitch, i + 1));

/**
 * The original style-normalization reference, before the final music-level adjustment and settings' volumes (LUFS):
 * an effect over its loudest 400 ms, a track as a whole, a voice as a typed line.
 */
export function gameLevel(kind: 'sfx' | 'music' | 'voice', name: string, pitch = 440): number {
  if (kind === 'sfx') return loudness(draftSfx(name)).momentary - db(DRAFT_SFX_GAIN);
  // A track's is worked out from its whole first draft (Beijing's is 168 s), once, as each of its opening pieces asks.
  if (kind === 'music') return trackLevels.get(name) ?? trackLevels.set(name, loudness(draftTrack(name)).integrated - db(DRAFT_MUSIC_GAIN)).get(name)!;
  return loudness(typedLine(takes(draftVoice, pitch))).momentary - db(DRAFT_SFX_GAIN);
}
const trackLevels = new Map<string, number>();

export { OPENINGS };

/**
 * A sound in a style at the game's level for it: one mix for an effect or a track, a voice's takes for a voice. With
 * `until`, a piece of a track's opening (`OPENINGS`), in the Console style.
 */
export function renderForGame(style: string, kind: 'sfx' | 'music' | 'voice', name: string, pitch = 440, until?: number): Mix[] {
  const out = renderAtReferenceLevel(style, kind, name, pitch, until);
  if (kind === 'music') for (const mix of out) scale(mix, musicLevelGain(style, name));
  return out;
}

/** Preserve the approved render and its floating-point operations before applying the one final music gain. */
function renderAtReferenceLevel(style: string, kind: 'sfx' | 'music' | 'voice', name: string, pitch: number, until?: number): Mix[] {
  const s = STYLES[style];
  if (!s?.[kind]) throw new Error(`${style} has no ${kind}`);
  if (style === 'console' && kind === 'music' && name === 'border') return [bridgeForGame(until)];
  if (style === 'console' && kind === 'music' && name === 'berlin') return [berlinForGame(until)];
  const opening = kind === 'music' && style === 'console' ? OPENINGS[name] : undefined;
  if (until !== undefined && !opening) throw new Error(`${style} ${name} has no opening pieces`);
  if (opening) {
    const mix = arrange('console', name, undefined, false, until);
    scale(mix, gainTo(opening.integrated, opening.peak, opening.level).gain);
    return [mix];
  }
  if (kind === 'voice') {
    const out = takes(s.voice!, pitch);
    const gain = 10 ** ((gameLevel('voice', name, pitch) - loudness(typedLine(out)).momentary) / 20);
    out.forEach((m) => scale(m, gain));
    return out;
  }
  const mix = kind === 'sfx' ? s.sfx!(name) : s.music!(name);
  const { gain } = normalize(mix, kind, gameLevel(kind, name));
  if (kind === 'music') loopGains.set(`${style} ${name}`, gain);
  return [mix];
}

/** The original arrangement gain, shared with intro workers before both apply the fixed music-level adjustment. */
const loopGains = new Map<string, number>();

/** The original arrangement gain from this worker, excluding the shared final music-level adjustment. */
export const loopGain = (style: string, name: string): number | undefined => loopGains.get(`${style} ${name}`);

/**
 * The pieces a track plays after a fight before its loop goes on (intros.ts), at the loop's own gain: a piece and the
 * loop overlap where its last notes ring on, so both must be at one level, which `normalize` would instead work out
 * from each piece. `gain` is the loop's, from wherever it was rendered (the game's other worker); without it, the gain
 * the loop was given here, rendering the loop first if it was not.
 */
export function renderIntros(style: string, name: string, gain?: number): Mix[] {
  const set = INTROS[name];
  if (style !== 'console' || !set || OPENINGS[name]) throw new Error(`${style} ${name} has no intro pieces`);
  if (gain === undefined && !loopGains.has(`${style} ${name}`)) renderForGame(style, 'music', name);
  const g = gain ?? loopGains.get(`${style} ${name}`)!;
  return set.pieces.map((_, i) => scale(scale(arrangeIntro(style, name, i), g), musicLevelGain(style, name)));
}
