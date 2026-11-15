import type { KeyBindings } from '../engine/input.ts';

/** Player settings, kept apart from saves in the browser's storage. */
export interface Settings {
  /** Characters a second; 0 means instant. */
  textSpeed: number;
  music: number;
  effects: number;
  reduceMotion: boolean;
  halftone: boolean;
  /** Draw at no more than 2x on a denser phone screen (src/render/density.ts); off unless chosen. */
  batterySaver: boolean;
  /** How big interface text is: Small, Normal or Large (TEXT_SIZES). Scales every menu, balloon, and page. */
  textSize: number;
  /** Which names the stored text size follows: 2 for Small, Normal and Large (from 2026-10-23). */
  textSizes?: number;
  /** Keys chosen on the Controls page, or none for the defaults. */
  keys: KeyBindings | null;
  /** Legacy preference retained for stored-settings compatibility; current combat ignores it. */
  battleMode: BattleMode;
}

/** Small, Normal and Large. Normal is the default but on the smallest phones, which start on Small (the owner, 2026-10-23). */
export const TEXT_SIZES = [1, 1.2, 1.4] as const;
/** A screen whose short side is under this many CSS px starts on Small: Normal leaves its pages too little room. */
const SMALL_SCREEN = 360;

/** Whether the screen is touched rather than pointed at with a mouse: a phone or a tablet. */
export function touchScreen(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
}

/**
 * The sizes Settings offers. On a phone or tablet it offers Small and Normal only: Large scales the whole interface, the
 * battle queue too, and made their menus scroll (the owner, 2026-10-29: just the option goes from the menu, nothing else
 * from the game, so a Large chosen before stays until the player steps down from it).
 */
export function textSizesFor(touch = touchScreen()): readonly number[] {
  return touch ? TEXT_SIZES.slice(0, 2) : TEXT_SIZES;
}

/** The text size a player starts on, for a window this size. */
export function defaultTextSize(vw: number, vh: number): number {
  return Math.min(vw, vh) < SMALL_SCREEN ? TEXT_SIZES[0] : TEXT_SIZES[1];
}
export const BATTLE_MODES = ['wait', 'active'] as const;
export type BattleMode = (typeof BATTLE_MODES)[number];

const KEY = 'that80sgame.settings.v1';

export function loadSettings(): Settings {
  const defaults: Settings = {
    textSpeed: 60,
    music: 0.8,
    effects: 1,
    reduceMotion: typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches,
    halftone: true,
    batterySaver: false,
    textSize: typeof window === 'object' ? defaultTextSize(window.innerWidth, window.innerHeight) : TEXT_SIZES[1],
    textSizes: 2,
    keys: null,
    battleMode: 'wait',
  };
  try {
    const raw = localStorage.getItem(KEY);
    const stored = raw ? (JSON.parse(raw) as Partial<Settings>) : null;
    const s: Settings = stored ? { ...defaults, ...stored } : defaults;
    // Until 23 Oct the sizes were Normal (1), Large (1.2) and Larger (1.4), with 1 the default. A size kept from then
    // at the old Normal becomes the new Normal for this screen; the larger two keep their number (Large is now Normal).
    if (stored && stored.textSizes !== 2 && s.textSize === TEXT_SIZES[0]) s.textSize = defaults.textSize;
    s.textSizes = 2;
    // Volumes are kept in range, whatever an older version saved.
    s.music = Math.max(0, Math.min(1, Number(s.music) || 0));
    s.effects = Math.max(0, Math.min(1, Number(s.effects) || 0));
    // The rest as their kinds too: a text size of 0 gave a blank game (Fable review F5, 2026-11-09).
    if (!(TEXT_SIZES as readonly number[]).includes(s.textSize)) s.textSize = defaults.textSize;
    if (typeof s.textSpeed !== 'number' || !(s.textSpeed >= 0)) s.textSpeed = defaults.textSpeed;
    if (typeof s.reduceMotion !== 'boolean') s.reduceMotion = defaults.reduceMotion;
    if (typeof s.halftone !== 'boolean') s.halftone = defaults.halftone;
    if (typeof s.batterySaver !== 'boolean') s.batterySaver = defaults.batterySaver;
    if (s.keys !== null && (typeof s.keys !== 'object' || Array.isArray(s.keys))) s.keys = null;
    // The Sound style setting was retired on 2026-10-13: the game plays Console. An older choice is dropped.
    delete (s as Settings & { soundStyle?: unknown }).soundStyle;
    if (!BATTLE_MODES.includes(s.battleMode)) s.battleMode = defaults.battleMode;
    return s;
  } catch {
    return defaults;
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage may be unavailable, in which case settings last for this visit */
  }
}
