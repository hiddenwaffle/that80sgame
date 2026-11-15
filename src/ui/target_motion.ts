/** Shared timing for the target and current-turn frames, in seconds. */
export const TARGET_CIRCUIT = 1.6;

export function frameMotion(age: number, reduced: boolean) {
  return {
    phase: reduced ? 0 : age / TARGET_CIRCUIT,
    corner: reduced ? 0 : .5 - .5 * Math.cos(age * Math.PI),
    glow: reduced ? .18 : .18 + .09 * (.5 + .5 * Math.sin(age * Math.PI * 2 * 1.2)),
    breath: reduced ? 0 : Math.sin(age * Math.PI * 2 * .75) * .003,
  };
}

/** Two long regions of each ink, with continuous blends between them. */
export const bandWave = (distance: number, phase: number) => .5 + .5 * Math.cos(4 * Math.PI * (distance - phase));

/** A held cue resumes its phase rather than catching up with wall time. */
export class CueClock {
  elapsed = 0;
  private last: number | null = null;

  step(now: number, held: boolean): number {
    const dt = this.last === null ? 0 : Math.max(0, now - this.last);
    this.last = now;
    if (!held) this.elapsed += dt;
    return this.elapsed;
  }
}
