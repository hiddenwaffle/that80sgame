import { STYLE_KINDS } from './style_names.ts';

/**
 * Which style the game's sound is played in: Console (the owner, 2026-10-13: "console will be the main soundtrack";
 * the Sound style setting and the other styles were retired that day and are kept in archive/sound_styles/). The
 * address can lay the first draft's sound over it, for checks and for trying things:
 *
 *   ?sound=draft           every kind the first draft's: effects, music, and voices
 *   ?sound=music:draft     one kind only (a later entry wins: ?sound=draft,sfx:console)
 *
 * `draft` is the game's first sound, played as notes as it goes rather than rendered, so it needs none of the
 * synthesizer.
 */
export type Kind = 'sfx' | 'music' | 'voice';
export const KINDS: readonly Kind[] = ['sfx', 'music', 'voice'];

/** The comparison page's speakers and their typing pitches (content/data/characters.yaml). */
export const SPEAKERS: ReadonlyArray<readonly [string, number]> = [
  ['Olli', 520],
  ['Ronnie', 300],
  ['Gorbie', 220],
  ['Blue Thing', 760],
  ['Shopkeeper', 600],
  ['Student', 480],
  ['Enemies', 180],
  ['Tank', 120],
  ['Boss', 140],
];
/** Pitches in content/data/characters.yaml that the page plays under another speaker's name. */
const ALSO: Record<number, string> = { 700: 'Blue Thing', 820: 'Blue Thing', 200: 'Enemies' };
/** Every typing pitch the script uses, so their voices can be made before anyone speaks. */
export const PITCHES: readonly number[] = [...SPEAKERS.map(([, p]) => p), ...Object.keys(ALSO).map(Number)];

export interface SoundChoice {
  /** Each kind's style, for sounds with no star of their own. */
  base: Record<Kind, string | null>;
  /** Styles sound by sound. */
  rows: Record<Kind, Record<string, string>>;
}

/** The choice an address's `sound` value makes, and any entries in it that name nothing. */
export function soundChoice(asked: string): { choice: SoundChoice; unknown: string[] } {
  const choice: SoundChoice = { base: { sfx: null, music: null, voice: null }, rows: { sfx: {}, music: {}, voice: {} } };
  const unknown: string[] = [];
  const set = (kind: Kind, style: string) => {
    choice.base[kind] = style;
    choice.rows[kind] = {};
  };
  for (const entry of asked.split(',').map((s) => s.trim()).filter(Boolean)) {
    const [a, b] = entry.split(':') as [string, string | undefined];
    if (b !== undefined && (KINDS as string[]).includes(a) && STYLE_KINDS[b]?.includes(a as Kind)) set(a as Kind, b);
    else if (b === undefined && STYLE_KINDS[a]) KINDS.forEach((kind) => STYLE_KINDS[a]!.includes(kind) && set(kind, a));
    else unknown.push(entry);
  }
  return { choice, unknown };
}

/** The choice for a style, with the address's `sound` value, if any, laid over it. */
export function choiceFor(style: string, asked: string | null): { choice: SoundChoice; unknown: string[] } {
  return soundChoice(['console', style, asked].filter(Boolean).join(','));
}

/** Whether every sound is the first draft's, so nothing need be rendered. */
export function allDraft(c: SoundChoice): boolean {
  return KINDS.every((k) => (c.base[k] ?? 'draft') === 'draft' && Object.values(c.rows[k]).every((s) => s === 'draft'));
}

/** The style a sound is rendered in, or null for the first draft's, played as notes. */
export function styleFor(c: SoundChoice, kind: Kind, row: string): string | null {
  const s = c.rows[kind][row] ?? c.base[kind];
  return s && s !== 'draft' ? s : null;
}

/** The comparison page's speaker for a typing pitch: its own, or the nearest. */
export function speakerOf(pitch: number): string {
  const own = ALSO[pitch] ?? SPEAKERS.find(([, p]) => p === pitch)?.[0];
  if (own) return own;
  const far = (p: number) => Math.abs(Math.log(p / pitch));
  return SPEAKERS.reduce((best, s) => (far(s[1]) < far(best[1]) ? s : best))[0];
}
