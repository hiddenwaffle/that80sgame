/**
 * Fixed-timestep loop. Game logic always advances in steps of 1/60 s, whatever
 * the display's refresh rate, so speeds and timers behave the same at 60 Hz,
 * 120 Hz, or when frames are dropped.
 */
export class FixedLoop {
  readonly step = 1 / 60;
  /** Longest real frame the loop will catch up on, so a stalled tab does not fast-forward. */
  maxFrame = 0.25;
  /** Dev mode can slow the game down or speed it up. */
  timeScale = 1;
  paused = false;
  /** Total simulated seconds. */
  time = 0;
  private acc = 0;
  private readonly update: (dt: number) => void;
  private readonly render: () => void;

  constructor(update: (dt: number) => void, render: () => void) {
    this.update = update;
    this.render = render;
  }

  /** Milliseconds each recent frame spent in game logic and scene updates, newest last, for the frame-rate tool. */
  readonly tickMs: number[] = [];

  /** Call once per display frame with the real elapsed time in seconds. */
  tick(realDt: number): void {
    const t0 = performance.now();
    if (!this.paused) {
      this.acc += Math.min(realDt, this.maxFrame) * this.timeScale;
      let steps = 0;
      while (this.acc >= this.step && steps < 60) {
        this.update(this.step);
        this.time += this.step;
        this.acc -= this.step;
        steps++;
      }
    }
    this.render();
    this.tickMs.push(performance.now() - t0);
    if (this.tickMs.length > 600) this.tickMs.splice(0, this.tickMs.length - 600);
  }

  /** Run exactly one step while paused (dev mode frame stepping). */
  stepOnce(): void {
    this.update(this.step);
    this.time += this.step;
    this.render();
  }
}
