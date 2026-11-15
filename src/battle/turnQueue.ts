/** Logical time only. Rendering and real seconds never advance this queue. */
export class TurnQueue<T> {
  time = 0;
  current: T | null = null;
  private serial = 0;
  private entries = new Map<T, { at: number; order: number }>();

  schedule(who: T, delay: number): void {
    if (!Number.isFinite(delay) || delay <= 0) throw new Error('Turn recovery must be positive');
    this.entries.set(who, { at: this.time + delay, order: this.serial++ });
  }

  remove(who: T): void {
    this.entries.delete(who);
    if (this.current === who) this.current = null;
  }

  /** When someone is next due, or null if they have no turn waiting. */
  dueAt(who: T): number | null {
    return this.entries.get(who)?.at ?? null;
  }

  next(): T | null {
    if (this.current !== null) return this.current;
    const next = [...this.entries].sort((a, b) => a[1].at - b[1].at || a[1].order - b[1].order)[0];
    if (!next) return null;
    this.time = next[1].at;
    this.entries.delete(next[0]);
    return this.current = next[0];
  }

  finish(delay: number): void {
    const who = this.current;
    if (who === null) return;
    this.current = null;
    this.schedule(who, delay);
  }

  /** A copy that goes on by itself from here, the turn under way included (the balance tools' model searches on copies). */
  clone(): TurnQueue<T> {
    const copy = new TurnQueue<T>();
    copy.time = this.time;
    copy.current = this.current;
    copy.serial = this.serial;
    copy.entries = new Map(this.entries);
    return copy;
  }

  /** The same queue with everyone in it named another way (the balance tools' model numbers the fighters). */
  relabel<U>(to: (who: T) => U): TurnQueue<U> {
    const copy = new TurnQueue<U>();
    copy.time = this.time;
    copy.current = this.current === null ? null : to(this.current);
    copy.serial = this.serial;
    copy.entries = new Map([...this.entries].map(([who, entry]) => [to(who), entry]));
    return copy;
  }

  /** A pure forecast assuming ordinary attacks. No combat RNG or live state is consumed. */
  preview(count: number, recovery: (who: T) => number): T[] {
    return this.forecast(count, recovery).map(entry => entry.who);
  }

  /** Absolute logical times distinguish repeated portraits and keep them stable as turns advance. */
  forecast(count: number, recovery: (who: T) => number): Array<{ who: T; at: number }> {
    const copy = new TurnQueue<T>();
    copy.time = this.time;
    copy.serial = this.serial;
    copy.entries = new Map(this.entries);
    const out: Array<{ who: T; at: number }> = [];
    if (this.current !== null && count > 0) {
      out.push({ who: this.current, at: this.time });
      copy.schedule(this.current, recovery(this.current));
    }
    while (out.length < count) {
      const who = copy.next();
      if (who === null) break;
      out.push({ who, at: copy.time });
      copy.finish(recovery(who));
    }
    return out;
  }
}
