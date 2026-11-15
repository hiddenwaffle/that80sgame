import type { SpecialData } from '../content/schemas.ts';

/**
 * Rules of the fight that are not in the content files, shared by the engine (battle.ts) and the balance tools' model of it
 * (tools/balance/fight_model.ts), so the two cannot drift apart. No drawing here.
 */

/** How many of its turns a blast comes in while the member it is timed for is down. */
export const BLAST_TURNS_ALONE = 4;
/** How long after a blast the member it was timed for takes their turn, on the logical clock: nothing else falls between. */
export const BLAST_THEN_MEMBER = 1e-6;
/** The chance an enemy keeps after the member it hit last, while they stand; otherwise it picks anyone standing. */
export const TARGET_STICKY = 0.55;

/**
 * The specials a member knows, in their list's order: every shared move, except that a move learned in a scene (its
 * `member` and `flag`, once the flag is set) takes the place of the one it `replaces`, for that member only.
 */
export function memberSpecials(specials: Record<string, SpecialData>, flags: Record<string, boolean>, member: string): string[] {
  const learned = Object.entries(specials).filter(([, sp]) => sp.member === member && sp.flag && flags[sp.flag]);
  return Object.entries(specials).flatMap(([id, sp]) => {
    if (sp.member) return [];
    return [learned.find(([, l]) => l.replaces === id)?.[0] ?? id];
  });
}
