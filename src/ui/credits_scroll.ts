/** A reel's position in panel pixels. Pointer input owns it until released. */
export class CreditsScroll {
  position = 0;
  velocity = 0;
  maximum = 0;
  autoSpeed = 0;
  dragging = false;
  private coasting = false;
  private elastic = 1;
  /** Escape/B's fast-forward was the last key held: let go of, it eases back twice as quickly as the others (the owner, 2026-11-13). */
  private fastForward = false;

  layout(maximum: number, autoSpeed: number, height: number): void {
    const ratio = this.maximum ? maximum / this.maximum : 1;
    this.position *= ratio;
    this.velocity = this.maximum ? this.velocity * ratio : autoSpeed;
    this.maximum = maximum;
    this.autoSpeed = autoSpeed;
    this.elastic = height * .12;
  }

  get atEnd(): boolean {
    return !this.dragging && Math.abs(this.position - this.maximum) < .25 && Math.abs(this.velocity) < 1;
  }

  grab(): void { this.dragging = true; this.coasting = false; this.fastForward = false; this.velocity = 0; }

  drag(delta: number, reduced: boolean): number {
    const before = this.position;
    const next = before + delta;
    const edge = next < 0 ? 0 : next > this.maximum ? this.maximum : null;
    this.position = edge === null ? next : reduced ? edge
      : edge + (next - edge) / (1 + Math.abs(next - edge) / this.elastic);
    return this.position - before;
  }

  release(velocity: number, reduced: boolean): void {
    this.dragging = false;
    this.fastForward = false;
    this.velocity = reduced ? 0 : velocity;
    this.coasting = !reduced && Math.abs(velocity) > 5;
  }

  /** Direction is -1 for Up, 1 for Down/Space/A, and 2 for Escape/B. */
  update(dt: number, direction: number, reduced = false): void {
    if (this.dragging) return;
    if (direction) this.fastForward = direction === 2;
    const p = this.position, v = this.velocity, max = this.maximum;
    const edge = p < 0 ? 0 : p > max ? max
      : p >= max && v >= 0 && direction >= 0 ? max
      : p <= 0 && v <= 0 && direction < 0 ? 0 : null;
    if (edge !== null) {
      // Critically damped spring: return softly, without a repeated bounce while a key stays held.
      const x = p - edge, omega = 14, term = v + omega * x, decay = Math.exp(-omega * dt);
      this.position = reduced ? edge : edge + (x + term * dt) * decay;
      this.velocity = reduced ? 0 : (v - omega * term * dt) * decay;
      if (Math.abs(this.position - edge) < .1 && Math.abs(this.velocity) < 1) {
        this.position = edge; this.velocity = 0; this.coasting = false;
      }
      return;
    }
    if (direction) this.coasting = false;
    if (this.coasting && !reduced) {
      const tau = .32, decay = Math.exp(-dt / tau);
      this.position += v * tau * (1 - decay);
      this.velocity *= decay;
      if (Math.abs(this.velocity) < Math.max(5, this.autoSpeed * .08)) this.coasting = false;
    } else {
      const target = this.autoSpeed * (direction ? direction * 6 : 1);
      const tau = reduced ? 0 : direction ? .12 : this.fastForward ? .25 : .5;
      const decay = tau ? Math.exp(-dt / tau) : 0;
      this.position += target * dt + (v - target) * tau * (1 - decay);
      this.velocity = target + (v - target) * decay;
      // The unattended roll lands FIN exactly; user-driven travel gets the elastic edge.
      if (!direction && this.position >= max) { this.position = max; this.velocity = 0; }
    }
  }
}
