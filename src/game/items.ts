import type { ItemData } from '../content/schemas.ts';

/**
 * What using an item on someone would do, for the menus to show before the player
 * chooses. No drawing here, so the rules can be tested on their own.
 */

/** The numbers an item changes. In a fight HP is the fighter's own; MP is always the member's. */
export interface Vitals {
  hp: number;
  maxHp: number;
  mp: number;
  maxMp: number;
}

export interface Change {
  stat: 'hp' | 'mp';
  from: number;
  to: number;
}

/** Whether the item would do anything for them: getting up, if it revives, or else HP or MP they lack while standing. */
export function canHelp(item: ItemData, v: Vitals): boolean {
  return reaches(item, v) && lacks(item, v);
}

/** Shared menu reasons, for a whole party or a single target. Inventory is checked before vitals. */
export function itemBlocked(item: ItemData, people: readonly Vitals[], count: number, inBattle = true):
  'no_stock' | 'battle_only' | 'needs_ko' | 'needs_living' | 'full_hp' | 'full_mp' | 'full_vitals' | 'no_targets' | null {
  if (count <= 0) return 'no_stock';
  if (item.revive && !inBattle) return 'battle_only';
  if (people.some((v) => canHelp(item, v))) return null;
  if (!people.length) return 'no_targets';
  if (item.revive && people.every((v) => v.hp > 0)) return 'needs_ko';
  // Someone down needs a 1UP first: say so when no one is standing. Otherwise the reason is about those standing (a
  // Bandage with everyone up at full Health is 'Health full', though someone down lacks Health).
  if (!item.revive && people.every((v) => v.hp <= 0)) return 'needs_living';
  if (item.hp > 0 && item.mp > 0) return 'full_vitals';
  return item.mp > 0 ? 'full_mp' : 'full_hp';
}

/**
 * Whether the item is for them at all: one that revives only for someone down, and any other only for someone
 * standing. Someone down keeps their Energy, but a Coke given then does nothing until they are up again (the owner,
 * 2026-10-24: "it won't be a factor until they are 1UPed").
 */
function reaches(item: ItemData, v: Vitals): boolean {
  return item.revive ? v.hp <= 0 : v.hp > 0;
}

/** Whether they lack HP or MP the item gives, down or not. */
function lacks(item: ItemData, v: Vitals): boolean {
  return helpsHp(item, v) || (item.mp > 0 && v.mp < v.maxMp);
}

function helpsHp(item: ItemData, v: Vitals): boolean {
  return item.hp > 0 && v.hp < v.maxHp;
}

/** Each number the item would change, before and after; none for someone it is not for. */
export function previewItem(item: ItemData, v: Vitals): Change[] {
  const out: Change[] = [];
  if (!reaches(item, v)) return out;
  if (item.hp > 0) out.push({ stat: 'hp', from: v.hp, to: Math.min(v.maxHp, v.hp + item.hp) });
  if (item.mp > 0) out.push({ stat: 'mp', from: v.mp, to: Math.min(v.maxMp, v.mp + item.mp) });
  return out.filter((c) => c.to !== c.from);
}

/**
 * Who the item is most likely meant for: of those it can help, the lowest share of HP for
 * an item that restores HP (so someone down comes first, when it revives), or of MP for
 * one that restores MP. -1 when it helps no one.
 */
export function neediest(item: ItemData, people: Vitals[]): number {
  const share = (v: Vitals) => (helpsHp(item, v) ? v.hp / v.maxHp : v.mp / Math.max(1, v.maxMp));
  let best = -1;
  for (const [i, v] of people.entries()) {
    if (!canHelp(item, v)) continue;
    if (best < 0 || share(v) < share(people[best]!)) best = i;
  }
  return best;
}
