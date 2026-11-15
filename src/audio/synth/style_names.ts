/**
 * What the sound styles and effects are called, and which kinds of sound each style makes, as plain data: so the page can
 * choose a style and list the effects without loading the synthesizer, which only the worker runs (Fable review SY-4,
 * 2026-11-09: the page's styled chunk carried sfx.ts, score.ts, draft.ts and beijing.ts for one membership test and this
 * list). tests/style_names.test.ts holds it to STYLES (sketches.ts) and to the effects draft.ts renders.
 */
import type { Kind } from './choice.ts';

/** Each style's kinds of sound, as STYLES gives them. */
export const STYLE_KINDS: Readonly<Record<string, readonly Kind[]>> = {
  draft: ['sfx', 'music', 'voice'],
  console: ['sfx', 'music', 'voice'],
};

/** The effects `AudioSystem.play` knows, in the order the comparison page lists them. */
export const SFX_NAMES = [
  'blip', 'confirm', 'cancel', 'turn', 'page', 'door', 'buy', 'waka', 'pickup', 'fanfare', 'gift_reveal', 'appear', 'rest', 'save', 'heal', 'revival',
  'battle_start', 'hit', 'miss', 'hurt', 'defeat', 'a_star', 'a_star_flare', 'cherry', 'charge', 'burst', 'ricochet',
  'blast', 'level_up', 'win', 'game_over', 'dive', 'neon_on', 'key', 'code_ok', 'dot', 'achievement',
  'smoke_throw', 'smoke_poof', 'smoke_vanish', 'escape_sting', 'ninja_beat',
] as const;
