import type { Mix } from './dsp.ts';
import { draftSfx, draftTrack, draftVoice } from './draft.ts';
import { MUSIC } from './score.ts';
import { SFX, VOICE } from './sfx.ts';

/**
 * The game's sound styles. Console is the game's sound (the owner, 2026-10-13: "console will be the main soundtrack");
 * `draft` is the game's first sound, played as notes, which stands in while a sound renders or if it cannot. The other
 * sketched styles (arcade, fm, synth, polished, comic) were retired the same day and are kept in archive/sound_styles/.
 */
export interface SoundStyle {
  /** What the style is, for the comparison page. */
  about: string;
  sfx?: (name: string) => Mix;
  music?: (name: string) => Mix;
  voice?: (pitch: number, seed: number) => Mix;
}

export const STYLES: Record<string, SoundStyle> = {
  draft: {
    about: 'The game\'s first sound: single oscillators and noise, made in the browser as each sound plays.',
    sfx: draftSfx,
    music: draftTrack,
    voice: draftVoice,
  },
  console: {
    about: 'An 8-bit home console: pulse waves, the stepped triangle, the noise channel, a second voice echoing.',
    sfx: SFX.console,
    music: MUSIC.console,
    voice: VOICE.console,
  },
};
