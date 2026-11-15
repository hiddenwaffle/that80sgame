/**
 * What the fight's status rows say about each member, as marks that do not rely on colour: a
 * word for a member who is down, a mark for low HP, and a READY tag. No drawing here, so the
 * rules can be tested on their own.
 */

export interface StatusCues {
  down: boolean;
  low: boolean;
  ready: boolean;
}

/** Low HP starts below this share of the maximum. */
export const LOW_HP = 0.3;

/**
 * Below this share a fight card's Health bar strobes faster and harder and its dots run faster (the owner, 2026-10-29:
 * "when it gets to under 20% the HP bar just gets more stroby and its dots animation get faster", in place of the "!").
 */
export const CRITICAL_HP = 0.2;

export function statusCues(f: { hp: number; maxHp: number; bar: number; busy: boolean }, barMax: number): StatusCues {
  return {
    down: f.hp <= 0,
    low: f.hp > 0 && f.hp < f.maxHp * LOW_HP,
    ready: f.hp > 0 && !f.busy && f.bar >= barMax,
  };
}
