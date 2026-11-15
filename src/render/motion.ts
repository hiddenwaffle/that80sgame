/**
 * How the game moves: whether the player asked for reduced motion, the eases, and the named
 * durations every motion uses. The game binds `reduced` to its settings once, so drawing code
 * anywhere reads the setting as it is at that moment without being handed the settings.
 */

let source: () => boolean = () => false;

export const motion = {
  /** Whether motion is reduced (Settings). False until the game binds it, as in unit tests. */
  get reduced(): boolean {
    return source();
  },
  /** Makes `reduced` read from `fn`, such as the settings. */
  bind(fn: () => boolean): void {
    source = fn;
  },
};

/** Eases from 0 to 1. */
export const EASE = {
  /** Fast at first, settling at the end: paper pressed onto the page. */
  out: (k: number) => 1 - (1 - k) ** 3,
  /**
   * Out past the end by about three tenths of the way travelled, then back: a number growing from
   * half size to 1.15 and settling at 1, or a tag popping in.
   */
  pop: (k: number) => {
    const s = 3.4;
    const t = k - 1;
    return 1 + (s + 1) * t ** 3 + s * t ** 2;
  },
  /** Slow at both ends: a page turning, a map sliding. */
  smooth: (k: number) => k * k * (3 - 2 * k),
  /** Slow at first, leaving fast: a strip of paper pulled away. */
  in: (k: number) => k ** 3,
  linear: (k: number) => k,
} as const;

export type Ease = (k: number) => number;

/** The named durations, in milliseconds. */
export const MS = {
  /** A panel, list, or caption slapped onto the page as it opens. */
  paste: 120,
  /** A page rising as a sheet from the bottom of an upright phone. */
  sheet: 160,
  /** The cursor's band and glove sweeping to a new row. */
  cursor: 110,
  /** The chosen command's words popping from larger as the cursor arrives. */
  cursorWords: 130,
  /** A member's card lifting as they come to act. */
  tab: 100,
  /** A pressed button coming back up. */
  press: 80,
  /** The READY tag popping in. */
  readyPop: 150,
  /** A damage or heal number popping in. */
  numberPop: 160,
  /** A notice slapping down from larger. */
  notice: 180,
  /**
   * A new speaker's balloon bursting in, and its name box slamming down just after it. Not among what a
   * fighting player reads: in a fight a balloon opens only for the battle cry, before the clock runs.
   */
  balloonPop: 190,
  nameSlam: 230,
  /** The map sliding like the next panel of a strip, and a front page turning in and out. */
  mapSlide: 500,
  pageIn: 450,
  pageOut: 400,
  /** An ending's page fading in with Reduce motion, instead of spinning in. */
  picture: 500,
  /** A gauge on the party page growing to what an item gave, as a heal grows in on a fight's card. */
  gaugeGrow: 200,
  /**
   * A special move's splash: minimum total, and its snap open and shut. Ordinary decision time is held;
   * the Warsaw finale fuse continues. Text timing never follows the speed pellet's movement multiplier.
   */
  cutIn: 1070,
  cutInOpen: 150,
  cutInClose: 130,
  /** Focus lines struck in on a fight as it opens and drawing back to the panel's edges, while everyone walks in and before the clock runs. */
  fightOpen: 380,
  /** After a win, when nothing is being chosen: a level slapped onto the results, and the confetti thrown up and falling. */
  levelSlap: 180,
  confetti: 1100,
  /** The boss's last seconds, each whole one popping from larger as it is reached: read while choosing, so within the budget. */
  fuseTick: 150,
  /** The rings the boss's blast sends out across the fight, while its numbers land. */
  blastRing: 700,
  /** The giant ghost's glitter from its blast, flying out, twinkling and drifting down as it fades. */
  glitter: 1400,
  /** Focus lines struck in on the blow that wins a fight, drawing back while the results are pressed on. */
  finalBlow: 450,
  /** Sparkles over a member brought back from DOWN, or where Cherry Chomp's cherries land. */
  sparkle: 450,
  /** The map's name on arrival: its band swiping in with the letters popping up one after another, and swiping away at the end. */
  placeIn: 500,
  placeOut: 300,
} as const;

/** In a fight, the most time anything the player must read or press may spend moving. */
export const CHOOSING_BUDGET_MS = 160;

/** The motions a fighting player reads or presses through, which must all fit the budget. */
export const FIGHT_READ = ['paste', 'sheet', 'cursor', 'cursorWords', 'tab', 'press', 'readyPop', 'numberPop', 'fuseTick'] as const satisfies ReadonlyArray<keyof typeof MS>;

/** The beat idle motion keeps: 120 to the minute, an anthem's tempo. */
export const BEAT_S = 0.5;

/** A kick on each beat: 1 on the beat, falling away before the next, or always 0 with reduced motion. */
export function onBeat(t: number): number {
  if (motion.reduced) return 0;
  const k = (t % BEAT_S) / BEAT_S;
  return (1 - k) ** 3;
}

/** A gentle bob for idle marks (the talk mark, the finished-line triangle), or none with reduced motion. */
export function idleBob(t: number, unit: number, rate: number): number {
  return motion.reduced ? 0 : Math.sin(t * rate) * unit * 0.12;
}

/** 0 and 1 in turn every `ms` milliseconds, or always 0 with reduced motion. */
export function alternate(t: number, ms: number): 0 | 1 {
  return motion.reduced ? 0 : Math.floor((t * 1000) / ms) % 2 === 0 ? 0 : 1;
}

/** Working reading budget, not a measured guarantee: 250 ms per word plus a 200 ms recognition beat.
 * Entrances/exits are additional time. Hyphenated move names count as one word. */
export function readableHoldMs(text: string): number {
  return 200 + 250 * (text.match(/\S+/g)?.length ?? 0);
}

/** Both portrait and words have finished sliding after 1.6 opening intervals. */
export function cutInDurationMs(name: string): number {
  return Math.max(MS.cutIn, MS.cutInOpen * 1.6 + readableHoldMs(name) + MS.cutInClose);
}

/** The banner's letters finish their arrival after 180 ms, slightly after the band. */
export function bannerHoldSeconds(text: string, into: number, hold: number): number {
  return Math.max(hold, readableHoldMs(text) / 1000 + Math.max(0, .18 - into));
}
