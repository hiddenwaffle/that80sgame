import { EASE } from '../render/motion.ts';

/** Reserve this full envelope so the arrival cannot cover the controls or clip at the panel edge. */
export const PATROL_WARNING_PEAK = 1.75;

/** An immediate ink-stamp arrival, settling into a small pulse while the offscreen guard hesitates. */
export function patrolWarningScale(age: number, hesitation: number, reduced: boolean): number {
  if (reduced) return 1;
  if (age < .08) return PATROL_WARNING_PEAK * EASE.out(Math.max(0, age) / .08);
  if (age < .2) return 1 + (PATROL_WARNING_PEAK - 1) * (1 - EASE.out((age - .08) / .12));
  return hesitation > 0 ? 1 + .12 * Math.sin((age - .2) * Math.PI / .2) ** 2 : 1;
}
