import { EASE } from './motion.ts';

/**
 * How far the view has opened out of the arcade (the owner, 2026-10-19): at 0 it is the arcade's view, centred over
 * black with as much above it as below; at 1 it fills the screen as the printed world does. Game scales the panel by
 * it. Across the border it follows the leader, so the black bars open as the party walks into print and close again
 * walking back; at the ending it narrows back to the arcade's view.
 *
 * It took over the timing of the arcade cabinet that used to stand round the screen; the cabinet itself is gone.
 */
export class ViewLift {
  /** From 0 (the arcade's view) to 1 (the whole screen). */
  lift = 1;
  /** Where the lift is heading. */
  private target = 1;
  /** Easing toward a new place after a jump (a map change, the title), rather than following step by step. */
  private easing = false;
  /**
   * A timed way there (the title's entrance, the ending's narrowing), with its own easing. An open one never arrives by
   * itself; one with a speed is a landing, which carries on from that speed.
   */
  private passage: { from: number; age: number; seconds: number; open?: boolean; speed?: number } | null = null;
  /** How fast the lift moved over the last step, per second. */
  private speed = 0;

  /**
   * Where the view should be: 0 the arcade's, 1 the whole screen. Small changes from one step to the next (walking
   * across the border) are followed at once; a jump (a map change, the title) is eased in about half a second, all the
   * way there. A supplied duration instead takes that long, along an S-curve; an open one goes on past the S-curve's
   * middle at the pace it has there, closing in ever more slowly and never arriving, until `land` brings it in.
   */
  setLift(target: number, passageSeconds?: number, open = false): void {
    const t = Math.max(0, Math.min(1, target));
    if (Math.abs(t - this.target) > 0.15) {
      this.easing = true;
      this.passage = passageSeconds ? { from: this.lift, age: 0, seconds: passageSeconds, open } : null;
    }
    this.target = t;
    if (!this.easing) this.lift = t;
  }

  /** Whether an open passage is still closing in. */
  get open(): boolean { return this.passage?.open === true; }

  /** Brings an open passage the rest of the way in `seconds`, carrying on as fast as it is going and coming to rest there. */
  land(seconds: number): void {
    if (!this.passage?.open) return;
    this.passage = { from: this.lift, age: 0, seconds, speed: this.speed };
  }

  update(dt: number): void {
    const before = this.lift;
    const p = this.passage;
    if (p) {
      p.age += dt;
      const k = Math.min(1, p.age / p.seconds), d = this.target - p.from;
      if (p.open && p.age > p.seconds / 2) {
        // As fast as the S-curve is at its middle, and slowing as the gap closes.
        this.lift = this.target - d / 2 * Math.exp(-3 * (p.age / p.seconds - 0.5));
      } else if (p.speed !== undefined) {
        // From where it was, as fast as it was going, to rest at the target.
        const h = p.from * (2 * k ** 3 - 3 * k ** 2 + 1) + p.seconds * p.speed * (k ** 3 - 2 * k ** 2 + k) + this.target * (3 * k ** 2 - 2 * k ** 3);
        this.lift = Math.max(Math.min(p.from, this.target), Math.min(Math.max(p.from, this.target), h));
        if (k === 1) { this.lift = this.target; this.passage = null; }
      } else {
        this.lift = p.from + d * EASE.smooth(k);
        if (k === 1) this.passage = null;
      }
    } else if (this.lift !== this.target) {
      const step = dt * 2.5;
      this.lift = Math.abs(this.target - this.lift) <= step ? this.target : this.lift + Math.sign(this.target - this.lift) * step;
    }
    if (this.lift === this.target) this.easing = false;
    this.speed = dt > 0 ? (this.lift - before) / dt : 0;
  }
}
