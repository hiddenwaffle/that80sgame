import type { Content } from '../content/content.ts';
import { powerPellets } from './state.ts';

/**
 * Achievements (the owner, 2026-10-29): what the player has done across every game in this browser, kept apart from the
 * save, so New Game keeps it. The main menu offers the page once one is earned; beating the game is the usual first, and
 * beating the tank at level 1 with Ronnienomics! can bring it up sooner. The 100% one counts the maze's power pellets, its ghosts, the
 * patrols, the tank and the Warsaw Pac, each once, however many runs that takes. The hidden one, the Warsaw Pac beaten in a run
 * it never nuked, is a line on the 100% details and takes a finished 100% to 105% (the owner, 2026-11-11).
 */
export type AchievementId = 'finished' | 'hundred' | 'tank_at_one' | 'unnuked';
/** The Achievements page's rows; the hidden one is not among them. */
export const ACHIEVEMENTS: readonly AchievementId[] = ['finished', 'hundred', 'tank_at_one'];

export interface Progress {
  finished: boolean;
  /** The tank beaten at level 1 with the ninjas' lesson (the owner, 2026-11-11). A field of its own, so a level 1 win from
   * before the lesson was asked for counts for nothing. */
  tankAtOneTrained: boolean;
  /** Pickup keys, enemy kinds and encounter names, each once. */
  pellets: string[];
  ghosts: string[];
  patrols: string[];
  tank: boolean;
  /** The Warsaw Pac has been fought, which turns its ?? on the details page into its name. */
  warsawMet: boolean;
  warsaw: boolean;
  /** The Warsaw Pac blown up in a run in which it never nuked the party: no lost boss fight in the save (`warsaw_lost`). */
  unnuked: boolean;
}

/** What the 100% achievement asks for, from the maps: every ghost's look by its group, and each patrol as the fight it is. */
export interface HundredList {
  pellets: string[];
  ghostGroups: string[][];
  patrols: string[];
}

export function hundredList(c: Content): HundredList {
  const groups = new Map<string, string[]>();
  for (const o of c.maps.get('maze')?.objects ?? []) {
    if (o.type !== 'enemy') continue;
    const enc = String(o.props.encounter);
    groups.set(enc, [...(groups.get(enc) ?? []), String(o.props.kind)]);
  }
  const patrols = new Set<string>();
  for (const map of ['border', 'field']) {
    for (const o of c.maps.get(map)?.objects ?? []) {
      const enc = String(o.props.encounter);
      if (o.type === 'enemy' && enc !== 'tank') patrols.add(enc);
    }
  }
  return { pellets: powerPellets(c, 'maze'), ghostGroups: [...groups.values()], patrols: [...patrols] };
}

/** How much of the 100% is done, as a share: each pellet, ghost, patrol and boss counts the same. Once it is all done, the
 * hidden one adds 5 on top (the owner, 2026-11-11: "Only on top of 100%"); before, it adds nothing. */
export function hundredDone(p: Progress, list: HundredList): { done: number; total: number; percent: number } {
  const ghosts = list.ghostGroups.flat();
  const among = (have: string[], all: string[]) => all.filter((x) => have.includes(x)).length;
  const done = among(p.pellets, list.pellets) + among(p.ghosts, ghosts) + among(p.patrols, list.patrols) + Number(p.tank) + Number(p.warsaw);
  const total = list.pellets.length + ghosts.length + list.patrols.length + 2;
  return { done, total, percent: done >= total ? (p.unnuked ? 105 : 100) : Math.min(99, Math.floor((done / total) * 100)) };
}

export function earned(p: Progress, list: HundredList): AchievementId[] {
  const rows = ACHIEVEMENTS.filter((id) => (id === 'finished' ? p.finished : id === 'tank_at_one' ? p.tankAtOneTrained : hundredDone(p, list).percent >= 100));
  return p.unnuked ? [...rows, 'unnuked'] : rows;
}

/** The level 1 win shows as a secret, with no name or words, until the tank has been beaten at all (the owner, 2026-10-31). The tank can be left unbeaten all the way to the credits. */
export function tankSecret(p: Progress): boolean {
  return !p.tank && !p.tankAtOneTrained;
}

/** Adds to one of the lists, once. */
export function once(list: string[], item: string): void {
  if (!list.includes(item)) list.push(item);
}

/** What winning a fight adds: `atOneTrained` is whether the party was still at level 1 as it won, with Ronnie taught
 * Ronnienomics!, and `ghosts` the kinds of ghost it beat. */
export function noteWin(p: Progress, list: HundredList, encounter: string, atOneTrained: boolean, ghosts: readonly string[] = []): void {
  for (const kind of ghosts) once(p.ghosts, kind);
  if (encounter === 'tank') {
    p.tank = true;
    if (atOneTrained) p.tankAtOneTrained = true;
  } else if (encounter === 'boss') p.warsawMet = p.warsaw = true;
  else if (list.patrols.includes(encounter)) once(p.patrols, encounter);
}

/** What the Warsaw Pac's explosion adds (`[achieve unnuked]`): the hidden one, in a run it never nuked. A lost boss fight's
 * Try again sets `warsaw_lost` in the save; Load Last Save, Continue or a code from before the fight carry none (the owner,
 * 2026-11-11: "a save code implies a separate run anyway"). */
export function noteUnnuked(p: Progress, flags: Readonly<Record<string, boolean>>): void {
  if (!flags.warsaw_lost) p.unnuked = true;
}

export const noProgress = (): Progress => ({ finished: false, tankAtOneTrained: false, pellets: [], ghosts: [], patrols: [], tank: false, warsawMet: false, warsaw: false, unnuked: false });

const KEY = 'that80sgame.achievements.v1';

export function loadProgress(): Progress {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return noProgress();
    // Each field as its kind: a hand-edited or foreign record with a null list threw at the title on every load (Fable F5).
    const stored = JSON.parse(raw) as Record<string, unknown> | null;
    const p = noProgress();
    if (!stored || typeof stored !== 'object') return p;
    for (const key of Object.keys(p) as Array<keyof Progress>) {
      const v = stored[key];
      if (Array.isArray(p[key])) { if (Array.isArray(v)) (p[key] as string[]) = v.filter((x): x is string => typeof x === 'string'); }
      else if (typeof v === 'boolean') (p[key] as boolean) = v;
    }
    return p;
  } catch {
    return noProgress();
  }
}

export function saveProgress(p: Progress): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    // Nothing kept in this browser: the page simply shows less next time.
  }
}
