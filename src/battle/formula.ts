import type { BattleData } from '../content/schemas.ts';

/** Battle arithmetic, kept free of rendering so it can be tested and simulated. */

export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A seed made from a run's seed and a name for one stream of random numbers (a fight and its number, a map
 * and its number), so each stream is fixed by the run's seed and none depends on another's draws (FNV-1a).
 */
export function hashSeed(...parts: Array<string | number>): number {
  let h = 0x811c9dc5;
  for (const ch of parts.join('\u0000')) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export const between = (rng: Rng, [a, b]: readonly [number, number]) => a + (b - a) * rng();

/** Bar units a second for a member with this Speed. */
export function fillRate(b: BattleData, speed: number): number {
  return b.fill_per_speed * (speed + b.speed_offset);
}

export function attackDamage(b: BattleData, strength: number, rng: Rng): number {
  return Math.max(1, Math.round(strength * between(rng, b.damage_variance)));
}

export function specialDamage(strength: number, power: number): number {
  return Math.ceil(strength * power);
}

/** Accuracy is the chance to hit, in percent. */
export function hits(accuracy: number, rng: Rng): boolean {
  return rng() * 100 < accuracy;
}
