import type { EnemyData } from '../content/schemas.ts';
import type { GameState } from '../game/state.ts';

/** Qualification is a snapshot. Healing, items or changing stats mid-fight cannot
 * turn an unprepared attempt into a win. Only landed offensive actions count. */
export class WarsawFinale {
  readonly route: 'strength' | 'pellet' | 'unprepared';
  readonly requiredHits: number | null;
  hits = 0;

  constructor(state: GameState, rules: NonNullable<EnemyData['finale']>) {
    const thresholds = Object.entries(rules.grind_strength);
    const strong = thresholds.length > 0 && thresholds.every(([id, strength]) =>
      state.order.includes(id) && (state.members[id]?.strength ?? 0) >= strength);
    this.route = strong ? 'strength' : state.taken.includes('field:speed_pellet') ? 'pellet' : 'unprepared';
    this.requiredHits = strong ? rules.grind_hits : this.route === 'pellet' ? rules.pellet_hits : null;
  }

  get timed(): boolean { return this.route !== 'strength'; }

  /** Equal pieces of the remaining health make the last required hit the final one. */
  damage(hp: number): number {
    return this.requiredHits === null ? 0 : Math.ceil(hp / Math.max(1, this.requiredHits - this.hits));
  }

  landHit(): void { this.hits++; }
}
